import type { RequestHandler } from 'express';

import {
  addInternalNote,
  adminReviewArtwork,
  adminSetOrderStatus,
  cancelAdminOrder,
  completeOrder,
  dispatchOrder,
  getAdminOrder,
  getCustomerAdminDetail,
  getPrintQueue,
  listAdminOrders,
  listCustomers,
  recordOrderPayment,
  recordRefund,
  updateItemPrintStatus,
} from '../services/adminOrder.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const listOrders: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await listAdminOrders(req.query as never),
  });
});

export const orderDetail: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: { order: await getAdminOrder(req.params.id) },
  });
});

export const setStatus: RequestHandler = asyncHandler(async (req, res) => {
  const order = await adminSetOrderStatus(
    req.params.id,
    req.body.status,
    getActor(req),
    req.body.note,
  );
  res.json({
    success: true,
    data: { order: await getAdminOrder(order._id.toString()) },
  });
});

export const payment: RequestHandler = asyncHandler(async (req, res) => {
  const order = await recordOrderPayment(
    req.params.id,
    req.body,
    getActor(req),
  );
  res.json({
    success: true,
    data: { order: await getAdminOrder(order._id.toString()) },
  });
});

export const proof: RequestHandler = asyncHandler(async (req, res) => {
  const order = await adminReviewArtwork(
    req.params.id,
    req.params.itemId,
    req.body.decision,
    req.body.note,
    getActor(req),
  );
  res.json({ success: true, data: { order } });
});

export const printStatus: RequestHandler = asyncHandler(async (req, res) => {
  const order = await updateItemPrintStatus(
    req.params.id,
    req.params.itemId,
    req.body.status,
    getActor(req),
    req.body.note,
  );
  res.json({ success: true, data: { order } });
});

export const dispatch: RequestHandler = asyncHandler(async (req, res) => {
  const order = await dispatchOrder(req.params.id, req.body, getActor(req));
  res.json({
    success: true,
    data: { order: await getAdminOrder(order._id.toString()) },
  });
});

export const cancel: RequestHandler = asyncHandler(async (req, res) => {
  const order = await cancelAdminOrder(req.params.id, req.body, getActor(req));
  res.json({
    success: true,
    data: { order: await getAdminOrder(order._id.toString()) },
  });
});

export const refund: RequestHandler = asyncHandler(async (req, res) => {
  const order = await recordRefund(req.params.id, req.body, getActor(req));
  res.json({
    success: true,
    data: { order: await getAdminOrder(order._id.toString()) },
  });
});

export const complete: RequestHandler = asyncHandler(async (req, res) => {
  const order = await completeOrder(
    req.params.id,
    getActor(req),
    req.body?.note,
  );
  res.json({
    success: true,
    data: { order: await getAdminOrder(order._id.toString()) },
  });
});

export const notes: RequestHandler = asyncHandler(async (req, res) => {
  const order = await addInternalNote(
    req.params.id,
    req.body.note,
    getActor(req),
  );
  res.json({
    success: true,
    data: { order: await getAdminOrder(order._id.toString()) },
  });
});

export const printQueue: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await getPrintQueue(req.query as never),
  });
});

export const customers: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listCustomers(req.query as never) });
});

export const customerDetail: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await getCustomerAdminDetail(req.params.id),
  });
});

function getActor(req: Parameters<RequestHandler>[0]) {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  return req.user;
}
