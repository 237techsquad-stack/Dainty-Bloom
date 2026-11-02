import type { RequestHandler } from 'express';

import { ROLE_PERMISSIONS, type Permission } from '../constants/permissions';
import { AppError } from '../utils/AppError';

export function requireAnyPermission(
  ...permissions: Permission[]
): RequestHandler {
  if (permissions.length === 0) {
    throw new Error('At least one permission is required');
  }

  const middleware: RequestHandler = (req, _res, next): void => {
    const user = req.user;
    if (!user) {
      next(new AppError('Authentication required', 401, 'UNAUTHENTICATED'));
      return;
    }

    if (
      !permissions.some((permission) =>
        ROLE_PERMISSIONS[user.role].includes(permission),
      )
    ) {
      next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
      return;
    }

    next();
  };

  return Object.assign(middleware, {
    routeProtection: {
      kind: 'permission' as const,
      value: permissions.join(' or '),
    },
  });
}
