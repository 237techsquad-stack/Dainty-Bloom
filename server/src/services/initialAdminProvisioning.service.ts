import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { z } from 'zod';

import { env } from '../config/env';
import { InitialAdminProvisioning, StaffControl, User } from '../models';
import { AppError } from '../utils/AppError';
import { logAuditEvent } from './audit.service';

const ADMIN_CONTROL_ID = 'active_admin_count';
const PROVISIONING_ID = 'initial-admin';

const initialAdminInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z
      .string()
      .trim()
      .email()
      .transform((email) => email.toLowerCase()),
    password: z.string().min(10).max(128),
  })
  .strict();

export interface InitialAdminInput {
  name: string;
  email: string;
  password: string;
}

export function validateInitialAdminInput(
  input: InitialAdminInput,
): InitialAdminInput {
  const result = initialAdminInputSchema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      'Administrator details are invalid; check the email, name, and password requirements',
      400,
      'INVALID_ADMIN_DETAILS',
    );
  }
  return result.data;
}

/**
 * Creates the first active administrator and its audit entry atomically.
 */
export async function provisionInitialAdmin(
  input: InitialAdminInput,
): Promise<void> {
  const validInput = validateInitialAdminInput(input);
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const marker =
        await InitialAdminProvisioning.findById(PROVISIONING_ID).session(
          session,
        );
      if (marker) {
        throw provisioningAlreadyCompleted();
      }

      const activeAdmin = await User.findOne({
        role: 'admin',
        accountState: 'active',
      })
        .select('_id')
        .session(session);
      if (activeAdmin) {
        throw new AppError(
          'An active administrator already exists; use the existing staff-management process',
          409,
          'ACTIVE_ADMIN_EXISTS',
        );
      }

      const passwordHash = await bcrypt.hash(
        validInput.password,
        env.BCRYPT_COST,
      );
      const [user] = await User.create(
        [
          {
            name: validInput.name,
            email: validInput.email,
            passwordHash,
            role: 'admin',
            accountState: 'active',
            emailVerified: false,
          },
        ],
        { session },
      );

      await InitialAdminProvisioning.create(
        [{ _id: PROVISIONING_ID, userId: user._id }],
        { session },
      );
      await StaffControl.updateOne(
        { _id: ADMIN_CONTROL_ID },
        { $set: { activeAdminCount: 1 } },
        { upsert: true, session },
      );
      await logAuditEvent({
        actor: user,
        action: 'admin.initial_provisioned',
        targetType: 'User',
        targetId: user._id.toString(),
        metadata: { method: 'operator_command' },
        session,
      });
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const marker = await InitialAdminProvisioning.findById(PROVISIONING_ID);
      if (marker) throw provisioningAlreadyCompleted();
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

function provisioningAlreadyCompleted(): AppError {
  return new AppError(
    'Initial administrator provisioning has already been completed; use the existing staff-management process',
    409,
    'INITIAL_ADMIN_ALREADY_PROVISIONED',
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

export function configuredDatabaseName(mongodbUri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(mongodbUri);
  } catch {
    throw new AppError(
      'MONGODB_URI is not a valid MongoDB connection URL',
      500,
      'INVALID_DATABASE_CONFIGURATION',
    );
  }

  if (parsed.protocol !== 'mongodb:' && parsed.protocol !== 'mongodb+srv:') {
    throw new AppError(
      'MONGODB_URI must use the MongoDB protocol',
      500,
      'INVALID_DATABASE_CONFIGURATION',
    );
  }

  const encodedName = parsed.pathname.replace(/^\/+/, '');
  if (!encodedName || encodedName.includes('/')) {
    throw new AppError(
      'MONGODB_URI must explicitly identify the intended database',
      500,
      'DATABASE_NAME_REQUIRED',
    );
  }

  try {
    const databaseName = decodeURIComponent(encodedName);
    if (
      parsed.searchParams.has('dbName') &&
      parsed.searchParams.get('dbName') !== databaseName
    ) {
      throw new AppError(
        'MONGODB_URI contains conflicting database names',
        500,
        'INVALID_DATABASE_CONFIGURATION',
      );
    }
    return databaseName;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'MONGODB_URI contains an invalid database name',
      500,
      'INVALID_DATABASE_CONFIGURATION',
    );
  }
}

export function verifyProductionDatabase(
  nodeEnv: string,
  mongodbUri: string,
  operatorConfirmation: string,
): void {
  if (nodeEnv !== 'production') return;

  const databaseName = configuredDatabaseName(mongodbUri);
  const hostname = new URL(mongodbUri).hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  if (!hostname || ['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new AppError(
      'Production provisioning refuses a local MongoDB host',
      403,
      'LOCAL_PRODUCTION_DATABASE_FORBIDDEN',
    );
  }
  if (operatorConfirmation.trim() !== databaseName) {
    throw new AppError(
      'Production database confirmation did not match; no administrator was created',
      403,
      'DATABASE_CONFIRMATION_FAILED',
    );
  }
}
