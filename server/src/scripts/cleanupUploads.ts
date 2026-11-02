import { connectDatabase, disconnectDatabase } from '../config/db';
import { cleanupUnattachedArtwork } from '../services/upload.service';
import { logger } from '../utils/logger';

async function run(): Promise<void> {
  await connectDatabase();
  try {
    const result = await cleanupUnattachedArtwork();
    logger.info(result, 'Upload cleanup completed');
  } finally {
    await disconnectDatabase();
  }
}

void run().catch((error: unknown) => {
  logger.error({ err: error }, 'Upload cleanup failed');
  process.exitCode = 1;
});
