import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  add,
  count,
  get,
  merge,
  moveToCart,
  remove,
} from '../controllers/wishlist.controller';
import { guestSession } from '../middleware/guestSession';
import { optionalAuth } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  moveWishlistItemSchema,
  noInputSchema,
  wishlistProductIdSchema,
  wishlistProductSchema,
} from '../validators/cart.validators';

const wishlistWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const wishlistRoutes = Router();

wishlistRoutes.use(guestSession, optionalAuth);
wishlistRoutes.get('/', get);
wishlistRoutes.get('/count', count);
wishlistRoutes.post(
  '/items',
  wishlistWriteLimiter,
  validate(wishlistProductSchema),
  add,
);
wishlistRoutes.delete(
  '/items/:productId',
  wishlistWriteLimiter,
  validate(wishlistProductIdSchema),
  remove,
);
wishlistRoutes.post(
  '/move-to-cart',
  wishlistWriteLimiter,
  validate(moveWishlistItemSchema),
  moveToCart,
);
wishlistRoutes.post(
  '/merge',
  wishlistWriteLimiter,
  validate(noInputSchema),
  merge,
);
