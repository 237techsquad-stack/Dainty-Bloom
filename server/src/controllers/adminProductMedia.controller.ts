import type { RequestHandler } from 'express';

import {
  deleteProductImage,
  reorderProductImages,
  updateProductImage,
  uploadProductImage,
} from '../services/productImage.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const upload: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('A file is required', 400, 'NO_FILE');
  const media = await uploadProductImage(
    req.params.id,
    {
      buffer: req.file.buffer,
      alt: req.body.alt,
      view: req.body.view,
      isPrimary: req.body.isPrimary,
      lightingState: req.body.lightingState,
    },
    getActor(req),
  );
  res.status(201).json({
    success: true,
    data: { media: mediaResponse(media) },
  });
});

export const update: RequestHandler = asyncHandler(async (req, res) => {
  const media = await updateProductImage(
    req.params.id,
    req.params.mediaId,
    req.body,
    getActor(req),
  );
  res.json({ success: true, data: { media: mediaResponse(media) } });
});

export const reorder: RequestHandler = asyncHandler(async (req, res) => {
  await reorderProductImages(req.params.id, req.body.mediaIds, getActor(req));
  res.json({ success: true, data: { reordered: true } });
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  await deleteProductImage(req.params.id, req.params.mediaId, getActor(req));
  res.json({ success: true, data: { deleted: true } });
});

function getActor(req: Parameters<RequestHandler>[0]) {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  return req.user;
}

function mediaResponse(media: Awaited<ReturnType<typeof uploadProductImage>>) {
  return {
    id: media._id?.toString(),
    url: media.url,
    publicId: media.publicId,
    width: media.width,
    height: media.height,
    alt: media.alt,
    view: media.view,
    lightingState: media.lightingState,
    isPrimary: media.isPrimary,
    sortOrder: media.sortOrder,
  };
}
