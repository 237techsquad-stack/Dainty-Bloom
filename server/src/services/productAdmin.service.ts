import mongoose, { type FilterQuery } from 'mongoose';

import {
  LIGHTING_GALLERY_CATEGORY_SLUG,
  PRODUCT_LIGHTING_STATES,
  PRODUCT_MEDIA_MAX_IMAGES,
  PRODUCT_STATUS,
  type ProductStatus,
  type ProductLightingState,
  type ProductTheme,
} from '../constants/product';
import {
  Category,
  CustomOffer,
  Order,
  Product,
  type IProduct,
} from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { invalidateCatalogPublicCache } from '../utils/publicCache';
import { slugify } from '../utils/slugify';
import { logAuditEvent } from './audit.service';
import { validOptionGroupsForProductType } from './pricing.service';
import {
  assertProductImageStorageConfigured,
  buildImageUrl,
  deleteProductImages,
} from './productImage.service';

export interface ProductAdminInput {
  [key: string]: unknown;
  title: string;
  slug?: string;
  description: string;
  category: string;
  productType: string;
  media: Array<{
    url: string;
    alt: string;
    isPrimary: boolean;
    view: string;
    lightingState?: ProductLightingState;
  }>;
  lightingGalleryEnabled?: boolean;
  sku: string;
  basePriceMinor: number;
  compareAtPriceMinor?: number;
  currency: string;
  optionGroups: Array<{
    key: string;
    label: string;
    required: boolean;
    values: Array<{
      label: string;
      value: string;
      priceModifierMinor: number;
      hex?: string;
      skuSuffix?: string;
      isAvailable: boolean;
    }>;
  }>;
  quantityPricing: Array<{ minQty: number; unitPriceMinor: number }>;
  printTechniques: string[];
  specifications: Array<{ label: string; value: string }>;
  artworkRequirements: {
    allowedFormats: string[];
    minimumResolutionNote?: string;
    notes?: string;
  };
  artworkRequired: boolean;
  stock: {
    trackInventory: boolean;
    quantity: number;
    lowStockThreshold: number;
    allowBackorder: boolean;
    reserveBlanksForMadeToOrder: boolean;
  };
  status: ProductStatus;
  themes?: ProductTheme[];
  seo: { metaTitle?: string; metaDescription?: string; canonicalUrl?: string };
  leadTimeDays?: number;
  madeToOrder?: boolean;
  ecoNote?: string;
  isFeatured: boolean;
  minOrderQuantity: number;
  maxOrderQuantity?: number;
}

export interface AdminProductQuery {
  q?: string;
  category?: string;
  status?: ProductStatus;
  minPrice?: number;
  maxPrice?: number;
  stockState?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'made_to_order';
  sort: 'newest' | 'title' | 'price_asc' | 'price_desc' | 'popular';
  page: number;
  limit: number;
}

export async function listAdminProducts(
  query: AdminProductQuery,
): Promise<unknown> {
  const conditions: FilterQuery<IProduct>[] = [];
  if (query.q) {
    conditions.push({
      $or: [
        { title: { $regex: escapeRegex(query.q), $options: 'i' } },
        { sku: query.q.toUpperCase() },
      ],
    });
  }
  if (query.category) {
    const categories = await Category.find().select('_id parent').lean();
    const categoryIds = new Set([query.category]);
    let frontier = [query.category];
    while (frontier.length) {
      const descendants = categories
        .filter(
          (category) =>
            category.parent && frontier.includes(category.parent.toString()),
        )
        .map((category) => category._id.toString())
        .filter((id) => !categoryIds.has(id));
      descendants.forEach((id) => categoryIds.add(id));
      frontier = descendants;
    }
    conditions.push({ category: { $in: [...categoryIds] } });
  }
  if (query.status) conditions.push({ status: query.status });
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const price: Record<string, number> = {};
    if (query.minPrice !== undefined) price.$gte = query.minPrice;
    if (query.maxPrice !== undefined) price.$lte = query.maxPrice;
    conditions.push({ basePriceMinor: price });
  }
  if (query.stockState) {
    const stockConditions: Record<string, unknown> = {
      in_stock: { 'stock.quantity': { $gt: 0 } },
      low_stock: {
        'stock.quantity': { $gt: 0 },
        $expr: { $lte: ['$stock.quantity', '$stock.lowStockThreshold'] },
      },
      out_of_stock: {
        'stock.trackInventory': true,
        'stock.quantity': { $lte: 0 },
        'stock.allowBackorder': false,
        'stock.reserveBlanksForMadeToOrder': false,
        madeToOrder: { $ne: true },
      },
      made_to_order: {
        $or: [
          { madeToOrder: true },
          { 'stock.trackInventory': false },
          { 'stock.allowBackorder': true },
          { 'stock.reserveBlanksForMadeToOrder': true },
        ],
      },
    };
    conditions.push(stockConditions[query.stockState] as FilterQuery<IProduct>);
  }
  const match: FilterQuery<IProduct> =
    conditions.length === 0 ? {} : { $and: conditions };
  const sortMap: Record<AdminProductQuery['sort'], Record<string, 1 | -1>> = {
    newest: { createdAt: -1, _id: 1 },
    title: { title: 1, _id: 1 },
    price_asc: { basePriceMinor: 1, _id: 1 },
    price_desc: { basePriceMinor: -1, _id: 1 },
    popular: { soldCount: -1, viewCount: -1, _id: 1 },
  };
  const sort = sortMap[query.sort];
  const [items, total] = await Promise.all([
    Product.find(match)
      .select(
        'title slug category productType media sku basePriceMinor compareAtPriceMinor currency stock status viewCount soldCount isFeatured madeToOrder ecoNote createdAt updatedAt',
      )
      .populate({ path: 'category', select: 'name slug' })
      .sort(sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Product.countDocuments(match),
  ]);

  const totalPages = Math.ceil(total / query.limit);
  return {
    items: items.map((item) => ({
      ...item,
      media: item.media.map((media) => ({
        ...media,
        variants: {
          thumb: media.publicId
            ? buildImageUrl(media.publicId, 'thumb', media.url)
            : media.url,
          medium: media.publicId
            ? buildImageUrl(media.publicId, 'medium', media.url)
            : media.url,
          large: media.publicId
            ? buildImageUrl(media.publicId, 'large', media.url)
            : media.url,
        },
      })),
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
    },
  };
}

export async function getAdminProduct(id: string): Promise<IProduct> {
  const product = await Product.findById(id);
  if (!product)
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  return product;
}

export async function createProduct(
  input: ProductAdminInput,
  actor: IUser,
): Promise<IProduct> {
  const normalizedInput = normalizeProductInput(input);
  await validateProductInput(normalizedInput, undefined, true, true);
  const slug = await uniqueProductSlug(input.slug ?? input.title);
  let product: IProduct;
  try {
    product = await Product.create({ ...normalizedInput, slug });
  } catch (error) {
    throw mapProductDuplicateError(error);
  }
  invalidateCatalogPublicCache();
  await logAuditEvent({
    actor,
    action: 'product.create',
    targetType: 'Product',
    targetId: product._id.toString(),
    metadata: { changedFields: Object.keys(normalizedInput) },
  });
  return product;
}

export async function updateProduct(
  id: string,
  input: Partial<ProductAdminInput>,
  actor: IUser,
): Promise<IProduct> {
  if (input.media !== undefined) {
    throw new AppError(
      'Product media must be managed using the dedicated media endpoints',
      400,
      'PRODUCT_MEDIA_USE_DEDICATED_ENDPOINTS',
    );
  }
  const product = await getAdminProduct(id);
  await assertNotCustomOfferProduct(product._id);
  const normalizedInput = normalizeProductInput(input);
  if (
    normalizedInput.currency !== undefined &&
    normalizedInput.currency !== product.currency
  ) {
    throw new AppError(
      'Product currency changes require the currency migration',
      409,
      'PRODUCT_CURRENCY_CHANGE_REQUIRES_MIGRATION',
    );
  }
  const data = {
    ...product.toObject(),
    ...normalizedInput,
  } as ProductAdminInput;
  const activating =
    normalizedInput.status === 'active' && product.status !== 'active';
  const validateLightingGallery =
    (normalizedInput.lightingGalleryEnabled === true &&
      product.lightingGalleryEnabled !== true) ||
    normalizedInput.category !== undefined ||
    activating;
  await validateProductInput(
    data,
    product._id.toString(),
    activating,
    validateLightingGallery,
  );

  if (normalizedInput.slug !== undefined) {
    product.slug = await uniqueProductSlug(
      normalizedInput.slug,
      product._id.toString(),
    );
  }
  const changedFields = Object.keys(normalizedInput);
  for (const [key, value] of Object.entries(normalizedInput)) {
    if (key !== 'slug') product.set(key, value);
  }
  try {
    await product.save();
  } catch (error) {
    throw mapProductDuplicateError(error);
  }
  invalidateCatalogPublicCache();
  await logAuditEvent({
    actor,
    action: 'product.update',
    targetType: 'Product',
    targetId: product._id.toString(),
    metadata: { changedFields },
  });
  return product;
}

function normalizeProductInput<T extends Partial<ProductAdminInput>>(
  input: T,
): T {
  if (input.productType !== 'canvas_paint_yourself') return input;
  return { ...input, artworkRequired: false };
}

export async function changeProductStatus(
  id: string,
  status: ProductStatus,
  actor: IUser,
): Promise<IProduct> {
  const product = await getAdminProduct(id);
  await assertNotCustomOfferProduct(product._id);
  if (!PRODUCT_STATUS.includes(status)) {
    throw new AppError('Invalid product status', 400, 'INVALID_PRODUCT_STATUS');
  }
  if (status === 'active') await validateActivation(product);
  const previousStatus = product.status;
  product.status = status;
  await product.save();
  invalidateCatalogPublicCache();
  await auditProductChange(actor, product, 'product.status_change', {
    changedFields: ['status'],
    from: previousStatus,
    to: status,
  });
  return product;
}

export async function changeProductStock(
  id: string,
  input: {
    mode: 'set' | 'adjust';
    quantity?: number;
    delta?: number;
    note: string;
  },
  actor: IUser,
): Promise<IProduct> {
  const product = await getAdminProduct(id);
  await assertNotCustomOfferProduct(product._id);
  const previousQuantity = product.stock.quantity;
  const quantity =
    input.mode === 'set'
      ? input.quantity
      : previousQuantity + (input.delta ?? 0);
  if (
    quantity === undefined ||
    !Number.isSafeInteger(quantity) ||
    quantity < 0
  ) {
    throw new AppError(
      'Stock quantity cannot be negative',
      400,
      'INVALID_STOCK_QUANTITY',
    );
  }

  product.stock.quantity = quantity;
  if (product.stock.trackInventory) {
    if (
      quantity === 0 &&
      !product.stock.allowBackorder &&
      !product.stock.reserveBlanksForMadeToOrder
    ) {
      if (product.status === 'active') product.status = 'out_of_stock';
    } else if (quantity > 0 && product.status === 'out_of_stock') {
      await validateActivation(product);
      product.status = 'active';
    }
  }
  await product.save();
  invalidateCatalogPublicCache();
  await auditProductChange(actor, product, 'product.stock_change', {
    changedFields: ['stock.quantity', 'status'],
    previousQuantity,
    quantity,
    note: input.note,
  });
  return product;
}

export async function deleteOrArchiveProduct(
  id: string,
  actor: IUser,
): Promise<{ archived: boolean }> {
  const product = await getAdminProduct(id);
  await assertNotCustomOfferProduct(product._id);
  const hasOrders = await Order.exists({ 'items.product': product._id });
  if (hasOrders) {
    product.status = 'archived';
    await product.save();
    invalidateCatalogPublicCache();
    await auditProductChange(actor, product, 'product.archive', {
      changedFields: ['status'],
      reason: 'product_has_order_history',
    });
    return { archived: true };
  }

  assertProductImageStorageConfigured(product.media);
  await deleteProductImages(product.media);
  await product.deleteOne();
  invalidateCatalogPublicCache();
  await logAuditEvent({
    actor,
    action: 'product.delete',
    targetType: 'Product',
    targetId: product._id.toString(),
    metadata: { slug: product.slug, sku: product.sku },
  });
  return { archived: false };
}

export async function bulkChangeProductStatus(
  ids: string[],
  status: ProductStatus,
  actor: IUser,
): Promise<{ updated: number }> {
  const products = await Product.find({ _id: { $in: ids } });
  if (products.length !== ids.length) {
    throw new AppError(
      'One or more products were not found',
      404,
      'PRODUCT_NOT_FOUND',
    );
  }
  if (
    await CustomOffer.exists({
      product: { $in: products.map((product) => product._id) },
    })
  ) {
    throw immutableCustomOfferProduct();
  }
  if (status === 'active') {
    for (const product of products) await validateActivation(product);
  }

  for (const product of products) {
    const previousStatus = product.status;
    product.status = status;
    await product.save();
    invalidateCatalogPublicCache();
    await auditProductChange(actor, product, 'product.bulk_status_change', {
      changedFields: ['status'],
      from: previousStatus,
      to: status,
    });
  }
  return { updated: products.length };
}

async function assertNotCustomOfferProduct(
  productId: mongoose.Types.ObjectId,
): Promise<void> {
  if (await CustomOffer.exists({ product: productId })) {
    throw immutableCustomOfferProduct();
  }
}

function immutableCustomOfferProduct(): AppError {
  return new AppError(
    'Private offer products are controlled by their custom offer',
    409,
    'CUSTOM_OFFER_PRODUCT_IMMUTABLE',
  );
}

async function validateProductInput(
  input: ProductAdminInput,
  excludeId?: string,
  validatePrimaryImages = true,
  validateLightingGallery = false,
): Promise<void> {
  const skuExists = await Product.exists({
    sku: input.sku.toUpperCase(),
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (skuExists)
    throw new AppError('SKU already exists', 409, 'SKU_ALREADY_EXISTS');

  if (
    !mongoose.isValidObjectId(input.category) ||
    !(await Category.exists({ _id: input.category }))
  ) {
    throw new AppError(
      'Product category does not exist',
      400,
      'CATEGORY_NOT_FOUND',
    );
  }
  if (input.lightingGalleryEnabled === true && validateLightingGallery) {
    const category = await Category.findById(input.category)
      .select('slug formProfile')
      .lean();
    if (
      category?.slug !== LIGHTING_GALLERY_CATEGORY_SLUG ||
      category.formProfile !== 'three_d_printed'
    ) {
      throw new AppError(
        'The ON/OFF lighting gallery is only available for products in the Lamps and Lighting category',
        400,
        'LIGHTING_GALLERY_UNSUPPORTED_CATEGORY',
      );
    }
  }
  if (!validOptionGroupsForProductType(input.productType, input.optionGroups)) {
    throw new AppError(
      'Option groups are not valid for this product type',
      400,
      'INVALID_OPTION_GROUP',
    );
  }

  if (
    input.media.length > PRODUCT_MEDIA_MAX_IMAGES &&
    (excludeId === undefined ||
      (input.lightingGalleryEnabled === true && validateLightingGallery))
  ) {
    throw new AppError(
      `A product cannot have more than ${PRODUCT_MEDIA_MAX_IMAGES} images`,
      400,
      'PRODUCT_IMAGE_LIMIT',
    );
  }

  if (validatePrimaryImages) {
    if (input.lightingGalleryEnabled === true) {
      validateLightingGalleryMedia(input.media);
      if (
        input.status === 'active' &&
        (!input.media.length ||
          PRODUCT_LIGHTING_STATES.some((state) => {
            const stateMedia = input.media.filter(
              (media) => media.lightingState === state,
            );
            return (
              stateMedia.length > 0 &&
              stateMedia.filter((media) => media.isPrimary).length !== 1
            );
          }))
      ) {
        throw new AppError(
          'An active lighting-gallery product requires one primary image for each configured lighting state',
          400,
          'LIGHTING_GALLERY_PRIMARY_REQUIRED',
        );
      }
    } else {
      const primaryCount = input.media.filter(
        (media) => media.isPrimary,
      ).length;
      if (primaryCount > 1) {
        throw new AppError(
          'Only one primary product image is allowed',
          400,
          'INVALID_PRIMARY_IMAGE',
        );
      }
      if (input.status === 'active' && primaryCount !== 1) {
        throw new AppError(
          'An active product requires exactly one primary image',
          400,
          'PRIMARY_IMAGE_REQUIRED',
        );
      }
    }
  }
  if (
    input.compareAtPriceMinor !== undefined &&
    input.compareAtPriceMinor <= input.basePriceMinor
  ) {
    throw new AppError(
      'Compare-at price must be greater than the base price',
      400,
      'INVALID_COMPARE_AT_PRICE',
    );
  }

  if (
    input.quantityPricing.some(
      (tier, index) =>
        index > 0 && tier.minQty <= input.quantityPricing[index - 1].minQty,
    )
  ) {
    throw new AppError(
      'Quantity pricing tiers must have strictly ascending minQty values',
      400,
      'INVALID_QUANTITY_TIERS',
    );
  }
  if (
    input.maxOrderQuantity !== undefined &&
    input.maxOrderQuantity < input.minOrderQuantity
  ) {
    throw new AppError(
      'Maximum order is less than minimum order',
      400,
      'INVALID_QUANTITY_LIMITS',
    );
  }
}

function validateLightingGalleryMedia(
  media: readonly {
    isPrimary?: boolean;
    lightingState?: ProductLightingState;
  }[],
): void {
  if (
    media.some(
      (image) =>
        !image.lightingState ||
        !PRODUCT_LIGHTING_STATES.includes(image.lightingState),
    )
  ) {
    throw new AppError(
      'Every image in an ON/OFF lighting gallery must have a lighting state',
      400,
      'LIGHTING_GALLERY_STATE_REQUIRED',
    );
  }
  const duplicatePrimaryState = PRODUCT_LIGHTING_STATES.find(
    (state) =>
      media.filter(
        (image) => image.lightingState === state && image.isPrimary === true,
      ).length > 1,
  );
  if (duplicatePrimaryState) {
    throw new AppError(
      'A lighting state cannot have more than one primary image',
      400,
      'INVALID_PRIMARY_IMAGE',
    );
  }
}

async function validateActivation(product: IProduct): Promise<void> {
  if (
    !Number.isInteger(product.basePriceMinor) ||
    product.basePriceMinor < 0 ||
    !product.category
  ) {
    throw new AppError(
      'Product needs a valid price and category before activation',
      400,
      'PRODUCT_NOT_READY',
    );
  }
  const category = await Category.findById(product.category)
    .select('slug formProfile')
    .lean();
  if (!category) {
    throw new AppError(
      'Product category does not exist',
      400,
      'CATEGORY_NOT_FOUND',
    );
  }
  if (product.lightingGalleryEnabled === true) {
    if (
      category.slug !== LIGHTING_GALLERY_CATEGORY_SLUG ||
      category.formProfile !== 'three_d_printed'
    ) {
      throw new AppError(
        'The ON/OFF lighting gallery is only available for products in the Lamps and Lighting category',
        400,
        'LIGHTING_GALLERY_UNSUPPORTED_CATEGORY',
      );
    }
    validateLightingGalleryMedia(product.media);
    if (
      product.media.length === 0 ||
      PRODUCT_LIGHTING_STATES.some((state) => {
        const stateMedia = product.media.filter(
          (media) => media.lightingState === state,
        );
        return (
          stateMedia.length > 0 &&
          stateMedia.filter((media) => media.isPrimary === true).length !== 1
        );
      })
    ) {
      throw new AppError(
        'An active lighting-gallery product requires one primary image for each configured lighting state',
        400,
        'LIGHTING_GALLERY_PRIMARY_REQUIRED',
      );
    }
    return;
  }
  if (!product.media.some((media) => media.isPrimary)) {
    throw new AppError(
      'Product needs a valid price, category, and primary image before activation',
      400,
      'PRODUCT_NOT_READY',
    );
  }
}

async function uniqueProductSlug(
  base: string,
  excludeId?: string,
): Promise<string> {
  const slugBase = slugify(base);
  if (!slugBase)
    throw new AppError('Product title cannot form a slug', 400, 'INVALID_SLUG');
  let candidate = slugBase;
  let suffix = 2;
  while (
    await Product.exists({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
  ) {
    candidate = `${slugBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function auditProductChange(
  actor: IUser,
  product: IProduct,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await logAuditEvent({
    actor,
    action,
    targetType: 'Product',
    targetId: product._id.toString(),
    metadata,
  });
}

function mapProductDuplicateError(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  ) {
    const keyPattern =
      'keyPattern' in error &&
      typeof error.keyPattern === 'object' &&
      error.keyPattern !== null
        ? error.keyPattern
        : {};
    if ('sku' in keyPattern) {
      return new AppError('SKU already exists', 409, 'SKU_ALREADY_EXISTS');
    }
    if ('slug' in keyPattern) {
      return new AppError(
        'Product slug already exists',
        409,
        'SLUG_ALREADY_EXISTS',
      );
    }
  }
  return error;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
