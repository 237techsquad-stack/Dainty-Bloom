import type { RequestHandler } from 'express';

import {
  deleteAboutMedia,
  reorderAboutMedia,
  updateAboutMedia,
  uploadAboutMedia,
  listAdminAboutMedia,
  listPublishedAboutMedia,
} from '../services/aboutMedia.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const uploadAdminAboutMedia: RequestHandler = asyncHandler(
  async (req, res) => {
    if (!req.file) {
      throw new AppError('A file is required', 400, 'NO_FILE');
    }
    const media = await uploadAboutMedia(
      {
        buffer: req.file.buffer,
        title: req.body.title,
        description: req.body.description,
        altText: req.body.altText,
      },
      getActor(req),
    );
    res.status(201).json({ success: true, data: { media } });
  },
);

export const getPublicAboutMedia: RequestHandler = asyncHandler(
  async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const media = await listPublishedAboutMedia();
    res.json({ success: true, data: { media } });
  },
);

export const updateAdminAboutMedia: RequestHandler = asyncHandler(
  async (req, res) => {
    const media = await updateAboutMedia(
      req.params.id,
      req.body,
      getActor(req),
    );
    res.json({ success: true, data: { media } });
  },
);

export const reorderAdminAboutMedia: RequestHandler = asyncHandler(
  async (req, res) => {
    await reorderAboutMedia(req.body.mediaIds, getActor(req));
    res.json({ success: true, data: { reordered: true } });
  },
);

export const deleteAdminAboutMedia: RequestHandler = asyncHandler(
  async (req, res) => {
    await deleteAboutMedia(req.params.id, getActor(req));
    res.json({ success: true, data: { deleted: true } });
  },
);

function getActor(req: Parameters<RequestHandler>[0]) {
  if (!req.user) {
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  }
  return req.user;
}

export const getAdminAboutMedia: RequestHandler = asyncHandler(
  async (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const media = await listAdminAboutMedia();
    res.json({ success: true, data: { media } });
  },
);
