import type { RequestHandler } from 'express';

import {
  createProductReview,
  deleteAdminReview,
  deleteOwnedReview,
  getReviewEligibility,
  listAdminReviews,
  listProductReviews,
  moderateReview,
  updateOwnedReview,
} from '../services/review.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const list: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await listProductReviews(req.params.idOrSlug, req.query as never),
  });
});

export const eligibility: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await getReviewEligibility(req.params.idOrSlug, getActor(req)),
  });
});

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const data = await createProductReview(
    req.params.idOrSlug,
    req.body,
    getActor(req),
  );
  res.status(201).json({ success: true, data });
});

export const update: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await updateOwnedReview(req.params.id, req.body, getActor(req)),
  });
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  await deleteOwnedReview(req.params.id, getActor(req));
  res.json({ success: true, data: { deleted: true } });
});

export const listAdmin: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listAdminReviews(req.query as never) });
});

export const moderate: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await moderateReview(
      req.params.id,
      req.body.decision,
      req.body.reason,
      getActor(req),
    ),
  });
});

export const removeAdmin: RequestHandler = asyncHandler(async (req, res) => {
  const actor = getActor(req);
  if (actor.role !== 'admin') {
    throw new AppError('Admin role required', 403, 'FORBIDDEN');
  }
  await deleteAdminReview(req.params.id, actor);
  res.json({ success: true, data: { deleted: true } });
});

function getActor(req: Parameters<RequestHandler>[0]) {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  return req.user;
}
