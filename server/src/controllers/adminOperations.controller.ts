import type { RequestHandler } from 'express';

import {
  createFaq,
  deleteFaq,
  listAdminFaqs,
  listPublicFaqs,
  listSubscribers,
  subscribeToNewsletter,
  unsubscribeFromNewsletter,
  updateFaq,
} from '../services/faqNewsletter.service';
import {
  createStaff,
  listAuditEvents,
  listStaff,
  updateStaff,
} from '../services/staff.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { staffListSchema } from '../validators/adminFeature.validators';

export const staffList: RequestHandler = asyncHandler(async (req, res) => {
  const query = staffListSchema.shape.query.parse(req.query);
  res.json({ success: true, data: await listStaff(query.page, query.limit) });
});

export const staffCreate: RequestHandler = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json({
      success: true,
      data: { staff: await createStaff(req.body, getActor(req)) },
    });
});

export const staffUpdate: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: { staff: await updateStaff(req.params.id, req.body, getActor(req)) },
  });
});

export const auditList: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listAuditEvents(req.query as never) });
});

export const faqs: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listPublicFaqs() });
});

export const adminFaqs: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { items: await listAdminFaqs() } });
});

export const faqCreate: RequestHandler = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json({
      success: true,
      data: { faq: await createFaq(req.body, getActor(req)) },
    });
});

export const faqUpdate: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: { faq: await updateFaq(req.params.id, req.body, getActor(req)) },
  });
});

export const faqDelete: RequestHandler = asyncHandler(async (req, res) => {
  await deleteFaq(req.params.id, getActor(req));
  res.json({ success: true, data: { deleted: true } });
});

export const newsletterSubscribe: RequestHandler = asyncHandler(
  async (req, res) => {
    res.json({ success: true, data: await subscribeToNewsletter(req.body) });
  },
);

export const newsletterUnsubscribe: RequestHandler = asyncHandler(
  async (req, res) => {
    res.json({
      success: true,
      data: await unsubscribeFromNewsletter(String(req.query.token)),
    });
  },
);

export const subscribers: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listSubscribers(req.query as never) });
});

function getActor(req: Parameters<RequestHandler>[0]) {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  return req.user;
}
