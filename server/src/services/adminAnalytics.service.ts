import { ORDER_STATUS_TRANSITIONS } from '../constants/order';
import { env } from '../config/env';
import {
  ArtworkAsset,
  Message,
  Order,
  Product,
  Review,
  SiteSettings,
  User,
} from '../models';
import type { OrderStatus } from '../constants/order';
import { AppError } from '../utils/AppError';
import { getPrintQueue } from './adminOrder.service';

const paidOrderMatch = {
  status: { $ne: 'cancelled' },
  'payment.paidAt': { $type: 'date' },
};

const netRevenue = {
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
};

export async function getAdminDashboard(
  range: '7d' | '30d' | '90d',
  timezone = 'UTC',
) {
  const days = Number(range.slice(0, -1));
  const now = new Date();
  const settings = await SiteSettings.findOne({ key: 'default' })
    .select('currency')
    .lean();
  const currency = settings?.currency ?? env.DEFAULT_CURRENCY;
  const today = dateKey(now, timezone);
  const from = localMidnight(dateKeyOffset(today, -(days - 1)), timezone);
  const previousFrom = localMidnight(
    dateKeyOffset(today, -(days * 2 - 1)),
    timezone,
  );
  const currentFilter = { createdAt: { $gte: from, $lte: now } };
  const [
    statusRows,
    [periodSummary],
    [previousSummary],
    chartRows,
    [jobs],
    [artwork],
    [messages],
    [reviews],
    [stock],
    topProducts,
    recentOrders,
    printQueue,
  ] = await Promise.all([
    Order.aggregate<{ _id: OrderStatus; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Order.aggregate<{
      orders: number;
      paidCount: number;
      revenueMinor: number;
    }>([
      { $match: currentFilter },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          paidCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$status', 'cancelled'] },
                    { $eq: ['$currency', currency] },
                    { $eq: [{ $type: '$payment.paidAt' }, 'date'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          revenueMinor: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$status', 'cancelled'] },
                    { $eq: ['$currency', currency] },
                    { $eq: [{ $type: '$payment.paidAt' }, 'date'] },
                  ],
                },
                netRevenue,
                0,
              ],
            },
          },
        },
      },
    ]),
    Order.aggregate<{ paidCount: number; revenueMinor: number }>([
      {
        $match: {
          ...paidOrderMatch,
          currency,
          createdAt: { $gte: previousFrom, $lt: from },
        },
      },
      {
        $group: {
          _id: null,
          paidCount: { $sum: 1 },
          revenueMinor: { $sum: netRevenue },
        },
      },
    ]),
    Order.aggregate<{ _id: Date; orders: number; revenueMinor: number }>([
      { $match: currentFilter },
      {
        $group: {
          _id: { $dateTrunc: { date: '$createdAt', unit: 'day', timezone } },
          orders: { $sum: 1 },
          revenueMinor: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$status', 'cancelled'] },
                    { $eq: ['$currency', currency] },
                    { $eq: [{ $type: '$payment.paidAt' }, 'date'] },
                  ],
                },
                netRevenue,
                0,
              ],
            },
          },
        },
      },
    ]),
    Order.aggregate<{
      printing: number;
      ready: number;
      pendingPayment: number;
    }>([
      {
        $group: {
          _id: null,
          printing: {
            $sum: { $cond: [{ $eq: ['$status', 'in_printing'] }, 1, 0] },
          },
          ready: { $sum: { $cond: [{ $eq: ['$status', 'ready'] }, 1, 0] } },
          pendingPayment: {
            $sum: { $cond: [{ $eq: ['$status', 'pending_payment'] }, 1, 0] },
          },
        },
      },
    ]),
    ArtworkAsset.aggregate<{ count: number }>([
      { $match: { reviewStatus: 'pending', order: { $exists: true } } },
      {
        $lookup: {
          from: 'orders',
          localField: 'order',
          foreignField: '_id',
          as: 'order',
        },
      },
      { $unwind: '$order' },
      {
        $match: {
          'order.payment.paidAt': { $exists: true },
          'order.status': { $ne: 'cancelled' },
        },
      },
      { $count: 'count' },
    ]),
    Message.aggregate<{ count: number }>([
      { $match: { status: 'new' } },
      { $count: 'count' },
    ]),
    Review.aggregate<{ count: number }>([
      { $match: { moderationState: 'pending' } },
      { $count: 'count' },
    ]),
    Product.aggregate<{ lowStock: number; outOfStock: number }>([
      { $match: { status: 'active', 'stock.trackInventory': true } },
      {
        $group: {
          _id: null,
          lowStock: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: ['$stock.quantity', 0] },
                    { $lte: ['$stock.quantity', '$stock.lowStockThreshold'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          outOfStock: {
            $sum: { $cond: [{ $lte: ['$stock.quantity', 0] }, 1, 0] },
          },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          ...paidOrderMatch,
          currency,
          createdAt: currentFilter.createdAt,
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          unitsSold: { $sum: '$items.quantity' },
        },
      },
      { $sort: { unitsSold: -1, _id: 1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $project: {
          _id: 0,
          productId: { $toString: '$product._id' },
          title: '$product.title',
          unitsSold: 1,
        },
      },
    ]),
    Order.find()
      .select(
        'orderNumber status totalMinor currency createdAt contactSnapshot.name',
      )
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    getPrintQueue({ page: 1, limit: 5 }),
  ]);

  const orderCounts = Object.fromEntries(
    Object.keys(ORDER_STATUS_TRANSITIONS).map((status) => [status, 0]),
  ) as Record<OrderStatus, number>;
  for (const row of statusRows) orderCounts[row._id] = row.count;
  const chartMap = new Map(
    chartRows.map((row) => [dateKey(row._id, timezone), row]),
  );
  const dates = dayKeys(days, now, timezone);
  const series = dates.map((date) => {
    const row = chartMap.get(date);
    return {
      date,
      orders: row?.orders ?? 0,
      revenueMinor: row?.revenueMinor ?? 0,
    };
  });
  const currentRevenue = periodSummary?.revenueMinor ?? 0;
  const previousRevenue = previousSummary?.revenueMinor ?? 0;
  const previousComparison =
    (previousSummary?.paidCount ?? 0) === 0
      ? null
      : previousRevenue === 0
        ? currentRevenue === 0
          ? 0
          : null
        : Math.round(
            ((currentRevenue - previousRevenue) / previousRevenue) * 10000,
          ) / 100;

  return {
    range,
    timezone,
    period: { from, to: now },
    currency,
    ordersByStatus: orderCounts,
    newOrdersInRange: periodSummary?.orders ?? 0,
    jobsInPrinting: jobs?.printing ?? 0,
    jobsReady: jobs?.ready ?? 0,
    artworkAwaitingReview: artwork?.count ?? 0,
    pendingPayment: jobs?.pendingPayment ?? 0,
    unreadMessages: messages?.count ?? 0,
    pendingReviews: reviews?.count ?? 0,
    lowStockProducts: stock?.lowStock ?? 0,
    outOfStockProducts: stock?.outOfStock ?? 0,
    revenueInRange: {
      revenueMinor: currentRevenue,
      paidOrderCount: periodSummary?.paidCount ?? 0,
      averageOrderValueMinor:
        (periodSummary?.paidCount ?? 0) > 0
          ? Math.round(currentRevenue / periodSummary!.paidCount)
          : null,
      previousPeriodRevenueMinor: previousSummary?.revenueMinor ?? 0,
      comparisonPercent: previousComparison,
    },
    dailySeries: series,
    topProducts,
    recentOrders: recentOrders.map((order) => ({
      orderNumber: order.orderNumber,
      status: order.status,
      totalMinor: order.totalMinor,
      currency: order.currency,
      createdAt: order.createdAt,
    })),
    printQueue,
  };
}

export async function getSalesAnalytics(
  from: Date,
  to: Date,
  groupBy: 'day' | 'week' | 'month',
) {
  const settings = await SiteSettings.findOne({ key: 'default' })
    .select('currency')
    .lean();
  const currency = settings?.currency ?? env.DEFAULT_CURRENCY;
  const [sales, categories] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          ...paidOrderMatch,
          currency,
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: { $dateTrunc: { date: '$createdAt', unit: groupBy } },
          revenueMinor: { $sum: netRevenue },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          period: '$_id',
          revenueMinor: 1,
          orderCount: 1,
          averageOrderValueMinor: {
            $round: [{ $divide: ['$revenueMinor', '$orderCount'] }, 0],
          },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          ...paidOrderMatch,
          currency,
          createdAt: { $gte: from, $lte: to },
        },
      },
      { $unwind: '$items' },
      {
        $addFields: {
          orderRefundMinor: {
            $reduce: {
              input: { $ifNull: ['$refunds', []] },
              initialValue: 0,
              in: { $add: ['$$value', '$$this.amountMinor'] },
            },
          },
        },
      },
      {
        $addFields: {
          categoryRevenueMinor: {
            $cond: [
              { $gt: ['$subtotalMinor', 0] },
              {
                $round: [
                  {
                    $multiply: [
                      { $divide: ['$items.lineTotalMinor', '$subtotalMinor'] },
                      {
                        $max: [
                          0,
                          {
                            $subtract: [
                              '$subtotalMinor',
                              { $add: ['$discountMinor', '$orderRefundMinor'] },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$category._id',
          category: { $first: '$category.name' },
          revenueMinor: { $sum: '$categoryRevenueMinor' },
          unitsSold: { $sum: '$items.quantity' },
        },
      },
      { $sort: { revenueMinor: -1 } },
      {
        $project: {
          _id: 0,
          categoryId: { $toString: '$_id' },
          category: { $ifNull: ['$category', 'Uncategorized'] },
          revenueMinor: 1,
          unitsSold: 1,
        },
      },
    ]),
  ]);
  return {
    from,
    to,
    groupBy,
    currency,
    series: sales,
    revenueByCategory: categories,
  };
}

export async function getProductAnalytics() {
  const [topSellers, leastSellers, lowStock, mostViewed] = await Promise.all([
    paidProductUnits(-1, 10),
    paidProductUnits(1, 10, { status: 'active' }),
    Product.aggregate([
      {
        $match: {
          status: 'active',
          'stock.trackInventory': true,
          'stock.quantity': { $gt: 0 },
        },
      },
      {
        $match: {
          $expr: { $lte: ['$stock.quantity', '$stock.lowStockThreshold'] },
        },
      },
      {
        $project: {
          title: 1,
          sku: 1,
          quantity: '$stock.quantity',
          lowStockThreshold: '$stock.lowStockThreshold',
        },
      },
      { $sort: { quantity: 1, _id: 1 } },
      { $limit: 10 },
    ]),
    Product.find({ status: 'active' })
      .select('title slug viewCount')
      .sort({ viewCount: -1 })
      .limit(10)
      .lean(),
  ]);
  return { topSellers, leastSellers, lowStock, mostViewed };
}

export async function getCustomerAnalytics(input: {
  from?: Date;
  to?: Date;
  range: '7d' | '30d' | '90d';
  groupBy: 'day' | 'week' | 'month';
  includePii: boolean;
}) {
  const now = new Date();
  const from =
    input.from ??
    new Date(now.getTime() - Number(input.range.slice(0, -1)) * 86400000);
  const to = input.to ?? now;
  const settings = await SiteSettings.findOne({ key: 'default' })
    .select('currency')
    .lean();
  const currency = settings?.currency ?? env.DEFAULT_CURRENCY;
  const [newCustomers, repeatRows, topCustomers] = await Promise.all([
    User.aggregate([
      { $match: { role: 'customer', createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateTrunc: { date: '$createdAt', unit: input.groupBy } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: { ...paidOrderMatch, currency } },
      {
        $group: {
          _id: { $ifNull: ['$user', { $toLower: '$contactSnapshot.email' }] },
          orderCount: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: null,
          customers: { $sum: 1 },
          repeatCustomers: {
            $sum: { $cond: [{ $gt: ['$orderCount', 1] }, 1, 0] },
          },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          ...paidOrderMatch,
          currency,
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: { $ifNull: ['$user', { $toLower: '$contactSnapshot.email' }] },
          totalSpentMinor: { $sum: netRevenue },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { totalSpentMinor: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'customer',
        },
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          name: '$customer.name',
          email: {
            $ifNull: [
              '$customer.email',
              { $cond: [{ $eq: [{ $type: '$_id' }, 'string'] }, '$_id', null] },
            ],
          },
          totalSpentMinor: 1,
          orderCount: 1,
        },
      },
    ]),
  ]);
  const customers = repeatRows[0]?.customers ?? 0;
  const repeatCustomers = repeatRows[0]?.repeatCustomers ?? 0;
  return {
    from,
    to,
    groupBy: input.groupBy,
    currency,
    newCustomers,
    repeatCustomerRate: customers
      ? Math.round((repeatCustomers / customers) * 10000) / 100
      : null,
    repeatCustomerCount: repeatCustomers,
    customerCount: customers,
    topCustomers: topCustomers.map((entry) => ({
      name: input.includePii ? (entry.name ?? null) : null,
      email: input.includePii ? (entry.email ?? null) : null,
      totalSpentMinor: entry.totalSpentMinor,
      orderCount: entry.orderCount,
    })),
  };
}

export async function getProductionAnalytics() {
  const [byPrintStatus, byTechnique, [duration]] = await Promise.all([
    Order.aggregate([
      { $unwind: '$items' },
      { $group: { _id: '$items.itemPrintStatus', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      { $unwind: '$product.printTechniques' },
      {
        $group: {
          _id: '$product.printTechniques',
          items: { $sum: 1 },
          quantity: { $sum: '$items.quantity' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: { status: 'completed', 'payment.paidAt': { $type: 'date' } } },
      {
        $addFields: {
          readyTransition: {
            $first: {
              $filter: {
                input: '$statusHistory',
                as: 'history',
                cond: { $eq: ['$$history.to', 'ready'] },
              },
            },
          },
        },
      },
      {
        $match: {
          'readyTransition.at': { $type: 'date' },
          $expr: { $gte: ['$readyTransition.at', '$payment.paidAt'] },
        },
      },
      {
        $group: {
          _id: null,
          averageHours: {
            $avg: {
              $dateDiff: {
                startDate: '$payment.paidAt',
                endDate: '$readyTransition.at',
                unit: 'minute',
              },
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          averageHours: { $round: [{ $divide: ['$averageHours', 60] }, 2] },
          count: 1,
        },
      },
    ]),
  ]);
  return {
    byPrintStatus,
    byTechnique,
    completedJobsMeasured: duration?.count ?? 0,
    averagePaymentToReadyHours: duration?.averageHours ?? null,
  };
}

async function paidProductUnits(
  sortDirection: 1 | -1,
  limit: number,
  productMatch: Record<string, unknown> = {},
) {
  return Product.aggregate([
    { $match: productMatch },
    {
      $lookup: {
        from: 'orders',
        let: { productId: '$_id' },
        pipeline: [
          {
            $match: {
              ...paidOrderMatch,
              $expr: { $in: ['$$productId', '$items.product'] },
            },
          },
          { $unwind: '$items' },
          { $match: { $expr: { $eq: ['$items.product', '$$productId'] } } },
          { $group: { _id: null, unitsSold: { $sum: '$items.quantity' } } },
        ],
        as: 'sales',
      },
    },
    {
      $project: {
        title: 1,
        sku: 1,
        slug: 1,
        status: 1,
        unitsSold: { $ifNull: [{ $first: '$sales.unitsSold' }, 0] },
      },
    },
    { $sort: { unitsSold: sortDirection, _id: 1 } },
    { $limit: limit },
  ]);
}

function dateKey(date: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dayKeys(days: number, now: Date, timezone: string): string[] {
  const today = dateKey(now, timezone);
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(dateKeyOffset(today, -offset));
  }
  return keys;
}

function dateKeyOffset(date: string, dayOffset: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + dayOffset);
  return value.toISOString().slice(0, 10);
}

function localMidnight(date: string, timezone: string): Date {
  const target = new Date(`${date}T00:00:00.000Z`).getTime();
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .map((part) => [part.type, part.value]),
    );
    const observed = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess += target - observed;
  }
  return new Date(guess);
}

export function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new AppError('Invalid timezone', 400, 'INVALID_TIMEZONE');
  }
}
