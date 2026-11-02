import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../src/utils/AppError';
import { quotePublicProduct } from '../src/services/catalog.service';
import {
  AuditEvent,
  Cart,
  Category,
  Order,
  Product,
  Review,
  type IOrder,
} from '../src/models';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    AuditEvent.init(),
    Cart.init(),
    Category.init(),
    Order.init(),
    Product.init(),
    Review.init(),
  ]);
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

describe('Mongoose data layer', () => {
  it('quotes option prices through the server pricing service and reports stock issues', async () => {
    const category = await Category.create({ name: 'Quote tests' });
    await Product.create({
      title: 'Quote test product',
      slug: 'quote-test-product',
      description: 'Product used to test the server quote.',
      category: category._id,
      productType: 'tshirt',
      sku: 'QUOTE-001',
      basePriceMinor: 1200,
      currency: 'GBP',
      status: 'active',
      optionGroups: [{
        key: 'size',
        label: 'Size',
        required: true,
        values: [{
          label: 'Medium',
          value: 'medium',
          priceModifierMinor: 200,
          isAvailable: true,
        }],
      }],
      stock: {
        trackInventory: true,
        quantity: 1,
        lowStockThreshold: 1,
        allowBackorder: false,
        reserveBlanksForMadeToOrder: false,
      },
    });

    const quote = await quotePublicProduct('quote-test-product', {
      selectedOptions: [{ key: 'size', value: 'medium' }],
      quantity: 2,
    });

    expect(quote).toMatchObject({
      unitPriceMinor: 1400,
      lineTotalMinor: 2800,
      currency: 'GBP',
      availability: 'out_of_stock',
      issues: [{ code: 'INSUFFICIENT_STOCK' }],
      breakdown: {
        basePriceMinor: 1200,
        optionModifiersMinor: 200,
      },
    });
  });

  it('returns invalid option selection as a quote issue without inventing a price', async () => {
    const category = await Category.create({ name: 'Option quote tests' });
    await Product.create({
      title: 'Option quote test product',
      slug: 'option-quote-test-product',
      description: 'Product used to test invalid quote options.',
      category: category._id,
      productType: 'tshirt',
      sku: 'QUOTE-002',
      basePriceMinor: 1200,
      currency: 'GBP',
      status: 'active',
      optionGroups: [{
        key: 'size',
        label: 'Size',
        required: true,
        values: [{
          label: 'Medium',
          value: 'medium',
          priceModifierMinor: 200,
          isAvailable: true,
        }],
      }],
    });

    const quote = await quotePublicProduct('option-quote-test-product', {
      selectedOptions: [{ key: 'size', value: 'not-a-size' }],
      quantity: 1,
    });

    expect(quote.unitPriceMinor).toBeNull();
    expect(quote.lineTotalMinor).toBeNull();
    expect(quote.breakdown).toBeNull();
    expect(quote.issues[0]?.code).toBe('INVALID_OPTION_SELECTION');
  });

  it('enforces unique category slugs and product SKUs', async () => {
    const category = await Category.create({ name: 'T-Shirts' });
    expect(category.slug).toBe('t-shirts');
    await expect(
      Category.create({ name: 'Other', slug: category.slug }),
    ).rejects.toMatchObject({
      code: 11000,
    });

    await Product.create(
      productData(category._id, 'TSHIRT-001', 'classic-tee'),
    );
    await expect(
      Product.create(productData(category._id, 'TSHIRT-001', 'another-tee')),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      Product.create(productData(category._id, 'TSHIRT-002', 'classic-tee')),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('requires a user or guest session for a cart', async () => {
    const cart = new Cart({ items: [] });
    await expect(cart.validate()).rejects.toMatchObject({
      errors: { user: expect.anything() },
    });
  });

  it('allows valid order transitions and rejects invalid transitions', () => {
    const order = new Order({ status: 'pending_payment' }) as IOrder;
    order.transitionTo('pending_proof_approval');
    expect(order.status).toBe('pending_proof_approval');
    expect(order.statusHistory).toHaveLength(1);

    expect(() => order.transitionTo('completed')).toThrow(
      expect.objectContaining({
        statusCode: 400,
        code: 'INVALID_STATUS_TRANSITION',
      }),
    );
    expect(() =>
      new Order({ status: 'pending_payment' }).transitionTo('completed'),
    ).toThrow(AppError);
  });

  it('rejects duplicate order idempotency keys', async () => {
    await Order.create(orderData('retry-key'));
    await expect(Order.create(orderData('retry-key'))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('blocks updates and deletes for audit events', async () => {
    const auditEvent = await AuditEvent.create({
      actorRole: 'admin',
      action: 'product.updated',
      targetType: 'Product',
      targetId: new mongoose.Types.ObjectId().toString(),
    });

    await expect(
      AuditEvent.updateOne(
        { _id: auditEvent._id },
        { $set: { action: 'changed' } },
      ),
    ).rejects.toThrow('Audit events are append-only');
    await expect(AuditEvent.deleteOne({ _id: auditEvent._id })).rejects.toThrow(
      'Audit events are append-only',
    );
    await expect(auditEvent.deleteOne()).rejects.toThrow(
      'Audit events are append-only',
    );
  });

  it('allows only one review per user and product', async () => {
    const product = new mongoose.Types.ObjectId();
    const user = new mongoose.Types.ObjectId();
    const review = {
      product,
      user,
      rating: 5,
      title: 'Review',
      body: 'A product review.',
    };

    await Review.create(review);
    await expect(Review.create(review)).rejects.toMatchObject({ code: 11000 });
  });
});

function productData(
  category: mongoose.Types.ObjectId,
  sku: string,
  slug: string,
): Record<string, unknown> {
  return {
    title: 'Custom print',
    slug,
    description: 'Custom printed item',
    category,
    productType: 'tshirt',
    sku,
    basePriceMinor: 2500,
  };
}

function orderData(idempotencyKey: string): Record<string, unknown> {
  const address = {
    line1: '123 Example Street',
    city: 'Example City',
    state: 'CA',
    postalCode: '90000',
    country: 'US',
  };

  return {
    orderNumber: `DB-${idempotencyKey}`,
    idempotencyKey,
    contactSnapshot: { name: 'Test User', email: 'test@example.com' },
    shippingAddress: address,
    billingAddress: address,
    items: [],
    subtotalMinor: 1000,
    totalMinor: 1000,
  };
}
