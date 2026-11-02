import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  attachment,
  detail,
  list,
  remove,
  reply,
  submit,
  token,
  customerAttachment,
  customerCustomRequest,
  customerCustomRequests,
  customerCustomOfferImage,
  customerCustomOfferCheckout,
  createCustomOffer,
  adminCustomOfferImage,
  transitionCustomRequest,
  update,
} from '../controllers/message.controller';
import { genericMessageSuccess } from '../services/message.service';
import { authenticate, optionalAuth } from '../middleware/authenticate';
import {
  artworkUploadLimit,
  memoryUploadLimit,
  messageMemoryUpload,
  singleMemoryUpload,
} from '../middleware/memoryUpload';
import { requirePermission } from '../middleware/requirePermission';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import {
  createMessageSchema,
  createCustomOfferSchema,
  customRequestTransitionSchema,
  messageIdSchema,
  messageListSchema,
  messageTokenSchema,
  replyMessageSchema,
  updateMessageSchema,
} from '../validators/message.validators';
import { AppError } from '../utils/AppError';

const publicMessageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(
      new AppError(
        'Too many message requests. Please wait before trying again.',
        429,
        'RATE_LIMITED',
      ),
    );
  },
});

export const messageRoutes = Router();
messageRoutes.get(
  '/token',
  publicMessageLimiter,
  validate(messageTokenSchema),
  token,
);
messageRoutes.post(
  '/',
  publicMessageLimiter,
  optionalAuth,
  messageMemoryUpload(memoryUploadLimit, 12),
  (req, _res, next) => {
    if (
      req.body?.type === 'custom_3d_request' &&
      (!req.user || req.user.role !== 'customer')
    ) {
      next(
        new AppError(
          req.user
            ? 'A customer account is required to submit a custom request'
            : 'Sign in to submit a custom request',
          req.user ? 403 : 401,
          req.user ? 'CUSTOMER_ACCOUNT_REQUIRED' : 'UNAUTHENTICATED',
        ),
      );
      return;
    }
    next();
  },
  (req, _res, next) => {
    const files = req.files as
      Record<string, Express.Multer.File[]> | undefined;
    if (
      files?.referenceImage?.length &&
      req.body?.type !== 'custom_3d_request'
    ) {
      next(
        new AppError(
          'Images are only accepted for custom product requests',
          400,
          'REFERENCE_IMAGE_NOT_ALLOWED',
        ),
      );
      return;
    }
    next();
  },
  (req, res, next) => {
    if (typeof req.body?.website === 'string' && req.body.website.trim()) {
      res.json({ success: true, data: genericMessageSuccess() });
      return;
    }
    next();
  },
  validate(createMessageSchema),
  (req, _res, next) => {
    const imagePurposeMismatch = req.file
      ? req.body?.imagePurpose === 'no_image'
      : req.body?.imagePurpose !== undefined &&
        req.body.imagePurpose !== 'no_image';
    if (req.body?.type === 'custom_3d_request' && imagePurposeMismatch) {
      next(
        new AppError(
          'The selected image purpose does not match the uploaded image',
          400,
          'IMAGE_PURPOSE_MISMATCH',
        ),
      );
      return;
    }
    next();
  },
  submit,
);

messageRoutes.get(
  '/custom-requests',
  authenticate,
  requireRole('customer'),
  customerCustomRequests,
);
messageRoutes.get(
  '/custom-requests/:id',
  authenticate,
  requireRole('customer'),
  validate(messageIdSchema),
  customerCustomRequest,
);
messageRoutes.get(
  '/custom-requests/:id/attachment',
  authenticate,
  requireRole('customer'),
  validate(messageIdSchema),
  customerAttachment,
);
messageRoutes.get(
  '/custom-requests/:id/offer-image',
  authenticate,
  requireRole('customer'),
  validate(messageIdSchema),
  customerCustomOfferImage,
);
messageRoutes.post(
  '/custom-requests/:id/offer/checkout',
  authenticate,
  requireRole('customer'),
  validate(messageIdSchema),
  customerCustomOfferCheckout,
);

export const adminMessageRoutes = Router();
adminMessageRoutes.use(authenticate, requirePermission('messages:manage'));
adminMessageRoutes.get('/', validate(messageListSchema), list);
adminMessageRoutes.get(
  '/:id/attachment',
  validate(messageIdSchema),
  attachment,
);
adminMessageRoutes.get('/:id', validate(messageIdSchema), detail);
adminMessageRoutes.post(
  '/:id/custom-request-lifecycle',
  validate(customRequestTransitionSchema),
  transitionCustomRequest,
);
adminMessageRoutes.post(
  '/:id/custom-offer',
  requireRole('admin'),
  singleMemoryUpload('file', artworkUploadLimit, 16),
  validate(createCustomOfferSchema),
  createCustomOffer,
);
adminMessageRoutes.get(
  '/:id/custom-offer/image',
  validate(messageIdSchema),
  adminCustomOfferImage,
);
adminMessageRoutes.patch('/:id', validate(updateMessageSchema), update);
adminMessageRoutes.post('/:id/reply', validate(replyMessageSchema), reply);
adminMessageRoutes.delete(
  '/:id',
  requireRole('admin'),
  validate(messageIdSchema),
  remove,
);
