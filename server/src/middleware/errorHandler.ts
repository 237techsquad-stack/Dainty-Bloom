import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';

import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new AppError(
      'Request validation failed',
      400,
      'VALIDATION_ERROR',
      error.issues,
    );
  } else if (error instanceof mongoose.Error.ValidationError) {
    appError = new AppError(
      'Database validation failed',
      400,
      'DATABASE_VALIDATION_ERROR',
      Object.values(error.errors).map(({ path, message }) => ({
        path,
        message,
      })),
    );
  } else if (isDuplicateKeyError(error)) {
    appError = new AppError(
      'A record with that value already exists',
      409,
      'DUPLICATE_KEY',
    );
  } else if (error instanceof mongoose.Error.CastError) {
    appError = new AppError('Invalid value supplied', 400, 'INVALID_VALUE', {
      path: error.path,
      value: error.value,
    });
  } else {
    appError = new AppError('An unexpected error occurred');
  }

  if (appError.statusCode >= 500) {
    logger.error({ err: error }, appError.message);
  } else {
    logger.warn({ err: error, code: appError.code }, appError.message);
  }

  const details =
    env.NODE_ENV === 'production' && appError.statusCode >= 500
      ? null
      : appError.details;
  res.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      details,
    },
  });
};

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
