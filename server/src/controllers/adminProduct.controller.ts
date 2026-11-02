import type { RequestHandler } from 'express';

import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import {
  bulkChangeProductStatus,
  changeProductStatus,
  changeProductStock,
  createProduct,
  deleteOrArchiveProduct,
  getAdminProduct,
  listAdminProducts,
  updateProduct,
  type AdminProductQuery,
  type ProductAdminInput,
} from '../services/productAdmin.service';

export const listProducts: RequestHandler = asyncHandler(async (req, res) => {
  const result = await listAdminProducts(
    req.query as unknown as AdminProductQuery,
  );
  res.json({ success: true, data: result });
});

export const getProduct: RequestHandler = asyncHandler(async (req, res) => {
  const product = await getAdminProduct(req.params.id);
  res.json({ success: true, data: { product } });
});

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const product = await createProduct(
    req.body as ProductAdminInput,
    getActor(req),
  );
  res.status(201).json({ success: true, data: { product } });
});

export const update: RequestHandler = asyncHandler(async (req, res) => {
  const product = await updateProduct(
    req.params.id,
    req.body as Partial<ProductAdminInput>,
    getActor(req),
  );
  res.json({ success: true, data: { product } });
});

export const updateStatus: RequestHandler = asyncHandler(async (req, res) => {
  const product = await changeProductStatus(
    req.params.id,
    req.body.status,
    getActor(req),
  );
  res.json({ success: true, data: { product } });
});

export const updateStock: RequestHandler = asyncHandler(async (req, res) => {
  const product = await changeProductStock(
    req.params.id,
    req.body,
    getActor(req),
  );
  res.json({ success: true, data: { product } });
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  if (req.query.confirm !== 'true') {
    throw new AppError(
      'Set confirm=true to delete a product',
      400,
      'CONFIRMATION_REQUIRED',
    );
  }
  const result = await deleteOrArchiveProduct(req.params.id, getActor(req));
  res.json({
    success: true,
    data: {
      ...result,
      message: result.archived
        ? 'Product archived to preserve order history'
        : 'Product deleted',
    },
  });
});

export const bulkStatus: RequestHandler = asyncHandler(async (req, res) => {
  const result = await bulkChangeProductStatus(
    req.body.ids,
    req.body.status,
    getActor(req),
  );
  res.json({ success: true, data: result });
});

function getActor(req: Parameters<RequestHandler>[0]) {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  return req.user;
}
