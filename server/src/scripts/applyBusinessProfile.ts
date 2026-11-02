import { disconnectDatabase, connectDatabase } from '../config/db';
import { env } from '../config/env';
import { SiteSettings } from '../models';
import { logger } from '../utils/logger';

const profile = {
  storeName: 'Dainty Bloom',
  currency: 'GBP',
  country: 'GB',
  contactEmail: 'info@daintybloome.com',
  contactPhone: '+44 7417 575436',
  whatsappNumber: '+44 7417 575436',
  socialLinks: {
    instagram: 'https://www.instagram.com/davril_forme',
    tiktok: 'https://www.tiktok.com/@atelier_davril',
    whatsapp: 'https://wa.me/447417575436',
  },
  openingHours: [
    {
      days: [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ],
      open: '08:00',
      close: '19:00',
      timezone: 'Europe/London',
    },
  ],
  openingHoursDisplayText: 'Mon-Sat, 8:00am - 7:00pm',
  studioAddress: {
    label: 'Custom printing studio',
    city: 'Coventry',
    country: 'United Kingdom',
  },
  aboutNote:
    'UK-based custom printing studio in Coventry. We make 3D printed goods, paint-it-yourself canvas prints, mugs and T-shirts, and we use an eco-friendly 3D printer for 3D goods.',
  productLines: [
    {
      key: 'three_d_printed',
      label: '3D Printed Goods',
      description:
        'Made-to-order 3D printed goods such as toys, decorations, lamps and other items, with material, colour and size options.',
      isActive: true,
    },
    {
      key: 'canvas_paint_yourself',
      label: 'Paint-It-Yourself Canvas',
      description:
        'Studio-designed canvas prints for customers to paint themselves; customer artwork is not required.',
      isActive: true,
    },
    {
      key: 'mug',
      label: 'Mugs',
      description: 'Mugs with customer artwork upload and print options.',
      isActive: true,
    },
    {
      key: 'tshirt',
      label: 'T-Shirts',
      description: 'T-shirts with customer artwork upload and print options.',
      isActive: true,
    },
  ],
};

async function run(): Promise<void> {
  if (env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error(
      'Refusing to apply the business profile in production without --force',
    );
  }
  await connectDatabase();
  try {
    const settings =
      (await SiteSettings.findOne({ key: 'default' })) ??
      new SiteSettings({ key: 'default' });
    const fields: Array<keyof typeof profile> = [
      'storeName',
      'currency',
      'country',
      'contactEmail',
      'contactPhone',
      'whatsappNumber',
      'openingHours',
      'openingHoursDisplayText',
      'studioAddress',
      'aboutNote',
      'productLines',
    ];
    for (const field of fields) {
      const current = settings.get(field);
      if (isEmpty(current)) settings.set(field, profile[field]);
    }
    for (const [key, value] of Object.entries(profile.socialLinks)) {
      if (!settings.socialLinks?.[key as keyof typeof profile.socialLinks]) {
        settings.set(`socialLinks.${key}`, value);
      }
    }
    if (!settings.contact.email)
      settings.set('contact.email', profile.contactEmail);
    if (!settings.contact.phone)
      settings.set('contact.phone', profile.contactPhone);
    if (!settings.contact.address) {
      settings.set(
        'contact.address',
        `${profile.studioAddress.label}, ${profile.studioAddress.city}, ${profile.studioAddress.country}`,
      );
    }
    if (settings.contact.openingHours.length === 0) {
      settings.set('contact.openingHours', [profile.openingHoursDisplayText]);
    }
    await settings.save();
    logger.info('Business profile applied to empty settings fields');
  } finally {
    await disconnectDatabase();
  }
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

void run().catch((error: unknown) => {
  logger.error({ err: error }, 'Business profile update failed');
  process.exitCode = 1;
});
