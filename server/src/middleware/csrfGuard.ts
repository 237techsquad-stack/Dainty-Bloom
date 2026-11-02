import type { RequestHandler } from 'express';

import { AppError } from '../utils/AppError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfGuard: RequestHandler = (req, _res, next): void => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  if (req.get('X-Requested-With') !== 'dainty-bloom') {
    next(
      new AppError('CSRF protection header is required', 403, 'CSRF_FORBIDDEN'),
    );
    return;
  }

  next();
};
Object.assign(csrfGuard, { routeProtection: { kind: 'csrf' as const } });
