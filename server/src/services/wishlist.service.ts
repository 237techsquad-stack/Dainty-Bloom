import { Types } from 'mongoose';

import { Product, Wishlist, type IWishlist } from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { toCatalogCard, type CatalogCardProduct } from './catalog.service';
import { publicProductFilter } from './productVisibility.service';
import type { CartIdentity } from './cart.service';
import { addProductToCart, type AddCartItemInput } from './cart.service';

export async function getWishlist(identity: CartIdentity): Promise<{
  products: unknown[];
  count: number;
  removedCount: number;
}> {
  const wishlist = await findWishlist(identity);
  if (!wishlist) return { products: [], count: 0, removedCount: 0 };

  const activeProducts = await Product.find({
    $and: [
      { _id: { $in: wishlist.products }, status: 'active' },
      publicProductFilter(),
    ],
  })
    .select(
      'title description slug category productType media lightingGalleryEnabled basePriceMinor compareAtPriceMinor currency optionGroups quantityPricing stock ratingAverage ratingCount isFeatured artworkRequired',
    )
    .populate({ path: 'category', select: 'name slug formProfile' })
    .lean<CatalogCardProduct[]>();
  const activeIds = new Set(
    activeProducts.map((product) => product._id.toString()),
  );
  const removedCount = wishlist.products.filter(
    (productId) => !activeIds.has(productId.toString()),
  ).length;

  if (removedCount > 0) {
    await Wishlist.updateOne(
      { _id: wishlist._id, ...identityFilter(identity) },
      {
        $pull: {
          products: { $nin: activeProducts.map((product) => product._id) },
        },
      },
    );
  }

  return {
    products: activeProducts.map(toCatalogCard),
    count: activeProducts.length,
    removedCount,
  };
}

export async function addToWishlist(
  identity: CartIdentity,
  productId: string,
): Promise<void> {
  const product = await Product.findOne({
    $and: [{ _id: productId, status: 'active' }, publicProductFilter()],
  }).select('_id');
  if (!product) {
    throw new AppError(
      'Product not found or unavailable',
      404,
      'PRODUCT_UNAVAILABLE',
    );
  }
  const wishlist = await ensureWishlist(identity);
  await Wishlist.updateOne(
    { _id: wishlist._id, ...identityFilter(identity) },
    { $addToSet: { products: product._id }, $set: { updatedAt: new Date() } },
  );
}

export async function removeFromWishlist(
  identity: CartIdentity,
  productId: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(productId)) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }
  await Wishlist.updateOne(identityFilter(identity), {
    $pull: { products: new Types.ObjectId(productId) },
    $set: { updatedAt: new Date() },
  });
}

export async function getWishlistCount(
  identity: CartIdentity,
): Promise<number> {
  const wishlist = await findWishlist(identity);
  if (!wishlist?.products.length) return 0;
  return Product.countDocuments({
    $and: [
      { _id: { $in: wishlist.products }, status: 'active' },
      publicProductFilter(),
    ],
  });
}

export async function moveWishlistItemToCart(
  identity: CartIdentity,
  input: AddCartItemInput,
): Promise<void> {
  const wishlist = await findWishlist(identity);
  if (!wishlist?.products.some((id) => id.toString() === input.productId)) {
    throw new AppError(
      'Wishlist item not found',
      404,
      'WISHLIST_ITEM_NOT_FOUND',
    );
  }
  const product = await Product.findOne({
    $and: [{ _id: input.productId, status: 'active' }, publicProductFilter()],
  })
    .select('_id')
    .lean();
  if (!product) {
    throw new AppError(
      'Product not found or unavailable',
      404,
      'PRODUCT_UNAVAILABLE',
    );
  }
  await addProductToCart(identity, input);
  await Wishlist.updateOne(
    { _id: wishlist._id, ...identityFilter(identity) },
    { $pull: { products: new Types.ObjectId(input.productId) } },
  );
}

export async function mergeGuestWishlist(
  user: IUser,
  guestSessionId?: string,
): Promise<void> {
  if (!guestSessionId) return;
  const guest = await Wishlist.findOne({ sessionId: guestSessionId });
  if (!guest) return;
  const userWishlist = await ensureWishlist({ user });
  await Wishlist.updateOne(
    { _id: userWishlist._id, user: user._id },
    { $addToSet: { products: { $each: guest.products } } },
  );
  await Wishlist.deleteOne({ _id: guest._id, sessionId: guestSessionId });
}

async function ensureWishlist(identity: CartIdentity): Promise<IWishlist> {
  const filter = identityFilter(identity);
  try {
    const wishlist = await Wishlist.findOneAndUpdate(
      filter,
      { $setOnInsert: { ...filter, products: [] } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    if (!wishlist) {
      throw new AppError(
        'Could not initialize wishlist',
        500,
        'WISHLIST_INITIALIZATION_FAILED',
      );
    }
    return wishlist;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    ) {
      const existing = await Wishlist.findOne(filter);
      if (existing) return existing;
    }
    throw error;
  }
}

async function findWishlist(identity: CartIdentity): Promise<IWishlist | null> {
  return Wishlist.findOne(identityFilter(identity));
}

function identityFilter(identity: CartIdentity): Record<string, unknown> {
  if (identity.user) return { user: identity.user._id };
  if (identity.sessionId) return { sessionId: identity.sessionId };
  throw new AppError('Wishlist identity is missing', 401, 'UNAUTHENTICATED');
}
