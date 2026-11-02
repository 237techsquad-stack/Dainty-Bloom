import type { RequestHandler } from 'express';

import {
  createContactMessage,
  createMessageToken,
  deleteContactMessage,
  genericMessageSuccess,
  getContactMessage,
  getMessageAttachment,
  getCustomerCustomRequest,
  getCustomerCustomRequests,
  getCustomerCustomRequestAttachment,
  listContactMessages,
  replyToContactMessage,
  updateContactMessage,
  transitionCustomRequestStatus,
} from '../services/message.service';
import {
  createCustomOfferForRequest,
  getAdminCustomOfferImageId,
  getCustomerCustomOfferImageId,
  startCustomerCustomOfferCheckoutForRequest,
} from '../services/customOffer.service';
import { streamArtworkPreview } from '../services/upload.service';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

export const token: RequestHandler = asyncHandler(async (_req, res) => {
  const issuedAt = new Date();
  res.json({
    success: true,
    data: {
      token: createMessageToken(issuedAt.getTime()),
      issuedAt,
    },
  });
});

export const submit: RequestHandler = asyncHandler(async (req, res) => {
  if (req.body?.website?.trim()) {
    res.json({ success: true, data: genericMessageSuccess() });
    return;
  }
  const data = await createContactMessage(
    req.body,
    req.file,
    req.user,
    req.ip,
    req.body?.type === 'custom_3d_request',
  );
  res.json({ success: true, data });
});

export const list: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await listContactMessages(req.query as never),
  });
});

export const detail: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: { message: await getContactMessage(req.params.id) },
  });
});

export const update: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      message: await updateContactMessage(
        req.params.id,
        req.body,
        getActor(req),
      ),
    },
  });
});

export const reply: RequestHandler = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      message: await replyToContactMessage(
        req.params.id,
        req.body,
        getActor(req),
      ),
    },
  });
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  if (getActor(req).role !== 'admin') {
    throw new AppError('Admin role required', 403, 'FORBIDDEN');
  }
  await deleteContactMessage(req.params.id, getActor(req));
  res.json({ success: true, data: { deleted: true } });
});

export const attachment: RequestHandler = asyncHandler(
  async (req, res, next) => {
    const file = await getMessageAttachment(req.params.id, getActor(req));
    const safeFilename = file.filename.replace(/[\r\n"\\]/g, '_');
    res.set({
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    file.stream.once('error', (error: Error) => next(error));
    file.stream.pipe(res);
  },
);

export const customerCustomRequests: RequestHandler = asyncHandler(
  async (req, res) => {
    res.json({
      success: true,
      data: { requests: await getCustomerCustomRequests(getActor(req)) },
    });
  },
);

export const customerCustomRequest: RequestHandler = asyncHandler(
  async (req, res) => {
    res.json({
      success: true,
      data: {
        request: await getCustomerCustomRequest(req.params.id, getActor(req)),
      },
    });
  },
);

export const customerAttachment: RequestHandler = asyncHandler(
  async (req, res, next) => {
    const file = await getCustomerCustomRequestAttachment(
      req.params.id,
      getActor(req),
    );
    const safeFilename = file.filename.replace(/[\r\n"\\]/g, '_');
    res.set({
      'Content-Type': file.mime,
      'Content-Disposition': `inline; filename="${safeFilename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    file.stream.once('error', (error: Error) => next(error));
    file.stream.pipe(res);
  },
);

export const transitionCustomRequest: RequestHandler = asyncHandler(
  async (req, res) => {
    res.json({
      success: true,
      data: {
        message: await transitionCustomRequestStatus(
          req.params.id,
          req.body,
          getActor(req),
        ),
      },
    });
  },
);

export const createCustomOffer: RequestHandler = asyncHandler(
  async (req, res) => {
    const offer = await createCustomOfferForRequest(
      req.params.id,
      req.body,
      req.file,
      getActor(req),
    );
    res.status(201).json({ success: true, data: { offer } });
  },
);

export const adminCustomOfferImage: RequestHandler = asyncHandler(
  async (req, res, next) => {
    const actor = getActor(req);
    await streamArtworkPreview(
      await getAdminCustomOfferImageId(req.params.id),
      { user: actor },
      true,
      res,
      next,
      actor,
    );
  },
);

export const customerCustomOfferImage: RequestHandler = asyncHandler(
  async (req, res, next) => {
    const customer = getActor(req);
    await streamArtworkPreview(
      await getCustomerCustomOfferImageId(req.params.id, customer),
      { user: customer },
      false,
      res,
      next,
      customer,
    );
  },
);

export const customerCustomOfferCheckout: RequestHandler = asyncHandler(
  async (req, res) => {
    const customer = getActor(req);
    const data = await startCustomerCustomOfferCheckoutForRequest(
      customer,
      req.params.id,
    );
    res.json({ success: true, data });
  },
);

function getActor(req: Parameters<RequestHandler>[0]) {
  if (!req.user)
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  return req.user;
}
