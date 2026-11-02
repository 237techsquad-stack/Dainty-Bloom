import multer from 'multer';
import type { RequestHandler } from 'express';

import { env } from '../config/env';
import { SiteSettings } from '../models';
import { AppError } from '../utils/AppError';

export function singleMemoryUpload(
  fieldName: string,
  maxBytes: (req: Express.Request) => Promise<number>,
  maxFields = 10,
): RequestHandler {
  return (req, res, next): void => {
    void maxBytes(req)
      .then((limit) => {
        multer({
          storage: multer.memoryStorage(),
          limits: { fileSize: limit, files: 1, fields: maxFields },
        }).single(fieldName)(req, res, (error: unknown) => {
          if (!error) {
            next();
            return;
          }
          if (error instanceof multer.MulterError) {
            const isTooLarge = error.code === 'LIMIT_FILE_SIZE';
            next(
              new AppError(
                isTooLarge ? 'File exceeds the allowed size' : 'Invalid upload',
                isTooLarge ? 413 : 400,
                isTooLarge ? 'FILE_TOO_LARGE' : 'FILE_COUNT_INVALID',
              ),
            );
            return;
          }
          next(error);
        });
      })
      .catch(next);
  };
}

export function messageMemoryUpload(
  maxBytes: (req: Express.Request) => Promise<number>,
  maxFields = 12,
): RequestHandler {
  return (req, res, next): void => {
    void maxBytes(req)
      .then((limit) => {
        multer({
          storage: multer.memoryStorage(),
          limits: { fileSize: limit, files: 1, fields: maxFields },
        }).fields([
          { name: 'file', maxCount: 1 },
          { name: 'referenceImage', maxCount: 1 },
        ])(req, res, (error: unknown) => {
          if (error) {
            if (error instanceof multer.MulterError) {
              const isTooLarge = error.code === 'LIMIT_FILE_SIZE';
              next(
                new AppError(
                  isTooLarge ? 'File exceeds the allowed size' : 'Invalid upload',
                  isTooLarge ? 413 : 400,
                  isTooLarge ? 'FILE_TOO_LARGE' : 'FILE_COUNT_INVALID',
                ),
              );
              return;
            }
            next(error);
            return;
          }
          const files = req.files as
            | Record<string, Express.Multer.File[]>
            | undefined;
          req.file = files?.referenceImage?.[0] ?? files?.file?.[0];
          next();
        });
      })
      .catch(next);
  };
}

export async function memoryUploadLimit(): Promise<number> {
  const settings = await SiteSettings.findOne({ key: 'default' })
    .select('artworkLimits.maxBytes')
    .lean();
  const configuredLimit = settings?.artworkLimits?.maxBytes;
  return configuredLimit
    ? Math.min(configuredLimit, env.UPLOAD_MAX_BYTES)
    : env.UPLOAD_MAX_BYTES;
}

export const artworkUploadLimit = memoryUploadLimit;
