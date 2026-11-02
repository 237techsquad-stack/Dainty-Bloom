import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  cancel,
  create,
  detail,
  list,
  lookup,
  preview,
  replaceArtwork,
} from '../controllers/order.controller';
import {
  confirmPayment,
  paymentStatus,
  startPayment,
} from '../controllers/payment.controller';
import { authenticate } from '../middleware/authenticate';
import { guestSession } from '../middleware/guestSession';
import { optionalAuth } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  checkoutPreviewSchema,
  createOrderSchema,
  customerArtworkSchema,
  orderCancelCustomerSchema,
  orderListSchema,
  orderLookupSchema,
  orderNumberSchema,
  orderPaymentConfirmSchema,
  orderPaymentStatusSchema,
  orderPaymentStartSchema,
} from '../validators/order.validators';

const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
const orderPaymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const checkoutRoutes = Router();
checkoutRoutes.use(guestSession, optionalAuth);
checkoutRoutes.get('/preview', validate(checkoutPreviewSchema), preview);

export const orderRoutes = Router();
orderRoutes.post('/lookup', lookupLimiter, validate(orderLookupSchema), lookup);
orderRoutes.use(guestSession, optionalAuth);
orderRoutes.post(
  '/:orderNumber/pay',
  orderPaymentLimiter,
  validate(orderPaymentStartSchema),
  startPayment,
);
orderRoutes.post(
  '/:orderNumber/payment/confirm',
  orderPaymentLimiter,
  validate(orderPaymentConfirmSchema),
  confirmPayment,
);
orderRoutes.get(
  '/:orderNumber/payment-status',
  orderPaymentLimiter,
  validate(orderPaymentStatusSchema),
  paymentStatus,
);
orderRoutes.post('/', validate(createOrderSchema), create);
orderRoutes.post(
  '/:orderNumber/items/:itemId/artwork',
  validate(customerArtworkSchema),
  replaceArtwork,
);
orderRoutes.post(
  '/:orderNumber/cancel',
  validate(orderCancelCustomerSchema),
  cancel,
);
orderRoutes.get('/', authenticate, validate(orderListSchema), list);
orderRoutes.get(
  '/:orderNumber',
  authenticate,
  validate(orderNumberSchema),
  detail,
);
