import type { RequestHandler } from 'express';

import type { UserRole } from '../constants/roles';
import { AppError } from '../utils/AppError';

export function requireRole(...roles: UserRole[]): RequestHandler {
  const middleware: RequestHandler = (req, _res, next): void => {
    if (!req.user) {
      next(new AppError('Authentication required', 401, 'UNAUTHENTICATED'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
      return;
    }

    next();
  };
  return Object.assign(middleware, {
    routeProtection: { kind: 'role' as const, value: roles.join(', ') },
  });
}
