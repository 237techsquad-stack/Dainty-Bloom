import mongoose, { Types } from 'mongoose';

import { Order, Product, Review } from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { REVIEW_RATINGS } from '../constants/review';
import { logAuditEvent } from './audit.service';
import { publicProductFilter } from './productVisibility.service';

type ReviewSort = 'newest' | 'highest' | 'lowest';

export async function listProductReviews(
  idOrSlug: string,
  query: { page: number; limit: number; sort: ReviewSort },
) {
  const product = await findActiveProduct(idOrSlug);
  const sort: Record<string, 1 | -1> =
    query.sort === 'highest'
      ? { rating: -1 as const, createdAt: -1 as const }
      : query.sort === 'lowest'
        ? { rating: 1 as const, createdAt: -1 as const }
        : { createdAt: -1 as const };
  const [reviews, total, summary] = await Promise.all([
    Review.find({ product: product._id, moderationState: 'approved' })
      .select('user rating title body createdAt')
      .sort(sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .populate({ path: 'user', select: 'name' })
      .lean(),
    Review.countDocuments({
      product: product._id,
      moderationState: 'approved',
    }),
    getReviewSummary(product._id),
  ]);
  const totalPages = Math.ceil(total / query.limit);
  return {
    productId: product._id.toString(),
    items: reviews.map((review) => {
      const reviewer = review.user as unknown as { name?: string } | null;
      return {
        id: review._id.toString(),
        reviewerName: reviewerDisplayName(reviewer?.name ?? ''),
        rating: review.rating,
        title: review.title,
        body: review.body,
        verifiedPurchase: true,
        date: review.createdAt,
      };
    }),
    summary,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
    },
  };
}

export async function getReviewEligibility(idOrSlug: string, user: IUser) {
  const product = await findActiveProduct(idOrSlug);
  const existing = await Review.findOne({
    product: product._id,
    user: user._id,
  })
    .select('rating title body moderationState createdAt updatedAt')
    .lean();
  if (existing) {
    return {
      canReview: false,
      reason: 'already_reviewed',
      existingReview: {
        id: existing._id.toString(),
        rating: existing.rating,
        title: existing.title,
        body: existing.body,
        moderationState: existing.moderationState,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      },
    };
  }
  const qualifyingOrder = await Order.findOne({
    user: user._id,
    status: { $in: ['shipped', 'completed'] },
    'items.product': product._id,
  })
    .select('_id')
    .sort({ createdAt: -1 })
    .lean();
  return {
    canReview: Boolean(qualifyingOrder),
    reason: qualifyingOrder ? null : 'verified_purchase_required',
    existingReview: null,
  };
}

export async function createProductReview(
  idOrSlug: string,
  input: { rating: number; title: string; body: string },
  user: IUser,
) {
  if (user.role !== 'customer') {
    throw new AppError(
      'Only customers can submit reviews',
      403,
      'CUSTOMER_ACCOUNT_REQUIRED',
    );
  }
  const product = await findActiveProduct(idOrSlug);
  const order = await Order.findOne({
    user: user._id,
    status: { $in: ['shipped', 'completed'] },
    'items.product': product._id,
  })
    .select('_id')
    .sort({ createdAt: -1 });
  if (!order) {
    throw new AppError(
      'A shipped or completed purchase is required to review this product',
      403,
      'VERIFIED_PURCHASE_REQUIRED',
    );
  }
  const review = await Review.create({
    product: product._id,
    user: user._id,
    order: order._id,
    ...input,
    moderationState: 'pending',
  });
  await logAuditEvent({
    actor: user,
    action: 'review.created',
    targetType: 'Review',
    targetId: review._id.toString(),
    metadata: { productId: product._id.toString() },
  });
  return {
    id: review._id.toString(),
    productId: product._id.toString(),
    rating: review.rating,
    title: review.title,
    body: review.body,
    moderationState: review.moderationState,
    createdAt: review.createdAt,
  };
}

export async function updateOwnedReview(
  id: string,
  input: { rating: number; title: string; body: string },
  user: IUser,
) {
  const review = await Review.findOneAndUpdate(
    { _id: id, user: user._id },
    {
      $set: {
        ...input,
        moderationState: 'pending',
        moderatedBy: null,
        moderatedAt: null,
        moderationReason: null,
      },
    },
    { new: true, runValidators: true },
  );
  if (!review) throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  await recomputeProductRating(review.product);
  await logAuditEvent({
    actor: user,
    action: 'review.edited',
    targetType: 'Review',
    targetId: id,
    metadata: { moderationReset: true },
  });
  return {
    id: review._id.toString(),
    rating: review.rating,
    title: review.title,
    body: review.body,
    moderationState: review.moderationState,
    updatedAt: review.updatedAt,
  };
}

export async function deleteOwnedReview(id: string, user: IUser) {
  const review = await Review.findOneAndDelete({ _id: id, user: user._id });
  if (!review) throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  await recomputeProductRating(review.product);
  await logAuditEvent({
    actor: user,
    action: 'review.deleted',
    targetType: 'Review',
    targetId: id,
  });
}

export async function listAdminReviews(query: {
  page: number;
  limit: number;
  moderationState?: 'pending' | 'approved' | 'rejected';
  product?: string;
  rating?: number;
}) {
  const filter: Record<string, unknown> = {};
  if (query.moderationState) filter.moderationState = query.moderationState;
  if (query.product) filter.product = query.product;
  if (query.rating) filter.rating = query.rating;
  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .select(
        'product user order rating title body moderationState moderationReason createdAt updatedAt',
      )
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .populate({ path: 'product', select: 'title slug' })
      .populate({ path: 'user', select: 'name email' })
      .lean(),
    Review.countDocuments(filter),
  ]);
  const totalPages = Math.ceil(total / query.limit);
  return {
    items: reviews.map((review) => ({
      id: review._id.toString(),
      product: review.product,
      reviewer: review.user,
      orderId: review.order?.toString() ?? null,
      rating: review.rating,
      title: review.title,
      body: review.body,
      moderationState: review.moderationState,
      moderationReason: review.moderationReason ?? null,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
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

export async function moderateReview(
  id: string,
  decision: 'approved' | 'rejected',
  reason: string | undefined,
  actor: IUser,
) {
  const review = await Review.findOneAndUpdate(
    { _id: id, moderationState: 'pending' },
    {
      $set: {
        moderationState: decision,
        moderationReason: decision === 'rejected' ? reason : null,
        moderatedBy: actor._id,
        moderatedAt: new Date(),
      },
    },
    { new: true, runValidators: true },
  );
  if (!review) {
    const exists = await Review.exists({ _id: id });
    if (exists) {
      throw new AppError(
        'Review is no longer pending',
        409,
        'REVIEW_NOT_PENDING',
      );
    }
    throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  }
  await recomputeProductRating(review.product);
  await logAuditEvent({
    actor,
    action: `review.moderated_${decision}`,
    targetType: 'Review',
    targetId: id,
    metadata: { productId: review.product.toString(), reason: reason ?? null },
  });
  return {
    id: review._id.toString(),
    moderationState: review.moderationState,
    moderationReason: review.moderationReason ?? null,
    moderatedAt: review.moderatedAt,
  };
}

export async function deleteAdminReview(id: string, actor: IUser) {
  const review = await Review.findByIdAndDelete(id);
  if (!review) throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  await recomputeProductRating(review.product);
  await logAuditEvent({
    actor,
    action: 'review.admin_deleted',
    targetType: 'Review',
    targetId: id,
    metadata: { productId: review.product.toString() },
  });
}

export async function getReviewSummary(productId: Types.ObjectId) {
  const rows = await Review.aggregate<{
    _id: number;
    count: number;
    totalRating: number;
  }>([
    { $match: { product: productId, moderationState: 'approved' } },
    {
      $group: {
        _id: '$rating',
        count: { $sum: 1 },
        totalRating: { $sum: '$rating' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const countsByRating = new Map(rows.map((row) => [row._id, row.count]));
  const distribution = Object.fromEntries(
    REVIEW_RATINGS.map((rating) => [
      String(rating),
      countsByRating.get(rating) ?? 0,
    ]),
  );
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const totalRating = rows.reduce((sum, row) => sum + row.totalRating, 0);
  return {
    average: count ? Math.round((totalRating / count) * 100) / 100 : null,
    count,
    distribution,
  };
}

export async function recomputeProductRating(
  productId: Types.ObjectId,
): Promise<void> {
  const [summary] = await Review.aggregate<{ average: number; count: number }>([
    { $match: { product: productId, moderationState: 'approved' } },
    { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
    { $project: { _id: 0, average: { $round: ['$average', 2] }, count: 1 } },
  ]);
  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        ratingAverage: summary?.average ?? 0,
        ratingCount: summary?.count ?? 0,
      },
    },
  );
}

async function findActiveProduct(idOrSlug: string) {
  const filter = mongoose.isValidObjectId(idOrSlug)
    ? { _id: idOrSlug, status: 'active' }
    : { slug: idOrSlug, status: 'active' };
  const product = await Product.findOne({
    $and: [filter, publicProductFilter()],
  })
    .select('_id')
    .lean();
  if (!product)
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  return product;
}

function reviewerDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}
