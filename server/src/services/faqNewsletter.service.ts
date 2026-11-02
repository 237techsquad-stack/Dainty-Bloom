import { createHash, randomBytes } from 'node:crypto';

import { env } from '../config/env';
import { Faq, Subscriber } from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { logAuditEvent } from './audit.service';
import { getMailer } from './mailer';
import { safeMailErrorCode } from './mailer/smtpTransport';
import type { TransactionalEmail } from './mailer/Mailer';

export async function listPublicFaqs() {
  const grouped = await Faq.aggregate([
    { $match: { isPublished: true } },
    { $sort: { category: 1, sortOrder: 1, _id: 1 } },
    {
      $group: {
        _id: '$category',
        items: {
          $push: {
            id: { $toString: '$_id' },
            question: '$question',
            answer: '$answer',
            sortOrder: '$sortOrder',
          },
        },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, category: '$_id', items: 1 } },
  ]);
  return { categories: grouped };
}

export async function listAdminFaqs() {
  return Faq.find()
    .select(
      'question answer category sortOrder isPublished createdAt updatedAt',
    )
    .sort({ category: 1, sortOrder: 1, _id: 1 })
    .lean();
}

export async function createFaq(
  input: {
    question: string;
    answer: string;
    category: string;
    sortOrder: number;
    isPublished: boolean;
  },
  actor: IUser,
) {
  rejectHtml(input.question, input.answer, input.category);
  const faq = await Faq.create(input);
  await logAuditEvent({
    actor,
    action: 'faq.created',
    targetType: 'Faq',
    targetId: faq._id.toString(),
  });
  return faq;
}

export async function updateFaq(
  id: string,
  input: Partial<{
    question: string;
    answer: string;
    category: string;
    sortOrder: number;
    isPublished: boolean;
  }>,
  actor: IUser,
) {
  rejectHtml(input.question, input.answer, input.category);
  const faq = await Faq.findByIdAndUpdate(
    id,
    { $set: input },
    { new: true, runValidators: true },
  );
  if (!faq) throw new AppError('FAQ not found', 404, 'FAQ_NOT_FOUND');
  await logAuditEvent({
    actor,
    action: 'faq.updated',
    targetType: 'Faq',
    targetId: id,
    metadata: { changedFields: Object.keys(input) },
  });
  return faq;
}

export async function deleteFaq(id: string, actor: IUser) {
  const faq = await Faq.findByIdAndDelete(id);
  if (!faq) throw new AppError('FAQ not found', 404, 'FAQ_NOT_FOUND');
  await logAuditEvent({
    actor,
    action: 'faq.deleted',
    targetType: 'Faq',
    targetId: id,
  });
}

export async function subscribeToNewsletter(input: {
  email: string;
  source: string;
}) {
  rejectHtml(input.source);
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const email = input.email.toLowerCase();
  const update = {
    $set: {
      status: 'subscribed' as const,
      consentAt: new Date(),
      source: input.source,
      unsubscribeTokenHash: tokenHash,
    },
    $setOnInsert: { email },
  };
  try {
    const subscriber = await Subscriber.findOneAndUpdate({ email }, update, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    });
    if (!subscriber)
      throw new AppError(
        'Unable to save subscription',
        500,
        'SUBSCRIPTION_SAVE_FAILED',
      );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    await Subscriber.updateOne({ email }, update, { runValidators: true });
  }
  const unsubscribeUrl = new URL(
    '/api/newsletter/unsubscribe',
    env.API_PUBLIC_URL,
  );
  unsubscribeUrl.searchParams.set('token', token);
  await sendNewsletterEmail({
    to: email,
    subject: 'Newsletter subscription preferences',
    text: `To unsubscribe, visit ${unsubscribeUrl.toString()}`,
    html: `<p>To unsubscribe, <a href="${escapeHtml(unsubscribeUrl.toString())}">manage your subscription</a>.</p>`,
  });
  return { message: 'Your subscription request has been received.' };
}

export async function unsubscribeFromNewsletter(token: string) {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await Subscriber.updateOne(
    { unsubscribeTokenHash: tokenHash },
    { $set: { status: 'unsubscribed' } },
  );
  return { message: 'Your unsubscribe request has been processed.' };
}

export async function listSubscribers(query: {
  page: number;
  limit: number;
  status?: 'subscribed' | 'unsubscribed';
  q?: string;
}) {
  const match: Record<string, unknown> = {};
  if (query.status) match.status = query.status;
  if (query.q) {
    const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    match.email = { $regex: escaped, $options: 'i' };
  }
  const [items, total] = await Promise.all([
    Subscriber.find(match)
      .select('email status consentAt source createdAt updatedAt')
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Subscriber.countDocuments(match),
  ]);
  const totalPages = Math.ceil(total / query.limit);
  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
    },
  };
}

function rejectHtml(...values: Array<string | undefined>) {
  if (values.some((value) => value && /<\/?[a-z][^>]*>/i.test(value))) {
    throw new AppError(
      'HTML is not allowed in text fields',
      400,
      'HTML_NOT_ALLOWED',
    );
  }
}

async function sendNewsletterEmail(email: TransactionalEmail) {
  try {
    await getMailer().sendTransactionalEmail(email);
  } catch (error) {
    logger.error(
      { code: safeMailErrorCode(error) },
      'Newsletter email delivery failed',
    );
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}
