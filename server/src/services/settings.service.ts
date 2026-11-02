import { env } from '../config/env';
import { SiteSettings } from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import {
  getCachedPublicValue,
  invalidatePublicCache,
} from '../utils/publicCache';
import { logAuditEvent } from './audit.service';
import { DEFAULT_ARTWORK_TYPES } from './upload.service';

export async function getAdminSettings(): Promise<Record<string, unknown>> {
  const settings = await SiteSettings.findOne({ key: 'default' }).lean();
  if (!settings)
    throw new AppError('Site settings not found', 500, 'SETTINGS_NOT_FOUND');
  return {
    ...settings,
    shippingFlatMinor: settings.shippingFlatMinor ?? 0,
    taxRateBasisPoints: settings.taxRateBasisPoints ?? 0,
    shippingConfigured: settings.shippingConfigured ?? false,
    taxConfigured: settings.taxConfigured ?? false,
    orderCancellationWindowNote: settings.orderCancellationWindowNote ?? '',
  };
}

export function getPublicSettings(): Promise<Record<string, unknown>> {
  return getCachedPublicValue('settings:public', async () => {
    const settings = await SiteSettings.findOne({ key: 'default' })
      .select(
        'storeName currency country supportedCountries announcementBar turnaroundMessage contact guestCheckoutEnabled shippingConfigured socialLinks contactEmail contactPhone whatsappNumber studioAddress openingHours openingHoursDisplayText aboutNote productLines artworkLimits',
      )
      .lean();
    if (!settings)
      throw new AppError('Site settings not found', 500, 'SETTINGS_NOT_FOUND');
    return {
      storeName: settings.storeName,
      currency: settings.currency,
      country: settings.country ?? '',
      supportedCountries: settings.supportedCountries ?? [],
      announcementBar: settings.announcementBar,
      turnaroundMessage: settings.turnaroundMessage,
      contact: settings.contact,
      guestCheckoutEnabled: settings.guestCheckoutEnabled ?? false,
      shippingConfigured: settings.shippingConfigured ?? false,
      socialLinks: settings.socialLinks,
      contactEmail: settings.contactEmail || settings.contact.email,
      contactPhone: settings.contactPhone || settings.contact.phone,
      whatsappNumber: settings.whatsappNumber,
      studioAddress: settings.studioAddress,
      openingHours: settings.openingHours,
      openingHoursDisplayText: settings.openingHoursDisplayText,
      aboutNote: settings.aboutNote,
      productLines: settings.productLines ?? [],
      artwork: {
        maxBytes: Math.min(
          settings.artworkLimits?.maxBytes ?? env.UPLOAD_MAX_BYTES,
          env.UPLOAD_MAX_BYTES,
        ),
        allowedMimeTypes: settings.artworkLimits?.allowedMimeTypes.length
          ? settings.artworkLimits.allowedMimeTypes
          : DEFAULT_ARTWORK_TYPES,
      },
      stripePublishableKey:
        env.PAYMENT_PROVIDER === 'stripe'
          ? (env.STRIPE_PUBLISHABLE_KEY ?? null)
          : null,
    };
  });
}

export async function updateSettings(
  input: Record<string, unknown>,
  actor: IUser,
): Promise<Record<string, unknown>> {
  const settings = await SiteSettings.findOneAndUpdate(
    { key: 'default' },
    { $set: input },
    { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true },
  );
  invalidatePublicCache('settings:public');
  await logAuditEvent({
    actor,
    action: 'settings.update',
    targetType: 'SiteSettings',
    targetId: settings._id.toString(),
    metadata: { changedFields: Object.keys(input) },
  });
  return { ...settings.toObject() };
}
