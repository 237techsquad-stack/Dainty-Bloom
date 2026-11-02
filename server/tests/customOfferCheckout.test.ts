import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Category, CustomOffer, Message, Order, Product, User } from '../src/models';
import { addCartItem } from '../src/services/cart.service';
import {
  createCustomOfferOrder,
  startCustomerCustomOfferCheckout,
} from '../src/services/customOffer.service';
import * as paymentFlowService from '../src/services/payment/paymentFlow.service';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    Category.init(),
    CustomOffer.init(),
    Message.init(),
    Order.init(),
    Product.init(),
    User.init(),
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

describe('private offer checkout reservations', () => {
  it('creates a single order with the agreed offer price and production quantity', async () => {
    const customer = await createCustomer('customer@example.test');
    const category = await Category.create({ name: 'Private offers' });
    const request = await Message.create({
      name: 'Customer',
      email: customer.email,
      subject: 'Private offer request',
      body: 'Please make this for me',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'accepted',
      requestDetails: {
        description: 'Private offer custom product',
        productName: 'Private print',
        productType: 'canvas_custom_print',
        quantity: 2,
      },
    });
    const product = await Product.create({
      title: 'Private custom canvas',
      slug: 'private-custom-canvas',
      description: 'private',
      category: category._id,
      productType: 'canvas_custom_print',
      media: [],
      sku: 'PRIVATE-1',
      basePriceMinor: 4599,
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
      agreedPriceMinor: 4599,
      currency: 'GBP',
      agreedQuantity: 5,
      specifications: [{ label: 'Size', value: '30 x 40 cm' }],
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await createCustomOfferOrder(customer, offer._id.toString());
    const savedOrder = await Order.findOne({ customOffer: offer._id });
    const savedOffer = await CustomOffer.findById(offer._id);

    expect(result.created).toBe(true);
    expect(result.totalMinor).toBe(4599);
    expect(result.productionQuantity).toBe(5);
    expect(savedOrder).not.toBeNull();
    expect(savedOrder?.status).toBe('pending_payment');
    expect(savedOrder?.subtotalMinor).toBe(4599);
    expect(savedOrder?.shippingMinor).toBe(0);
    expect(savedOrder?.taxMinor).toBe(0);
    expect(savedOrder?.totalMinor).toBe(4599);
    expect(savedOrder?.payment.status).toBe('pending');
    expect(savedOrder?.items[0]?.quantity).toBe(1);
    expect(savedOrder?.items[0]?.productionQuantity).toBe(5);
    expect(savedOrder?.items[0]?.lineTotalMinor).toBe(4599);
    expect(savedOffer?.status).toBe('reserved');
    await expect(
      addCartItem(
        { user: customer },
        {
          productId: product._id.toString(),
          selectedOptions: [],
          quantity: 1,
        },
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
  });

  it('starts the existing order checkout flow for an eligible private offer', async () => {
    const customer = await createCustomer('customer-checkout@example.test');
    const category = await Category.create({ name: 'Checkout offers' });
    const request = await Message.create({
      name: 'Customer',
      email: customer.email,
      subject: 'Checkout offer',
      body: 'Please make this',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'accepted',
      requestDetails: {
        description: 'Checkout private offer request details',
        productName: 'Offer checkout item',
        productType: 'canvas_custom_print',
        quantity: 1,
      },
    });
    const product = await Product.create({
      title: 'Offer checkout product',
      slug: 'offer-checkout-product',
      description: 'test',
      category: category._id,
      productType: 'canvas_custom_print',
      media: [],
      sku: 'PRIVATE-CHECKOUT',
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
      specifications: [{ label: 'Size', value: '40 x 60 cm' }],
      expiresAt: new Date(Date.now() + 60_000),
    });

    const startSpy = vi
      .spyOn(paymentFlowService, 'startOrderCheckout')
      .mockResolvedValue({
        checkoutUrl: 'https://checkout.example.com/private-offer',
        expiresAt: new Date(Date.now() + 60_000),
      });

    const result = await startCustomerCustomOfferCheckout(
      customer,
      offer._id.toString(),
    );

    expect(startSpy).toHaveBeenCalledWith(
      expect.any(String),
      { user: customer },
    );
    expect(result.checkoutUrl).toBe('https://checkout.example.com/private-offer');
    expect(result.totalMinor).toBe(3350);
    expect(result.productionQuantity).toBe(3);
    expect(result.created).toBe(true);
  });

  it('rejects other customers and reuses a valid existing order on retry', async () => {
    const customer = await createCustomer('customer-a@example.test');
    const otherCustomer = await createCustomer('customer-b@example.test');
    const category = await Category.create({ name: 'Retry offers' });
    const request = await Message.create({
      name: 'Customer',
      email: customer.email,
      subject: 'Retry offer',
      body: 'Please make this',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'accepted',
      requestDetails: {
        description: 'Retry private offer request details',
        productName: 'Private retry',
        productType: 'canvas_custom_print',
        quantity: 1,
      },
    });
    const product = await Product.create({
      title: 'Retry private product',
      slug: 'retry-private-product',
      description: 'test',
      category: category._id,
      productType: 'canvas_custom_print',
      media: [],
      sku: 'PRIVATE-2',
      basePriceMinor: 2500,
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
      agreedPriceMinor: 2500,
      currency: 'GBP',
      agreedQuantity: 2,
      specifications: [{ label: 'Size', value: '20 x 30 cm' }],
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      createCustomOfferOrder(otherCustomer, offer._id.toString()),
    ).rejects.toMatchObject({ code: 'CUSTOM_OFFER_NOT_FOUND' });

    const first = await createCustomOfferOrder(customer, offer._id.toString());
    const second = await createCustomOfferOrder(customer, offer._id.toString());

    expect(first.orderId).toBe(second.orderId);
    expect(second.created).toBe(false);
    expect(await Order.countDocuments({ customOffer: offer._id })).toBe(1);
  });

  it('rejects expired, cancelled and already purchased offers', async () => {
    const customer = await createCustomer('customer-c@example.test');
    const category = await Category.create({ name: 'Status offers' });
    const _product = await Product.create({
      title: 'Status private product',
      slug: 'status-private-product',
      description: 'test',
      category: category._id,
      productType: 'canvas_custom_print',
      media: [],
      sku: 'PRIVATE-3',
      basePriceMinor: 1000,
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

    const expiredRequest = await Message.create({
      name: 'Customer',
      email: customer.email,
      subject: 'Expired offer',
      body: 'Please make this',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'accepted',
      requestDetails: {
        description: 'Expired private offer request details',
        productName: 'Expired private',
        productType: 'canvas_custom_print',
        quantity: 1,
      },
    });
    const expiredProduct = await Product.create({
      title: 'Expired private product',
      slug: 'expired-private-product',
      description: 'test',
      category: category._id,
      productType: 'canvas_custom_print',
      media: [],
      sku: 'PRIVATE-EXPIRED',
      basePriceMinor: 1000,
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
    const expired = await CustomOffer.create({
      request: expiredRequest._id,
      product: expiredProduct._id,
      customer: customer._id,
      status: 'available',
      agreedPriceMinor: 1000,
      currency: 'GBP',
      agreedQuantity: 1,
      specifications: [{ label: 'Size', value: '20 x 30 cm' }],
      expiresAt: new Date(Date.now() + 60_000),
    });
    await CustomOffer.updateOne(
      { _id: expired._id },
      {
        $set: {
          status: 'expired',
          expiresAt: new Date(Date.now() - 5_000),
        },
      },
    );
    await expect(
      createCustomOfferOrder(customer, expired._id.toString()),
    ).rejects.toMatchObject({ code: 'CUSTOM_OFFER_EXPIRED' });

    const cancelledRequest = await Message.create({
      name: 'Customer',
      email: customer.email,
      subject: 'Cancelled offer',
      body: 'Please make this',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'accepted',
      requestDetails: {
        description: 'Cancelled private offer request details',
        productName: 'Cancelled private',
        productType: 'canvas_custom_print',
        quantity: 1,
      },
    });
    const cancelledProduct = await Product.create({
      title: 'Cancelled private product',
      slug: 'cancelled-private-product',
      description: 'test',
      category: category._id,
      productType: 'canvas_custom_print',
      media: [],
      sku: 'PRIVATE-CANCELLED',
      basePriceMinor: 1000,
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
    const cancelled = await CustomOffer.create({
      request: cancelledRequest._id,
      product: cancelledProduct._id,
      customer: customer._id,
      status: 'available',
      agreedPriceMinor: 1000,
      currency: 'GBP',
      agreedQuantity: 1,
      specifications: [{ label: 'Size', value: '20 x 30 cm' }],
      expiresAt: new Date(Date.now() + 60_000),
    });
    await CustomOffer.updateOne(
      { _id: cancelled._id },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancellationReason: 'Customer requested cancellation',
        },
      },
    );
    await expect(
      createCustomOfferOrder(customer, cancelled._id.toString()),
    ).rejects.toMatchObject({ code: 'CUSTOM_OFFER_CANCELLED' });

    const purchasedRequest = await Message.create({
      name: 'Customer',
      email: customer.email,
      subject: 'Purchased offer',
      body: 'Please make this',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'accepted',
      requestDetails: {
        description: 'Purchased private offer request details',
        productName: 'Purchased private',
        productType: 'canvas_custom_print',
        quantity: 1,
      },
    });
    const purchasedProduct = await Product.create({
      title: 'Purchased private product',
      slug: 'purchased-private-product',
      description: 'test',
      category: category._id,
      productType: 'canvas_custom_print',
      media: [],
      sku: 'PRIVATE-PURCHASED',
      basePriceMinor: 1000,
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
    const order = await Order.create({
      user: customer._id,
      contactSnapshot: { name: customer.name, email: customer.email },
      shippingAddress: {
        line1: 'Street',
        city: 'London',
        state: 'London',
        postalCode: 'SW1A 1AA',
        country: 'GB',
      },
      billingAddress: {
        line1: 'Street',
        city: 'London',
        state: 'London',
        postalCode: 'SW1A 1AA',
        country: 'GB',
      },
      items: [
        {
          product: purchasedProduct._id,
          titleSnapshot: purchasedProduct.title,
          skuSnapshot: purchasedProduct.sku,
          selectedOptions: [],
          quantity: 1,
          productionQuantity: 1,
          unitPriceMinor: 1000,
          lineTotalMinor: 1000,
          itemPrintStatus: 'queued',
          requiresProof: false,
        },
      ],
      subtotalMinor: 1000,
      discountMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: 1000,
      currency: 'GBP',
      payment: { provider: 'stripe', status: 'paid', stripeCheckoutAttempt: 0 },
      status: 'pending_payment',
      statusHistory: [{ from: 'pending_payment', to: 'pending_payment', at: new Date() }],
    });
    const paidOffer = await CustomOffer.create({
      request: purchasedRequest._id,
      product: purchasedProduct._id,
      customer: customer._id,
      status: 'available',
      agreedPriceMinor: 1000,
      currency: 'GBP',
      agreedQuantity: 1,
      specifications: [{ label: 'Size', value: '20 x 30 cm' }],
      expiresAt: new Date(Date.now() + 60_000),
    });
    await CustomOffer.updateOne(
      { _id: paidOffer._id },
      {
        $set: {
          status: 'purchased',
          order: order._id,
          purchasedAt: new Date(),
        },
      },
    );
    await expect(
      createCustomOfferOrder(customer, paidOffer._id.toString()),
    ).rejects.toMatchObject({ code: 'CUSTOM_OFFER_ALREADY_PURCHASED' });
  });

  it('prevents concurrent duplicate reservations for the same offer', async () => {
    const customer = await createCustomer('customer-d@example.test');
    const category = await Category.create({ name: 'Concurrent offers' });
    const request = await Message.create({
      name: 'Customer',
      email: customer.email,
      subject: 'Concurrent offer',
      body: 'Please make this',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'accepted',
      requestDetails: {
        description: 'Concurrent private offer request details',
        productName: 'Concurrent private',
        productType: 'canvas_custom_print',
        quantity: 1,
      },
    });
    const product = await Product.create({
      title: 'Concurrent private product',
      slug: 'concurrent-private-product',
      description: 'test',
      category: category._id,
      productType: 'canvas_custom_print',
      media: [],
      sku: 'PRIVATE-4',
      basePriceMinor: 4000,
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
      agreedPriceMinor: 4000,
      currency: 'GBP',
      agreedQuantity: 4,
      specifications: [{ label: 'Size', value: '35 x 50 cm' }],
      expiresAt: new Date(Date.now() + 60_000),
    });

    const results = await Promise.all([
      createCustomOfferOrder(customer, offer._id.toString()),
      createCustomOfferOrder(customer, offer._id.toString()),
    ]);

    expect(results.filter((result) => result.created).length).toBe(1);
    expect(await Order.countDocuments({ customOffer: offer._id })).toBe(1);
  });
});

async function createCustomer(email: string) {
  return User.create({
    name: 'Offer customer',
    email,
    passwordHash: 'test-password-hash',
    role: 'customer',
    accountState: 'active',
    addresses: [],
  });
}
