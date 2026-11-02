import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  create,
  eligibility,
  list,
  listAdmin,
  moderate,
  remove,
  removeAdmin,
  update,
} from '../controllers/review.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  adminReviewListSchema,
  createReviewSchema,
  moderateReviewSchema,
  productReviewEligibilitySchema,
  productReviewListSchema,
  reviewIdSchema,
  updateReviewSchema,
} from '../validators/review.validators';

const reviewWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const productReviewRoutes = Router();
productReviewRoutes.get(
  '/products/:idOrSlug/reviews',
  validate(productReviewListSchema),
  list,
);
productReviewRoutes.get(
  '/products/:idOrSlug/reviews/eligibility',
  authenticate,
  validate(productReviewEligibilitySchema),
  eligibility,
);
productReviewRoutes.post(
  '/products/:idOrSlug/reviews',
  authenticate,
  reviewWriteLimiter,
  validate(createReviewSchema),
  create,
);

export const reviewRoutes = Router();
reviewRoutes.patch('/:id', authenticate, validate(updateReviewSchema), update);
reviewRoutes.delete('/:id', authenticate, validate(reviewIdSchema), remove);

export const adminReviewRoutes = Router();
adminReviewRoutes.use(authenticate, requirePermission('reviews:moderate'));
adminReviewRoutes.get('/', validate(adminReviewListSchema), listAdmin);
adminReviewRoutes.patch(
  '/:id/moderate',
  validate(moderateReviewSchema),
  moderate,
);
adminReviewRoutes.delete('/:id', validate(reviewIdSchema), removeAdmin);
