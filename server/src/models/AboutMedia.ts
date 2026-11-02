import { Schema, model, models, type Document, type Model } from 'mongoose';

export const ABOUT_MEDIA_TYPES = ['image', 'video'] as const;
export type AboutMediaType = (typeof ABOUT_MEDIA_TYPES)[number];
export type AboutMediaResourceType = 'image' | 'video';

export interface IAboutMedia extends Document {
  type: AboutMediaType;
  title?: string;
  description?: string;
  altText?: string;
  cloudinaryPublicId: string;
  cloudinaryResourceType: AboutMediaResourceType;
  url: string;
  thumbnailUrl?: string;
  isPublished: boolean;
  sortOrder: number;
  width?: number;
  height?: number;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  createdAt: Date;
  updatedAt: Date;
}

const aboutMediaSchema = new Schema<IAboutMedia>(
  {
    type: { type: String, enum: ABOUT_MEDIA_TYPES, required: true },
    title: { type: String, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000 },
    altText: { type: String, trim: true, maxlength: 300 },
    cloudinaryPublicId: {
      type: String,
      required: true,
      trim: true,
      select: false,
    },
    cloudinaryResourceType: {
      type: String,
      enum: ['image', 'video'],
      required: true,
    },
    url: { type: String, required: true, trim: true, match: /^https:\/\// },
    thumbnailUrl: {
      type: String,
      trim: true,
      match: /^https:\/\//,
    },
    isPublished: { type: Boolean, default: false, index: true },
    sortOrder: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isInteger,
    },
    width: { type: Number, min: 1, validate: Number.isInteger },
    height: { type: Number, min: 1, validate: Number.isInteger },
    mimeType: {
      type: String,
      required: true,
      trim: true,
      match: /^(image|video)\/[a-z0-9.+-]+$/,
    },
    sizeBytes: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
    },
    durationSeconds: { type: Number, min: 0 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

aboutMediaSchema.pre('validate', function () {
  if (
    this.type &&
    this.cloudinaryResourceType &&
    this.cloudinaryResourceType !== this.type
  ) {
    this.invalidate(
      'cloudinaryResourceType',
      'Cloudinary resource type must match the media type',
    );
  }
  if (
    this.type &&
    this.mimeType &&
    !this.mimeType.startsWith(`${this.type}/`)
  ) {
    this.invalidate('mimeType', 'MIME type must match the media type');
  }
});

aboutMediaSchema.index({ isPublished: 1, sortOrder: 1, _id: 1 });
aboutMediaSchema.index({ sortOrder: 1, _id: 1 });

export const AboutMedia: Model<IAboutMedia> =
  (models.AboutMedia as Model<IAboutMedia> | undefined) ??
  model<IAboutMedia>('AboutMedia', aboutMediaSchema);
