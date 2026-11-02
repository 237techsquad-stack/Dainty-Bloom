import { disconnectDatabase, connectDatabase } from '../config/db';
import {
  ArtworkAsset,
  AuditEvent,
  Cart,
  Category,
  Faq,
  Message,
  Order,
  Product,
  Review,
  SiteSettings,
  StaffControl,
  StripeEvent,
  Subscriber,
  User,
  Wishlist,
} from '../models';
import { logger } from '../utils/logger';

const models = [
  ArtworkAsset,
  AuditEvent,
  Cart,
  Category,
  Faq,
  Message,
  Order,
  Product,
  Review,
  SiteSettings,
  StaffControl,
  StripeEvent,
  Subscriber,
  User,
  Wishlist,
];

async function run(): Promise<void> {
  await connectDatabase();
  try {
    for (const model of models) {
      await model.syncIndexes();
      logger.info({ model: model.modelName }, 'Model indexes synchronized');
    }
  } finally {
    await disconnectDatabase();
  }
}

void run().catch((error: unknown) => {
  logger.error({ err: error }, 'Index synchronization failed');
  process.exitCode = 1;
});
