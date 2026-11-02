import { Router } from 'express';

import { getAdminAboutMedia } from '../controllers/aboutMedia.controller';
import {
  deleteAdminAboutMedia,
  reorderAdminAboutMedia,
  updateAdminAboutMedia,
  uploadAdminAboutMedia,
} from '../controllers/aboutMedia.controller';
import { requireCloudinary } from '../config/cloudinary';
import { env } from '../config/env';
import { authenticate } from '../middleware/authenticate';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';
import { singleMemoryUpload } from '../middleware/memoryUpload';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  aboutMediaIdSchema,
  reorderAboutMediaSchema,
  updateAboutMediaSchema,
  uploadAboutMediaSchema,
} from '../validators/aboutMedia.validators';

export const adminAboutMediaRoutes = Router();

adminAboutMediaRoutes.use(authenticate, requirePermission('media:manage'));
const aboutMediaWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
adminAboutMediaRoutes.get('/', getAdminAboutMedia);
adminAboutMediaRoutes.post(
  '/',
  requireCloudinary,
  aboutMediaWriteLimiter,
  singleMemoryUpload('file', async () => env.UPLOAD_MAX_BYTES),
  validate(uploadAboutMediaSchema),
  uploadAdminAboutMedia,
);
adminAboutMediaRoutes.put(
  '/order',
  aboutMediaWriteLimiter,
  validate(reorderAboutMediaSchema),
  reorderAdminAboutMedia,
);
adminAboutMediaRoutes.patch(
  '/:id',
  aboutMediaWriteLimiter,
  validate(updateAboutMediaSchema),
  updateAdminAboutMedia,
);
adminAboutMediaRoutes.delete(
  '/:id',
  requireCloudinary,
  aboutMediaWriteLimiter,
  validate(aboutMediaIdSchema),
  deleteAdminAboutMedia,
);
