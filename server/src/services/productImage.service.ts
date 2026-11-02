import { randomUUID } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import mongoose from 'mongoose';

import { getCloudinary, isCloudinaryConfigured } from '../config/cloudinary';
import {
  CustomOffer,
  Product,
  type IProduct,
  type IProductMedia,
} from '../models';
import {
  LIGHTING_GALLERY_CATEGORY_SLUG,
  PRODUCT_LIGHTING_STATES,
  PRODUCT_MEDIA_MAX_IMAGES,
  type ProductLightingState,
  type ProductMediaView,
} from '../constants/product';
import { Category } from '../models/Category';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { detectFileType } from '../utils/fileType';
import { logger } from '../utils/logger';
import { logAuditEvent } from './audit.service';

export interface ProductImageInput {
  buffer: Buffer;
  alt: string;
  view: ProductMediaView;
  isPrimary?: boolean;
  lightingState?: ProductLightingState;
}

export interface ProductMediaUpdate {
  alt?: string;
  view?: ProductMediaView;
  isPrimary?: boolean;
  lightingState?: ProductLightingState;
}

export async function uploadProductImage(
  productId: string,
  input: ProductImageInput,
  actor: IUser,
): Promise<IProductMedia> {
  const cloud = getCloudinary();
  const product = await findProduct(productId);
  if (product.media.length >= PRODUCT_MEDIA_MAX_IMAGES) {
    throw new AppError(
      `A product cannot have more than ${PRODUCT_MEDIA_MAX_IMAGES} images`,
      400,
      'PRODUCT_IMAGE_LIMIT',
    );
  }
  const lightingGalleryEnabled = product.lightingGalleryEnabled === true;
  if (lightingGalleryEnabled) {
    await assertLightingGalleryEligible(product);
    if (!input.lightingState) {
      throw new AppError(
        'Choose whether this image shows the lamp light on or off',
        400,
        'LIGHTING_GALLERY_STATE_REQUIRED',
      );
    }
  } else if (input.lightingState !== undefined) {
    throw new AppError(
      'Enable the ON/OFF lighting gallery before assigning a lighting state',
      400,
      'LIGHTING_GALLERY_NOT_ENABLED',
    );
  }
  const mime = (await detectFileType(input.buffer))?.mime;
  const format =
    mime === 'image/jpeg'
      ? 'jpg'
      : mime === 'image/png'
        ? 'png'
        : mime === 'image/webp'
          ? 'webp'
          : undefined;
  if (!format) {
    throw new AppError(
      'Only JPEG, PNG, and WebP product images are allowed',
      415,
      'FILE_TYPE_NOT_ALLOWED',
    );
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(input.buffer, { failOn: 'error' }).metadata();
  } catch {
    throw new AppError('The image file is corrupt', 400, 'FILE_CORRUPT');
  }
  if (
    !metadata.width ||
    !metadata.height ||
    Math.min(metadata.width, metadata.height) < 600
  ) {
    throw new AppError(
      'Product images must be at least 600 pixels on the shortest side',
      400,
      'IMAGE_DIMENSIONS_TOO_SMALL',
    );
  }

  const publicId = randomUUID();
  let uploaded: {
    secure_url: string;
    public_id: string;
    width: number;
    height: number;
  };
  try {
    uploaded = await new Promise((resolve, reject) => {
      const stream = cloud.uploader.upload_stream(
        {
          folder: 'dainty-bloom/products',
          public_id: publicId,
          overwrite: false,
          resource_type: 'image',
          allowed_formats: ['jpg', 'png', 'webp'],
          timeout: 60_000,
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error('Cloudinary returned no image'));
            return;
          }
          resolve(result);
        },
      );
      stream.end(input.buffer);
    });
  } catch {
    throw new AppError(
      'Product image upload failed',
      502,
      'IMAGE_UPLOAD_FAILED',
    );
  }

  const media: IProductMedia = {
    url: uploaded.secure_url,
    publicId: uploaded.public_id,
    width: uploaded.width,
    height: uploaded.height,
    alt: input.alt,
    view: input.view,
    ...(input.lightingState ? { lightingState: input.lightingState } : {}),
    isPrimary: lightingGalleryEnabled
      ? !product.media.some(
          (image) =>
            image.lightingState === input.lightingState && image.isPrimary,
        ) || input.isPrimary === true
      : product.media.length === 0 || input.isPrimary === true,
    sortOrder: product.media.length,
  };
  if (media.isPrimary) {
    product.media.forEach((image) => {
      if (
        !lightingGalleryEnabled ||
        image.lightingState === media.lightingState
      ) {
        image.isPrimary = false;
      }
    });
  }
  product.media.push(media);
  if (product.status === 'active' && lightingGalleryEnabled) {
    assertActiveLightingGalleryIntegrity(product);
  }
  let savedProduct: IProduct;
  try {
    savedProduct = await persistProductMedia(product);
  } catch (error) {
    await destroyCloudinaryAsset(uploaded.public_id);
    throw error;
  }
  const saved = savedProduct.media[savedProduct.media.length - 1];
  await auditMediaChange(actor, product, 'product.media_upload', {
    mediaId: saved._id?.toString(),
    changedFields: ['media'],
  });
  return saved;
}

export async function updateProductImage(
  productId: string,
  mediaId: string,
  input: ProductMediaUpdate,
  actor: IUser,
): Promise<IProductMedia> {
  getCloudinary();
  const product = await findProduct(productId);
  const media = findMedia(product, mediaId);
  const lightingGalleryEnabled = product.lightingGalleryEnabled === true;
  if (input.lightingState !== undefined || lightingGalleryEnabled) {
    await assertLightingGalleryEligible(product);
  }
  if (input.lightingState !== undefined && !lightingGalleryEnabled) {
    throw new AppError(
      'Enable the ON/OFF lighting gallery before assigning a lighting state',
      400,
      'LIGHTING_GALLERY_NOT_ENABLED',
    );
  }
  if (
    lightingGalleryEnabled &&
    !media.lightingState &&
    input.isPrimary !== undefined
  ) {
    throw new AppError(
      'Assign this image to Light ON or Light OFF before changing its primary status',
      400,
      'LIGHTING_GALLERY_STATE_REQUIRED',
    );
  }
  const originalLightingState = media.lightingState;
  if (input.lightingState !== undefined) {
    const sourceWasPrimary = media.isPrimary;
    const destinationHasPrimary = product.media.some(
      (image) =>
        image !== media &&
        image.lightingState === input.lightingState &&
        image.isPrimary,
    );
    media.lightingState = input.lightingState;
    if (originalLightingState !== input.lightingState) {
      media.isPrimary =
        input.isPrimary === true ||
        (input.isPrimary !== false && !destinationHasPrimary);
      if (sourceWasPrimary && originalLightingState !== undefined) {
        const sourceImages = product.media.filter(
          (image) =>
            image !== media && image.lightingState === originalLightingState,
        );
        const replacement = sourceImages.reduce<IProductMedia | undefined>(
          (first, image) =>
            !first || (image.sortOrder ?? 0) < (first.sortOrder ?? 0)
              ? image
              : first,
          undefined,
        );
        sourceImages.forEach((image) => {
          image.isPrimary = image === replacement;
        });
      }
    } else if (!destinationHasPrimary && input.isPrimary !== false) {
      media.isPrimary = true;
    }
  }
  if (input.alt !== undefined) media.alt = input.alt;
  if (input.view !== undefined) media.view = input.view;
  if (input.isPrimary === true) {
    product.media.forEach((image) => {
      if (
        !lightingGalleryEnabled ||
        image.lightingState === media.lightingState
      ) {
        image.isPrimary = image._id?.equals(media._id) ?? false;
      }
    });
  } else if (
    input.isPrimary === false &&
    media.isPrimary &&
    product.status === 'active'
  ) {
    throw new AppError(
      'An active product must keep a primary image',
      409,
      'PRIMARY_IMAGE_REQUIRED',
    );
  }
  if (
    product.status === 'active' &&
    lightingGalleryEnabled &&
    (input.lightingState !== undefined ||
      input.isPrimary !== undefined ||
      originalLightingState !== media.lightingState)
  ) {
    assertActiveLightingGalleryIntegrity(product);
  }
  const updatedProduct = await persistProductMedia(product);
  await auditMediaChange(actor, product, 'product.media_update', {
    mediaId,
    changedFields: Object.keys(input),
  });
  return findMedia(updatedProduct, mediaId);
}

export async function reorderProductImages(
  productId: string,
  mediaIds: string[],
  actor: IUser,
): Promise<void> {
  getCloudinary();
  const product = await findProduct(productId);
  const existingIds = product.media.map((image) => image._id?.toString());
  if (
    mediaIds.length !== existingIds.length ||
    new Set(mediaIds).size !== mediaIds.length ||
    mediaIds.some((id) => !existingIds.includes(id))
  ) {
    throw new AppError(
      'mediaIds must contain each product image exactly once',
      400,
      'INVALID_MEDIA_ORDER',
    );
  }
  const imageMap = new Map(
    product.media.map((image) => [image._id?.toString(), image]),
  );
  product.media = mediaIds.map((id, sortOrder) => {
    const image = imageMap.get(id);
    if (!image)
      throw new AppError('Product image not found', 404, 'MEDIA_NOT_FOUND');
    image.sortOrder = sortOrder;
    return image;
  }) as typeof product.media;
  await persistProductMedia(product);
  await auditMediaChange(actor, product, 'product.media_reorder', {
    changedFields: ['sortOrder'],
  });
}

export async function deleteProductImage(
  productId: string,
  mediaId: string,
  actor: IUser,
): Promise<void> {
  getCloudinary();
  const product = await findProduct(productId);
  const media = findMedia(product, mediaId);
  if (
    product.status === 'active' &&
    product.media.length === 1 &&
    product.lightingGalleryEnabled !== true
  ) {
    throw new AppError(
      'The last image cannot be removed from an active product',
      409,
      'LAST_ACTIVE_PRODUCT_IMAGE',
    );
  }
  const removedWasPrimary = media.isPrimary;
  const publicId = media.publicId;
  product.media.splice(product.media.indexOf(media), 1);
  if (removedWasPrimary) {
    const candidates = product.media.filter(
      (image) =>
        product.lightingGalleryEnabled !== true ||
        image.lightingState === media.lightingState,
    );
    if (candidates[0]) {
      const nextPrimary = candidates.reduce((lowest, image) =>
        (image.sortOrder ?? 0) < (lowest.sortOrder ?? 0) ? image : lowest,
      );
      candidates.forEach((image) => {
        image.isPrimary = image._id?.equals(nextPrimary._id) ?? false;
      });
    }
  }
  if (product.status === 'active' && product.lightingGalleryEnabled === true) {
    assertActiveLightingGalleryIntegrity(product);
  }
  await persistProductMedia(product);
  if (publicId) {
    try {
      await destroyCloudinaryAsset(
        publicId,
        'IMAGE_DELETE_CLEANUP_FAILED',
        'Product image reference was removed, but Cloudinary cleanup failed',
      );
    } catch (error) {
      logger.error(
        { err: error, productId, mediaId },
        'Product image reference was removed but Cloudinary cleanup failed',
      );
      await auditMediaChange(actor, product, 'product.media_delete', {
        mediaId,
        changedFields: ['media'],
        storageCleanup: 'failed',
        storageCleanupCode:
          error instanceof AppError
            ? error.code
            : 'IMAGE_STORAGE_OPERATION_FAILED',
      });
      throw error;
    }
  }
  await auditMediaChange(actor, product, 'product.media_delete', {
    mediaId,
    changedFields: ['media'],
    storageCleanup: publicId ? 'succeeded' : 'not_applicable',
  });
}

export function assertProductImageStorageConfigured(
  media: readonly IProductMedia[],
): void {
  if (media.some((image) => image.publicId)) getCloudinary();
}

export async function deleteProductImages(
  media: readonly IProductMedia[],
): Promise<void> {
  const publicIds = media.flatMap((image) =>
    image.publicId ? [image.publicId] : [],
  );
  assertProductImageStorageConfigured(media);
  await Promise.all(
    publicIds.map((publicId) => destroyCloudinaryAsset(publicId)),
  );
}

export function buildImageUrl(
  publicId: string | undefined,
  preset: 'thumb' | 'medium' | 'large',
  fallbackUrl: string,
): string {
  if (!publicId) return fallbackUrl;
  if (!isCloudinaryConfigured()) return fallbackUrl;
  const widths = { thumb: 400, medium: 900, large: 1600 };
  return getCloudinary().url(publicId, {
    secure: true,
    transformation: [
      {
        width: widths[preset],
        crop: 'limit',
        fetch_format: 'auto',
        quality: 'auto',
        flags: 'strip_profile',
      },
    ],
  });
}

async function destroyCloudinaryAsset(
  publicId: string,
  code = 'IMAGE_STORAGE_OPERATION_FAILED',
  message = 'Product image storage operation failed',
): Promise<void> {
  try {
    const result = await getCloudinary().uploader.destroy(publicId, {
      invalidate: true,
      resource_type: 'image',
    });
    if (result.result !== 'ok' && result.result !== 'not found') {
      throw new Error('Cloudinary asset deletion was not confirmed');
    }
  } catch {
    throw new AppError(message, 502, code);
  }
}

async function persistProductMedia(product: IProduct): Promise<IProduct> {
  const updated = await Product.findOneAndUpdate(
    { _id: product._id, __v: product.__v },
    { $set: { media: product.media }, $inc: { __v: 1 } },
    { new: true, runValidators: true },
  );
  if (!updated) {
    throw new AppError(
      'Product images changed in another request. Reload the product and try again.',
      409,
      'PRODUCT_MEDIA_CONFLICT',
    );
  }
  return updated;
}

async function findProduct(id: string): Promise<IProduct> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }
  const product = await Product.findById(id);
  if (!product)
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  if (await CustomOffer.exists({ product: product._id })) {
    throw new AppError(
      'Private offer products are controlled by their custom offer',
      409,
      'CUSTOM_OFFER_PRODUCT_IMMUTABLE',
    );
  }
  return product;
}

async function assertLightingGalleryEligible(product: IProduct): Promise<void> {
  if (product.lightingGalleryEnabled !== true) {
    throw new AppError(
      'Enable the ON/OFF lighting gallery before managing lighting states',
      400,
      'LIGHTING_GALLERY_NOT_ENABLED',
    );
  }
  const category = await Category.findById(product.category)
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

function assertActiveLightingGalleryIntegrity(product: IProduct): void {
  if (
    product.media.some(
      (image) =>
        image.lightingState === undefined ||
        !PRODUCT_LIGHTING_STATES.includes(image.lightingState),
    )
  ) {
    throw new AppError(
      'Every image in an active ON/OFF gallery must have a lighting state',
      409,
      'LIGHTING_GALLERY_STATE_REQUIRED',
    );
  }
  if (
    PRODUCT_LIGHTING_STATES.some((state) => {
      const stateMedia = product.media.filter(
        (image) => image.lightingState === state,
      );
      return (
        stateMedia.length > 0 &&
        stateMedia.filter((image) => image.isPrimary).length !== 1
      );
    })
  ) {
    throw new AppError(
      'An active lighting-gallery product requires one primary image for each configured lighting state',
      409,
      'LIGHTING_GALLERY_PRIMARY_REQUIRED',
    );
  }
}

function findMedia(product: IProduct, id: string): IProductMedia {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Product image not found', 404, 'MEDIA_NOT_FOUND');
  }
  const media = product.media.find((image) => image._id?.toString() === id);
  if (!media)
    throw new AppError('Product image not found', 404, 'MEDIA_NOT_FOUND');
  return media;
}

async function auditMediaChange(
  actor: IUser,
  product: IProduct,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await logAuditEvent({
      actor,
      action,
      targetType: 'Product',
      targetId: product._id.toString(),
      metadata,
    });
  } catch (error) {
    logger.error(
      { err: error, action, productId: product._id.toString() },
      'Product media change succeeded but audit logging failed',
    );
  }
}
