import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { SmtpMailer } from '../src/services/mailer/SmtpMailer';
import { resetSmtpTransport } from '../src/services/mailer/smtpTransport';

const originalEnvironment = {
  NODE_ENV: env.NODE_ENV,
  SMTP_HOST: env.SMTP_HOST,
  SMTP_PORT: env.SMTP_PORT,
  SMTP_SECURE: env.SMTP_SECURE,
  SMTP_FROM: env.SMTP_FROM,
  SMTP_USERNAME: env.SMTP_USERNAME,
  SMTP_PASSWORD: env.SMTP_PASSWORD,
};

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
  createTransportMock.mockReturnValue({ sendMail: sendMailMock });
  sendMailMock.mockResolvedValue({ messageId: 'private-provider-response' });
});

afterAll(() => {
  Object.assign(env, originalEnvironment);
  resetSmtpTransport();
});

describe('SMTP transactional mailer', () => {
  it('sends password resets to the customer without logging the reset link', async () => {
    const resetLink =
      'https://daintybloome.com/reset-password?token=private-reset-token';

    await new SmtpMailer().sendPasswordReset({
      to: 'customer@example.test',
      name: '<Customer>',
      resetLink,
    });

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      auth: { user: 'smtp-user', pass: 'smtp-password-do-not-log' },
    });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'store@example.test',
        to: 'customer@example.test',
        subject: 'Reset your Dainty Bloom password',
        text: expect.stringContaining(resetLink),
        html: expect.stringContaining('&lt;Customer&gt;'),
      }),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
      'private-reset-token',
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
      'smtp-password-do-not-log',
    );
  });

  it('sends transactional messages to their specified customer recipient', async () => {
    const message = {
      to: 'order-customer@example.test',
      subject: 'Payment confirmed for order DB-100',
      text: 'Your payment was received.',
      html: '<p>Your payment was received.</p>',
    };

    await new SmtpMailer().sendTransactionalEmail(message);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith({
      ...message,
      from: 'store@example.test',
    });
  });

  it('fails safely when SMTP configuration is missing', async () => {
    env.SMTP_HOST = undefined;

    await expect(
      new SmtpMailer().sendTransactionalEmail({
        to: 'customer@example.test',
        subject: 'Private subject',
        text: 'Private message body',
        html: '<p>Private message body</p>',
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'EMAIL_NOT_CONFIGURED',
      message: 'Email delivery is not configured.',
    });

    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
      'customer@example.test',
    );
  });

  it('does not expose provider errors or message content when delivery fails', async () => {
    sendMailMock.mockRejectedValueOnce(
      Object.assign(
        new Error('private SMTP response smtp-password-do-not-log'),
        { code: 'EAUTH' },
      ),
    );

    await expect(
      new SmtpMailer().sendTransactionalEmail({
        to: 'customer@example.test',
        subject: 'Private subject',
        text: 'Private message body',
        html: '<p>Private message body</p>',
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'EMAIL_DELIVERY_FAILED',
      message: 'Email delivery could not be confirmed.',
    });

    const logs = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logs).toContain('EAUTH');
    expect(logs).not.toContain('private SMTP response');
    expect(logs).not.toContain('smtp-password-do-not-log');
    expect(logs).not.toContain('Private message body');
  });
});
