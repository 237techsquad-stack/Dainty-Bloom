import type { RequestHandler } from 'express';

import { getAdminSettings, getPublicSettings, updateSettings } from '../services/settings.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const publicSettings: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getPublicSettings() });
});

export const adminSettings: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getAdminSettings() });
});

export const patchSettings: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  res.json({
    success: true,
    data: await updateSettings(req.body, req.user),
  });
});
