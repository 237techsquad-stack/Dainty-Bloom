import type { RequestHandler } from 'express';
import { z } from 'zod';

import { AppError } from '../utils/AppError';

export function validate<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
): RequestHandler {
  return (req, _res, next): void => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      next(
        new AppError(
          'Request validation failed',
          400,
          'VALIDATION_ERROR',
          result.error.issues,
        ),
      );
      return;
    }

    Object.assign(req, result.data);
    next();
  };
}
