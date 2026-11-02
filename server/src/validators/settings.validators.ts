import { z } from 'zod';

const minorUnits = z.number().int().min(0);
const phoneNumber = z
  .string()
  .trim()
  .max(30)
  .refine((value) => value === '' || /^\+?[0-9][0-9\s().-]{5,28}$/.test(value));
const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    if (value === '') return true;
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  });
const contactSchema = z
  .object({
    email: z.string().email().or(z.literal('')),
    phone: z.string().max(100),
    address: z.string().max(500),
    openingHours: z.array(z.string().trim().max(200)).max(14),
  })
  .strict();

const settingsFields = z
  .object({
    storeName: z.string().trim().min(1).max(120).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    announcementBar: z
      .object({
        enabled: z.boolean(),
        text: z.string().max(500),
      })
      .strict()
      .optional(),
    turnaroundMessage: z.string().max(1000).optional(),
    contact: contactSchema.optional(),
    contactEmail: z
      .string()
      .trim()
      .email()
      .max(254)
      .or(z.literal(''))
      .optional(),
    contactPhone: phoneNumber.optional(),
    whatsappNumber: phoneNumber.optional(),
    socialLinks: z
      .object({
        instagram: optionalUrl,
        tiktok: optionalUrl,
        whatsapp: optionalUrl,
      })
      .strict()
      .optional(),
    studioAddress: z
      .object({
        label: z.string().trim().max(160),
        city: z.string().trim().max(120),
        country: z.string().trim().max(120),
      })
      .strict()
      .optional(),
    openingHours: z
      .array(
        z
          .object({
            days: z
              .array(
                z.enum([
                  'Monday',
                  'Tuesday',
                  'Wednesday',
                  'Thursday',
                  'Friday',
                  'Saturday',
                  'Sunday',
                ]),
              )
              .min(1)
              .max(7),
            open: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            close: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            timezone: z
              .string()
              .trim()
              .min(1)
              .max(64)
              .refine((timezone) => {
                try {
                  new Intl.DateTimeFormat('en', { timeZone: timezone });
                  return true;
                } catch {
                  return false;
                }
              }),
          })
          .strict(),
      )
      .max(14)
      .optional(),
    openingHoursDisplayText: z.string().trim().max(300).optional(),
    aboutNote: z
      .string()
      .trim()
      .max(2000)
      .refine((value) => !/<\/?[a-z][^>]*>/i.test(value))
      .optional(),
    productLines: z
      .array(
        z
          .object({
            key: z.enum([
              'three_d_printed',
              'canvas_paint_yourself',
              'mug',
              'tshirt',
            ]),
            label: z.string().trim().min(1).max(120),
            description: z.string().trim().min(1).max(500),
            isActive: z.boolean(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    guestCheckoutEnabled: z.boolean().optional(),
    artworkLimits: z
      .object({
        maxBytes: z.number().int().positive(),
        allowedMimeTypes: z.array(z.string().trim().min(1).max(100)).max(20),
      })
      .strict()
      .optional(),
    shippingFlatMinor: minorUnits.optional(),
    freeShippingThresholdMinor: minorUnits.nullable().optional(),
    taxRateBasisPoints: z.number().int().min(0).max(10000).optional(),
    shippingConfigured: z.boolean().optional(),
    taxConfigured: z.boolean().optional(),
    orderCancellationWindowNote: z.string().max(1000).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0);

export const updateSettingsSchema = z.object({
  params: z.object({}),
  body: settingsFields,
  query: z.object({}),
});
