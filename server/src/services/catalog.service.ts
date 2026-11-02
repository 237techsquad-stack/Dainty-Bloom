import mongoose, { type PipelineStage } from 'mongoose';

import {
  LIGHTING_GALLERY_CATEGORY_SLUG,
  type ProductTheme,
} from '../constants/product';
import { DEFAULT_CATEGORY_FORM_PROFILE } from '../constants/category';
import { Category, Product, type ICategory, type IProduct } from '../models';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { getCachedPublicValue } from '../utils/publicCache';
import {
  calculateUnitPrice,
  lowestPossibleUnitPrice,
  type SelectedProductOption,
} from './pricing.service';
import { publicProductFilter } from './productVisibility.service';
import { buildImageUrl } from './productImage.service';
import { getReviewSummary } from './review.service';

export interface CatalogQuery {
  q?: string;
  category?: string;
  productType?: string;
  theme?: ProductTheme;
  printTechnique?: string;
  minPrice?: number;
  maxPrice?: number;
  color?: string;
  size?: string;
  inStock?: boolean;
  sort: 'newest' | 'price_asc' | 'price_desc' | 'popular';
  page: number;
  limit: number;
}

export interface CatalogCard {
  id: string;
  slug: string;
  title: string;
  description?: string;
  primaryImage: {
    url: string;
    alt: string;
    variants: { thumb: string; medium: string; large: string };
  } | null;
  secondaryImage?: {
    url: string;
    alt: string;
    variants: { thumb: string; medium: string; large: string };
  } | null;
  lightingImages?: {
    on?: {
      primary: NonNullable<CatalogCard['primaryImage']>;
      secondary?: NonNullable<CatalogCard['primaryImage']>;
    };
    off?: {
      primary: NonNullable<CatalogCard['primaryImage']>;
      secondary?: NonNullable<CatalogCard['primaryImage']>;
    };
  };
  category: { id: string; name: string; slug: string } | null;
  productType: string;
  startingPriceMinor: number;
  compareAtPriceMinor?: number;
  currency: string;
  availability: 'in_stock' | 'low_stock' | 'out_of_stock' | 'made_to_order';
  ratingAverage?: number;
  ratingCount?: number;
  isFeatured: boolean;
  customizationCues: string[];
  ecoNote?: string;
  madeToOrder?: boolean;
}

export interface CatalogCategoryRecord {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  formProfile?: ICategory['formProfile'];
  parent?: mongoose.Types.ObjectId;
}

export interface CatalogCardProduct {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  slug: string;
  category?: mongoose.Types.ObjectId | CatalogCategoryRecord | null;
  productType: string;
  media: IProduct['media'];
  lightingGalleryEnabled?: boolean;
  basePriceMinor: number;
  compareAtPriceMinor?: number;
  currency: string;
  optionGroups: IProduct['optionGroups'];
  quantityPricing: IProduct['quantityPricing'];
  stock: IProduct['stock'];
  ratingAverage: number;
  ratingCount: number;
  isFeatured: boolean;
  artworkRequired: boolean;
  madeToOrder?: boolean;
  ecoNote?: string;
}

export interface ProductRecord extends CatalogCardProduct {
  sku: string;
  createdAt: Date;
  status: IProduct['status'];
  description: string;
  printTechniques: IProduct['printTechniques'];
  specifications: IProduct['specifications'];
  artworkRequirements: IProduct['artworkRequirements'];
  seo: IProduct['seo'];
  leadTimeDays?: number;
  madeToOrder?: boolean;
  ecoNote?: string;
  minOrderQuantity: number;
  maxOrderQuantity?: number;
}

interface ProductQuoteInput {
  selectedOptions: SelectedProductOption[];
  quantity: number;
}

export async function quotePublicProduct(
  idOrSlug: string,
  input: ProductQuoteInput,
) {
  const product = await Product.findOne({
    $and: [
      mongoose.isValidObjectId(idOrSlug)
        ? { _id: idOrSlug }
        : { slug: idOrSlug },
      publicProductFilter(),
    ],
  })
    .select(
      'status basePriceMinor currency optionGroups quantityPricing stock minOrderQuantity maxOrderQuantity madeToOrder',
    )
    .lean<Pick<
      IProduct,
      | 'status'
      | 'basePriceMinor'
      | 'currency'
      | 'optionGroups'
      | 'quantityPricing'
      | 'stock'
      | 'minOrderQuantity'
      | 'maxOrderQuantity'
      | 'madeToOrder'
    > | null>();

  if (!product) {
    throw new AppError('Product is unavailable', 404, 'PRODUCT_UNAVAILABLE');
  }

  if (product.status !== 'active') {
    return {
      unitPriceMinor: null,
      lineTotalMinor: null,
      currency: product.currency,
      breakdown: null,
      availability: 'out_of_stock' as const,
      issues: [
        {
          code: 'PRODUCT_UNAVAILABLE',
          message: 'This product is no longer available',
        },
      ],
    };
  }

  const currentAvailability = availability(product.stock, product.madeToOrder);
  const issues: Array<{ code: string; message: string }> = [];
  let pricing: ReturnType<typeof calculateUnitPrice> | null = null;

  try {
    pricing = calculateUnitPrice(
      product,
      input.selectedOptions,
      input.quantity,
    );
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'INSUFFICIENT_STOCK') {
      issues.push({ code: error.code, message: error.message });
      try {
        pricing = calculateUnitPrice(
          {
            ...product,
            stock: { ...product.stock, allowBackorder: true },
          },
          input.selectedOptions,
          input.quantity,
        );
      } catch (pricingError) {
        if (
          !(pricingError instanceof AppError) ||
          pricingError.code !== 'INVALID_OPTION_SELECTION'
        ) {
          throw pricingError;
        }
        issues.push({
          code: pricingError.code,
          message: pricingError.message,
        });
      }
    } else if (
      error.code === 'INVALID_OPTION_SELECTION' ||
      error.code === 'INVALID_QUANTITY' ||
      error.code === 'MINIMUM_QUANTITY_NOT_MET' ||
      error.code === 'MAXIMUM_QUANTITY_EXCEEDED'
    ) {
      issues.push({
        code:
          error.code === 'INVALID_OPTION_SELECTION'
            ? error.code
            : 'INVALID_QUANTITY',
        message: error.message,
      });
    } else {
      throw error;
    }
  }

  return {
    unitPriceMinor: pricing?.unitPriceMinor ?? null,
    lineTotalMinor: pricing?.lineTotalMinor ?? null,
    currency: product.currency,
    breakdown: pricing?.breakdown ?? null,
    availability: issues.some((issue) => issue.code === 'INSUFFICIENT_STOCK')
      ? 'out_of_stock'
      : currentAvailability,
    issues,
  };
}

interface FacetResult {
  minPrice: number | null;
  maxPrice: number | null;
  productTypes: string[];
  printTechniques: string[];
  colors: Array<{ value: string; label: string; hex?: string }>;
  sizes: string[];
}

const EMPTY_FACETS: FacetResult = {
  minPrice: null,
  maxPrice: null,
  productTypes: [],
  printTechniques: [],
  colors: [],
  sizes: [],
};

export function getCategoryTree(): Promise<unknown[]> {
  return getCachedPublicValue('catalog:categories', async () => {
    const [categories, counts] = await Promise.all([
      Category.find({ isActive: true })
        .select('name slug description image formProfile parent sortOrder')
        .sort({ sortOrder: 1, name: 1 })
        .lean(),
      Product.aggregate<{
        _id: mongoose.Types.ObjectId;
        count: number;
      }>([
        {
          $match: {
            $and: [{ status: 'active' }, publicProductFilter()],
          },
        },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]),
    ]);
    const countByCategory = new Map(
      counts.map(({ _id, count }) => [_id.toString(), count]),
    );
    const nodes = new Map(
      categories.map((category) => [
        category._id.toString(),
        {
          ...category,
          formProfile: category.formProfile ?? DEFAULT_CATEGORY_FORM_PROFILE,
          productCount: countByCategory.get(category._id.toString()) ?? 0,
          children: [] as unknown[],
        },
      ]),
    );
    const roots: unknown[] = [];

    for (const category of categories) {
      const node = nodes.get(category._id.toString());
      if (!node) continue;
      const parentId = category.parent?.toString();
      const parent = parentId ? nodes.get(parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  });
}

export async function getCategoryBySlug(slug: string): Promise<unknown> {
  const category = await Category.findOne({ slug, isActive: true })
    .select('name slug description image formProfile parent sortOrder')
    .lean();
  if (!category)
    throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');

  const ancestors: Array<{ id: string; name: string; slug: string }> = [];
  let parentId = category.parent;
  while (parentId) {
    const parent = await Category.findOne({ _id: parentId, isActive: true })
      .select('name slug parent')
      .lean();
    if (!parent) break;
    ancestors.unshift({
      id: parent._id.toString(),
      name: parent.name,
      slug: parent.slug,
    });
    parentId = parent.parent;
  }

  return {
    ...category,
    formProfile: category.formProfile ?? DEFAULT_CATEGORY_FORM_PROFILE,
    id: category._id.toString(),
    breadcrumb: [
      ...ancestors,
      { id: category._id.toString(), name: category.name, slug: category.slug },
    ],
  };
}

export async function listCatalogProducts(
  query: CatalogQuery,
  mode: 'all' | 'featured' | 'new' = 'all',
): Promise<{
  items: CatalogCard[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
  facets: FacetResult;
}> {
  const match = await buildCatalogMatch(query);
  if (mode === 'featured') match.isFeatured = true;

  const sort = catalogSort(query.sort);
  const skip = (query.page - 1) * query.limit;
  const facetKey = JSON.stringify({
    q: query.q,
    category: query.category,
    productType: query.productType,
    theme: query.theme,
    printTechnique: query.printTechnique,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    color: query.color,
    size: query.size,
    inStock: query.inStock,
    mode,
  });
  const [records, total, facets] = await Promise.all([
    Product.find(match)
      .select(
        'title description slug category productType media lightingGalleryEnabled basePriceMinor compareAtPriceMinor currency optionGroups quantityPricing stock status ratingAverage ratingCount isFeatured artworkRequired madeToOrder ecoNote createdAt',
      )
      .populate({ path: 'category', select: 'name slug formProfile' })
      .sort(mode === 'new' ? { createdAt: -1 } : sort)
      .skip(skip)
      .limit(query.limit)
      .lean<ProductRecord[]>(),
    Product.countDocuments(match),
    getCachedPublicValue(`catalog:facets:${facetKey}`, async () => {
      const [row] = await Product.aggregate<FacetResult>(facetPipeline(match));
      return row ?? EMPTY_FACETS;
    }),
  ]);

  const totalPages = Math.ceil(total / query.limit);
  return {
    items: records.map(toCatalogCard),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
    },
    facets,
  };
}

export async function getSearchSuggestions(query: string): Promise<{
  suggestions: Array<
    | { type: 'product'; title: string; slug: string }
    | { type: 'category'; title: string; slug: string }
  >;
}> {
  const products = await Product.find({
    $and: [
      { status: 'active' },
      publicProductFilter(),
      { title: { $regex: escapeRegex(query), $options: 'i' } },
    ],
  })
    .select('title slug')
    .limit(8)
    .lean();
  const categories = await Category.find({
    isActive: true,
    name: { $regex: escapeRegex(query), $options: 'i' },
  })
    .select('name slug')
    .limit(Math.max(0, 8 - products.length))
    .lean();

  return {
    suggestions: [
      ...products.map(({ title, slug }) => ({
        type: 'product' as const,
        title,
        slug,
      })),
      ...categories.map(({ name, slug }) => ({
        type: 'category' as const,
        title: name,
        slug,
      })),
    ],
  };
}

export async function getPublicProduct(
  idOrSlug: string,
  sessionId: string,
): Promise<unknown> {
  const filter = {
    $and: [
      mongoose.isValidObjectId(idOrSlug)
        ? { _id: idOrSlug }
        : { slug: idOrSlug },
      { status: 'active' },
      publicProductFilter(),
    ],
  };
  const product = await Product.findOne(filter)
    .select('-stock.quantity -viewCount -soldCount')
    .populate({ path: 'category', select: 'name slug formProfile parent' })
    .lean<ProductRecord>();
  if (!product)
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  recordProductViewOnce(product._id.toString(), sessionId);
  const category = product.category as ICategory;
  const lightingGalleryEnabled =
    product.lightingGalleryEnabled === true &&
    category.slug === LIGHTING_GALLERY_CATEGORY_SLUG &&
    category.formProfile === 'three_d_printed';
  const [breadcrumb, relatedProducts, reviewSummary] = await Promise.all([
    getCategoryBreadcrumb(category),
    Product.find({
      $and: [
        { status: 'active' },
        publicProductFilter(),
        { category: category._id, _id: { $ne: product._id } },
      ],
    })
      .select(
        'title description slug category productType media lightingGalleryEnabled basePriceMinor currency optionGroups quantityPricing stock ratingAverage ratingCount isFeatured artworkRequired madeToOrder ecoNote',
      )
      .populate({ path: 'category', select: 'name slug formProfile' })
      .limit(4)
      .lean<ProductRecord[]>(),
    getReviewSummary(product._id),
  ]);

  const detail = {
    id: product._id.toString(),
    slug: product.slug,
    title: product.title,
    description: product.description,
    sku: product.sku,
    productType: product.productType,
    media: product.media.map((image) => ({
      url: image.url,
      alt: image.alt ?? '',
      isPrimary: image.isPrimary ?? false,
      view: image.view,
      width: image.width,
      height: image.height,
      sortOrder: image.sortOrder,
      ...(lightingGalleryEnabled && image.lightingState
        ? { lightingState: image.lightingState }
        : {}),
      variants: imageVariants(image),
    })),
    lightingGalleryEnabled,
    basePriceMinor: product.basePriceMinor,
    compareAtPriceMinor: product.compareAtPriceMinor,
    currency: product.currency,
    category: {
      id: category._id.toString(),
      name: category.name,
      slug: category.slug,
    },
    optionGroups: product.optionGroups.map((group) => ({
      ...group,
      values: group.values.filter((value) => value.isAvailable),
    })),
    quantityPricing: product.quantityPricing,
    printTechniques: product.printTechniques,
    specifications: product.specifications,
    artworkRequirements: product.artworkRequirements,
    artworkRequired: product.artworkRequired,
    ...(product.ecoNote ? { ecoNote: product.ecoNote } : {}),
    availability: availability(product.stock, product.madeToOrder),
    seo: product.seo,
    leadTimeDays: product.leadTimeDays,
    madeToOrder: product.madeToOrder,
    minOrderQuantity: product.minOrderQuantity,
    maxOrderQuantity: product.maxOrderQuantity ?? env.CART_MAX_QUANTITY,
    isFeatured: product.isFeatured,
    breadcrumb,
    relatedProducts: relatedProducts.map(toCatalogCard),
    reviewSummary,
  };

  return detail;
}

async function buildCatalogMatch(
  query: CatalogQuery,
): Promise<Record<string, unknown>> {
  const conditions: Record<string, unknown>[] = [
    { status: 'active' },
    publicProductFilter(),
  ];
  if (query.q) {
    conditions.push({
      $or: [{ $text: { $search: query.q } }, { sku: query.q.toUpperCase() }],
    });
  }

  if (query.category) {
    const category = await Category.findOne({
      slug: query.category,
      isActive: true,
    })
      .select('_id')
      .lean();
    if (!category) return { _id: { $exists: false } };

    const categoryIds = await getActiveDescendantIds(category._id);
    conditions.push({ category: { $in: categoryIds } });
  }
  if (query.productType) conditions.push({ productType: query.productType });
  if (query.theme) conditions.push({ themes: query.theme });
  if (query.printTechnique)
    conditions.push({ printTechniques: query.printTechnique });
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const price: Record<string, number> = {};
    if (query.minPrice !== undefined) price.$gte = query.minPrice;
    if (query.maxPrice !== undefined) price.$lte = query.maxPrice;
    conditions.push({ basePriceMinor: price });
  }
  if (query.color) {
    conditions.push({
      optionGroups: {
        $elemMatch: {
          key: { $in: ['color', 'colour'] },
          values: { $elemMatch: { value: query.color, isAvailable: true } },
        },
      },
    });
  }
  if (query.size) {
    conditions.push({
      optionGroups: {
        $elemMatch: {
          key: 'size',
          values: { $elemMatch: { value: query.size, isAvailable: true } },
        },
      },
    });
  }
  if (query.inStock) {
    conditions.push({
      $or: [
        { madeToOrder: true },
        { 'stock.trackInventory': false },
        { 'stock.quantity': { $gt: 0 } },
        { 'stock.allowBackorder': true },
        { 'stock.reserveBlanksForMadeToOrder': true },
      ],
    });
  }
  return conditions.length === 1
    ? (conditions[0] as Record<string, unknown>)
    : { $and: conditions };
}

function facetPipeline(match: Record<string, unknown>): PipelineStage[] {
  return [
    { $match: match },
    {
      $facet: {
        prices: [
          {
            $group: {
              _id: null,
              minPrice: { $min: '$basePriceMinor' },
              maxPrice: { $max: '$basePriceMinor' },
            },
          },
        ],
        productTypes: [
          { $unwind: '$productType' },
          { $group: { _id: '$productType' } },
        ],
        printTechniques: [
          { $unwind: '$printTechniques' },
          { $group: { _id: '$printTechniques' } },
        ],
        colors: [
          { $unwind: '$optionGroups' },
          { $match: { 'optionGroups.key': { $in: ['color', 'colour'] } } },
          { $unwind: '$optionGroups.values' },
          { $match: { 'optionGroups.values.isAvailable': true } },
          {
            $group: {
              _id: '$optionGroups.values.value',
              label: { $first: '$optionGroups.values.label' },
              hex: { $first: '$optionGroups.values.hex' },
            },
          },
        ],
        sizes: [
          { $unwind: '$optionGroups' },
          { $match: { 'optionGroups.key': 'size' } },
          { $unwind: '$optionGroups.values' },
          { $match: { 'optionGroups.values.isAvailable': true } },
          { $group: { _id: '$optionGroups.values.value' } },
        ],
      },
    },
    {
      $project: {
        minPrice: {
          $ifNull: [{ $arrayElemAt: ['$prices.minPrice', 0] }, null],
        },
        maxPrice: {
          $ifNull: [{ $arrayElemAt: ['$prices.maxPrice', 0] }, null],
        },
        productTypes: '$productTypes._id',
        printTechniques: '$printTechniques._id',
        colors: {
          $map: {
            input: '$colors',
            as: 'color',
            in: {
              value: '$$color._id',
              label: '$$color.label',
              hex: '$$color.hex',
            },
          },
        },
        sizes: '$sizes._id',
      },
    },
  ];
}

function catalogSort(sort: CatalogQuery['sort']): Record<string, 1 | -1> {
  switch (sort) {
    case 'price_asc':
      return { basePriceMinor: 1, _id: 1 };
    case 'price_desc':
      return { basePriceMinor: -1, _id: 1 };
    case 'popular':
      return { soldCount: -1, viewCount: -1, _id: 1 };
    default:
      return { createdAt: -1, _id: 1 };
  }
}

export function toCatalogCard(product: CatalogCardProduct): CatalogCard {
  const primary =
    product.media.find((image) => image.isPrimary) ?? product.media[0];
  const secondary = product.media.find((image) => image !== primary);
  const category =
    product.category && !(product.category instanceof mongoose.Types.ObjectId)
      ? product.category
      : undefined;
  const isEligibleLightingGallery =
    product.lightingGalleryEnabled === true &&
    category?.slug === LIGHTING_GALLERY_CATEGORY_SLUG &&
    category.formProfile === 'three_d_printed';
  const lightingImages = isEligibleLightingGallery
    ? {
        on: getLightingImageSet(product.media, 'on'),
        off: getLightingImageSet(product.media, 'off'),
      }
    : undefined;
  const cues = product.optionGroups
    .filter((group) => group.required)
    .map((group) => `Choose ${group.label.toLowerCase()}`);
  if (product.artworkRequired) cues.push('Upload artwork');

  return {
    id: product._id.toString(),
    slug: product.slug,
    title: product.title,
    ...(product.description !== undefined
      ? { description: product.description }
      : {}),
    primaryImage: primary
      ? {
          url: primary.url,
          alt: primary.alt ?? '',
          variants: imageVariants(primary),
        }
      : null,
    ...(secondary
      ? {
          secondaryImage: {
            url: secondary.url,
            alt: secondary.alt ?? '',
            variants: imageVariants(secondary),
          },
        }
      : {}),
    ...(lightingImages?.on || lightingImages?.off ? { lightingImages } : {}),
    category: category
      ? {
          id: category._id.toString(),
          name: category.name,
          slug: category.slug,
        }
      : null,
    productType: product.productType,
    startingPriceMinor: lowestPossibleUnitPrice(product),
    compareAtPriceMinor: product.compareAtPriceMinor,
    currency: product.currency,
    availability: availability(product.stock, product.madeToOrder),
    ...(product.madeToOrder !== undefined
      ? { madeToOrder: product.madeToOrder }
      : {}),
    ...(product.ecoNote ? { ecoNote: product.ecoNote } : {}),
    ...(product.ratingCount > 0
      ? {
          ratingAverage: product.ratingAverage,
          ratingCount: product.ratingCount,
        }
      : {}),
    isFeatured: product.isFeatured,
    customizationCues: cues,
  };
}

function getLightingImageSet(
  media: IProduct['media'],
  state: 'on' | 'off',
):
  | NonNullable<NonNullable<CatalogCard['lightingImages']>[typeof state]>
  | undefined {
  const images = media.filter((image) => image.lightingState === state);
  const primary = images.find((image) => image.isPrimary) ?? images[0];
  if (!primary) return undefined;
  const toCardImage = (image: (typeof images)[number]) => ({
    url: image.url,
    alt: image.alt ?? '',
    variants: imageVariants(image),
  });
  const secondary = images.find((image) => image !== primary);

  return {
    primary: toCardImage(primary),
    ...(secondary ? { secondary: toCardImage(secondary) } : {}),
  };
}

function imageVariants(image: IProduct['media'][number]) {
  return {
    thumb: buildImageUrl(image.publicId, 'thumb', image.url),
    medium: buildImageUrl(image.publicId, 'medium', image.url),
    large: buildImageUrl(image.publicId, 'large', image.url),
  };
}

function availability(
  stock: IProduct['stock'],
  madeToOrder = false,
): CatalogCard['availability'] {
  if (madeToOrder) return 'made_to_order';
  if (!stock.trackInventory) return 'made_to_order';
  if (stock.quantity > stock.lowStockThreshold) return 'in_stock';
  if (stock.quantity > 0) return 'low_stock';
  if (stock.allowBackorder || stock.reserveBlanksForMadeToOrder)
    return 'made_to_order';
  return 'out_of_stock';
}

async function getCategoryBreadcrumb(category: ICategory): Promise<unknown[]> {
  const chain: Array<{ id: string; name: string; slug: string }> = [];
  let current: ICategory | null = category;
  while (current) {
    chain.unshift({
      id: current._id.toString(),
      name: current.name,
      slug: current.slug,
    });
    if (!current.parent) break;
    current = await Category.findById(current.parent)
      .select('name slug parent')
      .lean<ICategory | null>();
  }
  return chain;
}

const seenProductViews = new Map<string, number>();

function recordProductViewOnce(productId: string, sessionId: string): void {
  const key = `${productId}:${sessionId}`;
  const now = Date.now();
  const prior = seenProductViews.get(key);
  if (prior && now - prior < 30 * 60 * 1000) return;
  seenProductViews.set(key, now);
  if (seenProductViews.size > 10_000) {
    for (const [entry, timestamp] of seenProductViews) {
      if (now - timestamp > 30 * 60 * 1000) seenProductViews.delete(entry);
    }
  }
  void Product.updateOne({ _id: productId }, { $inc: { viewCount: 1 } }).catch(
    (error: unknown) =>
      logger.warn({ err: error, productId }, 'Could not record product view'),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getActiveDescendantIds(
  rootId: mongoose.Types.ObjectId,
): Promise<mongoose.Types.ObjectId[]> {
  const ids: mongoose.Types.ObjectId[] = [rootId];
  const visited = new Set([rootId.toString()]);
  let parentIds = [rootId];

  while (parentIds.length > 0) {
    const children = await Category.find({
      isActive: true,
      parent: { $in: parentIds },
    })
      .select('_id')
      .lean();
    parentIds = children
      .map(({ _id }) => _id)
      .filter((_id) => !visited.has(_id.toString()));
    for (const childId of parentIds) {
      visited.add(childId.toString());
      ids.push(childId);
    }
  }
  return ids;
}
