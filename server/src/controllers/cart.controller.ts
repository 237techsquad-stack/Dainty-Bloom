import type { RequestHandler } from 'express';

import {
  getCartSummary,
  getCart,
  addCartItem,
  clearCart,
  mergeGuestCart,
  removeCartItem,
  updateCartItem,
  validateCurrentCart,
} from '../services/cart.service';
import { getWishlistCount } from '../services/wishlist.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const get: RequestHandler = asyncHandler(async (req, res) => {
  const cart = await getCart(identity(req));
  res.json({ success: true, data: cart });
});

export const summary: RequestHandler = asyncHandler(async (req, res) => {
  const cartIdentity = identity(req);
  const [cart, wishlistCount] = await Promise.all([
    getCartSummary(cartIdentity),
    getWishlistCount(cartIdentity),
  ]);
  res.json({
    success: true,
    data: { ...cart, wishlistCount },
  });
});

export const addItem: RequestHandler = asyncHandler(async (req, res) => {
  await addCartItem(identity(req), req.body);
  res.status(201).json({ success: true, data: await getCart(identity(req)) });
});

export const updateItem: RequestHandler = asyncHandler(async (req, res) => {
  await updateCartItem(identity(req), req.params.itemId, req.body);
  res.json({ success: true, data: await getCart(identity(req)) });
});

export const removeItem: RequestHandler = asyncHandler(async (req, res) => {
  await removeCartItem(identity(req), req.params.itemId);
  res.json({ success: true, data: await getCart(identity(req)) });
});

export const clear: RequestHandler = asyncHandler(async (req, res) => {
  await clearCart(identity(req));
  res.json({ success: true, data: await getCart(identity(req)) });
});

export const validate: RequestHandler = asyncHandler(async (req, res) => {
  const validation = await validateCurrentCart(identity(req));
  res.json({ success: true, data: validation });
});

export const merge: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AppError('Sign in to merge a guest cart', 401, 'UNAUTHENTICATED');
  }
  await mergeGuestCart(req.user, req.guestSessionId);
  res.json({ success: true, data: await getCart({ user: req.user }) });
});

function identity(req: Parameters<RequestHandler>[0]) {
  if (req.user) return { user: req.user };
  if (req.guestSessionId) return { sessionId: req.guestSessionId };
  throw new AppError('Cart identity is missing', 401, 'UNAUTHENTICATED');
}
