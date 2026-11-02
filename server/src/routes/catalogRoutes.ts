import { Router } from 'express';
import { createRateLimiter as rateLimit } from '../middleware/rateLimiter';

import {
  featuredProducts,
  getCategory,
  getProduct,
  listCategories,
  listProducts,
  newProducts,
  quoteProduct,
  searchSuggestions,
} from '../controllers/catalog.controller';
import { guestSession } from '../middleware/guestSession';
import { validate } from '../middleware/validate';
import {
  catalogFeatureSchema,
  catalogListSchema,
  categorySlugSchema,
  publicProductIdSchema,
  productQuoteSchema,
  searchSuggestionsSchema,
} from '../validators/catalog.validators';

const catalogLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
const suggestionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const catalogRoutes = Router();

catalogRoutes.use(catalogLimiter);
catalogRoutes.get('/categories', listCategories);
catalogRoutes.get(
  '/categories/:slug',
  validate(categorySlugSchema),
  getCategory,
);
catalogRoutes.get('/products', validate(catalogListSchema), listProducts);
catalogRoutes.get(
  '/products/featured',
  validate(catalogFeatureSchema),
  featuredProducts,
);
catalogRoutes.get('/products/new', validate(catalogFeatureSchema), newProducts);
catalogRoutes.get(
  '/products/search-suggestions',
  suggestionsLimiter,
  validate(searchSuggestionsSchema),
  searchSuggestions,
);
catalogRoutes.get(
  '/products/:idOrSlug',
  guestSession,
  validate(publicProductIdSchema),
  getProduct,
);
catalogRoutes.post(
  '/products/:idOrSlug/quote',
  validate(productQuoteSchema),
  quoteProduct,
);
