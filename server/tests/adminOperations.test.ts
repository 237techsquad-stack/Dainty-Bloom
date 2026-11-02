import bcrypt from 'bcryptjs';
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

const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

import { env } from '../src/config/env';
import { app } from '../src/app';
import {
  AuditEvent,
  ArtworkAsset,
  Category,
  Message,
  Order,
  Product,
  Review,
  SiteSettings,
  StaffControl,
  Subscriber,
  User,
} from '../src/models';
import { resetSmtpTransport } from '../src/services/mailer/smtpTransport';

const CSRF_HEADER = { 'X-Requested-With': 'dainty-bloom' };
const PASSWORD = 'a-secure-password-123';
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    AuditEvent.init(),
    ArtworkAsset.init(),
    Category.init(),
    Message.init(),
    Order.init(),
    Product.init(),
    Review.init(),
    SiteSettings.init(),
    StaffControl.init(),
    Subscriber.init(),
    User.init(),
  ]);
});

beforeEach(() => {
  env.NODE_ENV = 'test';
  resetSmtpTransport();
  vi.clearAllMocks();
  createTransportMock.mockReturnValue({ sendMail: sendMailMock });
  sendMailMock.mockResolvedValue({ messageId: 'private-provider-response' });
});

afterEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
  env.NODE_ENV = 'test';
  resetSmtpTransport();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('admin operational workflows', () => {
  it('sends newsletter preferences to the subscriber, not the business recipient', async () => {
    env.NODE_ENV = 'production';
    const response = await request(app)
      .post('/api/newsletter/subscribe')
      .set(CSRF_HEADER)
      .send({
        email: 'subscriber@example.test',
        consent: true,
        source: 'footer',
      });

    expect(response.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const message = sendMailMock.mock.calls[0]?.[0] as {
      to: string;
      from: string;
      subject: string;
      text: string;
    };
    expect(message).toMatchObject({
      from: env.SMTP_FROM,
      to: 'subscriber@example.test',
      subject: 'Newsletter subscription preferences',
    });
    expect(message.text).toContain(
      `${env.API_PUBLIC_URL}/api/newsletter/unsubscribe?token=`,
    );
    expect(response.text).not.toContain('token=');
    expect(
      await Subscriber.findOne({ email: 'subscriber@example.test' }),
    ).toMatchObject({ status: 'subscribed' });
  });

  it('enforces server-side permissions across operations', async () => {
    const unauthenticatedOrders = await request(app).get('/api/admin/orders');
    expect(unauthenticatedOrders.status).toBe(401);
    expect(unauthenticatedOrders.body).toMatchObject({
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
    expect((await request(app).get('/api/admin/customers')).status).toBe(401);
    expect((await request(app).get('/api/admin/settings')).status).toBe(401);
    expect(
      (await request(app).get('/api/admin/orders/print-queue')).status,
    ).toBe(401);

    const customerCookie = await signIn('customer');
    const supportCookie = await signIn('support');
    const productionCookie = await signIn('production');

    expect(
      (
        await request(app)
          .get('/api/admin/orders')
          .set('Cookie', customerCookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/admin/artwork')
          .set('Cookie', supportCookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/admin/settings')
          .set('Cookie', supportCookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/admin/reviews')
          .set('Cookie', productionCookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/admin/orders/${new mongoose.Types.ObjectId()}/status`)
          .set('Cookie', supportCookie)
          .set(CSRF_HEADER)
          .send({ status: 'in_printing' })
      ).status,
    ).toBe(403);
  });

  it('returns an empty print queue with pagination for an authorized admin', async () => {
    const cookie = await signIn('admin');
    const response = await request(app)
      .get('/api/admin/orders/print-queue?page=1&limit=25')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        items: [],
        pagination: {
          page: 1,
          limit: 25,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
        },
      },
    });
  });

  it('returns an empty order list successfully for an authorized admin', async () => {
    const cookie = await signIn('admin');
    const response = await request(app)
      .get('/api/admin/orders?tab=all&page=1&limit=25')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        items: [],
        pagination: {
          page: 1,
          limit: 25,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
        },
      },
    });
  });

  it('updates message status through the existing staff workflow', async () => {
    const cookie = await signIn('support');
    const message = await Message.create({
      name: 'Message Customer',
      email: 'message@example.test',
      subject: 'A status workflow test',
      body: 'A customer message for the admin workflow.',
      type: 'general',
      status: 'new',
    });

    const response = await request(app)
      .patch(`/api/admin/messages/${message._id}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ status: 'resolved' });

    expect(response.status).toBe(200);
    expect(response.body.data.message.status).toBe('resolved');
    expect((await Message.findById(message._id))?.status).toBe('resolved');
  });

  it('allows artwork review decisions only while each asset is pending', async () => {
    const cookie = await signIn('admin');
    const approvedArtwork = await createArtworkAsset();
    const approved = await request(app)
      .patch(`/api/admin/artwork/${approvedArtwork.id}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'approved' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.artwork.reviewStatus).toBe('approved');

    const repeatApproval = await request(app)
      .patch(`/api/admin/artwork/${approvedArtwork.id}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'replacement_requested', note: 'Replace the file.' });
    expect(repeatApproval.status).toBe(409);
    expect(repeatApproval.body.error.code).toBe('ARTWORK_NOT_PENDING');
    expect(
      (await ArtworkAsset.findById(approvedArtwork.id))?.reviewStatus,
    ).toBe('approved');

    const rejectedArtwork = await createArtworkAsset();
    const rejectionWithoutNote = await request(app)
      .patch(`/api/admin/artwork/${rejectedArtwork.id}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'replacement_requested' });
    expect(rejectionWithoutNote.status).toBe(400);
    expect(
      (await ArtworkAsset.findById(rejectedArtwork.id))?.reviewStatus,
    ).toBe('pending');

    const rejected = await request(app)
      .patch(`/api/admin/artwork/${rejectedArtwork.id}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'replacement_requested', note: 'Please replace it.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.artwork.reviewStatus).toBe(
      'replacement_requested',
    );

    const repeatRejection = await request(app)
      .patch(`/api/admin/artwork/${rejectedArtwork.id}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'approved' });
    expect(repeatRejection.status).toBe(409);
    expect(repeatRejection.body.error.code).toBe('ARTWORK_NOT_PENDING');
    expect(
      (await ArtworkAsset.findById(rejectedArtwork.id))?.reviewStatus,
    ).toBe('replacement_requested');

    const missingArtwork = await request(app)
      .patch(`/api/admin/artwork/${new mongoose.Types.ObjectId()}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'approved' });
    expect(missingArtwork.status).toBe(404);
    expect(missingArtwork.body.error.code).toBe('ARTWORK_NOT_FOUND');

    const firstOrderAsset = await createArtworkAsset();
    const secondOrderAsset = await createArtworkAsset();
    const firstOrder = await createProofOrder([
      firstOrderAsset.id,
      secondOrderAsset.id,
    ]);
    await linkOrderArtwork(firstOrder, [
      firstOrderAsset.id,
      secondOrderAsset.id,
    ]);
    const firstItemId = firstOrder.items[0]._id.toString();
    const orderApproval = await request(app)
      .patch(`/api/admin/artwork/${firstOrderAsset.id}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'approved' });
    expect(orderApproval.status).toBe(200);

    const parentAfterApproval = await Order.findById(firstOrder.id);
    const approvedItemPrintStatus =
      parentAfterApproval?.items[0].itemPrintStatus;
    expect(parentAfterApproval?.status).toBe('pending_proof_approval');
    expect(parentAfterApproval?.items[1].itemPrintStatus).toBe(
      'pending_proof_approval',
    );

    const repeatOrderDecision = await request(app)
      .patch(`/api/admin/artwork/${firstOrderAsset.id}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'replacement_requested', note: 'Replace the file.' });
    expect(repeatOrderDecision.status).toBe(409);
    expect(repeatOrderDecision.body.error.code).toBe('ARTWORK_NOT_PENDING');
    expect(
      (await ArtworkAsset.findById(firstOrderAsset.id))?.reviewStatus,
    ).toBe('approved');
    const parentAfterConflict = await Order.findById(firstOrder.id);
    expect(parentAfterConflict?.status).toBe('pending_proof_approval');
    expect(
      parentAfterConflict?.items.find(
        (item) => item._id.toString() === firstItemId,
      )?.itemPrintStatus,
    ).toBe(approvedItemPrintStatus);

    const firstRejectedOrderAsset = await createArtworkAsset();
    const secondRejectedOrderAsset = await createArtworkAsset();
    const rejectedOrder = await createProofOrder([
      firstRejectedOrderAsset.id,
      secondRejectedOrderAsset.id,
    ]);
    await linkOrderArtwork(rejectedOrder, [
      firstRejectedOrderAsset.id,
      secondRejectedOrderAsset.id,
    ]);
    const orderRejection = await request(app)
      .patch(`/api/admin/artwork/${firstRejectedOrderAsset.id}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({
        decision: 'replacement_requested',
        note: 'Please submit a replacement.',
      });
    expect(orderRejection.status).toBe(200);
    const rejectedParent = await Order.findById(rejectedOrder.id);
    expect(rejectedParent?.status).toBe('artwork_rejected');
    expect(rejectedParent?.items[0].itemPrintStatus).toBe('artwork_rejected');

    const repeatRejectedOrderDecision = await request(app)
      .patch(`/api/admin/artwork/${firstRejectedOrderAsset.id}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'approved' });
    expect(repeatRejectedOrderDecision.status).toBe(409);
    expect(
      (await ArtworkAsset.findById(firstRejectedOrderAsset.id))?.reviewStatus,
    ).toBe('replacement_requested');
    const rejectedParentAfterConflict = await Order.findById(rejectedOrder.id);
    expect(rejectedParentAfterConflict?.status).toBe('artwork_rejected');
    expect(rejectedParentAfterConflict?.items[0].itemPrintStatus).toBe(
      'artwork_rejected',
    );
    expect(rejectedParentAfterConflict?.items[1].itemPrintStatus).toBe(
      'pending_proof_approval',
    );

    const missingOrder = await request(app)
      .post(
        `/api/admin/orders/${new mongoose.Types.ObjectId()}/items/${new mongoose.Types.ObjectId()}/proof`,
      )
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'approved' });
    expect(missingOrder.status).toBe(404);
    expect(missingOrder.body.error.code).toBe('ORDER_NOT_FOUND');

    const ineligibleArtwork = await createArtworkAsset();
    const ineligibleOrder = await createProofOrder([ineligibleArtwork.id]);
    await linkOrderArtwork(ineligibleOrder, [ineligibleArtwork.id]);
    ineligibleOrder.status = 'in_printing';
    ineligibleOrder.items[0].itemPrintStatus = 'queued';
    await ineligibleOrder.save();
    const ineligibleDecision = await request(app)
      .patch(`/api/admin/artwork/${ineligibleArtwork.id}/review`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'approved' });
    expect(ineligibleDecision.status).toBe(409);
    expect(ineligibleDecision.body.error.code).toBe(
      'INVALID_ARTWORK_REVIEW_STATE',
    );
    expect(
      (await ArtworkAsset.findById(ineligibleArtwork.id))?.reviewStatus,
    ).toBe('pending');
    const unchangedIneligibleOrder = await Order.findById(ineligibleOrder.id);
    expect(unchangedIneligibleOrder?.status).toBe('in_printing');
    expect(unchangedIneligibleOrder?.items[0].itemPrintStatus).toBe('queued');
  });

  it('limits customer details to the selected safe account and order fields', async () => {
    const cookie = await signIn('admin');
    const customer = await User.create({
      name: 'Private Customer',
      email: 'private@example.test',
      passwordHash: await bcrypt.hash(PASSWORD, env.BCRYPT_COST),
      phone: '+15555550123',
    });
    const detail = await request(app)
      .get(`/api/admin/customers/${customer._id}`)
      .set('Cookie', cookie);

    expect(detail.status).toBe(200);
    expect(detail.body.data.customer).toMatchObject({
      _id: customer._id.toString(),
      email: customer.email,
      name: customer.name,
    });
    expect(JSON.stringify(detail.body.data)).not.toContain('passwordHash');
    expect(JSON.stringify(detail.body.data)).not.toContain('tokenVersion');
  });

  it('returns stable order and item identifiers for production updates', async () => {
    const cookie = await signIn('admin');
    const order = await createOrder('in_printing');
    const queue = await request(app)
      .get('/api/admin/orders/print-queue?q=Queue&page=1&limit=25')
      .set('Cookie', cookie);

    expect(queue.status).toBe(200);
    expect(queue.body.data.items).toHaveLength(1);
    expect(queue.body.data.items[0]).toMatchObject({
      orderId: order._id.toString(),
      itemId: order.items[0]._id.toString(),
      orderNumber: order.orderNumber,
      customerName: 'Queue Customer',
      productTitle: 'Queue test product',
    });
    expect(queue.body.data.pagination).toMatchObject({
      page: 1,
      limit: 25,
      total: 1,
    });

    const filteredQueue = await request(app)
      .get('/api/admin/orders/print-queue?q=no-such-job&page=1&limit=25')
      .set('Cookie', cookie);
    expect(filteredQueue.status).toBe(200);
    expect(filteredQueue.body.data.items).toEqual([]);
    expect(filteredQueue.body.data.pagination.total).toBe(0);

    const updated = await request(app)
      .patch(
        `/api/admin/orders/${order._id}/items/${order.items[0]._id}/print-status`,
      )
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ status: 'printing' });
    expect(updated.status).toBe(200);
    expect((await Order.findById(order._id))?.items[0].itemPrintStatus).toBe(
      'printing',
    );

    const completedProduction = await request(app)
      .patch(
        `/api/admin/orders/${order._id}/items/${order.items[0]._id}/print-status`,
      )
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ status: 'ready' });
    expect(completedProduction.status).toBe(200);
    expect(completedProduction.body.data.order.status).toBe('ready');
    expect((await Order.findById(order._id))?.items[0].itemPrintStatus).toBe(
      'ready',
    );

    const list = await request(app)
      .get('/api/admin/orders')
      .set('Cookie', cookie);
    expect(list.body.data.items[0]).toMatchObject({
      id: order._id.toString(),
      fulfillmentStatus: 'unfulfilled',
      payment: { status: 'paid' },
      itemCount: 2,
    });
  });

  it('rejects order status changes that bypass the configured lifecycle', async () => {
    const cookie = await signIn('admin');
    const order = await createOrder('pending_payment');
    const response = await request(app)
      .patch(`/api/admin/orders/${order._id}/status`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ status: 'completed' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect((await Order.findById(order._id))?.status).toBe('pending_payment');
  });

  it('allows moderation only while a review is pending', async () => {
    const cookie = await signIn('admin');
    const category = await Category.create({ name: 'Review products' });
    const product = await Product.create({
      title: 'Review test product',
      slug: 'review-test-product',
      description: 'A product used for review moderation tests.',
      category: category._id,
      productType: 'tshirt',
      sku: 'REVIEW-TEST-001',
      basePriceMinor: 2500,
    });
    const customer = await User.create({
      name: 'Review Customer',
      email: 'reviewer@example.test',
      passwordHash: await bcrypt.hash(PASSWORD, env.BCRYPT_COST),
    });
    const approvedReview = await Review.create({
      product: product._id,
      user: customer._id,
      rating: 5,
      title: 'A helpful review',
      body: 'This is a sufficiently detailed review for the test.',
      moderationState: 'pending',
    });

    const rejectedWithoutReason = await request(app)
      .patch(`/api/admin/reviews/${approvedReview._id}/moderate`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'rejected' });
    expect(rejectedWithoutReason.status).toBe(400);

    const approved = await request(app)
      .patch(`/api/admin/reviews/${approvedReview._id}/moderate`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'approved' });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({
      id: approvedReview._id.toString(),
      moderationState: 'approved',
    });
    expect((await Review.findById(approvedReview._id))?.moderationState).toBe(
      'approved',
    );

    const repeatedApproval = await request(app)
      .patch(`/api/admin/reviews/${approvedReview._id}/moderate`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'rejected', reason: 'Already approved.' });
    expect(repeatedApproval.status).toBe(409);
    expect(repeatedApproval.body.error.code).toBe('REVIEW_NOT_PENDING');
    expect((await Review.findById(approvedReview._id))?.moderationState).toBe(
      'approved',
    );

    const secondCustomer = await User.create({
      name: 'Another Review Customer',
      email: 'another-reviewer@example.test',
      passwordHash: await bcrypt.hash(PASSWORD, env.BCRYPT_COST),
    });
    const rejectedReview = await Review.create({
      product: product._id,
      user: secondCustomer._id,
      rating: 4,
      title: 'Another helpful review',
      body: 'This is another sufficiently detailed review for the test.',
      moderationState: 'pending',
    });
    const rejected = await request(app)
      .patch(`/api/admin/reviews/${rejectedReview._id}/moderate`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'rejected', reason: 'Does not meet the guidelines.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      id: rejectedReview._id.toString(),
      moderationState: 'rejected',
      moderationReason: 'Does not meet the guidelines.',
    });

    const repeatedRejection = await request(app)
      .patch(`/api/admin/reviews/${rejectedReview._id}/moderate`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'approved' });
    expect(repeatedRejection.status).toBe(409);
    expect(repeatedRejection.body.error.code).toBe('REVIEW_NOT_PENDING');
    expect((await Review.findById(rejectedReview._id))?.moderationState).toBe(
      'rejected',
    );

    const missingReview = await request(app)
      .patch(`/api/admin/reviews/${new mongoose.Types.ObjectId()}/moderate`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ decision: 'approved' });
    expect(missingReview.status).toBe(404);
    expect(missingReview.body.error.code).toBe('REVIEW_NOT_FOUND');
  });

  it('keeps customer review submission limited to verified shipped purchases', async () => {
    const category = await Category.create({
      name: 'Verified review products',
    });
    const product = await Product.create({
      title: 'Verified review test product',
      slug: 'verified-review-test-product',
      description: 'A product used for customer review eligibility tests.',
      category: category._id,
      productType: 'tshirt',
      sku: 'VERIFIED-REVIEW-001',
      basePriceMinor: 2500,
      status: 'active',
    });
    const customer = await signInWithIdentity('customer');
    const body = {
      rating: 5,
      title: 'A verified review',
      body: 'This is a sufficiently detailed verified purchase review.',
    };

    const unauthenticated = await request(app)
      .post(`/api/products/${product.slug}/reviews`)
      .set(CSRF_HEADER)
      .send(body);
    expect(unauthenticated.status).toBe(401);

    const noPurchase = await request(app)
      .get(`/api/products/${product.slug}/reviews/eligibility`)
      .set('Cookie', customer.cookie);
    expect(noPurchase.body.data).toMatchObject({
      canReview: false,
      reason: 'verified_purchase_required',
    });
    const rejected = await request(app)
      .post(`/api/products/${product.slug}/reviews`)
      .set('Cookie', customer.cookie)
      .set(CSRF_HEADER)
      .send(body);
    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe('VERIFIED_PURCHASE_REQUIRED');
    expect(await Review.countDocuments({ product: product._id })).toBe(0);

    const order = await createOrder('in_printing');
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          user: customer.userId,
          status: 'shipped',
          'items.0.product': product._id,
        },
      },
    );
    const eligible = await request(app)
      .get(`/api/products/${product.slug}/reviews/eligibility`)
      .set('Cookie', customer.cookie);
    expect(eligible.body.data).toMatchObject({
      canReview: true,
      reason: null,
    });

    const submitted = await request(app)
      .post(`/api/products/${product.slug}/reviews`)
      .set('Cookie', customer.cookie)
      .set(CSRF_HEADER)
      .send(body);
    expect(submitted.status).toBe(201);
    expect(submitted.body.data).toMatchObject({
      rating: 5,
      title: body.title,
      moderationState: 'pending',
    });

    const duplicate = await request(app)
      .post(`/api/products/${product.slug}/reviews`)
      .set('Cookie', customer.cookie)
      .set(CSRF_HEADER)
      .send(body);
    expect(duplicate.status).not.toBe(201);
    expect(await Review.countDocuments({ product: product._id })).toBe(1);
    const publicReviews = await request(app).get(
      `/api/products/${product.slug}/reviews`,
    );
    expect(publicReviews.body.data.items).toHaveLength(0);
  });

  it('applies a settings patch without resetting unrelated operational fields', async () => {
    const cookie = await signIn('admin');
    await SiteSettings.create({
      key: 'default',
      storeName: 'Dainty Bloom',
      currency: 'GBP',
      shippingFlatMinor: 850,
      taxRateBasisPoints: 1250,
      shippingConfigured: true,
      taxConfigured: true,
      orderCancellationWindowNote: 'Contact the studio promptly.',
    });

    const response = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ aboutNote: 'A custom print studio.' });

    expect(response.status).toBe(200);
    expect(response.body.data.aboutNote).toBe('A custom print studio.');
    expect(response.body.data).toMatchObject({
      shippingFlatMinor: 850,
      taxRateBasisPoints: 1250,
      shippingConfigured: true,
      taxConfigured: true,
    });
    expect(JSON.stringify(response.body.data)).not.toMatch(
      /secret|password|apiKey/i,
    );
  });

  it('prevents staff from changing their own access level', async () => {
    const { cookie, userId } = await signInWithIdentity('admin');
    const response = await request(app)
      .patch(`/api/admin/staff/${userId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ role: 'support' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SELF_STAFF_CHANGE_FORBIDDEN');
  });

  it('returns stable staff IDs for DataTable rows', async () => {
    const { cookie, userId } = await signInWithIdentity('admin');
    const response = await request(app)
      .get('/api/admin/staff')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    const ids = response.body.data.items.map(
      (staff: { id: string }) => staff.id,
    );
    expect(ids).toContain(userId);
    expect(ids.every((id: string) => mongoose.isValidObjectId(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect((await User.findById(userId))?.role).toBe('admin');
  });
});

async function signIn(
  role: 'admin' | 'customer' | 'production' | 'support',
): Promise<string> {
  return (await signInWithIdentity(role)).cookie;
}

async function signInWithIdentity(
  role: 'admin' | 'customer' | 'production' | 'support',
): Promise<{ cookie: string; userId: string }> {
  const email = `${role}-${Math.random().toString(36).slice(2)}@example.test`;
  const user = await User.create({
    name: 'Admin Workflow Test User',
    email,
    passwordHash: await bcrypt.hash(PASSWORD, env.BCRYPT_COST),
    role,
  });
  const response = await request(app)
    .post('/api/auth/login')
    .set(CSRF_HEADER)
    .send({
      email,
      password: PASSWORD,
      portal: role === 'customer' ? 'customer' : 'admin',
    });
  if (response.status !== 200) {
    throw new Error(`Test user login failed with status ${response.status}`);
  }
  const cookies = response.headers['set-cookie'];
  if (!Array.isArray(cookies))
    throw new Error('Login did not set auth cookies');
  return {
    userId: user._id.toString(),
    cookie: cookies
      .filter(
        (cookie) =>
          /^(daintyAccessToken|daintyRefreshToken)=/.test(cookie) &&
          cookie.split(';')[0].length > cookie.split(';')[0].indexOf('=') + 1,
      )
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
  };
}

async function createOrder(status: 'in_printing' | 'pending_payment') {
  const address = {
    line1: '123 Example Street',
    city: 'Example City',
    state: 'Example State',
    postalCode: '12345',
    country: 'US',
  };
  return Order.create({
    orderNumber: `DB-QUEUE-${Math.random().toString(36).slice(2, 10)}`,
    contactSnapshot: { name: 'Queue Customer', email: 'queue@example.test' },
    shippingAddress: address,
    billingAddress: address,
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        titleSnapshot: 'Queue test product',
        skuSnapshot: 'QUEUE-001',
        quantity: 2,
        unitPriceMinor: 1500,
        lineTotalMinor: 3000,
        itemPrintStatus: 'queued',
        requiresProof: false,
      },
    ],
    subtotalMinor: 3000,
    totalMinor: 3000,
    currency: 'USD',
    payment: { status: 'paid' },
    status,
  });
}

async function createArtworkAsset() {
  const artwork = await ArtworkAsset.create({
    storageKey: `tests/${new mongoose.Types.ObjectId().toString()}.png`,
    storageDriver: 'local',
    originalFilename: 'artwork.png',
    detectedMimeType: 'image/png',
    sizeBytes: 128,
    checksum: new mongoose.Types.ObjectId().toString(),
    reviewStatus: 'pending',
  });
  return { id: artwork._id.toString() };
}

async function createProofOrder(artworkIds: string[]) {
  const address = {
    line1: '123 Example Street',
    city: 'Example City',
    state: 'Example State',
    postalCode: '12345',
    country: 'US',
  };
  return Order.create({
    orderNumber: `DB-PROOF-${new mongoose.Types.ObjectId().toString()}`,
    contactSnapshot: { name: 'Proof Customer', email: 'proof@example.test' },
    shippingAddress: address,
    billingAddress: address,
    items: artworkIds.map((artwork, index) => ({
      product: new mongoose.Types.ObjectId(),
      titleSnapshot: `Proof item ${index + 1}`,
      skuSnapshot: `PROOF-${index + 1}`,
      quantity: 1,
      unitPriceMinor: 1000,
      lineTotalMinor: 1000,
      artwork: new mongoose.Types.ObjectId(artwork),
      itemPrintStatus: 'pending_proof_approval',
      requiresProof: true,
    })),
    subtotalMinor: artworkIds.length * 1000,
    totalMinor: artworkIds.length * 1000,
    currency: 'USD',
    payment: { status: 'paid' },
    status: 'pending_proof_approval',
  });
}

async function linkOrderArtwork(
  order: Awaited<ReturnType<typeof createProofOrder>>,
  artworkIds: string[],
) {
  await Promise.all(
    order.items.map((item, index) =>
      ArtworkAsset.updateOne(
        { _id: artworkIds[index] },
        { $set: { order: order._id, orderItemId: item._id } },
      ),
    ),
  );
}
