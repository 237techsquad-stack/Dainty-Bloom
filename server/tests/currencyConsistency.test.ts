import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { checkoutSnapshot } from '../src/services/order.service';
import { Cart, Product, SiteSettings } from '../src/models';

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
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('checkout currency consistency', () => {
  it('rejects a USD cart without creating or changing an order', async () => {
    const now = new Date();
    await Cart.collection.insertOne({
      sessionId: 'usd-cart-session',
      currency: 'USD',
      items: [],
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      checkoutSnapshot({ sessionId: 'usd-cart-session' }),
    ).rejects.toMatchObject({
      code: 'CART_CURRENCY_MISMATCH',
      statusCode: 409,
    });
  });

  it('rejects a GBP cart containing a USD product', async () => {
    const now = new Date();
    const productId = await insertProduct('USD', 1000, now);
    await insertSettings(now);
    await insertCart('mixed-currency-session', 'GBP', productId, now);

    await expect(
      checkoutSnapshot({ sessionId: 'mixed-currency-session' }),
    ).rejects.toMatchObject({
      code: 'PRODUCT_CURRENCY_MISMATCH',
      statusCode: 409,
    });
  });

  it('calculates shipping, tax and total in GBP pence from stored product prices', async () => {
    const now = new Date();
    const productId = await insertProduct('GBP', 1000, now);
    await insertSettings(now);
    await insertCart('gbp-session', 'GBP', productId, now, 2);

    const snapshot = await checkoutSnapshot({ sessionId: 'gbp-session' });

    expect(snapshot.totals).toEqual({
      subtotalMinor: 2000,
      discountMinor: 0,
      shippingMinor: 300,
      taxMinor: 230,
      totalMinor: 2530,
      currency: 'GBP',
    });
    expect(snapshot.validation.lines[0]?.unitPriceMinor).toBe(1000);
  });
});

async function insertSettings(updatedAt: Date): Promise<void> {
  await SiteSettings.collection.insertOne({
    key: 'default',
    currency: 'GBP',
    shippingFlatMinor: 300,
    freeShippingThresholdMinor: 5000,
    taxRateBasisPoints: 1000,
    shippingConfigured: true,
    taxConfigured: true,
    updatedAt,
    createdAt: updatedAt,
  });
}

async function insertProduct(
  currency: string,
  basePriceMinor: number,
  updatedAt: Date,
): Promise<Types.ObjectId> {
  const _id = new Types.ObjectId();
  await Product.collection.insertOne({
    _id,
    title: 'Currency test product',
    slug: `currency-test-${_id.toString()}`,
    status: 'active',
    currency,
    basePriceMinor,
    media: [],
    optionGroups: [],
    quantityPricing: [],
    stock: {
      trackInventory: false,
      quantity: 0,
      lowStockThreshold: 0,
      allowBackorder: false,
      reserveBlanksForMadeToOrder: false,
    },
    minOrderQuantity: 1,
    artworkRequired: false,
    artworkRequirements: { allowedFormats: [] },
    updatedAt,
    createdAt: updatedAt,
  });
  return _id;
}

async function insertCart(
  sessionId: string,
  currency: string,
  product: Types.ObjectId,
  updatedAt: Date,
  quantity = 1,
): Promise<void> {
  await Cart.collection.insertOne({
    sessionId,
    currency,
    items: [
      {
        _id: new Types.ObjectId(),
        product,
        selectedOptions: [],
        quantity,
        unitPriceSnapshotMinor: 1,
        titleSnapshot: 'Stale client snapshot',
      },
    ],
    updatedAt,
    createdAt: updatedAt,
  });
}
