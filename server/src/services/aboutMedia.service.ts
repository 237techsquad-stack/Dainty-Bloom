import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import type { UploadApiResponse } from 'cloudinary';

import { getCloudinary } from '../config/cloudinary';
import {
  AboutMedia,
  type AboutMediaType,
  type IAboutMedia,
} from '../models/AboutMedia';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { detectFileType } from '../utils/fileType';
import { logger } from '../utils/logger';
import { logAuditEvent } from './audit.service';

const MIME_TYPES: Record<string, { type: AboutMediaType; format: string }> = {
  'image/jpeg': { type: 'image', format: 'jpg' },
  'image/png': { type: 'image', format: 'png' },
  'image/webp': { type: 'image', format: 'webp' },
  'image/gif': { type: 'image', format: 'gif' },
  'video/mp4': { type: 'video', format: 'mp4' },
  'video/webm': { type: 'video', format: 'webm' },
  'video/quicktime': { type: 'video', format: 'mov' },
};

interface AboutMediaInput {
  buffer: Buffer;
  title?: string;
  description?: string;
  altText?: string;
}

interface AboutMediaUpdate {
  title?: string;
  description?: string;
  altText?: string;
  isPublished?: boolean;
}

export interface PublicAboutMedia {
  id: string;
  type: AboutMediaType;
  title?: string;
  description?: string;
  altText?: string;
  sortOrder: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  url: string;
  thumbnailUrl?: string;
}

export interface AdminAboutMedia extends PublicAboutMedia {
  isPublished: boolean;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

interface AboutMediaProjection {
  _id: { toString(): string };
  cloudinaryPublicId: string;
  type: AboutMediaType;
  title?: string;
  description?: string;
  altText?: string;
  isPublished: boolean;
  sortOrder: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  url: string;
  thumbnailUrl?: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function uploadAboutMedia(
  input: AboutMediaInput,
  actor: IUser,
): Promise<AdminAboutMedia> {
  const detected = await detectFileType(input.buffer);
  const file = detected ? MIME_TYPES[detected.mime] : undefined;
  if (!detected || !file) {
    throw new AppError(
      'Only JPEG, PNG, WebP, GIF, MP4, WebM, and MOV files are allowed',
      415,
      'FILE_TYPE_NOT_ALLOWED',
    );
  }

  const cloudinary = getCloudinary();
  const publicId = randomUUID();
  const lastRecord = await AboutMedia.findOne()
    .sort({ sortOrder: -1 })
    .select('sortOrder')
    .lean();
  let uploaded: UploadApiResponse;
  try {
    uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'dainty-bloom/about',
          public_id: publicId,
          overwrite: false,
          resource_type: file.type,
          type: 'upload',
          allowed_formats: [file.format],
          timeout: 120_000,
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error('Cloudinary returned no upload result'));
            return;
          }
          resolve(result);
        },
      );
      uploadStream.end(input.buffer);
    });
  } catch {
    throw new AppError(
      'About media upload failed',
      502,
      'ABOUT_MEDIA_UPLOAD_FAILED',
    );
  }

  const thumbnailUrl =
    file.type === 'video' ? videoThumbnailUrl(uploaded.public_id) : undefined;
  let media;
  try {
    media = await AboutMedia.create({
      type: file.type,
      title: input.title,
      description: input.description,
      altText: input.altText,
      cloudinaryPublicId: uploaded.public_id,
      cloudinaryResourceType: file.type,
      url: uploaded.secure_url,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      isPublished: false,
      sortOrder: (lastRecord?.sortOrder ?? -1) + 1,
      ...(uploaded.width ? { width: uploaded.width } : {}),
      ...(uploaded.height ? { height: uploaded.height } : {}),
      mimeType: detected.mime,
      sizeBytes: uploaded.bytes,
      ...(uploaded.duration !== undefined
        ? { durationSeconds: uploaded.duration }
        : {}),
    });
  } catch (error) {
    try {
      await destroyCloudinaryAsset(
        uploaded.public_id,
        file.type,
        'ABOUT_MEDIA_CLEANUP_FAILED',
      );
    } catch (cleanupError) {
      logger.error(
        { err: cleanupError, mediaType: file.type },
        'About media upload persistence failed and Cloudinary cleanup failed',
      );
    }
    throw error;
  }

  await auditAboutMediaChange(
    actor,
    media._id.toString(),
    'about_media.upload',
    {
      mediaType: media.type,
    },
  );
  return toAdminAboutMedia(media);
}

export async function listPublishedAboutMedia(): Promise<PublicAboutMedia[]> {
  const records = await AboutMedia.find({ isPublished: true })
    .select('+cloudinaryPublicId')
    .sort({ sortOrder: 1, _id: 1 })
    .lean();
  return records.map(toPublicAboutMedia);
}

export async function listAdminAboutMedia(): Promise<AdminAboutMedia[]> {
  const records = await AboutMedia.find()
    .select('+cloudinaryPublicId')
    .sort({ sortOrder: 1, _id: 1 })
    .lean();
  return records.map(toAdminAboutMedia);
}

export async function updateAboutMedia(
  id: string,
  input: AboutMediaUpdate,
  actor: IUser,
): Promise<AdminAboutMedia> {
  const media = await findAboutMedia(id, true);
  if (input.title !== undefined) media.title = input.title;
  if (input.description !== undefined) media.description = input.description;
  if (input.altText !== undefined) media.altText = input.altText;
  if (input.isPublished !== undefined) media.isPublished = input.isPublished;
  await saveAboutMedia(media);
  await auditAboutMediaChange(
    actor,
    media._id.toString(),
    'about_media.update',
    { changedFields: Object.keys(input) },
  );
  return toAdminAboutMedia(media);
}

export async function reorderAboutMedia(
  mediaIds: string[],
  actor: IUser,
): Promise<void> {
  const records = await AboutMedia.find().select('_id __v').lean();
  const existingIds = records.map((record) => record._id.toString());
  if (
    mediaIds.length !== existingIds.length ||
    new Set(mediaIds).size !== mediaIds.length ||
    mediaIds.some((id) => !existingIds.includes(id))
  ) {
    throw new AppError(
      'mediaIds must contain each About media item exactly once',
      400,
      'INVALID_MEDIA_ORDER',
    );
  }

  const versions = new Map(
    records.map((record) => [record._id.toString(), record.__v]),
  );
  if (mediaIds.length > 0) {
    const result = await AboutMedia.bulkWrite(
      mediaIds.map((id, sortOrder) => ({
        updateOne: {
          filter: {
            _id: new mongoose.Types.ObjectId(id),
            __v: versions.get(id),
          },
          update: { $set: { sortOrder }, $inc: { __v: 1 } },
        },
      })),
    );
    if (result.matchedCount !== mediaIds.length) {
      throw new AppError(
        'About media changed in another request. Reload and try again.',
        409,
        'ABOUT_MEDIA_CONFLICT',
      );
    }
  }
  await auditAboutMediaChange(actor, 'collection', 'about_media.reorder', {
    itemCount: mediaIds.length,
    changedFields: ['sortOrder'],
  });
}

export async function deleteAboutMedia(
  id: string,
  actor: IUser,
): Promise<void> {
  const media = await findAboutMedia(id, true);
  await media.deleteOne();

  let cleanup: 'succeeded' | 'failed' = 'succeeded';
  try {
    await destroyCloudinaryAsset(
      media.cloudinaryPublicId,
      media.cloudinaryResourceType,
      'ABOUT_MEDIA_DELETE_FAILED',
    );
  } catch (error) {
    cleanup = 'failed';
    logger.error(
      { err: error, mediaType: media.type },
      'About media record was deleted but Cloudinary cleanup failed',
    );
    await auditAboutMediaChange(actor, id, 'about_media.delete', {
      storageCleanup: cleanup,
    });
    throw error;
  }

  await auditAboutMediaChange(actor, id, 'about_media.delete', {
    storageCleanup: cleanup,
  });
}

async function findAboutMedia(id: string, includeCloudinaryId = false) {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('About media not found', 404, 'ABOUT_MEDIA_NOT_FOUND');
  }
  const query = AboutMedia.findById(id);
  if (includeCloudinaryId) query.select('+cloudinaryPublicId');
  const media = await query;
  if (!media) {
    throw new AppError('About media not found', 404, 'ABOUT_MEDIA_NOT_FOUND');
  }
  return media;
}

async function saveAboutMedia(
  media: Awaited<ReturnType<typeof findAboutMedia>>,
): Promise<void> {
  try {
    await media.save();
  } catch (error) {
    if (error instanceof mongoose.Error.VersionError) {
      throw new AppError(
        'About media changed in another request. Reload and try again.',
        409,
        'ABOUT_MEDIA_CONFLICT',
      );
    }
    throw error;
  }
}

async function destroyCloudinaryAsset(
  publicId: string,
  resourceType: 'image' | 'video',
  code: string,
): Promise<void> {
  try {
    const result = await getCloudinary().uploader.destroy(publicId, {
      invalidate: true,
      resource_type: resourceType,
      type: 'upload',
    });
    if (result.result !== 'ok' && result.result !== 'not found') {
      throw new Error('Cloudinary asset deletion was not confirmed');
    }
  } catch {
    throw new AppError('Cloudinary media cleanup failed', 502, code);
  }
}

function toPublicAboutMedia(record: AboutMediaProjection): PublicAboutMedia {
  const thumbnailUrl =
    record.type === 'video' && record.cloudinaryPublicId
      ? videoThumbnailUrl(record.cloudinaryPublicId)
      : record.thumbnailUrl;
  return {
    id: record._id.toString(),
    type: record.type,
    ...(record.title ? { title: record.title } : {}),
    ...(record.description ? { description: record.description } : {}),
    ...(record.altText ? { altText: record.altText } : {}),
    sortOrder: record.sortOrder,
    ...(record.width ? { width: record.width } : {}),
    ...(record.height ? { height: record.height } : {}),
    ...(record.durationSeconds !== undefined
      ? { durationSeconds: record.durationSeconds }
      : {}),
    url: record.url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
}

function videoThumbnailUrl(publicId: string): string {
  return getCloudinary().url(publicId, {
    secure: true,
    resource_type: 'video',
    format: 'jpg',
    transformation: [{ width: 640, height: 360, crop: 'fit' }],
  });
}

function toAdminAboutMedia(
  record: IAboutMedia | AboutMediaProjection,
): AdminAboutMedia {
  return {
    ...toPublicAboutMedia(record),
    isPublished: record.isPublished,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function auditAboutMediaChange(
  actor: IUser,
  targetId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await logAuditEvent({
      actor,
      action,
      targetType: 'AboutMedia',
      targetId,
      metadata,
    });
  } catch (error) {
    logger.error(
      { err: error, action },
      'About media change succeeded but audit logging failed',
    );
  }
}
