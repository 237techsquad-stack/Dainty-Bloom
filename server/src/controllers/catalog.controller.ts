import type { RequestHandler } from 'express';

import {
  getCategoryBySlug,
  getCategoryTree,
  getPublicProduct,
  getSearchSuggestions,
  listCatalogProducts,
  quotePublicProduct,
  type CatalogQuery,
} from '../services/catalog.service';
import { asyncHandler } from '../utils/asyncHandler';

export const listCategories: RequestHandler = asyncHandler(
  async (_req, res) => {
    const categories = await getCategoryTree();
    res.json({ success: true, data: { categories } });
  },
);

export const getCategory: RequestHandler = asyncHandler(async (req, res) => {
  const category = await getCategoryBySlug(req.params.slug);
  res.json({ success: true, data: { category } });
});

export const listProducts: RequestHandler = asyncHandler(async (req, res) => {
  const result = await listCatalogProducts(
    req.query as unknown as CatalogQuery,
  );
  res.json({ success: true, data: result });
});

export const featuredProducts: RequestHandler = asyncHandler(
  async (req, res) => {
    const query = {
      sort: 'newest',
      page: 1,
      limit: Number(req.query.limit ?? 12),
    } as CatalogQuery;
    const result = await listCatalogProducts(
      { ...query, sort: 'newest', page: 1 },
      'featured',
    );
    res.json({ success: true, data: result });
  },
);

export const newProducts: RequestHandler = asyncHandler(async (req, res) => {
  const query = {
    sort: 'newest',
    page: 1,
    limit: Number(req.query.limit ?? 12),
  } as CatalogQuery;
  const result = await listCatalogProducts(
    { ...query, sort: 'newest', page: 1 },
    'new',
  );
  res.json({ success: true, data: result });
});

export const searchSuggestions: RequestHandler = asyncHandler(
  async (req, res) => {
    const result = await getSearchSuggestions(String(req.query.q));
    res.json({ success: true, data: result });
  },
);

export const getProduct: RequestHandler = asyncHandler(async (req, res) => {
  const sessionId = req.user?._id.toString() ?? req.guestSessionId;
  const product = await getPublicProduct(
    req.params.idOrSlug,
    sessionId ?? 'anonymous',
  );
  res.json({ success: true, data: { product } });
});

export const quoteProduct: RequestHandler = asyncHandler(async (req, res) => {
  const quote = await quotePublicProduct(req.params.idOrSlug, req.body);
  res.json({ success: true, data: quote });
});
