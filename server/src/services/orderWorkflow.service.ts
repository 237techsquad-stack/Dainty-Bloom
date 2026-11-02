import mongoose, { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';

import { canTransition, type OrderStatus } from '../constants/order';
import {
  ArtworkAsset,
  CustomOffer,
  Message,
  Order,
  PaymentFulfillment,
  PaymentReconciliation,
  Product,
  User,
  type IOrder,
} from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { logAuditEvent } from './audit.service';
import { sendOrderEmail, sendOrderEmailWithResult } from './email.service';

export type OrderTransitionSource =
  | 'admin'
  | 'dispatch'
  | 'payment'
  | 'proof'
  | 'print'
  | 'customer_cancel'
  | 'completion'
  | 'system';

interface PaymentApplicationInput {
  provider: string;
  reference?: string;
  amountMinor: number;
  currency: string;
  method?: string;
  actor?: IUser;
  stripeCheckoutSessionId?: string;
  assertLease?: () => Promise<void>;
}

export async function applyPaymentToOrder(
  orderId: string | Types.ObjectId,
  input: PaymentApplicationInput,
): Promise<IOrder> {
  const order = await Order.findById(orderId).select('+reservedStock');
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (order.customOffer) return applyPrivateOfferPayment(order, input);
  if (order.payment.status === 'paid') return order;
  if (
    input.amountMinor !== order.totalMinor ||
    input.currency.toUpperCase() !== order.currency.toUpperCase()
  ) {
    const mismatchNote = `Payment mismatch: received ${input.amountMinor} ${input.currency.toUpperCase()}, expected ${order.totalMinor} ${order.currency}.`;
    await input.assertLease?.();
    await Order.updateOne(
      { _id: order._id, 'payment.status': { $ne: 'paid' } },
      { $set: { 'payment.mismatchNote': mismatchNote } },
    );
    await input.assertLease?.();
    await logAuditEvent({
      actor: input.actor,
      actorRole: input.actor ? undefined : 'system',
      action: 'order.payment_mismatch',
      targetType: 'Order',
      targetId: order._id.toString(),
      metadata: {
        expectedCurrency: order.currency,
        receivedCurrency: input.currency.toUpperCase(),
      },
    });
    throw new AppError(
      'Payment amount or currency does not match the order',
      409,
      'PAYMENT_AMOUNT_MISMATCH',
    );
  }
  if (order.status !== 'pending_payment') {
    throw new AppError(
      'Order is not awaiting payment',
      409,
      'INVALID_PAYMENT_STATE',
    );
  }
  const status = order.items.some((item) => item.requiresProof)
    ? 'pending_proof_approval'
    : 'in_printing';
  let updated: IOrder;
  try {
    await input.assertLease?.();
    updated = await changeOrderStatus(
      order._id,
      status,
      input.actor,
      'Payment confirmed',
      'payment',
      {
        'payment.provider': input.provider,
        'payment.providerReference': input.reference,
        ...(input.reference?.startsWith('pi_')
          ? { 'payment.stripePaymentIntentId': input.reference }
          : {}),
        'payment.status': 'paid',
        'payment.paidAt': new Date(),
        'payment.method': input.method,
        'payment.mismatchNote': undefined,
      },
    );
  } catch (error) {
    const current = await Order.findById(order._id).select('+reservedStock');
    if (current?.payment.status === 'paid') return current;
    throw error;
  }
  const quantities = new Map<string, number>();
  for (const item of order.items) {
    const productId = item.product.toString();
    quantities.set(productId, (quantities.get(productId) ?? 0) + item.quantity);
  }
  await input.assertLease?.();
  await Promise.all(
    [...quantities].map(([productId, quantity]) =>
      Product.updateOne({ _id: productId }, { $inc: { soldCount: quantity } }),
    ),
  );
  await input.assertLease?.();
  await logAuditEvent({
    actor: input.actor,
    actorRole: input.actor ? undefined : 'system',
    action: 'order.payment_paid',
    targetType: 'Order',
    targetId: order._id.toString(),
    metadata: { provider: input.provider, amountMinor: input.amountMinor },
  });
  await input.assertLease?.();
  await sendOrderEmail(updated, 'payment_confirmed');
  return (await Order.findById(order._id).select('+reservedStock')) ?? updated;
}

async function applyPrivateOfferPayment(
  initialOrder: IOrder,
  input: PaymentApplicationInput,
): Promise<IOrder> {
  const order = initialOrder;
  try {
    await input.assertLease?.();
    await ensureCustomOfferPaymentEligibility(order, input);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    await recordPrivateOfferReconciliation(order, input, error.message);
    return order;
  }

  const paidAt = order.payment.paidAt ?? new Date();
  let paidOrder = order;
  if (order.payment.status !== 'paid') {
    const nextStatus = order.items.some((item) => item.requiresProof)
      ? 'pending_proof_approval'
      : 'in_printing';
    await input.assertLease?.();
    const updated = await Order.findOneAndUpdate(
      {
        _id: order._id,
        customOffer: order.customOffer,
        user: order.user,
        status: 'pending_payment',
        'payment.status': { $in: ['pending', 'failed'] },
        'payment.provider': input.provider,
        'payment.stripeCheckoutSessionId': input.stripeCheckoutSessionId,
        totalMinor: input.amountMinor,
        subtotalMinor: input.amountMinor,
        discountMinor: 0,
        shippingMinor: 0,
        taxMinor: 0,
        currency: input.currency.toUpperCase(),
        items: { $size: 1 },
        'items.0.product': order.items[0]?.product,
        'items.0.quantity': 1,
        'items.0.unitPriceMinor': input.amountMinor,
        'items.0.lineTotalMinor': input.amountMinor,
        'items.0.productionQuantity': order.items[0]?.productionQuantity,
      },
      {
        $set: {
          status: nextStatus,
          'payment.provider': input.provider,
          'payment.providerReference': input.reference,
          ...(input.reference?.startsWith('pi_')
            ? { 'payment.stripePaymentIntentId': input.reference }
            : {}),
          'payment.status': 'paid',
          'payment.paidAt': paidAt,
          'payment.method': input.method,
          'payment.mismatchNote': undefined,
        },
        $push: {
          statusHistory: {
            from: 'pending_payment',
            to: nextStatus,
            note: 'Private-offer payment confirmed',
            at: paidAt,
          },
        },
      },
      { new: true },
    );
    if (updated) {
      paidOrder = updated;
    } else {
      const current = await Order.findById(order._id).select('+reservedStock');
      const isAlreadyPaidForThisSession =
        current?.payment.status === 'paid' &&
        current.payment.provider === input.provider &&
        current.payment.stripeCheckoutSessionId ===
          input.stripeCheckoutSessionId &&
        current.totalMinor === input.amountMinor &&
        current.currency.toUpperCase() === input.currency.toUpperCase();
      if (!isAlreadyPaidForThisSession) {
        await recordPrivateOfferReconciliation(
          current ?? order,
          input,
          'Payment was captured after the order stopped awaiting payment or its persisted terms changed.',
        );
        return current ?? order;
      }
      paidOrder = current;
    }
  }

  await input.assertLease?.();
  await PaymentFulfillment.updateOne(
    { order: paidOrder._id },
    { $setOnInsert: { order: paidOrder._id, status: 'pending', attempts: 0 } },
    { upsert: true },
  );
  await processPrivateOfferPaymentFulfillment(paidOrder._id, input.assertLease);
  return (
    (await Order.findById(paidOrder._id).select('+reservedStock')) ?? paidOrder
  );
}

export async function processPendingPrivateOfferPaymentFulfillments(
  limit = 50,
): Promise<number> {
  const paidOrders = await Order.find({
    customOffer: { $exists: true },
    'payment.paidAt': { $exists: true },
    'payment.fulfillmentCompletedAt': { $exists: false },
  })
    .sort({ 'payment.paidAt': 1 })
    .limit(limit)
    .select('_id');
  for (const order of paidOrders) {
    await PaymentFulfillment.updateOne(
      { order: order._id },
      {
        $setOnInsert: { order: order._id, status: 'pending', attempts: 0 },
      },
      { upsert: true },
    );
    try {
      await processPrivateOfferPaymentFulfillment(order._id);
      const task = await PaymentFulfillment.findOne({
        order: order._id,
      }).select('status');
      if (task?.status === 'completed') {
        await Order.updateOne(
          {
            _id: order._id,
            'payment.fulfillmentCompletedAt': { $exists: false },
          },
          { $set: { 'payment.fulfillmentCompletedAt': new Date() } },
        );
      }
    } catch (error) {
      logger.error(
        {
          orderId: order._id.toString(),
          errorCode:
            error instanceof AppError ? error.code : 'UNEXPECTED_ERROR',
        },
        'Private-offer payment fulfillment retry failed',
      );
    }
  }
  return paidOrders.length;
}

async function processPrivateOfferPaymentFulfillment(
  orderId: Types.ObjectId,
  assertLease?: () => Promise<void>,
): Promise<void> {
  await assertLease?.();
  const now = new Date();
  const leaseToken = randomUUID();
  const task = await PaymentFulfillment.findOneAndUpdate(
    {
      order: orderId,
      $or: [
        { status: 'pending' },
        { status: 'processing', leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: 'processing',
        leaseToken,
        leaseUntil: new Date(now.getTime() + 5 * 60_000),
      },
      $inc: { attempts: 1 },
      $unset: { lastError: 1 },
    },
    { new: true },
  );
  if (!task) return;

  try {
    const order = await Order.findById(orderId).select('+reservedStock');
    if (
      !order?.customOffer ||
      !order.user ||
      order.payment.status !== 'paid' ||
      !order.payment.paidAt ||
      order.payment.provider !== 'stripe' ||
      !order.payment.stripeCheckoutSessionId ||
      !order.payment.providerReference ||
      (order.payment.stripePaymentIntentId
        ? order.payment.providerReference !==
          order.payment.stripePaymentIntentId
        : order.payment.providerReference !==
          order.payment.stripeCheckoutSessionId)
    ) {
      await blockPaymentFulfillment(
        task,
        leaseToken,
        order ?? undefined,
        'Paid private-offer payment identity or order relationships are incomplete.',
        assertLease,
      );
      return;
    }

    const offer = await CustomOffer.findById(order.customOffer);
    const item = order.items[0];
    if (
      !offer ||
      offer.customer.toString() !== order.user.toString() ||
      offer.order?.toString() !== order._id.toString() ||
      order.items.length !== 1 ||
      !item ||
      item.product.toString() !== offer.product.toString() ||
      item.quantity !== 1 ||
      item.unitPriceMinor !== offer.agreedPriceMinor ||
      item.lineTotalMinor !== offer.agreedPriceMinor ||
      item.productionQuantity !== offer.agreedQuantity ||
      order.totalMinor !== offer.agreedPriceMinor ||
      order.subtotalMinor !== offer.agreedPriceMinor ||
      order.discountMinor !== 0 ||
      order.shippingMinor !== 0 ||
      order.taxMinor !== 0 ||
      order.currency.toUpperCase() !== offer.currency.toUpperCase()
    ) {
      await blockPaymentFulfillment(
        task,
        leaseToken,
        order,
        'Paid private-offer order contents do not match its stored offer and payment terms.',
        assertLease,
      );
      return;
    }

    if (order.status === 'cancelled') {
      await blockPaymentFulfillment(
        task,
        leaseToken,
        order,
        'The paid order was cancelled before private-offer fulfillment.',
        assertLease,
      );
      return;
    }

    if (offer.status === 'reserved') {
      await assertLease?.();
      const transitioned = await CustomOffer.updateOne(
        {
          _id: offer._id,
          customer: order.user,
          order: order._id,
          status: 'reserved',
        },
        { $set: { status: 'purchased', purchasedAt: order.payment.paidAt } },
      );
      if (transitioned.modifiedCount !== 1) {
        const current = await CustomOffer.findById(offer._id).select(
          'status order',
        );
        if (
          current?.status !== 'purchased' ||
          current.order?.toString() !== order._id.toString()
        ) {
          await blockPaymentFulfillment(
            task,
            leaseToken,
            order,
            'The offer could not be completed for the paid order.',
            assertLease,
          );
          return;
        }
      }
    } else if (
      offer.status !== 'purchased' ||
      offer.order.toString() !== order._id.toString()
    ) {
      await blockPaymentFulfillment(
        task,
        leaseToken,
        order,
        `The offer is ${offer.status}; payment requires manual review.`,
        assertLease,
      );
      return;
    }

    if (!task.offerCompletedAt) {
      await completeFulfillmentStep(
        task._id,
        leaseToken,
        'offerCompletedAt',
        assertLease,
      );
    }

    const currentOrder = await Order.findById(orderId).select('+reservedStock');
    if (
      !currentOrder?.payment.paidAt ||
      currentOrder.payment.status !== 'paid'
    ) {
      await blockPaymentFulfillment(
        task,
        leaseToken,
        currentOrder ?? order,
        'The paid order is no longer eligible for production fulfillment.',
        assertLease,
      );
      return;
    }
    if (!task.orderPaidAt) {
      await completeFulfillmentStep(
        task._id,
        leaseToken,
        'orderPaidAt',
        assertLease,
      );
    }

    const currentTask = await PaymentFulfillment.findById(task._id);
    if (!currentTask?.soldCountAppliedAt) {
      const item = currentOrder.items[0];
      if (!item) {
        await blockPaymentFulfillment(
          task,
          leaseToken,
          currentOrder,
          'The paid private-offer order has no production line.',
          assertLease,
        );
        return;
      }
      await assertLease?.();
      const countUpdate = await Product.updateOne(
        {
          _id: item.product,
          customOfferSoldCountApplied: { $ne: true },
        },
        {
          $inc: { soldCount: item.quantity },
          $set: { customOfferSoldCountApplied: true },
        },
      );
      if (countUpdate.modifiedCount !== 1) {
        const product = await Product.findById(item.product)
          .select('+customOfferSoldCountApplied')
          .lean();
        if (!product || !product.customOfferSoldCountApplied) {
          await blockPaymentFulfillment(
            task,
            leaseToken,
            currentOrder,
            'The private-offer product sales counter could not be updated.',
            assertLease,
          );
          return;
        }
      }
      await completeFulfillmentStep(
        task._id,
        leaseToken,
        'soldCountAppliedAt',
        assertLease,
      );
    }

    const afterCount = await PaymentFulfillment.findById(task._id);
    if (!afterCount?.auditLoggedAt) {
      await assertLease?.();
      await logAuditEvent({
        actorRole: 'system',
        action: 'order.payment_paid',
        targetType: 'Order',
        targetId: currentOrder._id.toString(),
        metadata: {
          provider: currentOrder.payment.provider,
          amountMinor: currentOrder.totalMinor,
        },
        idempotencyKey: `private-offer-payment-paid:${currentOrder._id}`,
      });
      await completeFulfillmentStep(
        task._id,
        leaseToken,
        'auditLoggedAt',
        assertLease,
      );
    }

    const beforeEmail = await PaymentFulfillment.findById(task._id);
    if (!beforeEmail?.emailSentAt) {
      await assertLease?.();
      const emailDelivered = await sendOrderEmailWithResult(
        currentOrder,
        'payment_confirmed',
      );
      if (!emailDelivered) {
        throw new AppError(
          'Payment confirmation email delivery will be retried',
          503,
          'PAYMENT_FULFILLMENT_EMAIL_FAILED',
        );
      }
      await completeFulfillmentStep(
        task._id,
        leaseToken,
        'emailSentAt',
        assertLease,
      );
    }

    await assertLease?.();
    const completed = await PaymentFulfillment.updateOne(
      { _id: task._id, status: 'processing', leaseToken },
      {
        $set: { status: 'completed', completedAt: new Date() },
        $unset: { leaseToken: 1, leaseUntil: 1, lastError: 1 },
      },
    );
    if (completed.modifiedCount !== 1) {
      throw new AppError(
        'Payment fulfillment lease was lost before completion',
        503,
        'PAYMENT_FULFILLMENT_LEASE_LOST',
      );
    }
    await assertLease?.();
    await Order.updateOne(
      { _id: orderId, 'payment.fulfillmentCompletedAt': { $exists: false } },
      { $set: { 'payment.fulfillmentCompletedAt': new Date() } },
    );
  } catch (error) {
    await assertLease?.();
    await PaymentFulfillment.updateOne(
      { _id: task._id, status: 'processing', leaseToken },
      {
        $set: {
          status: 'pending',
          leaseUntil: new Date(),
          lastError:
            error instanceof AppError ? error.code : 'UNEXPECTED_ERROR',
        },
        $unset: { leaseToken: 1 },
      },
    );
    throw error;
  }
}

async function completeFulfillmentStep(
  taskId: Types.ObjectId,
  leaseToken: string,
  step:
    | 'offerCompletedAt'
    | 'orderPaidAt'
    | 'soldCountAppliedAt'
    | 'auditLoggedAt'
    | 'emailSentAt',
  assertLease?: () => Promise<void>,
): Promise<void> {
  await assertLease?.();
  const result = await PaymentFulfillment.updateOne(
    { _id: taskId, status: 'processing', leaseToken },
    { $set: { [step]: new Date() } },
  );
  if (result.modifiedCount !== 1) {
    throw new AppError(
      'Payment fulfillment lease was lost while recording a completed step',
      503,
      'PAYMENT_FULFILLMENT_LEASE_LOST',
    );
  }
}

async function blockPaymentFulfillment(
  task: { _id: Types.ObjectId; order: Types.ObjectId },
  leaseToken: string,
  order: IOrder | undefined,
  reason: string,
  assertLease?: () => Promise<void>,
): Promise<void> {
  if (order) {
    await recordPrivateOfferReconciliation(order, { assertLease }, reason);
  }
  await assertLease?.();
  await PaymentFulfillment.updateOne(
    { _id: task._id, status: 'processing', leaseToken },
    {
      $set: { status: 'blocked', lastError: reason },
      $unset: { leaseToken: 1, leaseUntil: 1 },
    },
  );
}

async function recordPrivateOfferReconciliation(
  order: IOrder,
  input: Partial<PaymentApplicationInput>,
  reason: string,
): Promise<void> {
  await input.assertLease?.();
  const sessionId =
    input.stripeCheckoutSessionId ?? order.payment.stripeCheckoutSessionId;
  const paymentIntentId = input.reference?.startsWith('pi_')
    ? input.reference
    : order.payment.stripePaymentIntentId;
  const dedupeKey = sessionId
    ? `stripe-session:${sessionId}`
    : `stripe-order:${order._id}:${paymentIntentId ?? 'unknown'}`;
  await PaymentReconciliation.updateOne(
    { dedupeKey },
    {
      $setOnInsert: {
        dedupeKey,
        provider: 'stripe',
        reason,
        status: 'manual_review',
        ...(sessionId ? { sessionId } : {}),
        ...(paymentIntentId ? { paymentIntentId } : {}),
        order: order._id,
        ...(order.customOffer ? { offer: order.customOffer } : {}),
        ...(order.user ? { customer: order.user } : {}),
        ...(order.items[0] ? { product: order.items[0].product } : {}),
        amountMinor: input.amountMinor ?? order.totalMinor,
        currency: input.currency ?? order.currency,
      },
    },
    { upsert: true },
  );
  await input.assertLease?.();
  await Order.updateOne(
    { _id: order._id, 'payment.status': { $ne: 'paid' } },
    { $set: { 'payment.mismatchNote': reason } },
  );
}

async function ensureCustomOfferPaymentEligibility(
  order: IOrder,
  input: PaymentApplicationInput,
): Promise<void> {
  if (!order.customOffer) return;
  const [offer, product, customer] = await Promise.all([
    CustomOffer.findById(order.customOffer).lean(),
    order.items[0]
      ? Product.findById(order.items[0].product)
          .select('visibility status')
          .lean()
      : null,
    order.user
      ? User.findById(order.user).select('role accountState').lean()
      : null,
  ]);
  if (!offer) {
    throw new AppError(
      'The private offer for this order could not be loaded',
      409,
      'CUSTOM_OFFER_NOT_FOUND',
    );
  }
  if (!order.user || order.user.toString() !== offer.customer.toString()) {
    throw new AppError(
      'The private offer does not belong to the order customer',
      409,
      'CUSTOM_OFFER_CUSTOMER_MISMATCH',
    );
  }
  if (offer.order?.toString() !== order._id.toString()) {
    throw new AppError(
      'The private offer does not reference this order',
      409,
      'CUSTOM_OFFER_ORDER_MISMATCH',
    );
  }
  if (
    !product ||
    product.visibility !== 'private' ||
    product.status !== 'active'
  ) {
    throw new AppError(
      'The private-offer product is no longer available',
      409,
      'CUSTOM_OFFER_PRODUCT_UNAVAILABLE',
    );
  }
  if (
    !customer ||
    customer.role !== 'customer' ||
    customer.accountState !== 'active'
  ) {
    throw new AppError(
      'The private-offer customer account is no longer available',
      409,
      'CUSTOM_OFFER_CUSTOMER_UNAVAILABLE',
    );
  }
  const request = await Message.findById(offer.request)
    .select('type customerId customRequestStatus')
    .lean();
  if (
    !request ||
    request.type !== 'custom_3d_request' ||
    request.customerId?.toString() !== offer.customer.toString() ||
    !['accepted', 'offer_created', 'completed'].includes(
      request.customRequestStatus ?? '',
    )
  ) {
    throw new AppError(
      'The custom request linked to this offer is no longer eligible',
      409,
      'CUSTOM_OFFER_REQUEST_UNAVAILABLE',
    );
  }
  if (
    input.provider === 'stripe' &&
    (!input.stripeCheckoutSessionId ||
      input.stripeCheckoutSessionId !== order.payment.stripeCheckoutSessionId)
  ) {
    throw new AppError(
      'Stripe Checkout Session does not match the persisted order',
      409,
      'PAYMENT_SESSION_RELATIONSHIP_MISMATCH',
    );
  }
  const paymentAlreadyApplied =
    order.payment.status === 'paid' &&
    input.provider === 'stripe' &&
    order.payment.provider === 'stripe' &&
    input.stripeCheckoutSessionId === order.payment.stripeCheckoutSessionId &&
    order.payment.providerReference === input.reference;
  const paidForThisOrder =
    paymentAlreadyApplied &&
    ['reserved', 'purchased'].includes(offer.status) &&
    offer.order.toString() === order._id.toString();
  if (!paidForThisOrder && offer.status !== 'reserved') {
    const statusCode =
      offer.status === 'cancelled'
        ? 'CUSTOM_OFFER_CANCELLED'
        : offer.status === 'expired'
          ? 'CUSTOM_OFFER_EXPIRED'
          : offer.status === 'purchased'
            ? 'CUSTOM_OFFER_ALREADY_PURCHASED'
            : 'CUSTOM_OFFER_NOT_RESERVED';
    throw new AppError(
      `Private offer is ${offer.status} and cannot accept this payment`,
      409,
      statusCode,
    );
  }
  if (!paidForThisOrder && offer.expiresAt <= new Date()) {
    await input.assertLease?.();
    await CustomOffer.updateOne(
      { _id: offer._id, order: order._id, status: 'reserved' },
      { $set: { status: 'expired' } },
    );
    throw new AppError(
      'Private offer has expired',
      409,
      'CUSTOM_OFFER_EXPIRED',
    );
  }
  if (
    !paidForThisOrder &&
    (order.status !== 'pending_payment' ||
      !['pending', 'failed'].includes(order.payment.status))
  ) {
    throw new AppError(
      'Private-offer order is no longer awaiting payment',
      409,
      'ORDER_NOT_PAYABLE',
    );
  }
  if (
    order.items.length !== 1 ||
    order.items[0].product.toString() !== offer.product.toString() ||
    order.items[0].unitPriceMinor !== offer.agreedPriceMinor ||
    order.items[0].lineTotalMinor !== offer.agreedPriceMinor ||
    order.items[0].productionQuantity !== offer.agreedQuantity ||
    order.totalMinor !== offer.agreedPriceMinor ||
    order.subtotalMinor !== offer.agreedPriceMinor ||
    order.currency.toUpperCase() !== offer.currency.toUpperCase() ||
    order.discountMinor !== 0 ||
    order.shippingMinor !== 0 ||
    order.taxMinor !== 0 ||
    order.items[0].quantity !== 1
  ) {
    await input.assertLease?.();
    await Order.updateOne(
      { _id: order._id, 'payment.status': { $ne: 'paid' } },
      {
        $set: {
          'payment.mismatchNote':
            'Private offer payment terms do not match the persisted offer; manual reconciliation required.',
        },
      },
    );
    throw new AppError(
      'Private offer payment terms do not match the persisted offer',
      409,
      'CUSTOM_OFFER_PAYMENT_STATE_MISMATCH',
    );
  }
  if (
    input.amountMinor !== order.totalMinor ||
    input.currency.toUpperCase() !== order.currency.toUpperCase()
  ) {
    await input.assertLease?.();
    await Order.updateOne(
      { _id: order._id, 'payment.status': { $ne: 'paid' } },
      {
        $set: {
          'payment.mismatchNote': `Payment mismatch: received ${input.amountMinor} ${input.currency.toUpperCase()}, expected ${order.totalMinor} ${order.currency}.`,
        },
      },
    );
    throw new AppError(
      'Payment amount or currency does not match the order',
      409,
      'PAYMENT_AMOUNT_MISMATCH',
    );
  }
}

export async function changeOrderStatus(
  orderId: string | Types.ObjectId,
  toStatus: OrderStatus,
  actor: IUser | undefined,
  note?: string,
  source: OrderTransitionSource = 'admin',
  additionalSet: Record<string, unknown> = {},
): Promise<IOrder> {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  const from = order.status;
  if (!canTransition(from, toStatus)) {
    throw new AppError(
      `Cannot transition order from ${from} to ${toStatus}`,
      400,
      'INVALID_STATUS_TRANSITION',
    );
  }
  if (toStatus === 'shipped' && source !== 'dispatch') {
    throw new AppError(
      'Use dispatch to record shipment before marking an order shipped',
      400,
      'DISPATCH_REQUIRED',
    );
  }
  if (
    from === 'in_printing' &&
    toStatus === 'cancelled' &&
    actor?.role !== 'admin'
  ) {
    throw new AppError(
      'Only an admin can cancel an order already in printing',
      403,
      'FORBIDDEN',
    );
  }

  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: from,
      ...(additionalSet['payment.status'] === 'paid'
        ? { 'payment.status': { $ne: 'paid' } }
        : {}),
      ...(source === 'system' && toStatus === 'cancelled'
        ? {
            'payment.status': { $in: ['pending', 'failed'] },
            'payment.paidAt': { $exists: false },
          }
        : {}),
    },
    {
      $set: {
        status: toStatus,
        ...(toStatus === 'cancelled' ? { fulfillmentStatus: 'cancelled' } : {}),
        ...(toStatus === 'completed' ? { fulfillmentStatus: 'fulfilled' } : {}),
        ...additionalSet,
      },
      $push: {
        statusHistory: {
          from,
          to: toStatus,
          actor: actor?._id,
          note,
          at: new Date(),
        },
      },
    },
    { new: true },
  );
  if (!updated) {
    throw new AppError(
      'Order status changed; refresh and retry',
      409,
      'ORDER_STATUS_CONFLICT',
    );
  }
  await logAuditEvent({
    actor,
    action: 'order.status_change',
    targetType: 'Order',
    targetId: updated._id.toString(),
    metadata: { from, to: toStatus, source },
  });
  if (toStatus === 'cancelled') {
    await sendOrderEmail(updated, 'cancelled', { note: note ?? '' });
  }
  if (toStatus === 'shipped') {
    await sendOrderEmail(updated, 'shipped', {
      carrier: updated.shipment?.carrier ?? '',
      trackingNumber: updated.shipment?.trackingNumber ?? '',
      trackingUrl: updated.shipment?.trackingUrl ?? '',
    });
  }
  return updated;
}

export async function applyArtworkDecisionToOrder(
  orderId: Types.ObjectId,
  itemId: Types.ObjectId,
  decision: 'approved' | 'replacement_requested',
  note: string | undefined,
  actor: IUser,
): Promise<void> {
  const order = await Order.findById(orderId).select('+reservedStock');
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (
    order.status !== 'pending_proof_approval' &&
    order.status !== 'artwork_rejected'
  ) {
    throw new AppError(
      'Artwork can only be reviewed while proof approval is pending',
      409,
      'INVALID_ARTWORK_REVIEW_STATE',
    );
  }
  const item = order.items.find((entry) => entry._id.equals(itemId));
  if (!item || !item.artwork) {
    throw new AppError(
      'Artwork order item not found',
      404,
      'ARTWORK_NOT_FOUND',
    );
  }
  const reviewedAt = new Date();
  const artwork = await ArtworkAsset.findOneAndUpdate(
    { _id: item.artwork, reviewStatus: 'pending' },
    {
      $set: {
        reviewStatus: decision,
        reviewedBy: actor._id,
        reviewedAt,
        reviewNote:
          decision === 'replacement_requested' ? note?.trim() : undefined,
      },
    },
    { new: true, runValidators: true },
  );
  if (!artwork) {
    const exists = await ArtworkAsset.exists({ _id: item.artwork });
    if (!exists) {
      throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
    }
    throw new AppError(
      'Artwork is no longer pending review',
      409,
      'ARTWORK_NOT_PENDING',
    );
  }
  item.itemPrintStatus =
    decision === 'approved' ? 'queued' : 'artwork_rejected';
  await order.save();
  await logAuditEvent({
    actor,
    action: `artwork.${decision}`,
    targetType: 'ArtworkAsset',
    targetId: artwork._id.toString(),
    metadata: {
      orderId: order._id.toString(),
      orderItemId: item._id.toString(),
    },
  });

  if (decision === 'replacement_requested') {
    if (order.status !== 'artwork_rejected') {
      await changeOrderStatus(
        order._id,
        'artwork_rejected',
        actor,
        note,
        'proof',
      );
    }
    await sendOrderEmail(order, 'replacement_requested', {
      note: note?.trim() ?? '',
    });
    return;
  }

  const artworkIds = order.items
    .filter((entry) => entry.artwork)
    .map((entry) => entry.artwork!.toString());
  const remaining = await ArtworkAsset.countDocuments({
    _id: { $in: artworkIds },
    reviewStatus: { $ne: 'approved' },
  });
  if (remaining === 0 && order.status === 'pending_proof_approval') {
    await changeOrderStatus(order._id, 'in_printing', actor, note, 'proof');
  } else if (order.status === 'artwork_rejected' && remaining === 0) {
    await changeOrderStatus(
      order._id,
      'pending_proof_approval',
      actor,
      note,
      'proof',
    );
    await changeOrderStatus(order._id, 'in_printing', actor, note, 'proof');
  }
  await sendOrderEmail(order, 'proof_approved');
}

export async function changeItemPrintStatus(
  orderId: string,
  itemId: string,
  status: 'queued' | 'printing' | 'printed' | 'quality_check' | 'ready',
  actor: IUser,
  note?: string,
): Promise<IOrder> {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (order.status !== 'in_printing' && order.status !== 'ready') {
    throw new AppError(
      'Print status can only change during production',
      400,
      'INVALID_PRINT_STATUS',
    );
  }
  const item = order.items.find((entry) => entry._id.toString() === itemId);
  if (!item)
    throw new AppError('Order item not found', 404, 'ORDER_ITEM_NOT_FOUND');
  item.itemPrintStatus = status;
  await order.save();
  await logAuditEvent({
    actor,
    action: 'order.item_print_status',
    targetType: 'Order',
    targetId: order._id.toString(),
    metadata: { itemId, status, note },
  });
  if (
    order.status === 'in_printing' &&
    order.items.every((entry) => entry.itemPrintStatus === 'ready')
  ) {
    return changeOrderStatus(order._id, 'ready', actor, note, 'print');
  }
  return order;
}

export async function reserveProductStock(
  productId: Types.ObjectId,
  quantity: number,
  rules: {
    trackInventory: boolean;
    allowBackorder: boolean;
    reserveBlanksForMadeToOrder: boolean;
  },
): Promise<number> {
  if (!rules.trackInventory) return 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const product = await Product.findById(productId)
      .select('stock.quantity')
      .lean();
    const available = product?.stock.quantity ?? 0;
    if (available >= quantity) {
      const reserved = await Product.findOneAndUpdate(
        { _id: productId, 'stock.quantity': { $gte: quantity } },
        { $inc: { 'stock.quantity': -quantity } },
        { new: false, projection: { _id: 1 } },
      );
      if (reserved) return quantity;
      continue;
    }
    if (!rules.allowBackorder && !rules.reserveBlanksForMadeToOrder) {
      throw new AppError(
        'Insufficient stock to complete checkout',
        409,
        'CART_HAS_BLOCKING_ISSUES',
      );
    }
    if (available === 0) return 0;
    const reserved = await Product.findOneAndUpdate(
      { _id: productId, 'stock.quantity': { $gte: available } },
      { $inc: { 'stock.quantity': -available } },
      { new: false, projection: { _id: 1 } },
    );
    if (reserved) return available;
  }
  throw new AppError(
    'Stock changed during checkout; please retry',
    409,
    'CART_HAS_BLOCKING_ISSUES',
  );
}

export async function restoreReservedStock(
  reservations: Array<{ product: Types.ObjectId; quantity: number }>,
): Promise<void> {
  for (const reservation of reservations) {
    if (reservation.quantity <= 0) continue;
    await Product.updateOne(
      { _id: reservation.product },
      { $inc: { 'stock.quantity': reservation.quantity } },
    );
  }
}

export function allowedNextStatuses(status: OrderStatus): OrderStatus[] {
  return Object.keys({
    pending_payment: 1,
    pending_proof_approval: 1,
    artwork_rejected: 1,
    in_printing: 1,
    ready: 1,
    shipped: 1,
    completed: 1,
    cancelled: 1,
  }).filter((candidate): candidate is OrderStatus =>
    canTransition(status, candidate as OrderStatus),
  );
}

export function orderObjectId(id: string): Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  }
  return new Types.ObjectId(id);
}
