import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import mongoose from 'mongoose';

import { env } from '../config/env';
import type {
  CustomRequestNotificationStatus,
  CustomRequestResponseStatus,
  CustomRequestStatus,
  CustomRequestImagePurpose,
  MessageType,
  MessageStatus,
} from '../constants/message';
import {
  ArtworkAsset,
  Cart,
  Message,
  Order,
  SiteSettings,
  User,
} from '../models';
import type { IMessage } from '../models/Message';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { formatMoney, STORE_CURRENCY } from '../utils/currency';
import { logger } from '../utils/logger';
import { logAuditEvent } from './audit.service';
import { deliverContactEnquiryEmail } from './contactEmail.service';
import { getMailer } from './mailer';
import { safeMailErrorCode } from './mailer/smtpTransport';
import type { TransactionalEmail } from './mailer/Mailer';
import {
  getAdminCustomOfferForRequest,
  getCustomerCustomOfferForRequest,
} from './customOffer.service';
import { saveArtworkUpload, type UploadedArtworkFile } from './upload.service';
import { getArtworkStorageMeta, getStorageDriver } from './storage';

const SUCCESS_MESSAGE = 'We received your message.';

export function createMessageToken(now = Date.now()): string {
  const issuedAt = String(now);
  return `${issuedAt}.${messageTokenSignature(issuedAt)}`;
}

export function verifyMessageToken(token: string, now = Date.now()): boolean {
  const [issuedAt, signature, extra] = token.split('.');
  if (!issuedAt || !signature || extra) return false;
  const timestamp = Number(issuedAt);
  if (
    !Number.isSafeInteger(timestamp) ||
    now - timestamp < 3_000 ||
    now - timestamp > 10 * 60 * 1000
  )
    return false;
  const expected = messageTokenSignature(issuedAt);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function genericMessageSuccess(): { message: string } {
  return { message: SUCCESS_MESSAGE };
}

export async function createContactMessage(
  input: {
    name: string;
    email: string;
    orderNumber?: string;
    subject: string;
    message: string;
    submissionId?: string;
    type?: MessageType;
    imagePurpose?: CustomRequestImagePurpose;
    requestDetails?: {
      description?: string;
      productName?: string;
      productType?: string;
      otherProductType?: string;
      phone?: string;
      approximateSize?: string;
      preferredColour?: string;
      preferredMaterial?: string;
      budget?: string;
      quantity?: number;
      neededByDate?: Date;
    };
    website?: string;
    token: string;
  },
  file: UploadedArtworkFile | undefined,
  actor: IUser | undefined,
  ip: string | undefined,
  imageOnly = false,
): Promise<{ message: string }> {
  if (input.website?.trim()) return genericMessageSuccess();
  if (!verifyMessageToken(input.token)) {
    throw new AppError(
      'Message submission token is invalid or expired',
      400,
      'MESSAGE_TOKEN_INVALID',
    );
  }
  for (const value of [input.name, input.subject, input.message]) {
    if (/<\/?[a-z][^>]*>/i.test(value)) {
      throw new AppError(
        'HTML is not allowed in message fields',
        400,
        'HTML_NOT_ALLOWED',
      );
    }
  }

  const ipHash = ip
    ? createHmac('sha256', env.UPLOAD_SIGNING_SECRET).update(ip).digest('hex')
    : undefined;
  const type = input.type ?? 'general';
  if (type === 'custom_3d_request' && (!actor || actor.role !== 'customer')) {
    throw new AppError(
      'A signed-in customer account is required',
      actor ? 403 : 401,
      actor ? 'CUSTOMER_ACCOUNT_REQUIRED' : 'UNAUTHENTICATED',
    );
  }
  const customerName =
    type === 'custom_3d_request' && actor ? actor.name : input.name;
  const customerEmail =
    type === 'custom_3d_request' && actor ? actor.email : input.email;
  let message: IMessage;
  try {
    message = await Message.create({
      name: customerName,
      email: customerEmail.toLowerCase(),
      orderNumber: input.orderNumber,
      subject: input.subject,
      body: input.message,
      submissionId: input.submissionId,
      type,
      ...(type === 'custom_3d_request' && actor
        ? {
            customerId: actor._id,
            customRequestStatus: 'submitted',
          }
        : {}),
      emailDeliveryStatus: type === 'general' ? 'pending' : 'not_required',
      requestDetails: input.requestDetails
        ? {
            ...input.requestDetails,
            ...(input.imagePurpose ? { imagePurpose: input.imagePurpose } : {}),
          }
        : undefined,
      ipHash,
    });
  } catch (error) {
    if (!input.submissionId || !isDuplicateKey(error)) throw error;
    const existing = await Message.findOne({
      submissionId: input.submissionId,
    });
    if (!existing) throw error;
    if (
      existing.type !== type ||
      existing.name !== customerName ||
      existing.email !== customerEmail.toLowerCase() ||
      existing.orderNumber !== input.orderNumber ||
      existing.subject !== input.subject ||
      existing.body !== input.message
    ) {
      throw new AppError(
        'This submission identifier was already used for a different enquiry.',
        409,
        'MESSAGE_SUBMISSION_CONFLICT',
      );
    }
    if (existing.emailDeliveryStatus !== 'failed')
      return genericMessageSuccess();
    const claimed = await Message.findOneAndUpdate(
      { _id: existing._id, emailDeliveryStatus: 'failed' },
      { $set: { emailDeliveryStatus: 'pending' } },
      { new: true },
    );
    if (!claimed) return genericMessageSuccess();
    await deliverSavedContactEmail(claimed);
    return genericMessageSuccess();
  }
  let attachmentId: string | undefined;
  try {
    if (file) {
      const metadata = await saveArtworkUpload(
        actor ? { user: actor } : { sessionId: randomUUID() },
        file,
        imageOnly,
      );
      attachmentId = metadata.id;
      await ArtworkAsset.updateOne(
        { _id: metadata.id },
        { $set: { message: message._id } },
      );
      message.attachment = new mongoose.Types.ObjectId(metadata.id);
      await message.save();
    }
  } catch (error) {
    if (attachmentId) {
      const asset = await ArtworkAsset.findById(attachmentId).select(
        '+storageKey storageDriver storageResourceType detectedMimeType',
      );
      if (asset) {
        await getStorageDriver(asset.storageDriver).delete(
          asset.storageKey,
          getArtworkStorageMeta(asset),
        );
        await asset.deleteOne();
      }
    }
    await message.deleteOne();
    throw error;
  }
  await logAuditEvent({
    actor,
    actorRole: actor ? undefined : 'unknown',
    action: 'message.created',
    targetType: 'Message',
    targetId: message._id.toString(),
    metadata: { hasAttachment: Boolean(attachmentId) },
  });
  if (message.type === 'general') {
    await deliverSavedContactEmail(message);
  } else if (message.type === 'bulk_quote') {
    const acknowledgement = acknowledgementEmail(message.type);
    await sendSafeEmail({
      to: message.email,
      subject: acknowledgement.subject,
      text: acknowledgement.text,
      html: `<p>${escapeHtml(acknowledgement.text)}</p>`,
    });
  }
  return genericMessageSuccess();
}

async function deliverSavedContactEmail(message: IMessage): Promise<void> {
  try {
    await deliverContactEnquiryEmail({
      name: message.name,
      email: message.email,
      orderNumber: message.orderNumber,
      subject: message.subject,
      message: message.body,
    });
  } catch (error) {
    message.emailDeliveryStatus = 'failed';
    await message.save();
    throw error;
  }
  message.emailDeliveryStatus = 'sent';
  await message.save();
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

export async function listContactMessages(query: {
  page: number;
  limit: number;
  status?: MessageStatus;
  type?: MessageType;
  q?: string;
  assignee?: string;
}) {
  const match = buildMessageMatch(query);
  const [items, total] = await Promise.all([
    Message.find(match)
      .select(
        'name email orderNumber subject body type customerId customRequestStatus emailDeliveryStatus requestDetails quotedPriceMinor quotedPriceCurrency quoteNote status assignedTo attachment createdAt updatedAt',
      )
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Message.countDocuments(match),
  ]);
  const orderNumbers = [
    ...new Set(
      items.flatMap((item) => (item.orderNumber ? [item.orderNumber] : [])),
    ),
  ];
  const orders = await Order.find({ orderNumber: { $in: orderNumbers } })
    .select('orderNumber status')
    .lean();
  const customers = await User.find({
    _id: {
      $in: items.flatMap((item) => (item.customerId ? [item.customerId] : [])),
    },
  })
    .select('name email')
    .lean();
  const orderMap = new Map(orders.map((order) => [order.orderNumber, order]));
  const customerMap = new Map(
    customers.map((customer) => [
      customer._id.toString(),
      {
        id: customer._id.toString(),
        name: customer.name,
        email: customer.email,
      },
    ]),
  );
  return {
    items: items.map((item) => ({
      id: item._id.toString(),
      name: item.name,
      email: item.email,
      customer: item.customerId
        ? (customerMap.get(item.customerId.toString()) ?? null)
        : null,
      orderNumber: item.orderNumber ?? null,
      order:
        item.orderNumber && orderMap.has(item.orderNumber)
          ? {
              id: orderMap.get(item.orderNumber)!._id.toString(),
              status: orderMap.get(item.orderNumber)!.status,
            }
          : null,
      subject: item.subject,
      message: item.body,
      type: item.type,
      customRequestStatus:
        item.type === 'custom_3d_request'
          ? (item.customRequestStatus ?? 'submitted')
          : null,
      emailDeliveryStatus:
        item.emailDeliveryStatus ??
        (item.type === 'general' ? 'not_tracked' : 'not_required'),
      requestDetails: item.requestDetails ?? null,
      quotedPriceMinor: item.quotedPriceMinor ?? null,
      quotedPriceCurrency: item.quotedPriceCurrency ?? null,
      quoteNote: item.quoteNote ?? null,
      status: item.status,
      assignedTo: item.assignedTo?.toString() ?? null,
      hasAttachment: Boolean(item.attachment),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    pagination: pagination(query.page, query.limit, total),
  };
}

export async function getContactMessage(id: string) {
  const message = await Message.findById(id).lean();
  if (!message)
    throw new AppError('Message not found', 404, 'MESSAGE_NOT_FOUND');
  const [asset, order] = await Promise.all([
    message.attachment
      ? ArtworkAsset.findById(message.attachment)
          .select(
            'originalFilename detectedMimeType sizeBytes width height createdAt',
          )
          .lean()
      : null,
    message.orderNumber
      ? Order.findOne({ orderNumber: message.orderNumber })
          .select('_id status')
          .lean()
      : null,
  ]);
  const authorIds = [
    ...message.replies.map((reply) => reply.author),
    ...(message.customRequestResponses ?? []).map(
      (response) => response.author,
    ),
  ];
  const [authors, customer] = await Promise.all([
    User.find({ _id: { $in: authorIds } })
      .select('name')
      .lean(),
    message.customerId
      ? User.findById(message.customerId).select('name email').lean()
      : null,
  ]);
  const customOffer =
    message.type === 'custom_3d_request'
      ? await getAdminCustomOfferForRequest(id)
      : null;
  const authorMap = new Map(
    authors.map((author) => [author._id.toString(), author.name]),
  );
  return {
    id: message._id.toString(),
    name: message.name,
    email: message.email,
    orderNumber: message.orderNumber ?? null,
    order: order ? { id: order._id.toString(), status: order.status } : null,
    subject: message.subject,
    message: message.body,
    type: message.type,
    customRequestStatus:
      message.type === 'custom_3d_request'
        ? (message.customRequestStatus ?? 'submitted')
        : null,
    customer: customer
      ? {
          id: customer._id.toString(),
          name: customer.name,
          email: customer.email,
        }
      : null,
    customRequestResponses: (message.customRequestResponses ?? []).map(
      (response) => ({
        id: response._id?.toString() ?? null,
        status: response.status,
        message: response.message,
        authorName: authorMap.get(response.author.toString()) ?? null,
        notificationStatus: response.notificationStatus,
        createdAt: response.createdAt,
      }),
    ),
    emailDeliveryStatus:
      message.emailDeliveryStatus ??
      (message.type === 'general' ? 'not_tracked' : 'not_required'),
    requestDetails: message.requestDetails ?? null,
    customOffer,
    quotedPriceMinor: message.quotedPriceMinor ?? null,
    quotedPriceCurrency: message.quotedPriceCurrency ?? null,
    quoteNote: message.quoteNote ?? null,
    status: message.status,
    assignedTo: message.assignedTo?.toString() ?? null,
    attachment: asset
      ? {
          id: asset._id.toString(),
          originalFilename: asset.originalFilename,
          detectedMimeType: asset.detectedMimeType,
          sizeBytes: asset.sizeBytes,
          width: asset.width ?? null,
          height: asset.height ?? null,
          createdAt: asset.createdAt,
        }
      : null,
    replies: message.replies.map((reply) => ({
      id: reply._id?.toString() ?? null,
      authorName: authorMap.get(reply.author.toString()) ?? null,
      body: reply.body,
      createdAt: reply.createdAt,
    })),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

export async function updateContactMessage(
  id: string,
  input: {
    status?: MessageStatus;
    assignedTo?: string | null;
  },
  actor: IUser,
) {
  if (input.assignedTo) {
    const assignee = await User.findOne({
      _id: input.assignedTo,
      role: { $ne: 'customer' },
      accountState: 'active',
    })
      .select('_id')
      .lean();
    if (!assignee)
      throw new AppError('Assignee not found', 404, 'ASSIGNEE_NOT_FOUND');
  }
  const message = await Message.findByIdAndUpdate(
    id,
    { $set: input },
    { new: true, runValidators: true },
  );
  if (!message)
    throw new AppError('Message not found', 404, 'MESSAGE_NOT_FOUND');
  await logAuditEvent({
    actor,
    action: 'message.updated',
    targetType: 'Message',
    targetId: id,
    metadata: { changedFields: Object.keys(input) },
  });
  return getContactMessage(id);
}

export async function transitionCustomRequestStatus(
  id: string,
  input: {
    status: Extract<
      CustomRequestStatus,
      'under_review' | 'accepted' | 'declined'
    >;
    message?: string;
  },
  actor: IUser,
) {
  const request = await Message.findById(id);
  if (!request || request.type !== 'custom_3d_request') {
    throw new AppError(
      'Custom request not found',
      404,
      'CUSTOM_REQUEST_NOT_FOUND',
    );
  }

  const currentStatus = request.customRequestStatus ?? 'submitted';
  const allowedTransitions: Record<CustomRequestStatus, CustomRequestStatus[]> =
    {
      submitted: ['under_review', 'accepted', 'declined'],
      under_review: ['accepted', 'declined'],
      accepted: ['offer_created'],
      declined: [],
      offer_created: ['completed'],
      completed: [],
    };
  if (!allowedTransitions[currentStatus]?.includes(input.status)) {
    throw new AppError(
      `A request cannot move from ${currentStatus} to ${input.status}`,
      409,
      'CUSTOM_REQUEST_TRANSITION_INVALID',
    );
  }
  if (input.status === 'declined' && !input.message?.trim()) {
    throw new AppError(
      'A response is required when declining a request',
      400,
      'CUSTOM_REQUEST_RESPONSE_REQUIRED',
    );
  }

  request.customRequestStatus = input.status;
  if (input.status !== 'under_review') {
    const responseMessage =
      input.message?.trim() ||
      'Your custom product request has been accepted. We will prepare a custom offer in a later step.';
    request.customRequestResponses.push({
      status: input.status,
      message: responseMessage,
      author: actor._id,
      notificationStatus: 'pending',
      createdAt: new Date(),
    });
  }
  await request.save();
  await logAuditEvent({
    actor,
    action: 'custom_request.status_changed',
    targetType: 'Message',
    targetId: id,
    metadata: { from: currentStatus, to: input.status },
  });

  if (input.status !== 'under_review') {
    const response = request.customRequestResponses.at(-1);
    if (!response) {
      throw new AppError(
        'The request response could not be recorded',
        500,
        'CUSTOM_REQUEST_RESPONSE_FAILED',
      );
    }
    response.notificationStatus = await sendCustomRequestNotification(
      request.email,
      input.status,
      response.message,
    );
    await request.save();
  }
  return getContactMessage(id);
}

export async function getCustomerCustomRequests(customer: IUser) {
  const requests = await Message.find({
    type: 'custom_3d_request',
    customerId: customer._id,
  })
    .select('subject requestDetails customRequestStatus createdAt updatedAt')
    .sort({ createdAt: -1 })
    .lean();
  return requests.map((request) => ({
    id: request._id.toString(),
    subject: request.subject,
    productName: request.requestDetails?.productName ?? null,
    productType: request.requestDetails?.productType ?? null,
    customRequestStatus: request.customRequestStatus ?? 'submitted',
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }));
}

export async function getCustomerCustomRequest(id: string, customer: IUser) {
  const request = await Message.findOne({
    _id: id,
    type: 'custom_3d_request',
    customerId: customer._id,
  }).lean();
  if (!request) {
    throw new AppError(
      'Custom request not found',
      404,
      'CUSTOM_REQUEST_NOT_FOUND',
    );
  }

  const [asset, authors, customOffer] = await Promise.all([
    request.attachment
      ? ArtworkAsset.findOne({
          _id: request.attachment,
          message: request._id,
          owner: customer._id,
        })
          .select(
            'originalFilename detectedMimeType sizeBytes width height createdAt',
          )
          .lean()
      : null,
    User.find({
      _id: {
        $in: (request.customRequestResponses ?? []).map(
          (response) => response.author,
        ),
      },
    })
      .select('name')
      .lean(),
    getCustomerCustomOfferForRequest(id, customer),
  ]);
  const authorNames = new Map(
    authors.map((author) => [author._id.toString(), author.name]),
  );
  return {
    id: request._id.toString(),
    subject: request.subject,
    message: request.body,
    requestDetails: request.requestDetails ?? null,
    customRequestStatus: request.customRequestStatus ?? 'submitted',
    customOffer,
    attachment: asset
      ? {
          id: asset._id.toString(),
          originalFilename: asset.originalFilename,
          detectedMimeType: asset.detectedMimeType,
          sizeBytes: asset.sizeBytes,
          width: asset.width ?? null,
          height: asset.height ?? null,
          createdAt: asset.createdAt,
          url: `/api/messages/custom-requests/${request._id.toString()}/attachment`,
        }
      : null,
    responses: (request.customRequestResponses ?? []).map((response) => ({
      id: response._id?.toString() ?? null,
      status: response.status,
      message: response.message,
      authorName: authorNames.get(response.author.toString()) ?? 'Dainty Bloom',
      notificationStatus: response.notificationStatus,
      createdAt: response.createdAt,
    })),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export async function getCustomerCustomRequestAttachment(
  id: string,
  customer: IUser,
): Promise<{ stream: Readable; filename: string; mime: string }> {
  const request = await Message.findOne({
    _id: id,
    type: 'custom_3d_request',
    customerId: customer._id,
  }).select('attachment');
  if (!request?.attachment) {
    throw new AppError(
      'Custom request attachment not found',
      404,
      'MESSAGE_ATTACHMENT_NOT_FOUND',
    );
  }
  const asset = await ArtworkAsset.findOne({
    _id: request.attachment,
    message: request._id,
    owner: customer._id,
  }).select(
    '+storageKey storageDriver storageResourceType originalFilename detectedMimeType',
  );
  if (!asset) {
    throw new AppError(
      'Custom request attachment not found',
      404,
      'MESSAGE_ATTACHMENT_NOT_FOUND',
    );
  }
  await logAuditEvent({
    actor: customer,
    action: 'custom_request.attachment_access',
    targetType: 'Message',
    targetId: id,
  });
  return {
    stream: getStorageDriver(asset.storageDriver).getStream(
      asset.storageKey,
      getArtworkStorageMeta(asset),
    ),
    filename: asset.originalFilename,
    mime: asset.detectedMimeType,
  };
}

export async function replyToContactMessage(
  id: string,
  input: { body: string; quotedPriceMinor?: number; note?: string },
  actor: IUser,
) {
  const body = input.body;
  if (/<\/?[a-z][^>]*>/i.test(body))
    throw new AppError(
      'HTML is not allowed in replies',
      400,
      'HTML_NOT_ALLOWED',
    );
  const message = await Message.findById(id);
  if (!message)
    throw new AppError('Message not found', 404, 'MESSAGE_NOT_FOUND');
  const settings =
    input.quotedPriceMinor === undefined
      ? null
      : await SiteSettings.findOne({ key: 'default' })
          .select('currency')
          .lean();
  if (
    input.quotedPriceMinor !== undefined &&
    settings?.currency !== STORE_CURRENCY
  ) {
    throw new AppError(
      'New quotes require the store currency migration to be completed',
      409,
      'STORE_CURRENCY_MISMATCH',
    );
  }
  message.replies.push({ author: actor._id, body, createdAt: new Date() });
  if (input.quotedPriceMinor !== undefined) {
    message.quotedPriceMinor = input.quotedPriceMinor;
    message.quotedPriceCurrency = STORE_CURRENCY;
    message.quoteNote = input.note;
    message.status = 'quoted';
  } else if (message.status === 'new') {
    message.status = 'in_progress';
  }
  await message.save();
  await logAuditEvent({
    actor,
    action: 'message.replied',
    targetType: 'Message',
    targetId: id,
    metadata: {
      replyLength: body.length,
      ...(input.quotedPriceMinor !== undefined
        ? { quotedPriceMinor: input.quotedPriceMinor }
        : {}),
    },
  });
  const formattedQuote =
    input.quotedPriceMinor === undefined
      ? undefined
      : formatMoney(
          input.quotedPriceMinor,
          settings?.currency ?? env.DEFAULT_CURRENCY,
        );
  await sendSafeEmail({
    to: message.email,
    subject: `Re: ${message.subject}`,
    text: [
      body,
      ...(input.quotedPriceMinor !== undefined
        ? [
            `Quoted price: ${formattedQuote}.`,
            ...(input.note ? [`Note: ${input.note}`] : []),
          ]
        : []),
    ].join('\n\n'),
    html: [
      `<p>${escapeHtml(body).replace(/\r?\n/g, '<br>')}</p>`,
      ...(input.quotedPriceMinor !== undefined
        ? [
            `<p>Quoted price: ${escapeHtml(formattedQuote ?? '')}.</p>`,
            ...(input.note ? [`<p>Note: ${escapeHtml(input.note)}</p>`] : []),
          ]
        : []),
    ].join(''),
  });
  return getContactMessage(id);
}

export async function deleteContactMessage(id: string, actor: IUser) {
  const message = await Message.findById(id);
  if (!message)
    throw new AppError('Message not found', 404, 'MESSAGE_NOT_FOUND');
  let attachment;
  if (message.attachment) {
    attachment = await ArtworkAsset.findById(message.attachment).select(
      '+storageKey storageDriver storageResourceType detectedMimeType supersedes',
    );
    if (attachment) {
      await ArtworkAsset.updateOne(
        { _id: attachment._id, message: message._id },
        { $unset: { message: 1 } },
      );
    }
  }
  await message.deleteOne();
  if (attachment) {
    const [
      orderReference,
      cartReference,
      messageReference,
      supersessionReference,
    ] = await Promise.all([
      Order.exists({ 'items.artwork': attachment._id }),
      Cart.exists({ 'items.artwork': attachment._id }),
      Message.exists({ attachment: attachment._id }),
      ArtworkAsset.exists({ supersedes: attachment._id }),
    ]);
    if (
      !attachment.supersedes &&
      !orderReference &&
      !cartReference &&
      !messageReference &&
      !supersessionReference
    ) {
      await getStorageDriver(attachment.storageDriver).delete(
        attachment.storageKey,
        getArtworkStorageMeta(attachment),
      );
      await attachment.deleteOne();
    }
  }
  await logAuditEvent({
    actor,
    action: 'message.deleted',
    targetType: 'Message',
    targetId: id,
  });
}

export async function getMessageAttachment(
  id: string,
  actor: IUser,
): Promise<{ stream: Readable; filename: string; mime: string }> {
  const message = await Message.findById(id).select('attachment');
  if (!message)
    throw new AppError('Message not found', 404, 'MESSAGE_NOT_FOUND');
  if (!message.attachment)
    throw new AppError(
      'Message has no attachment',
      404,
      'MESSAGE_ATTACHMENT_NOT_FOUND',
    );
  const asset = await ArtworkAsset.findById(message.attachment).select(
    '+storageKey storageDriver storageResourceType originalFilename detectedMimeType',
  );
  if (!asset)
    throw new AppError(
      'Attachment not found',
      404,
      'MESSAGE_ATTACHMENT_NOT_FOUND',
    );
  await logAuditEvent({
    actor,
    action: 'message.attachment_access',
    targetType: 'Message',
    targetId: id,
  });
  return {
    stream: getStorageDriver(asset.storageDriver).getStream(
      asset.storageKey,
      getArtworkStorageMeta(asset),
    ),
    filename: asset.originalFilename,
    mime: asset.detectedMimeType,
  };
}

function messageTokenSignature(timestamp: string): string {
  return createHmac('sha256', env.UPLOAD_SIGNING_SECRET)
    .update(`contact:${timestamp}`)
    .digest('hex');
}

function buildMessageMatch(query: {
  status?: MessageStatus;
  type?: MessageType;
  q?: string;
  assignee?: string;
}) {
  const match: Record<string, unknown> = {};
  if (query.status) match.status = query.status;
  if (query.type) match.type = query.type;
  if (query.assignee) match.assignedTo = query.assignee;
  if (query.q) {
    const q = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    match.$or = [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { subject: { $regex: q, $options: 'i' } },
      { orderNumber: { $regex: q, $options: 'i' } },
    ];
  }
  return match;
}

function pagination(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit);
  return { page, limit, total, totalPages, hasNextPage: page < totalPages };
}

async function sendSafeEmail(email: TransactionalEmail): Promise<void> {
  try {
    await getMailer().sendTransactionalEmail(email);
  } catch (error) {
    logger.error(
      { code: safeMailErrorCode(error) },
      'Contact message email delivery failed',
    );
  }
}

async function sendCustomRequestNotification(
  email: string,
  status: CustomRequestResponseStatus,
  message: string,
): Promise<CustomRequestNotificationStatus> {
  try {
    await getMailer().sendTransactionalEmail({
      to: email,
      subject:
        status === 'accepted'
          ? 'Your custom product request has been accepted'
          : 'An update about your custom product request',
      text: message,
      html: `<p>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</p>`,
    });
    return 'sent';
  } catch (error) {
    logger.error(
      { code: safeMailErrorCode(error), status },
      'Custom request notification email delivery failed',
    );
    return 'failed';
  }
}

function acknowledgementEmail(type: MessageType) {
  return {
    subject: 'We received your bulk quote request',
    text: `Thank you for your ${type.replaceAll('_', ' ')} request. We received it and will review it.`,
  };
}

function escapeHtml(value: string): string {
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
