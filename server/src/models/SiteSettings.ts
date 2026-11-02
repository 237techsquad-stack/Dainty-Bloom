import { Schema, model, models, type Document, type Model } from 'mongoose';

import { env } from '../config/env';

export interface ISiteSettings extends Document {
  createdAt: Date;
  updatedAt: Date;
  key: string;
  storeName: string;
  currency: string;
  country: string;
  announcementBar: { enabled: boolean; text: string };
  turnaroundMessage: string;
  supportedCountries: string[];
  artworkLimits: { maxBytes: number; allowedMimeTypes: string[] };
  guestCheckoutEnabled: boolean;
  shippingFlatMinor: number;
  freeShippingThresholdMinor?: number | null;
  taxRateBasisPoints: number;
  shippingConfigured: boolean;
  taxConfigured: boolean;
  orderCancellationWindowNote: string;
  socialLinks: { instagram: string; tiktok: string; whatsapp: string };
  contactEmail: string;
  contactPhone: string;
  whatsappNumber: string;
  studioAddress: { label: string; city: string; country: string };
  openingHours: Array<{
    days: string[];
    open: string;
    close: string;
    timezone: string;
  }>;
  openingHoursDisplayText: string;
  aboutNote: string;
  productLines: Array<{
    key: string;
    label: string;
    description: string;
    isActive: boolean;
  }>;
  contact: {
    email: string;
    phone: string;
    address: string;
    openingHours: string[];
  };
}

const siteSettingsSchema = new Schema<ISiteSettings>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    storeName: {
      type: String,
      required: true,
      default: 'Dainty Bloom',
      trim: true,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      enum: ['GBP'],
      default: () => env.DEFAULT_CURRENCY,
    },
    country: { type: String, uppercase: true, default: '' },
    announcementBar: {
      enabled: { type: Boolean, default: false },
      text: { type: String, default: '' },
    },
    turnaroundMessage: { type: String, default: '' },
    supportedCountries: { type: [String], default: [] },
    artworkLimits: {
      maxBytes: {
        type: Number,
        required: true,
        min: 1,
        default: () => env.UPLOAD_MAX_BYTES,
      },
      allowedMimeTypes: { type: [String], default: [] },
    },
    guestCheckoutEnabled: { type: Boolean, default: false },
    shippingFlatMinor: { type: Number, min: 0, default: 0 },
    freeShippingThresholdMinor: { type: Number, min: 0 },
    taxRateBasisPoints: { type: Number, min: 0, max: 10000, default: 0 },
    shippingConfigured: { type: Boolean, default: false },
    taxConfigured: { type: Boolean, default: false },
    orderCancellationWindowNote: { type: String, default: '', trim: true },
    contact: {
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      address: { type: String, default: '' },
      openingHours: { type: [String], default: [] },
    },
    socialLinks: {
      instagram: { type: String, default: '' },
      tiktok: { type: String, default: '' },
      whatsapp: { type: String, default: '' },
    },
    contactEmail: { type: String, lowercase: true, trim: true, default: '' },
    contactPhone: { type: String, trim: true, default: '' },
    whatsappNumber: { type: String, trim: true, default: '' },
    studioAddress: {
      label: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      country: { type: String, trim: true, default: '' },
    },
    openingHours: {
      type: [
        new Schema(
          {
            days: { type: [String], default: [] },
            open: { type: String, trim: true },
            close: { type: String, trim: true },
            timezone: { type: String, trim: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    openingHoursDisplayText: { type: String, trim: true, default: '' },
    aboutNote: { type: String, trim: true, default: '' },
    productLines: {
      type: [
        new Schema(
          {
            key: { type: String, required: true, trim: true },
            label: { type: String, required: true, trim: true },
            description: { type: String, required: true, trim: true },
            isActive: { type: Boolean, default: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const SiteSettings: Model<ISiteSettings> =
  (models.SiteSettings as Model<ISiteSettings> | undefined) ??
  model<ISiteSettings>('SiteSettings', siteSettingsSchema);
