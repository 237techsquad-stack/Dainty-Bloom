import mongoose, { Types } from 'mongoose';

import { ORDER_STATUS_TRANSITIONS, canTransition } from '../constants/order';
import { ArtworkAsset, Order, Product, User, type IOrder } from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { logAuditEvent } from './audit.service';
import { getPaymentProviderByName } from './payment';
import { applyArtworkDecisionToOrder } from './upload.service';
import {
  allowedNextStatuses,
  changeItemPrintStatus,
  changeOrderStatus,
  applyPaymentToOrder,
  restoreReservedStock,
} from './orderWorkflow.service';
import type { OrderStatus as LifecycleStatus } from '../constants/order';

export interface AdminOrderListQuery {
  page: number;
  limit: number;
  tab: 'all' | LifecycleStatus;
  q?: string;
  from?: Date;
  to?: Date;
  sort: 'newest' | 'oldest' | 'total_asc' | 'total_desc';
}

export async function listAdminOrders(query: AdminOrderListQuery) {
  const match = buildOrderMatch(query);
  const sortMap = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    total_asc: { totalMinor: 1 },
    total_desc: { totalMinor: -1 },
  } as const;
  const [result] = await Order.aggregate([
    {
      $facet: {
        items: [
          { $match: match },
          { $sort: sortMap[query.sort] },
          { $skip: (query.page - 1) * query.limit },
          { $limit: query.limit },
          {
            $project: {
              _id: 0,
              id: { $toString: '$_id' },
              orderNumber: 1,
              status: 1,
              totalMinor: 1,
              currency: 1,
              createdAt: 1,
              fulfillmentStatus: {
                $ifNull: ['$fulfillmentStatus', 'unfulfilled'],
              },
              'payment.status': 1,
              'contactSnapshot.name': 1,
              'contactSnapshot.email': 1,
              itemCount: {
                $sum: {
                  $map: {
                    input: '$items',
                    as: 'item',
                    in: '$$item.quantity',
                  },
                },
              },
            },
          },
        ],
        total: [{ $match: match }, { $count: 'count' }],
        counts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
      },
    },
  ]);
  const total = result.total[0]?.count ?? 0;
  const counts: Record<string, number> = { all: 0 };
  for (const status of Object.keys(ORDER_STATUS_TRANSITIONS))
    counts[status] = 0;
  for (const entry of result.counts as Array<{ _id: string; count: number }>) {
    counts[entry._id] = entry.count;
    counts.all += entry.count;
  }
  return {
    items: result.items,
    counts,
    pagination: pageResult(query, total),
  };
}

export async function getAdminOrder(
  id: string,
): Promise<Record<string, unknown>> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  }
  const order = await Order.findById(id).select('+reservedStock');
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  const actorIds = order.statusHistory.flatMap((event) =>
    event.actor ? [event.actor] : [],
  );
  actorIds.push(...order.internalNotes.map((note) => note.author));
  const artworkIds = order.items.flatMap((item) =>
    item.artwork ? [item.artwork] : [],
  );
  const [actors, artworks, products] = await Promise.all([
    User.find({ _id: { $in: actorIds } })
      .select('name')
      .lean(),
    ArtworkAsset.find({ _id: { $in: artworkIds } })
      .select(
        'originalFilename detectedMimeType sizeBytes width height reviewStatus reviewNote',
      )
      .lean(),
    Product.find({ _id: { $in: order.items.map((item) => item.product) } })
      .select('title printTechniques')
      .lean(),
  ]);
  const actorMap = new Map(
    actors.map((actor) => [actor._id.toString(), actor.name]),
  );
  const artworkMap = new Map(
    artworks.map((artwork) => [artwork._id.toString(), artwork]),
  );
  const productMap = new Map(
    products.map((product) => [product._id.toString(), product]),
  );
  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus ?? 'unfulfilled',
    allowedNextStatuses: allowedNextStatuses(order.status).filter(
      (status) => status !== 'shipped',
    ),
    contact: {
      name: order.contactSnapshot.name,
      email: order.contactSnapshot.email,
      phone: order.contactSnapshot.phone ?? null,
    },
    guestEmail: order.guestEmail ?? null,
    customerNote: order.notes ?? null,
    shippingAddress: order.shippingAddress,
    billingAddress: order.billingAddress,
    items: order.items.map((item) => ({
      id: item._id.toString(),
      productId: item.product.toString(),
      title: item.titleSnapshot,
      sku: item.skuSnapshot,
      selectedOptions: item.selectedOptions,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
      itemPrintStatus: item.itemPrintStatus,
      printTechniques:
        productMap.get(item.product.toString())?.printTechniques ?? [],
      artwork: item.artwork
        ? (() => {
            const artwork = artworkMap.get(item.artwork.toString());
            return artwork
              ? {
                  id: artwork._id.toString(),
                  originalFilename: artwork.originalFilename,
                  detectedMimeType: artwork.detectedMimeType,
                  sizeBytes: artwork.sizeBytes,
                  width: artwork.width ?? null,
                  height: artwork.height ?? null,
                  reviewStatus: artwork.reviewStatus,
                  reviewNote: artwork.reviewNote ?? null,
                }
              : null;
          })()
        : null,
    })),
    totals: {
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      shippingMinor: order.shippingMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      currency: order.currency,
    },
    payment: {
      provider: order.payment.provider,
      providerReference: order.payment.providerReference ?? null,
      stripePaymentIntentId: order.payment.stripePaymentIntentId ?? null,
      status: order.payment.status,
      paidAt: order.payment.paidAt ?? null,
    },
    shipment: order.shipment
      ? {
          carrier: order.shipment.carrier,
          trackingNumber: order.shipment.trackingNumber,
          trackingUrl: order.shipment.trackingUrl ?? null,
          dispatchedAt: order.shipment.dispatchedAt,
          note: order.shipment.note ?? null,
        }
      : null,
    statusHistory: order.statusHistory.map((event) => ({
      from: event.from,
      to: event.to,
      actorName: event.actor
        ? (actorMap.get(event.actor.toString()) ?? null)
        : null,
      note: event.note,
      at: event.at,
    })),
    internalNotes: order.internalNotes.map((note) => ({
      authorName: actorMap.get(note.author.toString()) ?? null,
      note: note.note,
      at: note.at,
    })),
    refunds: order.refunds,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export async function adminSetOrderStatus(
  id: string,
  status: LifecycleStatus,
  actor: IUser,
  note?: string,
): Promise<IOrder> {
  if (status === 'shipped' || status === 'cancelled') {
    throw new AppError(
      status === 'shipped'
        ? 'Use dispatch to record shipment'
        : 'Use the cancellation endpoint to process stock and payment',
      400,
      status === 'shipped'
        ? 'DISPATCH_REQUIRED'
        : 'ORDER_CANCELLATION_ENDPOINT_REQUIRED',
    );
  }
  return changeOrderStatus(id, status, actor, note, 'admin');
}

export async function recordOrderPayment(
  id: string,
  input: {
    status: 'paid' | 'failed';
    reference?: string;
    amountMinor: number;
    method: string;
    note?: string;
  },
  actor: IUser,
): Promise<IOrder> {
  const order = await Order.findById(id).select('+reservedStock');
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (order.payment.status === 'paid') return order;
  if (input.status === 'paid') {
    if (input.amountMinor !== order.totalMinor) {
      throw new AppError(
        'Payment amount must equal the order total',
        400,
        'PAYMENT_AMOUNT_MISMATCH',
      );
    }
    const verified = await getPaymentProviderByName(
      order.payment.provider,
    ).verifyPayment({
      order,
      reference: input.reference ?? '',
      amountMinor: input.amountMinor,
    });
    if (!verified) {
      throw new AppError(
        'Payment could not be verified',
        400,
        'PAYMENT_NOT_VERIFIED',
      );
    }
    return applyPaymentToOrder(order._id, {
      provider: order.payment.provider,
      reference: input.reference,
      amountMinor: input.amountMinor,
      currency: order.currency,
      method: input.method,
      actor,
    });
  }
  const failedPayment = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: 'pending_payment',
      'payment.status': { $ne: 'paid' },
    },
    {
      $set: {
        'payment.status': 'failed',
        'payment.providerReference': input.reference,
      },
    },
    { new: true },
  );
  if (!failedPayment) {
    throw new AppError(
      'Payment state changed; refresh and retry',
      409,
      'PAYMENT_STATE_CONFLICT',
    );
  }
  await logAuditEvent({
    actor,
    action: `order.payment_${input.status}`,
    targetType: 'Order',
    targetId: order._id.toString(),
    metadata: {
      amountMinor: input.amountMinor,
      method: input.method,
    },
  });
  return failedPayment;
}

export async function dispatchOrder(
  id: string,
  input: {
    carrier: string;
    trackingNumber: string;
    trackingUrl?: string;
    note?: string;
  },
  actor: IUser,
): Promise<IOrder> {
  const order = await Order.findOneAndUpdate(
    { _id: id, status: 'ready' },
    {
      $set: {
        shipment: {
          ...input,
          dispatchedAt: new Date(),
        },
      },
    },
    { new: false },
  );
  if (!order) {
    const exists = await Order.exists({ _id: id });
    if (!exists) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    throw new AppError(
      'Only ready orders can be dispatched',
      400,
      'INVALID_STATUS_TRANSITION',
    );
  }
  return changeOrderStatus(id, 'shipped', actor, input.note, 'dispatch');
}

export async function cancelAdminOrder(
  id: string,
  input: { reason: string; restock: boolean },
  actor: IUser,
): Promise<IOrder> {
  const order = await Order.findById(id).select('+reservedStock');
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (!canTransition(order.status, 'cancelled')) {
    throw new AppError(
      'Order cannot be cancelled',
      400,
      'ORDER_NOT_CANCELLABLE',
    );
  }
  const updated = await changeOrderStatus(
    order._id,
    'cancelled',
    actor,
    input.reason,
    'admin',
  );
  if (input.restock) await restoreReservedStock(order.reservedStock);
  await Order.updateOne(
    { _id: order._id, status: 'cancelled' },
    {
      $set: {
        reservedStock: [],
        ...(order.payment.status === 'paid'
          ? { 'payment.status': 'refund_due' }
          : {}),
      },
    },
  );
  return updated;
}

export async function recordRefund(
  id: string,
  input: { amountMinor: number; reason: string; reference?: string },
  actor: IUser,
): Promise<IOrder> {
  const order = await Order.findById(id);
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (
    !['paid', 'partially_refunded', 'refund_due'].includes(order.payment.status)
  ) {
    throw new AppError(
      'Refund exceeds paid amount',
      400,
      'REFUND_EXCEEDS_PAID',
    );
  }
  const refundTotal = order.refunds.reduce(
    (sum, refund) => sum + refund.amountMinor,
    0,
  );
  if (input.amountMinor > order.totalMinor - refundTotal) {
    throw new AppError(
      'Refund exceeds paid amount',
      400,
      'REFUND_EXCEEDS_PAID',
    );
  }
  const provider = getPaymentProviderByName(order.payment.provider);
  const providerRefund = provider.supportsRefund
    ? await provider.refund({
        order,
        amountMinor: input.amountMinor,
        reference: input.reference,
        reason: input.reason,
        idempotencyKey: `order:${order._id}:refund:${order.refunds.length + 1}`,
      })
    : { supported: false };
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      'payment.status': { $in: ['paid', 'partially_refunded', 'refund_due'] },
      $expr: {
        $lte: [
          input.amountMinor,
          {
            $subtract: [
              '$totalMinor',
              {
                $reduce: {
                  input: { $ifNull: ['$refunds', []] },
                  initialValue: 0,
                  in: { $add: ['$$value', '$$this.amountMinor'] },
                },
              },
            ],
          },
        ],
      },
    },
    [
      {
        $set: {
          refunds: {
            $concatArrays: [
              { $ifNull: ['$refunds', []] },
              [
                {
                  amountMinor: input.amountMinor,
                  reason: input.reason,
                  reference:
                    (providerRefund.supported
                      ? providerRefund.reference
                      : undefined) ?? input.reference,
                  actor: actor._id,
                  at: new Date(),
                },
              ],
            ],
          },
          'payment.status': {
            $cond: [
              {
                $gte: [
                  {
                    $add: [
                      {
                        $reduce: {
                          input: { $ifNull: ['$refunds', []] },
                          initialValue: 0,
                          in: { $add: ['$$value', '$$this.amountMinor'] },
                        },
                      },
                      input.amountMinor,
                    ],
                  },
                  '$totalMinor',
                ],
              },
              'refunded',
              'partially_refunded',
            ],
          },
        },
      },
    ],
    { new: true },
  );
  if (!updated) {
    if (providerRefund.reference) {
      const current = await Order.findById(order._id);
      if (
        current?.refunds.some(
          (refund) => refund.reference === providerRefund.reference,
        )
      ) {
        return current;
      }
    }
    throw new AppError(
      'Refund exceeds paid amount',
      400,
      'REFUND_EXCEEDS_PAID',
    );
  }
  await logAuditEvent({
    actor,
    action: 'order.refund',
    targetType: 'Order',
    targetId: order._id.toString(),
    metadata: { amountMinor: input.amountMinor, reason: input.reason },
  });
  return updated;
}

export async function addInternalNote(
  id: string,
  note: string,
  actor: IUser,
): Promise<IOrder> {
  const order = await Order.findById(id);
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  order.internalNotes.push({ author: actor._id, note, at: new Date() });
  await order.save();
  await logAuditEvent({
    actor,
    action: 'order.internal_note',
    targetType: 'Order',
    targetId: order._id.toString(),
    metadata: { noteLength: note.length },
  });
  return order;
}

export async function adminReviewArtwork(
  orderId: string,
  itemId: string,
  decision: 'approved' | 'replacement_requested',
  note: string | undefined,
  actor: IUser,
) {
  await applyArtworkDecisionToOrder(
    new Types.ObjectId(orderId),
    new Types.ObjectId(itemId),
    decision,
    note,
    actor,
  );
  return getAdminOrder(orderId);
}

export async function updateItemPrintStatus(
  id: string,
  itemId: string,
  status: 'queued' | 'printing' | 'printed' | 'quality_check' | 'ready',
  actor: IUser,
  note?: string,
) {
  await changeItemPrintStatus(id, itemId, status, actor, note);
  return getAdminOrder(id);
}

export async function completeOrder(
  id: string,
  actor: IUser,
  note?: string,
): Promise<IOrder> {
  return changeOrderStatus(id, 'completed', actor, note, 'completion');
}

export async function getPrintQueue(query: {
  technique?: string;
  status?: 'in_printing' | 'ready';
  q?: string;
  page: number;
  limit?: number;
}) {
  const match: Record<string, unknown> = {
    status: query.status ? query.status : { $in: ['in_printing', 'ready'] },
  };
  const pipeline: mongoose.PipelineStage[] = [
    { $match: match },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    ...(query.technique
      ? [
          {
            $match: { 'product.printTechniques': query.technique },
          } as mongoose.PipelineStage,
        ]
      : []),
    ...(query.q
      ? [
          {
            $match: {
              $or: [
                { orderNumber: { $regex: escapeRegex(query.q), $options: 'i' } },
                {
                  'contactSnapshot.name': {
                    $regex: escapeRegex(query.q),
                    $options: 'i',
                  },
                },
                {
                  'contactSnapshot.email': {
                    $regex: escapeRegex(query.q),
                    $options: 'i',
                  },
                },
                {
                  'product.title': {
                    $regex: escapeRegex(query.q),
                    $options: 'i',
                  },
                },
                {
                  'items.titleSnapshot': {
                    $regex: escapeRegex(query.q),
                    $options: 'i',
                  },
                },
              ],
            },
          } as mongoose.PipelineStage,
        ]
      : []),
    {
      $lookup: {
        from: 'artworkassets',
        localField: 'items.artwork',
        foreignField: '_id',
        pipeline: [{ $project: { reviewStatus: 1 } }],
        as: 'artwork',
      },
    },
    {
      $project: {
        _id: 0,
        orderId: { $toString: '$_id' },
        itemId: { $toString: '$items._id' },
        orderNumber: 1,
        status: 1,
        createdAt: 1,
        customerName: { $ifNull: ['$contactSnapshot.name', ''] },
        productTitle: { $ifNull: ['$product.title', '$items.titleSnapshot'] },
        selectedOptions: '$items.selectedOptions',
        printTechniques: '$product.printTechniques',
        quantity: '$items.quantity',
        artworkId: '$items.artwork',
        artworkReviewStatus: { $arrayElemAt: ['$artwork.reviewStatus', 0] },
        itemPrintStatus: '$items.itemPrintStatus',
      },
    },
    {
      $facet: {
        items: [
          { $sort: { createdAt: 1 } },
          { $skip: (query.page - 1) * (query.limit ?? 25) },
          { $limit: query.limit ?? 25 },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];
  const [result] = await Order.aggregate(pipeline);
  const total = result.total[0]?.count ?? 0;
  return {
    items: result.items,
    pagination: pageResult(
      { page: query.page, limit: query.limit ?? 25 },
      total,
    ),
  };
}

export async function listCustomers(query: {
  page: number;
  limit: number;
  q?: string;
}) {
  const match: Record<string, unknown> = { role: 'customer' };
  if (query.q) {
    match.$or = [
      { name: { $regex: escapeRegex(query.q), $options: 'i' } },
      { email: { $regex: escapeRegex(query.q), $options: 'i' } },
    ];
  }
  const [result] = await User.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'orders',
        let: { customerId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$user', '$$customerId'] },
              'payment.status': {
                $in: ['paid', 'partially_refunded', 'refunded', 'refund_due'],
              },
            },
          },
          {
            $addFields: {
              refundTotal: { $sum: '$refunds.amountMinor' },
            },
          },
          {
            $group: {
              _id: null,
              orderCount: { $sum: 1 },
              totalSpentMinor: {
                $sum: {
                  $subtract: ['$totalMinor', '$refundTotal'],
                },
              },
            },
          },
        ],
        as: 'orderStats',
      },
    },
    {
      $project: {
        name: 1,
        email: 1,
        phone: 1,
        accountState: 1,
        createdAt: 1,
        orderCount: { $ifNull: [{ $first: '$orderStats.orderCount' }, 0] },
        totalSpentMinor: {
          $ifNull: [{ $first: '$orderStats.totalSpentMinor' }, 0],
        },
      },
    },
    {
      $facet: {
        items: [
          { $sort: { createdAt: -1 } },
          { $skip: (query.page - 1) * query.limit },
          { $limit: query.limit },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ]);
  const total = result.total[0]?.count ?? 0;
  return { items: result.items, pagination: pageResult(query, total) };
}

export async function getCustomerAdminDetail(id: string) {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  }
  const user = await User.findOne({ _id: id, role: 'customer' })
    .select('name email phone accountState emailVerified addresses createdAt')
    .lean();
  if (!user)
    throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  const orders = await Order.find({ user: user._id })
    .select('orderNumber status totalMinor currency payment.status createdAt')
    .sort({ createdAt: -1 })
    .lean();
  return { customer: user, orders };
}

function buildOrderMatch(query: AdminOrderListQuery): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  if (query.tab !== 'all') match.status = query.tab;
  if (query.from || query.to) {
    match.createdAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }
  if (query.q) {
    const regex = { $regex: escapeRegex(query.q), $options: 'i' };
    match.$or = [
      { orderNumber: regex },
      { 'contactSnapshot.name': regex },
      { 'contactSnapshot.email': regex },
      { guestEmail: regex },
    ];
  }
  return match;
}

function pageResult(query: { page: number; limit: number }, total: number) {
  const totalPages = Math.ceil(total / query.limit);
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages,
    hasNextPage: query.page < totalPages,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
