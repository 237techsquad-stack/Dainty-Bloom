import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { createTransportMock, sendMailMock, findSettingsMock, loggerErrorMock } =
  vi.hoisted(() => ({
    createTransportMock: vi.fn(),
    sendMailMock: vi.fn(),
    findSettingsMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  }));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));
vi.mock('../src/models', () => ({
  SiteSettings: { findOne: findSettingsMock },
}));
vi.mock('../src/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { env } from '../src/config/env';
import { sendOrderEmail } from '../src/services/email.service';
import { resetSmtpTransport } from '../src/services/mailer/smtpTransport';
import type { IOrder } from '../src/models/Order';

const originalEnvironment = {
  NODE_ENV: env.NODE_ENV,
  SMTP_HOST: env.SMTP_HOST,
  SMTP_PORT: env.SMTP_PORT,
  SMTP_SECURE: env.SMTP_SECURE,
  SMTP_FROM: env.SMTP_FROM,
  SMTP_USERNAME: env.SMTP_USERNAME,
  SMTP_PASSWORD: env.SMTP_PASSWORD,
};

const mailCases = [
  {
    kind: 'received' as const,
    subject: 'Order DB-EMAIL-100 received',
    content: 'Its current status is pending_payment.',
  },
  {
    kind: 'payment_confirmed' as const,
    subject: 'Payment confirmed for order DB-EMAIL-100',
    content: 'Payment for order DB-EMAIL-100 has been recorded.',
  },
  {
    kind: 'proof_approved' as const,
    subject: 'Artwork approved for order DB-EMAIL-100',
    content: 'Artwork for order DB-EMAIL-100 has been approved.',
  },
  {
    kind: 'replacement_requested' as const,
    subject: 'Artwork update needed for order DB-EMAIL-100',
    content: 'Please upload a replacement file.',
    details: { note: 'Please upload a replacement file.' },
  },
  {
    kind: 'shipped' as const,
    subject: 'Order DB-EMAIL-100 shipped',
    content: 'Tracking: TRACK-100',
    details: { trackingNumber: 'TRACK-100', carrier: 'Post' },
  },
  {
    kind: 'cancelled' as const,
    subject: 'Order DB-EMAIL-100 cancelled',
    content: 'Order DB-EMAIL-100 has been cancelled.',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetSmtpTransport();
  env.NODE_ENV = 'production';
  env.SMTP_HOST = 'smtp.example.test';
  env.SMTP_PORT = 587;
  env.SMTP_SECURE = false;
  env.SMTP_FROM = 'store@example.test';
  env.SMTP_USERNAME = 'smtp-user';
  env.SMTP_PASSWORD = 'smtp-password-do-not-log';
  sendMailMock.mockResolvedValue({ messageId: 'private-provider-response' });
  createTransportMock.mockReturnValue({ sendMail: sendMailMock });
  findSettingsMock.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({ storeName: 'Dainty Bloom Studio' }),
    }),
  });
});

afterAll(() => {
  Object.assign(env, originalEnvironment);
  resetSmtpTransport();
});

describe('production order email flows', () => {
  it.each(mailCases)(
    'sends the $kind notification to the order customer',
    async ({ kind, subject, content, details }) => {
      const order = {
        orderNumber: 'DB-EMAIL-100',
        status: 'pending_payment',
        contactSnapshot: { email: 'order-customer@example.test' },
      } as IOrder;

      await sendOrderEmail(order, kind, details);

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'store@example.test',
          to: 'order-customer@example.test',
          subject,
          text: expect.stringContaining(content),
        }),
      );
    },
  );

  it('does not expose SMTP or customer details when order email delivery fails', async () => {
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error('SMTP password smtp-password-do-not-log'), {
        code: 'EAUTH',
      }),
    );

    await expect(
      sendOrderEmail(
        {
          orderNumber: 'DB-EMAIL-100',
          status: 'pending_payment',
          contactSnapshot: { email: 'order-customer@example.test' },
        } as IOrder,
        'payment_confirmed',
      ),
    ).resolves.toBeUndefined();

    const logs = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logs).toContain('EAUTH');
    expect(logs).not.toContain('SMTP password');
    expect(logs).not.toContain('smtp-password-do-not-log');
    expect(logs).not.toContain('order-customer@example.test');
  });
});
