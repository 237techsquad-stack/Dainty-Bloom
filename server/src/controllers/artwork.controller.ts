import type { RequestHandler } from 'express';

import { ROLE_PERMISSIONS } from '../constants/permissions';
import {
  deleteArtwork,
  getArtworkMetadata,
  makeArtworkDownloadLink,
  saveArtworkUpload,
  streamArtwork,
  streamArtworkPreview,
  streamSignedArtwork,
} from '../services/upload.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const upload: RequestHandler = asyncHandler(async (req, res) => {
  const data = await saveArtworkUpload(identity(req), req.file);
  res.status(201).json({ success: true, data });
});

export const metadata: RequestHandler = asyncHandler(async (req, res) => {
  const staff = hasArtworkPermission(req);
  const data = await getArtworkMetadata(
    req.params.id,
    identity(req),
    staff,
    req.user,
  );
  res.json({ success: true, data });
});

export const file: RequestHandler = asyncHandler(async (req, res, next) => {
  await streamArtwork(
    req.params.id,
    identity(req),
    hasArtworkPermission(req),
    res,
    next,
    req.user,
  );
});

export const preview: RequestHandler = asyncHandler(async (req, res, next) => {
  await streamArtworkPreview(
    req.params.id,
    identity(req),
    hasArtworkPermission(req),
    res,
    next,
    req.user,
  );
});

export const downloadLink: RequestHandler = asyncHandler(async (req, res) => {
  const actor = getActor(req);
  const result = await makeArtworkDownloadLink(req.params.id, actor);
  res.json({
    success: true,
    data: {
      downloadUrl: `/api/artwork/signed/${result.token}`,
      expiresAt: result.expiresAt,
    },
  });
});

export const signedFile: RequestHandler = asyncHandler(
  async (req, res, next) => {
    await streamSignedArtwork(req.params.token, res, next);
  },
);

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  await deleteArtwork(req.params.id, identity(req));
  res.json({ success: true, data: { deleted: true } });
});

function identity(req: Parameters<RequestHandler>[0]) {
  if (req.user) return { user: req.user };
  if (req.guestSessionId) return { sessionId: req.guestSessionId };
  throw new AppError('Artwork identity is missing', 401, 'UNAUTHENTICATED');
}

function hasArtworkPermission(req: Parameters<RequestHandler>[0]): boolean {
  return Boolean(
    req.user && ROLE_PERMISSIONS[req.user.role].includes('artwork:review'),
  );
}

function getActor(req: Parameters<RequestHandler>[0]) {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  return req.user;
}
