import { Router } from 'express';

import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { adminCategoryRoutes } from './adminCategoryRoutes';
import { adminProductRoutes } from './adminProductRoutes';
import { adminArtworkRoutes } from './adminArtworkRoutes';
import { adminSettingsRoutes } from './settingsRoutes';
import { adminOrderRoutes, adminCustomerRoutes } from './adminOrderRoutes';
import { adminMessageRoutes } from './messageRoutes';
import { adminReviewRoutes } from './reviewRoutes';
import {
  adminAuditRoutes,
  adminFaqRoutes,
  adminStaffRoutes,
  adminSubscriberRoutes,
} from './adminOperationsRoutes';
import { adminInsightsRoutes } from './adminInsightsRoutes';
import { adminAboutMediaRoutes } from './adminAboutMediaRoutes';

export const adminRoutes = Router();

adminRoutes.get(
  '/ping',
  authenticate,
  requirePermission('analytics:read'),
  (_req, res) => {
    res.json({ success: true, data: { message: 'pong' } });
  },
);

adminRoutes.use('/products', adminProductRoutes);
adminRoutes.use('/about-media', adminAboutMediaRoutes);
adminRoutes.use('/categories', adminCategoryRoutes);
adminRoutes.use('/artwork', adminArtworkRoutes);
adminRoutes.use('/settings', adminSettingsRoutes);
adminRoutes.use('/orders', adminOrderRoutes);
adminRoutes.use('/customers', adminCustomerRoutes);
adminRoutes.use('/messages', adminMessageRoutes);
adminRoutes.use('/reviews', adminReviewRoutes);
adminRoutes.use('/staff', adminStaffRoutes);
adminRoutes.use('/audit', adminAuditRoutes);
adminRoutes.use('/faqs', adminFaqRoutes);
adminRoutes.use('/subscribers', adminSubscriberRoutes);
adminRoutes.use('/', adminInsightsRoutes);
