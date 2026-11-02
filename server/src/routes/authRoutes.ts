import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  forgotPassword,
  login,
  logout,
  me,
  refresh,
  register,
  resetPasswordHandler,
  updateMe,
  updatePassword,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { guestSession } from '../middleware/guestSession';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema,
} from '../validators/auth.validators';

const authRateLimit = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req, _res, next) => {
      next(
        new AppError('Too many authentication attempts', 429, 'RATE_LIMITED'),
      );
    },
  });

export const authRoutes = Router();

authRoutes.post(
  '/register',
  authRateLimit(5),
  validate(registerSchema),
  register,
);
authRoutes.post(
  '/login',
  guestSession,
  authRateLimit(10),
  validate(loginSchema),
  login,
);
authRoutes.post('/logout', authenticate, logout);
authRoutes.post('/refresh', refresh);
authRoutes.get('/me', authenticate, me);
authRoutes.patch('/me', authenticate, validate(profileSchema), updateMe);
authRoutes.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  updatePassword,
);
authRoutes.post(
  '/forgot-password',
  authRateLimit(5),
  validate(forgotPasswordSchema),
  forgotPassword,
);
authRoutes.post(
  '/reset-password',
  authRateLimit(5),
  validate(resetPasswordSchema),
  resetPasswordHandler,
);
