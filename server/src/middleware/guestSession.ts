import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export const GUEST_SESSION_COOKIE = 'guestSessionId';

export const guestSession: RequestHandler = (req, res, next): void => {
  if (req.body?.portal === 'admin') {
    next();
    return;
  }

  const existing = req.signedCookies?.[GUEST_SESSION_COOKIE] as
    string | false | undefined;
  const sessionId = typeof existing === 'string' ? existing : randomUUID();

  req.guestSessionId = sessionId;

  if (existing !== sessionId) {
    res.cookie(GUEST_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production' || env.COOKIE_SAMESITE === 'none',
      sameSite: env.COOKIE_SAMESITE,
      domain: env.COOKIE_DOMAIN,
      signed: true,
      path: '/api',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  if (!req.signedCookies) {
    next(
      new AppError(
        'Cookie parsing is required',
        500,
        'COOKIE_CONFIGURATION_ERROR',
      ),
    );
    return;
  }

  next();
};
