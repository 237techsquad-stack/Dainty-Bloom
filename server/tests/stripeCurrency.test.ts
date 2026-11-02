import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { stripeClient, createCoupon, createCheckoutSession } = vi.hoisted(() => {
  const createCoupon = vi.fn();
  const createCheckoutSession = vi.fn();
  const stripeClient = {
    coupons: { create: createCoupon },
    checkout: {
      sessions: {
        create: createCheckoutSession,
        expire: vi.fn(),
      },
    },
  };
  return { stripeClient, createCoupon, createCheckoutSession };
});

vi.mock('../src/config/stripe', () => ({
  getStripeClient: () => stripeClient,
  logStripeError: vi.fn(),
}));

import {
  Category,
  CustomOffer,
  Message,
  Order,
  PaymentReconciliation,
  Product,
  User,
} from '../src/models';
import { applyPaymentToOrder } from '../src/services/orderWorkflow.service';
import { StripePaymentProvider } from '../src/services/payment/StripePaymentProvider';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
  createCoupon.mockReset();
  createCheckoutSession.mockReset();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('Stripe GBP Checkout payload', () => {
  it('sends GBP and pence amounts for items, discount, shipping and tax', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    createCoupon.mockResolvedValue({ id: 'coupon-test' });
    createCheckoutSession.mockResolvedValue({
      id: 'cs_test_mocked',
      url: 'https://checkout.stripe.example/session',
      amount_total: 2430,
      currency: 'gbp',
      expires_at: expiresAt,
      payment_intent: null,
    });

    const order = await Order.create({
      orderNumber: 'DB-20261028-STRIPETEST',
      contactSnapshot: { name: 'Test customer', email: 'test@example.test' },
      shippingAddress: address,
      billingAddress: address,
      items: [
        {
          product: new Types.ObjectId(),
          titleSnapshot: 'Test print',
          skuSnapshot: 'TEST-PRINT',
          selectedOptions: [],
          quantity: 2,
          unitPriceMinor: 1000,
          lineTotalMinor: 2000,
        },
      ],
      subtotalMinor: 2000,
      discountMinor: 100,
      shippingMinor: 300,
      taxMinor: 230,
      totalMinor: 2430,
      currency: 'GBP',
      payment: { provider: 'stripe', status: 'pending' },
      status: 'pending_payment',
    });

    await new StripePaymentProvider().createCheckoutSession(order, 1);

    expect(createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ amount_off: 100, currency: 'gbp' }),
      expect.objectContaining({
        idempotencyKey: `order:${order._id}:attempt:1:coupon`,
      }),
    );
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({
            quantity: 2,
            price_data: expect.objectContaining({
              currency: 'gbp',
              unit_amount: 1000,
            }),
          }),
          expect.objectContaining({
            price_data: expect.objectContaining({
              currency: 'gbp',
              unit_amount: 300,
            }),
          }),
          expect.objectContaining({
            price_data: expect.objectContaining({
              currency: 'gbp',
              unit_amount: 230,
            }),
          }),
        ],
        discounts: [{ coupon: 'coupon-test' }],
      }),
      expect.objectContaining({
        idempotencyKey: `order:${order._id}:attempt:1:checkout`,
      }),
    );
  });

  it('keeps a private offer session at the agreed fixed total and records late payment mismatches', async () => {
    const customer = await User.create({
      name: 'Private offer customer',
      email: 'offer-customer@example.test',
      passwordHash: 'hash',
      role: 'customer',
      accountState: 'active',
      addresses: [],
    });
    const category = await Category.create({ name: 'Offer checkout' });
    const request = await Message.create({
      name: 'Private offer customer',
      email: customer.email,
      subject: 'Offer request',
      body: 'Please make this',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'accepted',
      requestDetails: {
        description: 'Offer details for a private custom production request',
        productName: 'Private offer product',
        productType: 'canvas_custom_print',
        quantity: 3,
      },
    });
    const product = await Product.create({
      title: 'Private offer product',
      slug: 'private-offer-product',
      description: 'Private offer product',
      category: category._id,
      productType: 'canvas_custom_print',
      media: [],
      sku: 'PRIVATE-OFFER-SESSION',
      basePriceMinor: 3350,
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
      agreedPriceMinor: 3350,
      currency: 'GBP',
      agreedQuantity: 3,
      specifications: [{ label: 'Size', value: '30 x 40 cm' }],
      expiresAt: new Date(Date.now() + 60_000),
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
          productionQuantity: 3,
          unitPriceMinor: 3350,
          lineTotalMinor: 3350,
          itemPrintStatus: 'queued',
          requiresProof: false,
        },
      ],
      subtotalMinor: 3350,
      discountMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: 3350,
      currency: 'GBP',
      payment: {
        provider: 'stripe',
        status: 'pending',
        stripeCheckoutSessionId: 'cs_private_offer',
        stripeCheckoutSessionStatus: 'open',
      },
      status: 'pending_payment',
    });
    createCheckoutSession.mockResolvedValue({
      id: 'cs_private_offer',
      url: 'https://checkout.stripe.example/private-offer',
      amount_total: 3350,
      currency: 'gbp',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      payment_intent: 'pi_private_offer',
    });

    await new StripePaymentProvider().createCheckoutSession(order, 1);

    expect(createCoupon).not.toHaveBeenCalled();
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: 'gbp',
              unit_amount: 3350,
            }),
          }),
        ],
        metadata: expect.objectContaining({
          orderId: order._id.toString(),
          customOfferId: offer._id.toString(),
          customerId: customer._id.toString(),
          productId: product._id.toString(),
        }),
      }),
      expect.objectContaining({
        idempotencyKey: `order:${order._id}:attempt:1:checkout`,
      }),
    );

    await Order.updateOne(
      { _id: order._id },
      { $set: { 'payment.status': 'pending' } },
    );
    await CustomOffer.updateOne(
      { _id: offer._id },
      {
        $set: {
          status: 'reserved',
          order: order._id,
          reservedAt: new Date(),
          reservationExpiresAt: new Date(Date.now() + 60_000),
        },
      },
    );
    await CustomOffer.updateOne(
      { _id: offer._id },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
    );

    await applyPaymentToOrder(order._id, {
      provider: 'stripe',
      reference: 'pi_private_offer',
      amountMinor: 3350,
      currency: 'GBP',
      method: 'stripe_checkout',
      stripeCheckoutSessionId: 'cs_private_offer',
    });

    const storedOrder = await Order.findById(order._id);
    const reconciliation = await PaymentReconciliation.findOne({
      sessionId: 'cs_private_offer',
    });
    expect(await PaymentReconciliation.countDocuments()).toBe(1);
    expect(reconciliation?.status).toBe('manual_review');
    expect(reconciliation?.reason).toContain('cancelled');
    expect(storedOrder?.payment.status).not.toBe('paid');
    expect(storedOrder?.payment.mismatchNote).toContain('cancelled');
  });
});

const address = {
  line1: '1 Test Street',
  city: 'Coventry',
  state: 'West Midlands',
  postalCode: 'CV1 1AA',
  country: 'GB',
};
