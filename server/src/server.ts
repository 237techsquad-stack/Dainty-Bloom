import { createServer } from 'node:http';

import { app } from './app';
import { connectDatabase, disconnectDatabase } from './config/db';
import { env } from './config/env';
import { logger } from './utils/logger';
import { cleanupUnattachedArtwork } from './services/upload.service';
import { expireUnpaidOrders } from './services/payment/paymentFlow.service';
import { processPendingPrivateOfferPaymentFulfillments } from './services/orderWorkflow.service';
import { createIntervalWorker } from './utils/intervalWorker';

let uploadCleanupScheduled = false;

async function startServer(): Promise<void> {
  await connectDatabase();
  const fulfillmentWorker = createIntervalWorker(
    processPendingPrivateOfferPaymentFulfillments,
    30_000,
    (error) => {
      logger.error(
        { err: error },
        'Scheduled private-offer fulfillment retry failed',
      );
    },
  );
  fulfillmentWorker.start();
  if (env.NODE_ENV === 'production' && !uploadCleanupScheduled) {
    uploadCleanupScheduled = true;
    const timer = setInterval(
      () => {
        void cleanupUnattachedArtwork().catch((error: unknown) => {
          logger.error({ err: error }, 'Scheduled upload cleanup failed');
        });
        void expireUnpaidOrders().catch((error: unknown) => {
          logger.error(
            { err: error },
            'Scheduled unpaid-order expiration failed',
          );
        });
      },
      60 * 60 * 1000,
    );
    timer.unref();
  }

  const server = createServer(app);
  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'API server listening');
  });

  let isShuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Shutting down API server');

    void (async () => {
      await fulfillmentWorker.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await disconnectDatabase();
      process.exit();
    })().catch((error: unknown) => {
      logger.error({ err: error }, 'API server shutdown failed');
      process.exitCode = 1;
      process.exit();
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void startServer().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start API server');
  process.exit(1);
});
