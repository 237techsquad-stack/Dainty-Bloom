import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer';

import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';

let transporter: Transporter | undefined;

export async function sendSmtpEmail(
  message: Omit<SendMailOptions, 'from'>,
): Promise<void> {
  const smtp = getSmtpTransport();

  try {
    await smtp.sendMail({ ...message, from: env.SMTP_FROM });
  } catch (error) {
    logger.error(
      { smtpCode: safeSmtpCode(error) },
      'SMTP email delivery failed',
    );
    transporter = undefined;
    throw new AppError(
      'Email delivery could not be confirmed.',
      503,
      'EMAIL_DELIVERY_FAILED',
    );
  }
}

export function resetSmtpTransport(): void {
  transporter = undefined;
}

export function safeMailErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,64}$/.test(error.code)
  ) {
    return error.code;
  }
  return 'EMAIL_ERROR';
}

function getSmtpTransport(): Transporter {
  const host = env.SMTP_HOST;
  const from = env.SMTP_FROM;
  const username = env.SMTP_USERNAME;
  const password = env.SMTP_PASSWORD;
  const port = env.SMTP_PORT ?? 587;
  const secure = env.SMTP_SECURE ?? port === 465;
  const isGmail = host?.toLowerCase() === 'smtp.gmail.com';

  if (
    !host ||
    !from ||
    Boolean(username) !== Boolean(password) ||
    (isGmail &&
      (!username ||
        !password ||
        from.toLowerCase() !== 'info@daintybloome.com' ||
        !((port === 587 && !secure) || (port === 465 && secure))))
  ) {
    logger.error(
      { code: 'EMAIL_NOT_CONFIGURED' },
      'Transactional email is not configured',
    );
    throw new AppError(
      'Email delivery is not configured.',
      503,
      'EMAIL_NOT_CONFIGURED',
    );
  }

  transporter ??= nodemailer.createTransport({
    host,
    port,
    secure,
    ...(isGmail && port === 587 ? { requireTLS: true } : {}),
    ...(username && password
      ? { auth: { user: username, pass: password } }
      : {}),
  });
  return transporter;
}

function safeSmtpCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,32}$/.test(error.code)
  ) {
    return error.code;
  }
  return 'UNKNOWN';
}
