import { createHash, randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { ArtworkAsset } from '../src/models/ArtworkAsset';
import { env } from '../src/config/env';

const { detectArtworkMimeMock } = vi.hoisted(() => ({
  detectArtworkMimeMock: vi.fn(),
}));

vi.mock('../src/utils/artworkFileType', () => ({
  detectArtworkMime: detectArtworkMimeMock,
}));

import {
  ArtworkMigrationError,
  ArtworkMigrationInterruption,
  buildConditionalArtworkStorageUpdate,
  createDeterministicCloudinaryKey,
  migrateArtworkRecords,
  readAndValidateLocalArtwork,
  type ArtworkMigrationDependencies,
  type ArtworkMigrationRecord,
  type ValidatedArtworkSource,
} from '../src/services/artworkMigration.service';
import {
  FileArtworkMigrationJournal,
  ArtworkMigrationJournalError,
  type ArtworkMigrationJournal,
  type ArtworkMigrationJournalRepository,
  type ArtworkMigrationTarget,
} from '../src/services/artworkMigrationJournal';
import {
  assertConnectedArtworkMigrationTargetIsLocal,
  assertArtworkMigrationTargetIsLocal,
  assertArtworkMigrationRuntimeTarget,
  describeArtworkMigrationTarget,
  getArtworkMigrationTargetIdentifier,
  parseArtworkMigrationArguments,
} from '../src/services/artworkMigrationSafety';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
const IMAGE_KEY = '2026/10/29/123e4567-e89b-42d3-a456-426614174000.png';
const TARGET: ArtworkMigrationTarget = {
  environment: 'development',
  host: 'localhost:27017',
  database: 'dainty_bloom_test',
};
const SOURCE_RECORD: ArtworkMigrationRecord = {
  id: '507f1f77bcf86cd799439011',
  storageDriver: 'local',
  storageKey: IMAGE_KEY,
  checksum: sha256(PNG),
  sizeBytes: PNG.byteLength,
  detectedMimeType: 'image/png',
};

let tempRoot: string | undefined;

beforeEach(() => {
  detectArtworkMimeMock.mockReset();
  detectArtworkMimeMock.mockImplementation(detectSyntheticArtworkMime);
  env.NODE_ENV = 'development';
  env.MONGODB_URI = 'mongodb://localhost:27017/dainty_bloom_test';
  mongoose.connection.readyState = 1;
  vi.spyOn(mongoose.connection, 'getClient').mockReturnValue(
    makeFakeMongoClient(TARGET.database, [
      ['localhost:27017', standaloneDescription()],
    ]) as ReturnType<typeof mongoose.connection.getClient>,
  );
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
  vi.restoreAllMocks();
  mongoose.connection.readyState = 0;
  env.NODE_ENV = 'test';
  env.MONGODB_URI = 'mongodb://127.0.0.1:27017/dainty-bloom-test';
});

describe('operator safeguards', () => {
  it('identifies a Mongo target without exposing URI credentials or query values', () => {
    const target = describeArtworkMigrationTarget(
      'mongodb://localhost:27017/dainty_bloom_test?authSource=admin',
      'development',
    );

    expect(target).toEqual(TARGET);
    expect(JSON.stringify(target)).not.toContain('authSource');
  });

  it('defaults to dry-run and requires explicit write confirmation', () => {
    expect(parseArtworkMigrationArguments([], TARGET)).toEqual({
      dryRun: true,
    });
    const confirmation = getArtworkMigrationTargetIdentifier(TARGET);
    expect(() =>
      parseArtworkMigrationArguments(
        ['--write', `--confirm-target=${confirmation}`],
        TARGET,
      ),
    ).toThrow('MIGRATION_WRITE_DISABLED_PENDING_IDENTITY_DESIGN');
    expect(() => parseArtworkMigrationArguments(['--write'], TARGET)).toThrow(
      'MIGRATION_CONFIRMATION_REQUIRED',
    );
  });

  it('refuses production and non-loopback database targets without a bypass', () => {
    expect(() =>
      assertArtworkMigrationTargetIsLocal({
        ...TARGET,
        environment: 'production',
      }),
    ).toThrow('PRODUCTION_MIGRATION_DISABLED');
    expect(() =>
      assertArtworkMigrationTargetIsLocal({
        ...TARGET,
        host: 'mongo.example.test:27017',
      }),
    ).toThrow('MIGRATION_REQUIRES_LOOPBACK_DATABASE');
  });

  it('refuses connected non-loopback topology targets', () => {
    vi.spyOn(mongoose.connection, 'getClient').mockReturnValue(
      makeFakeMongoClient(TARGET.database, [
        ['mongo.remote.test:27017', standaloneDescription()],
      ]) as ReturnType<typeof mongoose.connection.getClient>,
    );
    expect(() => assertConnectedArtworkMigrationTargetIsLocal(TARGET)).toThrow(
      'MIGRATION_CONNECTED_SERVER_UNSAFE',
    );
  });

  it('refuses a direct connection whose server identifies as a replica-set member', () => {
    vi.spyOn(mongoose.connection, 'getClient').mockReturnValue(
      makeFakeMongoClient(
        TARGET.database,
        [['localhost:27017', replicaSetDescription()]],
        'Single',
        { directConnection: true },
      ) as ReturnType<typeof mongoose.connection.getClient>,
    );
    expect(() => assertConnectedArtworkMigrationTargetIsLocal(TARGET)).toThrow(
      'MIGRATION_CONNECTED_SERVER_UNSAFE',
    );
  });

  it('refuses multiple discovered servers and unknown server topology', () => {
    vi.spyOn(mongoose.connection, 'getClient').mockReturnValue(
      makeFakeMongoClient(TARGET.database, [
        ['localhost:27017', standaloneDescription()],
        ['127.0.0.1:27018', standaloneDescription()],
      ]) as ReturnType<typeof mongoose.connection.getClient>,
    );
    expect(() => assertConnectedArtworkMigrationTargetIsLocal(TARGET)).toThrow(
      'MIGRATION_CONNECTED_TOPOLOGY_UNSAFE',
    );

    vi.spyOn(mongoose.connection, 'getClient').mockReturnValue(
      makeFakeMongoClient(TARGET.database, [
        ['localhost:27017', { ...standaloneDescription(), type: 'Unknown' }],
      ]) as ReturnType<typeof mongoose.connection.getClient>,
    );
    expect(() => assertConnectedArtworkMigrationTargetIsLocal(TARGET)).toThrow(
      'MIGRATION_CONNECTED_SERVER_UNSAFE',
    );

    vi.spyOn(mongoose.connection, 'getClient').mockReturnValue(
      makeFakeMongoClient(
        TARGET.database,
        [['localhost:27017', standaloneDescription()]],
        'Unknown',
      ) as ReturnType<typeof mongoose.connection.getClient>,
    );
    expect(() => assertConnectedArtworkMigrationTargetIsLocal(TARGET)).toThrow(
      'MIGRATION_CONNECTED_TOPOLOGY_UNSAFE',
    );
  });

  it('accepts a positively identified standalone server over direct connection', () => {
    vi.spyOn(mongoose.connection, 'getClient').mockReturnValue(
      makeFakeMongoClient(
        TARGET.database,
        [['localhost:27017', standaloneDescription()]],
        'Single',
        { directConnection: true },
      ) as ReturnType<typeof mongoose.connection.getClient>,
    );
    expect(() =>
      assertConnectedArtworkMigrationTargetIsLocal(TARGET),
    ).not.toThrow();
  });

  it('binds service write authorization to trusted runtime environment and URI', () => {
    env.NODE_ENV = 'production';
    expect(() =>
      assertArtworkMigrationRuntimeTarget(
        TARGET,
        getArtworkMigrationTargetIdentifier(TARGET),
      ),
    ).toThrow('MIGRATION_REQUIRES_DEVELOPMENT_ENVIRONMENT');
  });

  it('blocks confirmed service writes before database, journal, or provider access', async () => {
    const fixture = makeFixture();
    const model = mockArtworkAssetModel(fixture);
    await expect(
      migrateArtworkRecords(
        {
          dryRun: false,
          target: TARGET,
          confirmation: getArtworkMigrationTargetIdentifier(TARGET),
        },
        fixture.dependencies,
      ),
    ).rejects.toThrow('MIGRATION_WRITE_DISABLED_PENDING_IDENTITY_DESIGN');

    expect(model.find).not.toHaveBeenCalled();
    expect(ArtworkAsset.updateOne).not.toHaveBeenCalled();
    expect(fixture.dependencies.journalRepository.load).not.toHaveBeenCalled();
    expect(
      fixture.dependencies.journalRepository.withMigrationLock,
    ).not.toHaveBeenCalled();
    expect(fixture.storage.getMetadata).not.toHaveBeenCalled();
    expect(fixture.storage.putForMigration).not.toHaveBeenCalled();
  });

  it('requires signed preflight before direct service dry-runs access any dependency', async () => {
    const fixture = makeFixture();
    const model = mockArtworkAssetModel(fixture);

    await expect(
      migrateArtworkRecords(
        { dryRun: true, target: TARGET },
        fixture.dependencies,
      ),
    ).rejects.toThrow('MIGRATION_SIGNED_PREFLIGHT_REQUIRED');
    expect(model.find).not.toHaveBeenCalled();
    expect(fixture.dependencies.journalRepository.load).not.toHaveBeenCalled();
    expect(
      fixture.dependencies.journalRepository.withMigrationLock,
    ).not.toHaveBeenCalled();
    expect(fixture.storage.getMetadata).not.toHaveBeenCalled();
    expect(fixture.storage.getStream).not.toHaveBeenCalled();
    expect(fixture.storage.putForMigration).not.toHaveBeenCalled();
  });

  it('does not let direct service calls inspect Cloudinary-backed records without signed preflight', async () => {
    const fixture = makeFixture();
    fixture.records[0] = {
      ...SOURCE_RECORD,
      storageDriver: 'cloudinary',
      storageKey:
        'dainty-bloom/private-artwork/2026/10/29/123e4567-e89b-42d3-a456-426614174000',
      storageResourceType: 'image',
    };
    const model = mockArtworkAssetModel(fixture);

    await expect(
      migrateArtworkRecords(
        { dryRun: true, target: TARGET },
        fixture.dependencies,
      ),
    ).rejects.toThrow('MIGRATION_SIGNED_PREFLIGHT_REQUIRED');
    expect(model.find).not.toHaveBeenCalled();
    expect(fixture.dependencies.journalRepository.load).not.toHaveBeenCalled();
    expect(fixture.storage.getMetadata).not.toHaveBeenCalled();
    expect(fixture.storage.getStream).not.toHaveBeenCalled();
    expect(fixture.storage.putForMigration).not.toHaveBeenCalled();
  });
});

describe('durable migration journal', () => {
  it('atomically saves and reloads a journal with its target identity', async () => {
    const root = await makeTempDirectory();
    const repository = new FileArtworkMigrationJournal(
      path.join(root, 'journal.json'),
    );
    const journal = await repository.load(TARGET);
    journal.entries[SOURCE_RECORD.id] = {
      artworkId: SOURCE_RECORD.id,
      sourceKey: SOURCE_RECORD.storageKey,
      sourceChecksum: SOURCE_RECORD.checksum,
      targetKey: targetKey(),
      attemptId: randomUUID(),
      phase: 'discovered',
      updatedAt: new Date().toISOString(),
    };
    await repository.save(journal);

    await expect(repository.load(TARGET)).resolves.toEqual(journal);
    await expect(
      repository.load({ ...TARGET, database: 'other_database' }),
    ).rejects.toMatchObject({ code: 'JOURNAL_TARGET_MISMATCH' });
  });

  it('persists a discovered entry before recording an initial source failure', async () => {
    const root = await makeTempDirectory();
    const repository = new FileArtworkMigrationJournal(
      path.join(root, 'source-failure.jsonl'),
    );
    const journal = await repository.load(TARGET);
    journal.entries[SOURCE_RECORD.id] = {
      artworkId: SOURCE_RECORD.id,
      attemptId: randomUUID(),
      sourceKey: SOURCE_RECORD.storageKey,
      sourceChecksum: SOURCE_RECORD.checksum,
      targetKey: targetKey(),
      phase: 'discovered',
      updatedAt: new Date().toISOString(),
    };
    await repository.save(journal, SOURCE_RECORD.id);

    journal.entries[SOURCE_RECORD.id]!.phase = 'failed';
    journal.entries[SOURCE_RECORD.id]!.failureCode = 'SOURCE_FILE_MISSING';
    journal.entries[SOURCE_RECORD.id]!.updatedAt = new Date().toISOString();
    await repository.save(journal, SOURCE_RECORD.id);

    const persisted = await repository.load(TARGET);
    expect(persisted.entries[SOURCE_RECORD.id]).toMatchObject({
      phase: 'failed',
      failureCode: 'SOURCE_FILE_MISSING',
    });
  });

  it('fails closed on a corrupt or unavailable journal', async () => {
    const root = await makeTempDirectory();
    const corruptPath = path.join(root, 'corrupt.json');
    await writeFile(corruptPath, '{invalid');
    await expect(
      new FileArtworkMigrationJournal(corruptPath).load(TARGET),
    ).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });

    const filePath = path.join(root, 'not-a-directory');
    await writeFile(filePath, 'x');
    await expect(
      new FileArtworkMigrationJournal(path.join(filePath, 'journal.json')).load(
        TARGET,
      ),
    ).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' });
  });

  it('recovers a torn final event before appending and reloads the durable journal', async () => {
    const root = await makeTempDirectory();
    const journalPath = path.join(root, 'journal.jsonl');
    const repository = new FileArtworkMigrationJournal(journalPath);
    const journal = await repository.load(TARGET);
    journal.entries[SOURCE_RECORD.id] = {
      artworkId: SOURCE_RECORD.id,
      sourceKey: SOURCE_RECORD.storageKey,
      sourceChecksum: SOURCE_RECORD.checksum,
      targetKey: targetKey(),
      attemptId: randomUUID(),
      phase: 'discovered',
      updatedAt: new Date().toISOString(),
    };
    await repository.save(journal, SOURCE_RECORD.id);
    const fragment = '{"type":"entry","entry":';
    await appendFile(journalPath, fragment);

    await expect(repository.load(TARGET)).resolves.toEqual(journal);
    journal.entries[SOURCE_RECORD.id]!.phase = 'source_validated';
    journal.entries[SOURCE_RECORD.id]!.updatedAt = new Date().toISOString();
    await repository.save(journal, SOURCE_RECORD.id);

    const reloaded = await new FileArtworkMigrationJournal(journalPath).load(
      TARGET,
    );
    expect(reloaded).toEqual(journal);
    const recoveredContent = await readFile(journalPath, 'utf8');
    expect(recoveredContent.endsWith('\n')).toBe(true);
    expect(recoveredContent.split('\n')).not.toContain(fragment);
  });

  it('accepts valid incomplete event prefixes but rejects malformed tokens unchanged', async () => {
    const root = await makeTempDirectory();
    const header = `${JSON.stringify({
      type: 'header',
      version: 1,
      target: TARGET,
    })}\n`;
    const event = JSON.stringify({
      type: 'entry',
      entry: {
        artworkId: SOURCE_RECORD.id,
        attemptId: randomUUID(),
        sourceKey: SOURCE_RECORD.storageKey,
        sourceChecksum: SOURCE_RECORD.checksum,
        targetKey: targetKey(),
        phase: 'discovered',
        updatedAt: new Date().toISOString(),
      },
    });
    for (const cut of [10, 28, 72, event.length - 3]) {
      const journalPath = path.join(root, `prefix-${cut}.jsonl`);
      await writeFile(journalPath, `${header}${event.slice(0, cut)}`);
      const result = await new FileArtworkMigrationJournal(journalPath).load(
        TARGET,
      );
      expect(Object.keys(result.entries)).toHaveLength(0);
    }

    const malformedPath = path.join(root, 'malformed-tail.jsonl');
    const malformedFragment = '{"type":"entry","entry":{"artworkId":!{"';
    await writeFile(malformedPath, `${header}${malformedFragment}`);
    const before = await readFile(malformedPath, 'utf8');
    await expect(
      new FileArtworkMigrationJournal(malformedPath).load(TARGET),
    ).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
    await expect(readFile(malformedPath, 'utf8')).resolves.toBe(before);
  });

  it('preserves a complete final event without a trailing newline', async () => {
    const root = await makeTempDirectory();
    const journalPath = path.join(root, 'complete-no-newline.jsonl');
    const header = JSON.stringify({
      type: 'header',
      version: 1,
      target: TARGET,
    });
    const event = JSON.stringify({
      type: 'entry',
      entry: {
        artworkId: SOURCE_RECORD.id,
        attemptId: randomUUID(),
        sourceKey: SOURCE_RECORD.storageKey,
        sourceChecksum: SOURCE_RECORD.checksum,
        targetKey: targetKey(),
        phase: 'discovered',
        updatedAt: new Date().toISOString(),
      },
    });
    await writeFile(journalPath, `${header}\n${event}`);
    const journal = await new FileArtworkMigrationJournal(journalPath).load(
      TARGET,
    );
    expect(journal.entries[SOURCE_RECORD.id]?.phase).toBe('discovered');
    expect(await readFile(journalPath, 'utf8')).toBe(`${header}\n${event}`);
  });

  it('rejects stale snapshots, out-of-order transitions, and ignores duplicate progress', async () => {
    const root = await makeTempDirectory();
    const journalPath = path.join(root, 'transitions.jsonl');
    const first = new FileArtworkMigrationJournal(journalPath);
    const current = await first.load(TARGET);
    const attemptId = randomUUID();
    current.entries[SOURCE_RECORD.id] = {
      artworkId: SOURCE_RECORD.id,
      attemptId,
      sourceKey: SOURCE_RECORD.storageKey,
      sourceChecksum: SOURCE_RECORD.checksum,
      targetKey: targetKey(),
      phase: 'discovered',
      updatedAt: new Date().toISOString(),
    };
    await first.save(current, SOURCE_RECORD.id);

    const staleRepository = new FileArtworkMigrationJournal(journalPath);
    const latestRepository = new FileArtworkMigrationJournal(journalPath);
    const stale = await staleRepository.load(TARGET);
    const latest = await latestRepository.load(TARGET);
    latest.entries[SOURCE_RECORD.id]!.phase = 'source_validated';
    latest.entries[SOURCE_RECORD.id]!.updatedAt = new Date().toISOString();
    await latestRepository.save(latest, SOURCE_RECORD.id);
    latest.entries[SOURCE_RECORD.id]!.phase = 'upload_started';
    latest.entries[SOURCE_RECORD.id]!.updatedAt = new Date().toISOString();
    await latestRepository.save(latest, SOURCE_RECORD.id);

    stale.entries[SOURCE_RECORD.id]!.phase = 'source_validated';
    stale.entries[SOURCE_RECORD.id]!.updatedAt = new Date().toISOString();
    await expect(
      staleRepository.save(stale, SOURCE_RECORD.id),
    ).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });

    latest.entries[SOURCE_RECORD.id]!.phase = 'discovered';
    await expect(
      latestRepository.save(latest, SOURCE_RECORD.id),
    ).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });

    const duplicate = await new FileArtworkMigrationJournal(journalPath).load(
      TARGET,
    );
    const beforeDuplicate = await readFile(journalPath, 'utf8');
    duplicate.entries[SOURCE_RECORD.id]!.updatedAt = new Date().toISOString();
    const duplicateRepository = new FileArtworkMigrationJournal(journalPath);
    await duplicateRepository.load(TARGET);
    await duplicateRepository.save(duplicate, SOURCE_RECORD.id);
    await expect(readFile(journalPath, 'utf8')).resolves.toBe(beforeDuplicate);
  });

  it('rejects terminal phase changes within the same attempt', async () => {
    const root = await makeTempDirectory();
    const journalPath = path.join(root, 'terminal-transitions.jsonl');
    const repository = new FileArtworkMigrationJournal(journalPath);
    const journal = await repository.load(TARGET);
    journal.entries[SOURCE_RECORD.id] = {
      artworkId: SOURCE_RECORD.id,
      attemptId: randomUUID(),
      sourceKey: SOURCE_RECORD.storageKey,
      sourceChecksum: SOURCE_RECORD.checksum,
      targetKey: targetKey(),
      phase: 'discovered',
      updatedAt: new Date().toISOString(),
    };
    await repository.save(journal, SOURCE_RECORD.id);

    journal.entries[SOURCE_RECORD.id]!.phase = 'failed';
    journal.entries[SOURCE_RECORD.id]!.failureCode = 'TEST_FAILURE';
    journal.entries[SOURCE_RECORD.id]!.updatedAt = new Date().toISOString();
    await repository.save(journal, SOURCE_RECORD.id);

    journal.entries[SOURCE_RECORD.id]!.phase = 'requires_reconciliation';
    journal.entries[SOURCE_RECORD.id]!.failureCode = 'TEST_RECONCILIATION';
    journal.entries[SOURCE_RECORD.id]!.updatedAt = new Date().toISOString();
    await expect(
      repository.save(journal, SOURCE_RECORD.id),
    ).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
  });

  it('keeps the original journal intact after an interrupted recovery attempt', async () => {
    const root = await makeTempDirectory();
    const journalPath = path.join(root, 'journal.jsonl');
    const repository = new FileArtworkMigrationJournal(journalPath);
    const journal = await repository.load(TARGET);
    journal.entries[SOURCE_RECORD.id] = {
      artworkId: SOURCE_RECORD.id,
      sourceKey: SOURCE_RECORD.storageKey,
      sourceChecksum: SOURCE_RECORD.checksum,
      targetKey: targetKey(),
      attemptId: randomUUID(),
      phase: 'discovered',
      updatedAt: new Date().toISOString(),
    };
    await repository.save(journal, SOURCE_RECORD.id);
    const tornContent = '{"type":"entry","entry":';
    await appendFile(journalPath, tornContent);
    const originalBytes = await readFile(journalPath, 'utf8');

    await expect(repository.load(TARGET)).resolves.toEqual(journal);
    await expect(readFile(journalPath, 'utf8')).resolves.toBe(originalBytes);

    journal.entries[SOURCE_RECORD.id]!.phase = 'source_validated';
    journal.entries[SOURCE_RECORD.id]!.updatedAt = new Date().toISOString();
    const interruptedRepository = new FileArtworkMigrationJournal(
      journalPath,
      async () => {
        throw new Error('simulated interruption during journal recovery');
      },
    );
    const journalBeforeInterruptedRecovery =
      await interruptedRepository.load(TARGET);
    expect(
      journalBeforeInterruptedRecovery.entries[SOURCE_RECORD.id]?.phase,
    ).toBe('discovered');
    await expect(
      interruptedRepository.save(journal, SOURCE_RECORD.id),
    ).rejects.toMatchObject({ code: 'JOURNAL_UNAVAILABLE' });
    await expect(readFile(journalPath, 'utf8')).resolves.toBe(originalBytes);

    await repository.save(journal, SOURCE_RECORD.id);
    await expect(
      new FileArtworkMigrationJournal(journalPath).load(TARGET),
    ).resolves.toEqual(journal);
  });

  it('rejects corruption in the middle of the journal and malformed headers', async () => {
    const root = await makeTempDirectory();
    const journalPath = path.join(root, 'journal.jsonl');
    const validHeader = `${JSON.stringify({
      type: 'header',
      version: 1,
      target: TARGET,
    })}\n`;
    const validEntry = `${JSON.stringify({
      type: 'entry',
      entry: {
        artworkId: SOURCE_RECORD.id,
        sourceKey: SOURCE_RECORD.storageKey,
        sourceChecksum: SOURCE_RECORD.checksum,
        targetKey: targetKey(),
        phase: 'upload_started',
        updatedAt: new Date().toISOString(),
      },
    })}\n`;
    await writeFile(journalPath, `${validHeader}{malformed}\n${validEntry}`);
    await expect(
      new FileArtworkMigrationJournal(journalPath).load(TARGET),
    ).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });

    await writeFile(journalPath, '{"type":"header","version":2}\n');
    await expect(
      new FileArtworkMigrationJournal(journalPath).load(TARGET),
    ).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
  });

  it('requires manual recovery for torn prefixes before the recognized entry marker', async () => {
    const root = await makeTempDirectory();
    const header = `${JSON.stringify({
      type: 'header',
      version: 1,
      target: TARGET,
    })}\n`;
    for (const [index, fragment] of [
      '{"typ":',
      '{"type":"unknown"',
      '{"type":"entry","entries":',
    ].entries()) {
      const journalPath = path.join(root, `prefix-${index}.jsonl`);
      const repository = new FileArtworkMigrationJournal(journalPath);
      const journal = await repository.load(TARGET);
      await writeFile(journalPath, `${header}${fragment}`);
      const originalContent = await readFile(journalPath, 'utf8');

      await expect(repository.load(TARGET)).rejects.toMatchObject({
        code: 'JOURNAL_CORRUPT',
      });
      await expect(repository.save(journal)).rejects.toMatchObject({
        code: 'JOURNAL_CORRUPT',
      });
      await expect(readFile(journalPath, 'utf8')).resolves.toBe(
        originalContent,
      );
    }
  });

  it('fails closed when concurrent writers contend for the same journal', async () => {
    const root = await makeTempDirectory();
    const journalPath = path.join(root, 'journal.jsonl');
    const firstRepository = new FileArtworkMigrationJournal(journalPath);
    const secondRepository = new FileArtworkMigrationJournal(journalPath);
    const firstJournal = await firstRepository.load(TARGET);
    const secondJournal = await secondRepository.load(TARGET);
    const createEntry = (artworkId: string) => ({
      artworkId,
      sourceKey: SOURCE_RECORD.storageKey,
      sourceChecksum: SOURCE_RECORD.checksum,
      targetKey: targetKey(),
      phase: 'discovered' as const,
      attemptId: randomUUID(),
      updatedAt: new Date().toISOString(),
    });
    const secondArtworkId = '507f1f77bcf86cd799439012';
    firstJournal.entries[SOURCE_RECORD.id] = createEntry(SOURCE_RECORD.id);
    secondJournal.entries[secondArtworkId] = createEntry(secondArtworkId);

    const attempts = await Promise.allSettled([
      firstRepository.save(firstJournal, SOURCE_RECORD.id),
      secondRepository.save(secondJournal, secondArtworkId),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected'),
    ).toHaveLength(1);
    const persisted = await new FileArtworkMigrationJournal(journalPath).load(
      TARGET,
    );
    expect(Object.keys(persisted.entries)).toHaveLength(1);
  });

  it('rejects a journal header for a different target', async () => {
    const root = await makeTempDirectory();
    const journalPath = path.join(root, 'journal.jsonl');
    await writeFile(
      journalPath,
      `${JSON.stringify({
        type: 'header',
        version: 1,
        target: { ...TARGET, database: 'other_database' },
      })}\n`,
    );
    await expect(
      new FileArtworkMigrationJournal(journalPath).load(TARGET),
    ).rejects.toMatchObject({ code: 'JOURNAL_TARGET_MISMATCH' });
  });
});

describe('local source validation', () => {
  it('validates actual file type, size, checksum, and keeps the source unchanged', async () => {
    const root = await makeTempDirectory();
    const filePath = path.join(root, ...IMAGE_KEY.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, PNG);

    const source = await readAndValidateLocalArtwork(
      SOURCE_RECORD,
      root,
      1024 * 1024,
    );
    expect(source).toMatchObject({
      sizeBytes: PNG.byteLength,
      contentType: 'image/png',
      resourceType: 'image',
      checksum: SOURCE_RECORD.checksum,
    });
    expect(detectArtworkMimeMock).toHaveBeenCalledWith(PNG);
    await expect(readFile(filePath)).resolves.toEqual(PNG);
  });

  it.each([
    [
      'traversal key',
      { storageKey: '../outside.png' },
      'INVALID_SOURCE_STORAGE_KEY',
    ],
    [
      'size mismatch',
      { sizeBytes: PNG.byteLength + 1 },
      'SOURCE_SIZE_MISMATCH',
    ],
    [
      'checksum mismatch',
      { checksum: '0'.repeat(64) },
      'SOURCE_CHECKSUM_MISMATCH',
    ],
    [
      'missing file',
      { storageKey: '2026/10/29/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png' },
      'SOURCE_FILE_MISSING',
    ],
  ])('rejects %s without uploading', async (_label, overrides, code) => {
    const root = await makeTempDirectory();
    const filePath = path.join(root, ...IMAGE_KEY.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, PNG);
    const record = { ...SOURCE_RECORD, ...overrides };

    await expect(
      readAndValidateLocalArtwork(record, root, 1024 * 1024),
    ).rejects.toMatchObject({ code });
  });

  it('rejects unsafe SVG and unsupported MIME metadata', async () => {
    const root = await makeTempDirectory();
    const svgKey = '2026/10/29/123e4567-e89b-42d3-a456-426614174000.svg';
    const unsafeSvg = Buffer.from('<svg><script>alert(1)</script></svg>');
    const filePath = path.join(root, ...svgKey.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, unsafeSvg);

    await expect(
      readAndValidateLocalArtwork(
        {
          ...SOURCE_RECORD,
          storageKey: svgKey,
          sizeBytes: unsafeSvg.byteLength,
          checksum: sha256(unsafeSvg),
          detectedMimeType: 'image/svg+xml',
        },
        root,
        1024 * 1024,
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_TYPE_INVALID' });
  });

  it('rejects a symlinked source directory before opening artwork', async () => {
    const root = await makeTempDirectory();
    const outsideYearDirectory = path.join(root, 'outside', '2026');
    const actualFile = path.join(
      outsideYearDirectory,
      '10',
      '29',
      path.basename(IMAGE_KEY),
    );
    await mkdir(path.dirname(actualFile), { recursive: true });
    await writeFile(actualFile, PNG);
    try {
      await symlink(
        outsideYearDirectory,
        path.join(root, '2026'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (
        process.platform === 'win32' &&
        error instanceof Error &&
        'code' in error &&
        (error.code === 'EPERM' || error.code === 'EACCES')
      ) {
        return;
      }
      throw error;
    }

    await expect(
      readAndValidateLocalArtwork(SOURCE_RECORD, root, 1024 * 1024),
    ).rejects.toMatchObject({ code: 'SOURCE_PATH_CONTAINS_SYMLINK' });
  });

  it('preserves PDF and SVG formats as raw Cloudinary resources', async () => {
    const pdf = Buffer.from('%PDF-1.7\nsynthetic file\n');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const pdfRecord = {
      ...SOURCE_RECORD,
      storageKey: '2026/10/29/123e4567-e89b-42d3-a456-426614174000.pdf',
      sizeBytes: pdf.byteLength,
      checksum: sha256(pdf),
      detectedMimeType: 'application/pdf',
    };
    const svgRecord = {
      ...SOURCE_RECORD,
      storageKey: '2026/10/29/123e4567-e89b-42d3-a456-426614174000.svg',
      sizeBytes: svg.byteLength,
      checksum: sha256(svg),
      detectedMimeType: 'image/svg+xml',
    };
    const pdfTarget = createDeterministicCloudinaryKey(pdfRecord, {
      contentType: 'application/pdf',
      resourceType: 'raw',
    });
    const svgTarget = createDeterministicCloudinaryKey(svgRecord, {
      contentType: 'image/svg+xml',
      resourceType: 'raw',
    });
    expect(pdfTarget.endsWith('.pdf')).toBe(true);
    expect(svgTarget.endsWith('.svg')).toBe(true);

    detectArtworkMimeMock
      .mockImplementationOnce(async () => 'application/pdf')
      .mockImplementationOnce(async () => 'image/svg+xml');
    const root = await makeTempDirectory();
    expect(
      await readAndValidateLocalArtwork(
        { ...pdfRecord, storageDriver: 'local' },
        await writeSourceFile(root, pdfRecord.storageKey, pdf),
        1024 * 1024,
      ),
    ).toMatchObject({ contentType: 'application/pdf', resourceType: 'raw' });
    expect(
      await readAndValidateLocalArtwork(
        { ...svgRecord, storageDriver: 'local' },
        await writeSourceFile(root, svgRecord.storageKey, svg),
        1024 * 1024,
      ),
    ).toMatchObject({ contentType: 'image/svg+xml', resourceType: 'raw' });
  });
});

describe.skip('write migration pipeline (disabled pending identity design)', () => {
  it('requires write confirmation and a verified local connected topology in the service', async () => {
    const fixture = makeFixture();
    const model = mockArtworkAssetModel(fixture);
    await expect(
      migrateArtworkRecords(
        { dryRun: false, target: TARGET },
        fixture.dependencies,
      ),
    ).rejects.toThrow('MIGRATION_CONFIRMATION_REQUIRED');

    await expect(
      runMigration(fixture, {
        ...writeOptions(),
        confirmation: getArtworkMigrationTargetIdentifier(TARGET),
      }),
    ).rejects.toThrow('MIGRATION_WRITE_DISABLED_PENDING_IDENTITY_DESIGN');
    expect(model.find).not.toHaveBeenCalled();
    expect(fixture.storage.getMetadata).not.toHaveBeenCalled();
    expect(fixture.storage.putForMigration).not.toHaveBeenCalled();

    env.NODE_ENV = 'production';
    await expect(runMigration(fixture)).rejects.toThrow(
      'MIGRATION_REQUIRES_DEVELOPMENT_ENVIRONMENT',
    );
    expect(model.find).not.toHaveBeenCalled();

    env.NODE_ENV = 'development';
    vi.spyOn(mongoose.connection, 'getClient').mockReturnValue(
      makeFakeMongoClient(TARGET.database, [
        ['remote.example.test:27017', standaloneDescription()],
      ]) as ReturnType<typeof mongoose.connection.getClient>,
    );
    await expect(runMigration(fixture)).rejects.toThrow(
      'MIGRATION_CONNECTED_SERVER_UNSAFE',
    );
    expect(model.find).not.toHaveBeenCalled();
  });

  it('rejects fabricated runtime targets for both dry-run and write mode', async () => {
    const fixture = makeFixture();
    const model = mockArtworkAssetModel(fixture);
    env.NODE_ENV = 'staging';
    await expect(
      runMigration(fixture, { dryRun: true, target: TARGET }),
    ).rejects.toThrow('MIGRATION_REQUIRES_DEVELOPMENT_ENVIRONMENT');
    expect(model.find).not.toHaveBeenCalled();
    expect(fixture.storage.getMetadata).not.toHaveBeenCalled();

    env.NODE_ENV = 'development';
    env.MONGODB_URI = 'mongodb://localhost:27017/other_test_database';
    await expect(
      migrateArtworkRecords(
        { dryRun: true, target: TARGET },
        fixture.dependencies,
      ),
    ).rejects.toThrow('MIGRATION_RUNTIME_TARGET_MISMATCH');
    await expect(
      migrateArtworkRecords(writeOptions(), fixture.dependencies),
    ).rejects.toThrow('MIGRATION_RUNTIME_TARGET_MISMATCH');

    env.MONGODB_URI = 'mongodb://localhost:27017/dainty_bloom_test';
    vi.spyOn(mongoose.connection, 'getClient').mockReturnValue(
      makeFakeMongoClient('other_test_database', [
        ['localhost:27017', standaloneDescription()],
      ]) as ReturnType<typeof mongoose.connection.getClient>,
    );
    await expect(
      runMigration(fixture, { dryRun: true, target: TARGET }),
    ).rejects.toThrow('MIGRATION_CONNECTED_DATABASE_UNVERIFIABLE');
    expect(model.find).not.toHaveBeenCalled();
  });

  it('ignores injected record readers and writers and uses its bound ArtworkAsset model', async () => {
    const fixture = makeFixture();
    const readBypassingDatabase = vi.fn(async () => []);
    const writeBypassingDatabase = vi.fn(async () => true);
    const unsafeDependencies = Object.assign(fixture.dependencies, {
      records: readBypassingDatabase,
      updateRecord: writeBypassingDatabase,
    });

    const report = await runMigration(
      fixture,
      writeOptions(),
      unsafeDependencies,
    );

    expect(report.summary.migrated).toBe(1);
    expect(readBypassingDatabase).not.toHaveBeenCalled();
    expect(writeBypassingDatabase).not.toHaveBeenCalled();
  });

  it('revalidates topology immediately before a database update', async () => {
    const fixture = makeFixture();
    let validationCount = 0;
    vi.spyOn(mongoose.connection, 'getClient').mockImplementation(() => {
      validationCount += 1;
      const address =
        validationCount >= 3 ? 'remote.example.test:27017' : 'localhost:27017';
      return makeFakeMongoClient(TARGET.database, [
        [address, standaloneDescription()],
      ]) as ReturnType<typeof mongoose.connection.getClient>;
    });

    const report = await runMigration(fixture);

    expect(validationCount).toBeGreaterThanOrEqual(3);
    expect(report.summary.requiresReconciliation).toBe(1);
    expect(fixture.records[0]?.storageDriver).toBe('local');
    expect(ArtworkAsset.updateOne).not.toHaveBeenCalled();
  });

  it('serializes concurrent service invocations and preserves completed progress', async () => {
    const fixture = makeFixture();
    const [first, second] = await Promise.all([
      runMigration(fixture),
      runMigration(fixture),
    ]);

    expect(first.summary.migrated + second.summary.migrated).toBe(1);
    expect(first.summary.alreadyMigrated + second.summary.alreadyMigrated).toBe(
      1,
    );
    expect(fixture.journal.entries[SOURCE_RECORD.id]?.phase).toBe('complete');
    expect(fixture.records[0]?.storageDriver).toBe('cloudinary');
  });

  it('builds a conditional update that changes only storage fields', () => {
    const record = {
      ...SOURCE_RECORD,
      storageResourceType: 'raw' as const,
      owner: 'owner-id',
      sessionId: 'guest-session',
      cartItemId: 'cart-item-id',
      order: 'order-id',
      message: 'message-id',
      supersedes: 'prior-artwork-id',
    };

    expect(
      buildConditionalArtworkStorageUpdate(record, targetKey(), 'image'),
    ).toEqual({
      filter: {
        _id: record.id,
        storageDriver: 'local',
        storageKey: record.storageKey,
        checksum: record.checksum,
        storageResourceType: 'raw',
        sizeBytes: record.sizeBytes,
        detectedMimeType: record.detectedMimeType,
      },
      update: {
        $set: {
          storageDriver: 'cloudinary',
          storageKey: targetKey(),
          storageResourceType: 'image',
        },
      },
    });
  });

  it('preserves concurrent changes to protected storage fields and reports conflicts', async () => {
    const mutations = [
      [
        'storageDriver',
        (record: ArtworkMigrationRecord) => {
          record.storageDriver = 'cloudinary';
        },
      ],
      [
        'storageResourceType',
        (record: ArtworkMigrationRecord) => {
          record.storageResourceType = 'raw';
        },
      ],
      [
        'storageKey',
        (record: ArtworkMigrationRecord) => {
          record.storageKey = '2026/10/29/concurrent-change.png';
        },
      ],
      [
        'checksum',
        (record: ArtworkMigrationRecord) => {
          record.checksum = 'f'.repeat(64);
        },
      ],
      [
        'sizeBytes',
        (record: ArtworkMigrationRecord) => {
          record.sizeBytes += 1;
        },
      ],
      [
        'detectedMimeType',
        (record: ArtworkMigrationRecord) => {
          record.detectedMimeType = 'image/jpeg';
        },
      ],
    ] as const;

    for (const [field, mutate] of mutations) {
      const fixture = makeFixture();
      const originalUpdate = fixture.updateRecord.getMockImplementation();
      fixture.updateRecord.mockImplementationOnce(
        async (record, key, resourceType) => {
          const current = fixture.records[0];
          if (current) {
            const concurrentRecord = { ...current };
            mutate(concurrentRecord);
            fixture.records[0] = concurrentRecord;
          }
          return originalUpdate
            ? originalUpdate(record, key, resourceType)
            : false;
        },
      );

      const report = await runMigration(fixture);

      expect(
        report.summary.requiresReconciliation,
        `${field}: ${JSON.stringify(report)}`,
      ).toBe(1);
      expect(fixture.records[0]?.storageDriver).toBe(
        field === 'storageDriver' ? 'cloudinary' : 'local',
      );
      expect(fixture.records[0]?.storageKey).not.toBe(targetKey());
      expect(fixture.storage.assets.has(targetKey())).toBe(true);
    }
  });

  it('dry-run validates candidates but performs no journal, upload, or database writes', async () => {
    const fixture = makeFixture();
    const report = await runMigration(fixture, {
      dryRun: true,
      target: TARGET,
    });

    expect(report.summary).toMatchObject({
      planned: 1,
      migrated: 0,
      remainingLocal: 1,
    });
    expect(fixture.journalRepository.save).not.toHaveBeenCalled();
    expect(fixture.storage.putForMigration).not.toHaveBeenCalled();
    expect(fixture.updateRecord).not.toHaveBeenCalled();
  });

  it('migrates in place after authenticated provider metadata and checksum verification', async () => {
    const fixture = makeFixture();
    const original = {
      ...SOURCE_RECORD,
      owner: 'owner-id',
      sessionId: 'guest-session',
      order: 'order-id',
      message: 'message-id',
      supersedes: 'prior-artwork-id',
    };
    fixture.records[0] = original;
    const report = await runMigration(fixture);

    expect(report.summary).toMatchObject({
      migrated: 1,
      remainingLocal: 0,
      failed: 0,
      requiresReconciliation: 0,
      unverifiable: 0,
    });
    expect(fixture.storage.putForMigration).toHaveBeenCalledTimes(1);
    expect(fixture.records[0]).toMatchObject({
      id: original.id,
      storageDriver: 'cloudinary',
      storageKey: targetKey(),
      storageResourceType: 'image',
      owner: original.owner,
      sessionId: original.sessionId,
      order: original.order,
      message: original.message,
      supersedes: original.supersedes,
      checksum: original.checksum,
    });
    expect(fixture.journal.entries[original.id]?.phase).toBe('complete');
    expect(JSON.stringify(report)).not.toMatch(
      /https?:\/\/|api_secret|password/i,
    );
  });

  it('never deletes or moves a successfully migrated local source file', async () => {
    const root = await makeTempDirectory();
    const filePath = path.join(root, ...IMAGE_KEY.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, PNG);
    const fixture = makeFixture();
    fixture.dependencies.readSource = (record) =>
      readAndValidateLocalArtwork(record, root, 1024 * 1024);

    const report = await runMigration(fixture);

    expect(report.summary.migrated).toBe(1);
    await expect(readFile(filePath)).resolves.toEqual(PNG);
    expect(fixture.storage.assets.has(targetKey())).toBe(true);
    expect('delete' in fixture.storage).toBe(false);
  });

  it('uses a deterministic, record-specific Cloudinary ID on retries', () => {
    const first = createDeterministicCloudinaryKey(SOURCE_RECORD, {
      contentType: 'image/png',
      resourceType: 'image',
    });
    const second = createDeterministicCloudinaryKey(SOURCE_RECORD, {
      contentType: 'image/png',
      resourceType: 'image',
    });
    expect(first).toBe(second);
    expect(first).toMatch(
      /^dainty-bloom\/private-artwork\/2026\/10\/29\/[0-9a-f-]{36}$/i,
    );
  });

  it('uploads PDF artwork using a raw resource and a format-preserving key', async () => {
    const pdf = Buffer.from('%PDF-1.7\nsynthetic file\n');
    const record = {
      ...SOURCE_RECORD,
      storageKey: '2026/10/29/123e4567-e89b-42d3-a456-426614174000.pdf',
      checksum: sha256(pdf),
      sizeBytes: pdf.byteLength,
      detectedMimeType: 'application/pdf',
    };
    const fixture = makeFixture();
    fixture.records[0] = record;
    fixture.dependencies.readSource = async () => ({
      buffer: pdf,
      checksum: record.checksum,
      sizeBytes: record.sizeBytes,
      contentType: 'application/pdf',
      resourceType: 'raw',
    });

    const report = await runMigration(fixture);

    expect(report.summary.migrated).toBe(1);
    expect(fixture.storage.putForMigration).toHaveBeenCalledWith(
      expect.stringMatching(/\.pdf$/),
      pdf,
      { contentType: 'application/pdf', resourceType: 'raw' },
    );
  });

  it('reconciles an upload whose success response was lost without uploading a duplicate', async () => {
    const fixture = makeFixture();
    fixture.storage.putForMigration.mockImplementationOnce(
      async (key, buffer, meta) => {
        fixture.putAsset(key, buffer, meta);
        throw new Error('simulated lost upload response');
      },
    );

    const first = await runMigration(fixture);
    expect(first.summary.requiresReconciliation).toBe(1);
    expect(fixture.updateRecord).not.toHaveBeenCalled();

    const resumed = await runMigration(fixture);
    expect(resumed.summary.migrated).toBe(1);
    expect(fixture.storage.putForMigration).toHaveBeenCalledTimes(1);
  });

  it('does not upload when the validated source changes before upload', async () => {
    const fixture = makeFixture();
    fixture.dependencies.readSource = vi
      .fn()
      .mockResolvedValueOnce({
        buffer: PNG,
        checksum: SOURCE_RECORD.checksum,
        sizeBytes: PNG.byteLength,
        contentType: 'image/png',
        resourceType: 'image',
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from('changed source'),
        checksum: sha256(Buffer.from('changed source')),
        sizeBytes: Buffer.byteLength('changed source'),
        contentType: 'image/png',
        resourceType: 'image',
      });

    const report = await runMigration(fixture);

    expect(report.summary.requiresReconciliation).toBe(1);
    expect(report.records[0]?.failureCode).toBe('SOURCE_CHANGED_BEFORE_UPLOAD');
    expect(fixture.storage.putForMigration).not.toHaveBeenCalled();
    expect(fixture.updateRecord).not.toHaveBeenCalled();
  });

  it('resumes safely after every persisted journal phase', async () => {
    const phases = [
      'discovered',
      'source_validated',
      'upload_started',
      'cloudinary_upload_confirmed',
      'provider_metadata_verified',
      'sha256_verified',
      'database_record_updated',
      'complete',
    ] as const;

    for (const phase of phases) {
      const fixture = makeFixture();
      let interrupted = false;
      fixture.dependencies.afterPhase = async (_id, savedPhase) => {
        if (!interrupted && savedPhase === phase) {
          interrupted = true;
          throw new ArtworkMigrationInterruption();
        }
      };
      await expect(runMigration(fixture)).rejects.toBeInstanceOf(
        ArtworkMigrationInterruption,
      );

      fixture.dependencies.afterPhase = undefined;
      const resumed = await runMigration(fixture);
      expect(resumed.summary.migrated + resumed.summary.alreadyMigrated).toBe(
        1,
      );
      expect(
        fixture.storage.putForMigration.mock.calls.length,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('recognizes an already uploaded matching deterministic asset and does not upload again', async () => {
    const fixture = makeFixture();
    fixture.putAsset(targetKey(), PNG, {
      contentType: 'image/png',
      resourceType: 'image',
    });

    const report = await runMigration(fixture);

    expect(report.summary.migrated).toBe(1);
    expect(fixture.storage.putForMigration).not.toHaveBeenCalled();
    expect(fixture.updateRecord).toHaveBeenCalledTimes(1);
  });

  it('does not update the database when provider metadata is wrong or unverifiable', async () => {
    const wrongType = makeFixture();
    wrongType.putAsset(
      targetKey(),
      PNG,
      { contentType: 'image/png', resourceType: 'image' },
      { resourceType: 'raw' },
    );
    const mismatch = await runMigration(wrongType);
    expect(mismatch.summary.requiresReconciliation).toBe(1);
    expect(wrongType.updateRecord).not.toHaveBeenCalled();

    const unknownMetadata = makeFixture();
    unknownMetadata.storage.getMetadata.mockResolvedValue({
      publicId: targetKey(),
    });
    const unverifiable = await runMigration(unknownMetadata);
    expect(unverifiable.summary.unverifiable).toBe(1);
    expect(unknownMetadata.updateRecord).not.toHaveBeenCalled();

    const wrongDelivery = makeFixture();
    wrongDelivery.putAsset(
      targetKey(),
      PNG,
      { contentType: 'image/png', resourceType: 'image' },
      { deliveryType: 'upload' },
    );
    const deliveryReport = await runMigration(wrongDelivery);
    expect(deliveryReport.summary.requiresReconciliation).toBe(1);
    expect(wrongDelivery.updateRecord).not.toHaveBeenCalled();
  });

  it('reports checksum and size mismatches for an existing deterministic upload', async () => {
    for (const mismatch of ['checksum', 'size'] as const) {
      const fixture = makeFixture();
      const actual = mismatch === 'checksum' ? Buffer.from('different') : PNG;
      fixture.putAsset(targetKey(), actual, {
        contentType: 'image/png',
        resourceType: 'image',
      });
      if (mismatch === 'size') {
        fixture.storage.getMetadata.mockImplementation(async (key) => ({
          publicId: key,
          sizeBytes: PNG.byteLength + 1,
          resourceType: 'image',
          deliveryType: 'authenticated',
        }));
      }

      const report = await runMigration(fixture);
      expect(report.summary.requiresReconciliation).toBe(1);
      expect(fixture.updateRecord).not.toHaveBeenCalled();
      expect(fixture.storage.putForMigration).not.toHaveBeenCalled();
    }
  });

  it('marks provider failures and conditional database conflicts without deleting either copy', async () => {
    const providerFailure = makeFixture();
    providerFailure.storage.getMetadata.mockRejectedValue(
      Object.assign(new Error('private URL and credential'), {
        code: 'ARTWORK_PROVIDER_ERROR',
      }),
    );
    const providerReport = await runMigration(providerFailure);
    expect(providerReport.summary.unverifiable).toBe(1);
    expect(providerFailure.storage.putForMigration).not.toHaveBeenCalled();
    expect(providerFailure.updateRecord).not.toHaveBeenCalled();
    expect(JSON.stringify(providerReport)).not.toMatch(
      /private URL|credential|https?:\/\//i,
    );

    const conflict = makeFixture();
    conflict.updateRecord.mockResolvedValue(false);
    const conflictReport = await runMigration(conflict);
    expect(conflictReport.summary.requiresReconciliation).toBe(1);
    expect(conflict.records[0]?.storageDriver).toBe('local');
    expect(conflict.storage.assets.has(targetKey())).toBe(true);
    expect(conflict.journal.entries[SOURCE_RECORD.id]?.phase).toBe(
      'requires_reconciliation',
    );
  });

  it('reports missing sources, unknown drivers, and failed journal persistence explicitly', async () => {
    const missing = makeFixture();
    missing.dependencies.readSource = async () => {
      throw new ArtworkMigrationError('SOURCE_FILE_MISSING', 'unverifiable');
    };
    const missingReport = await runMigration(missing);
    expect(missingReport.summary.unverifiable).toBe(1);

    const realJournalFailure = makeFixture();
    realJournalFailure.dependencies.readSource = async () => {
      throw new ArtworkMigrationError('SOURCE_FILE_MISSING', 'unverifiable');
    };
    realJournalFailure.dependencies.journalRepository =
      new FileArtworkMigrationJournal(
        path.join(await makeTempDirectory(), 'source-failure.jsonl'),
      );
    const realJournalReport = await runMigration(realJournalFailure);
    expect(realJournalReport.summary.unverifiable).toBe(1);
    const persistedFailure =
      await realJournalFailure.dependencies.journalRepository.load(TARGET);
    expect(persistedFailure.entries[SOURCE_RECORD.id]?.phase).toBe('failed');
    expect(persistedFailure.entries[SOURCE_RECORD.id]?.failureCode).toBe(
      'SOURCE_FILE_MISSING',
    );

    const unreadable = makeFixture();
    unreadable.dependencies.readSource = async () => {
      throw new ArtworkMigrationError('SOURCE_FILE_UNREADABLE', 'unverifiable');
    };
    const unreadableReport = await runMigration(unreadable);
    expect(unreadableReport.summary.unverifiable).toBe(1);

    const unknown = makeFixture();
    unknown.records[0] = {
      ...SOURCE_RECORD,
      storageDriver: 'unknown-provider',
    };
    const unknownReport = await runMigration(unknown);
    expect(unknownReport.records[0]?.status).toBe('unverifiable');
    expect(unknown.storage.putForMigration).not.toHaveBeenCalled();

    const unavailableJournal = makeFixture();
    unavailableJournal.journalRepository.save.mockRejectedValue(
      new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE'),
    );
    await expect(runMigration(unavailableJournal)).rejects.toMatchObject({
      code: 'JOURNAL_UNAVAILABLE',
    });
    expect(unavailableJournal.storage.putForMigration).not.toHaveBeenCalled();
  });

  it('verifies an already Cloudinary-backed record before counting it as migrated', async () => {
    const fixture = makeFixture();
    fixture.records[0] = {
      ...SOURCE_RECORD,
      storageDriver: 'cloudinary',
      storageKey: targetKey(),
      storageResourceType: 'image',
    };
    fixture.putAsset(targetKey(), PNG, {
      contentType: 'image/png',
      resourceType: 'image',
    });

    const report = await runMigration(fixture, {
      dryRun: true,
      target: TARGET,
    });
    expect(report.summary.alreadyMigrated).toBe(1);
    expect(report.summary.unverifiable).toBe(0);
    expect(fixture.storage.putForMigration).not.toHaveBeenCalled();
    expect(fixture.updateRecord).not.toHaveBeenCalled();
  });
});

function makeFixture() {
  const records = [{ ...SOURCE_RECORD }];
  let runLock = Promise.resolve();
  const journal: ArtworkMigrationJournal = {
    version: 1,
    target: TARGET,
    entries: {},
  };
  const assets = new Map<
    string,
    {
      buffer: Buffer;
      metadata: {
        publicId: string;
        sizeBytes: number;
        resourceType: string;
        deliveryType: string;
      };
    }
  >();
  const storage = {
    putForMigration: vi.fn(
      async (key: string, buffer: Buffer, meta: { resourceType?: string }) => {
        if (assets.has(key)) throw new Error('overwrite attempted');
        putAsset(key, buffer, {
          contentType: 'image/png',
          resourceType: meta.resourceType ?? 'image',
        });
      },
    ),
    getMetadata: vi.fn(async (key: string) => {
      const asset = assets.get(key);
      if (!asset) {
        throw Object.assign(new Error('missing'), {
          code: 'ARTWORK_ASSET_NOT_FOUND',
        });
      }
      return asset.metadata;
    }),
    getStream: vi.fn((key: string) => {
      const asset = assets.get(key);
      if (!asset) throw new Error('missing');
      return Readable.from([asset.buffer]);
    }),
    assets,
  };
  const putAsset = (
    key: string,
    buffer: Buffer,
    meta: { contentType: string; resourceType: string },
    overrides: { resourceType?: string; deliveryType?: string } = {},
  ) => {
    assets.set(key, {
      buffer,
      metadata: {
        publicId: key,
        sizeBytes: buffer.byteLength,
        resourceType: overrides.resourceType ?? meta.resourceType,
        deliveryType: overrides.deliveryType ?? 'authenticated',
      },
    });
  };
  const journalRepository: ArtworkMigrationJournalRepository = {
    load: vi.fn(async (target) => {
      if (target.database !== journal.target.database) {
        throw new Error('target mismatch');
      }
      return structuredClone(journal);
    }),
    save: vi.fn(async (updatedJournal) => {
      Object.assign(journal, structuredClone(updatedJournal));
    }),
    withMigrationLock: vi.fn(async (action) => {
      const previous = runLock;
      let releaseRun: (() => void) | undefined;
      runLock = new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
      await previous;
      try {
        return await action();
      } finally {
        releaseRun?.();
      }
    }),
  };
  const updateRecord = vi.fn(
    async (
      record: ArtworkMigrationRecord,
      key: string,
      resourceType: 'image' | 'raw',
    ) => {
      const current = records.find((item) => item.id === record.id);
      if (
        !current ||
        current.storageDriver !== 'local' ||
        current.storageKey !== record.storageKey ||
        current.checksum !== record.checksum ||
        current.storageResourceType !== record.storageResourceType ||
        current.sizeBytes !== record.sizeBytes ||
        current.detectedMimeType !== record.detectedMimeType
      ) {
        return false;
      }
      Object.assign(current, {
        storageDriver: 'cloudinary',
        storageKey: key,
        storageResourceType: resourceType,
      });
      return true;
    },
  );
  const source: ValidatedArtworkSource = {
    buffer: PNG,
    checksum: SOURCE_RECORD.checksum,
    sizeBytes: PNG.byteLength,
    contentType: 'image/png',
    resourceType: 'image',
  };
  const dependencies: ArtworkMigrationDependencies = {
    readSource: async () => source,
    storage,
    journalRepository,
  };
  return {
    records,
    journal,
    assets: storage.assets,
    storage,
    updateRecord,
    journalRepository,
    dependencies,
    putAsset,
  };
}

function mockArtworkAssetModel(fixture: ReturnType<typeof makeFixture>) {
  const find = vi.spyOn(ArtworkAsset, 'find').mockImplementation(
    () =>
      ({
        select: () => ({
          lean: async () =>
            fixture.records.map((record) => ({
              ...record,
              _id: { toString: () => record.id },
            })),
        }),
      }) as never,
  );
  const updateOne = vi
    .spyOn(ArtworkAsset, 'updateOne')
    .mockImplementation((filter, update) => {
      const record = fixture.records.find((item) => item.id === filter._id);
      const resourceTypeFilter = filter.storageResourceType;
      const resourceTypeMatches =
        typeof resourceTypeFilter === 'string'
          ? record?.storageResourceType === resourceTypeFilter
          : typeof resourceTypeFilter === 'object' &&
              resourceTypeFilter !== null &&
              '$exists' in resourceTypeFilter
            ? (record?.storageResourceType !== undefined) ===
              resourceTypeFilter.$exists
            : false;
      const matches =
        record !== undefined &&
        filter.storageDriver === record.storageDriver &&
        filter.storageKey === record.storageKey &&
        filter.checksum === record.checksum &&
        resourceTypeMatches &&
        filter.sizeBytes === record.sizeBytes &&
        filter.detectedMimeType === record.detectedMimeType;
      if (!matches || !record) {
        return Promise.resolve({ matchedCount: 0 }) as never;
      }
      const updateValues = update.$set as
        | {
            storageKey?: string;
            storageResourceType?: 'image' | 'raw';
          }
        | undefined;
      if (
        typeof updateValues?.storageKey !== 'string' ||
        !updateValues.storageResourceType
      ) {
        return Promise.resolve({ matchedCount: 0 }) as never;
      }
      return fixture
        .updateRecord(
          record,
          updateValues.storageKey,
          updateValues.storageResourceType,
        )
        .then((matched) => ({ matchedCount: matched ? 1 : 0 })) as never;
    });
  return { find, updateOne };
}

function runMigration(
  fixture: ReturnType<typeof makeFixture>,
  options = writeOptions(),
  dependencies: ArtworkMigrationDependencies = fixture.dependencies,
) {
  mockArtworkAssetModel(fixture);
  return migrateArtworkRecords(options, dependencies);
}

function writeOptions() {
  return {
    dryRun: false,
    target: TARGET,
    confirmation: getArtworkMigrationTargetIdentifier(TARGET),
  };
}

function makeFakeMongoClient(
  databaseName: string,
  servers: Array<[string, unknown]>,
  topologyType = 'Single',
  options: { directConnection?: boolean; replicaSet?: string } = {},
) {
  const client = {
    db: () => ({ databaseName }),
    options: {
      directConnection: false,
      loadBalanced: false,
      ...options,
    },
  };
  Object.defineProperty(client, 'topology', {
    value: {
      description: {
        type: topologyType,
        servers: new Map(
          servers.map(([address, description]) => [
            address,
            typeof description === 'object' && description !== null
              ? { ...description, address }
              : description,
          ]),
        ),
      },
    },
  });
  return client;
}

function standaloneDescription() {
  return {
    type: 'Standalone',
    setName: null,
    hosts: [],
    passives: [],
    arbiters: [],
  };
}

function replicaSetDescription() {
  return {
    type: 'RSPrimary',
    setName: 'artwork-test-replica',
    hosts: ['localhost:27017', 'localhost:27018'],
    passives: [],
    arbiters: [],
  };
}

async function makeTempDirectory(): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dainty-artwork-migration-'));
  return tempRoot;
}

async function writeSourceFile(
  root: string,
  key: string,
  buffer: Buffer,
): Promise<string> {
  const filePath = path.join(root, ...key.split('/'));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return root;
}

function targetKey(): string {
  return createDeterministicCloudinaryKey(SOURCE_RECORD, {
    contentType: 'image/png',
    resourceType: 'image',
  });
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function detectSyntheticArtworkMime(buffer: Buffer): Promise<string> {
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return Promise.resolve('image/png');
  }
  if (buffer.toString('utf8').startsWith('%PDF-')) {
    return Promise.resolve('application/pdf');
  }
  if (buffer.toString('utf8').includes('<svg')) {
    if (/<script/i.test(buffer.toString('utf8'))) {
      return Promise.reject(
        Object.assign(new Error('Invalid SVG'), { code: 'FILE_CORRUPT' }),
      );
    }
    return Promise.resolve('image/svg+xml');
  }
  return Promise.reject(
    Object.assign(new Error('Invalid artwork bytes'), { code: 'FILE_CORRUPT' }),
  );
}
