import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  downloadLink,
  file,
  metadata,
  remove,
  preview,
  signedFile,
  upload,
} from '../controllers/artwork.controller';
import { guestSession } from '../middleware/guestSession';
import { optionalAuth } from '../middleware/authenticate';
import {
  artworkUploadLimit,
  singleMemoryUpload,
} from '../middleware/memoryUpload';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  artworkIdSchema,
  signedArtworkSchema,
} from '../validators/upload.validators';

const artworkUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const artworkRoutes = Router();

artworkRoutes.get('/signed/:token', validate(signedArtworkSchema), signedFile);
artworkRoutes.use(guestSession, optionalAuth);
artworkRoutes.post(
  '/',
  artworkUploadLimiter,
  singleMemoryUpload('file', artworkUploadLimit, 0),
  upload,
);
artworkRoutes.post(
  '/:id/download-link',
  authenticate,
  requirePermission('artwork:review'),
  validate(artworkIdSchema),
  downloadLink,
);
artworkRoutes.get('/:id/file', validate(artworkIdSchema), file);
artworkRoutes.get('/:id/preview', validate(artworkIdSchema), preview);
artworkRoutes.get('/:id', validate(artworkIdSchema), metadata);
artworkRoutes.delete('/:id', validate(artworkIdSchema), remove);
