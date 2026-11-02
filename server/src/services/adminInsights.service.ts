import { ArtworkAsset, Message, Order, Product, Review, User } from '../models';
import type { IUser } from '../models/User';
import { ROLE_PERMISSIONS } from '../constants/permissions';
import type { Permission } from '../constants/permissions';
import { AppError } from '../utils/AppError';

export async function getAdminNotifications() {
  const [proofOrders, artwork, messages, reviews, lowStock] = await Promise.all(
    [
      Order.find({
        status: 'pending_proof_approval',
        'payment.paidAt': { $type: 'date' },
      })
        .select('orderNumber status createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      ArtworkAsset.aggregate([
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
            'order.payment.paidAt': { $type: 'date' },
            'order.status': { $ne: 'cancelled' },
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: 5 },
        {
          $project: {
            _id: 1,
            originalFilename: 1,
            reviewStatus: 1,
            createdAt: 1,
            orderNumber: '$order.orderNumber',
          },
        },
      ]),
      Message.find({ status: 'new' })
        .select('name email subject createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Review.find({ moderationState: 'pending' })
        .select('product rating title createdAt')
        .populate({ path: 'product', select: 'title' })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
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
        { $sort: { 'stock.quantity': 1, _id: 1 } },
        { $limit: 5 },
        {
          $project: {
            _id: 1,
            title: 1,
            sku: 1,
            quantity: '$stock.quantity',
            lowStockThreshold: '$stock.lowStockThreshold',
          },
        },
      ]),
    ],
  );
  const [proofCount, artworkCount, messageCount, reviewCount, lowStockCount] =
    await Promise.all([
      Order.countDocuments({
        status: 'pending_proof_approval',
        'payment.paidAt': { $type: 'date' },
      }),
      ArtworkAsset.aggregate([
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
            'order.payment.paidAt': { $type: 'date' },
            'order.status': { $ne: 'cancelled' },
          },
        },
        { $count: 'count' },
      ]),
      Message.countDocuments({ status: 'new' }),
      Review.countDocuments({ moderationState: 'pending' }),
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
        { $count: 'count' },
      ]),
    ]);
  const items = [
    {
      type: 'paid_order_awaiting_proof',
      label: 'Paid orders awaiting proof',
      count: proofCount,
      route: '/admin/orders?tab=pending_proof_approval',
      latest: proofOrders.map((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
      })),
    },
    {
      type: 'artwork_awaiting_review',
      label: 'Artwork awaiting review',
      count: artworkCount[0]?.count ?? 0,
      route: '/admin/artwork?reviewStatus=pending',
      latest: artwork.map((entry) => ({
        id: entry._id.toString(),
        filename: entry.originalFilename,
        orderNumber: entry.orderNumber,
        createdAt: entry.createdAt,
      })),
    },
    {
      type: 'new_message',
      label: 'New contact messages',
      count: messageCount,
      route: '/admin/messages?status=new',
      latest: messages.map((message) => ({
        id: message._id.toString(),
        name: message.name,
        email: message.email,
        subject: message.subject,
        createdAt: message.createdAt,
      })),
    },
    {
      type: 'pending_review',
      label: 'Reviews awaiting moderation',
      count: reviewCount,
      route: '/admin/reviews?moderationState=pending',
      latest: reviews.map((review) => ({
        id: review._id.toString(),
        product: review.product,
        rating: review.rating,
        title: review.title,
        createdAt: review.createdAt,
      })),
    },
    {
      type: 'low_stock',
      label: 'Products with low stock',
      count: lowStockCount[0]?.count ?? 0,
      route: '/admin/products?stockState=low',
      latest: lowStock.map((product) => ({
        id: product._id.toString(),
        title: product.title,
        sku: product.sku,
        quantity: product.quantity,
        lowStockThreshold: product.lowStockThreshold,
      })),
    },
  ];
  return {
    counts: Object.fromEntries(items.map(({ type, count }) => [type, count])),
    items,
  };
}

export async function searchAdminData(query: string, actor: IUser) {
  const permissions = new Set<Permission>(ROLE_PERMISSIONS[actor.role]);
  const searchablePermissions: Permission[] = [
    'orders:read',
    'products:read',
    'customers:read',
    'messages:manage',
  ];
  if (
    !searchablePermissions.some((permission) => permissions.has(permission))
  ) {
    throw new AppError('Staff access required', 403, 'FORBIDDEN');
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = { $regex: escaped, $options: 'i' };
  const groups: Record<string, unknown> = {};
  const requests: Promise<void>[] = [];

  if (permissions.has('orders:read')) {
    requests.push(
      Order.find({
        $or: [
          { orderNumber: regex },
          { 'contactSnapshot.name': regex },
          { 'contactSnapshot.email': regex },
        ],
      })
        .select(
          'orderNumber status totalMinor currency createdAt contactSnapshot.name contactSnapshot.email',
        )
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
        .then((rows) => {
          groups.orders = rows.map((order) => ({
            orderNumber: order.orderNumber,
            status: order.status,
            totalMinor: order.totalMinor,
            currency: order.currency,
            customerName: order.contactSnapshot.name,
            email: order.contactSnapshot.email,
            createdAt: order.createdAt,
          }));
        }),
    );
  }
  if (permissions.has('products:read')) {
    requests.push(
      Product.find({ $or: [{ title: regex }, { sku: regex }] })
        .select('title sku slug status')
        .sort({ title: 1 })
        .limit(5)
        .lean()
        .then((rows) => {
          groups.products = rows.map((product) => ({
            id: product._id.toString(),
            title: product.title,
            sku: product.sku,
            slug: product.slug,
            status: product.status,
          }));
        }),
    );
  }
  if (permissions.has('customers:read')) {
    requests.push(
      User.find({ role: 'customer', $or: [{ name: regex }, { email: regex }] })
        .select('name email')
        .sort({ name: 1 })
        .limit(5)
        .lean()
        .then((rows) => {
          groups.customers = rows.map((user) => ({
            id: user._id.toString(),
            name: user.name,
            email: user.email,
          }));
        }),
    );
  }
  if (permissions.has('messages:manage')) {
    requests.push(
      Message.find({ $or: [{ subject: regex }, { email: regex }] })
        .select('name email subject status createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
        .then((rows) => {
          groups.messages = rows.map((message) => ({
            id: message._id.toString(),
            name: message.name,
            email: message.email,
            subject: message.subject,
            status: message.status,
            createdAt: message.createdAt,
          }));
        }),
    );
  }
  await Promise.all(requests);
  return groups;
}
