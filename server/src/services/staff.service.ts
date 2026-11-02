import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';

import { env } from '../config/env';
import { AuditEvent, StaffControl, User } from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { logAuditEvent } from './audit.service';
import { requestPasswordReset } from './auth.service';

export async function listStaff(page: number, limit: number) {
  const filter = { role: { $ne: 'customer' as const } };
  const [items, total] = await Promise.all([
    User.find(filter)
      .select(
        'name email role accountState emailVerified lastLoginAt createdAt updatedAt',
      )
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return {
    items: items.map((user) => ({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      accountState: user.accountState,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })),
    pagination: pagination(page, limit, total),
  };
}

export async function createStaff(
  input: {
    name: string;
    email: string;
    role: 'production' | 'support' | 'admin';
  },
  actor: IUser,
) {
  const email = input.email.toLowerCase();
  if (await User.exists({ email })) {
    throw new AppError(
      'A user with this email already exists',
      409,
      'DUPLICATE_KEY',
    );
  }
  if (input.role === 'admin') await ensureAdminCount();
  const passwordHash = await bcrypt.hash(cryptoPassword(), env.BCRYPT_COST);
  const user = await User.create({
    name: input.name,
    email,
    passwordHash,
    role: input.role,
    accountState: 'active',
    emailVerified: false,
  });
  if (input.role === 'admin') {
    await StaffControl.updateOne(
      { _id: ADMIN_CONTROL_ID },
      { $inc: { activeAdminCount: 1 } },
    );
  }
  try {
    await requestPasswordReset(user.email);
  } catch (error) {
    await user.deleteOne();
    if (input.role === 'admin') {
      await StaffControl.updateOne(
        { _id: ADMIN_CONTROL_ID },
        { $inc: { activeAdminCount: -1 } },
      );
    }
    throw error;
  }
  await logAuditEvent({
    actor,
    action: 'staff.created',
    targetType: 'User',
    targetId: user._id.toString(),
    metadata: { role: user.role },
  });
  return safeStaff(user);
}

export async function updateStaff(
  id: string,
  input: {
    role?: 'production' | 'support' | 'admin';
    accountState?: 'active' | 'suspended';
  },
  actor: IUser,
) {
  const target = await User.findOne({ _id: id, role: { $ne: 'customer' } });
  if (!target)
    throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');
  const roleChanges = input.role !== undefined && input.role !== target.role;
  const suspending =
    input.accountState === 'suspended' && target.accountState !== 'suspended';
  if (target._id.equals(actor._id) && (roleChanges || suspending)) {
    throw new AppError(
      'You cannot demote or suspend your own account',
      409,
      'SELF_STAFF_CHANGE_FORBIDDEN',
    );
  }
  const removingActiveAdmin =
    target.role === 'admin' &&
    target.accountState === 'active' &&
    ((input.role !== undefined && input.role !== 'admin') ||
      input.accountState === 'suspended');
  const nextRole = input.role ?? target.role;
  const nextState = input.accountState ?? target.accountState;
  const addingActiveAdmin =
    nextRole === 'admin' &&
    nextState === 'active' &&
    !(target.role === 'admin' && target.accountState === 'active');
  if (removingActiveAdmin) {
    await ensureAdminCount();
    const reserved = await StaffControl.findOneAndUpdate(
      { _id: ADMIN_CONTROL_ID, activeAdminCount: { $gt: 1 } },
      { $inc: { activeAdminCount: -1 } },
      { new: true },
    );
    if (!reserved) {
      throw new AppError(
        'The last active admin cannot be removed',
        409,
        'LAST_ACTIVE_ADMIN',
      );
    }
  }
  if (addingActiveAdmin) await ensureAdminCount();
  const stateChanges =
    input.accountState !== undefined &&
    input.accountState !== target.accountState;
  if (roleChanges) target.role = input.role!;
  if (input.accountState !== undefined)
    target.accountState = input.accountState;
  if (roleChanges || stateChanges) target.tokenVersion += 1;
  try {
    await target.save();
  } catch (error) {
    if (removingActiveAdmin) {
      await StaffControl.updateOne(
        { _id: ADMIN_CONTROL_ID },
        { $inc: { activeAdminCount: 1 } },
      );
    }
    throw error;
  }
  if (addingActiveAdmin) {
    await StaffControl.updateOne(
      { _id: ADMIN_CONTROL_ID },
      { $inc: { activeAdminCount: 1 } },
    );
  }
  await logAuditEvent({
    actor,
    action: 'staff.updated',
    targetType: 'User',
    targetId: target._id.toString(),
    metadata: { changedFields: Object.keys(input) },
  });
  return safeStaff(target);
}

export async function listAuditEvents(query: {
  page: number;
  limit: number;
  actor?: string;
  action?: string;
  targetType?: string;
  from?: Date;
  to?: Date;
}) {
  const match: Record<string, unknown> = {};
  if (query.actor) match.actor = new Types.ObjectId(query.actor);
  if (query.action)
    match.action = { $regex: escapeRegex(query.action), $options: 'i' };
  if (query.targetType)
    match.targetType = { $regex: escapeRegex(query.targetType), $options: 'i' };
  if (query.from || query.to) {
    match.createdAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }
  const [items, total] = await Promise.all([
    AuditEvent.find(match)
      .select(
        'actor actorRole action targetType targetId metadata ip createdAt',
      )
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .populate({ path: 'actor', select: 'name email' })
      .lean(),
    AuditEvent.countDocuments(match),
  ]);
  const totalPages = Math.ceil(total / query.limit);
  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
    },
  };
}

function safeStaff(user: IUser) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    accountState: user.accountState,
    emailVerified: user.emailVerified,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function cryptoPassword(): string {
  return randomBytes(48).toString('base64url');
}

function pagination(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit);
  return { page, limit, total, totalPages, hasNextPage: page < totalPages };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ADMIN_CONTROL_ID = 'active_admin_count';

async function ensureAdminCount(): Promise<void> {
  if (await StaffControl.exists({ _id: ADMIN_CONTROL_ID })) return;
  const activeAdminCount = await User.countDocuments({
    role: 'admin',
    accountState: 'active',
  });
  try {
    await StaffControl.create({ _id: ADMIN_CONTROL_ID, activeAdminCount });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
