import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  addItem,
  clear,
  get,
  merge,
  removeItem,
  summary,
  updateItem,
  validate as validateCart,
} from '../controllers/cart.controller';
import { guestSession } from '../middleware/guestSession';
import { optionalAuth } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  addCartItemSchema,
  cartItemIdSchema,
  noInputSchema,
  updateCartItemSchema,
} from '../validators/cart.validators';

const cartWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const cartRoutes = Router();

cartRoutes.use(guestSession, optionalAuth);
cartRoutes.get('/', get);
cartRoutes.get('/summary', summary);
cartRoutes.post(
  '/items',
  cartWriteLimiter,
  validate(addCartItemSchema),
  addItem,
);
cartRoutes.patch(
  '/items/:itemId',
  cartWriteLimiter,
  validate(updateCartItemSchema),
  updateItem,
);
cartRoutes.delete(
  '/items/:itemId',
  cartWriteLimiter,
  validate(cartItemIdSchema),
  removeItem,
);
cartRoutes.delete('/', cartWriteLimiter, validate(noInputSchema), clear);
cartRoutes.post('/merge', cartWriteLimiter, validate(noInputSchema), merge);
cartRoutes.post(
  '/validate',
  cartWriteLimiter,
  validate(noInputSchema),
  validateCart,
);
