import { createHash } from 'node:crypto';
import { Types } from 'mongoose';

import type { OrderStatus } from '../constants/order';
import {
  ArtworkAsset,
  Cart,
  Order,
  Product,
  SiteSettings,
  type ICart,
  type IOrder,
  type IOrderAddress,
  type IProductStock,
} from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { STORE_CURRENCY } from '../utils/currency';
import { calculateDiscount } from './discount.service';
import { sendOrderEmail } from './email.service';
import { getPaymentProvider } from './payment';
import {
  changeOrderStatus,
  restoreReservedStock,
  reserveProductStock,
} from './orderWorkflow.service';
import { clearCart, type CartIdentity } from './cart.service';
import {
  validateCartItems,
  type CartValidationResult,
} from './cartValidation.service';
import { logAuditEvent } from './audit.service';

export interface CheckoutInput {
  contact: { name: string; email: string; phone?: string };
  shippingAddress: IOrderAddress;
  billingAddress?: IOrderAddress;
  billingSameAsShipping: boolean;
  customerNote?: string;
}

export interface CheckoutIdentity extends CartIdentity {
  sessionId: string;
}

export interface CheckoutTotals {
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
}

interface CartCheckoutSnapshot {
  cart: ICart | null;
  validation: CartValidationResult;
  totals: CheckoutTotals;
  shippingConfigured: boolean;
  taxConfigured: boolean;
  products: Map<
    string,
    {
      _id: Types.ObjectId;
      title: string;
      sku: string;
      stock: IProductStock;
    }
  >;
}

export async function getCheckoutPreview(identity: CheckoutIdentity) {
  const snapshot = await checkoutSnapshot(identity);
  return {
    lines: snapshot.validation.lines,
    ...snapshot.totals,
    issues: snapshot.validation.lines.flatMap((line) =>
      line.issues.map((issue) => ({ itemId: line.itemId, ...issue })),
    ),
    hasBlockingIssues:
      snapshot.validation.hasBlockingIssues ||
      snapshot.validation.lines.some((line) => line.issues.length > 0),
    shippingConfigured: snapshot.shippingConfigured,
    taxConfigured: snapshot.taxConfigured,
  };
}

export async function createCustomerOrder(
  identity: CheckoutIdentity,
  input: CheckoutInput,
  idempotencyKey: string,
): Promise<IOrder> {
  if (!identity.user) {
    const settings = await SiteSettings.findOne({ key: 'default' })
      .select('guestCheckoutEnabled')
      .lean();
    if (!settings?.guestCheckoutEnabled || !input.contact.email) {
      throw new AppError(
        'Sign in is required to checkout',
        401,
        'CHECKOUT_REQUIRES_LOGIN',
      );
    }
  }
  const scope = createHash('sha256')
    .update(
      identity.user
        ? `user:${identity.user._id}`
        : `guest:${identity.sessionId}`,
    )
    .digest('hex');
  const existing = await Order.findOne({
    idempotencyScope: scope,
    idempotencyKey,
  }).select('+reservedStock');
  if (existing) return existing;

  const snapshot = await checkoutSnapshot(identity);
  const cartItems = snapshot.cart?.items ?? [];
  if (cartItems.length === 0) {
    throw new AppError('Your cart is empty', 400, 'CART_EMPTY');
  }
  const issues = snapshot.validation.lines.flatMap((line) =>
    line.issues.map((issue) => ({ itemId: line.itemId, ...issue })),
  );
  if (
    snapshot.validation.hasBlockingIssues ||
    snapshot.validation.lines.some((line) => line.issues.length > 0)
  ) {
    throw new AppError(
      'Your cart needs attention before checkout',
      409,
      'CART_HAS_BLOCKING_ISSUES',
      issues,
    );
  }

  const lineById = new Map(
    snapshot.validation.lines.map((line) => [line.itemId, line]),
  );
  const orderItems = cartItems.map((cartItem) => {
    const product = snapshot.products.get(cartItem.product.toString());
    const line = lineById.get(cartItem._id.toString());
    if (!product || !line) {
      throw new AppError(
        'Cart product is no longer available',
        409,
        'CART_HAS_BLOCKING_ISSUES',
      );
    }
    return {
      product: product._id,
      titleSnapshot: product.title,
      skuSnapshot: product.sku,
      selectedOptions: line.selectedOptions,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.lineTotalMinor,
      artwork: cartItem.artwork,
      requiresProof: Boolean(cartItem.artwork),
      itemPrintStatus: cartItem.artwork ? 'pending_proof_approval' : 'queued',
    };
  });

  const reservations: Array<{ product: Types.ObjectId; quantity: number }> = [];
  let order: IOrder | undefined;
  try {
    const quantities = new Map<string, number>();
    for (const item of cartItems) {
      const productId = item.product.toString();
      quantities.set(
        productId,
        (quantities.get(productId) ?? 0) + item.quantity,
      );
    }
    for (const [productId, quantity] of quantities) {
      const product = snapshot.products.get(productId);
      if (!product)
        throw new AppError('Product not found', 404, 'PRODUCT_UNAVAILABLE');
      const reserved = await reserveProductStock(
        product._id,
        quantity,
        product.stock,
      );
      if (reserved > 0)
        reservations.push({ product: product._id, quantity: reserved });
    }

    order = await Order.create({
      orderNumber: undefined,
      ...(identity.user
        ? { user: identity.user._id }
        : { guestEmail: input.contact.email.toLowerCase() }),
      contactSnapshot: {
        ...input.contact,
        email: input.contact.email.toLowerCase(),
      },
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingSameAsShipping
        ? input.shippingAddress
        : input.billingAddress,
      items: orderItems,
      ...snapshot.totals,
      payment: {
        provider: getPaymentProvider().name,
        status: 'pending',
      },
      status: 'pending_payment',
      statusHistory: [
        {
          from: 'pending_payment',
          to: 'pending_payment',
          note: 'Order created',
          at: new Date(),
        },
      ],
      idempotencyKey,
      idempotencyScope: scope,
      notes: input.customerNote,
      reservedStock: reservations,
    });

    const paymentSetup = await getPaymentProvider().createPayment(order);
    if (paymentSetup.reference) {
      order.payment.providerReference = paymentSetup.reference;
      await order.save();
    }
    for (const item of order.items) {
      if (!item.artwork) continue;
      await ArtworkAsset.updateOne(
        { _id: item.artwork },
        { $set: { order: order._id, orderItemId: item._id } },
      );
    }
  } catch (error) {
    if (order) {
      await ArtworkAsset.updateMany(
        { order: order._id },
        { $unset: { order: 1, orderItemId: 1 } },
      );
      await order.deleteOne();
    }
    await restoreReservedStock(reservations);
    if (isDuplicateKey(error)) {
      const duplicate = await Order.findOne({
        idempotencyScope: scope,
        idempotencyKey,
      });
      if (duplicate) return duplicate;
    }
    throw error;
  }
  await clearCart(identity);
  await logAuditEvent({
    actor: identity.user,
    action: 'order.created',
    targetType: 'Order',
    targetId: order._id.toString(),
    metadata: {
      orderNumber: order.orderNumber,
      itemCount: order.items.length,
      totalMinor: order.totalMinor,
    },
  });
  await sendOrderEmail(order, 'received');
  return order;
}

export async function listCustomerOrders(
  user: IUser,
  query: { page: number; limit: number; status?: OrderStatus },
) {
  const match = {
    user: user._id,
    ...(query.status ? { status: query.status } : {}),
  };
  const [orders, total] = await Promise.all([
    Order.find(match)
      .select(
        'orderNumber status totalMinor currency payment.status createdAt items',
      )
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Order.countDocuments(match),
  ]);
  return {
    items: orders.map((order) => ({
      orderNumber: order.orderNumber,
      status: order.status,
      totalMinor: order.totalMinor,
      currency: order.currency,
      paymentStatus: order.payment.status,
      itemCount: order.items.reduce((count, item) => count + item.quantity, 0),
      createdAt: order.createdAt,
    })),
    pagination: pageResult(query, total),
  };
}

export async function getCustomerOrder(
  orderNumber: string,
  identity: { user?: IUser; email?: string },
): Promise<Record<string, unknown>> {
  const order = await Order.findOne({ orderNumber }).select('+reservedStock');
  if (
    !order ||
    (identity.user
      ? order.user?.toString() !== identity.user._id.toString()
      : !identity.email ||
        order.user ||
        order.guestEmail?.toLowerCase() !== identity.email.toLowerCase())
  ) {
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  }
  return customerOrderDetail(order);
}

export async function lookupGuestOrder(
  orderNumber: string,
  email: string,
): Promise<Record<string, unknown>> {
  try {
    return await getCustomerOrder(orderNumber, { email });
  } catch (error) {
    if (error instanceof AppError && error.code === 'ORDER_NOT_FOUND') {
      throw new AppError(
        'Order could not be found',
        404,
        'ORDER_LOOKUP_FAILED',
      );
    }
    throw error;
  }
}

export async function replaceOrderArtwork(
  orderNumber: string,
  itemId: string,
  artworkId: string,
  identity: { user?: IUser; email?: string; sessionId?: string },
): Promise<Record<string, unknown>> {
  const order = await Order.findOne({ orderNumber }).select('+reservedStock');
  if (
    !order ||
    (identity.user
      ? order.user?.toString() !== identity.user._id.toString()
      : !identity.email ||
        order.user ||
        order.guestEmail?.toLowerCase() !== identity.email.toLowerCase())
  ) {
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  }
  if (order.status !== 'artwork_rejected') {
    throw new AppError(
      'Replacement artwork is only accepted for rejected proofs',
      409,
      'ORDER_NOT_CANCELLABLE',
    );
  }
  const item = order.items.find((entry) => entry._id.toString() === itemId);
  if (!item?.artwork) {
    throw new AppError(
      'Order item artwork not found',
      404,
      'ARTWORK_NOT_FOUND',
    );
  }
  const ownerFilter = identity.user
    ? { owner: identity.user._id }
    : { sessionId: identity.sessionId };
  const artwork = await ArtworkAsset.findOne({
    _id: artworkId,
    ...ownerFilter,
    order: { $exists: false },
  });
  if (!artwork) {
    throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
  }
  const previousArtworkId = item.artwork;
  artwork.order = order._id;
  artwork.orderItemId = item._id;
  artwork.supersedes = previousArtworkId;
  artwork.reviewStatus = 'pending';
  artwork.reviewedBy = undefined;
  artwork.reviewedAt = undefined;
  artwork.reviewNote = undefined;
  await artwork.save();
  item.artwork = artwork._id;
  item.itemPrintStatus = 'pending_proof_approval';
  await order.save();
  const remainingReplacementRequests = await ArtworkAsset.countDocuments({
    _id: {
      $in: order.items.flatMap((entry) =>
        entry.artwork ? [entry.artwork] : [],
      ),
    },
    reviewStatus: 'replacement_requested',
  });
  if (remainingReplacementRequests === 0) {
    await changeOrderStatus(
      order._id,
      'pending_proof_approval',
      identity.user,
      'Replacement artwork submitted',
      'proof',
    );
  }
  const updatedOrder = await Order.findById(order._id);
  if (!updatedOrder)
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  return customerOrderDetail(updatedOrder);
}

export async function cancelCustomerOrder(
  orderNumber: string,
  identity: { user?: IUser; email?: string },
): Promise<Record<string, unknown>> {
  const order = await Order.findOne({ orderNumber }).select('+reservedStock');
  if (
    !order ||
    (identity.user
      ? order.user?.toString() !== identity.user._id.toString()
      : !identity.email ||
        order.user ||
        order.guestEmail?.toLowerCase() !== identity.email.toLowerCase())
  ) {
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  }
  if (
    !['pending_payment', 'pending_proof_approval', 'artwork_rejected'].includes(
      order.status,
    )
  ) {
    throw new AppError(
      'This order can no longer be cancelled by the customer',
      409,
      'ORDER_NOT_CANCELLABLE',
    );
  }
  await changeOrderStatus(
    order._id,
    'cancelled',
    identity.user,
    'Cancelled by customer',
    'customer_cancel',
  );
  await restoreReservedStock(order.reservedStock);
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
  return getCustomerOrder(orderNumber, identity);
}

export async function checkoutSnapshot(
  identity: CheckoutIdentity,
): Promise<CartCheckoutSnapshot> {
  const identityFilter = identity.user
    ? { user: identity.user._id }
    : { sessionId: identity.sessionId };
  const cart = await Cart.findOne(identityFilter);
  if (cart && cart.currency !== STORE_CURRENCY) {
    throw new AppError(
      'Your cart currency has changed. Refresh your cart before checkout.',
      409,
      'CART_CURRENCY_MISMATCH',
    );
  }
  const validation = await validateCartItems(cart?.items ?? [], {
    userId: identity.user?._id.toString(),
    sessionId: identity.sessionId,
  });
  const [settings, products] = await Promise.all([
    SiteSettings.findOne({ key: 'default' }).lean(),
    Product.find({
      _id: { $in: cart?.items.map((item) => item.product) ?? [] },
    })
      .select('title sku stock currency')
      .lean(),
  ]);
  if (!settings)
    throw new AppError('Site settings not found', 500, 'SETTINGS_NOT_FOUND');
  if (settings.currency !== STORE_CURRENCY) {
    throw new AppError(
      'Store currency is not configured for checkout',
      503,
      'STORE_CURRENCY_MISMATCH',
    );
  }
  if (products.some((product) => product.currency !== STORE_CURRENCY)) {
    throw new AppError(
      'A cart product uses an unsupported currency',
      409,
      'PRODUCT_CURRENCY_MISMATCH',
    );
  }
  const subtotalMinor = validation.subtotalMinor;
  const discountMinor = calculateDiscount(subtotalMinor).discountMinor;
  const shippingMinor =
    typeof settings.freeShippingThresholdMinor === 'number' &&
    subtotalMinor - discountMinor >= settings.freeShippingThresholdMinor
      ? 0
      : (settings.shippingFlatMinor ?? 0);
  const taxableSubtotal = Math.max(
    0,
    subtotalMinor - discountMinor + shippingMinor,
  );
  const taxMinor = Math.round(
    (taxableSubtotal * (settings.taxRateBasisPoints ?? 0)) / 10000,
  );
  const totals: CheckoutTotals = {
    subtotalMinor,
    discountMinor,
    shippingMinor,
    taxMinor,
    totalMinor: taxableSubtotal + taxMinor,
    currency: settings.currency,
  };
  return {
    cart,
    validation,
    totals,
    shippingConfigured: settings.shippingConfigured ?? false,
    taxConfigured: settings.taxConfigured ?? false,
    products: new Map(
      products.map((product) => [product._id.toString(), product]),
    ),
  };
}

export async function customerOrderDetail(
  order: IOrder,
): Promise<Record<string, unknown>> {
  const statusHistory = order.statusHistory.map(({ from, to, at }) => ({
    from,
    to,
    at,
  }));
  const artworkIds = order.items.flatMap((item) =>
    item.artwork ? [item.artwork] : [],
  );
  const [artworks, products] = await Promise.all([
    ArtworkAsset.find({ _id: { $in: artworkIds } })
      .select('reviewStatus reviewNote originalFilename detectedMimeType')
      .lean(),
    Product.find({ _id: { $in: order.items.map((item) => item.product) } })
      .select('media')
      .lean(),
  ]);
  const artworkMap = new Map(
    artworks.map((artwork) => [artwork._id.toString(), artwork]),
  );
  const productImageMap = new Map(
    products.map((product) => [
      product._id.toString(),
      product.media.find((media) => media.isPrimary)?.url ??
        product.media[0]?.url ??
        null,
    ]),
  );
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    payment: { status: order.payment.status },
    contact: {
      name: order.contactSnapshot.name,
      email: order.contactSnapshot.email,
      phone: order.contactSnapshot.phone ?? null,
    },
    shippingAddress: order.shippingAddress,
    billingAddress: order.billingAddress,
    items: order.items.map((item) => ({
      id: item._id.toString(),
      title: item.titleSnapshot,
      sku: item.skuSnapshot,
      image: productImageMap.get(item.product.toString()) ?? null,
      selectedOptions: item.selectedOptions,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
      artwork: item.artwork
        ? (() => {
            const artwork = artworkMap.get(item.artwork!.toString());
            return {
              id: item.artwork!.toString(),
              reviewStatus: artwork?.reviewStatus ?? null,
              ...(artwork
                ? {
                    originalFilename: artwork.originalFilename,
                    detectedMimeType: artwork.detectedMimeType,
                  }
                : {}),
              ...(artwork?.reviewStatus === 'replacement_requested' &&
              artwork.reviewNote
                ? { reviewNote: artwork.reviewNote }
                : {}),
            };
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
    statusHistory,
    shipment: order.shipment
      ? {
          carrier: order.shipment.carrier,
          trackingNumber: order.shipment.trackingNumber,
          trackingUrl: order.shipment.trackingUrl,
          dispatchedAt: order.shipment.dispatchedAt,
        }
      : null,
    createdAt: order.createdAt,
  };
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

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
