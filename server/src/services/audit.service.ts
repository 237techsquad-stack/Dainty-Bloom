import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongoose';

import { AuditEvent } from '../models/AuditEvent';
import type { UserRole } from '../constants/roles';
import type { IUser } from '../models/User';

interface AuditEventInput {
  actor?: IUser;
  actorRole?: UserRole | 'system' | 'unknown';
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  session?: ClientSession;
  idempotencyKey?: string;
}

export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  const ip = input.ip
    ? createHash('sha256').update(input.ip).digest('hex')
    : undefined;

  const event = {
    actor: input.actor?._id,
    actorRole: input.actor?.role ?? input.actorRole ?? 'system',
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata ?? {},
    ip,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  };

  try {
    if (input.session) {
      await AuditEvent.create([event], { session: input.session });
      return;
    }
    await AuditEvent.create(event);
  } catch (error) {
    if (
      input.idempotencyKey &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    ) {
      return;
    }
    throw error;
  }
}
