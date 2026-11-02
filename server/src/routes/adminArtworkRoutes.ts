import { Router } from 'express';

import { detail, list, review } from '../controllers/adminArtwork.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  artworkIdSchema,
  artworkListSchema,
  artworkReviewSchema,
} from '../validators/upload.validators';

export const adminArtworkRoutes = Router();

adminArtworkRoutes.use(authenticate, requirePermission('artwork:review'));
adminArtworkRoutes.get('/', validate(artworkListSchema), list);
adminArtworkRoutes.get('/:id', validate(artworkIdSchema), detail);
adminArtworkRoutes.patch('/:id/review', validate(artworkReviewSchema), review);
