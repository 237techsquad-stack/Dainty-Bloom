import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createTransportMock, sendMailMock, loggerErrorMock } = vi.hoisted(
  () => ({
    createTransportMock: vi.fn(),
    sendMailMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  }),
);

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));
vi.mock('../src/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { env } from '../src/config/env';
import { deliverContactEnquiryEmail } from '../src/services/contactEmail.service';
import { resetSmtpTransport } from '../src/services/mailer/smtpTransport';

const enquiry = {
  name: 'Sample Customer',
  email: 'customer@example.test',
  orderNumber: 'DB-TEST-101',
  subject: 'Question about an order',
  message: 'Please check the status of my order.',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSmtpTransport();
  sendMailMock.mockResolvedValue({ messageId: 'test-message-id' });
  createTransportMock.mockReturnValue({ sendMail: sendMailMock });
  env.SMTP_HOST = 'smtp.gmail.com';
  env.SMTP_PORT = 587;
  env.SMTP_SECURE = false;
  env.SMTP_USERNAME = 'test-user';
  env.SMTP_PASSWORD = 'test-only-password';
  env.SMTP_FROM = 'info@daintybloome.com';
  env.CONTACT_RECIPIENT_EMAIL = 'recipient@example.test';
});

afterEach(() => {
  env.SMTP_HOST = 'smtp.gmail.com';
  env.SMTP_PORT = 587;
  env.SMTP_SECURE = false;
  env.SMTP_USERNAME = 'test-user';
  env.SMTP_PASSWORD = 'test-only-password';
  env.SMTP_FROM = 'info@daintybloome.com';
  env.CONTACT_RECIPIENT_EMAIL = 'recipient@example.test';
});

describe('contact enquiry email delivery', () => {
  it('sends the enquiry to the configured owner using the configured SMTP transport', async () => {
    await deliverContactEnquiryEmail(enquiry);

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'test-user', pass: 'test-only-password' },
    });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'info@daintybloome.com',
        to: 'recipient@example.test',
        replyTo: 'customer@example.test',
        subject: 'New contact enquiry: Question about an order',
        text: expect.stringContaining('Please check the status of my order.'),
      }),
    );
  });

  it('returns a safe delivery error when the SMTP provider fails', async () => {
    env.SMTP_HOST = 'smtp.gmail.com';
    env.SMTP_PORT = 587;
    env.SMTP_SECURE = false;
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error('private transport detail test-only-password'), {
        code: 'EAUTH',
      }),
    );

    await expect(deliverContactEnquiryEmail(enquiry)).rejects.toMatchObject({
      statusCode: 503,
      code: 'CONTACT_EMAIL_DELIVERY_FAILED',
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
      'test-only-password',
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
      'private transport detail',
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
      enquiry.message,
    );
  });

  it('requires SMTP credentials for Gmail without attempting a connection', async () => {
    env.SMTP_HOST = 'smtp.gmail.com';
    env.SMTP_USERNAME = undefined;
    env.SMTP_PASSWORD = undefined;

    await expect(deliverContactEnquiryEmail(enquiry)).rejects.toMatchObject({
      statusCode: 503,
      code: 'CONTACT_EMAIL_NOT_CONFIGURED',
    });
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('rejects an unapproved sender address for Gmail SMTP', async () => {
    env.SMTP_FROM = 'unverified@example.test';

    await expect(deliverContactEnquiryEmail(enquiry)).rejects.toMatchObject({
      statusCode: 503,
      code: 'CONTACT_EMAIL_NOT_CONFIGURED',
    });
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid Gmail TLS and port combination without connecting', async () => {
    env.SMTP_PORT = 465;
    env.SMTP_SECURE = false;

    await expect(deliverContactEnquiryEmail(enquiry)).rejects.toMatchObject({
      statusCode: 503,
      code: 'CONTACT_EMAIL_NOT_CONFIGURED',
    });
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('reports missing provider configuration instead of pretending delivery succeeded', async () => {
    env.SMTP_HOST = undefined;
    env.SMTP_PORT = undefined;
    env.SMTP_SECURE = undefined;
    env.SMTP_USERNAME = undefined;
    env.SMTP_PASSWORD = undefined;
    env.SMTP_FROM = undefined;
    env.CONTACT_RECIPIENT_EMAIL = undefined;

    await expect(deliverContactEnquiryEmail(enquiry)).rejects.toMatchObject({
      statusCode: 503,
      code: 'CONTACT_EMAIL_NOT_CONFIGURED',
    });
    expect(createTransportMock).not.toHaveBeenCalled();
  });
});
