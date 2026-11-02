import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  adminFaqs,
  auditList,
  faqCreate,
  faqDelete,
  faqUpdate,
  newsletterSubscribe,
  newsletterUnsubscribe,
  staffCreate,
  staffList,
  staffUpdate,
  subscribers,
} from '../controllers/adminOperations.controller';
import { faqs } from '../controllers/adminOperations.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  auditListSchema,
  createStaffSchema,
  faqCreateSchema,
  faqIdSchema,
  faqListSchema,
  faqUpdateSchema,
  newsletterSubscribeSchema,
  newsletterUnsubscribeSchema,
  staffListSchema,
  subscriberListSchema,
  updateStaffSchema,
} from '../validators/adminFeature.validators';

const newsletterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const publicFaqRoutes = Router();
publicFaqRoutes.get('/', validate(faqListSchema), faqs);

export const adminFaqRoutes = Router();
adminFaqRoutes.use(authenticate, requirePermission('settings:write'));
adminFaqRoutes.get('/', validate(faqListSchema), adminFaqs);
adminFaqRoutes.post('/', validate(faqCreateSchema), faqCreate);
adminFaqRoutes.patch('/:id', validate(faqUpdateSchema), faqUpdate);
adminFaqRoutes.delete('/:id', validate(faqIdSchema), faqDelete);

export const newsletterRoutes = Router();
newsletterRoutes.post(
  '/subscribe',
  newsletterLimiter,
  validate(newsletterSubscribeSchema),
  newsletterSubscribe,
);
newsletterRoutes.get(
  '/unsubscribe',
  newsletterLimiter,
  validate(newsletterUnsubscribeSchema),
  newsletterUnsubscribe,
);

export const adminStaffRoutes = Router();
adminStaffRoutes.use(authenticate, requirePermission('staff:manage'));
adminStaffRoutes.get('/', validate(staffListSchema), staffList);
adminStaffRoutes.post('/', validate(createStaffSchema), staffCreate);
adminStaffRoutes.patch('/:id', validate(updateStaffSchema), staffUpdate);

export const adminAuditRoutes = Router();
adminAuditRoutes.use(authenticate, requirePermission('audit:read'));
adminAuditRoutes.get('/', validate(auditListSchema), auditList);

export const adminSubscriberRoutes = Router();
adminSubscriberRoutes.use(authenticate, requirePermission('customers:read'));
adminSubscriberRoutes.get('/', validate(subscriberListSchema), subscribers);
