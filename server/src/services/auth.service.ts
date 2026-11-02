import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';

import { env } from '../config/env';
import { User, type IAddress, type IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { logAuditEvent } from './audit.service';
import { mergeGuestCart } from './cart.service';
import { getMailer } from './mailer';
import { mergeGuestWishlist } from './wishlist.service';

const ACCESS_COOKIE = 'daintyAccessToken';
const REFRESH_COOKIE = 'daintyRefreshToken';
const ACCESS_COOKIE_PATH = '/';
const REFRESH_COOKIE_PATH = '/';
const LEGACY_ACCESS_COOKIE_PATH = '/api';
const LEGACY_REFRESH_COOKIE_PATH = '/api/auth/refresh';
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: IUser['role'];
  accountState: IUser['accountState'];
  phone?: string;
  addresses: IAddress[];
  emailVerified: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafeUser(user: IUser): SafeUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    accountState: user.accountState,
    phone: user.phone,
    addresses: user.addresses,
    emailVerified: user.emailVerified,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function setAuthCookies(res: Response, user: IUser): void {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(LEGACY_ACCESS_COOKIE_PATH));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(LEGACY_REFRESH_COOKIE_PATH));
  const payload = { sub: user._id.toString(), ver: user.tokenVersion };
  const accessToken = jwt.sign(
    { ...payload, typ: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'] },
  );
  const refreshToken = jwt.sign(
    { ...payload, typ: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.REFRESH_TOKEN_TTL as SignOptions['expiresIn'] },
  );

  res.cookie(ACCESS_COOKIE, accessToken, {
    ...cookieOptions(ACCESS_COOKIE_PATH),
    maxAge: durationToMs(env.ACCESS_TOKEN_TTL),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieOptions(REFRESH_COOKIE_PATH),
    maxAge: durationToMs(env.REFRESH_TOKEN_TTL),
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(ACCESS_COOKIE_PATH));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(REFRESH_COOKIE_PATH));
  res.clearCookie(ACCESS_COOKIE, cookieOptions(LEGACY_ACCESS_COOKIE_PATH));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(LEGACY_REFRESH_COOKIE_PATH));
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<IUser> {
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);
  return User.create({
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash,
    role: 'customer',
  });
}

export async function loginUser(
  email: string,
  password: string,
  ip?: string,
  guestSessionId?: string,
  portal: 'customer' | 'admin' = 'customer',
): Promise<IUser> {
  const normalizedEmail = email.toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select(
    '+passwordHash +failedLoginAttempts +lockUntil',
  );

  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    await logAuditEvent({
      action: 'login.failure',
      actorRole: 'unknown',
      targetType: 'User',
      targetId: 'unknown',
      metadata: { reason: 'invalid_credentials' },
      ip,
    });
    throw invalidLoginError();
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  const isLocked = Boolean(
    user.lockUntil && user.lockUntil.getTime() > Date.now(),
  );

  const deniedPortal =
    (portal === 'admin' && user.role === 'customer') ||
    (portal === 'customer' && user.role !== 'customer');
  if (
    user.accountState !== 'active' ||
    isLocked ||
    !passwordMatches ||
    deniedPortal
  ) {
    if (!isLocked && user.accountState === 'active') {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + LOGIN_LOCKOUT_MS);
      }
      await user.save();
    }

    await logAuditEvent({
      actor: user,
      action: deniedPortal
        ? portal === 'admin'
          ? 'auth.admin_portal_denied'
          : 'auth.customer_portal_denied'
        : isLocked
          ? 'login.lockout'
          : 'login.failure',
      targetType: 'User',
      targetId: user._id.toString(),
      metadata: {
        reason: isLocked
          ? 'account_locked'
          : deniedPortal
            ? portal === 'admin'
              ? 'admin_portal_denied'
              : 'customer_portal_denied'
            : user.accountState !== 'active'
              ? 'account_suspended'
              : 'invalid_credentials',
      },
      ip,
    });
    throw invalidLoginError();
  }

  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  await logAuditEvent({
    actor: user,
    action: 'login.success',
    targetType: 'User',
    targetId: user._id.toString(),
    ip,
  });

  await mergeGuestCart(user, guestSessionId);
  await mergeGuestWishlist(user, guestSessionId);
  return user;
}

export async function logoutUser(user: IUser, ip?: string): Promise<void> {
  user.tokenVersion += 1;
  await user.save();
  await logAuditEvent({
    actor: user,
    action: 'logout',
    targetType: 'User',
    targetId: user._id.toString(),
    ip,
  });
}

export async function rotateRefreshToken(token: string): Promise<IUser> {
  const payload = verifyRefreshToken(token);
  const user = await User.findOneAndUpdate(
    {
      _id: payload.sub,
      tokenVersion: payload.ver,
      accountState: 'active',
    },
    { $inc: { tokenVersion: 1 } },
    { new: true },
  );

  if (!user) {
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  }
  return user;
}

export async function updateProfile(
  userId: string,
  updates: { name?: string; phone?: string; addresses?: IAddress[] },
): Promise<IUser> {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: updates },
    { new: true, runValidators: true },
  );
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  return user;
}

export async function changePassword(
  user: IUser,
  currentPassword: string,
  newPassword: string,
  ip?: string,
): Promise<IUser> {
  const userWithPassword = await User.findById(user._id).select(
    '+passwordHash',
  );
  if (!userWithPassword) {
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  }
  if (!(await bcrypt.compare(currentPassword, userWithPassword.passwordHash))) {
    throw new AppError(
      'Current password is incorrect',
      400,
      'INVALID_CURRENT_PASSWORD',
    );
  }

  userWithPassword.passwordHash = await bcrypt.hash(
    newPassword,
    env.BCRYPT_COST,
  );
  userWithPassword.tokenVersion += 1;
  userWithPassword.failedLoginAttempts = 0;
  userWithPassword.lockUntil = undefined;
  await userWithPassword.save();

  await logAuditEvent({
    actor: userWithPassword,
    action: 'password.change',
    targetType: 'User',
    targetId: userWithPassword._id.toString(),
    ip,
  });

  return userWithPassword;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return;

  const resetToken = randomBytes(32).toString('hex');
  const passwordResetTokenHash = hashResetToken(resetToken);
  const passwordResetExpiresAt = new Date(
    Date.now() + durationToMs(env.PASSWORD_RESET_TTL),
  );

  user.passwordResetTokenHash = passwordResetTokenHash;
  user.passwordResetExpiresAt = passwordResetExpiresAt;
  await user.save();

  const resetLink = new URL('/reset-password', env.CLIENT_URL);
  resetLink.searchParams.set('token', resetToken);
  await getMailer().sendPasswordReset({
    to: user.email,
    name: user.name,
    resetLink: resetLink.toString(),
  });
}

export async function resetPassword(
  resetToken: string,
  newPassword: string,
  ip?: string,
): Promise<void> {
  const passwordResetTokenHash = hashResetToken(resetToken);
  const user = await User.findOneAndUpdate(
    {
      passwordResetTokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    },
    {
      $set: {
        passwordHash: await bcrypt.hash(newPassword, env.BCRYPT_COST),
        failedLoginAttempts: 0,
      },
      $inc: { tokenVersion: 1 },
      $unset: {
        passwordResetTokenHash: 1,
        passwordResetExpiresAt: 1,
        lockUntil: 1,
      },
    },
    { new: true },
  );

  if (!user) {
    throw new AppError(
      'Reset token is invalid or expired',
      400,
      'INVALID_RESET_TOKEN',
    );
  }

  await logAuditEvent({
    actor: user,
    action: 'password.reset',
    targetType: 'User',
    targetId: user._id.toString(),
    ip,
  });
}

function verifyRefreshToken(token: string): { sub: string; ver: number } {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
  } catch {
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  }

  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    !Number.isInteger(decoded.ver) ||
    decoded.typ !== 'refresh'
  ) {
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  }
  return { sub: decoded.sub, ver: decoded.ver as number };
}

function invalidLoginError(): AppError {
  return new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions(path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production' || env.COOKIE_SAMESITE === 'none',
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN,
    path,
  };
}

function durationToMs(duration: string): number {
  const match = /^(\d+)(s|m|h|d|w)$/.exec(duration);
  if (!match) {
    throw new Error(`Unsupported duration format: ${duration}`);
  }

  const count = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return count * multipliers[unit];
}

const DUMMY_PASSWORD_HASH =
  '$2a$12$2b2Y8C9kZ4KzZ7Vb0QjWYuF2sOWW4d7k0Qn0pQ6YtCkPe7bL1C9em';
