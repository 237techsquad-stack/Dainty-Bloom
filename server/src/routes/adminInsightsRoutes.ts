import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  customers,
  dashboard,
  notifications,
  production,
  products,
  sales,
  search,
} from '../controllers/adminInsights.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { requireAnyPermission } from '../middleware/requireAnyPermission';
import { validate } from '../middleware/validate';
import {
  adminSearchSchema,
  analyticsCustomersSchema,
  analyticsSalesSchema,
  dashboardSchema,
} from '../validators/adminFeature.validators';

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const adminInsightsRoutes = Router();
adminInsightsRoutes.use(authenticate);
adminInsightsRoutes.get(
  '/dashboard',
  requirePermission('analytics:read'),
  validate(dashboardSchema),
  dashboard,
);
adminInsightsRoutes.get(
  '/analytics/sales',
  requirePermission('analytics:read'),
  validate(analyticsSalesSchema),
  sales,
);
adminInsightsRoutes.get(
  '/analytics/products',
  requirePermission('analytics:read'),
  products,
);
adminInsightsRoutes.get(
  '/analytics/customers',
  requirePermission('analytics:read'),
  validate(analyticsCustomersSchema),
  customers,
);
adminInsightsRoutes.get(
  '/analytics/production',
  requirePermission('analytics:read'),
  production,
);
adminInsightsRoutes.get(
  '/notifications',
  requirePermission('analytics:read'),
  notifications,
);
adminInsightsRoutes.get(
  '/search',
  requireAnyPermission(
    'orders:read',
    'products:read',
    'customers:read',
    'messages:manage',
  ),
  searchLimiter,
  validate(adminSearchSchema),
  search,
);
