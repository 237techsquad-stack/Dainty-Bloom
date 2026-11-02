import type { RequestHandler } from 'express';

import {
  getAdminDashboard,
  getCustomerAnalytics,
  getProductionAnalytics,
  getProductAnalytics,
  getSalesAnalytics,
  validateTimezone,
} from '../services/adminAnalytics.service';
import {
  getAdminNotifications,
  searchAdminData,
} from '../services/adminInsights.service';
import { ROLE_PERMISSIONS } from '../constants/permissions';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import {
  analyticsCustomersSchema,
  analyticsSalesSchema,
  dashboardSchema,
} from '../validators/adminFeature.validators';

export const dashboard: RequestHandler = asyncHandler(async (req, res) => {
  const query = dashboardSchema.shape.query.parse(req.query);
  const timezone = query.tz ?? 'UTC';
  validateTimezone(timezone);
  res.json({
    success: true,
    data: await getAdminDashboard(query.range, timezone),
  });
});

export const sales: RequestHandler = asyncHandler(async (req, res) => {
  const query = analyticsSalesSchema.shape.query.parse(req.query);
  res.json({
    success: true,
    data: await getSalesAnalytics(query.from, query.to, query.groupBy),
  });
});

export const products: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getProductAnalytics() });
});

export const customers: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  const includePii = ROLE_PERMISSIONS[req.user.role].includes('customers:read');
  const query = analyticsCustomersSchema.shape.query.parse(req.query);
  res.json({
    success: true,
    data: await getCustomerAnalytics({
      ...query,
      includePii,
    }),
  });
});

export const production: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getProductionAnalytics() });
});

export const notifications: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getAdminNotifications() });
});

export const search: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  res.json({
    success: true,
    data: await searchAdminData(String(req.query.q), req.user),
  });
});
