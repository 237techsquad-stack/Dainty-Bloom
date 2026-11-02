import { v2 as cloudinary } from 'cloudinary';
import type { RequestHandler } from 'express';

import { env } from './env';
import { AppError } from '../utils/AppError';

const configured = Boolean(
  env.CLOUDINARY_URL ||
  (env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET),
);
let initialized = false;

export function getCloudinary() {
  if (!configured) {
    throw new AppError(
      'Cloudinary storage is not configured',
      503,
      'CLOUDINARY_NOT_CONFIGURED',
    );
  }
  if (!initialized) {
    if (env.CLOUDINARY_URL) {
      cloudinary.config();
    } else {
      cloudinary.config({
        cloud_name: env.CLOUDINARY_CLOUD_NAME,
        api_key: env.CLOUDINARY_API_KEY,
        api_secret: env.CLOUDINARY_API_SECRET,
      });
    }
    initialized = true;
  }
  return cloudinary;
}

export function isCloudinaryConfigured(): boolean {
  return configured;
}

export const requireCloudinary: RequestHandler = (_req, _res, next): void => {
  try {
    getCloudinary();
    next();
  } catch (error) {
    next(error);
  }
};
