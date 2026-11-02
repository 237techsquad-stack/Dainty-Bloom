import bcrypt from 'bcryptjs';
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

const { deliverContactEnquiryEmailMock } = vi.hoisted(() => ({
  deliverContactEnquiryEmailMock: vi.fn(),
}));
const { detectFileTypeMock } = vi.hoisted(() => ({
  detectFileTypeMock: vi.fn(),
}));
const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
}));

vi.mock('../src/services/contactEmail.service', () => ({
  deliverContactEnquiryEmail: deliverContactEnquiryEmailMock,
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));
vi.mock('../src/utils/fileType', () => ({
  detectFileType: detectFileTypeMock,
}));

import { env } from '../src/config/env';
import { app } from '../src/app';
import { AppError } from '../src/utils/AppError';
import {
  ArtworkAsset,
  AuditEvent,
  Message,
  SiteSettings,
  User,
} from '../src/models';
import { getStorageDriver } from '../src/services/storage';
import { resetSmtpTransport } from '../src/services/mailer/smtpTransport';
import {
  createMessageToken,
  deleteContactMessage,
  verifyMessageToken,
} from '../src/services/message.service';

const CSRF_HEADER = { 'X-Requested-With': 'dainty-bloom' };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

let mongo: MongoMemoryServer;
let addressIndex = 1;

beforeAll(async () => {
  app.set('trust proxy', 1);
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    ArtworkAsset.init(),
    AuditEvent.init(),
    Message.init(),
    SiteSettings.init(),
    User.init(),
  ]);
});

beforeEach(() => {
  env.NODE_ENV = 'test';
  resetSmtpTransport();
  createTransportMock.mockReturnValue({ sendMail: sendMailMock });
  sendMailMock.mockResolvedValue({ messageId: 'private-provider-response' });
  deliverContactEnquiryEmailMock.mockResolvedValue(undefined);
  detectFileTypeMock.mockImplementation(async (buffer: Buffer) =>
    buffer.equals(PNG) ? { mime: 'image/png' } : undefined,
  );
});

afterEach(async () => {
  const assets = await ArtworkAsset.find().select('+storageKey');
  await Promise.all(
    assets.map((asset) => getStorageDriver().delete(asset.storageKey)),
  );
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
  vi.clearAllMocks();
  env.NODE_ENV = 'test';
  resetSmtpTransport();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('message intake workflows', () => {
  it('rejects custom requests from guests while keeping ordinary messages public', async () => {
    const guestResponse = await postMessage({
      name: 'Guest Requester',
      email: 'guest@example.test',
      subject: 'Custom product request',
      message: 'A sufficiently detailed custom product request.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'custom_3d_request',
      requestDetails: JSON.stringify({
        description: 'A sufficiently detailed custom product request.',
      }),
    });

    expect(guestResponse.status).toBe(401);
    expect(guestResponse.body.error.code).toBe('UNAUTHENTICATED');
    expect(await Message.countDocuments()).toBe(0);

    const ordinaryMessage = await postMessage({
      name: 'Guest Contact',
      email: 'contact@example.test',
      subject: 'A regular contact message',
      message: 'Please answer my general enquiry.',
      token: createMessageToken(Date.now() - 3_001),
    });
    expect(ordinaryMessage.status).toBe(200);
    expect(await Message.countDocuments({ type: 'general' })).toBe(1);
  });

  it('retains message artwork that participates in supersession history', async () => {
    const actor = await User.create({
      name: 'Test Administrator',
      email: 'supersession-admin@example.test',
      passwordHash: await bcrypt.hash('test-only-password', env.BCRYPT_COST),
      role: 'admin',
    });
    const message = await Message.create({
      name: 'History Customer',
      email: 'history@example.test',
      subject: 'Artwork history',
      body: 'Keep the referenced artwork history.',
      type: 'custom_3d_request',
    });
    const artwork = await ArtworkAsset.create({
      sessionId: 'message-supersession-test',
      storageKey: '2026/10/29/123e4567-e89b-42d3-a456-426614174000.png',
      storageDriver: 'local',
      originalFilename: 'reference.png',
      detectedMimeType: 'image/png',
      sizeBytes: PNG.byteLength,
      checksum: 'a'.repeat(64),
      message: message._id,
      supersedes: new mongoose.Types.ObjectId(),
    });
    message.attachment = artwork._id;
    await message.save();

    await deleteContactMessage(message._id.toString(), actor);

    await expect(
      ArtworkAsset.exists({ _id: artwork._id }),
    ).resolves.not.toBeNull();
    await expect(Message.exists({ _id: message._id })).resolves.toBeNull();
  });

  it('sends a bulk-quote acknowledgement to the customer in production', async () => {
    env.NODE_ENV = 'production';

    const response = await postMessage({
      name: 'Quote Customer',
      email: 'quote-customer@example.test',
      subject: 'Custom print quote',
      message: 'Please provide a quote for a custom printed banner.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'bulk_quote',
    });

    expect(response.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: env.SMTP_FROM,
        to: 'quote-customer@example.test',
        subject: 'We received your bulk quote request',
        text: expect.stringContaining('We received it and will review it.'),
      }),
    );
    expect(deliverContactEnquiryEmailMock).not.toHaveBeenCalled();
  });

  it('acquires a signed token using the standard success envelope', async () => {
    const response = await client().get('/api/messages/token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { issuedAt: expect.any(String), token: expect.any(String) },
    });
    expect(
      verifyMessageToken(
        response.body.data.token,
        Date.parse(response.body.data.issuedAt) + 3_001,
      ),
    ).toBe(true);
  });

  it('enforces token issue delay and expiry', () => {
    const now = Date.now();
    const fresh = createMessageToken(now);
    const expired = createMessageToken(now - 10 * 60 * 1000 - 1);
    const oldEnough = createMessageToken(now - 3_001);

    expect(verifyMessageToken(fresh, now)).toBe(false);
    expect(verifyMessageToken(expired, now)).toBe(false);
    expect(verifyMessageToken(oldEnough, now)).toBe(true);
  });

  it('returns a structured rate-limit error without increasing the limit', async () => {
    const ip = nextAddress();
    let lastResponse: request.Response | undefined;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      lastResponse = await request(app)
        .get('/api/messages/token')
        .set('X-Forwarded-For', ip);
    }

    expect(lastResponse?.status).toBe(429);
    expect(lastResponse?.body.error.code).toBe('RATE_LIMITED');
  });

  it('rejects expired submission tokens', async () => {
    const response = await postMessage({
      name: 'Sample Customer',
      email: 'customer@example.test',
      subject: 'A sample question',
      message: 'A message that is long enough.',
      token: createMessageToken(Date.now() - 11 * 60 * 1000),
      type: 'general',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MESSAGE_TOKEN_INVALID');
    expect(await Message.countDocuments()).toBe(0);
  });

  it('rejects invalid form fields before persistence', async () => {
    const response = await postMessage({
      name: '',
      email: 'not-an-email',
      subject: 'x',
      message: 'short',
      token: createMessageToken(Date.now() - 3_001),
      type: 'general',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Message.countDocuments()).toBe(0);
  });

  it('stores a general enquiry and reports successful email delivery', async () => {
    const response = await postMessage({
      name: 'Sample Customer',
      email: 'customer@example.test',
      orderNumber: 'DB-TEST-100',
      subject: 'Question about an order',
      message: 'Please let me know the status of my order.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'general',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(
      await Message.findOne({ email: 'customer@example.test' }),
    ).toMatchObject({
      orderNumber: 'DB-TEST-100',
      emailDeliveryStatus: 'sent',
    });
    expect(deliverContactEnquiryEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'customer@example.test',
        subject: 'Question about an order',
      }),
    );
  });

  it('does not duplicate a saved enquiry when the same submission is repeated', async () => {
    const fields = {
      name: 'Sample Customer',
      email: 'customer@example.test',
      subject: 'Idempotent contact submission',
      message: 'Please keep this enquiry as a single saved message.',
      submissionId: '37c87063-1ab2-4c85-9430-f28bd7aeb454',
      token: createMessageToken(Date.now() - 3_001),
      type: 'general',
    };

    const first = await postMessage(fields);
    const second = await postMessage({
      ...fields,
      token: createMessageToken(Date.now() - 3_001),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(
      await Message.countDocuments({ submissionId: fields.submissionId }),
    ).toBe(1);
    expect(deliverContactEnquiryEmailMock).toHaveBeenCalledTimes(1);
  });

  it('retries a failed delivery against the original enquiry without creating a duplicate', async () => {
    const fields = {
      name: 'Sample Customer',
      email: 'customer@example.test',
      subject: 'Retry contact submission',
      message: 'Please retry delivery without creating another message.',
      submissionId: '10e9d942-5212-46ac-9a52-5329bbec2dd2',
      type: 'general',
    };
    deliverContactEnquiryEmailMock.mockRejectedValueOnce(
      new AppError(
        'The enquiry was saved, but email delivery could not be confirmed.',
        503,
        'CONTACT_EMAIL_DELIVERY_FAILED',
      ),
    );
    const first = await postMessage({
      ...fields,
      token: createMessageToken(Date.now() - 3_001),
    });
    const retry = await postMessage({
      ...fields,
      token: createMessageToken(Date.now() - 3_001),
    });

    expect(first.status).toBe(503);
    expect(retry.status).toBe(200);
    expect(
      await Message.countDocuments({ submissionId: fields.submissionId }),
    ).toBe(1);
    expect(
      await Message.findOne({ submissionId: fields.submissionId }).select(
        'emailDeliveryStatus',
      ),
    ).toMatchObject({ emailDeliveryStatus: 'sent' });
    expect(deliverContactEnquiryEmailMock).toHaveBeenCalledTimes(2);
  });

  it('stores the enquiry and returns a non-success error when delivery fails', async () => {
    deliverContactEnquiryEmailMock.mockRejectedValueOnce(
      new AppError(
        'The enquiry was saved, but email delivery could not be confirmed.',
        503,
        'CONTACT_EMAIL_DELIVERY_FAILED',
      ),
    );

    const response = await postMessage({
      name: 'Sample Customer',
      email: 'customer@example.test',
      subject: 'Delivery failure test',
      message: 'Please keep this enquiry even when SMTP is unavailable.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'general',
    });

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('CONTACT_EMAIL_DELIVERY_FAILED');
    expect(JSON.stringify(response.body)).not.toContain('stack');
    expect(
      await Message.findOne({ subject: 'Delivery failure test' }),
    ).toMatchObject({
      emailDeliveryStatus: 'failed',
    });
  });

  it('persists all custom 3D details and keeps the request out of general email', async () => {
    const neededByDate = '2027-06-30';
    const response = await postCustomMessage({
      name: 'Design Customer',
      email: 'designer@example.test',
      subject: 'Custom 3D design request',
      message: 'A detailed description of the requested 3D item.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'custom_3d_request',
      requestDetails: JSON.stringify({
        description: 'A detailed description of the requested 3D item.',
        approximateSize: '12 cm tall',
        preferredColour: 'Lavender',
        preferredMaterial: 'PLA',
        quantity: '2',
        neededByDate,
      }),
    });
    expect(response.status).toBe(200);
    const message = await Message.findOne({
      type: 'custom_3d_request',
    }).lean();
    expect(message).toMatchObject({
      name: 'Design Customer',
      email: 'designer@example.test',
      emailDeliveryStatus: 'not_required',
      requestDetails: {
        description: 'A detailed description of the requested 3D item.',
        approximateSize: '12 cm tall',
        preferredColour: 'Lavender',
        preferredMaterial: 'PLA',
        quantity: 2,
      },
    });
    expect(message?.requestDetails?.neededByDate?.toISOString()).toContain(
      neededByDate,
    );
    expect(deliverContactEnquiryEmailMock).not.toHaveBeenCalled();
  });

  it('links authenticated custom requests to the verified account, not submitted identity', async () => {
    const cookie = await createCustomerCookie(
      'Account Customer',
      'account-customer@example.test',
    );
    const response = await postMessage({
      name: 'Forged Name',
      email: 'forged@example.test',
      subject: 'Custom request account binding',
      message: 'A sufficiently detailed request for account binding.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'custom_3d_request',
      requestDetails: JSON.stringify({
        description: 'A sufficiently detailed request for account binding.',
        productName: 'Account-bound product',
        productType: 'Other',
        otherProductType: 'Test item',
      }),
    })
      .set('Cookie', cookie)
      .field('customerId', new mongoose.Types.ObjectId().toString());

    expect(response.status).toBe(400);
    expect(await Message.countDocuments()).toBe(0);

    const validResponse = await postMessage({
      name: 'Forged Name',
      email: 'forged@example.test',
      subject: 'Custom request account binding',
      message: 'A sufficiently detailed request for account binding.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'custom_3d_request',
      requestDetails: JSON.stringify({
        description: 'A sufficiently detailed request for account binding.',
        productName: 'Account-bound product',
        productType: 'Other',
        otherProductType: 'Test item',
      }),
    }).set('Cookie', cookie);
    expect(validResponse.status).toBe(200);
    await expect(
      Message.findOne({ subject: 'Custom request account binding' }).lean(),
    ).resolves.toMatchObject({
      customerId: expect.any(mongoose.Types.ObjectId),
      name: 'Account Customer',
      email: 'account-customer@example.test',
      customRequestStatus: 'submitted',
    });
  });

  it('restricts customer request history and details to the owning account', async () => {
    const customerA = await createCustomerCookie(
      'Customer A',
      'customer-a@example.test',
    );
    const customerB = await createCustomerCookie(
      'Customer B',
      'customer-b@example.test',
    );
    const customerBToken = customerB.split('=')[1] ?? '';
    const customerBId = (jwt.decode(customerBToken) as jwt.JwtPayload).sub;
    const requestB = await Message.create({
      name: 'Customer B',
      email: 'customer-b@example.test',
      subject: 'Private request B',
      body: 'A private custom request belonging to customer B.',
      type: 'custom_3d_request',
      customerId: new mongoose.Types.ObjectId(customerBId),
      requestDetails: {
        description: 'A private custom request description.',
      },
    });

    const ownList = await client()
      .get('/api/messages/custom-requests')
      .set('Cookie', customerA);
    const otherDetail = await client()
      .get(`/api/messages/custom-requests/${requestB.id}`)
      .set('Cookie', customerA);
    const otherAttachment = await client()
      .get(`/api/messages/custom-requests/${requestB.id}/attachment`)
      .set('Cookie', customerA);
    const otherMutation = await client()
      .post(`/api/admin/messages/${requestB.id}/custom-request-lifecycle`)
      .set('Cookie', customerA)
      .set(CSRF_HEADER)
      .send({ status: 'accepted' });

    expect(ownList.status).toBe(200);
    expect(ownList.body.data.requests).toEqual([]);
    expect(otherDetail.status).toBe(404);
    expect(otherAttachment.status).toBe(404);
    expect(otherMutation.status).toBe(403);
    expect(customerB).toBeTruthy();
  });

  it('allows admins to accept requests and rejects non-admin lifecycle changes', async () => {
    enableTestSmtp();
    const customer = await User.create({
      name: 'Request Customer',
      email: 'request-customer@example.test',
      passwordHash: await bcrypt.hash('test-only-password', env.BCRYPT_COST),
      role: 'customer',
    });
    const message = await Message.create({
      name: customer.name,
      email: customer.email,
      subject: 'Acceptable custom request',
      body: 'A custom request that can be accepted.',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'submitted',
      requestDetails: { description: 'A custom request requiring review.' },
    });
    const customerCookie = createAccessCookie(customer);
    const forbidden = await client()
      .post(`/api/admin/messages/${message.id}/custom-request-lifecycle`)
      .set('Cookie', customerCookie)
      .set(CSRF_HEADER)
      .send({ status: 'accepted' });
    expect(forbidden.status).toBe(403);

    const adminCookie = await createAdminCookie();
    const accepted = await client()
      .post(`/api/admin/messages/${message.id}/custom-request-lifecycle`)
      .set('Cookie', adminCookie)
      .set(CSRF_HEADER)
      .send({ status: 'accepted', message: 'We can make this item.' });

    expect(accepted.status).toBe(200);
    expect(accepted.body.data.message.customRequestStatus).toBe('accepted');
    expect(accepted.body.data.message.customRequestResponses).toMatchObject([
      {
        status: 'accepted',
        message: 'We can make this item.',
        notificationStatus: 'sent',
      },
    ]);
    expect(
      await Message.findById(message._id).select('customRequestStatus'),
    ).toMatchObject({
      customRequestStatus: 'accepted',
    });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: customer.email }),
    );
  });

  it('requires a decline reason and records failed notification delivery accurately', async () => {
    enableTestSmtp();
    const customer = await User.create({
      name: 'Decline Customer',
      email: 'decline-customer@example.test',
      passwordHash: await bcrypt.hash('test-only-password', env.BCRYPT_COST),
      role: 'customer',
    });
    const message = await Message.create({
      name: customer.name,
      email: customer.email,
      subject: 'Declined custom request',
      body: 'A custom request that needs a reason.',
      type: 'custom_3d_request',
      customerId: customer._id,
      customRequestStatus: 'under_review',
      requestDetails: { description: 'A custom request requiring review.' },
    });
    const adminCookie = await createAdminCookie();
    const missingReason = await client()
      .post(`/api/admin/messages/${message.id}/custom-request-lifecycle`)
      .set('Cookie', adminCookie)
      .set(CSRF_HEADER)
      .send({ status: 'declined' });
    expect(missingReason.status).toBe(400);
    expect(
      await Message.findById(message._id).select('customRequestStatus'),
    ).toMatchObject({
      customRequestStatus: 'under_review',
    });

    sendMailMock.mockRejectedValueOnce(new Error('synthetic mail failure'));
    const declined = await client()
      .post(`/api/admin/messages/${message.id}/custom-request-lifecycle`)
      .set('Cookie', adminCookie)
      .set(CSRF_HEADER)
      .send({
        status: 'declined',
        message: 'We cannot produce this item at the requested size.',
      });

    expect(declined.status).toBe(200);
    expect(declined.body.data.message.customRequestStatus).toBe('declined');
    expect(declined.body.data.message.customRequestResponses[0]).toMatchObject({
      status: 'declined',
      message: 'We cannot produce this item at the requested size.',
      notificationStatus: 'failed',
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('keeps historical custom requests without customer IDs visible to admins only', async () => {
    const historical = await Message.create({
      name: 'Historical Customer',
      email: 'historical@example.test',
      subject: 'Historical custom request',
      body: 'An older request with no account link.',
      type: 'custom_3d_request',
      requestDetails: {
        description: 'An older request with no account link.',
      },
    });
    const adminCookie = await createAdminCookie();
    const adminDetail = await client()
      .get(`/api/admin/messages/${historical.id}`)
      .set('Cookie', adminCookie);
    const customerCookie = await createCustomerCookie();
    const customerList = await client()
      .get('/api/messages/custom-requests')
      .set('Cookie', customerCookie);

    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.data.message.customer).toBeNull();
    expect(adminDetail.body.data.message.customRequestStatus).toBe('submitted');
    expect(customerList.status).toBe(200);
    expect(customerList.body.data.requests).toEqual([]);
  });

  it('persists custom product details and image purpose for staff review', async () => {
    const response = await postCustomMessage({
      name: 'Design Customer',
      email: 'designer@example.test',
      subject: 'Custom product request: Painted tote bag',
      message: 'A painted tote bag with a lavender floral design for a gift.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'custom_3d_request',
      imagePurpose: 'no_image',
      requestDetails: JSON.stringify({
        description:
          'A painted tote bag with a lavender floral design for a gift.',
        productName: 'Painted tote bag',
        productType: 'Other',
        otherProductType: 'Personalised tote bag',
        phone: '+44 7000 000000',
        approximateSize: 'About 35 cm wide',
        preferredColour: 'Lavender',
        preferredMaterial: 'Cotton canvas',
        budget: 'Around GBP 25',
        quantity: '2',
      }),
    });

    expect(response.status).toBe(200);
    const message = await Message.findOne({
      subject: 'Custom product request: Painted tote bag',
    }).lean();
    expect(message?.requestDetails).toMatchObject({
      productName: 'Painted tote bag',
      productType: 'Other',
      otherProductType: 'Personalised tote bag',
      phone: '+44 7000 000000',
      imagePurpose: 'no_image',
      budget: 'Around GBP 25',
      quantity: 2,
    });
    expect(message?.requestDetails?.description).toContain('lavender floral');
    expect(deliverContactEnquiryEmailMock).not.toHaveBeenCalled();
  });

  it('requires a purpose when a custom request includes an image', async () => {
    const cookie = await createCustomerCookie(
      'Design Customer',
      'designer@example.test',
    );
    const response = await postMessage({
      name: 'Design Customer',
      email: 'designer@example.test',
      subject: 'Custom product request',
      message: 'A sufficiently detailed request for a custom product.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'custom_3d_request',
      imagePurpose: 'no_image',
      requestDetails: JSON.stringify({
        description: 'A sufficiently detailed request for a custom product.',
      }),
    })
      .set('Cookie', cookie)
      .attach('referenceImage', Buffer.from('not an image'), {
        filename: 'reference.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IMAGE_PURPOSE_MISMATCH');
    expect(await Message.countDocuments()).toBe(0);
  });

  it('rejects invalid request details', async () => {
    const response = await postCustomMessage({
      name: 'Design Customer',
      email: 'designer@example.test',
      subject: 'Custom 3D design request',
      message: 'A description that is too short.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'custom_3d_request',
      requestDetails: JSON.stringify({ description: 'Too short.' }),
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Message.countDocuments()).toBe(0);
  });

  it('rejects reference images whose contents are not a supported image', async () => {
    const cookie = await createCustomerCookie(
      'Design Customer',
      'designer@example.test',
    );
    const response = await postMessage({
      name: 'Design Customer',
      email: 'designer@example.test',
      subject: 'Custom 3D design request',
      message: 'A sufficiently detailed custom 3D request.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'custom_3d_request',
      requestDetails: JSON.stringify({
        description: 'A sufficiently detailed custom 3D request.',
      }),
    })
      .set('Cookie', cookie)
      .attach('referenceImage', Buffer.from('not an image'), {
        filename: 'reference.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('FILE_CORRUPT');
    expect(await Message.countDocuments()).toBe(0);
  });

  it('rejects oversized reference images before processing the request', async () => {
    const oversizedFile = Buffer.alloc(env.UPLOAD_MAX_BYTES + 1);
    const cookie = await createCustomerCookie(
      'Design Customer',
      'designer@example.test',
    );
    const response = await postMessage({
      name: 'Design Customer',
      email: 'designer@example.test',
      subject: 'Custom 3D design request',
      message: 'A sufficiently detailed custom 3D request.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'custom_3d_request',
      requestDetails: JSON.stringify({
        description: 'A sufficiently detailed custom 3D request.',
      }),
    })
      .set('Cookie', cookie)
      .attach('referenceImage', oversizedFile, {
        filename: 'large.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('FILE_TOO_LARGE');
    expect(await Message.countDocuments()).toBe(0);
  });

  it('keeps message lists and private attachment downloads behind staff authorization', async () => {
    const message = await Message.create({
      name: 'Private Customer',
      email: 'private@example.test',
      subject: 'Private request',
      body: 'A private request body.',
      type: 'custom_3d_request',
      requestDetails: {
        description: 'A private request description.',
      },
    });

    const listResponse = await client().get('/api/admin/messages');
    const attachmentResponse = await client().get(
      `/api/admin/messages/${message.id}/attachment`,
    );

    expect(listResponse.status).toBe(401);
    expect(attachmentResponse.status).toBe(401);
  });

  it('makes saved design requests and their private images available to authorised staff', async () => {
    const customerCookie = await createCustomerCookie(
      'Design Customer',
      'designer@example.test',
    );
    const submission = await postMessage({
      name: 'Design Customer',
      email: 'designer@example.test',
      subject: 'Custom product request: Illustrated mug',
      message: 'A detailed description of an illustrated custom mug.',
      token: createMessageToken(Date.now() - 3_001),
      type: 'custom_3d_request',
      imagePurpose: 'reference',
      requestDetails: JSON.stringify({
        description: 'A detailed description of an illustrated custom mug.',
        productName: 'Illustrated mug',
        productType: 'Mug or drinkware',
        phone: '+44 7000 000000',
        approximateSize: '12 cm tall',
        preferredColour: 'Lavender',
        preferredMaterial: 'PLA',
        budget: 'GBP 20',
        quantity: '2',
        neededByDate: '2027-06-30',
      }),
    })
      .set('Cookie', customerCookie)
      .attach('referenceImage', PNG, {
        filename: 'reference.png',
        contentType: 'image/png',
      });
    expect(submission.status).toBe(200);

    const savedMessage = await Message.findOne({
      type: 'custom_3d_request',
    }).select('attachment customerId');
    expect(savedMessage?.attachment).toBeTruthy();

    const admin = await User.create({
      name: 'Test Administrator',
      email: 'admin@example.test',
      passwordHash: await bcrypt.hash('test-only-password', env.BCRYPT_COST),
      role: 'admin',
    });
    const accessToken = jwt.sign(
      { sub: admin.id, ver: 0, typ: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' },
    );
    const cookie = `daintyAccessToken=${accessToken}`;

    const listResponse = await client()
      .get('/api/admin/messages?type=custom_3d_request')
      .set('Cookie', cookie);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.items[0]).toMatchObject({
      type: 'custom_3d_request',
      requestDetails: {
        description: 'A detailed description of an illustrated custom mug.',
        productName: 'Illustrated mug',
        productType: 'Mug or drinkware',
        phone: '+44 7000 000000',
        imagePurpose: 'reference',
        approximateSize: '12 cm tall',
        preferredColour: 'Lavender',
        preferredMaterial: 'PLA',
        budget: 'GBP 20',
        quantity: 2,
      },
      hasAttachment: true,
    });

    const detailResponse = await client()
      .get(`/api/admin/messages/${savedMessage?.id}`)
      .set('Cookie', cookie);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.message.requestDetails.imagePurpose).toBe(
      'reference',
    );
    expect(detailResponse.body.data.message.attachment.originalFilename).toBe(
      'reference.png',
    );

    const downloadResponse = await client()
      .get(`/api/admin/messages/${savedMessage?.id}/attachment`)
      .set('Cookie', cookie);
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers['content-type']).toContain('image/png');
    expect(Buffer.from(downloadResponse.body)).toEqual(PNG);

    const ownRequest = await client()
      .get(`/api/messages/custom-requests/${savedMessage?.id}`)
      .set('Cookie', customerCookie);
    const ownAttachment = await client()
      .get(`/api/messages/custom-requests/${savedMessage?.id}/attachment`)
      .set('Cookie', customerCookie);
    const anotherCustomer = await createCustomerCookie(
      'Another Customer',
      'another@example.test',
    );
    const forbiddenAttachment = await client()
      .get(`/api/messages/custom-requests/${savedMessage?.id}/attachment`)
      .set('Cookie', anotherCustomer);

    expect(ownRequest.status).toBe(200);
    expect(ownRequest.body.data.request.attachment.originalFilename).toBe(
      'reference.png',
    );
    expect(ownAttachment.status).toBe(200);
    expect(ownAttachment.headers['content-disposition']).toContain('inline');
    expect(Buffer.from(ownAttachment.body)).toEqual(PNG);
    expect(forbiddenAttachment.status).toBe(404);
  });
});

function nextAddress(): string {
  const address = `192.0.2.${addressIndex}`;
  addressIndex = (addressIndex % 250) + 1;
  return address;
}

function client() {
  return {
    get(path: string) {
      return request(app).get(path).set('X-Forwarded-For', nextAddress());
    },
    post(path: string) {
      return request(app).post(path).set('X-Forwarded-For', nextAddress());
    },
  };
}

function postMessage(fields: Record<string, string>) {
  const test = client().post('/api/messages').set(CSRF_HEADER);
  for (const [name, value] of Object.entries(fields)) {
    test.field(name, value);
  }
  return test;
}

async function postCustomMessage(fields: Record<string, string>) {
  const cookie = await createCustomerCookie(
    fields.name ?? 'Test Customer',
    fields.email ?? 'test-customer@example.test',
  );
  return postMessage(fields).set('Cookie', cookie);
}

async function createCustomerCookie(
  name = 'Test Customer',
  email = 'test-customer@example.test',
): Promise<string> {
  const user = await User.create({
    name,
    email,
    passwordHash: await bcrypt.hash('test-only-password', env.BCRYPT_COST),
    role: 'customer',
  });
  return createAccessCookie(user);
}

function createAccessCookie(user: {
  id: string;
  tokenVersion: number;
}): string {
  const accessToken = jwt.sign(
    { sub: user.id, ver: user.tokenVersion, typ: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' },
  );
  return `daintyAccessToken=${accessToken}`;
}

function enableTestSmtp(): void {
  env.NODE_ENV = 'production';
  env.SMTP_HOST = 'smtp.example.test';
  env.SMTP_FROM = 'notifications@example.test';
  env.CONTACT_RECIPIENT_EMAIL = 'contact@example.test';
  env.SMTP_PORT = 587;
  env.SMTP_SECURE = false;
  env.SMTP_USERNAME = undefined;
  env.SMTP_PASSWORD = undefined;
}

async function createAdminCookie(): Promise<string> {
  const admin = await User.create({
    name: 'Test Administrator',
    email: 'admin@example.test',
    passwordHash: await bcrypt.hash('test-only-password', env.BCRYPT_COST),
    role: 'admin',
  });
  return createAccessCookie(admin);
}
