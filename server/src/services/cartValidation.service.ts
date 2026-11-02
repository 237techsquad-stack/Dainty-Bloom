import mongoose, { type Types } from 'mongoose';

import {
  ArtworkAsset,
  Product,
  type ICartItem,
  type IProduct,
} from '../models';
import type { IArtworkAsset } from '../models/ArtworkAsset';
import { AppError } from '../utils/AppError';
import { calculateUnitPrice } from './pricing.service';
import { isPublicProduct } from './productVisibility.service';

export type CartIssueCode =
  | 'PRICE_CHANGED'
  | 'CURRENCY_MISMATCH'
  | 'PRODUCT_UNAVAILABLE'
  | 'INSUFFICIENT_STOCK'
  | 'ARTWORK_REQUIRED'
  | 'OPTION_NO_LONGER_AVAILABLE'
  | 'INVALID_QUANTITY';

export interface CartIssue {
  code: CartIssueCode;
  message: string;
  oldPriceMinor?: number;
  newPriceMinor?: number;
  blocking: boolean;
}

export interface ValidatedCartLine {
  itemId: string;
  productId: string;
  slug: string | null;
  title: string;
  image: string | null;
  selectedOptions: Array<{
    key: string;
    label: string;
    value: string;
    valueLabel: string;
  }>;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  artworkStatus:
    | 'none'
    | 'uploaded'
    | 'pending_review'
    | 'approved'
    | 'replacement_requested'
    | 'missing_but_required';
  artworkRequired: boolean;
  artworkAccepted: boolean;
  artworkRequirements: {
    allowedFormats: string[];
    notes?: string;
    minimumResolutionNote?: string;
  };
  artwork: {
    id: string;
    originalFilename: string;
    detectedMimeType: string;
    previewUrl?: string;
    reviewStatus: string;
  } | null;
  availability: 'ok' | 'low_stock' | 'out_of_stock' | 'unavailable';
  issues: CartIssue[];
}

export interface CartValidationResult {
  lines: ValidatedCartLine[];
  subtotalMinor: number;
  hasBlockingIssues: boolean;
}

type CurrentProduct = Pick<
  IProduct,
  | 'title'
  | 'slug'
  | 'status'
  | 'media'
  | 'basePriceMinor'
  | 'currency'
  | 'optionGroups'
  | 'quantityPricing'
  | 'stock'
  | 'minOrderQuantity'
  | 'maxOrderQuantity'
  | 'artworkRequired'
  | 'artworkRequirements'
  | 'visibility'
> & { _id: Types.ObjectId };

export async function validateCartItems(
  cartItems: readonly ICartItem[],
  identity: { userId?: string; sessionId?: string },
): Promise<CartValidationResult> {
  const productIds = cartItems.map((item) => item.product);
  const products = await Product.find({ _id: { $in: productIds } })
    .select(
      'title slug status visibility media basePriceMinor currency optionGroups quantityPricing stock minOrderQuantity maxOrderQuantity artworkRequired artworkRequirements',
    )
    .lean<CurrentProduct[]>();
  const productMap = new Map(
    products.map((product) => [product._id.toString(), product]),
  );
  const artworkIds = cartItems.flatMap((item) =>
    item.artwork ? [item.artwork] : [],
  );
  const artworks = await ArtworkAsset.find({ _id: { $in: artworkIds } })
    .select('owner sessionId reviewStatus originalFilename detectedMimeType')
    .lean();
  const artworkMap = new Map(
    artworks.map((artwork) => [artwork._id.toString(), artwork]),
  );

  const lines: ValidatedCartLine[] = [];
  let subtotalMinor = 0;

  for (const item of cartItems) {
    const product = productMap.get(item.product.toString());
    if (!product || product.status !== 'active' || !isPublicProduct(product)) {
      lines.push(
        product && !isPublicProduct(product)
          ? unavailableLine(item, undefined, true)
          : unavailableLine(item, product),
      );
      continue;
    }

    const issues: CartIssue[] = [];
    if (product.currency !== 'GBP') {
      issues.push({
        code: 'CURRENCY_MISMATCH',
        message: 'This product currency is not supported for checkout',
        blocking: true,
      });
    }
    let unitPriceMinor = 0;
    let lineTotalMinor = 0;
    let options: ValidatedCartLine['selectedOptions'] = [];
    try {
      const pricing = calculateUnitPrice(
        product,
        item.selectedOptions,
        item.quantity,
      );
      unitPriceMinor = pricing.unitPriceMinor;
      lineTotalMinor = pricing.lineTotalMinor;
      options = humanReadableOptions(product, item.selectedOptions);
      if (item.unitPriceSnapshotMinor !== unitPriceMinor) {
        issues.push({
          code: 'PRICE_CHANGED',
          message: 'The product price has changed',
          oldPriceMinor: item.unitPriceSnapshotMinor,
          newPriceMinor: unitPriceMinor,
          blocking: false,
        });
      }
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      if (error.code === 'INSUFFICIENT_STOCK') {
        issues.push({
          code: 'INSUFFICIENT_STOCK',
          message: error.message,
          blocking: true,
        });
        try {
          unitPriceMinor = calculateUnitPrice(
            {
              ...product,
              stock: { ...product.stock, allowBackorder: true },
            },
            item.selectedOptions,
            item.quantity,
          ).unitPriceMinor;
          lineTotalMinor = unitPriceMinor * item.quantity;
          options = humanReadableOptions(product, item.selectedOptions);
        } catch (pricingError) {
          if (
            !(pricingError instanceof AppError) ||
            pricingError.code !== 'INVALID_OPTION_SELECTION'
          ) {
            throw pricingError;
          }
          issues.push(optionIssue());
        }
      } else if (error.code === 'INVALID_OPTION_SELECTION') {
        issues.push(optionIssue());
      } else if (
        error.code === 'INVALID_QUANTITY' ||
        error.code === 'MINIMUM_QUANTITY_NOT_MET' ||
        error.code === 'MAXIMUM_QUANTITY_EXCEEDED'
      ) {
        issues.push({
          code: 'INVALID_QUANTITY',
          message: error.message,
          blocking: true,
        });
      } else {
        throw error;
      }
    }

    const artwork = item.artwork
      ? artworkMap.get(item.artwork.toString())
      : undefined;
    const artworkIsOwned = artwork ? isOwnedArtwork(artwork, identity) : false;
    const artworkStatus = getArtworkStatus(
      product,
      artworkIsOwned ? artwork : undefined,
    );
    if (product.artworkRequired && !artworkIsOwned) {
      issues.push({
        code: 'ARTWORK_REQUIRED',
        message: artwork
          ? 'Artwork is not accessible to this cart'
          : 'Artwork is required',
        blocking: true,
      });
    }
    if (artworkIsOwned && artwork?.reviewStatus === 'replacement_requested') {
      issues.push({
        code: 'ARTWORK_REQUIRED',
        message: 'Replacement artwork is required before checkout',
        blocking: true,
      });
    }

    const available = product.stock.trackInventory
      ? product.stock.quantity
      : Number.POSITIVE_INFINITY;
    const availability = issues.some(
      (issue) => issue.code === 'INSUFFICIENT_STOCK',
    )
      ? 'out_of_stock'
      : product.stock.trackInventory &&
          available <= product.stock.lowStockThreshold &&
          available > 0
        ? 'low_stock'
        : product.stock.trackInventory && available <= 0
          ? product.stock.allowBackorder ||
            product.stock.reserveBlanksForMadeToOrder
            ? 'ok'
            : 'out_of_stock'
          : 'ok';

    subtotalMinor += lineTotalMinor;
    lines.push({
      itemId: item._id.toString(),
      productId: product._id.toString(),
      slug: product.slug,
      title: product.title,
      image:
        product.media.find((media) => media.isPrimary)?.url ??
        product.media[0]?.url ??
        null,
      selectedOptions: options,
      quantity: item.quantity,
      unitPriceMinor,
      lineTotalMinor,
      artworkStatus,
      artworkRequired: product.artworkRequired,
      artworkAccepted:
        product.artworkRequired ||
        product.artworkRequirements.allowedFormats.length > 0 ||
        Boolean(
          product.artworkRequirements.notes ||
          product.artworkRequirements.minimumResolutionNote,
        ),
      artworkRequirements: {
        allowedFormats: product.artworkRequirements.allowedFormats,
        ...(product.artworkRequirements.notes
          ? { notes: product.artworkRequirements.notes }
          : {}),
        ...(product.artworkRequirements.minimumResolutionNote
          ? {
              minimumResolutionNote:
                product.artworkRequirements.minimumResolutionNote,
            }
          : {}),
      },
      artwork:
        artworkIsOwned && artwork
          ? {
              id: artwork._id.toString(),
              originalFilename: artwork.originalFilename,
              detectedMimeType: artwork.detectedMimeType,
              ...(artwork.detectedMimeType.startsWith('image/') &&
              artwork.detectedMimeType !== 'image/svg+xml'
                ? {
                    previewUrl: `/api/artwork/${artwork._id.toString()}/preview`,
                  }
                : {}),
              reviewStatus: artwork.reviewStatus,
            }
          : null,
      availability,
      issues,
    });
  }

  return {
    lines,
    subtotalMinor,
    hasBlockingIssues: lines.some((line) =>
      line.issues.some((issue) => issue.blocking),
    ),
  };
}

function unavailableLine(
  item: ICartItem,
  product?: CurrentProduct,
  hideProductDetails = false,
): ValidatedCartLine {
  return {
    itemId: item._id.toString(),
    productId: item.product.toString(),
    slug: hideProductDetails ? null : (product?.slug ?? null),
    title: hideProductDetails
      ? 'Unavailable product'
      : (product?.title ?? item.titleSnapshot),
    image:
      (hideProductDetails
        ? undefined
        : (product?.media.find((media) => media.isPrimary)?.url ??
          item.imageSnapshot)) ?? null,
    selectedOptions: [],
    quantity: item.quantity,
    unitPriceMinor: 0,
    lineTotalMinor: 0,
    artworkStatus: 'none',
    artworkRequired: product?.artworkRequired ?? false,
    artworkAccepted: product
      ? product.artworkRequired ||
        product.artworkRequirements.allowedFormats.length > 0 ||
        Boolean(
          product.artworkRequirements.notes ||
          product.artworkRequirements.minimumResolutionNote,
        )
      : false,
    artworkRequirements: {
      allowedFormats: product?.artworkRequirements.allowedFormats ?? [],
      ...(product?.artworkRequirements.notes
        ? { notes: product.artworkRequirements.notes }
        : {}),
      ...(product?.artworkRequirements.minimumResolutionNote
        ? {
            minimumResolutionNote:
              product.artworkRequirements.minimumResolutionNote,
          }
        : {}),
    },
    artwork: null,
    availability: 'unavailable',
    issues: [
      {
        code: 'PRODUCT_UNAVAILABLE',
        message: 'This product is no longer available',
        blocking: true,
      },
    ],
  };
}

function humanReadableOptions(
  product: CurrentProduct,
  selected: readonly { key: string; value: string }[],
): ValidatedCartLine['selectedOptions'] {
  return selected.map((option) => {
    const group = product.optionGroups.find(
      (entry) => entry.key === option.key,
    );
    const value = group?.values.find((entry) => entry.value === option.value);
    if (!group || !value || !value.isAvailable) throw optionIssueError();
    return {
      key: option.key,
      label: group.label,
      value: option.value,
      valueLabel: value.label,
    };
  });
}

function getArtworkStatus(
  product: CurrentProduct,
  artwork?: Pick<IArtworkAsset, 'reviewStatus'>,
): ValidatedCartLine['artworkStatus'] {
  if (!artwork)
    return product.artworkRequired ? 'missing_but_required' : 'none';
  switch (artwork.reviewStatus) {
    case 'approved':
      return 'approved';
    case 'replacement_requested':
      return 'replacement_requested';
    default:
      return 'pending_review';
  }
}

function isOwnedArtwork(
  artwork: Pick<IArtworkAsset, 'owner' | 'sessionId'>,
  identity: { userId?: string; sessionId?: string },
): boolean {
  return identity.userId
    ? artwork.owner?.toString() === identity.userId
    : Boolean(identity.sessionId && artwork.sessionId === identity.sessionId);
}

function optionIssue(): CartIssue {
  return {
    code: 'OPTION_NO_LONGER_AVAILABLE',
    message: 'A selected option is no longer available',
    blocking: true,
  };
}

function optionIssueError(): AppError {
  return new AppError(
    'A selected option is no longer available',
    400,
    'INVALID_OPTION_SELECTION',
  );
}

export function isValidObjectId(value: string): boolean {
  return mongoose.isValidObjectId(value);
}
