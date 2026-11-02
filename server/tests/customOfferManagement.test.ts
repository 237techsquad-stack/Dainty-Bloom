import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('../src/utils/fileType', () => ({
  detectFileType: async () => ({ mime: 'image/png' }),
}));

import { env } from '../src/config/env';
import { app } from '../src/app';
import {
  ArtworkAsset,
  AuditEvent,
  Category,
  CustomOffer,
  Message,
  Product,
  User,
} from '../src/models';
import { addCartItem } from '../src/services/cart.service';
import { updateProduct } from '../src/services/productAdmin.service';

const CSRF_HEADER = { 'X-Requested-With': 'dainty-bloom' };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

let mongo: MongoMemoryServer;
let originalStorageDirectory: string;
let originalStorageDriver: string;
let storageRoot: string;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    ArtworkAsset.init(),
    AuditEvent.init(),
    Category.init(),
    CustomOffer.init(),
    Message.init(),
    Product.init(),
    User.init(),
  ]);
});

beforeEach(async () => {
  originalStorageDirectory = env.STORAGE_PRIVATE_DIR;
  originalStorageDriver = env.STORAGE_DRIVER;
  storageRoot = await mkdtemp(path.join(os.tmpdir(), 'dainty-offer-test-'));
  env.STORAGE_PRIVATE_DIR = storageRoot;
  env.STORAGE_DRIVER = 'local';
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
  env.STORAGE_PRIVATE_DIR = originalStorageDirectory;
  env.STORAGE_DRIVER = originalStorageDriver;
  await rm(storageRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('admin private custom offers', () => {
  it('rejects customer access to offer creation', async () => {
    const customer = await createUser('customer');
    const acceptedRequest = await createRequest(customer);
    const response = await submitOffer(acceptedRequest.id, customer.cookie);
    const support = await createUser('support');
    const supportResponse = await submitOffer(
      acceptedRequest.id,
      support.cookie,
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(supportResponse.status).toBe(403);
    expect(supportResponse.body.error.code).toBe('FORBIDDEN');
    expect(await Product.countDocuments()).toBe(0);
    expect(await ArtworkAsset.countDocuments()).toBe(0);
  });

  it('rejects requests that are not accepted or lack a linked customer before storing an image', async () => {
    const admin = await createUser('admin');
    const customer = await createUser('customer');
    const submittedRequest = await createRequest(customer, 'submitted');
    const historicalRequest = await createRequest(undefined, 'accepted');

    const [notAccepted, noAccount] = await Promise.all([
      submitOffer(submittedRequest.id, admin.cookie),
      submitOffer(historicalRequest.id, admin.cookie),
    ]);

    expect(notAccepted.status).toBe(409);
    expect(notAccepted.body.error.code).toBe('CUSTOM_REQUEST_NOT_ACCEPTED');
    expect(noAccount.status).toBe(409);
    expect(noAccount.body.error.code).toBe('CUSTOM_REQUEST_CUSTOMER_REQUIRED');
    expect(await Product.countDocuments()).toBe(0);
    expect(await ArtworkAsset.countDocuments()).toBe(0);
  });

  it('creates a private offer with server-derived ownership and fixed terms', async () => {
    const admin = await createUser('admin');
    const customer = await createUser('customer');
    const category = await Category.create({
      name: 'Private offer products',
      isActive: true,
    });
    const customRequest = await createRequest(customer);
    const response = await submitOffer(
      customRequest.id,
      admin.cookie,
      category._id.toString(),
    );

    expect(response.status).toBe(201);
    const offer = await CustomOffer.findOne({ request: customRequest.id });
    const product = await Product.findById(offer?.product);
    const savedRequest = await Message.findById(customRequest.id);
    const artwork = await ArtworkAsset.findOne({ customOffer: offer?._id });

    expect(offer).toMatchObject({
      status: 'available',
      agreedPriceMinor: 4599,
      currency: 'GBP',
      agreedQuantity: 3,
      specifications: [
        { label: 'Size and dimensions', value: '20 x 30 cm' },
        { label: 'Colours', value: 'Lavender and cream' },
        { label: 'Materials', value: 'Cotton canvas' },
        { label: 'Personalisation', value: 'Name on the lower edge' },
        { label: 'Additional instructions', value: 'Use a matte finish' },
      ],
    });
    expect(offer?.customer.toString()).toBe(customer.id);
    expect(product).toMatchObject({
      title: 'Personalised Canvas',
      basePriceMinor: 4599,
      currency: 'GBP',
      status: 'active',
      visibility: 'private',
      productType: 'canvas_custom_print',
      media: [],
      minOrderQuantity: 1,
      maxOrderQuantity: 1,
      optionGroups: [],
      quantityPricing: [],
    });
    expect(offer?.customer.toString()).toBe(customer.id);
    expect(savedRequest?.customRequestStatus).toBe('offer_created');
    expect(artwork?.owner?.toString()).toBe(customer.id);
    expect(artwork?.customOffer?.toString()).toBe(offer?._id.toString());
    expect(response.body.data.offer.image.url).toBe(
      `/api/admin/messages/${customRequest.id}/custom-offer/image`,
    );
    expect(response.body.data.offer).not.toHaveProperty('customer');
    expect(response.body.data.offer).not.toHaveProperty('storageKey');

    const publicDetail = await request(app).get(
      `/api/products/${product?.slug}`,
    );
    expect(publicDetail.status).toBe(404);
    expect(JSON.stringify(publicDetail.body)).not.toContain(
      'Personalised Canvas',
    );
    if (!product) throw new Error('The private product was not created');
    await expect(
      addCartItem(
        { user: customer.user },
        {
          productId: product._id.toString(),
          selectedOptions: [],
          quantity: 1,
        },
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
  });

  it('prevents duplicate and concurrent offers for one request', async () => {
    const admin = await createUser('admin');
    const customer = await createUser('customer');
    const category = await Category.create({ name: 'Concurrent offers' });
    const customRequest = await createRequest(customer);

    const responses = await Promise.all([
      submitOffer(customRequest.id, admin.cookie, category._id.toString()),
      submitOffer(customRequest.id, admin.cookie, category._id.toString()),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(
      await CustomOffer.countDocuments({ request: customRequest.id }),
    ).toBe(1);
    expect(await Product.countDocuments()).toBe(1);
    expect(await ArtworkAsset.countDocuments()).toBe(1);

    const duplicate = await submitOffer(
      customRequest.id,
      admin.cookie,
      category._id.toString(),
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CUSTOM_OFFER_ALREADY_EXISTS');
    expect(await Product.countDocuments()).toBe(1);
  });

  it('removes partial resources and leaves the accepted request unchanged if offer creation fails', async () => {
    const admin = await createUser('admin');
    const customer = await createUser('customer');
    const category = await Category.create({ name: 'Recovery offers' });
    const customRequest = await createRequest(customer);
    vi.spyOn(CustomOffer, 'create').mockRejectedValueOnce(
      new Error('simulated offer persistence failure'),
    );

    const response = await submitOffer(
      customRequest.id,
      admin.cookie,
      category._id.toString(),
    );

    expect(response.status).toBe(500);
    expect(await Product.countDocuments()).toBe(0);
    expect(await CustomOffer.countDocuments()).toBe(0);
    expect(await ArtworkAsset.countDocuments()).toBe(0);
    expect(
      (await Message.findById(customRequest.id))?.customRequestStatus,
    ).toBe('accepted');
  });

  it('removes the private mockup if private product creation fails', async () => {
    const admin = await createUser('admin');
    const customer = await createUser('customer');
    const category = await Category.create({ name: 'Product failure offers' });
    const customRequest = await createRequest(customer);
    vi.spyOn(Product, 'create').mockRejectedValueOnce(
      new Error('simulated private product persistence failure'),
    );

    const response = await submitOffer(
      customRequest.id,
      admin.cookie,
      category._id.toString(),
    );

    expect(response.status).toBe(500);
    expect(await ArtworkAsset.countDocuments()).toBe(0);
    expect(await Product.countDocuments()).toBe(0);
    expect(await CustomOffer.countDocuments()).toBe(0);
    expect(
      (await Message.findById(customRequest.id))?.customRequestStatus,
    ).toBe('accepted');
  });

  it('does not allow generic product management to change an offer price', async () => {
    const admin = await createUser('admin');
    const customer = await createUser('customer');
    const category = await Category.create({ name: 'Fixed price offers' });
    const customRequest = await createRequest(customer);
    const response = await submitOffer(
      customRequest.id,
      admin.cookie,
      category._id.toString(),
    );
    const product = await Product.findOne({ sku: { $regex: /^CUSTOM-/ } });
    if (!product) throw new Error('The private product was not created');

    await expect(
      updateProduct(product._id.toString(), { basePriceMinor: 1 }, admin.user),
    ).rejects.toMatchObject({ code: 'CUSTOM_OFFER_PRODUCT_IMMUTABLE' });
    expect((await Product.findById(product._id))?.basePriceMinor).toBe(4599);
    expect(response.status).toBe(201);
  });

  it('returns offer information and mockup only to the linked customer', async () => {
    const admin = await createUser('admin');
    const customer = await createUser('customer');
    const otherCustomer = await createUser('customer');
    const category = await Category.create({ name: 'Scoped offers' });
    const customRequest = await createRequest(customer);
    const created = await submitOffer(
      customRequest.id,
      admin.cookie,
      category._id.toString(),
    );
    expect(created.status).toBe(201);

    const ownRequest = await request(app)
      .get(`/api/messages/custom-requests/${customRequest.id}`)
      .set('Cookie', customer.cookie);
    const otherRequest = await request(app)
      .get(`/api/messages/custom-requests/${customRequest.id}`)
      .set('Cookie', otherCustomer.cookie);
    const ownImage = await request(app)
      .get(`/api/messages/custom-requests/${customRequest.id}/offer-image`)
      .set('Cookie', customer.cookie);
    const adminImage = await request(app)
      .get(`/api/admin/messages/${customRequest.id}/custom-offer/image`)
      .set('Cookie', admin.cookie);
    const otherImage = await request(app)
      .get(`/api/messages/custom-requests/${customRequest.id}/offer-image`)
      .set('Cookie', otherCustomer.cookie);

    expect(ownRequest.status).toBe(200);
    expect(ownRequest.body.data.request.customOffer.status).toBe('available');
    expect(ownRequest.body.data.request.customRequestStatus).toBe(
      'offer_created',
    );
    expect(otherRequest.status).toBe(404);
    expect(otherImage.status).toBe(404);
    expect(ownImage.status).toBe(200);
    expect(adminImage.status).toBe(200);
    expect(ownImage.headers['cache-control']).toContain('no-store');
    expect(ownImage.headers['content-type']).toContain('image/png');
  });
});

async function createUser(role: 'admin' | 'customer' | 'support') {
  const suffix = Math.random().toString(36).slice(2);
  const user = await User.create({
    name: `Offer ${role}`,
    email: `${role}-${suffix}@example.test`,
    passwordHash: 'test-only-password-hash',
    role,
  });
  const token = jwt.sign(
    { sub: user._id.toString(), ver: user.tokenVersion, typ: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' },
  );
  return {
    id: user._id.toString(),
    user,
    cookie: `daintyAccessToken=${token}`,
  };
}

async function createRequest(
  customer: Awaited<ReturnType<typeof createUser>> | undefined,
  status: 'accepted' | 'submitted' = 'accepted',
) {
  const record = await Message.create({
    name: customer?.user.name ?? 'Historical Customer',
    email: customer?.user.email ?? 'historical@example.test',
    subject: 'Custom canvas request',
    body: 'Please make a personalised canvas for my home.',
    type: 'custom_3d_request',
    ...(customer ? { customerId: customer.user._id } : {}),
    customRequestStatus: status,
    requestDetails: {
      description: 'A custom canvas with a personal name and soft colours.',
      productName: 'Personalised Canvas',
      productType: 'canvas_custom_print',
      quantity: 3,
    },
  });
  return { id: record._id.toString() };
}

function submitOffer(
  requestId: string,
  cookie: string,
  categoryId = new mongoose.Types.ObjectId().toString(),
) {
  return request(app)
    .post(`/api/admin/messages/${requestId}/custom-offer`)
    .set(CSRF_HEADER)
    .set('Cookie', cookie)
    .field('title', 'Personalised Canvas')
    .field(
      'description',
      'A canvas made to the customer specifications and approved mockup.',
    )
    .field('categoryId', categoryId)
    .field('productType', 'canvas_custom_print')
    .field('size', '20 x 30 cm')
    .field('colours', 'Lavender and cream')
    .field('materials', 'Cotton canvas')
    .field('personalisation', 'Name on the lower edge')
    .field('additionalInstructions', 'Use a matte finish')
    .field('agreedQuantity', '3')
    .field('agreedPriceMinor', '4599')
    .field('currency', 'GBP')
    .field(
      'expiresAt',
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .attach('file', PNG, {
      filename: 'private-mockup.png',
      contentType: 'image/png',
    });
}
