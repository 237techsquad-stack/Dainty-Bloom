import { Router } from 'express';

import {
  bulkStatus,
  create,
  getProduct,
  listProducts,
  remove,
  update,
  updateStatus,
  updateStock,
} from '../controllers/adminProduct.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import { adminProductMediaRoutes } from './adminProductMediaRoutes';
import {
  adminProductListSchema,
  bulkStatusSchema,
  createProductSchema,
  deleteProductSchema,
  productIdSchema,
  statusSchema,
  stockSchema,
  updateProductSchema,
} from '../validators/catalog.validators';

export const adminProductRoutes = Router();

adminProductRoutes.use(authenticate);
adminProductRoutes.get(
  '/',
  requirePermission('products:read'),
  validate(adminProductListSchema),
  listProducts,
);
adminProductRoutes.get(
  '/:id',
  requirePermission('products:read'),
  validate(productIdSchema),
  getProduct,
);
adminProductRoutes.post(
  '/',
  requirePermission('products:write'),
  validate(createProductSchema),
  create,
);
adminProductRoutes.post(
  '/bulk-status',
  requirePermission('products:write'),
  validate(bulkStatusSchema),
  bulkStatus,
);
adminProductRoutes.patch(
  '/:id',
  requirePermission('products:write'),
  validate(updateProductSchema),
  update,
);
adminProductRoutes.patch(
  '/:id/status',
  requirePermission('products:write'),
  validate(statusSchema),
  updateStatus,
);
adminProductRoutes.patch(
  '/:id/stock',
  requirePermission('products:write'),
  validate(stockSchema),
  updateStock,
);
adminProductRoutes.delete(
  '/:id',
  requirePermission('products:write'),
  validate(deleteProductSchema),
  remove,
);
adminProductRoutes.use('/:id/media', adminProductMediaRoutes);
