import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import type Stripe from 'stripe';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const {
  stripeClient,
  createCheckoutSession,
  retrieveCheckoutSession,
  expireCheckoutSession,
  sendOrderEmailWithResult,
} = vi.hoisted(() => {
  const createCheckoutSession = vi.fn();
  const retrieveCheckoutSession = vi.fn();
  const expireCheckoutSession = vi.fn();
  const sendOrderEmailWithResult = vi.fn();
  return {
    stripeClient: {
      coupons: { create: vi.fn() },
      checkout: {
        sessions: {
          create: createCheckoutSession,
          retrieve: retrieveCheckoutSession,
          expire: expireCheckoutSession,
        },
      },
    },
    createCheckoutSession,
    retrieveCheckoutSession,
    expireCheckoutSession,
    sendOrderEmailWithResult,
  };
});

vi.mock('../src/config/stripe', () => ({
  getStripeClient: () => stripeClient,
  logStripeError: vi.fn(),
}));

vi.mock('../src/services/email.service', () => ({
  sendOrderEmail: vi.fn().mockResolvedValue(undefined),
  sendOrderEmailWithResult,
  sendCustomerEmail: vi.fn().mockResolvedValue(undefined),
}));

import {
  AuditEvent,
  Category,
  CustomOffer,
  Message,
  Order,
  PaymentFulfillment,
  PaymentReconciliation,
  Product,
  StripeEvent,
  User,
} from '../src/models';
import {
  startOrderCheckout,
  processStripeWebhook,
  renewStripeEventLease,
} from '../src/services/payment/paymentFlow.service';
import * as orderWorkflowService from '../src/services/orderWorkflow.service';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    AuditEvent.init(),
    Category.init(),
    CustomOffer.init(),
    Message.init(),
    Order.init(),
    PaymentFulfillment.init(),
    PaymentReconciliation.init(),
    Product.init(),
    StripeEvent.init(),
    User.init(),
  ]);
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
  vi.restoreAllMocks();
  createCheckoutSession.mockReset();
  retrieveCheckoutSession.mockReset();
  expireCheckoutSession.mockReset();
  sendOrderEmailWithResult.mockReset();
  sendOrderEmailWithResult.mockResolvedValue(true);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('private-offer Stripe checkout recovery', () => {
  it('creates one fixed-price session from the persisted order and reuses it on retry', async () => {
    const fixture = await createPrivateOfferOrder();
    const stripeExpiry = Math.floor(Date.now() / 1000) + 30 * 60;
    createCheckoutSession.mockResolvedValue({
      id: 'cs_private_offer_checkout',
      url: 'https://checkout.stripe.example/private-offer',
      amount_total: fixture.order.totalMinor,
      currency: fixture.order.currency.toLowerCase(),
      expires_at: stripeExpiry,
      payment_intent: null,
    });
    retrieveCheckoutSession.mockResolvedValue({
      id: 'cs_private_offer_checkout',
      status: 'open',
      url: 'https://checkout.stripe.example/private-offer',
    });

    const first = await startOrderCheckout(fixture.order.orderNumber, {
      user: fixture.customer,
    });
    const retry = await startOrderCheckout(fixture.order.orderNumber, {
      user: fixture.customer,
    });

    expect(first.checkoutUrl).toBe(retry.checkoutUrl);
    expect(first.expiresAt.getTime()).toBeLessThanOrEqual(
      fixture.offer.expiresAt.getTime(),
    );
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: 'gbp',
              unit_amount: fixture.offer.agreedPriceMinor,
            }),
          }),
        ],
        metadata: expect.objectContaining({
          orderId: fixture.order._id.toString(),
          customOfferId: fixture.offer._id.toString(),
          customerId: fixture.customer._id.toString(),
          productId: fixture.product._id.toString(),
        }),
        expires_at: expect.any(Number),
      }),
      expect.objectContaining({
        idempotencyKey: `order:${fixture.order._id}:attempt:1:checkout`,
      }),
    );
    expect(
      (createCheckoutSession.mock.calls[0]?.[0] as { line_items: unknown[] })
        .line_items,
    ).toHaveLength(1);
  });

  it('does not create a session when the offer expires before Stripe minimum expiry', async () => {
    const fixture = await createPrivateOfferOrder({
      offerExpiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await expect(
      startOrderCheckout(fixture.order.orderNumber, { user: fixture.customer }),
    ).rejects.toMatchObject({ code: 'CUSTOM_OFFER_EXPIRY_TOO_SOON' });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('only lets the offer customer initiate checkout', async () => {
    const fixture = await createPrivateOfferOrder();
    const otherCustomer = await createCustomer('not-the-owner@example.test');

    await expect(
      startOrderCheckout(fixture.order.orderNumber, { user: otherCustomer }),
    ).rejects.toMatchObject({ code: 'ORDER_PAYMENT_ACCESS_DENIED' });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('expires a created session and safely retries when persisting its ID fails', async () => {
    const fixture = await createPrivateOfferOrder();
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
    createCheckoutSession
      .mockResolvedValueOnce({
        id: 'cs_persistence_failure',
        url: 'https://checkout.stripe.example/failed-save',
        amount_total: fixture.order.totalMinor,
        currency: 'gbp',
        expires_at: expiresAt,
        payment_intent: null,
      })
      .mockResolvedValueOnce({
        id: 'cs_recovered',
        url: 'https://checkout.stripe.example/recovered',
        amount_total: fixture.order.totalMinor,
        currency: 'gbp',
        expires_at: expiresAt,
        payment_intent: null,
      });
    expireCheckoutSession.mockResolvedValue({});

    const originalFindOneAndUpdate = Order.findOneAndUpdate.bind(Order);
    let updateCount = 0;
    vi.spyOn(Order, 'findOneAndUpdate').mockImplementation((...args) => {
      updateCount += 1;
      if (updateCount === 2) {
        return Promise.reject(new Error('simulated persistence failure'));
      }
      return originalFindOneAndUpdate(...args);
    });

    await expect(
      startOrderCheckout(fixture.order.orderNumber, { user: fixture.customer }),
    ).rejects.toThrow('simulated persistence failure');
    expect(expireCheckoutSession).toHaveBeenCalledWith(
      'cs_persistence_failure',
    );
    const recoveredOrder = await Order.findById(fixture.order._id);
    expect(recoveredOrder?.payment.stripeCheckoutRecoveryStatus).toBe('ready');
    expect(recoveredOrder?.payment.stripeCheckoutSessionStatus).toBe('expired');

    vi.restoreAllMocks();
    const retry = await startOrderCheckout(fixture.order.orderNumber, {
      user: fixture.customer,
    });
    expect(retry.checkoutUrl).toBe('https://checkout.stripe.example/recovered');
    expect(createCheckoutSession).toHaveBeenCalledTimes(2);
  });

  it('stores the session ID for manual review when safe expiration fails', async () => {
    const fixture = await createPrivateOfferOrder();
    createCheckoutSession.mockResolvedValue({
      id: 'cs_expiry_failure',
      amount_total: fixture.order.totalMinor,
      currency: 'gbp',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      payment_intent: null,
    });
    expireCheckoutSession.mockRejectedValue(
      new Error('simulated Stripe expiry failure'),
    );

    await expect(
      startOrderCheckout(fixture.order.orderNumber, { user: fixture.customer }),
    ).rejects.toMatchObject({
      code: 'PAYMENT_SESSION_RECOVERY_REQUIRED',
    });

    const order = await Order.findById(fixture.order._id);
    expect(order?.payment.stripeCheckoutSessionId).toBe('cs_expiry_failure');
    expect(order?.payment.stripeCheckoutSessionStatus).toBe('open');
    expect(order?.payment.stripeCheckoutRecoveryStatus).toBe('needs_review');
    await expect(
      startOrderCheckout(fixture.order.orderNumber, { user: fixture.customer }),
    ).rejects.toMatchObject({
      code: 'PAYMENT_SESSION_RECOVERY_REQUIRED',
    });
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid persisted session, verifies relationships, and completes fulfillment once', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_valid_private_offer',
    });
    const event = checkoutEvent('evt_private_success', fixture);

    await processStripeWebhook(event);

    const [order, offer, product, fulfillment] = await Promise.all([
      Order.findById(fixture.order._id),
      CustomOffer.findById(fixture.offer._id),
      Product.findById(fixture.product._id),
      PaymentFulfillment.findOne({ order: fixture.order._id }),
    ]);
    expect(order?.payment.status).toBe('paid');
    expect(offer?.status).toBe('purchased');
    expect(product?.soldCount).toBe(1);
    expect(fulfillment?.status).toBe('completed');
    expect(await PaymentReconciliation.countDocuments()).toBe(0);
    expect(sendOrderEmailWithResult).toHaveBeenCalledTimes(1);
  });

  it('records an unpersisted session instead of associating it by metadata', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_expected_session',
    });
    const event = checkoutEvent('evt_unpersisted_session', fixture, {
      sessionId: 'cs_unpersisted_session',
    });

    await processStripeWebhook(event);

    const reconciliation = await PaymentReconciliation.findOne({
      sessionId: 'cs_unpersisted_session',
    });
    const order = await Order.findById(fixture.order._id);
    expect(reconciliation?.candidateOrderId).toBe(fixture.order._id.toString());
    expect(reconciliation?.order).toBeUndefined();
    expect(order?.payment.status).toBe('pending');
  });

  it.each([
    ['amount', { amountMinor: 1200 }],
    ['currency', { currency: 'usd' }],
  ])(
    'records a successful session with an incorrect %s for review',
    async (_label, mismatch) => {
      const fixture = await createPrivateOfferOrder({
        sessionId: `cs_wrong_${_label}`,
      });
      await processStripeWebhook(
        checkoutEvent(`evt_wrong_${_label}`, fixture, mismatch),
      );

      const order = await Order.findById(fixture.order._id);
      const reconciliation = await PaymentReconciliation.findOne({
        sessionId: `cs_wrong_${_label}`,
      });
      expect(order?.payment.status).toBe('pending');
      expect(reconciliation?.status).toBe('manual_review');
      expect(reconciliation?.order?.toString()).toBe(
        fixture.order._id.toString(),
      );
    },
  );

  it.each(['customer', 'offer', 'product'])(
    'rejects a persisted session when its %s relationship disagrees',
    async (relationship) => {
      const fixture = await createPrivateOfferOrder({
        sessionId: `cs_wrong_${relationship}`,
      });
      if (relationship === 'customer') {
        const otherCustomer = await createCustomer('other@example.test');
        await CustomOffer.collection.updateOne(
          { _id: fixture.offer._id },
          { $set: { customer: otherCustomer._id } },
        );
      } else if (relationship === 'offer') {
        await CustomOffer.updateOne(
          { _id: fixture.offer._id },
          { $set: { order: new Types.ObjectId() } },
        );
      } else {
        await CustomOffer.collection.updateOne(
          { _id: fixture.offer._id },
          { $set: { product: new Types.ObjectId() } },
        );
      }

      await processStripeWebhook(
        checkoutEvent(`evt_wrong_${relationship}`, fixture),
      );

      expect((await Order.findById(fixture.order._id))?.payment.status).toBe(
        'pending',
      );
      expect(
        await PaymentReconciliation.countDocuments({
          sessionId: `cs_wrong_${relationship}`,
        }),
      ).toBe(1);
    },
  );

  it('handles failed, expired, delayed, and out-of-order events safely', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_delayed_success',
    });

    await processStripeWebhook(
      checkoutEvent('evt_payment_failed', fixture, {
        eventType: 'checkout.session.async_payment_failed',
        paymentStatus: 'unpaid',
      }),
    );
    expect((await Order.findById(fixture.order._id))?.payment.status).toBe(
      'failed',
    );

    await processStripeWebhook(
      checkoutEvent('evt_session_expired', fixture, {
        eventType: 'checkout.session.expired',
        paymentStatus: 'unpaid',
      }),
    );
    await processStripeWebhook(checkoutEvent('evt_delayed_success', fixture));
    await processStripeWebhook(
      checkoutEvent('evt_late_failure', fixture, {
        eventType: 'checkout.session.async_payment_failed',
        paymentStatus: 'unpaid',
      }),
    );

    const order = await Order.findById(fixture.order._id);
    expect(order?.payment.status).toBe('paid');
    expect(order?.payment.stripeCheckoutSessionStatus).toBe('complete');
    expect(await PaymentReconciliation.countDocuments()).toBe(0);
  });

  it('records late captured payment after cancellation for manual reconciliation', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_late_cancelled',
    });
    await Promise.all([
      Order.updateOne(
        { _id: fixture.order._id },
        { $set: { status: 'cancelled' } },
      ),
      CustomOffer.updateOne(
        { _id: fixture.offer._id },
        { $set: { status: 'cancelled', cancelledAt: new Date() } },
      ),
    ]);

    const event = checkoutEvent('evt_late_cancelled_payment', fixture);
    await processStripeWebhook(event);
    await processStripeWebhook(event);

    const order = await Order.findById(fixture.order._id);
    const reconciliation = await PaymentReconciliation.findOne({
      sessionId: 'cs_late_cancelled',
    });
    expect(order?.payment.status).toBe('pending');
    expect(order?.status).toBe('cancelled');
    expect(reconciliation?.status).toBe('manual_review');
    expect(reconciliation?.paymentIntentId).toBe('pi_cs_late_cancelled');
    expect(await PaymentReconciliation.countDocuments()).toBe(1);
  });

  it('records a captured payment after the offer expiry for manual reconciliation', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_late_expired',
    });
    await CustomOffer.collection.updateOne(
      { _id: fixture.offer._id },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );

    await processStripeWebhook(
      checkoutEvent('evt_late_expired_payment', fixture),
    );

    const order = await Order.findById(fixture.order._id);
    const offer = await CustomOffer.findById(fixture.offer._id);
    const reconciliation = await PaymentReconciliation.findOne({
      sessionId: 'cs_late_expired',
    });
    expect(order?.payment.status).toBe('pending');
    expect(offer?.status).toBe('expired');
    expect(reconciliation?.status).toBe('manual_review');
    expect(reconciliation?.reason).toContain('expired');
  });

  it('makes duplicate concurrent webhook deliveries idempotent', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_concurrent_success',
    });
    const event = checkoutEvent('evt_concurrent_success', fixture);

    const results = await Promise.allSettled([
      processStripeWebhook(event),
      processStripeWebhook(event),
    ]);

    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect((await Order.findById(fixture.order._id))?.payment.status).toBe(
      'paid',
    );
    expect((await Product.findById(fixture.product._id))?.soldCount).toBe(1);
    expect(
      await AuditEvent.countDocuments({
        idempotencyKey: `private-offer-payment-paid:${fixture.order._id}`,
      }),
    ).toBe(1);
    expect(sendOrderEmailWithResult).toHaveBeenCalledTimes(1);
  });

  it('renews an active event lease only for its current owner', async () => {
    const leaseUntil = new Date(Date.now() + 60_000);
    await StripeEvent.create({
      eventId: 'evt_lease_owner',
      type: 'checkout.session.completed',
      status: 'processing',
      leaseToken: 'current-owner',
      leaseUntil,
      attempts: 1,
    });

    expect(
      await renewStripeEventLease('evt_lease_owner', 'current-owner'),
    ).toBe(true);
    const renewed = await StripeEvent.findOne({ eventId: 'evt_lease_owner' });
    expect(renewed?.leaseUntil.getTime()).toBeGreaterThan(leaseUntil.getTime());

    expect(await renewStripeEventLease('evt_lease_owner', 'stale-owner')).toBe(
      false,
    );
    expect(
      (await StripeEvent.findOne({ eventId: 'evt_lease_owner' }))?.leaseToken,
    ).toBe('current-owner');
  });

  it('keeps a long-running webhook leased against a second delivery', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    sendOrderEmailWithResult.mockResolvedValue(true);
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_lease_heartbeat',
    });
    const event = checkoutEvent('evt_lease_heartbeat', fixture);
    const entered = deferred();
    const resumePayment = deferred();
    const heartbeatRenewed = deferred();
    const originalUpdate = StripeEvent.updateOne.bind(StripeEvent);
    let leaseRenewals = 0;
    vi.spyOn(StripeEvent, 'updateOne').mockImplementation(async (...args) => {
      const result = await originalUpdate(...args);
      if (args[0]?.eventId === event.id && args[1]?.$max?.leaseUntil) {
        leaseRenewals += 1;
        if (leaseRenewals === 2) heartbeatRenewed.resolve();
      }
      return result;
    });
    const applyPayment = orderWorkflowService.applyPaymentToOrder;
    vi.spyOn(orderWorkflowService, 'applyPaymentToOrder').mockImplementation(
      async (...args) => {
        entered.resolve();
        await resumePayment.promise;
        return applyPayment(...args);
      },
    );

    const firstDelivery = processStripeWebhook(event);
    await entered.promise;
    const initialLease = await StripeEvent.findOne({
      eventId: event.id,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await heartbeatRenewed.promise;
    const renewedLease = await StripeEvent.findOne({
      eventId: event.id,
    });

    expect(renewedLease?.leaseUntil.getTime()).toBeGreaterThan(
      initialLease?.leaseUntil.getTime() ?? 0,
    );
    await expect(processStripeWebhook(event)).rejects.toMatchObject({
      code: 'STRIPE_EVENT_PROCESSING',
    });

    resumePayment.resolve();
    await firstDelivery;
    expect((await Order.findById(fixture.order._id))?.payment.status).toBe(
      'paid',
    );
    expect((await Product.findById(fixture.product._id))?.soldCount).toBe(1);
    expect((await StripeEvent.findOne({ eventId: event.id }))?.status).toBe(
      'completed',
    );
  });

  it('stops private-offer payment changes after losing event lease ownership', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_lease_lost',
    });
    const event = checkoutEvent('evt_lease_lost', fixture);
    const entered = deferred();
    const resumePayment = deferred();
    const applyPayment = orderWorkflowService.applyPaymentToOrder;
    vi.spyOn(orderWorkflowService, 'applyPaymentToOrder').mockImplementation(
      async (...args) => {
        entered.resolve();
        await resumePayment.promise;
        return applyPayment(...args);
      },
    );

    const delivery = processStripeWebhook(event);
    await entered.promise;
    await StripeEvent.updateOne(
      { eventId: event.id },
      {
        $set: {
          leaseToken: 'replacement-owner',
          leaseUntil: new Date(Date.now() + 5 * 60_000),
        },
      },
    );
    await vi.advanceTimersByTimeAsync(60_000);
    resumePayment.resolve();

    await expect(delivery).rejects.toMatchObject({
      code: 'STRIPE_EVENT_LEASE_LOST',
    });
    const [order, offer, product, fulfillment] = await Promise.all([
      Order.findById(fixture.order._id),
      CustomOffer.findById(fixture.offer._id),
      Product.findById(fixture.product._id),
      PaymentFulfillment.findOne({ order: fixture.order._id }),
    ]);
    expect(order?.payment.status).toBe('pending');
    expect(offer?.status).toBe('reserved');
    expect(product?.soldCount).toBe(0);
    expect(fulfillment).toBeNull();
  });

  it('recovers when fulfillment-task persistence fails after the order is paid', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_task_persistence_failure',
    });
    const event = checkoutEvent('evt_task_persistence_failure', fixture);
    vi.spyOn(PaymentFulfillment, 'updateOne').mockImplementationOnce(() =>
      Promise.reject(new Error('simulated fulfillment-task write failure')),
    );

    await expect(processStripeWebhook(event)).rejects.toThrow(
      'simulated fulfillment-task write failure',
    );
    const [orderAfterFailure, offerAfterFailure, productAfterFailure] =
      await Promise.all([
        Order.findById(fixture.order._id),
        CustomOffer.findById(fixture.offer._id),
        Product.findById(fixture.product._id),
      ]);
    expect(orderAfterFailure?.payment.status).toBe('paid');
    expect(offerAfterFailure?.status).toBe('reserved');
    await expect(offerAfterFailure?.validate()).resolves.toBeUndefined();
    expect(productAfterFailure?.soldCount).toBe(0);
    expect(
      await PaymentFulfillment.countDocuments({ order: fixture.order._id }),
    ).toBe(0);

    vi.restoreAllMocks();
    await orderWorkflowService.processPendingPrivateOfferPaymentFulfillments();

    const [recoveredOrder, recoveredOffer, recoveredProduct, task] =
      await Promise.all([
        Order.findById(fixture.order._id),
        CustomOffer.findById(fixture.offer._id),
        Product.findById(fixture.product._id),
        PaymentFulfillment.findOne({ order: fixture.order._id }),
      ]);
    expect(recoveredOrder?.payment.status).toBe('paid');
    expect(recoveredOffer?.status).toBe('purchased');
    expect(recoveredProduct?.soldCount).toBe(1);
    expect(task?.status).toBe('completed');
    expect(sendOrderEmailWithResult).toHaveBeenCalledTimes(1);

    await orderWorkflowService.processPendingPrivateOfferPaymentFulfillments();
    expect((await Product.findById(fixture.product._id))?.soldCount).toBe(1);
    expect(sendOrderEmailWithResult).toHaveBeenCalledTimes(1);
  });

  it('recovers a payment when the event lease is lost after the order commit', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_lease_lost_after_order_commit',
    });
    const event = checkoutEvent('evt_lease_lost_after_order_commit', fixture);
    const originalUpdate =
      PaymentFulfillment.updateOne.bind(PaymentFulfillment);
    vi.spyOn(PaymentFulfillment, 'updateOne').mockImplementation(
      async (...args) => {
        if (args[2]?.upsert) {
          await StripeEvent.updateOne(
            { eventId: event.id },
            {
              $set: {
                leaseToken: 'replacement-owner',
                leaseUntil: new Date(Date.now() + 5 * 60_000),
              },
            },
          );
        }
        return originalUpdate(...args);
      },
    );

    await expect(processStripeWebhook(event)).rejects.toMatchObject({
      code: 'STRIPE_EVENT_LEASE_LOST',
    });
    const [orderAfterLeaseLoss, offerAfterLeaseLoss, productAfterLeaseLoss] =
      await Promise.all([
        Order.findById(fixture.order._id),
        CustomOffer.findById(fixture.offer._id),
        Product.findById(fixture.product._id),
      ]);
    expect(orderAfterLeaseLoss?.payment.status).toBe('paid');
    expect(offerAfterLeaseLoss?.status).toBe('reserved');
    expect(productAfterLeaseLoss?.soldCount).toBe(0);

    vi.restoreAllMocks();
    await orderWorkflowService.processPendingPrivateOfferPaymentFulfillments();
    expect((await CustomOffer.findById(fixture.offer._id))?.status).toBe(
      'purchased',
    );
    expect((await Product.findById(fixture.product._id))?.soldCount).toBe(1);
  });

  it('prevents distinct successful webhook events from applying payment twice', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_distinct_duplicate_success',
    });
    const first = checkoutEvent('evt_distinct_success_one', fixture);
    const second = checkoutEvent('evt_distinct_success_two', fixture, {
      eventType: 'checkout.session.async_payment_succeeded',
    });

    await Promise.all([
      processStripeWebhook(first),
      processStripeWebhook(second),
    ]);

    expect((await Order.findById(fixture.order._id))?.payment.status).toBe(
      'paid',
    );
    expect((await CustomOffer.findById(fixture.offer._id))?.status).toBe(
      'purchased',
    );
    expect((await Product.findById(fixture.product._id))?.soldCount).toBe(1);
    expect(
      await AuditEvent.countDocuments({
        idempotencyKey: `private-offer-payment-paid:${fixture.order._id}`,
      }),
    ).toBe(1);
    expect(sendOrderEmailWithResult).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale payment transition overwrite a cancelled order', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_stale_transition',
    });
    const event = checkoutEvent('evt_stale_transition', fixture);
    const originalUpdate = Order.findOneAndUpdate.bind(Order);
    let replacedState = false;
    vi.spyOn(Order, 'findOneAndUpdate').mockImplementation(async (...args) => {
      if (!replacedState && args[0]?.status === 'pending_payment') {
        replacedState = true;
        await Promise.all([
          Order.updateOne(
            { _id: fixture.order._id },
            { $set: { status: 'cancelled' } },
          ),
          CustomOffer.updateOne(
            { _id: fixture.offer._id },
            { $set: { status: 'cancelled', cancelledAt: new Date() } },
          ),
        ]);
      }
      return originalUpdate(...args);
    });

    await processStripeWebhook(event);

    const [order, offer, product, reconciliation] = await Promise.all([
      Order.findById(fixture.order._id),
      CustomOffer.findById(fixture.offer._id),
      Product.findById(fixture.product._id),
      PaymentReconciliation.findOne({ sessionId: 'cs_stale_transition' }),
    ]);
    expect(replacedState).toBe(true);
    expect(order?.status).toBe('cancelled');
    expect(order?.payment.status).toBe('pending');
    expect(offer?.status).toBe('cancelled');
    expect(product?.soldCount).toBe(0);
    expect(reconciliation?.status).toBe('manual_review');
  });

  it('preserves ordinary non-private order payment behavior', async () => {
    const fixture = await createPrivateOfferOrder();
    const order = await Order.create({
      user: fixture.customer._id,
      contactSnapshot: {
        name: fixture.customer.name,
        email: fixture.customer.email,
      },
      shippingAddress: address,
      billingAddress: address,
      items: [
        {
          product: fixture.product._id,
          titleSnapshot: fixture.product.title,
          skuSnapshot: fixture.product.sku,
          selectedOptions: [],
          quantity: 1,
          productionQuantity: 3,
          unitPriceMinor: 7200,
          lineTotalMinor: 7200,
          itemPrintStatus: 'queued',
          requiresProof: false,
        },
      ],
      subtotalMinor: 7200,
      discountMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: 7200,
      currency: 'GBP',
      payment: { provider: 'stripe', status: 'pending' },
      status: 'pending_payment',
    });

    const paid = await orderWorkflowService.applyPaymentToOrder(order._id, {
      provider: 'stripe',
      reference: 'pi_ordinary_checkout',
      amountMinor: 7200,
      currency: 'GBP',
      method: 'stripe_checkout',
    });

    expect(paid.payment.status).toBe('paid');
    expect(paid.status).toBe('in_printing');
    expect((await Product.findById(fixture.product._id))?.soldCount).toBe(1);
    expect(await PaymentFulfillment.countDocuments({ order: order._id })).toBe(
      0,
    );
  });

  it('recovers unfinished fulfillment without duplicating completed steps', async () => {
    const fixture = await createPrivateOfferOrder({
      sessionId: 'cs_fulfillment_retry',
    });
    sendOrderEmailWithResult
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const event = checkoutEvent('evt_fulfillment_retry', fixture);

    await expect(processStripeWebhook(event)).rejects.toMatchObject({
      code: 'PAYMENT_FULFILLMENT_EMAIL_FAILED',
    });
    const failedEvent = await StripeEvent.findOne({ eventId: event.id });
    expect(failedEvent?.status).toBe('processing');
    expect(failedEvent?.attempts).toBe(1);
    expect(failedEvent?.leaseUntil.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await Order.findById(fixture.order._id))?.payment.status).toBe(
      'paid',
    );
    expect((await Product.findById(fixture.product._id))?.soldCount).toBe(1);

    await processStripeWebhook(event);

    const retriedEvent = await StripeEvent.findOne({ eventId: event.id });
    expect(retriedEvent?.status).toBe('completed');
    expect(retriedEvent?.attempts).toBe(2);
    expect((await Product.findById(fixture.product._id))?.soldCount).toBe(1);
    expect(
      await AuditEvent.countDocuments({
        idempotencyKey: `private-offer-payment-paid:${fixture.order._id}`,
      }),
    ).toBe(1);
    expect(
      (await PaymentFulfillment.findOne({ order: fixture.order._id }))?.status,
    ).toBe('completed');
    expect(sendOrderEmailWithResult).toHaveBeenCalledTimes(2);
  });
});

async function createPrivateOfferOrder(
  input: {
    offerExpiresAt?: Date;
    sessionId?: string;
  } = {},
) {
  const customer = await createCustomer('private-offer@example.test');
  const category = await Category.create({ name: 'Private offer products' });
  const request = await Message.create({
    name: customer.name,
    email: customer.email,
    subject: 'Private offer request',
    body: 'Please make this private item',
    type: 'custom_3d_request',
    customerId: customer._id,
    customRequestStatus: 'accepted',
    requestDetails: {
      description: 'Private custom product',
      productName: 'Private print',
      productType: 'canvas_custom_print',
      quantity: 4,
    },
  });
  const product = await Product.create({
    title: 'Private print',
    slug: `private-print-${new Types.ObjectId().toString()}`,
    description: 'Private custom product',
    category: category._id,
    productType: 'canvas_custom_print',
    media: [],
    sku: `PRIVATE-${new Types.ObjectId().toString()}`,
    basePriceMinor: 7200,
    currency: 'GBP',
    optionGroups: [],
    quantityPricing: [],
    printTechniques: [],
    specifications: [],
    artworkRequirements: { allowedFormats: ['png'] },
    artworkRequired: false,
    stock: {
      trackInventory: false,
      quantity: 0,
      lowStockThreshold: 0,
      allowBackorder: false,
      reserveBlanksForMadeToOrder: false,
    },
    status: 'active',
    visibility: 'private',
    seo: {},
    viewCount: 0,
    soldCount: 0,
    ratingAverage: 0,
    ratingCount: 0,
    isFeatured: false,
    minOrderQuantity: 1,
    maxOrderQuantity: 1,
  });
  const offer = await CustomOffer.create({
    request: request._id,
    product: product._id,
    customer: customer._id,
    status: 'available',
    agreedPriceMinor: 7200,
    currency: 'GBP',
    agreedQuantity: 4,
    specifications: [{ label: 'Size', value: '40 x 60 cm' }],
    expiresAt: input.offerExpiresAt ?? new Date(Date.now() + 2 * 60 * 60_000),
  });
  const order = await Order.create({
    user: customer._id,
    customOffer: offer._id,
    contactSnapshot: { name: customer.name, email: customer.email },
    shippingAddress: address,
    billingAddress: address,
    items: [
      {
        product: product._id,
        titleSnapshot: product.title,
        skuSnapshot: product.sku,
        selectedOptions: [],
        quantity: 1,
        productionQuantity: offer.agreedQuantity,
        unitPriceMinor: offer.agreedPriceMinor,
        lineTotalMinor: offer.agreedPriceMinor,
        itemPrintStatus: 'queued',
        requiresProof: false,
      },
    ],
    subtotalMinor: offer.agreedPriceMinor,
    discountMinor: 0,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: offer.agreedPriceMinor,
    currency: offer.currency,
    payment: {
      provider: 'stripe',
      status: 'pending',
      ...(input.sessionId
        ? {
            stripeCheckoutSessionId: input.sessionId,
            stripeCheckoutSessionStatus: 'open',
          }
        : {}),
    },
    status: 'pending_payment',
  });
  await CustomOffer.updateOne(
    { _id: offer._id },
    {
      $set: {
        status: 'reserved',
        order: order._id,
        reservedAt: new Date(),
        reservationExpiresAt: new Date(Date.now() + 60 * 60_000),
      },
    },
  );
  return { customer, offer, order, product };
}

async function createCustomer(email: string) {
  return User.create({
    name: 'Private offer customer',
    email,
    passwordHash: 'isolated-test-hash',
    role: 'customer',
    accountState: 'active',
    addresses: [],
  });
}

function checkoutEvent(
  eventId: string,
  fixture: Awaited<ReturnType<typeof createPrivateOfferOrder>>,
  input: {
    sessionId?: string;
    amountMinor?: number;
    currency?: string;
    paymentStatus?: string;
    eventType?: string;
  } = {},
): Stripe.Event {
  const sessionId =
    input.sessionId ?? fixture.order.payment.stripeCheckoutSessionId;
  if (!sessionId) throw new Error('Test fixture requires a persisted session');

  const session = {
    id: sessionId,
    object: 'checkout.session',
    payment_status: input.paymentStatus ?? 'paid',
    amount_total: input.amountMinor ?? fixture.order.totalMinor,
    currency: input.currency ?? fixture.order.currency.toLowerCase(),
    client_reference_id: fixture.order.orderNumber,
    payment_intent: `pi_${sessionId}`,
    metadata: {
      orderId: fixture.order._id.toString(),
      orderNumber: fixture.order.orderNumber,
      customOfferId: fixture.offer._id.toString(),
      customerId: fixture.customer._id.toString(),
      productId: fixture.product._id.toString(),
    },
  } as Stripe.Checkout.Session;

  return {
    id: eventId,
    object: 'event',
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    data: { object: session },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: input.eventType ?? 'checkout.session.completed',
  } as Stripe.Event;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = () => complete();
  });
  return { promise, resolve };
}

const address = {
  line1: '1 Test Street',
  city: 'Coventry',
  state: 'West Midlands',
  postalCode: 'CV1 1AA',
  country: 'GB',
};
