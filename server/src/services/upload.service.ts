import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { NextFunction, Response } from 'express';
import mongoose, { Types } from 'mongoose';

import { env } from '../config/env';
import {
  ArtworkAsset,
  Cart,
  CustomOffer,
  Message,
  Order,
  Product,
  SiteSettings,
  User,
  type IArtworkAsset,
} from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { detectArtworkMime } from '../utils/artworkFileType';
import { logAuditEvent } from './audit.service';
import {
  getArtworkStorageMeta,
  getStorageDriver as getDriverFor,
  type StorageDriver,
} from './storage';
import { applyArtworkDecisionToOrder as applyOrderArtworkDecision } from './orderWorkflow.service';

export const DEFAULT_ARTWORK_TYPES = [
  'image/png',
  'image/jpeg',
  'application/pdf',
  'image/svg+xml',
];
const ORPHAN_FILE_GRACE_MS = 24 * 60 * 60 * 1000;
const activeArtworkUploads = new Set<string>();

export interface ArtworkIdentity {
  user?: IUser;
  sessionId?: string;
}

export interface UploadedArtworkFile {
  buffer: Buffer;
  originalname: string;
}

export interface ArtworkMetadata {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  detectedMimeType: string;
  width?: number;
  height?: number;
  reviewStatus: string;
  createdAt: Date;
}

export interface ArtworkReviewQuery {
  page: number;
  limit: number;
  reviewStatus?: 'pending' | 'approved' | 'replacement_requested';
  from?: Date;
  to?: Date;
  orderNumber?: string;
}

export async function saveArtworkUpload(
  identity: ArtworkIdentity,
  file: UploadedArtworkFile | undefined,
  imageOnly = false,
  storage: StorageDriver = getDriverFor(),
): Promise<ArtworkMetadata> {
  if (!file) throw new AppError('A file is required', 400, 'NO_FILE');
  const settings = await SiteSettings.findOne({ key: 'default' })
    .select('artworkLimits')
    .lean();
  const maxBytes = Math.min(
    settings?.artworkLimits?.maxBytes ?? env.UPLOAD_MAX_BYTES,
    env.UPLOAD_MAX_BYTES,
  );
  if (file.buffer.byteLength > maxBytes) {
    throw new AppError('File exceeds the allowed size', 413, 'FILE_TOO_LARGE');
  }

  const detectedMimeType = await detectArtworkMime(file.buffer);
  if (
    imageOnly &&
    !['image/jpeg', 'image/png', 'image/webp'].includes(detectedMimeType)
  ) {
    throw new AppError(
      'Reference images must be JPEG, PNG or WebP',
      415,
      'FILE_TYPE_NOT_ALLOWED',
    );
  }
  const allowedTypes = imageOnly
    ? ['image/jpeg', 'image/png', 'image/webp']
    : settings?.artworkLimits?.allowedMimeTypes.length
      ? settings.artworkLimits.allowedMimeTypes
      : DEFAULT_ARTWORK_TYPES;
  if (!allowedTypes.includes(detectedMimeType)) {
    throw new AppError(
      'This file type is not allowed',
      415,
      'FILE_TYPE_NOT_ALLOWED',
    );
  }

  let width: number | undefined;
  let height: number | undefined;
  if (
    detectedMimeType.startsWith('image/') &&
    detectedMimeType !== 'image/svg+xml'
  ) {
    try {
      const metadata = await sharp(file.buffer, { failOn: 'error' }).metadata();
      if (!metadata.width || !metadata.height)
        throw new Error('Missing dimensions');
      width = metadata.width;
      height = metadata.height;
    } catch {
      throw new AppError('The image file is corrupt', 400, 'FILE_CORRUPT');
    }
  }

  const extension = extensionForMime(detectedMimeType);
  const storageResourceType: 'image' | 'raw' =
    detectedMimeType === 'application/pdf' ||
    detectedMimeType === 'image/svg+xml'
      ? 'raw'
      : 'image';
  const now = new Date();
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`;
  const uniqueId = randomUUID();
  const storageKey =
    env.STORAGE_DRIVER === 'cloudinary'
      ? `dainty-bloom/private-artwork/${datePath}/${uniqueId}${storageResourceType === 'raw' ? `.${extension}` : ''}`
      : `${datePath}/${uniqueId}.${extension}`;
  const storageMeta = {
    contentType: detectedMimeType,
    resourceType: storageResourceType,
  };
  activeArtworkUploads.add(storageKey);
  try {
    try {
      await storage.put(storageKey, file.buffer, storageMeta);
    } catch {
      throw new AppError(
        'Private artwork storage is unavailable',
        503,
        'ARTWORK_STORAGE_ERROR',
      );
    }

    try {
      const artwork = await ArtworkAsset.create({
        ...(identity.user
          ? { owner: identity.user._id }
          : { sessionId: identity.sessionId }),
        storageKey,
        storageDriver: env.STORAGE_DRIVER,
        storageResourceType,
        originalFilename: normalizeFilename(file.originalname),
        detectedMimeType,
        sizeBytes: file.buffer.byteLength,
        width,
        height,
        checksum: createHash('sha256').update(file.buffer).digest('hex'),
        reviewStatus: 'pending',
      });
      return artworkMetadata(artwork);
    } catch (error) {
      try {
        await storage.delete(storageKey, storageMeta);
      } catch {
        throw new AppError(
          'Private artwork storage cleanup failed',
          500,
          'ARTWORK_STORAGE_ERROR',
        );
      }
      throw error;
    }
  } finally {
    activeArtworkUploads.delete(storageKey);
  }
}

export async function getArtworkMetadata(
  id: string,
  identity: ArtworkIdentity,
  staff: boolean,
  actor?: IUser,
): Promise<ArtworkMetadata> {
  const artwork = await findArtwork(id);
  if (!staff && !ownsArtwork(artwork, identity)) {
    throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
  }
  if (staff) await auditStaffAccess(actor, artwork, 'artwork.metadata_access');
  return artworkMetadata(artwork);
}

export async function streamArtwork(
  id: string,
  identity: ArtworkIdentity,
  staff: boolean,
  response: Response,
  next: NextFunction,
  actor?: IUser,
): Promise<void> {
  const artwork = await findArtwork(id);
  if (!staff && !ownsArtwork(artwork, identity)) {
    throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
  }
  if (staff) await auditStaffAccess(actor, artwork, 'artwork.file_access');
  setPrivateDownloadHeaders(response, artwork);
  pipePrivateFile(artwork, response, next);
}

export async function streamArtworkPreview(
  id: string,
  identity: ArtworkIdentity,
  staff: boolean,
  response: Response,
  next: NextFunction,
  actor?: IUser,
): Promise<void> {
  const artwork = await findArtwork(id);
  if (!staff && !ownsArtwork(artwork, identity)) {
    throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
  }
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(
      artwork.detectedMimeType,
    )
  ) {
    throw new AppError(
      'A preview is not available for this artwork type',
      415,
      'ARTWORK_PREVIEW_UNAVAILABLE',
    );
  }
  if (staff) await auditStaffAccess(actor, artwork, 'artwork.preview_access');
  response.setHeader('Content-Disposition', 'inline');
  response.setHeader('Content-Type', artwork.detectedMimeType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Length', artwork.sizeBytes);
  pipePrivateFile(artwork, response, next);
}

export async function makeArtworkDownloadLink(
  id: string,
  actor: IUser,
): Promise<{ token: string; expiresAt: Date }> {
  const artwork = await findArtwork(id);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const token = signDownloadToken(
    artwork._id.toString(),
    expiresAt.getTime(),
    actor._id.toString(),
  );
  await auditStaffAccess(actor, artwork, 'artwork.download_link');
  return { token, expiresAt };
}

export async function streamSignedArtwork(
  token: string,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = parseDownloadToken(token);
  const artwork = await findArtwork(parsed.id);
  const actor = await User.findById(parsed.actorId);
  if (!actor) throw invalidSignedToken();
  await auditStaffAccess(actor, artwork, 'artwork.signed_file_access');
  setPrivateDownloadHeaders(response, artwork);
  pipePrivateFile(artwork, response, next);
}

export async function deleteArtwork(
  id: string,
  identity: ArtworkIdentity,
): Promise<void> {
  const artwork = await findArtwork(id);
  if (!ownsArtwork(artwork, identity)) {
    throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
  }
  if (
    artwork.order ||
    (await Order.exists({ 'items.artwork': artwork._id })) ||
    artwork.cartItemId ||
    (await Cart.exists({ 'items.artwork': artwork._id })) ||
    artwork.supersedes ||
    (await ArtworkAsset.exists({ supersedes: artwork._id })) ||
    artwork.message ||
    artwork.customOffer ||
    (await CustomOffer.exists({ image: artwork._id })) ||
    (await Message.exists({ attachment: artwork._id }))
  ) {
    throw new AppError(
      'Artwork with active references or history cannot be deleted',
      409,
      'ARTWORK_ATTACHED_TO_ORDER',
    );
  }
  await getDriverFor(artwork.storageDriver).delete(
    artwork.storageKey,
    getArtworkStorageMeta(artwork),
  );
  await artwork.deleteOne();
}

export async function listArtworkForReview(
  query: ArtworkReviewQuery,
  actor: IUser,
): Promise<unknown> {
  const match: Record<string, unknown> = {};
  if (query.reviewStatus) match.reviewStatus = query.reviewStatus;
  if (query.from || query.to) {
    match.createdAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }
  if (query.orderNumber) {
    const order = await Order.findOne({ orderNumber: query.orderNumber })
      .select('_id')
      .lean();
    if (!order) return { items: [], pagination: pagination(query, 0) };
    match.order = order._id;
  }
  const [items, total] = await Promise.all([
    ArtworkAsset.find(match)
      .select('-storageKey')
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    ArtworkAsset.countDocuments(match),
  ]);
  const orderIds = items.flatMap((item) => (item.order ? [item.order] : []));
  const orders = await Order.find({ _id: { $in: orderIds } })
    .select('orderNumber items')
    .lean();
  const orderMap = new Map(
    orders.map((order) => [order._id.toString(), order]),
  );
  for (const item of items) {
    await logAuditEvent({
      actor,
      action: 'artwork.metadata_access',
      targetType: 'ArtworkAsset',
      targetId: item._id.toString(),
      metadata: { orderId: item.order?.toString() },
    });
  }
  return {
    items: items.map((item) => ({
      id: item._id.toString(),
      originalFilename: item.originalFilename,
      sizeBytes: item.sizeBytes,
      detectedMimeType: item.detectedMimeType,
      width: item.width,
      height: item.height,
      reviewStatus: item.reviewStatus,
      reviewedAt: item.reviewedAt,
      reviewNote: item.reviewNote,
      createdAt: item.createdAt,
      orderNumber: item.order
        ? orderMap.get(item.order.toString())?.orderNumber
        : undefined,
      productTitle: item.order
        ? findOrderItemTitle(
            orderMap.get(item.order.toString())?.items,
            item.orderItemId,
          )
        : undefined,
    })),
    pagination: pagination(query, total),
  };
}

export async function getArtworkReviewDetail(
  id: string,
  actor: IUser,
): Promise<unknown> {
  const artwork = await findArtwork(id);
  await auditStaffAccess(actor, artwork, 'artwork.metadata_access');
  const result: Record<string, unknown> = {
    ...artworkMetadata(artwork),
    order: null,
    linkedOrderItem: null,
  };
  if (!artwork.order) return result;
  const order = await Order.findById(artwork.order)
    .select('orderNumber items')
    .lean();
  const orderItem = order?.items.find(
    (item) => item._id.toString() === artwork.orderItemId?.toString(),
  );
  const product = orderItem
    ? await Product.findById(orderItem.product).select('title').lean()
    : null;
  return {
    ...result,
    order: { orderNumber: order?.orderNumber },
    linkedOrderItem: orderItem
      ? {
          id: orderItem._id,
          productTitle: product?.title ?? orderItem.titleSnapshot,
          selectedOptions: orderItem.selectedOptions,
        }
      : null,
  };
}

export async function reviewArtwork(
  id: string,
  decision: 'approved' | 'replacement_requested',
  note: string | undefined,
  actor: IUser,
): Promise<ArtworkMetadata> {
  if (decision === 'replacement_requested' && !note?.trim()) {
    throw new AppError(
      'A note is required when requesting a replacement',
      400,
      'REVIEW_NOTE_REQUIRED',
    );
  }
  const artwork = await findArtwork(id);
  if (artwork.order && artwork.orderItemId) {
    await applyOrderArtworkDecision(
      artwork.order,
      artwork.orderItemId,
      decision,
      note,
      actor,
    );
    const updated = await findArtwork(id);
    return artworkMetadata(updated);
  }
  const reviewedAt = new Date();
  const updated = await ArtworkAsset.findOneAndUpdate(
    { _id: artwork._id, reviewStatus: 'pending' },
    {
      $set: {
        reviewStatus: decision,
        reviewedBy: actor._id,
        reviewedAt,
        reviewNote: note?.trim(),
      },
    },
    { new: true, runValidators: true },
  );
  if (!updated) {
    return throwArtworkReviewConflict(artwork._id.toString());
  }
  await logAuditEvent({
    actor,
    action: `artwork.${decision}`,
    targetType: 'ArtworkAsset',
    targetId: updated._id.toString(),
    metadata: { decision, orderId: updated.order?.toString() },
  });
  return artworkMetadata(updated);
}

async function throwArtworkReviewConflict(id: string): Promise<never> {
  const exists = await ArtworkAsset.exists({ _id: id });
  if (!exists) {
    throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
  }
  throw new AppError(
    'Artwork is no longer pending review',
    409,
    'ARTWORK_NOT_PENDING',
  );
}

export async function applyArtworkDecisionToOrder(
  orderId: Types.ObjectId,
  itemId: Types.ObjectId,
  decision: 'approved' | 'replacement_requested',
  note: string | undefined,
  actor: IUser,
): Promise<void> {
  await applyOrderArtworkDecision(orderId, itemId, decision, note, actor);
}

export async function cleanupUnattachedArtwork(
  storageOverride?: StorageDriver,
): Promise<{ deletedRecords: number; deletedFiles: number }> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await clearStaleCartItemReferences(now);
  const stale = await ArtworkAsset.find({
    createdAt: { $lt: cutoff },
    cartItemId: { $exists: false },
    order: { $exists: false },
    message: { $exists: false },
    supersedes: { $exists: false },
  }).select('+storageKey');
  const staleIds = stale.map((artwork) => artwork._id);
  const [
    cartReferences,
    orderReferences,
    messageAssets,
    supersessionReferences,
  ] = await Promise.all([
    Cart.find({ 'items.artwork': { $in: staleIds } })
      .select('items.artwork')
      .lean(),
    Order.find({ 'items.artwork': { $in: staleIds } })
      .select('items.artwork')
      .lean(),
    Message.find({ attachment: { $in: staleIds } })
      .select('attachment')
      .lean(),
    ArtworkAsset.find({ supersedes: { $in: staleIds } })
      .select('supersedes')
      .lean(),
  ]);
  const attachedIds = new Set([
    ...cartReferences.flatMap((cart) =>
      cart.items.flatMap((item) =>
        item.artwork ? [item.artwork.toString()] : [],
      ),
    ),
    ...orderReferences.flatMap((order) =>
      order.items.flatMap((item) =>
        item.artwork ? [item.artwork.toString()] : [],
      ),
    ),
    ...messageAssets.flatMap((message) =>
      message.attachment ? [message.attachment.toString()] : [],
    ),
    ...supersessionReferences.flatMap((artwork) =>
      artwork.supersedes ? [artwork.supersedes.toString()] : [],
    ),
  ]);
  let deletedRecords = 0;
  for (const artwork of stale) {
    if (attachedIds.has(artwork._id.toString())) continue;
    const storage =
      storageOverride && artwork.storageDriver === env.STORAGE_DRIVER
        ? storageOverride
        : getDriverFor(artwork.storageDriver);
    await storage.delete(artwork.storageKey, getArtworkStorageMeta(artwork));
    await artwork.deleteOne();
    deletedRecords += 1;
  }
  const directory = path.resolve(env.STORAGE_PRIVATE_DIR);
  await mkdir(directory, { recursive: true });
  const knownKeys = new Set(
    (
      await ArtworkAsset.find({ storageDriver: 'local' })
        .select('+storageKey')
        .lean()
    ).map((item) => item.storageKey),
  );
  const files = await listFiles(directory);
  let deletedFiles = 0;
  const localStorage = getDriverFor('local');
  for (const file of files) {
    const key = path.relative(directory, file).split(path.sep).join('/');
    const fileStat = await stat(file);
    const isOldOrphan =
      fileStat.mtimeMs <= now.getTime() - ORPHAN_FILE_GRACE_MS;
    if (isOldOrphan && !activeArtworkUploads.has(key) && !knownKeys.has(key)) {
      await localStorage.delete(key);
      deletedFiles += 1;
    }
  }
  return { deletedRecords, deletedFiles };
}

async function clearStaleCartItemReferences(now: Date): Promise<void> {
  const expiredGuestCarts = await Cart.find({
    sessionId: { $exists: true, $ne: '' },
    expiresAt: { $lte: now },
  })
    .select('items._id items.artwork')
    .lean();

  for (const cart of expiredGuestCarts) {
    for (const item of cart.items) {
      if (!item.artwork) continue;

      const artwork = await ArtworkAsset.findOne({
        _id: item.artwork,
        cartItemId: item._id,
      }).select('order message');
      if (!artwork || artwork.order || artwork.message) continue;

      const [orderReference, messageReference] = await Promise.all([
        Order.exists({ 'items.artwork': item.artwork }),
        Message.exists({ attachment: item.artwork }),
      ]);
      if (orderReference || messageReference) continue;

      const cartUpdate = await Cart.updateOne(
        {
          _id: cart._id,
          sessionId: { $exists: true, $ne: '' },
          expiresAt: { $lte: now },
        },
        { $unset: { 'items.$[line].artwork': 1 } },
        {
          arrayFilters: [
            { 'line._id': item._id, 'line.artwork': item.artwork },
          ],
        },
      );
      if (cartUpdate.modifiedCount === 0) continue;

      await ArtworkAsset.updateOne(
        {
          _id: item.artwork,
          cartItemId: item._id,
          order: { $exists: false },
          message: { $exists: false },
        },
        { $unset: { cartItemId: 1 } },
      );
    }
  }

  const candidates = await ArtworkAsset.find({
    cartItemId: { $exists: true },
    order: { $exists: false },
    message: { $exists: false },
  })
    .select('_id cartItemId')
    .lean();

  for (const artwork of candidates) {
    if (!artwork.cartItemId) continue;
    const cartReference = await Cart.exists({
      items: {
        $elemMatch: {
          _id: artwork.cartItemId,
          artwork: artwork._id,
        },
      },
    });
    if (cartReference) continue;

    const [orderReference, messageReference] = await Promise.all([
      Order.exists({ 'items.artwork': artwork._id }),
      Message.exists({ attachment: artwork._id }),
    ]);
    if (orderReference || messageReference) continue;

    await ArtworkAsset.updateOne(
      {
        _id: artwork._id,
        cartItemId: artwork.cartItemId,
        order: { $exists: false },
        message: { $exists: false },
      },
      { $unset: { cartItemId: 1 } },
    );
  }
}

async function findArtwork(id: string): Promise<IArtworkAsset> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
  }
  const artwork = await ArtworkAsset.findById(id).select('+storageKey');
  if (!artwork)
    throw new AppError('Artwork not found', 404, 'ARTWORK_NOT_FOUND');
  return artwork;
}

function ownsArtwork(
  artwork: IArtworkAsset,
  identity: ArtworkIdentity,
): boolean {
  return identity.user
    ? artwork.owner?.toString() === identity.user._id.toString()
    : Boolean(identity.sessionId && artwork.sessionId === identity.sessionId);
}

function artworkMetadata(artwork: IArtworkAsset): ArtworkMetadata {
  return {
    id: artwork._id.toString(),
    originalFilename: artwork.originalFilename,
    sizeBytes: artwork.sizeBytes,
    detectedMimeType: artwork.detectedMimeType,
    width: artwork.width,
    height: artwork.height,
    reviewStatus: artwork.reviewStatus,
    createdAt: artwork.createdAt,
  };
}

function signDownloadToken(
  id: string,
  expiresAt: number,
  actorId: string,
): string {
  const payload = `${id}.${expiresAt}.${actorId}`;
  const signature = createHmac('sha256', env.UPLOAD_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}

function parseDownloadToken(token: string): { id: string; actorId: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw invalidSignedToken();
  }
  const [id, expires, actorId, signature, extra] = decoded.split('.');
  if (
    !id ||
    !expires ||
    !actorId ||
    !signature ||
    extra ||
    !mongoose.isValidObjectId(id) ||
    !mongoose.isValidObjectId(actorId)
  ) {
    throw invalidSignedToken();
  }
  const expiresAt = Number(expires);
  const payload = `${id}.${expires}.${actorId}`;
  const expected = createHmac('sha256', env.UPLOAD_SIGNING_SECRET)
    .update(payload)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, 'hex');
  } catch {
    throw invalidSignedToken();
  }
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw invalidSignedToken();
  }
  return { id, actorId };
}

function invalidSignedToken(): AppError {
  return new AppError(
    'Download link is invalid or expired',
    401,
    'INVALID_DOWNLOAD_LINK',
  );
}

function setPrivateDownloadHeaders(
  response: Response,
  artwork: IArtworkAsset,
): void {
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeHeaderFilename(artwork.originalFilename)}"`,
  );
  response.setHeader('Content-Type', artwork.detectedMimeType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Length', artwork.sizeBytes);
}

function pipePrivateFile(
  artwork: IArtworkAsset,
  response: Response,
  next: NextFunction,
): void {
  const storage = getDriverFor(artwork.storageDriver);
  const stream = storage.getStream(
    artwork.storageKey,
    getArtworkStorageMeta(artwork),
  );
  stream.once('error', (error: unknown) => {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    response.removeHeader('Content-Disposition');
    response.removeHeader('Content-Type');
    response.removeHeader('Content-Length');
    next(
      new AppError(
        'Private file could not be read',
        500,
        'ARTWORK_STORAGE_ERROR',
      ),
    );
  });
  stream.pipe(response);
}

async function auditStaffAccess(
  actor: IUser | undefined,
  artwork: IArtworkAsset,
  action: string,
): Promise<void> {
  if (!actor) {
    throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
  }
  await logAuditEvent({
    actor,
    action,
    targetType: 'ArtworkAsset',
    targetId: artwork._id.toString(),
    metadata: { orderId: artwork.order?.toString() },
  });
}

function extensionForMime(mime: string): string {
  const extensions: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'application/pdf': 'pdf',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
  };
  const extension = extensions[mime];
  if (!extension) {
    throw new AppError(
      'This file type is not allowed',
      415,
      'FILE_TYPE_NOT_ALLOWED',
    );
  }
  return extension;
}

function normalizeFilename(filename: string): string {
  return (
    filename
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/[\r\n"]/g, '')
      .slice(0, 200) || 'upload'
  );
}

function safeHeaderFilename(filename: string): string {
  return normalizeFilename(filename).replace(/[^\w.-]/g, '_');
}

function pagination(query: { page: number; limit: number }, total: number) {
  const totalPages = Math.ceil(total / query.limit);
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages,
    hasNextPage: query.page < totalPages,
  };
}

function findOrderItemTitle(
  items: Array<{ _id: Types.ObjectId; titleSnapshot: string }> | undefined,
  itemId: Types.ObjectId | undefined,
): string | undefined {
  return items?.find((item) => item._id.toString() === itemId?.toString())
    ?.titleSnapshot;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(fullPath);
      const fileStat = await stat(fullPath);
      return fileStat.isFile() ? [fullPath] : [];
    }),
  );
  return nested.flat();
}
