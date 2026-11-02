import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { getStripeClient } from '../../config/stripe';
import {
  CustomOffer,
  Message,
  Order,
  PaymentReconciliation,
  Product,
  StripeEvent,
  User,
  type IOrder,
} from '../../models';
import type { IUser } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { logAuditEvent } from '../audit.service';
import { sendCustomerEmail } from '../email.service';
import {
  applyPaymentToOrder,
  changeOrderStatus,
  restoreReservedStock,
} from '../orderWorkflow.service';
import { getPaymentProviderByName } from './index';

type CustomerIdentity = { user?: IUser; email?: string };
type StripeEventLeaseGuard = () => Promise<void>;

const STRIPE_EVENT_LEASE_DURATION_MS = 5 * 60_000;
const STRIPE_EVENT_LEASE_RENEWAL_INTERVAL_MS = 60_000;

export async function startOrderCheckout(
  orderNumber: string,
  identity: CustomerIdentity,
): Promise<{ checkoutUrl: string; expiresAt: Date }> {
  const order = await ownedOrder(orderNumber, identity);
  const offerExpiresAt = order.customOffer
    ? await validateCustomOfferCheckout(order)
    : undefined;
  if (
    order.status !== 'pending_payment' ||
    !['pending', 'failed'].includes(order.payment.status)
  ) {
    throw new AppError(
      'Order is not available for payment',
      409,
      'ORDER_NOT_PAYABLE',
    );
  }
  const provider = getPaymentProviderByName(order.payment.provider);
  if (!provider.createCheckoutSession) {
    throw new AppError(
      'Hosted checkout is not enabled',
      409,
      'PAYMENT_PROVIDER_UNAVAILABLE',
    );
  }
  if (
    order.customOffer &&
    order.payment.stripeCheckoutRecoveryStatus === 'needs_review'
  ) {
    throw new AppError(
      'A previous checkout attempt needs payment reconciliation before another session can be created',
      409,
      'PAYMENT_SESSION_RECOVERY_REQUIRED',
    );
  }
  if (
    order.customOffer &&
    (order.payment.stripeCheckoutRecoveryStatus === 'creating' ||
      order.payment.stripeCheckoutRecoveryStatus === 'awaiting_result')
  ) {
    throw new AppError(
      'A previous private-offer checkout attempt has not reached a safe retry state',
      409,
      'PAYMENT_SESSION_RECOVERY_REQUIRED',
    );
  }
  if (
    order.payment.stripeCheckoutSessionId &&
    order.payment.stripeCheckoutSessionStatus === 'open' &&
    order.payment.stripeCheckoutExpiresAt &&
    order.payment.stripeCheckoutExpiresAt > new Date()
  ) {
    return {
      checkoutUrl: await retrieveOpenSessionUrl(
        order.payment.stripeCheckoutSessionId,
      ),
      expiresAt: order.payment.stripeCheckoutExpiresAt,
    };
  }
  const lockUntil = new Date(Date.now() + 2 * 60_000);
  const locked = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: 'pending_payment',
      'payment.status': { $in: ['pending', 'failed'] },
      $or: [
        { 'payment.stripeCheckoutCreatingUntil': { $exists: false } },
        { 'payment.stripeCheckoutCreatingUntil': { $lt: new Date() } },
      ],
    },
    {
      $set: {
        'payment.stripeCheckoutCreatingUntil': lockUntil,
        ...(order.customOffer
          ? { 'payment.stripeCheckoutRecoveryStatus': 'creating' }
          : {}),
      },
      $inc: { 'payment.stripeCheckoutAttempt': 1 },
    },
    { new: true },
  );
  if (!locked) {
    const current = await Order.findById(order._id);
    if (
      current?.payment.stripeCheckoutSessionId &&
      current.payment.stripeCheckoutSessionStatus === 'open' &&
      current.payment.stripeCheckoutExpiresAt &&
      current.payment.stripeCheckoutExpiresAt > new Date()
    ) {
      return {
        checkoutUrl: await retrieveOpenSessionUrl(
          current.payment.stripeCheckoutSessionId,
        ),
        expiresAt: current.payment.stripeCheckoutExpiresAt,
      };
    }
    throw new AppError(
      'Payment is already being prepared',
      409,
      'PAYMENT_SESSION_IN_PROGRESS',
    );
  }
  let createdSession:
    | {
        id: string;
        url: string;
        expiresAt: Date;
        paymentIntentId?: string;
      }
    | undefined;
  try {
    const session = await provider.createCheckoutSession(
      locked,
      locked.payment.stripeCheckoutAttempt,
      offerExpiresAt ? { expiresAt: offerExpiresAt } : undefined,
    );
    createdSession = session;
    const saved = await Order.findOneAndUpdate(
      { _id: locked._id, 'payment.stripeCheckoutCreatingUntil': lockUntil },
      {
        $set: {
          'payment.stripeCheckoutSessionId': session.id,
          'payment.stripeCheckoutSessionStatus': 'open',
          'payment.stripeCheckoutExpiresAt': session.expiresAt,
          ...(session.paymentIntentId
            ? { 'payment.stripePaymentIntentId': session.paymentIntentId }
            : {}),
          ...(order.customOffer
            ? {
                'payment.stripeCheckoutRecoveryStatus': 'ready',
                'payment.mismatchNote': undefined,
              }
            : {}),
        },
        $unset: { 'payment.stripeCheckoutCreatingUntil': 1 },
      },
      { new: true },
    );
    if (!saved) {
      throw new AppError(
        'Payment session state changed',
        409,
        'PAYMENT_STATE_CONFLICT',
      );
    }
    return { checkoutUrl: session.url, expiresAt: session.expiresAt };
  } catch (error) {
    if (order.customOffer) {
      const sessionToRecover =
        createdSession ?? checkoutSessionRecoveryFromError(error);
      if (sessionToRecover && provider.expireCheckoutSession) {
        try {
          await provider.expireCheckoutSession(sessionToRecover.id);
          await Order.updateOne(
            { _id: locked._id },
            {
              $set: {
                'payment.stripeCheckoutRecoveryStatus': 'ready',
                'payment.stripeCheckoutSessionId': sessionToRecover.id,
                'payment.stripeCheckoutSessionStatus': 'expired',
                'payment.stripeCheckoutExpiresAt': sessionToRecover.expiresAt,
                'payment.mismatchNote': undefined,
              },
              $unset: { 'payment.stripeCheckoutCreatingUntil': 1 },
            },
          );
        } catch (recoveryError) {
          logger.error(
            {
              orderId: order._id.toString(),
              sessionId: sessionToRecover.id,
              errorCode: safeErrorCode(recoveryError),
            },
            'Private-offer checkout session requires manual recovery',
          );
          await Order.updateOne(
            { _id: locked._id },
            {
              $set: {
                'payment.stripeCheckoutRecoveryStatus': 'needs_review',
                'payment.stripeCheckoutSessionId': sessionToRecover.id,
                'payment.stripeCheckoutSessionStatus': 'open',
                'payment.stripeCheckoutExpiresAt': sessionToRecover.expiresAt,
                'payment.mismatchNote':
                  'A private-offer Checkout Session could not be safely expired after persistence failed; manual reconciliation is required.',
              },
              $unset: { 'payment.stripeCheckoutCreatingUntil': 1 },
            },
          );
        }
      } else {
        const definiteLocalRejection =
          error instanceof AppError &&
          [
            'CUSTOM_OFFER_EXPIRY_TOO_SOON',
            'PAYMENT_SESSION_EXPIRY_MISMATCH',
            'PAYMENT_TOTAL_MISMATCH',
          ].includes(error.code);
        await Order.updateOne(
          { _id: locked._id },
          {
            $set: {
              'payment.stripeCheckoutRecoveryStatus': definiteLocalRejection
                ? 'ready'
                : 'needs_review',
              ...(definiteLocalRejection
                ? {}
                : {
                    'payment.mismatchNote':
                      'The Stripe request outcome is unknown; another private-offer session is blocked pending reconciliation.',
                  }),
            },
            ...(definiteLocalRejection
              ? { $unset: { 'payment.stripeCheckoutCreatingUntil': 1 } }
              : {}),
          },
        );
      }
    } else {
      await Order.updateOne(
        { _id: locked._id, 'payment.stripeCheckoutCreatingUntil': lockUntil },
        { $unset: { 'payment.stripeCheckoutCreatingUntil': 1 } },
      );
    }
    throw error;
  }
}

export async function confirmOrderPayment(
  orderNumber: string,
  identity: CustomerIdentity,
): Promise<{ status: string }> {
  const order = await ownedOrder(orderNumber, identity);
  if (order.payment.status === 'paid') return { status: 'paid' };
  const sessionId = order.payment.stripeCheckoutSessionId;
  if (!sessionId) {
    throw new AppError(
      'No payment session exists',
      404,
      'PAYMENT_SESSION_NOT_FOUND',
    );
  }
  const provider = getPaymentProviderByName(order.payment.provider);
  if (!provider.retrieveCheckoutSession) {
    throw new AppError(
      'Payment confirmation is unavailable',
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
    );
  }
  const session = await provider.retrieveCheckoutSession(sessionId);
  if (session.paymentStatus === 'paid') {
    const applied = await applyPaymentToOrder(order._id, {
      provider: order.payment.provider,
      reference: session.paymentIntentId ?? sessionId,
      amountMinor: session.amountMinor,
      currency: session.currency,
      method: 'stripe_checkout',
      stripeCheckoutSessionId: sessionId,
    });
    if (applied.payment.status === 'paid') {
      await Order.updateOne(
        { _id: order._id },
        {
          $set: {
            'payment.stripeCheckoutSessionStatus': 'complete',
            ...(session.paymentIntentId
              ? { 'payment.stripePaymentIntentId': session.paymentIntentId }
              : {}),
          },
        },
      );
    }
  }
  const current = await Order.findById(order._id).select('payment.status');
  return { status: current?.payment.status ?? 'pending' };
}

export async function getOrderPaymentStatus(
  orderNumber: string,
  identity: CustomerIdentity,
): Promise<{ status: string; orderStatus: string }> {
  const order = await ownedOrder(orderNumber, identity);
  return { status: order.payment.status, orderStatus: order.status };
}

export async function processStripeWebhook(event: Stripe.Event): Promise<void> {
  const leaseToken = await claimStripeEvent(event.id, event.type);
  if (!leaseToken) return;
  let leaseLost = false;
  let renewalInFlight: Promise<void> | undefined;
  const leaseLostError = () =>
    new AppError(
      'Stripe webhook event lease is no longer owned by this handler',
      503,
      'STRIPE_EVENT_LEASE_LOST',
    );
  const renewLease = async (): Promise<void> => {
    if (leaseLost) throw leaseLostError();
    try {
      const renewed = await renewStripeEventLease(event.id, leaseToken);
      if (!renewed) {
        leaseLost = true;
        throw leaseLostError();
      }
    } catch (error) {
      leaseLost = true;
      throw error;
    }
  };
  const assertLeaseOwned: StripeEventLeaseGuard = async () => {
    await renewLease();
  };
  const heartbeat = (): void => {
    if (renewalInFlight) return;
    renewalInFlight = renewStripeEventLease(event.id, leaseToken)
      .then((renewed) => {
        if (!renewed) leaseLost = true;
      })
      .catch((error: unknown) => {
        leaseLost = true;
        logger.error(
          { eventId: event.id, errorCode: safeErrorCode(error) },
          'Stripe webhook event lease renewal failed',
        );
      })
      .finally(() => {
        renewalInFlight = undefined;
      });
  };
  const heartbeatTimer = setInterval(
    heartbeat,
    STRIPE_EVENT_LEASE_RENEWAL_INTERVAL_MS,
  );
  heartbeatTimer.unref();
  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        await assertLeaseOwned();
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status === 'paid') {
          await applyStripeSession(session, event.id, assertLeaseOwned);
        } else {
          await updateStripeSession(session, 'complete', assertLeaseOwned);
        }
        break;
      }
      case 'checkout.session.async_payment_failed': {
        await assertLeaseOwned();
        const session = event.data.object as Stripe.Checkout.Session;
        await markSessionFailed(session, assertLeaseOwned);
        break;
      }
      case 'payment_intent.payment_failed': {
        await assertLeaseOwned();
        const intent = event.data.object as Stripe.PaymentIntent;
        await markIntentFailed(intent, assertLeaseOwned);
        break;
      }
      case 'checkout.session.expired': {
        await assertLeaseOwned();
        const session = event.data.object as Stripe.Checkout.Session;
        await updateStripeSession(session, 'expired', assertLeaseOwned);
        break;
      }
      case 'charge.refunded': {
        await assertLeaseOwned();
        const charge = event.data.object as Stripe.Charge;
        await applyStripeChargeRefund(charge, assertLeaseOwned);
        break;
      }
    }
    clearInterval(heartbeatTimer);
    await renewalInFlight;
    await assertLeaseOwned();
    const completed = await StripeEvent.updateOne(
      {
        eventId: event.id,
        status: 'processing',
        leaseToken,
        leaseUntil: { $gt: new Date() },
      },
      {
        $set: { status: 'completed', completedAt: new Date() },
        $unset: { leaseUntil: 1, lastError: 1 },
      },
    );
    if (completed.modifiedCount !== 1) {
      throw new AppError(
        'Stripe webhook event lease was lost before completion',
        503,
        'STRIPE_EVENT_LEASE_LOST',
      );
    }
  } catch (error) {
    clearInterval(heartbeatTimer);
    await renewalInFlight;
    await StripeEvent.updateOne(
      { eventId: event.id, status: 'processing', leaseToken },
      {
        $set: {
          leaseUntil: new Date(),
          lastError: safeErrorCode(error),
        },
      },
    );
    throw error;
  } finally {
    clearInterval(heartbeatTimer);
    await renewalInFlight;
  }
}

export async function renewStripeEventLease(
  eventId: string,
  leaseToken: string,
  leaseDurationMs = STRIPE_EVENT_LEASE_DURATION_MS,
): Promise<boolean> {
  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new RangeError('Stripe event lease duration must be positive');
  }
  const now = new Date();
  const result = await StripeEvent.updateOne(
    {
      eventId,
      status: 'processing',
      leaseToken,
      leaseUntil: { $gt: now },
    },
    { $max: { leaseUntil: new Date(now.getTime() + leaseDurationMs) } },
  );
  return result.matchedCount === 1;
}

async function claimStripeEvent(
  eventId: string,
  type: string,
): Promise<string | null> {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + STRIPE_EVENT_LEASE_DURATION_MS);
  const availableLease = {
    eventId,
    status: { $ne: 'completed' },
    $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
  };
  let claimed = await StripeEvent.findOneAndUpdate(
    availableLease,
    {
      $set: { type, status: 'processing', leaseToken, leaseUntil },
      $inc: { attempts: 1 },
      $unset: { lastError: 1, completedAt: 1 },
    },
    { new: true },
  );
  if (!claimed) {
    try {
      claimed = await StripeEvent.create({
        eventId,
        type,
        status: 'processing',
        leaseToken,
        leaseUntil,
        attempts: 1,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      claimed = await StripeEvent.findOneAndUpdate(
        availableLease,
        {
          $set: { type, status: 'processing', leaseToken, leaseUntil },
          $inc: { attempts: 1 },
          $unset: { lastError: 1, completedAt: 1 },
        },
        { new: true },
      );
    }
  }
  if (claimed) return leaseToken;

  const current = await StripeEvent.findOne({ eventId }).select('status');
  if (current?.status === 'completed') return null;
  throw new AppError(
    'This Stripe webhook event is already being processed',
    503,
    'STRIPE_EVENT_PROCESSING',
  );
}

export async function expireUnpaidOrders(): Promise<number> {
  const cutoff = new Date(
    Date.now() - env.UNPAID_ORDER_EXPIRY_HOURS * 3_600_000,
  );
  const orders = await Order.find({
    status: 'pending_payment',
    'payment.status': { $in: ['pending', 'failed'] },
    createdAt: { $lt: cutoff },
  }).select('+reservedStock');
  let expired = 0;
  for (const order of orders) {
    if (
      order.payment.stripeCheckoutSessionId &&
      order.payment.stripeCheckoutSessionStatus === 'open'
    ) {
      try {
        await getPaymentProviderByName(
          order.payment.provider,
        ).expireCheckoutSession?.(order.payment.stripeCheckoutSessionId);
      } catch (error) {
        logger.error(
          { orderId: order._id.toString(), errorCode: safeErrorCode(error) },
          'Could not expire Stripe checkout session',
        );
      }
    }
    try {
      await changeOrderStatus(
        order._id,
        'cancelled',
        undefined,
        'Cancelled after non-payment expiry',
        'system',
      );
      await restoreReservedStock(order.reservedStock);
      await Order.updateOne(
        { _id: order._id, status: 'cancelled' },
        {
          $set: {
            reservedStock: [],
            ...(order.payment.stripeCheckoutSessionId
              ? { 'payment.stripeCheckoutSessionStatus': 'expired' }
              : {}),
          },
        },
      );
      await logAuditEvent({
        actorRole: 'system',
        action: 'order.expired_unpaid',
        targetType: 'Order',
        targetId: order._id.toString(),
      });
      expired += 1;
    } catch (error) {
      logger.error(
        { orderId: order._id.toString(), errorCode: safeErrorCode(error) },
        'Unpaid order expiration failed',
      );
    }
  }
  return expired;
}

async function applyStripeSession(
  session: Stripe.Checkout.Session,
  webhookEventId: string,
  assertLease: StripeEventLeaseGuard,
): Promise<void> {
  await assertLease();
  const order = await Order.findOne({
    'payment.stripeCheckoutSessionId': session.id,
  });
  if (!order) {
    const metadataOrderId = session.metadata?.orderId;
    const candidate =
      metadataOrderId && session.metadata?.orderNumber
        ? await Order.findOne({
            _id: metadataOrderId,
            orderNumber: session.metadata.orderNumber,
          })
        : null;
    const privateOfferCandidate =
      candidate?.customOffer || session.metadata?.customOfferId;
    await recordStripeReconciliation({
      session,
      webhookEventId,
      candidateOrderId: metadataOrderId,
      assertLease,
      reason: privateOfferCandidate
        ? 'A successful private-offer payment used a Checkout Session ID that is not persisted on the referenced order.'
        : 'A successful Stripe payment could not be matched by its persisted Checkout Session ID.',
    });
    return;
  }
  if (order.customOffer) {
    try {
      await validateCustomOfferCheckout(order, session, assertLease);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await recordStripeReconciliation({
        session,
        webhookEventId,
        order,
        assertLease,
        reason: error.message,
      });
      return;
    }
  }
  const intent =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : undefined;
  const applied = await applyPaymentToOrder(order._id, {
    provider: 'stripe',
    reference: intent ?? session.id,
    amountMinor: session.amount_total ?? 0,
    currency: session.currency?.toUpperCase() ?? '',
    method: 'stripe_checkout',
    stripeCheckoutSessionId: session.id,
    assertLease,
  });
  if (applied.payment.status !== 'paid') return;
  await assertLease();
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        'payment.stripeCheckoutSessionStatus': 'complete',
        ...(intent ? { 'payment.stripePaymentIntentId': intent } : {}),
      },
    },
  );
}

async function validateCustomOfferCheckout(
  order: IOrder,
  session?: Stripe.Checkout.Session,
  assertLease?: StripeEventLeaseGuard,
): Promise<Date | undefined> {
  if (!order.customOffer) return undefined;
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
      'Private offer is missing its stored order relationship',
      409,
      'CUSTOM_OFFER_ORDER_MISMATCH',
    );
  }
  if (!order.user || order.user.toString() !== offer.customer.toString()) {
    throw new AppError(
      'Private offer does not belong to the order customer',
      409,
      'CUSTOM_OFFER_CUSTOMER_MISMATCH',
    );
  }
  if (offer.order?.toString() !== order._id.toString()) {
    throw new AppError(
      'Private offer does not reference this persisted order',
      409,
      'CUSTOM_OFFER_ORDER_MISMATCH',
    );
  }
  if (order.items.length !== 1) {
    throw new AppError(
      'Private offer orders must contain a single order line',
      409,
      'CUSTOM_OFFER_ORDER_MISMATCH',
    );
  }
  const item = order.items[0];
  if (
    !product ||
    product.visibility !== 'private' ||
    product.status !== 'active'
  ) {
    throw new AppError(
      'The private-offer product is no longer eligible for payment',
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
      'The private-offer customer account is no longer eligible for payment',
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
      'The custom request linked to this private offer is no longer eligible',
      409,
      'CUSTOM_OFFER_REQUEST_UNAVAILABLE',
    );
  }
  if (
    item.product.toString() !== offer.product.toString() ||
    item.quantity !== 1 ||
    item.lineTotalMinor !== offer.agreedPriceMinor ||
    item.unitPriceMinor !== offer.agreedPriceMinor ||
    item.productionQuantity !== offer.agreedQuantity
  ) {
    throw new AppError(
      'Private offer order contents do not match the agreed product and price',
      409,
      'CUSTOM_OFFER_ORDER_MISMATCH',
    );
  }
  if (
    order.totalMinor !== offer.agreedPriceMinor ||
    order.subtotalMinor !== offer.agreedPriceMinor ||
    order.currency.toUpperCase() !== offer.currency.toUpperCase()
  ) {
    throw new AppError(
      'Private offer order total does not match the agreed offer price',
      409,
      'CUSTOM_OFFER_PRICE_MISMATCH',
    );
  }
  if (
    order.discountMinor !== 0 ||
    order.shippingMinor !== 0 ||
    order.taxMinor !== 0
  ) {
    throw new AppError(
      'Private offer orders cannot include shipping, tax, or discounts on top of the agreed price',
      409,
      'PRIVATE_OFFER_TOTAL_MISMATCH',
    );
  }
  const paymentAlreadyApplied =
    Boolean(session) &&
    order.payment.status === 'paid' &&
    order.payment.provider === 'stripe' &&
    order.payment.stripeCheckoutSessionId === session?.id;
  const alreadyPaidForThisOffer =
    paymentAlreadyApplied &&
    ['reserved', 'purchased'].includes(offer.status) &&
    offer.order.toString() === order._id.toString();
  if (!alreadyPaidForThisOffer && offer.status !== 'reserved') {
    throw new AppError(
      offer.status === 'purchased'
        ? 'This offer has already been purchased'
        : 'This private offer is not reserved for payment',
      409,
      offer.status === 'purchased'
        ? 'CUSTOM_OFFER_ALREADY_PURCHASED'
        : 'CUSTOM_OFFER_NOT_RESERVED',
    );
  }
  if (!alreadyPaidForThisOffer && offer.expiresAt <= new Date()) {
    await assertLease?.();
    await CustomOffer.updateOne(
      { _id: offer._id, order: order._id, status: 'reserved' },
      { $set: { status: 'expired' } },
    );
    throw new AppError(
      'This offer has expired and cannot be purchased',
      409,
      'CUSTOM_OFFER_EXPIRED',
    );
  }
  if (
    !alreadyPaidForThisOffer &&
    (order.status !== 'pending_payment' ||
      !['pending', 'failed'].includes(order.payment.status))
  ) {
    throw new AppError(
      'The private-offer order is no longer awaiting payment',
      409,
      'ORDER_NOT_PAYABLE',
    );
  }
  if (session) {
    const metadata = session.metadata;
    if (
      session.id !== order.payment.stripeCheckoutSessionId ||
      session.client_reference_id !== order.orderNumber ||
      metadata?.orderId !== order._id.toString() ||
      metadata.orderNumber !== order.orderNumber ||
      metadata.customOfferId !== offer._id.toString() ||
      metadata.customerId !== order.user.toString() ||
      metadata.productId !== item.product.toString()
    ) {
      throw new AppError(
        'Stripe Checkout Session identity does not match the persisted private-offer order',
        409,
        'PAYMENT_SESSION_RELATIONSHIP_MISMATCH',
      );
    }
    const intent =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : undefined;
    if (
      order.payment.stripePaymentIntentId &&
      intent &&
      order.payment.stripePaymentIntentId !== intent
    ) {
      throw new AppError(
        'Stripe PaymentIntent does not match the persisted order',
        409,
        'PAYMENT_INTENT_MISMATCH',
      );
    }
    if (
      (session.amount_total ?? 0) !== order.totalMinor ||
      (session.currency?.toUpperCase() ?? '') !== order.currency.toUpperCase()
    ) {
      throw new AppError(
        'Stripe session total does not match the agreed private offer total',
        409,
        'PAYMENT_TOTAL_MISMATCH',
      );
    }
  }
  return offer.expiresAt;
}

async function recordStripeReconciliation(input: {
  session: Stripe.Checkout.Session;
  webhookEventId: string;
  reason: string;
  order?: IOrder;
  candidateOrderId?: string;
  assertLease: StripeEventLeaseGuard;
}): Promise<void> {
  await input.assertLease();
  const offer = input.order?.customOffer
    ? await CustomOffer.findById(input.order.customOffer).lean()
    : null;
  const dedupeKey = `stripe-session:${input.session.id}`;
  await PaymentReconciliation.updateOne(
    { dedupeKey },
    {
      $setOnInsert: {
        dedupeKey,
        provider: 'stripe',
        reason: input.reason,
        status: 'manual_review',
        webhookEventId: input.webhookEventId,
        sessionId: input.session.id,
        ...(typeof input.session.payment_intent === 'string'
          ? { paymentIntentId: input.session.payment_intent }
          : {}),
        ...(input.order
          ? {
              order: input.order._id,
              ...(input.order.user ? { customer: input.order.user } : {}),
              ...(input.order.customOffer
                ? { offer: input.order.customOffer }
                : {}),
              ...(input.order.items[0]
                ? { product: input.order.items[0].product }
                : {}),
            }
          : {}),
        ...(!input.order && input.candidateOrderId
          ? { candidateOrderId: input.candidateOrderId }
          : {}),
        ...(offer
          ? {
              offer: offer._id,
              customer: offer.customer,
              product: offer.product,
            }
          : {}),
        amountMinor: input.session.amount_total ?? 0,
        currency: input.session.currency?.toUpperCase() ?? '',
      },
    },
    { upsert: true },
  );
  if (input.order) {
    await input.assertLease();
    await Order.updateOne(
      { _id: input.order._id, 'payment.status': { $ne: 'paid' } },
      { $set: { 'payment.mismatchNote': input.reason } },
    );
  }
}

async function markSessionFailed(
  session: Stripe.Checkout.Session,
  assertLease: StripeEventLeaseGuard,
): Promise<void> {
  await assertLease();
  const order = await Order.findOne({
    'payment.stripeCheckoutSessionId': session.id,
  });
  if (!order) return;
  await markOrderFailed(order._id, session.id, assertLease);
}

async function markOrderFailed(
  orderId: string | Types.ObjectId,
  sessionId?: string,
  assertLease?: StripeEventLeaseGuard,
): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order || order.payment.status === 'paid') return;
  await assertLease?.();
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: 'pending_payment',
      'payment.status': { $ne: 'paid' },
    },
    {
      $set: {
        'payment.status': 'failed',
        ...(sessionId
          ? { 'payment.stripeCheckoutSessionStatus': 'complete' }
          : {}),
        'payment.stripeCheckoutRecoveryStatus': 'ready',
      },
    },
    { new: true },
  );
  if (updated) {
    await assertLease?.();
    await logAuditEvent({
      actorRole: 'system',
      action: 'order.payment_failed',
      targetType: 'Order',
      targetId: order._id.toString(),
    });
    await assertLease?.();
    await sendCustomerEmail(
      updated.contactSnapshot.email,
      `Payment failed for order ${updated.orderNumber}`,
      `Payment for order ${updated.orderNumber} was not completed. You can return to your order and try again.`,
    );
  }
}

async function markIntentFailed(
  intent: Stripe.PaymentIntent,
  assertLease: StripeEventLeaseGuard,
): Promise<void> {
  await assertLease();
  const order = await Order.findOne({
    'payment.stripePaymentIntentId': intent.id,
  });
  if (order)
    await markOrderFailed(order._id.toString(), undefined, assertLease);
}

async function updateStripeSession(
  session: Stripe.Checkout.Session,
  status: 'complete' | 'expired',
  assertLease: StripeEventLeaseGuard,
): Promise<void> {
  await assertLease();
  const order = await Order.findOne({
    'payment.stripeCheckoutSessionId': session.id,
  }).select('customOffer');
  if (!order) return;
  await assertLease();
  await Order.updateOne(
    {
      _id: order._id,
      'payment.stripeCheckoutSessionId': session.id,
      'payment.status': { $ne: 'paid' },
    },
    {
      $set: {
        'payment.stripeCheckoutSessionStatus': status,
        ...(order.customOffer
          ? {
              'payment.stripeCheckoutRecoveryStatus':
                status === 'expired' ? 'ready' : 'awaiting_result',
            }
          : {}),
      },
      $unset: { 'payment.stripeCheckoutCreatingUntil': 1 },
    },
  );
}

async function applyStripeChargeRefund(
  charge: Stripe.Charge,
  assertLease: StripeEventLeaseGuard,
): Promise<void> {
  await assertLease();
  const intentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : undefined;
  if (!intentId || !charge.refunds?.data.length) return;
  const order = await Order.findOne({
    $or: [
      { 'payment.stripePaymentIntentId': intentId },
      { 'payment.providerReference': intentId },
    ],
  });
  if (!order) return;
  for (const refund of charge.refunds.data) {
    if (order.refunds.some((entry) => entry.reference === refund.id)) continue;
    const amount = refund.amount;
    const totalRefunded = order.refunds.reduce(
      (sum, item) => sum + item.amountMinor,
      0,
    );
    if (amount > order.totalMinor - totalRefunded) {
      throw new AppError(
        'Stripe refund exceeds the remaining paid amount',
        409,
        'REFUND_EXCEEDS_PAID',
      );
    }
    await assertLease();
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, 'refunds.reference': { $ne: refund.id } },
      [
        {
          $set: {
            refunds: {
              $concatArrays: [
                { $ifNull: ['$refunds', []] },
                [
                  {
                    amountMinor: amount,
                    reason: 'Stripe dashboard refund',
                    reference: refund.id,
                    at: new Date(),
                  },
                ],
              ],
            },
            'payment.status': {
              $cond: [
                { $gte: [{ $add: [totalRefunded, amount] }, '$totalMinor'] },
                'refunded',
                'partially_refunded',
              ],
            },
          },
        },
      ],
      { new: true },
    );
    if (updated) {
      await assertLease();
      await logAuditEvent({
        actorRole: 'system',
        action: 'order.stripe_refund_recorded',
        targetType: 'Order',
        targetId: order._id.toString(),
        metadata: { amountMinor: amount },
      });
      order.refunds.push({
        amountMinor: amount,
        reason: 'Stripe dashboard refund',
        reference: refund.id,
        at: new Date(),
      });
    }
  }
}

async function ownedOrder(orderNumber: string, identity: CustomerIdentity) {
  const order = await Order.findOne({ orderNumber });
  const allowed =
    order &&
    (identity.user
      ? order.user?.toString() === identity.user._id.toString()
      : Boolean(
          identity.email &&
          !order.user &&
          order.guestEmail?.toLowerCase() === identity.email.toLowerCase(),
        ));
  if (!allowed || !order) {
    throw new AppError(
      'Order payment access could not be verified',
      404,
      'ORDER_PAYMENT_ACCESS_DENIED',
    );
  }
  return order;
}

async function retrieveOpenSessionUrl(sessionId: string): Promise<string> {
  try {
    const session =
      await getStripeClient().checkout.sessions.retrieve(sessionId);
    if (session.status === 'open' && session.url) return session.url;
  } catch (error) {
    throw stripeRequestError(error);
  }
  throw new AppError(
    'Checkout session is no longer open',
    409,
    'PAYMENT_SESSION_EXPIRED',
  );
}

function stripeRequestError(error: unknown): AppError {
  const requestId =
    typeof error === 'object' && error !== null && 'requestId' in error
      ? String(error.requestId)
      : undefined;
  logger.error({ requestId }, 'Stripe request failed');
  return new AppError(
    'Payment provider request failed',
    502,
    'PAYMENT_PROVIDER_ERROR',
  );
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

function safeErrorCode(error: unknown): string {
  return error instanceof AppError ? error.code : 'UNEXPECTED_ERROR';
}

function checkoutSessionRecoveryFromError(error: unknown):
  | {
      id: string;
      url: string;
      expiresAt: Date;
    }
  | undefined {
  if (
    !(error instanceof AppError) ||
    error.code !== 'PAYMENT_SESSION_RECOVERY_REQUIRED' ||
    typeof error.details !== 'object' ||
    error.details === null ||
    !('sessionId' in error.details) ||
    !('expiresAt' in error.details) ||
    typeof error.details.sessionId !== 'string' ||
    typeof error.details.expiresAt !== 'number'
  ) {
    return undefined;
  }
  return {
    id: error.details.sessionId,
    url: '',
    expiresAt: new Date(error.details.expiresAt * 1000),
  };
}
