import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import { env } from '../config/env';
import { SiteSettings, User } from '../models';
import { logger } from '../utils/logger';
import { ensureBusinessCategories } from './categoryDefinitions';

async function seed(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Seed script is disabled when NODE_ENV is production');
  }
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set to create the seed admin',
    );
  }

  await mongoose.connect(env.MONGODB_URI);

  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const existingAdmin = await User.findOne({ email });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 12);
    await User.create({
      name: 'Admin',
      email,
      passwordHash,
      role: 'admin',
      accountState: 'active',
    });
  }

  await SiteSettings.updateOne(
    { key: 'default' },
    {
      $setOnInsert: {
        key: 'default',
        storeName: 'Dainty Bloom',
        currency: env.DEFAULT_CURRENCY,
        guestCheckoutEnabled: false,
        artworkLimits: {
          maxBytes: env.UPLOAD_MAX_BYTES,
          allowedMimeTypes: [],
        },
        contact: { email: '', phone: '', address: '', openingHours: [] },
      },
    },
    { upsert: true, runValidators: true },
  );

  await ensureBusinessCategories();

  logger.info('Seed data applied');
}

void seed()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Seed script failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
