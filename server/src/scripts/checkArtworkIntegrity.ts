import { connectDatabase, disconnectDatabase } from '../config/db';
import { env } from '../config/env';
import { createArtworkIntegrityReport } from '../services/artworkIntegrity.service';
import { logger } from '../utils/logger';

async function run(): Promise<void> {
  let connected = false;
  try {
    await connectDatabase();
    connected = true;
    const report = await createArtworkIntegrityReport(env.STORAGE_PRIVATE_DIR);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    const { summary } = report;
    if (
      summary.missing > 0 ||
      summary.unreadable > 0 ||
      summary.invalidKeys > 0 ||
      summary.unsupportedDrivers > 0 ||
      summary.checksumMismatches > 0 ||
      summary.checksumUnknown > 0 ||
      summary.metadataMismatches > 0 ||
      summary.metadataUnknown > 0 ||
      summary.providerErrors > 0 ||
      summary.unknown > 0 ||
      summary.orphanFiles > 0 ||
      summary.filesystemErrors > 0
    ) {
      process.exitCode = 2;
    }
  } catch {
    logger.error(
      { code: 'ARTWORK_INTEGRITY_CHECK_FAILED' },
      'Artwork integrity check failed; no diagnostic details were logged',
    );
    process.stderr.write(
      'Artwork integrity check failed. Verify database and private storage access, then retry.\n',
    );
    process.exitCode = 1;
  } finally {
    if (connected) {
      try {
        await disconnectDatabase();
      } catch {
        logger.error(
          { code: 'ARTWORK_INTEGRITY_DISCONNECT_FAILED' },
          'Artwork integrity checker could not disconnect cleanly',
        );
        process.exitCode = 1;
      }
    }
  }
}

void run();
