import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { ArtworkAsset, type IArtworkAsset } from '../models/ArtworkAsset';
import type { Connection, Model } from 'mongoose';

import { assertArtworkMigrationRuntimeTarget } from './artworkMigrationSafety';
import { detectArtworkMime } from '../utils/artworkFileType';
import type {
  ArtworkMigrationJournal,
  ArtworkMigrationJournalEntry,
  ArtworkMigrationJournalRepository,
  ArtworkMigrationPhase,
  ArtworkMigrationTarget,
} from './artworkMigrationJournal';
import type {
  MigrationStorageWriter,
  StorageDriver,
  StorageMeta,
} from './storage/StorageDriver';
import { isValidCloudinaryArtworkKey } from './storage/CloudinaryArtworkDriver';

const SHA256_HEX = /^[a-f0-9]{64}$/i;
const SAFE_LOCAL_MIGRATION_KEY =
  /^\d{4}\/\d{2}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|pdf|svg)$/i;
const RESOURCE_TYPE_BY_MIME: Record<string, 'image' | 'raw'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'application/pdf': 'raw',
  'image/svg+xml': 'raw',
};
const EXTENSIONS_BY_MIME: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'image/svg+xml': ['svg'],
};

export type ArtworkMigrationOutcomeStatus =
  | 'planned'
  | 'migrated'
  | 'already_migrated'
  | 'failed'
  | 'requires_reconciliation'
  | 'unverifiable';

export interface ArtworkMigrationRecord {
  id: string;
  storageDriver: string;
  storageKey: string;
  checksum: string;
  sizeBytes: number;
  detectedMimeType: string;
  storageResourceType?: 'image' | 'raw';
}

export interface ValidatedArtworkSource {
  buffer: Buffer;
  checksum: string;
  sizeBytes: number;
  contentType: string;
  resourceType: 'image' | 'raw';
}

export interface ArtworkMigrationOutcome {
  artworkId: string;
  status: ArtworkMigrationOutcomeStatus;
  phase: ArtworkMigrationPhase;
  failureCode?: string;
}

export interface ConditionalArtworkStorageUpdate {
  filter: {
    _id: string;
    storageDriver: 'local';
    storageKey: string;
    checksum: string;
    storageResourceType: 'image' | 'raw' | { $exists: false };
    sizeBytes: number;
    detectedMimeType: string;
  };
  update: {
    $set: {
      storageDriver: 'cloudinary';
      storageKey: string;
      storageResourceType: 'image' | 'raw';
    };
  };
}

export interface ArtworkMigrationReport {
  mode: 'dry-run' | 'write';
  target: ArtworkMigrationTarget;
  summary: {
    discovered: number;
    planned: number;
    migrated: number;
    alreadyMigrated: number;
    failed: number;
    requiresReconciliation: number;
    unverifiable: number;
    remainingLocal: number;
  };
  records: ArtworkMigrationOutcome[];
}

export interface ArtworkMigrationDependencies {
  readSource(record: ArtworkMigrationRecord): Promise<ValidatedArtworkSource>;
  storage: Pick<StorageDriver, 'getMetadata' | 'getStream'> &
    MigrationStorageWriter;
  journalRepository: ArtworkMigrationJournalRepository;
  artworkAssetModel?: Model<IArtworkAsset>;
  connection?: Connection;
  assertDatabaseIdentity?(): Promise<void>;
  afterPhase?(recordId: string, phase: ArtworkMigrationPhase): Promise<void>;
}

export class ArtworkMigrationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status:
      'failed' | 'requires_reconciliation' | 'unverifiable' = 'failed',
  ) {
    super(code);
    this.name = 'ArtworkMigrationError';
  }
}

export class ArtworkMigrationInterruption extends Error {
  constructor() {
    super('Simulated artwork migration interruption');
    this.name = 'ArtworkMigrationInterruption';
  }
}

export async function readAndValidateLocalArtwork(
  record: ArtworkMigrationRecord,
  configuredRoot: string,
  maximumBytes: number,
): Promise<ValidatedArtworkSource> {
  if (record.storageDriver !== 'local') {
    throw new ArtworkMigrationError('NOT_A_LOCAL_ARTWORK_RECORD', 'failed');
  }
  if (!SAFE_LOCAL_MIGRATION_KEY.test(record.storageKey)) {
    throw new ArtworkMigrationError('INVALID_SOURCE_STORAGE_KEY', 'failed');
  }
  if (!Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 1) {
    throw new ArtworkMigrationError('INVALID_RECORDED_SIZE', 'failed');
  }
  if (record.sizeBytes > maximumBytes) {
    throw new ArtworkMigrationError('SOURCE_EXCEEDS_SIZE_LIMIT', 'failed');
  }
  if (!SHA256_HEX.test(record.checksum)) {
    throw new ArtworkMigrationError('INVALID_RECORDED_CHECKSUM', 'failed');
  }

  const root = path.resolve(configuredRoot);
  let rootInfo;
  try {
    rootInfo = await lstat(root);
  } catch {
    throw new ArtworkMigrationError(
      'SOURCE_STORAGE_UNAVAILABLE',
      'unverifiable',
    );
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new ArtworkMigrationError(
      'SOURCE_STORAGE_UNAVAILABLE',
      'unverifiable',
    );
  }

  const filePath = path.resolve(root, ...record.storageKey.split('/'));
  const relativePath = path.relative(root, filePath);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new ArtworkMigrationError('INVALID_SOURCE_STORAGE_KEY', 'failed');
  }

  let current = root;
  try {
    for (const segment of record.storageKey.split('/')) {
      current = path.join(current, segment);
      const component = await lstat(current);
      if (component.isSymbolicLink()) {
        throw new ArtworkMigrationError(
          'SOURCE_PATH_CONTAINS_SYMLINK',
          'failed',
        );
      }
    }
    const resolvedRoot = await realpath(root);
    const resolvedFile = await realpath(filePath);
    if (!isWithinRoot(resolvedRoot, resolvedFile)) {
      throw new ArtworkMigrationError('INVALID_SOURCE_STORAGE_KEY', 'failed');
    }
  } catch (error) {
    if (error instanceof ArtworkMigrationError) throw error;
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new ArtworkMigrationError('SOURCE_FILE_MISSING', 'unverifiable');
    }
    throw new ArtworkMigrationError('SOURCE_FILE_UNREADABLE', 'unverifiable');
  }

  let handle;
  try {
    const noFollow =
      process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
    handle = await open(filePath, constants.O_RDONLY | noFollow);
    const fileInfo = await handle.stat({ bigint: true });
    assertStableFileIdentity(fileInfo, await lstat(filePath, { bigint: true }));
    if (!fileInfo.isFile()) {
      throw new ArtworkMigrationError('SOURCE_FILE_UNREADABLE', 'unverifiable');
    }
    if (fileInfo.size !== BigInt(record.sizeBytes)) {
      throw new ArtworkMigrationError('SOURCE_SIZE_MISMATCH', 'failed');
    }
    const buffer = await handle.readFile();
    const finalFileInfo = await handle.stat({ bigint: true });
    const finalPathInfo = await lstat(filePath, { bigint: true });
    assertStableFileIdentity(fileInfo, finalFileInfo);
    assertStableFileIdentity(finalFileInfo, finalPathInfo);
    if (
      finalFileInfo.size !== fileInfo.size ||
      finalFileInfo.mtimeMs !== fileInfo.mtimeMs ||
      finalFileInfo.ctimeMs !== fileInfo.ctimeMs
    ) {
      throw new ArtworkMigrationError('SOURCE_CHANGED_DURING_READ', 'failed');
    }
    if (BigInt(buffer.byteLength) !== fileInfo.size) {
      throw new ArtworkMigrationError('SOURCE_SIZE_MISMATCH', 'failed');
    }
    if (buffer.byteLength > maximumBytes) {
      throw new ArtworkMigrationError('SOURCE_EXCEEDS_SIZE_LIMIT', 'failed');
    }
    const contentType = await detectArtworkMime(buffer);
    if (contentType !== record.detectedMimeType) {
      throw new ArtworkMigrationError('SOURCE_TYPE_MISMATCH', 'failed');
    }
    const expectedResourceType = RESOURCE_TYPE_BY_MIME[contentType];
    const supportedExtensions = EXTENSIONS_BY_MIME[contentType];
    const extension = path.posix
      .extname(record.storageKey)
      .slice(1)
      .toLowerCase();
    if (!expectedResourceType || !supportedExtensions?.includes(extension)) {
      throw new ArtworkMigrationError('SOURCE_FORMAT_UNSUPPORTED', 'failed');
    }
    const checksum = createHash('sha256').update(buffer).digest('hex');
    if (checksum.toLowerCase() !== record.checksum.toLowerCase()) {
      throw new ArtworkMigrationError('SOURCE_CHECKSUM_MISMATCH', 'failed');
    }
    return {
      buffer,
      checksum,
      sizeBytes: buffer.byteLength,
      contentType,
      resourceType: expectedResourceType,
    };
  } catch (error) {
    if (error instanceof ArtworkMigrationError) throw error;
    if (getErrorCode(error) === 'FILE_CORRUPT') {
      throw new ArtworkMigrationError('SOURCE_TYPE_INVALID', 'failed');
    }
    throw new ArtworkMigrationError('SOURCE_FILE_UNREADABLE', 'unverifiable');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function migrateArtworkRecords(
  options: {
    dryRun: boolean;
    target: ArtworkMigrationTarget;
    confirmation?: string;
  },
  dependencies: ArtworkMigrationDependencies,
): Promise<ArtworkMigrationReport> {
  if (options.dryRun) {
    throw new Error('MIGRATION_SIGNED_PREFLIGHT_REQUIRED');
  }
  const artworkModel = dependencies.artworkAssetModel ?? ArtworkAsset;
  await assertMigrationExecutionAuthorization(
    options.target,
    options.confirmation,
    options.dryRun,
    dependencies,
    artworkModel,
  );
  return dependencies.journalRepository.withMigrationLock(() =>
    migrateArtworkRecordsLocked(options, dependencies),
  );
}

async function migrateArtworkRecordsLocked(
  options: {
    dryRun: boolean;
    target: ArtworkMigrationTarget;
    confirmation?: string;
  },
  dependencies: ArtworkMigrationDependencies,
): Promise<ArtworkMigrationReport> {
  const artworkModel = dependencies.artworkAssetModel ?? ArtworkAsset;
  await assertMigrationExecutionAuthorization(
    options.target,
    options.confirmation,
    options.dryRun,
    dependencies,
    artworkModel,
  );
  const [records, journal] = await Promise.all([
    readArtworkMigrationRecords(artworkModel),
    dependencies.journalRepository.load(options.target),
  ]);
  const outcomes: ArtworkMigrationOutcome[] = [];

  for (const record of records) {
    if (record.storageDriver === 'cloudinary') {
      outcomes.push({
        artworkId: record.id,
        status: 'unverifiable',
        phase: journal.entries[record.id]?.phase ?? 'discovered',
        failureCode: 'CLOUDINARY_ACCOUNT_IDENTITY_UNVERIFIABLE',
      });
      continue;
    }
    if (record.storageDriver !== 'local') {
      outcomes.push({
        artworkId: record.id,
        status: 'unverifiable',
        phase: journal.entries[record.id]?.phase ?? 'discovered',
        failureCode: 'UNSUPPORTED_STORAGE_DRIVER',
      });
      continue;
    }

    try {
      const source = await dependencies.readSource(record);
      const targetKey = createDeterministicCloudinaryKey(record, source);
      const previous = journal.entries[record.id];
      if (
        previous &&
        (previous.sourceKey !== record.storageKey ||
          previous.sourceChecksum.toLowerCase() !==
            record.checksum.toLowerCase() ||
          previous.targetKey !== targetKey)
      ) {
        throw new ArtworkMigrationError(
          'JOURNAL_SOURCE_CONFLICT',
          'requires_reconciliation',
        );
      }
      if (options.dryRun) {
        outcomes.push({
          artworkId: record.id,
          status: 'planned',
          phase: previous?.phase ?? 'source_validated',
        });
        continue;
      }

      const entry = previous
        ? restartTerminalJournalEntry(previous)
        : createJournalEntry(record, targetKey, 'discovered');
      journal.entries[record.id] = entry;
      if (!previous || entry.phase === 'discovered')
        await savePhase(record.id, entry, 'discovered', journal, dependencies);
      await savePhase(
        record.id,
        entry,
        'source_validated',
        journal,
        dependencies,
      );

      const meta: StorageMeta = {
        contentType: source.contentType,
        resourceType: source.resourceType,
      };
      const existing = await findExistingAsset(
        targetKey,
        source,
        meta,
        dependencies.storage,
      );
      if (existing === 'missing') {
        await savePhase(
          record.id,
          entry,
          'upload_started',
          journal,
          dependencies,
        );
        let uploadSource: ValidatedArtworkSource;
        try {
          uploadSource = await dependencies.readSource(record);
          assertSameSourceSnapshot(source, uploadSource);
        } catch (error) {
          if (error instanceof ArtworkMigrationError) throw error;
          throw new ArtworkMigrationError(
            'SOURCE_CHANGED_BEFORE_UPLOAD',
            'requires_reconciliation',
          );
        }
        try {
          await dependencies.storage.putForMigration(
            targetKey,
            uploadSource.buffer,
            meta,
          );
        } catch {
          throw new ArtworkMigrationError(
            'CLOUDINARY_UPLOAD_UNCONFIRMED',
            'requires_reconciliation',
          );
        }
        await savePhase(
          record.id,
          entry,
          'cloudinary_upload_confirmed',
          journal,
          dependencies,
        );
      } else {
        await savePhase(
          record.id,
          entry,
          'cloudinary_upload_confirmed',
          journal,
          dependencies,
        );
      }

      await verifyCloudinaryAsset(
        targetKey,
        source,
        meta,
        dependencies.storage,
      );
      await savePhase(
        record.id,
        entry,
        'provider_metadata_verified',
        journal,
        dependencies,
      );
      await savePhase(
        record.id,
        entry,
        'sha256_verified',
        journal,
        dependencies,
      );

      let updated: boolean;
      try {
        await assertMigrationExecutionAuthorization(
          options.target,
          options.confirmation,
          options.dryRun,
          dependencies,
          artworkModel,
        );
        const command = buildConditionalArtworkStorageUpdate(
          record,
          targetKey,
          source.resourceType,
        );
        const result = await artworkModel.updateOne(
          command.filter,
          command.update,
          { runValidators: true },
        );
        updated = result.matchedCount === 1;
      } catch {
        throw new ArtworkMigrationError(
          'DATABASE_UPDATE_UNCONFIRMED',
          'requires_reconciliation',
        );
      }
      if (!updated) {
        throw new ArtworkMigrationError(
          'DATABASE_UPDATE_CONFLICT',
          'requires_reconciliation',
        );
      }
      await savePhase(
        record.id,
        entry,
        'database_record_updated',
        journal,
        dependencies,
      );
      await savePhase(record.id, entry, 'complete', journal, dependencies);
      outcomes.push({
        artworkId: record.id,
        status: 'migrated',
        phase: 'complete',
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ArtworkMigrationInterruption'
      ) {
        throw error;
      }
      if (isJournalError(error)) throw error;
      const migrationError =
        error instanceof ArtworkMigrationError
          ? error
          : new ArtworkMigrationError('MIGRATION_UNEXPECTED_ERROR', 'failed');
      const previous = journal.entries[record.id];
      const failurePhase =
        migrationError.status === 'requires_reconciliation'
          ? 'requires_reconciliation'
          : 'failed';
      const entry = options.dryRun
        ? (previous ??
          createJournalEntry(record, safeTargetKey(record), failurePhase))
        : previous === undefined
          ? createJournalEntry(record, safeTargetKey(record), 'discovered')
          : restartTerminalJournalEntry(previous);
      if (!options.dryRun && (previous === undefined || entry !== previous)) {
        journal.entries[record.id] = entry;
        await savePhase(record.id, entry, 'discovered', journal, dependencies);
      }
      entry.failureCode = migrationError.code;
      journal.entries[record.id] = entry;
      if (!options.dryRun) {
        const phase =
          migrationError.status === 'requires_reconciliation'
            ? 'requires_reconciliation'
            : 'failed';
        entry.phase = phase;
        entry.updatedAt = new Date().toISOString();
        entry.failureCode = migrationError.code;
        await dependencies.journalRepository.save(journal, record.id);
      }
      outcomes.push({
        artworkId: record.id,
        status: migrationError.status,
        phase: entry.phase,
        failureCode: migrationError.code,
      });
    }
  }

  const summary = {
    discovered: records.length,
    planned: countStatus(outcomes, 'planned'),
    migrated: countStatus(outcomes, 'migrated'),
    alreadyMigrated: countStatus(outcomes, 'already_migrated'),
    failed: countStatus(outcomes, 'failed'),
    requiresReconciliation: countStatus(outcomes, 'requires_reconciliation'),
    unverifiable: countStatus(outcomes, 'unverifiable'),
    remainingLocal: outcomes.filter(
      (outcome) =>
        outcome.status !== 'migrated' &&
        records.find((record) => record.id === outcome.artworkId)
          ?.storageDriver === 'local',
    ).length,
  };
  return {
    mode: options.dryRun ? 'dry-run' : 'write',
    target: options.target,
    summary,
    records: outcomes,
  };
}

export function createDeterministicCloudinaryKey(
  record: ArtworkMigrationRecord,
  source: Pick<ValidatedArtworkSource, 'contentType' | 'resourceType'>,
): string {
  if (!SAFE_LOCAL_MIGRATION_KEY.test(record.storageKey)) {
    throw new ArtworkMigrationError('INVALID_SOURCE_STORAGE_KEY', 'failed');
  }
  const datePath = record.storageKey.split('/').slice(0, 3).join('/');
  const digest = createHash('sha256')
    .update(`dainty-bloom-artwork-migration:v1:${record.id}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  digest[12] = '5';
  digest[16] = ((parseInt(digest[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const uuid = [
    digest.slice(0, 8).join(''),
    digest.slice(8, 12).join(''),
    digest.slice(12, 16).join(''),
    digest.slice(16, 20).join(''),
    digest.slice(20, 32).join(''),
  ].join('-');
  const extension =
    source.resourceType === 'raw'
      ? `.${source.contentType === 'application/pdf' ? 'pdf' : 'svg'}`
      : '';
  const key = `dainty-bloom/private-artwork/${datePath}/${uuid}${extension}`;
  if (!isValidCloudinaryArtworkKey(key)) {
    throw new ArtworkMigrationError(
      'INVALID_DETERMINISTIC_TARGET_KEY',
      'failed',
    );
  }
  return key;
}

export function buildConditionalArtworkStorageUpdate(
  record: ArtworkMigrationRecord,
  targetKey: string,
  resourceType: 'image' | 'raw',
): ConditionalArtworkStorageUpdate {
  return {
    filter: {
      _id: record.id,
      storageDriver: 'local',
      storageKey: record.storageKey,
      checksum: record.checksum,
      storageResourceType: record.storageResourceType ?? { $exists: false },
      sizeBytes: record.sizeBytes,
      detectedMimeType: record.detectedMimeType,
    },
    update: {
      $set: {
        storageDriver: 'cloudinary',
        storageKey: targetKey,
        storageResourceType: resourceType,
      },
    },
  };
}

async function readArtworkMigrationRecords(
  artworkModel: Model<IArtworkAsset>,
): Promise<ArtworkMigrationRecord[]> {
  const documents = await artworkModel
    .find()
    .select(
      '_id +storageKey storageDriver checksum sizeBytes detectedMimeType storageResourceType',
    )
    .lean();
  return documents.map((document) => ({
    id: document._id.toString(),
    storageDriver: document.storageDriver,
    storageKey: document.storageKey,
    checksum: document.checksum,
    sizeBytes: document.sizeBytes,
    detectedMimeType: document.detectedMimeType,
    storageResourceType: document.storageResourceType,
  }));
}

async function assertMigrationExecutionAuthorization(
  target: ArtworkMigrationTarget,
  confirmation: string | undefined,
  dryRun: boolean,
  dependencies: ArtworkMigrationDependencies,
  artworkModel: Model<IArtworkAsset>,
): Promise<void> {
  if (!dryRun) {
    assertArtworkMigrationRuntimeTarget(
      target,
      confirmation,
      dependencies.connection ?? artworkModel.db,
      false,
    );
  }
  if (
    dependencies.connection &&
    dependencies.artworkAssetModel &&
    dependencies.assertDatabaseIdentity
  ) {
    if (
      dependencies.connection.readyState !== 1 ||
      dependencies.connection.db?.databaseName !== target.database
    ) {
      throw new Error('MIGRATION_CONNECTED_DATABASE_UNVERIFIABLE');
    }
    await dependencies.assertDatabaseIdentity();
    return;
  }
  assertArtworkMigrationRuntimeTarget(
    target,
    confirmation,
    dependencies.connection ?? artworkModel.db,
    dryRun,
  );
}

async function findExistingAsset(
  targetKey: string,
  source: ValidatedArtworkSource,
  meta: StorageMeta,
  storage: ArtworkMigrationDependencies['storage'],
): Promise<'existing' | 'missing'> {
  try {
    await storage.getMetadata(targetKey, meta);
  } catch (error) {
    if (getErrorCode(error) === 'ARTWORK_ASSET_NOT_FOUND') return 'missing';
    throw new ArtworkMigrationError(
      'CLOUDINARY_PROVIDER_UNVERIFIABLE',
      'unverifiable',
    );
  }
  await verifyCloudinaryAsset(targetKey, source, meta, storage);
  return 'existing';
}

async function verifyCloudinaryAsset(
  targetKey: string,
  source: Pick<
    ValidatedArtworkSource,
    'checksum' | 'sizeBytes' | 'contentType' | 'resourceType'
  >,
  meta: StorageMeta,
  storage: ArtworkMigrationDependencies['storage'],
): Promise<void> {
  let metadata;
  try {
    metadata = await storage.getMetadata(targetKey, meta);
  } catch (error) {
    throw new ArtworkMigrationError(
      getErrorCode(error) === 'ARTWORK_ASSET_NOT_FOUND'
        ? 'CLOUDINARY_ASSET_MISSING'
        : 'CLOUDINARY_PROVIDER_UNVERIFIABLE',
      getErrorCode(error) === 'ARTWORK_ASSET_NOT_FOUND'
        ? 'requires_reconciliation'
        : 'unverifiable',
    );
  }
  if (
    (metadata.publicId !== undefined && metadata.publicId !== targetKey) ||
    (metadata.resourceType !== undefined &&
      metadata.resourceType !== source.resourceType) ||
    (metadata.deliveryType !== undefined &&
      metadata.deliveryType !== 'authenticated')
  ) {
    throw new ArtworkMigrationError(
      'CLOUDINARY_METADATA_MISMATCH',
      'requires_reconciliation',
    );
  }
  if (
    metadata.publicId === undefined ||
    metadata.resourceType === undefined ||
    metadata.deliveryType === undefined ||
    typeof metadata.sizeBytes !== 'number'
  ) {
    throw new ArtworkMigrationError(
      'CLOUDINARY_METADATA_UNVERIFIABLE',
      'unverifiable',
    );
  }
  if (metadata.sizeBytes !== source.sizeBytes) {
    throw new ArtworkMigrationError(
      'CLOUDINARY_SIZE_MISMATCH',
      'requires_reconciliation',
    );
  }
  if (source.checksum.length === 0 || !SHA256_HEX.test(source.checksum)) {
    throw new ArtworkMigrationError('INVALID_EXPECTED_CHECKSUM', 'failed');
  }
  if (!isValidCloudinaryArtworkKey(targetKey)) {
    throw new ArtworkMigrationError('INVALID_CLOUDINARY_STORAGE_KEY', 'failed');
  }

  let actualChecksum: string;
  let actualSize: number;
  try {
    ({ checksum: actualChecksum, sizeBytes: actualSize } = await checksumStream(
      storage.getStream(targetKey, meta),
    ));
  } catch {
    throw new ArtworkMigrationError(
      'CLOUDINARY_ASSET_UNREADABLE',
      'unverifiable',
    );
  }
  if (actualSize !== source.sizeBytes) {
    throw new ArtworkMigrationError(
      'CLOUDINARY_SIZE_MISMATCH',
      'requires_reconciliation',
    );
  }
  if (actualChecksum.toLowerCase() !== source.checksum.toLowerCase()) {
    throw new ArtworkMigrationError(
      'CLOUDINARY_CHECKSUM_MISMATCH',
      'requires_reconciliation',
    );
  }
}

async function checksumStream(
  stream: Readable,
): Promise<{ checksum: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.byteLength;
    hash.update(buffer);
  }
  return { checksum: hash.digest('hex'), sizeBytes };
}

function createJournalEntry(
  record: ArtworkMigrationRecord,
  targetKey: string,
  phase: ArtworkMigrationPhase,
): ArtworkMigrationJournalEntry {
  return {
    artworkId: record.id,
    attemptId: randomUUID(),
    sourceKey: record.storageKey,
    sourceChecksum: record.checksum,
    targetKey,
    phase,
    updatedAt: new Date().toISOString(),
  };
}

function restartTerminalJournalEntry(
  entry: ArtworkMigrationJournalEntry,
): ArtworkMigrationJournalEntry {
  if (entry.phase !== 'failed' && entry.phase !== 'requires_reconciliation') {
    return entry;
  }
  const restarted: ArtworkMigrationJournalEntry = {
    ...entry,
    attemptId: randomUUID(),
    phase: 'discovered',
    updatedAt: new Date().toISOString(),
  };
  delete restarted.failureCode;
  return restarted;
}

async function savePhase(
  recordId: string,
  entry: ArtworkMigrationJournalEntry,
  phase: ArtworkMigrationPhase,
  journal: ArtworkMigrationJournal,
  dependencies: ArtworkMigrationDependencies,
): Promise<void> {
  const currentPhase = journal.entries[recordId]?.phase;
  if (
    currentPhase &&
    isMigrationPhaseAfter(currentPhase, phase) &&
    phase !== 'failed' &&
    phase !== 'requires_reconciliation'
  ) {
    return;
  }
  entry.phase = phase;
  entry.updatedAt = new Date().toISOString();
  delete entry.failureCode;
  await dependencies.journalRepository.save(journal, recordId);
  await dependencies.afterPhase?.(recordId, phase);
}

function isMigrationPhaseAfter(
  current: ArtworkMigrationPhase,
  requested: ArtworkMigrationPhase,
): boolean {
  const progress: ArtworkMigrationPhase[] = [
    'discovered',
    'source_validated',
    'upload_started',
    'cloudinary_upload_confirmed',
    'provider_metadata_verified',
    'sha256_verified',
    'database_record_updated',
    'complete',
  ];
  return progress.indexOf(current) > progress.indexOf(requested);
}

function safeTargetKey(record: ArtworkMigrationRecord): string {
  if (isValidCloudinaryArtworkKey(record.storageKey)) return record.storageKey;
  const resourceType = RESOURCE_TYPE_BY_MIME[record.detectedMimeType];
  if (resourceType) {
    try {
      return createDeterministicCloudinaryKey(record, {
        contentType: record.detectedMimeType,
        resourceType,
      });
    } catch {
      return 'unassigned';
    }
  }
  return 'unassigned';
}

function countStatus(
  outcomes: ArtworkMigrationOutcome[],
  status: ArtworkMigrationOutcomeStatus,
): number {
  return outcomes.filter((outcome) => outcome.status === status).length;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function assertStableFileIdentity(
  opened: BigIntStats,
  current: BigIntStats,
): void {
  if (current.isSymbolicLink()) {
    throw new ArtworkMigrationError('SOURCE_PATH_CONTAINS_SYMLINK', 'failed');
  }
  if (!opened.isFile() || !current.isFile()) {
    throw new ArtworkMigrationError('SOURCE_FILE_UNREADABLE', 'unverifiable');
  }
  if (
    opened.dev < 0n ||
    opened.ino <= 0n ||
    opened.dev !== current.dev ||
    opened.ino !== current.ino
  ) {
    throw new ArtworkMigrationError(
      'SOURCE_IDENTITY_UNVERIFIABLE',
      'unverifiable',
    );
  }
}

function assertSameSourceSnapshot(
  expected: ValidatedArtworkSource,
  actual: ValidatedArtworkSource,
): void {
  if (
    expected.checksum !== actual.checksum ||
    expected.sizeBytes !== actual.sizeBytes ||
    expected.contentType !== actual.contentType ||
    expected.resourceType !== actual.resourceType
  ) {
    throw new ArtworkMigrationError(
      'SOURCE_CHANGED_BEFORE_UPLOAD',
      'requires_reconciliation',
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

function isJournalError(error: unknown): boolean {
  return (
    error instanceof Error && error.name === 'ArtworkMigrationJournalError'
  );
}
