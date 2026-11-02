import { lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ArtworkMigrationAuthorizationError,
  loadArtworkMigrationConfiguration,
  resolveArtworkMigrationCredential,
  verifyArtworkMigrationAuthorization,
} from '../services/artworkMigrationAuthorization';
import {
  connectArtworkMigrationDatabase,
  verifyArtworkMigrationDatabaseIdentity,
} from '../services/artworkMigrationConnection';
import {
  loadArtworkMigrationCloudinaryConfiguration,
  verifyArtworkMigrationCloudinaryIdentity,
} from '../services/artworkMigrationCloudinary';
import {
  ArtworkMigrationJournalError,
  FileArtworkMigrationJournal,
} from '../services/artworkMigrationJournal';
import { runArtworkMigrationPreflight } from '../services/artworkMigrationPreflight';

async function run(): Promise<void> {
  await runArtworkMigrationPreflight(process.argv.slice(2), {
    loadConfiguration: loadArtworkMigrationConfiguration,
    verifyAuthorization: verifyArtworkMigrationAuthorization,
    resolveCredential: resolveArtworkMigrationCredential,
    connect: connectArtworkMigrationDatabase,
    verifyDatabaseIdentity: verifyArtworkMigrationDatabaseIdentity,
    loadCloudinaryConfiguration: loadArtworkMigrationCloudinaryConfiguration,
    verifyCloudinaryIdentity: verifyArtworkMigrationCloudinaryIdentity,
    openJournal: async (target, configuration) => {
      await assertPrivateSourceDirectory(configuration.sourcePrivateDirectory);
      const journalPath = path.join(
        os.homedir(),
        '.dainty-bloom',
        'artwork-cloudinary-migration.json',
      );
      assertJournalIsOutsideSource(
        journalPath,
        configuration.sourcePrivateDirectory,
      );
      const journalRepository = new FileArtworkMigrationJournal(journalPath);
      await journalRepository.load(target);
    },
  });
}

async function assertPrivateSourceDirectory(directory: string): Promise<void> {
  let info;
  try {
    info = await lstat(path.resolve(directory));
  } catch {
    throw new Error('SOURCE_STORAGE_UNAVAILABLE');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('SOURCE_STORAGE_UNAVAILABLE');
  }
}

function assertJournalIsOutsideSource(
  journalFile: string,
  sourceDirectory: string,
): void {
  const journal = path.resolve(journalFile);
  const source = path.resolve(sourceDirectory);
  const journalRelativeToSource = path.relative(source, journal);
  const sourceRelativeToJournal = path.relative(path.dirname(journal), source);
  if (
    journalRelativeToSource === '' ||
    (!journalRelativeToSource.startsWith('..') &&
      !path.isAbsolute(journalRelativeToSource)) ||
    sourceRelativeToJournal === ''
  ) {
    throw new Error('JOURNAL_MUST_BE_OUTSIDE_SOURCE_STORAGE');
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    const code =
      error instanceof ArtworkMigrationJournalError
        ? error.code
        : error instanceof ArtworkMigrationAuthorizationError
          ? error.code
          : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : 'MIGRATION_ABORTED';
    process.stderr.write(
      `Artwork migration stopped (${code}). No source files are deleted by this tool.\n`,
    );
    process.exitCode = 1;
  });
}
