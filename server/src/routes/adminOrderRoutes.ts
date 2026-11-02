import { Router } from 'express';

import {
  cancel,
  complete,
  customerDetail,
  customers,
  dispatch,
  listOrders,
  notes,
  orderDetail,
  payment,
  printQueue,
  printStatus,
  proof,
  refund,
  setStatus,
} from '../controllers/adminOrder.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  adminOrderIdSchema,
  adminOrderListSchema,
  adminProofSchema,
  cancelAdminSchema,
  completeOrderSchema,
  customerIdSchema,
  customerListSchema,
  dispatchSchema,
  internalNoteSchema,
  paymentRecordSchema,
  printQueueSchema,
  printStatusSchema,
  refundSchema,
  statusUpdateSchema,
} from '../validators/order.validators';

export const adminOrderRoutes = Router();
adminOrderRoutes.use(authenticate);
adminOrderRoutes.get(
  '/',
  requirePermission('orders:read'),
  validate(adminOrderListSchema),
  listOrders,
);
adminOrderRoutes.get(
  '/print-queue',
  requirePermission('orders:read'),
  validate(printQueueSchema),
  printQueue,
);
adminOrderRoutes.get(
  '/:id',
  requirePermission('orders:read'),
  validate(adminOrderIdSchema),
  orderDetail,
);
adminOrderRoutes.patch(
  '/:id/status',
  requirePermission('orders:update_status'),
  validate(statusUpdateSchema),
  setStatus,
);
adminOrderRoutes.post(
  '/:id/payment',
  requirePermission('orders:update_status'),
  validate(paymentRecordSchema),
  payment,
);
adminOrderRoutes.post(
  '/:id/items/:itemId/proof',
  requirePermission('artwork:review'),
  validate(adminProofSchema),
  proof,
);
adminOrderRoutes.patch(
  '/:id/items/:itemId/print-status',
  requirePermission('orders:update_status'),
  validate(printStatusSchema),
  printStatus,
);
adminOrderRoutes.post(
  '/:id/dispatch',
  requirePermission('orders:update_status'),
  validate(dispatchSchema),
  dispatch,
);
adminOrderRoutes.post(
  '/:id/complete',
  requirePermission('orders:update_status'),
  validate(completeOrderSchema),
  complete,
);
adminOrderRoutes.post(
  '/:id/cancel',
  requirePermission('orders:update_status'),
  validate(cancelAdminSchema),
  cancel,
);
adminOrderRoutes.post(
  '/:id/refund',
  requirePermission('orders:refund'),
  validate(refundSchema),
  refund,
);
adminOrderRoutes.post(
  '/:id/notes',
  requirePermission('orders:update_status'),
  validate(internalNoteSchema),
  notes,
);

export const adminCustomerRoutes = Router();
adminCustomerRoutes.use(authenticate, requirePermission('customers:read'));
adminCustomerRoutes.get('/', validate(customerListSchema), customers);
adminCustomerRoutes.get('/:id', validate(customerIdSchema), customerDetail);
