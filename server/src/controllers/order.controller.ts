import type { RequestHandler } from 'express';

import {
  cancelCustomerOrder,
  createCustomerOrder,
  customerOrderDetail,
  getCheckoutPreview,
  getCustomerOrder,
  listCustomerOrders,
  lookupGuestOrder,
  replaceOrderArtwork,
} from '../services/order.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const preview: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getCheckoutPreview(identity(req)) });
});

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key) {
    throw new AppError(
      'Idempotency-Key header is required',
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      key,
    )
  ) {
    throw new AppError(
      'Idempotency-Key must be a UUID',
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }
  const order = await createCustomerOrder(identity(req), req.body, key);
  res.status(201).json({
    success: true,
    data: { order: await customerOrderDetail(order) },
  });
});

export const list: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  const orders = await listCustomerOrders(req.user, req.query as never);
  res.json({ success: true, data: orders });
});

export const detail: RequestHandler = asyncHandler(async (req, res) => {
  const order = await getCustomerOrder(req.params.orderNumber, {
    user: req.user,
  });
  res.json({ success: true, data: { order } });
});

export const lookup: RequestHandler = asyncHandler(async (req, res) => {
  const order = await lookupGuestOrder(req.body.orderNumber, req.body.email);
  res.json({ success: true, data: { order } });
});

export const replaceArtwork: RequestHandler = asyncHandler(async (req, res) => {
  const order = await replaceOrderArtwork(
    req.params.orderNumber,
    req.params.itemId,
    req.body.artworkId,
    {
      user: req.user,
      email: req.body.email,
      sessionId: req.guestSessionId,
    },
  );
  res.json({ success: true, data: { order } });
});

export const cancel: RequestHandler = asyncHandler(async (req, res) => {
  const order = await cancelCustomerOrder(req.params.orderNumber, {
    user: req.user,
    email: req.body?.email,
  });
  res.json({ success: true, data: { order } });
});

function identity(req: Parameters<RequestHandler>[0]) {
  if (!req.guestSessionId) {
    throw new AppError('Guest session is missing', 401, 'UNAUTHENTICATED');
  }
  return { user: req.user, sessionId: req.guestSessionId };
}
