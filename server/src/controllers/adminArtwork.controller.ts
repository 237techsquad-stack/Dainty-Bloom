import type { RequestHandler } from 'express';

import {
  getArtworkReviewDetail,
  listArtworkForReview,
  reviewArtwork,
  type ArtworkReviewQuery,
} from '../services/upload.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const list: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  const result = await listArtworkForReview(
    req.query as unknown as ArtworkReviewQuery,
    req.user,
  );
  res.json({ success: true, data: result });
});

export const detail: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  const artwork = await getArtworkReviewDetail(req.params.id, req.user);
  res.json({ success: true, data: { artwork } });
});

export const review: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  const artwork = await reviewArtwork(
    req.params.id,
    req.body.decision,
    req.body.note,
    req.user,
  );
  res.json({ success: true, data: { artwork } });
});
