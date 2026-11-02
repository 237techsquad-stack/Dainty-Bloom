import { env } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import { sendSmtpEmail } from './mailer/smtpTransport';

interface ContactEnquiryEmail {
  name: string;
  email: string;
  orderNumber?: string;
  subject: string;
  message: string;
}

export async function deliverContactEnquiryEmail(
  enquiry: ContactEnquiryEmail,
): Promise<void> {
  const {
    CONTACT_RECIPIENT_EMAIL: recipient,
    SMTP_HOST: host,
    SMTP_PORT: configuredPort,
    SMTP_SECURE: configuredSecure,
    SMTP_USERNAME: username,
    SMTP_PASSWORD: password,
    SMTP_FROM: from,
  } = env;

  const isGmailSmtp = host?.toLowerCase() === 'smtp.gmail.com';
  const port = configuredPort ?? 587;
  const secure = configuredSecure ?? port === 465;
  const validGmailTls = (port === 587 && !secure) || (port === 465 && secure);
  if (
    !recipient ||
    !host ||
    !from ||
    (isGmailSmtp &&
      (!username ||
        !password ||
        from.toLowerCase() !== 'info@daintybloome.com'))
  ) {
    logger.error(
      { code: 'CONTACT_EMAIL_NOT_CONFIGURED' },
      'Contact email delivery is not configured',
    );
    throw new AppError(
      'The enquiry was saved, but store email delivery is not configured.',
      503,
      'CONTACT_EMAIL_NOT_CONFIGURED',
    );
  }
  if (isGmailSmtp && !validGmailTls) {
    logger.error(
      { code: 'CONTACT_EMAIL_NOT_CONFIGURED' },
      'Contact email delivery is not configured',
    );
    throw new AppError(
      'Gmail SMTP must use port 587 with STARTTLS or port 465 with implicit TLS.',
      503,
      'CONTACT_EMAIL_NOT_CONFIGURED',
    );
  }

  const lines = [
    `Name: ${enquiry.name}`,
    `Email: ${enquiry.email}`,
    ...(enquiry.orderNumber ? [`Order number: ${enquiry.orderNumber}`] : []),
    `Subject: ${enquiry.subject}`,
    '',
    enquiry.message,
  ];
  const escapeHtml = (value: string) =>
    value.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[character] ?? character;
    });

  try {
    await sendSmtpEmail({
      to: recipient,
      replyTo: enquiry.email,
      subject: `New contact enquiry: ${enquiry.subject}`,
      text: lines.join('\n'),
      html: `<pre>${lines.map(escapeHtml).join('\n')}</pre>`,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'EMAIL_NOT_CONFIGURED') {
      throw new AppError(
        'The enquiry was saved, but store email delivery is not configured.',
        503,
        'CONTACT_EMAIL_NOT_CONFIGURED',
      );
    }
    throw new AppError(
      'The enquiry was saved, but email delivery could not be confirmed.',
      503,
      'CONTACT_EMAIL_DELIVERY_FAILED',
    );
  }
}
