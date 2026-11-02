import type { RequestHandler } from 'express';

import { ROLE_PERMISSIONS, type Permission } from '../constants/permissions';
import { AppError } from '../utils/AppError';

export function requirePermission(permission: Permission): RequestHandler {
  const middleware: RequestHandler = (req, _res, next): void => {
    if (!req.user) {
      next(new AppError('Authentication required', 401, 'UNAUTHENTICATED'));
      return;
    }

    if (!ROLE_PERMISSIONS[req.user.role].includes(permission)) {
      next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
      return;
    }

    next();
  };
  return Object.assign(middleware, {
    routeProtection: { kind: 'permission' as const, value: permission },
  });
}
