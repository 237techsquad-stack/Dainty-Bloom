import type { RequestHandler } from 'express';

import {
  addToWishlist,
  getWishlist,
  getWishlistCount,
  mergeGuestWishlist,
  moveWishlistItemToCart,
  removeFromWishlist,
} from '../services/wishlist.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const get: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getWishlist(identity(req)) });
});

export const add: RequestHandler = asyncHandler(async (req, res) => {
  await addToWishlist(identity(req), req.body.productId);
  res
    .status(201)
    .json({ success: true, data: await getWishlist(identity(req)) });
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  await removeFromWishlist(identity(req), req.params.productId);
  res.json({ success: true, data: await getWishlist(identity(req)) });
});

export const count: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: { count: await getWishlistCount(identity(req)) },
  });
});

export const moveToCart: RequestHandler = asyncHandler(async (req, res) => {
  await moveWishlistItemToCart(identity(req), req.body);
  res.json({ success: true, data: await getWishlist(identity(req)) });
});

export const merge: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AppError(
      'Sign in to merge a guest wishlist',
      401,
      'UNAUTHENTICATED',
    );
  }
  await mergeGuestWishlist(req.user, req.guestSessionId);
  res.json({ success: true, data: await getWishlist({ user: req.user }) });
});

function identity(req: Parameters<RequestHandler>[0]) {
  if (req.user) return { user: req.user };
  if (req.guestSessionId) return { sessionId: req.guestSessionId };
  throw new AppError('Wishlist identity is missing', 401, 'UNAUTHENTICATED');
}
