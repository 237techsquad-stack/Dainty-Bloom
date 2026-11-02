import type { RequestHandler } from 'express';

import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createCategory,
  deleteCategory,
  listAdminCategories,
  updateCategory,
  type CategoryWriteInput,
} from '../services/categoryAdmin.service';

export const list: RequestHandler = asyncHandler(async (_req, res) => {
  const categories = await listAdminCategories();
  res.json({ success: true, data: { categories } });
});

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const category = await createCategory(
    req.body as CategoryWriteInput,
    getActor(req),
  );
  res.status(201).json({ success: true, data: { category } });
});

export const update: RequestHandler = asyncHandler(async (req, res) => {
  const category = await updateCategory(
    req.params.id,
    req.body as CategoryWriteInput,
    getActor(req),
  );
  res.json({ success: true, data: { category } });
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  await deleteCategory(req.params.id, getActor(req));
  res.json({ success: true, data: { message: 'Category deleted' } });
});

function getActor(req: Parameters<RequestHandler>[0]) {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  return req.user;
}
