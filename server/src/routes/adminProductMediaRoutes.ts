import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  remove,
  reorder,
  update,
  upload,
} from '../controllers/adminProductMedia.controller';
import { requireCloudinary } from '../config/cloudinary';
import { env } from '../config/env';
import { singleMemoryUpload } from '../middleware/memoryUpload';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  productMediaIdSchema,
  reorderProductMediaSchema,
  updateProductMediaSchema,
  uploadProductMediaSchema,
} from '../validators/upload.validators';

const mediaWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const adminProductMediaRoutes = Router({ mergeParams: true });

adminProductMediaRoutes.post(
  '/',
  requireCloudinary,
  mediaWriteLimiter,
  requirePermission('products:write'),
  singleMemoryUpload('file', async () => env.PRODUCT_IMAGE_MAX_BYTES),
  validate(uploadProductMediaSchema),
  upload,
);
adminProductMediaRoutes.put(
  '/order',
  requireCloudinary,
  mediaWriteLimiter,
  requirePermission('products:write'),
  validate(reorderProductMediaSchema),
  reorder,
);
adminProductMediaRoutes.patch(
  '/:mediaId',
  requireCloudinary,
  mediaWriteLimiter,
  requirePermission('products:write'),
  validate(updateProductMediaSchema),
  update,
);
adminProductMediaRoutes.delete(
  '/:mediaId',
  requireCloudinary,
  mediaWriteLimiter,
  requirePermission('products:write'),
  validate(productMediaIdSchema),
  remove,
);
