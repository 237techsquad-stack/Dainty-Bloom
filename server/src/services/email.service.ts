import { SiteSettings } from '../models';
import type { IOrder } from '../models/Order';
import type { IUser } from '../models/User';
import { logger } from '../utils/logger';
import { getMailer } from './mailer';
import { safeMailErrorCode } from './mailer/smtpTransport';
import type { TransactionalEmail } from './mailer/Mailer';

export async function sendOrderEmail(
  order: IOrder,
  kind:
    | 'received'
    | 'payment_confirmed'
    | 'proof_approved'
    | 'replacement_requested'
    | 'shipped'
    | 'cancelled',
  details: Record<string, string> = {},
): Promise<void> {
  await sendOrderEmailWithResult(order, kind, details);
}

export async function sendOrderEmailWithResult(
  order: IOrder,
  kind:
    | 'received'
    | 'payment_confirmed'
    | 'proof_approved'
    | 'replacement_requested'
    | 'shipped'
    | 'cancelled',
  details: Record<string, string> = {},
): Promise<boolean> {
  try {
    const settings = await SiteSettings.findOne({ key: 'default' })
      .select('storeName')
      .lean();
    const storeName = settings?.storeName ?? 'Dainty Bloom';
    const orderNumber = order.orderNumber;
    const subjects: Record<typeof kind, string> = {
      received: `Order ${orderNumber} received`,
      payment_confirmed: `Payment confirmed for order ${orderNumber}`,
      proof_approved: `Artwork approved for order ${orderNumber}`,
      replacement_requested: `Artwork update needed for order ${orderNumber}`,
      shipped: `Order ${orderNumber} shipped`,
      cancelled: `Order ${orderNumber} cancelled`,
    };
    const messages: Record<typeof kind, string> = {
      received: `We received order ${orderNumber}. Its current status is ${order.status}.`,
      payment_confirmed: `Payment for order ${orderNumber} has been recorded.`,
      proof_approved: `Artwork for order ${orderNumber} has been approved.`,
      replacement_requested: `A replacement artwork file is requested for order ${orderNumber}. ${details.note ?? ''}`,
      shipped: `Order ${orderNumber} has been dispatched with ${details.carrier ?? 'the listed carrier'}. Tracking: ${details.trackingNumber ?? ''} ${details.trackingUrl ?? ''}`,
      cancelled: `Order ${orderNumber} has been cancelled. ${details.note ?? ''}`,
    };
    return sendSafely({
      to: order.contactSnapshot.email,
      subject: subjects[kind],
      text: `${storeName}\n\n${messages[kind]}`,
      html: `<main><h1>${escapeHtml(storeName)}</h1><p>${escapeHtml(messages[kind])}</p></main>`,
    });
  } catch (error) {
    logger.error({ err: error }, 'Transactional email preparation failed');
    return false;
  }
}

export async function sendCustomerEmail(
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  try {
    const settings = await SiteSettings.findOne({ key: 'default' })
      .select('storeName')
      .lean();
    const storeName = settings?.storeName ?? 'Dainty Bloom';
    await sendSafely({
      to,
      subject,
      text: `${storeName}\n\n${text}`,
      html: `<main><h1>${escapeHtml(storeName)}</h1><p>${escapeHtml(text)}</p></main>`,
    });
  } catch (error) {
    logger.error({ err: error }, 'Transactional email preparation failed');
  }
}

export async function sendSafely(email: TransactionalEmail): Promise<boolean> {
  try {
    await getMailer().sendTransactionalEmail(email);
    return true;
  } catch (error) {
    logger.error(
      { code: safeMailErrorCode(error) },
      'Transactional email delivery failed',
    );
    return false;
  }
}

export function customerEmailForOrder(order: IOrder): string {
  return order.contactSnapshot.email;
}

export function userName(user: IUser): string {
  return user.name;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}
