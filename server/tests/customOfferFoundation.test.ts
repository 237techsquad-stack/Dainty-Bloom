import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { app } from '../src/app';
import {
  AuditEvent,
  Cart,
  Category,
  CustomOffer,
  Message,
  Product,
  Review,
  User,
  Wishlist,
} from '../src/models';
import {
  getCustomerCustomOffer,
  listCustomerCustomOffers,
} from '../src/services/customOffer.service';
import {
  addCartItem,
  getCart,
  mergeGuestCart,
  updateCartItem,
} from '../src/services/cart.service';
import {
  createProductReview,
  getReviewEligibility,
  listProductReviews,
} from '../src/services/review.service';
import {
  addToWishlist,
  getWishlist,
  getWishlistCount,
  moveWishlistItemToCart,
} from '../src/services/wishlist.service';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    AuditEvent.init(),
    Cart.init(),
    Category.init(),
    CustomOffer.init(),
    Message.init(),
    Product.init(),
    Review.init(),
    User.init(),
    Wishlist.init(),
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

describe('private custom offer foundation', () => {
  it('keeps new products public by default and supports legacy products without visibility', async () => {
    const category = await Category.create({
      name: 'Visibility compatibility',
    });
    const publicProduct = await Product.create(
      productData(category._id, 'VISIBILITY-PUBLIC', 'visibility-public'),
    );
    const database = mongoose.connection.db;
    if (!database)
      throw new Error('The in-memory MongoDB connection is missing');
    const legacyProduct = await database
      .collection('products')
      .insertOne(
        rawProductData(category._id, 'VISIBILITY-LEGACY', 'visibility-legacy'),
      );

    expect(publicProduct.visibility).toBe('public');
    const response = await request(app).get('/api/products');
    expect(response.status).toBe(200);
    const slugs = (response.body.data.items as Array<{ slug: string }>).map(
      ({ slug }) => slug,
    );
    expect(slugs).toContain('visibility-public');
    expect(slugs).toContain('visibility-legacy');
    expect(legacyProduct.insertedId).toBeDefined();
  });

  it('excludes private active products from public catalogue, search, categories, details, related products and quotes', async () => {
    const category = await Category.create({ name: 'Private offer products' });
    await Product.create(
      productData(category._id, 'OFFER-PUBLIC', 'offer-public'),
    );
    const privateProduct = await Product.create({
      ...productData(category._id, 'OFFER-PRIVATE', 'offer-private'),
      title: 'Private One-Off Lamp',
      basePriceMinor: 99000,
      visibility: 'private',
      isFeatured: true,
    });

    const [catalog, featured, newest, suggestions, categories] =
      await Promise.all([
        request(app).get('/api/products'),
        request(app).get('/api/products/featured'),
        request(app).get('/api/products/new'),
        request(app).get('/api/products/search-suggestions?q=Private'),
        request(app).get('/api/categories'),
      ]);
    for (const response of [
      catalog,
      featured,
      newest,
      suggestions,
      categories,
    ]) {
      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain('offer-private');
      expect(JSON.stringify(response.body)).not.toContain(
        'Private One-Off Lamp',
      );
    }

    expect(
      (catalog.body.data.items as Array<{ slug: string }>).map(
        ({ slug }) => slug,
      ),
    ).toContain('offer-public');
    expect(
      (catalog.body.data.items as Array<{ slug: string }>).map(
        ({ slug }) => slug,
      ),
    ).not.toContain('offer-private');
    expect(catalog.body.data.facets.maxPrice).toBe(5000);
    expect(
      (
        categories.body.data.categories as Array<{
          slug: string;
          productCount: number;
        }>
      ).find(({ slug }) => slug === category.slug)?.productCount,
    ).toBe(1);

    for (const identifier of [
      privateProduct.slug,
      privateProduct._id.toString(),
    ]) {
      const detail = await request(app).get(`/api/products/${identifier}`);
      expect(detail.status).toBe(404);
      expect(detail.body.error.code).toBe('PRODUCT_NOT_FOUND');

      const quote = await request(app)
        .post(`/api/products/${identifier}/quote`)
        .set('X-Requested-With', 'dainty-bloom')
        .send({ selectedOptions: [], quantity: 1 });
      expect(quote.status).toBe(404);
      expect(quote.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    }

    const publicDetail = await request(app).get('/api/products/offer-public');
    expect(publicDetail.status).toBe(200);
    expect(publicDetail.body.data.product.relatedProducts).toEqual([]);
  });

  it('blocks private products in carts and wishlist reads, counts and writes', async () => {
    const category = await Category.create({ name: 'Wishlist visibility' });
    const privateProduct = await Product.create({
      ...productData(category._id, 'WISHLIST-PRIVATE', 'wishlist-private'),
      visibility: 'private',
    });
    const customer = await User.create({
      name: 'Offer Customer',
      email: 'offer-customer@example.test',
      passwordHash: 'test-only-hash',
      role: 'customer',
    });
    await expect(
      addCartItem(
        { user: customer },
        {
          productId: privateProduct._id.toString(),
          selectedOptions: [],
          quantity: 1,
        },
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    const savedCart = await Cart.create({
      user: customer._id,
      items: [
        {
          product: privateProduct._id,
          selectedOptions: [],
          quantity: 1,
          unitPriceSnapshotMinor: privateProduct.basePriceMinor,
          titleSnapshot: privateProduct.title,
          imageSnapshot: 'https://images.example.test/private-cart-image.png',
        },
      ],
    });
    const cartItemId = savedCart.items[0]?._id.toString();
    if (!cartItemId) throw new Error('The private cart item was not created');
    await expect(
      updateCartItem({ user: customer }, cartItemId, { quantity: 2 }),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    const privateCart = await getCart({ user: customer });
    expect(privateCart.hasBlockingIssues).toBe(true);
    expect(privateCart.items[0]).toMatchObject({
      slug: null,
      title: 'Unavailable product',
      image: null,
      availability: 'unavailable',
    });
    expect(JSON.stringify(privateCart)).not.toContain(privateProduct.title);
    expect(JSON.stringify(privateCart)).not.toContain('private-cart-image');
    await Cart.create({
      sessionId: 'private-offer-guest-cart',
      items: [
        {
          product: privateProduct._id,
          selectedOptions: [],
          quantity: 1,
          unitPriceSnapshotMinor: privateProduct.basePriceMinor,
          titleSnapshot: privateProduct.title,
        },
      ],
    });
    await expect(
      mergeGuestCart(customer, 'private-offer-guest-cart'),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    await Wishlist.create({
      user: customer._id,
      products: [privateProduct._id],
    });

    await expect(
      moveWishlistItemToCart(
        { user: customer },
        {
          productId: privateProduct._id.toString(),
          selectedOptions: [],
          quantity: 1,
        },
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    const wishlist = await getWishlist({ user: customer });
    expect(wishlist.products).toEqual([]);
    expect(wishlist.count).toBe(0);
    expect(await getWishlistCount({ user: customer })).toBe(0);
    await expect(
      addToWishlist({ user: customer }, privateProduct._id.toString()),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
  });

  it('blocks private products in public review listing, eligibility and creation', async () => {
    const category = await Category.create({ name: 'Review visibility' });
    const privateProduct = await Product.create({
      ...productData(category._id, 'REVIEW-PRIVATE', 'review-private'),
      visibility: 'private',
    });
    const customer = await User.create({
      name: 'Review Customer',
      email: 'review-customer@example.test',
      passwordHash: 'test-only-hash',
      role: 'customer',
    });

    const publicReviews = await request(app).get(
      `/api/products/${privateProduct.slug}/reviews`,
    );
    expect(publicReviews.status).toBe(404);

    for (const identifier of [
      privateProduct.slug,
      privateProduct._id.toString(),
    ]) {
      await expect(
        listProductReviews(identifier, { page: 1, limit: 10, sort: 'newest' }),
      ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
      await expect(
        getReviewEligibility(identifier, customer),
      ).rejects.toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
      });
      await expect(
        createProductReview(
          identifier,
          { rating: 5, title: 'Review', body: 'Private offer review attempt.' },
          customer,
        ),
      ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    }
  });

  it('scopes customer offer reads to the intended account and private product', async () => {
    const category = await Category.create({ name: 'Offer ownership' });
    const product = await Product.create({
      ...productData(category._id, 'OFFER-OWNED', 'offer-owned'),
      visibility: 'private',
      media: [
        {
          url: 'https://images.example.test/private-offer.png',
          alt: 'Private offer mockup',
          isPrimary: true,
        },
      ],
    });
    const customer = await User.create({
      name: 'Offer Owner',
      email: 'offer-owner@example.test',
      passwordHash: 'test-only-hash',
      role: 'customer',
    });
    const otherCustomer = await User.create({
      name: 'Other Customer',
      email: 'other-customer@example.test',
      passwordHash: 'test-only-hash',
      role: 'customer',
    });
    const acceptedRequest = await Message.create({
      name: customer.name,
      email: customer.email,
      subject: 'Custom lamp request',
      body: 'I would like a custom lamp.',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'accepted',
    });
    const offer = await CustomOffer.create({
      request: acceptedRequest._id,
      product: product._id,
      customer: customer._id,
      status: 'available',
      agreedPriceMinor: 12500,
      currency: 'GBP',
      agreedQuantity: 1,
      specifications: [{ label: 'Dimensions', value: '20 cm tall' }],
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const ownOffer = await getCustomerCustomOffer(
      offer._id.toString(),
      customer,
    );
    expect(ownOffer).toMatchObject({
      id: offer._id.toString(),
      agreedPriceMinor: 12500,
      agreedQuantity: 1,
      product: {
        id: product._id.toString(),
        title: product.title,
        media: [{ url: 'https://images.example.test/private-offer.png' }],
      },
    });
    await expect(
      getCustomerCustomOffer(offer._id.toString(), otherCustomer),
    ).rejects.toMatchObject({ code: 'CUSTOM_OFFER_NOT_FOUND' });
    expect(await listCustomerCustomOffers(otherCustomer)).toHaveLength(0);
    expect(
      await Product.findOne({ _id: product._id, visibility: 'private' }),
    ).toBeTruthy();
  });

  it('prevents multiple offers for the same request and preserves unlinked historical requests', async () => {
    const category = await Category.create({ name: 'Offer uniqueness' });
    const product = await Product.create({
      ...productData(category._id, 'OFFER-UNIQUE', 'offer-unique'),
      visibility: 'private',
    });
    const acceptedRequest = await Message.create({
      name: 'Historical Customer',
      email: 'historical@example.test',
      subject: 'Older custom request',
      body: 'This historical request is not account-linked.',
      type: 'custom_3d_request',
      customRequestStatus: 'accepted',
    });
    const offerData = {
      request: acceptedRequest._id,
      product: product._id,
      customer: new mongoose.Types.ObjectId(),
      status: 'available' as const,
      agreedPriceMinor: 5000,
      currency: 'GBP' as const,
      agreedQuantity: 1,
      specifications: [],
      expiresAt: new Date(Date.now() + 86_400_000),
    };

    await expect(CustomOffer.create(offerData)).rejects.toMatchObject({
      name: 'ValidationError',
    });
    const linkedCustomer = await User.create({
      name: 'Linked Customer',
      email: 'linked@example.test',
      passwordHash: 'test-only-hash',
      role: 'customer',
    });
    const linkedRequest = await Message.create({
      name: 'Linked Customer',
      email: 'linked@example.test',
      subject: 'Accepted custom request',
      body: 'A linked accepted request.',
      type: 'custom_3d_request',
      customerId: linkedCustomer._id,
      customRequestStatus: 'accepted',
    });
    const validData = {
      ...offerData,
      request: linkedRequest._id,
      customer: linkedCustomer._id,
    };
    await CustomOffer.create(validData);
    await expect(CustomOffer.create(validData)).rejects.toMatchObject({
      code: 11000,
    });

    const legacyRequest = await Message.create({
      name: 'Legacy Customer',
      email: 'legacy@example.test',
      subject: 'Historical request',
      body: 'Historical requests remain readable.',
      type: 'custom_3d_request',
    });
    expect(legacyRequest.customerId).toBeUndefined();
    expect(legacyRequest.customRequestStatus).toBeUndefined();
  });
});

function productData(
  category: mongoose.Types.ObjectId,
  sku: string,
  slug: string,
) {
  return {
    title: slug.replaceAll('-', ' '),
    slug,
    description: 'A product fixture used by private offer security tests.',
    category,
    productType: 'three_d_printed' as const,
    sku,
    basePriceMinor: 5000,
    currency: 'GBP',
    status: 'active' as const,
    stock: {
      trackInventory: false,
      quantity: 0,
      lowStockThreshold: 0,
      allowBackorder: false,
      reserveBlanksForMadeToOrder: false,
    },
  };
}

function rawProductData(
  category: mongoose.Types.ObjectId,
  sku: string,
  slug: string,
) {
  const now = new Date();
  return {
    ...productData(category, sku, slug),
    media: [],
    optionGroups: [],
    quantityPricing: [],
    printTechniques: [],
    specifications: [],
    artworkRequirements: { allowedFormats: [] },
    artworkRequired: false,
    status: 'active',
    viewCount: 0,
    soldCount: 0,
    ratingAverage: 0,
    ratingCount: 0,
    isFeatured: false,
    minOrderQuantity: 1,
    createdAt: now,
    updatedAt: now,
  };
}
