import { Schema, Types, type Document } from 'mongoose';

import {
  ARTWORK_REVIEW_STATUS,
  type ArtworkReviewStatus,
} from '../constants/artwork';

export const ARTWORK_ASSET_COLLECTION_NAME = 'artworkassets';

export interface IArtworkAsset extends Document {
  owner?: Types.ObjectId;
  sessionId?: string;
  storageKey: string;
  storageDriver: string;
  storageResourceType?: 'image' | 'raw';
  originalFilename: string;
  detectedMimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  checksum: string;
  supersedes?: Types.ObjectId;
  order?: Types.ObjectId;
  orderItemId?: Types.ObjectId;
  cartItemId?: Types.ObjectId;
  message?: Types.ObjectId;
  customOffer?: Types.ObjectId;
  reviewStatus: ArtworkReviewStatus;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const artworkAssetSchema = new Schema<IArtworkAsset>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    sessionId: { type: String, trim: true, index: true },
    storageKey: { type: String, required: true, trim: true, select: false },
    storageDriver: { type: String, required: true, trim: true },
    storageResourceType: {
      type: String,
      enum: ['image', 'raw'],
    },
    originalFilename: { type: String, required: true, trim: true },
    detectedMimeType: { type: String, required: true, trim: true },
    sizeBytes: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
    },
    width: { type: Number, min: 1, validate: Number.isInteger },
    height: { type: Number, min: 1, validate: Number.isInteger },
    checksum: { type: String, required: true, trim: true },
    supersedes: { type: Schema.Types.ObjectId, ref: 'ArtworkAsset' },
    order: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    orderItemId: { type: Schema.Types.ObjectId },
    cartItemId: { type: Schema.Types.ObjectId },
    message: { type: Schema.Types.ObjectId, ref: 'Message', index: true },
    customOffer: {
      type: Schema.Types.ObjectId,
      ref: 'CustomOffer',
      index: true,
    },
    reviewStatus: {
      type: String,
      enum: ARTWORK_REVIEW_STATUS,
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: { type: String, trim: true },
  },
  {
    timestamps: true,
    collection: ARTWORK_ASSET_COLLECTION_NAME,
  },
);

artworkAssetSchema.index({ owner: 1, createdAt: -1 });
artworkAssetSchema.index({ reviewStatus: 1, createdAt: -1 });
