import { z } from 'zod';

import {
  LEGACY_PRODUCT_TYPE,
  PRODUCT_LIGHTING_STATES,
  PRINT_TECHNIQUE,
  PRODUCT_MEDIA_MAX_IMAGES,
  PRODUCT_MEDIA_VIEWS,
  PRODUCT_STATUS,
  PRODUCT_THEMES,
  PRODUCT_TYPE,
} from '../constants/product';
import { env } from '../config/env';
import { CATEGORY_FORM_PROFILES } from '../constants/category';

const empty = z.object({}).strict();
const numericQuery = z.preprocess(
  (value) => (value === undefined ? undefined : Number(value)),
  z.number().int().nonnegative().optional(),
);

export const catalogListSchema = z.object({
  body: empty,
  params: empty,
  query: z
    .object({
      q: z.string().trim().min(1).max(100).optional(),
      category: z.string().trim().min(1).max(160).optional(),
      productType: z.enum([...PRODUCT_TYPE, ...LEGACY_PRODUCT_TYPE]).optional(),
      theme: z.enum(PRODUCT_THEMES).optional(),
      printTechnique: z.enum(PRINT_TECHNIQUE).optional(),
      minPrice: numericQuery,
      maxPrice: numericQuery,
      color: z.string().trim().min(1).max(80).optional(),
      size: z.string().trim().min(1).max(80).optional(),
      inStock: z
        .enum(['true', 'false'])
        .transform((value) => value === 'true')
        .optional(),
      sort: z
        .enum(['newest', 'price_asc', 'price_desc', 'popular'])
        .default('newest'),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(48).default(12),
    })
    .strict()
    .refine(
      ({ minPrice, maxPrice }) =>
        minPrice === undefined ||
        maxPrice === undefined ||
        minPrice <= maxPrice,
      { message: 'minPrice cannot exceed maxPrice' },
    ),
});

export const categorySlugSchema = z.object({
  body: empty,
  params: z.object({ slug: z.string().trim().min(1).max(160) }).strict(),
  query: empty,
});

export const publicProductIdSchema = z.object({
  body: empty,
  params: z.object({ idOrSlug: z.string().trim().min(1).max(220) }).strict(),
  query: empty,
});

export const productQuoteSchema = z.object({
  body: z
    .object({
      selectedOptions: z
        .array(
          z
            .object({
              key: z.string().trim().min(1).max(40),
              value: z.string().trim().min(1).max(120),
            })
            .strict(),
        )
        .max(20)
        .default([]),
      quantity: z.number().int().positive().max(env.CART_MAX_QUANTITY),
    })
    .strict(),
  params: z.object({ idOrSlug: z.string().trim().min(1).max(220) }).strict(),
  query: empty,
});

export const catalogFeatureSchema = z.object({
  body: empty,
  params: empty,
  query: z
    .object({ limit: z.coerce.number().int().positive().max(48).default(12) })
    .strict(),
});

export const searchSuggestionsSchema = z.object({
  body: empty,
  params: empty,
  query: z.object({ q: z.string().trim().min(2).max(80) }).strict(),
});

const mediaSchema = z
  .object({
    url: z.string().trim().min(1).max(2048),
    alt: z.string().trim().min(1).max(300),
    isPrimary: z.boolean().default(false),
    view: z.enum(PRODUCT_MEDIA_VIEWS),
    lightingState: z.enum(PRODUCT_LIGHTING_STATES).optional(),
  })
  .strict();

const optionValueSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(120),
    priceModifierMinor: z.number().int(),
    hex: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    skuSuffix: z.string().trim().max(32).optional(),
    isAvailable: z.boolean().default(true),
  })
  .strict();

const optionGroupSchema = z
  .object({
    key: z.enum([
      'material',
      'technique',
      'color',
      'colour',
      'size',
      'capacity',
      'printArea',
      'frame',
      'edgeStyle',
      'finish',
    ]),
    label: z.string().trim().min(1).max(100),
    required: z.boolean().default(false),
    values: z.array(optionValueSchema).max(100),
  })
  .strict();

const quantityTierSchema = z
  .object({
    minQty: z.number().int().positive(),
    unitPriceMinor: z.number().int().nonnegative(),
  })
  .strict();

const stockWriteFields = {
  trackInventory: z.boolean(),
  quantity: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative(),
  allowBackorder: z.boolean(),
  reserveBlanksForMadeToOrder: z.boolean(),
};

const stockCreateSchema = z
  .object({
    trackInventory: z.boolean().default(false),
    quantity: z.number().int().nonnegative().default(0),
    lowStockThreshold: z.number().int().nonnegative().default(0),
    allowBackorder: z.boolean().default(false),
    reserveBlanksForMadeToOrder: z.boolean().default(false),
  })
  .strict()
  .default({
    trackInventory: false,
    quantity: 0,
    lowStockThreshold: 0,
    allowBackorder: false,
    reserveBlanksForMadeToOrder: false,
  });

export const productWriteFields = {
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(220).optional(),
  description: z.string().trim().min(1).max(20_000),
  category: z.string().regex(/^[a-f\d]{24}$/i),
  productType: z.enum(PRODUCT_TYPE),
  media: z.array(mediaSchema).max(30),
  lightingGalleryEnabled: z.boolean().optional(),
  sku: z.string().trim().min(1).max(80),
  basePriceMinor: z.number().int().nonnegative(),
  compareAtPriceMinor: z.number().int().nonnegative().optional(),
  currency: z.literal('GBP').optional(),
  optionGroups: z.array(optionGroupSchema).max(10),
  quantityPricing: z.array(quantityTierSchema).max(100),
  printTechniques: z.array(z.enum(PRINT_TECHNIQUE)).max(10),
  specifications: z
    .array(
      z
        .object({
          label: z.string().trim().min(1),
          value: z.string().trim().min(1),
        })
        .strict(),
    )
    .max(100),
  artworkRequirements: z
    .object({
      allowedFormats: z.array(z.string().trim().min(1).max(20)).max(30),
      minimumResolutionNote: z.string().trim().max(500).optional(),
      notes: z.string().trim().max(2000).optional(),
    })
    .strict(),
  artworkRequired: z.boolean(),
  stock: z.object(stockWriteFields).strict(),
  status: z.enum(PRODUCT_STATUS),
  themes: z
    .array(z.enum(PRODUCT_THEMES))
    .max(PRODUCT_THEMES.length)
    .refine((themes) => new Set(themes).size === themes.length, {
      message: 'themes must not contain duplicates',
    })
    .optional(),
  seo: z
    .object({
      metaTitle: z.string().trim().max(200).optional(),
      metaDescription: z.string().trim().max(500).optional(),
      canonicalUrl: z.string().url().optional(),
    })
    .strict(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  madeToOrder: z.boolean().optional(),
  ecoNote: z
    .string()
    .trim()
    .max(300)
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value))
    .optional(),
  isFeatured: z.boolean(),
  minOrderQuantity: z.number().int().positive(),
  maxOrderQuantity: z.number().int().positive().optional(),
};

const productCreateFields = {
  ...productWriteFields,
  media: z
    .array(mediaSchema)
    .max(PRODUCT_MEDIA_MAX_IMAGES, 'A product cannot have more than 10 images'),
  optionGroups: productWriteFields.optionGroups.default([]),
  quantityPricing: productWriteFields.quantityPricing.default([]),
  printTechniques: productWriteFields.printTechniques.default([]),
  specifications: productWriteFields.specifications.default([]),
  artworkRequirements: productWriteFields.artworkRequirements
    .extend({
      allowedFormats: z
        .array(z.string().trim().min(1).max(20))
        .max(30)
        .default([]),
    })
    .default({ allowedFormats: [] }),
  artworkRequired: productWriteFields.artworkRequired.default(false),
  stock: stockCreateSchema,
  status: productWriteFields.status.default('draft'),
  seo: productWriteFields.seo.default({}),
  isFeatured: productWriteFields.isFeatured.default(false),
  minOrderQuantity: productWriteFields.minOrderQuantity.default(1),
};

const productWriteRefine = <T extends z.ZodType>(schema: T) =>
  schema
    .refine(
      (value) => {
        const data = value as Record<string, unknown>;
        const basePrice = data.basePriceMinor;
        const comparePrice = data.compareAtPriceMinor;
        return (
          typeof basePrice !== 'number' ||
          typeof comparePrice !== 'number' ||
          comparePrice > basePrice
        );
      },
      { message: 'compareAtPriceMinor must be greater than basePriceMinor' },
    )
    .refine(
      (value) => {
        const data = value as Record<string, unknown>;
        const tiers = data.quantityPricing;
        if (!Array.isArray(tiers)) return true;
        return tiers.every(
          (tier, index) =>
            index === 0 ||
            (tiers[index - 1] as { minQty: number }).minQty < tier.minQty,
        );
      },
      {
        message:
          'Quantity pricing tiers must have strictly ascending minQty values',
      },
    )
    .refine(
      (value) => {
        const data = value as Record<string, unknown>;
        return (
          data.maxOrderQuantity === undefined ||
          (data.minOrderQuantity as number) <= (data.maxOrderQuantity as number)
        );
      },
      { message: 'maxOrderQuantity must be at least minOrderQuantity' },
    )
    .refine(
      (value) => {
        const data = value as {
          media?: Array<{ isPrimary: boolean; lightingState?: string }>;
          lightingGalleryEnabled?: boolean;
        };
        if (!data.media) return true;
        if (data.lightingGalleryEnabled !== true) {
          return (
            data.media.every((image) => image.lightingState === undefined) &&
            data.media.filter((image) => image.isPrimary).length <= 1
          );
        }
        if (data.media.some((image) => image.lightingState === undefined))
          return false;
        return PRODUCT_LIGHTING_STATES.every(
          (state) =>
            data.media!.filter(
              (image) => image.lightingState === state && image.isPrimary,
            ).length <= 1,
        );
      },
      {
        message:
          'Lighting-gallery images need a state and may have at most one primary per state; ordinary products allow at most one primary image',
        path: ['media'],
      },
    );

export const createProductSchema = z.object({
  body: productWriteRefine(z.object(productCreateFields).strict()),
  params: empty,
  query: empty,
});

export const updateProductSchema = z.object({
  body: productWriteRefine(z.object(productWriteFields).partial().strict())
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one product field is required',
    })
    .refine((body) => body.media === undefined, {
      message:
        'Product media must be managed using the dedicated media endpoints',
      path: ['media'],
    }),
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
  query: empty,
});

export const productIdSchema = z.object({
  body: empty,
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
  query: empty,
});

export const statusSchema = z.object({
  body: z.object({ status: z.enum(PRODUCT_STATUS) }).strict(),
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
  query: empty,
});

export const stockSchema = z.object({
  body: z
    .object({
      mode: z.enum(['set', 'adjust']),
      quantity: z.number().int().nonnegative().optional(),
      delta: z.number().int().optional(),
      note: z.string().trim().min(1).max(500),
    })
    .strict()
    .refine(
      ({ mode, quantity, delta }) =>
        mode === 'set'
          ? quantity !== undefined && delta === undefined
          : delta !== undefined && quantity === undefined,
      { message: 'Provide quantity for set mode or delta for adjust mode' },
    ),
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
  query: empty,
});

export const deleteProductSchema = z.object({
  body: empty,
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
  query: z.object({ confirm: z.literal('true') }).strict(),
});

export const bulkStatusSchema = z.object({
  body: z
    .object({
      ids: z
        .array(z.string().regex(/^[a-f\d]{24}$/i))
        .min(1)
        .max(100),
      status: z.enum(PRODUCT_STATUS),
    })
    .strict(),
  params: empty,
  query: empty,
});

export const adminProductListSchema = z.object({
  body: empty,
  params: empty,
  query: z
    .object({
      q: z.string().trim().min(1).max(100).optional(),
      category: z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .optional(),
      status: z.enum(PRODUCT_STATUS).optional(),
      minPrice: numericQuery,
      maxPrice: numericQuery,
      stockState: z
        .enum(['in_stock', 'low_stock', 'out_of_stock', 'made_to_order'])
        .optional(),
      sort: z
        .enum(['newest', 'title', 'price_asc', 'price_desc', 'popular'])
        .default('newest'),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    })
    .strict()
    .refine(
      ({ minPrice, maxPrice }) =>
        minPrice === undefined ||
        maxPrice === undefined ||
        minPrice <= maxPrice,
      { message: 'minPrice cannot exceed maxPrice' },
    ),
});

export const createCategorySchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1).max(120),
      slug: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().max(2000).optional(),
      image: z.string().trim().max(2048).optional(),
      formProfile: z.enum(CATEGORY_FORM_PROFILES).default('general'),
      parent: z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .nullable()
        .optional(),
      sortOrder: z.number().int().nonnegative().default(0),
      isActive: z.boolean().default(true),
    })
    .strict(),
  params: empty,
  query: empty,
});

export const updateCategorySchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      slug: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().max(2000).optional(),
      image: z.string().trim().max(2048).optional(),
      formProfile: z.enum(CATEGORY_FORM_PROFILES).optional(),
      parent: z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .nullable()
        .optional(),
      sortOrder: z.number().int().nonnegative().optional(),
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one category field is required',
    }),
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
  query: empty,
});

export const categoryIdSchema = productIdSchema;
