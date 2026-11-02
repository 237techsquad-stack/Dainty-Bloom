import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  applyCurrencyMigrationChanges,
  buildCurrencyMigrationPlan,
  CurrencyMigrationError,
  USD_TO_GBP_MIGRATION_ID,
} from '../src/services/currencyMigration.service';
import { Cart, Message, Order, Product, SiteSettings } from '../src/models';

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

describe('USD-to-GBP migration planning', () => {
  it('previews every supported monetary field without writing and preserves orders', async () => {
    const now = new Date();
    const productId = new Types.ObjectId();
    const settingsId = new Types.ObjectId();
    const cartId = new Types.ObjectId();
    const messageId = new Types.ObjectId();
    const orderId = new Types.ObjectId();

    await SiteSettings.collection.insertOne({
      _id: settingsId,
      key: 'default',
      currency: 'USD',
      shippingFlatMinor: 1000,
      freeShippingThresholdMinor: 5000,
      taxRateBasisPoints: 825,
      updatedAt: now,
      createdAt: now,
    });
    await Product.collection.insertOne({
      _id: productId,
      currency: 'USD',
      basePriceMinor: 1000,
      compareAtPriceMinor: 2000,
      optionGroups: [
        {
          key: 'size',
          values: [{ value: 'large', priceModifierMinor: -25 }],
        },
      ],
      quantityPricing: [{ minQty: 5, unitPriceMinor: 900 }],
      updatedAt: now,
      createdAt: now,
    });
    await Cart.collection.insertOne({
      _id: cartId,
      sessionId: 'migration-test-session',
      currency: 'USD',
      items: [
        {
          _id: new Types.ObjectId(),
          product: productId,
          selectedOptions: [],
          quantity: 1,
          unitPriceSnapshotMinor: 1000,
          titleSnapshot: 'Migration test item',
        },
      ],
      updatedAt: now,
      createdAt: now,
    });
    await Message.collection.insertOne({
      _id: messageId,
      quotedPriceMinor: 1000,
      quotedPriceCurrency: 'USD',
      updatedAt: now,
      createdAt: now,
    });
    await Order.collection.insertOne({
      _id: orderId,
      currency: 'USD',
      totalMinor: 1000,
      createdAt: now,
      updatedAt: now,
    });

    const plan = await buildCurrencyMigrationPlan();

    expect(plan.counts).toEqual({
      settings: 1,
      products: 1,
      carts: 1,
      clearedCarts: 0,
      unlinkedArtworkAssets: 0,
      messages: 1,
    });
    expect(plan.examples).toContainEqual({
      recordType: 'product base price',
      sourceMinor: 1000,
      targetMinor: 753,
    });
    expect(plan.orderCurrencyCounts).toEqual({ USD: 1 });
    expect(
      (await SiteSettings.collection.findOne({ _id: settingsId }))?.currency,
    ).toBe('USD');
    expect(
      (await Product.collection.findOne({ _id: productId }))?.basePriceMinor,
    ).toBe(1000);
    expect((await Cart.collection.findOne({ _id: cartId }))?.currency).toBe(
      'USD',
    );
    expect(
      (await Message.collection.findOne({ _id: messageId }))?.quotedPriceMinor,
    ).toBe(1000);
    expect((await Order.collection.findOne({ _id: orderId }))?.totalMinor).toBe(
      1000,
    );

    await applyCurrencyMigrationChanges(plan.changes, USD_TO_GBP_MIGRATION_ID);
    await applyCurrencyMigrationChanges(plan.changes, USD_TO_GBP_MIGRATION_ID);

    const updatedSettings = await SiteSettings.collection.findOne({
      _id: settingsId,
    });
    const updatedProduct = await Product.collection.findOne({ _id: productId });
    const updatedCart = await Cart.collection.findOne({ _id: cartId });
    const updatedMessage = await Message.collection.findOne({ _id: messageId });
    const unchangedOrder = await Order.collection.findOne({ _id: orderId });

    expect(updatedSettings).toMatchObject({
      currency: 'GBP',
      shippingFlatMinor: 753,
      freeShippingThresholdMinor: 3763,
      taxRateBasisPoints: 825,
    });
    expect(updatedProduct).toMatchObject({
      currency: 'GBP',
      basePriceMinor: 753,
      compareAtPriceMinor: 1505,
      optionGroups: [
        { key: 'size', values: [{ value: 'large', priceModifierMinor: -19 }] },
      ],
      quantityPricing: [{ minQty: 5, unitPriceMinor: 677 }],
    });
    expect(updatedCart).toMatchObject({
      currency: 'GBP',
      items: [{ unitPriceSnapshotMinor: 753 }],
    });
    expect(updatedMessage).toMatchObject({
      quotedPriceMinor: 753,
      quotedPriceCurrency: 'GBP',
    });
    expect(unchangedOrder).toMatchObject({
      currency: 'USD',
      totalMinor: 1000,
    });
  });

  it('aborts on unexpected currencies and invalid prices before any write', async () => {
    const now = new Date();
    const settingsId = new Types.ObjectId();
    await SiteSettings.collection.insertOne({
      _id: settingsId,
      key: 'default',
      currency: 'USD',
      shippingFlatMinor: 100,
      updatedAt: now,
      createdAt: now,
    });
    await Product.collection.insertOne({
      _id: new Types.ObjectId(),
      currency: 'EUR',
      basePriceMinor: 100,
      optionGroups: [],
      quantityPricing: [],
      updatedAt: now,
      createdAt: now,
    });

    await expect(buildCurrencyMigrationPlan()).rejects.toBeInstanceOf(
      CurrencyMigrationError,
    );
    expect(
      (await SiteSettings.collection.findOne({ _id: settingsId }))?.currency,
    ).toBe('USD');

    await Product.collection.deleteMany({});
    await Product.collection.insertOne({
      _id: new Types.ObjectId(),
      currency: 'USD',
      basePriceMinor: 1.25,
      optionGroups: [],
      quantityPricing: [],
      updatedAt: now,
      createdAt: now,
    });
    await expect(buildCurrencyMigrationPlan()).rejects.toThrow(
      'basePriceMinor must be a safe integer minor-unit amount',
    );
    expect(
      (await SiteSettings.collection.findOne({ _id: settingsId }))?.currency,
    ).toBe('USD');
  });

  it('migrates an empty cart without building an empty switch expression', async () => {
    const now = new Date();
    const cartId = new Types.ObjectId();
    await SiteSettings.collection.insertOne({
      _id: new Types.ObjectId(),
      key: 'default',
      currency: 'USD',
      shippingFlatMinor: 0,
      updatedAt: now,
      createdAt: now,
    });
    await Cart.collection.insertOne({
      _id: cartId,
      sessionId: 'empty-cart-session',
      currency: 'USD',
      items: [],
      updatedAt: now,
      createdAt: now,
    });

    const plan = await buildCurrencyMigrationPlan();
    const cartChange = plan.changes.find(
      (change) => change.collection === 'carts',
    );
    expect(cartChange?.cartItemPrices).toEqual([]);

    await applyCurrencyMigrationChanges(plan.changes);

    expect(await Cart.collection.findOne({ _id: cartId })).toMatchObject({
      currency: 'GBP',
      items: [],
    });
  });

  it('clears a cart that references a missing product during migration', async () => {
    const now = new Date();
    const cartId = new Types.ObjectId();
    await SiteSettings.collection.insertOne({
      _id: new Types.ObjectId(),
      key: 'default',
      currency: 'USD',
      shippingFlatMinor: 0,
      updatedAt: now,
      createdAt: now,
    });
    await Cart.collection.insertOne({
      _id: cartId,
      sessionId: 'stale-cart-session',
      currency: 'USD',
      items: [
        {
          product: new Types.ObjectId(),
          quantity: 1,
          unitPriceSnapshotMinor: 500,
        },
      ],
      updatedAt: now,
      createdAt: now,
    });

    const plan = await buildCurrencyMigrationPlan();
    expect(plan.counts.clearedCarts).toBe(1);
    expect(
      (await Cart.collection.findOne({ _id: cartId }))?.items,
    ).toHaveLength(1);

    await applyCurrencyMigrationChanges(plan.changes);
    expect(await Cart.collection.findOne({ _id: cartId })).toMatchObject({
      currency: 'GBP',
      items: [],
    });
  });

  it('aborts when a stored message quote has no confirmed currency', async () => {
    const now = new Date();
    await SiteSettings.collection.insertOne({
      _id: new Types.ObjectId(),
      key: 'default',
      currency: 'USD',
      shippingFlatMinor: 0,
      updatedAt: now,
      createdAt: now,
    });
    await Message.collection.insertOne({
      _id: new Types.ObjectId(),
      quotedPriceMinor: 500,
      updatedAt: now,
      createdAt: now,
    });

    await expect(buildCurrencyMigrationPlan()).rejects.toThrow(
      'A message quote has no stored currency; manual review is required',
    );
  });
});
