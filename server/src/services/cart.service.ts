import { Types } from 'mongoose';

import { env } from '../config/env';
import {
  ArtworkAsset,
  Cart,
  Product,
  SiteSettings,
  type ICart,
  type ICartItem,
} from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { STORE_CURRENCY } from '../utils/currency';
import { calculateUnitPrice, validateQuantity } from './pricing.service';
import { publicProductFilter } from './productVisibility.service';
import { calculateDiscount } from './discount.service';
import {
  validateCartItems,
  type CartValidationResult,
} from './cartValidation.service';

export interface CartIdentity {
  user?: IUser;
  sessionId?: string;
}

export interface AddCartItemInput {
  productId: string;
  selectedOptions: Array<{ key: string; value: string }>;
  quantity: number;
  artworkId?: string;
}

export interface UpdateCartItemInput {
  quantity?: number;
  selectedOptions?: Array<{ key: string; value: string }>;
  artworkId?: string | null;
}

export interface CartView {
  items: CartValidationResult['lines'];
  totals: {
    subtotalMinor: number;
    discountMinor: number;
    estimatedShippingMinor: null;
    shippingCalculatedAtCheckout: true;
    totalMinor: number;
    currency: string;
    itemCount: number;
  };
  hasBlockingIssues: boolean;
}

const MAX_CART_LINES = 50;
const GUEST_CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function getCart(identity: CartIdentity): Promise<CartView> {
  const cart = await findCart(identity);
  const validation = await validateCartItems(
    cart?.items ?? [],
    toValidationIdentity(identity),
  );
  assertCartCurrency(cart, validation);
  const currency = cart?.currency ?? (await currentCurrency());
  const discount = calculateDiscount(validation.subtotalMinor);
  return {
    items: validation.lines,
    totals: {
      subtotalMinor: validation.subtotalMinor,
      discountMinor: discount.discountMinor,
      estimatedShippingMinor: null,
      shippingCalculatedAtCheckout: true,
      totalMinor: validation.subtotalMinor - discount.discountMinor,
      currency,
      itemCount: (cart?.items ?? []).reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
    },
    hasBlockingIssues: validation.hasBlockingIssues,
  };
}

export async function validateCurrentCart(
  identity: CartIdentity,
): Promise<CartValidationResult> {
  const cart = await findCart(identity);
  const validation = await validateCartItems(
    cart?.items ?? [],
    toValidationIdentity(identity),
  );
  assertCartCurrency(cart, validation);
  return validation;
}

export async function getCartSummary(identity: CartIdentity): Promise<{
  itemCount: number;
  subtotalMinor: number;
  currency: string;
}> {
  const [cart] = await Cart.aggregate<{
    itemCount: number;
    subtotalMinor: number;
    currency: string;
  }>([
    { $match: identityFilter(identity) },
    {
      $project: {
        currency: 1,
        itemCount: {
          $reduce: {
            input: { $ifNull: ['$items', []] },
            initialValue: 0,
            in: { $add: ['$$value', '$$this.quantity'] },
          },
        },
        subtotalMinor: {
          $reduce: {
            input: { $ifNull: ['$items', []] },
            initialValue: 0,
            in: {
              $add: [
                '$$value',
                {
                  $multiply: [
                    '$$this.unitPriceSnapshotMinor',
                    '$$this.quantity',
                  ],
                },
              ],
            },
          },
        },
      },
    },
    { $limit: 1 },
  ]);
  if (!cart) {
    return {
      itemCount: 0,
      subtotalMinor: 0,
      currency: await currentCurrency(),
    };
  }

  return {
    itemCount: cart.itemCount,
    subtotalMinor: cart.subtotalMinor,
    currency: cart.currency,
  };
}

export async function addCartItem(
  identity: CartIdentity,
  input: AddCartItemInput,
): Promise<void> {
  const product = await Product.findOne({
    $and: [{ _id: input.productId, status: 'active' }, publicProductFilter()],
  });
  if (!product) {
    throw new AppError(
      'Product not found or unavailable',
      404,
      'PRODUCT_UNAVAILABLE',
    );
  }
  if (product.currency !== STORE_CURRENCY) {
    throw new AppError(
      'This product is not available in the store currency',
      409,
      'PRODUCT_CURRENCY_MISMATCH',
    );
  }
  if (input.quantity > env.CART_MAX_QUANTITY) {
    throw new AppError(
      'Cart item quantity exceeds the maximum',
      400,
      'MAXIMUM_QUANTITY_EXCEEDED',
    );
  }

  const price = calculateUnitPrice(
    product,
    input.selectedOptions,
    input.quantity,
  );
  const artwork = input.artworkId
    ? await getOwnedArtwork(input.artworkId, identity)
    : undefined;
  const cart = await ensureCart(identity);
  const options = normalizeOptions(input.selectedOptions);
  const matchingLine = cart.items.find(
    (item) =>
      item.product.toString() === product._id.toString() &&
      sameOptions(item.selectedOptions, options),
  );
  const totalQuantity = (matchingLine?.quantity ?? 0) + input.quantity;
  validateQuantity(product, totalQuantity);

  const maxLineQuantity = Math.min(
    env.CART_MAX_QUANTITY,
    product.stock.trackInventory &&
      !product.stock.allowBackorder &&
      !product.stock.reserveBlanksForMadeToOrder
      ? product.stock.quantity
      : env.CART_MAX_QUANTITY,
  );
  const addItemId = matchingLine?._id ?? new Types.ObjectId();
  const primaryImage =
    product.media.find((media) => media.isPrimary)?.url ??
    product.media[0]?.url;

  await atomicAddLine(
    identityFilter(identity),
    {
      _id: addItemId,
      product: product._id,
      selectedOptions: options,
      quantity: input.quantity,
      artwork: artwork?._id,
      unitPriceSnapshotMinor: price.unitPriceMinor,
      titleSnapshot: product.title,
      imageSnapshot: primaryImage,
    },
    maxLineQuantity,
  );

  const updatedCart = await findCart(identity);
  const updatedLine = updatedCart?.items.find(
    (item) =>
      item.product.toString() === product._id.toString() &&
      sameOptions(item.selectedOptions, options),
  );
  if (!updatedLine) {
    throw new AppError(
      'Cart cannot contain more than 50 lines',
      400,
      'CART_LINE_LIMIT',
    );
  }
  if (artwork) {
    const supersededArtwork = await ArtworkAsset.findOne({
      cartItemId: updatedLine._id,
      _id: { $ne: artwork._id },
    }).select('_id');
    await ArtworkAsset.updateOne(
      { _id: artwork._id },
      {
        $set: {
          cartItemId: updatedLine._id,
          ...(supersededArtwork ? { supersedes: supersededArtwork._id } : {}),
        },
      },
    );
    if (supersededArtwork) {
      await ArtworkAsset.updateOne(
        { _id: supersededArtwork._id, cartItemId: updatedLine._id },
        { $unset: { cartItemId: 1 } },
      );
    }
  }
  await touchCart(identity);
}

export async function updateCartItem(
  identity: CartIdentity,
  itemId: string,
  input: UpdateCartItemInput,
): Promise<void> {
  const cart = await findCart(identity);
  const item = cart?.items.find((entry) => entry._id.toString() === itemId);
  if (!cart || !item)
    throw new AppError('Cart item not found', 404, 'CART_ITEM_NOT_FOUND');

  const product = await Product.findOne({
    $and: [{ _id: item.product, status: 'active' }, publicProductFilter()],
  });
  if (!product)
    throw new AppError(
      'Product not found or unavailable',
      404,
      'PRODUCT_UNAVAILABLE',
    );
  if (cart.currency !== STORE_CURRENCY || product.currency !== STORE_CURRENCY) {
    throw new AppError(
      'The cart currency has changed. Refresh your cart before editing it.',
      409,
      'CART_CURRENCY_MISMATCH',
    );
  }
  const quantity = input.quantity ?? item.quantity;
  if (quantity > env.CART_MAX_QUANTITY) {
    throw new AppError(
      'Cart item quantity exceeds the maximum',
      400,
      'MAXIMUM_QUANTITY_EXCEEDED',
    );
  }
  const selectedOptions = normalizeOptions(
    input.selectedOptions ?? item.selectedOptions,
  );
  const artwork =
    input.artworkId === null
      ? undefined
      : input.artworkId
        ? await getOwnedArtwork(input.artworkId, identity)
        : item.artwork
          ? await getOwnedArtwork(item.artwork.toString(), identity)
          : undefined;
  const price = calculateUnitPrice(product, selectedOptions, quantity);

  const itemUpdate: Record<string, unknown> = {
    'items.$.quantity': quantity,
    'items.$.selectedOptions': selectedOptions,
    'items.$.unitPriceSnapshotMinor': price.unitPriceMinor,
    'items.$.titleSnapshot': product.title,
    'items.$.imageSnapshot':
      product.media.find((media) => media.isPrimary)?.url ??
      product.media[0]?.url,
  };
  const updateOperators: Record<string, Record<string, unknown>> = {
    $set: itemUpdate,
  };
  if (artwork) itemUpdate['items.$.artwork'] = artwork._id;
  if (input.artworkId === null) {
    updateOperators.$unset = { 'items.$.artwork': 1 };
  }
  const result = await Cart.updateOne(
    { _id: cart._id, ...identityFilter(identity), 'items._id': item._id },
    updateOperators,
  );
  if (result.modifiedCount === 0) {
    throw new AppError(
      'Cart item changed; reload and retry',
      409,
      'CART_CHANGED',
    );
  }
  if (artwork) {
    await ArtworkAsset.updateOne(
      { _id: artwork._id },
      {
        $set: {
          cartItemId: item._id,
          ...(item.artwork && item.artwork.toString() !== artwork._id.toString()
            ? { supersedes: item.artwork }
            : {}),
        },
      },
    );
  }
  if (
    item.artwork &&
    (!artwork || item.artwork.toString() !== artwork._id.toString())
  ) {
    await ArtworkAsset.updateOne(
      { _id: item.artwork, cartItemId: item._id },
      { $unset: { cartItemId: 1 } },
    );
  }
  await touchCart(identity);
}

export async function removeCartItem(
  identity: CartIdentity,
  itemId: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(itemId)) {
    throw new AppError('Cart item not found', 404, 'CART_ITEM_NOT_FOUND');
  }
  const cart = await findCart(identity);
  const item = cart?.items.find((entry) => entry._id.toString() === itemId);
  if (!cart || !item) {
    throw new AppError('Cart item not found', 404, 'CART_ITEM_NOT_FOUND');
  }
  await Cart.updateOne(
    { _id: cart._id, ...identityFilter(identity) },
    { $pull: { items: { _id: itemId } }, $set: cartTouchUpdate(identity) },
  );
  if (item.artwork) {
    await ArtworkAsset.updateOne(
      { _id: item.artwork, cartItemId: item._id },
      { $unset: { cartItemId: 1 } },
    );
  }
}

export async function clearCart(identity: CartIdentity): Promise<void> {
  const cart = await findCart(identity);
  if (cart) {
    const itemIds = cart.items.map((item) => item._id);
    const artworkIds = cart.items.flatMap((item) =>
      item.artwork ? [item.artwork] : [],
    );
    await ArtworkAsset.updateMany(
      { _id: { $in: artworkIds }, cartItemId: { $in: itemIds } },
      { $unset: { cartItemId: 1 } },
    );
    await Cart.updateOne(
      { _id: cart._id, ...identityFilter(identity) },
      { $set: { items: [], ...cartTouchUpdate(identity) } },
    );
  }
}

export async function mergeGuestCart(
  user: IUser,
  guestSessionId?: string,
): Promise<void> {
  if (!guestSessionId) return;
  const guestCart = await Cart.findOne({ sessionId: guestSessionId });
  if (!guestCart) return;
  if (guestCart.currency !== STORE_CURRENCY) {
    throw new AppError(
      'The guest cart currency has changed and cannot be merged safely',
      409,
      'CART_CURRENCY_MISMATCH',
    );
  }

  const userIdentity: CartIdentity = { user };
  const userCart = await ensureCart(userIdentity);
  for (const guestItem of guestCart.items) {
    const product = await Product.findOne({
      $and: [
        { _id: guestItem.product, status: 'active' },
        publicProductFilter(),
      ],
    })
      .select('_id')
      .lean();
    if (!product) {
      throw new AppError(
        'The guest cart contains a product that is no longer available',
        409,
        'PRODUCT_UNAVAILABLE',
      );
    }
    const selectedOptions = normalizeOptions(guestItem.selectedOptions);
    const beforeMerge = await findCart(userIdentity);
    const existingLine = beforeMerge?.items.find(
      (item) =>
        item.product.toString() === guestItem.product.toString() &&
        sameOptions(item.selectedOptions, selectedOptions),
    );
    await atomicMergeLine(userCart._id, guestItem);
    const mergedCart = await findCart(userIdentity);
    const mergedLine = mergedCart?.items.find(
      (item) =>
        item.product.toString() === guestItem.product.toString() &&
        sameOptions(item.selectedOptions, selectedOptions),
    );
    if (!mergedLine) {
      throw new AppError(
        'The guest cart could not be merged because the user cart is full',
        409,
        'CART_LINE_LIMIT',
      );
    }
    if (guestItem.artwork) {
      const artworkUpdate = await ArtworkAsset.updateOne(
        {
          _id: guestItem.artwork,
          sessionId: guestSessionId,
          owner: { $exists: false },
        },
        {
          $set: {
            owner: user._id,
            cartItemId: mergedLine._id,
            ...(existingLine?.artwork &&
            existingLine.artwork.toString() !== guestItem.artwork.toString()
              ? { supersedes: existingLine.artwork }
              : {}),
          },
          $unset: { sessionId: 1 },
        },
      );
      if (
        artworkUpdate.modifiedCount > 0 &&
        existingLine?.artwork &&
        existingLine.artwork.toString() !== guestItem.artwork.toString()
      ) {
        await ArtworkAsset.updateOne(
          { _id: existingLine.artwork, cartItemId: mergedLine._id },
          { $unset: { cartItemId: 1 } },
        );
      }
    }
  }

  await Cart.deleteOne({ _id: guestCart._id, sessionId: guestSessionId });
}

export async function addProductToCart(
  identity: CartIdentity,
  input: AddCartItemInput,
): Promise<void> {
  await addCartItem(identity, input);
}

async function ensureCart(identity: CartIdentity): Promise<ICart> {
  const filter = identityFilter(identity);
  try {
    const cart = await Cart.findOneAndUpdate(
      filter,
      {
        $setOnInsert: {
          ...filter,
          currency: await currentCurrency(),
          items: [],
        },
        ...(identity.user
          ? { $unset: { expiresAt: 1 } }
          : { $set: { expiresAt: guestExpiry() } }),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    if (!cart)
      throw new AppError(
        'Could not initialize cart',
        500,
        'CART_INITIALIZATION_FAILED',
      );
    if (cart.currency !== STORE_CURRENCY) {
      throw new AppError(
        'The cart currency has changed. Refresh your cart before adding items.',
        409,
        'CART_CURRENCY_MISMATCH',
      );
    }
    return cart;
  } catch (error) {
    if (isDuplicateKey(error)) {
      const existing = await Cart.findOne(filter);
      if (existing && existing.currency === STORE_CURRENCY) return existing;
      if (existing) {
        throw new AppError(
          'The cart currency has changed. Refresh your cart before adding items.',
          409,
          'CART_CURRENCY_MISMATCH',
        );
      }
    }
    throw error;
  }
}

async function findCart(identity: CartIdentity): Promise<ICart | null> {
  return Cart.findOne(identityFilter(identity));
}

async function getOwnedArtwork(id: string, identity: CartIdentity) {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
  }
  const scope = identity.user
    ? { owner: identity.user._id }
    : { sessionId: identity.sessionId };
  const artwork = await ArtworkAsset.findOne({ _id: id, ...scope }).select(
    '_id',
  );
  if (!artwork)
    throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
  return artwork;
}

async function atomicAddLine(
  filter: Record<string, unknown>,
  item: Record<string, unknown>,
  maximumQuantity: number,
): Promise<void> {
  const sameLine = {
    $and: [
      { $eq: ['$$line.product', item.product] },
      { $eq: ['$$line.selectedOptions', item.selectedOptions] },
    ],
  };
  const oldItems = { $ifNull: ['$items', []] };
  await Cart.collection.updateOne(
    filter,
    [
      {
        $set: {
          items: {
            $let: {
              vars: {
                matching: {
                  $filter: { input: oldItems, as: 'line', cond: sameLine },
                },
              },
              in: {
                $cond: [
                  { $gt: [{ $size: '$$matching' }, 0] },
                  {
                    $map: {
                      input: oldItems,
                      as: 'line',
                      in: {
                        $cond: [
                          sameLine,
                          {
                            $mergeObjects: [
                              '$$line',
                              {
                                quantity: {
                                  $min: [
                                    maximumQuantity,
                                    {
                                      $add: ['$$line.quantity', item.quantity],
                                    },
                                  ],
                                },
                                unitPriceSnapshotMinor:
                                  item.unitPriceSnapshotMinor,
                                titleSnapshot: item.titleSnapshot,
                                imageSnapshot: item.imageSnapshot,
                                ...(item.artwork
                                  ? { artwork: item.artwork }
                                  : {}),
                              },
                            ],
                          },
                          '$$line',
                        ],
                      },
                    },
                  },
                  {
                    $cond: [
                      { $lt: [{ $size: oldItems }, MAX_CART_LINES] },
                      { $concatArrays: [oldItems, [item]] },
                      oldItems,
                    ],
                  },
                ],
              },
            },
          },
          updatedAt: new Date(),
          ...(filter.sessionId ? { expiresAt: guestExpiry() } : {}),
        },
      },
    ],
    { upsert: true },
  );
}

async function atomicMergeLine(
  cartId: Types.ObjectId,
  item: ICartItem,
): Promise<void> {
  const options = normalizeOptions(item.selectedOptions);
  const sameLine = {
    $and: [
      { $eq: ['$$line.product', item.product] },
      { $eq: ['$$line.selectedOptions', options] },
    ],
  };
  const oldItems = { $ifNull: ['$items', []] };
  const mergedGuestItemIds = {
    $ifNull: ['$mergedGuestItemIds', []],
  };
  const matchingGuestLines = {
    $filter: { input: oldItems, as: 'line', cond: sameLine },
  };
  await Cart.collection.updateOne({ _id: cartId }, [
    {
      $set: {
        items: {
          $cond: [
            { $in: [item._id, mergedGuestItemIds] },
            oldItems,
            {
              $let: {
                vars: {
                  matching: {
                    $filter: { input: oldItems, as: 'line', cond: sameLine },
                  },
                },
                in: {
                  $cond: [
                    { $gt: [{ $size: '$$matching' }, 0] },
                    {
                      $map: {
                        input: oldItems,
                        as: 'line',
                        in: {
                          $cond: [
                            sameLine,
                            {
                              $mergeObjects: [
                                '$$line',
                                {
                                  quantity: {
                                    $min: [
                                      env.CART_MAX_QUANTITY,
                                      {
                                        $add: [
                                          '$$line.quantity',
                                          item.quantity,
                                        ],
                                      },
                                    ],
                                  },
                                  ...(item.artwork
                                    ? { artwork: item.artwork }
                                    : {}),
                                },
                              ],
                            },
                            '$$line',
                          ],
                        },
                      },
                    },
                    {
                      $cond: [
                        {
                          $lt: [{ $size: oldItems }, MAX_CART_LINES],
                        },
                        {
                          $concatArrays: [
                            oldItems,
                            [
                              {
                                _id: item._id,
                                product: item.product,
                                selectedOptions: options,
                                quantity: item.quantity,
                                artwork: item.artwork,
                                unitPriceSnapshotMinor:
                                  item.unitPriceSnapshotMinor,
                                titleSnapshot: item.titleSnapshot,
                                imageSnapshot: item.imageSnapshot,
                              },
                            ],
                          ],
                        },
                        oldItems,
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
        mergedGuestItemIds: {
          $cond: [
            {
              $or: [
                { $in: [item._id, mergedGuestItemIds] },
                { $gt: [{ $size: matchingGuestLines }, 0] },
                { $lt: [{ $size: oldItems }, MAX_CART_LINES] },
              ],
            },
            { $setUnion: [mergedGuestItemIds, [item._id]] },
            mergedGuestItemIds,
          ],
        },
        updatedAt: new Date(),
      },
    },
    { $unset: 'expiresAt' },
  ]);
}

async function touchCart(identity: CartIdentity): Promise<void> {
  await Cart.updateOne(identityFilter(identity), {
    $set: cartTouchUpdate(identity),
  });
}

function cartTouchUpdate(identity: CartIdentity): Record<string, unknown> {
  return identity.user
    ? { updatedAt: new Date() }
    : { updatedAt: new Date(), expiresAt: guestExpiry() };
}

function identityFilter(identity: CartIdentity): Record<string, unknown> {
  if (identity.user) return { user: identity.user._id };
  if (identity.sessionId) return { sessionId: identity.sessionId };
  throw new AppError('Cart identity is missing', 401, 'UNAUTHENTICATED');
}

function toValidationIdentity(identity: CartIdentity) {
  return {
    userId: identity.user?._id.toString(),
    sessionId: identity.sessionId,
  };
}

function normalizeOptions(
  options: readonly { key: string; value: string }[],
): Array<{ key: string; value: string }> {
  return [...options]
    .map(({ key, value }) => ({ key, value }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function sameOptions(
  left: readonly { key: string; value: string }[],
  right: readonly { key: string; value: string }[],
): boolean {
  return JSON.stringify(normalizeOptions(left)) === JSON.stringify(right);
}

function guestExpiry(): Date {
  return new Date(Date.now() + GUEST_CART_TTL_MS);
}

async function currentCurrency(): Promise<string> {
  const settings = await SiteSettings.findOne({ key: 'default' })
    .select('currency')
    .lean();
  const currency = settings?.currency ?? env.DEFAULT_CURRENCY;
  if (currency !== STORE_CURRENCY) {
    throw new AppError(
      'Store currency is not configured for shopping',
      503,
      'STORE_CURRENCY_MISMATCH',
    );
  }
  return currency;
}

function assertCartCurrency(
  cart: ICart | null,
  validation: CartValidationResult,
): void {
  if (
    (cart && cart.currency !== STORE_CURRENCY) ||
    validation.lines.some((line) =>
      line.issues.some((issue) => issue.code === 'CURRENCY_MISMATCH'),
    )
  ) {
    throw new AppError(
      'Your cart contains an unsupported currency. Refresh or rebuild it before shopping.',
      409,
      'CART_CURRENCY_MISMATCH',
    );
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
