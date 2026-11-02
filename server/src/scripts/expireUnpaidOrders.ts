import { connectDatabase, disconnectDatabase } from '../config/db';
import { expireUnpaidOrders } from '../services/payment/paymentFlow.service';
import { logger } from '../utils/logger';

async function run(): Promise<void> {
  await connectDatabase();
  try {
    const expired = await expireUnpaidOrders();
    logger.info({ expired }, 'Unpaid order expiration completed');
  } finally {
    await disconnectDatabase();
  }
}

void run().catch((error: unknown) => {
  logger.error({ err: error }, 'Unpaid order expiration failed');
  process.exitCode = 1;
});
