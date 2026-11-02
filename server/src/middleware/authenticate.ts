import type { RequestHandler } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import mongoose from 'mongoose';

import { env } from '../config/env';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const ACCESS_COOKIE = 'daintyAccessToken';

interface AuthTokenPayload extends JwtPayload {
  sub: string;
  ver: number;
  typ: 'access' | 'refresh';
}

export function verifyAuthToken(
  token: string,
  expectedType: AuthTokenPayload['typ'],
): AuthTokenPayload {
  let decoded: string | JwtPayload;

  try {
    decoded = jwt.verify(
      token,
      expectedType === 'access'
        ? env.JWT_ACCESS_SECRET
        : env.JWT_REFRESH_SECRET,
    );
  } catch {
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  }

  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    !Number.isInteger(decoded.ver) ||
    decoded.typ !== expectedType
  ) {
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  }

  return decoded as AuthTokenPayload;
}

const loadAuthenticatedUser: RequestHandler = asyncHandler(
  async (req, _res, next): Promise<void> => {
    const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
    if (!token) {
      throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
    }

    const payload = verifyAuthToken(token, 'access');
    if (!mongoose.isValidObjectId(payload.sub)) {
      throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
    }

    const user = await User.findById(payload.sub);
    if (
      !user ||
      user.accountState !== 'active' ||
      user.tokenVersion !== payload.ver
    ) {
      throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
    }

    req.user = user;
    next();
  },
);

export const authenticate: RequestHandler = loadAuthenticatedUser;
Object.assign(authenticate, {
  routeProtection: { kind: 'auth' as const, value: 'authenticate' },
});

export const optionalAuth: RequestHandler = asyncHandler(
  async (req, _res, next): Promise<void> => {
    const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
    if (!token) {
      next();
      return;
    }

    const payload = verifyAuthToken(token, 'access');
    if (mongoose.isValidObjectId(payload.sub)) {
      const user = await User.findById(payload.sub);
      if (
        user &&
        user.accountState === 'active' &&
        user.tokenVersion === payload.ver
      ) {
        req.user = user;
      }
    }

    next();
  },
);
Object.assign(optionalAuth, {
  routeProtection: { kind: 'auth' as const, value: 'optionalAuth' },
});
