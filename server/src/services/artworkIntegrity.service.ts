import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { ArtworkAsset } from '../models/ArtworkAsset';
import { isValidCloudinaryArtworkKey } from './storage/CloudinaryArtworkDriver';
import { getStorageDriver } from './storage';

const LOCAL_DRIVER = 'local';
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const SAFE_ARTWORK_KEY =
  /^\d{4}\/\d{2}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|pdf|svg)$/i;
const RESOURCE_TYPE_BY_MIME: Record<string, 'image' | 'raw'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'application/pdf': 'raw',
  'image/svg+xml': 'raw',
};

export type ArtworkFileStatus =
  | 'readable'
  | 'missing'
  | 'unreadable'
  | 'provider_error'
  | 'unknown'
  | 'invalid_key';
export type ArtworkChecksumStatus = 'matching' | 'mismatch' | 'unknown';
export type ArtworkDriverStatus = 'supported' | 'unsupported';
export type ArtworkMetadataStatus =
  'matching' | 'mismatch' | 'unknown' | 'not_applicable';

export interface ArtworkIntegrityRecord {
  id: string;
  storageKey: string;
  storageDriver: string;
  checksum: string;
  sizeBytes: number;
  detectedMimeType?: string;
  storageResourceType?: 'image' | 'raw';
}

export interface ArtworkIntegrityItem {
  id: string;
  storageKey: string;
  storageDriver: string;
  driverStatus: ArtworkDriverStatus;
  fileStatus: ArtworkFileStatus;
  checksumStatus: ArtworkChecksumStatus;
  metadataStatus: ArtworkMetadataStatus;
}

export interface ArtworkIntegrityReport {
  root: string;
  summary: {
    records: number;
    files: number;
    unknown: number;
    readable: number;
    missing: number;
    unreadable: number;
    invalidKeys: number;
    unsupportedDrivers: number;
    checksumMatches: number;
    checksumMismatches: number;
    checksumUnknown: number;
    metadataMatches: number;
    metadataMismatches: number;
    metadataUnknown: number;
    providerErrors: number;
    orphanFiles: number;
    filesystemErrors: number;
  };
  records: ArtworkIntegrityItem[];
  orphanFiles: string[];
  filesystemErrors: string[];
}

export interface ArtworkIntegrityDependencies {
  records: () => Promise<ArtworkIntegrityRecord[]>;
  createReadStream: (filePath: string) => Readable;
  readdir: typeof readdir;
  lstat: typeof lstat;
  inspectCloudinaryRecord?: (
    record: ArtworkIntegrityRecord,
  ) => Promise<CloudinaryIntegritySource>;
}

export interface CloudinaryIntegritySource {
  metadata: {
    sizeBytes?: number;
    resourceType?: string;
    deliveryType?: string;
  };
  stream: Readable;
}

const defaultDependencies: ArtworkIntegrityDependencies = {
  records: async () => {
    const records = await ArtworkAsset.find()
      .select(
        '_id +storageKey storageDriver checksum sizeBytes detectedMimeType storageResourceType',
      )
      .lean();
    return records.map((record) => ({
      id: record._id.toString(),
      storageKey: record.storageKey,
      storageDriver: record.storageDriver,
      checksum: record.checksum,
      sizeBytes: record.sizeBytes,
      detectedMimeType: record.detectedMimeType,
      storageResourceType: record.storageResourceType,
    }));
  },
  createReadStream,
  readdir,
  lstat,
  inspectCloudinaryRecord: defaultInspectCloudinaryRecord,
};

/**
 * Compares local artwork files with metadata without changing either source.
 */
export async function createArtworkIntegrityReport(
  configuredRoot: string,
  dependencies: ArtworkIntegrityDependencies = defaultDependencies,
): Promise<ArtworkIntegrityReport> {
  const root = path.resolve(configuredRoot);
  const records = await dependencies.records();
  const knownKeys = new Set(
    records
      .filter((record) => record.storageDriver === LOCAL_DRIVER)
      .map((record) => record.storageKey),
  );
  const report: ArtworkIntegrityReport = {
    root,
    summary: {
      records: records.length,
      files: 0,
      unknown: 0,
      readable: 0,
      missing: 0,
      unreadable: 0,
      invalidKeys: 0,
      unsupportedDrivers: 0,
      checksumMatches: 0,
      checksumMismatches: 0,
      checksumUnknown: 0,
      metadataMatches: 0,
      metadataMismatches: 0,
      metadataUnknown: 0,
      providerErrors: 0,
      orphanFiles: 0,
      filesystemErrors: 0,
    },
    records: [],
    orphanFiles: [],
    filesystemErrors: [],
  };

  let rootIsUsable = false;
  try {
    const rootInfo = await dependencies.lstat(root);
    rootIsUsable = rootInfo.isDirectory() && !rootInfo.isSymbolicLink();
    if (!rootIsUsable) {
      report.filesystemErrors.push(
        'Configured storage root is not a regular directory',
      );
    }
  } catch {
    report.filesystemErrors.push(
      'Configured storage root could not be inspected',
    );
  }

  for (const record of records) {
    const item = await inspectRecord(root, record, dependencies, rootIsUsable);
    report.records.push(item);
    countRecordStatus(report.summary, item);
  }

  const files = rootIsUsable
    ? await listLocalFiles(root, '', dependencies, report)
    : [];
  report.summary.files = files.length;
  const orphanFiles = files.filter((key) => !knownKeys.has(key));
  report.orphanFiles = orphanFiles.map((key) => sanitizeKey(key));
  report.summary.orphanFiles = orphanFiles.length;
  report.summary.filesystemErrors = report.filesystemErrors.length;
  return report;
}

async function inspectRecord(
  root: string,
  record: ArtworkIntegrityRecord,
  dependencies: ArtworkIntegrityDependencies,
  rootIsUsable: boolean,
): Promise<ArtworkIntegrityItem> {
  const driverStatus =
    record.storageDriver === LOCAL_DRIVER ||
    record.storageDriver === 'cloudinary'
      ? 'supported'
      : 'unsupported';
  const item: ArtworkIntegrityItem = {
    id: record.id,
    storageKey: sanitizeKey(record.storageKey, record.storageDriver),
    storageDriver: record.storageDriver,
    driverStatus,
    fileStatus: 'unknown',
    checksumStatus: 'unknown',
    metadataStatus: 'not_applicable',
  };
  if (driverStatus === 'unsupported') {
    item.metadataStatus = 'unknown';
    return item;
  }
  if (record.storageDriver === 'cloudinary') {
    if (!isValidCloudinaryArtworkKey(record.storageKey)) {
      item.fileStatus = 'invalid_key';
      item.metadataStatus = 'unknown';
      return item;
    }
    const inspectCloudinaryRecord =
      dependencies.inspectCloudinaryRecord ?? defaultInspectCloudinaryRecord;
    try {
      const source = await inspectCloudinaryRecord(record);
      item.metadataStatus = compareCloudinaryMetadata(record, source.metadata);
      item.fileStatus = 'readable';
      try {
        const actualChecksum = await checksumStream(source.stream);
        item.checksumStatus = SHA256_HEX.test(record.checksum)
          ? actualChecksum.toLowerCase() === record.checksum.toLowerCase()
            ? 'matching'
            : 'mismatch'
          : 'unknown';
      } catch {
        item.fileStatus = 'provider_error';
      }
    } catch (error) {
      item.fileStatus =
        getErrorCode(error) === 'ARTWORK_ASSET_NOT_FOUND'
          ? 'missing'
          : getErrorCode(error) === 'ARTWORK_METADATA_UNVERIFIABLE'
            ? 'unknown'
            : 'provider_error';
      item.metadataStatus = 'unknown';
    }
    return item;
  }
  if (!SAFE_ARTWORK_KEY.test(record.storageKey)) {
    item.fileStatus = 'invalid_key';
    return item;
  }
  if (!rootIsUsable) return item;

  const filePath = resolveSafeKey(root, record.storageKey);
  if (!filePath) {
    item.fileStatus = 'invalid_key';
    return item;
  }

  let fileInfo;
  try {
    if (
      !(await hasNoSymlinkComponents(root, record.storageKey, dependencies))
    ) {
      item.fileStatus = 'unreadable';
      return item;
    }
    fileInfo = await dependencies.lstat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      item.fileStatus = 'missing';
      return item;
    }
    item.fileStatus = 'unreadable';
    return item;
  }

  if (!fileInfo.isFile()) {
    item.fileStatus = 'unreadable';
    return item;
  }

  try {
    const checksum = await checksumFile(
      filePath,
      dependencies.createReadStream,
    );
    item.fileStatus = 'readable';
    if (SHA256_HEX.test(record.checksum)) {
      item.checksumStatus =
        checksum.toLowerCase() === record.checksum.toLowerCase()
          ? 'matching'
          : 'mismatch';
    }
  } catch {
    item.fileStatus = 'unreadable';
  }
  return item;
}

async function defaultInspectCloudinaryRecord(
  record: ArtworkIntegrityRecord,
): Promise<CloudinaryIntegritySource> {
  const expectedResourceType = record.detectedMimeType
    ? RESOURCE_TYPE_BY_MIME[record.detectedMimeType]
    : undefined;
  if (!record.detectedMimeType || !expectedResourceType) {
    const error = new Error('Artwork MIME type is missing');
    Object.assign(error, { code: 'ARTWORK_METADATA_UNVERIFIABLE' });
    throw error;
  }
  const storage = getStorageDriver(record.storageDriver);
  const meta = {
    contentType: record.detectedMimeType,
    resourceType: expectedResourceType,
  };
  const providerMetadata = await storage.getMetadata(record.storageKey, meta);
  return {
    metadata: providerMetadata,
    stream: storage.getStream(record.storageKey, meta),
  };
}

function compareCloudinaryMetadata(
  record: ArtworkIntegrityRecord,
  metadata: CloudinaryIntegritySource['metadata'],
): ArtworkMetadataStatus {
  const expectedResourceType = record.detectedMimeType
    ? RESOURCE_TYPE_BY_MIME[record.detectedMimeType]
    : undefined;
  const values = [
    typeof metadata.sizeBytes === 'number'
      ? metadata.sizeBytes === record.sizeBytes
      : undefined,
    expectedResourceType && metadata.resourceType
      ? metadata.resourceType === expectedResourceType
      : undefined,
    metadata.deliveryType
      ? metadata.deliveryType === 'authenticated'
      : undefined,
    record.storageResourceType && expectedResourceType
      ? record.storageResourceType === expectedResourceType
      : undefined,
  ];
  if (values.some((value) => value === false)) return 'mismatch';
  return values.every((value) => value === true) ? 'matching' : 'unknown';
}

function resolveSafeKey(root: string, key: string): string | undefined {
  if (!SAFE_ARTWORK_KEY.test(key)) return undefined;
  const resolved = path.resolve(root, ...key.split('/'));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}

async function checksumFile(
  filePath: string,
  streamFactory: (filePath: string) => Readable,
): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of streamFactory(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function checksumStream(stream: Readable): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of stream) {
    hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return hash.digest('hex');
}

async function listLocalFiles(
  root: string,
  relativeDirectory: string,
  dependencies: ArtworkIntegrityDependencies,
  report: ArtworkIntegrityReport,
): Promise<string[]> {
  const directory = path.resolve(root, relativeDirectory);
  if (!isWithinRoot(root, directory)) {
    report.filesystemErrors.push(
      'A directory resolved outside the storage root',
    );
    return [];
  }

  let entries;
  try {
    entries = await dependencies.readdir(directory, { withFileTypes: true });
  } catch {
    report.filesystemErrors.push(
      `${sanitizeKey(relativeDirectory || '.')}: directory could not be read`,
    );
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(
      relativeDirectory.split(path.sep).join('/'),
      entry.name,
    );
    const fullPath = path.resolve(root, relativePath);
    if (!isWithinRoot(root, fullPath)) {
      report.filesystemErrors.push(
        `${sanitizeKey(relativePath)}: path resolved outside the storage root`,
      );
      continue;
    }
    let info;
    try {
      info = await dependencies.lstat(fullPath);
    } catch {
      report.filesystemErrors.push(
        `${sanitizeKey(relativePath)}: filesystem entry could not be inspected`,
      );
      continue;
    }
    if (info.isSymbolicLink()) {
      report.filesystemErrors.push(
        `${sanitizeKey(relativePath)}: symbolic links are not followed`,
      );
      continue;
    }
    if (info.isDirectory()) {
      files.push(
        ...(await listLocalFiles(root, relativePath, dependencies, report)),
      );
      continue;
    }
    if (info.isFile()) {
      files.push(relativePath);
      continue;
    }
    report.filesystemErrors.push(
      `${sanitizeKey(relativePath)}: unsupported filesystem entry`,
    );
  }
  return files;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function hasNoSymlinkComponents(
  root: string,
  key: string,
  dependencies: ArtworkIntegrityDependencies,
): Promise<boolean> {
  let current = root;
  for (const segment of key.split('/')) {
    current = path.join(current, segment);
    const info = await dependencies.lstat(current);
    if (info.isSymbolicLink()) return false;
  }
  return true;
}

function countRecordStatus(
  summary: ArtworkIntegrityReport['summary'],
  item: ArtworkIntegrityItem,
): void {
  if (item.driverStatus === 'unsupported') summary.unsupportedDrivers += 1;
  if (item.fileStatus === 'unknown') summary.unknown += 1;
  if (item.fileStatus === 'readable') summary.readable += 1;
  if (item.fileStatus === 'missing') summary.missing += 1;
  if (item.fileStatus === 'unreadable') summary.unreadable += 1;
  if (item.fileStatus === 'invalid_key') summary.invalidKeys += 1;
  if (item.fileStatus === 'provider_error') summary.providerErrors += 1;
  if (item.checksumStatus === 'matching') summary.checksumMatches += 1;
  if (item.checksumStatus === 'mismatch') summary.checksumMismatches += 1;
  if (item.checksumStatus === 'unknown') summary.checksumUnknown += 1;
  if (item.metadataStatus === 'matching') summary.metadataMatches += 1;
  if (item.metadataStatus === 'mismatch') summary.metadataMismatches += 1;
  if (item.metadataStatus === 'unknown') summary.metadataUnknown += 1;
}

function sanitizeKey(key: string, storageDriver = LOCAL_DRIVER): string {
  const valid =
    storageDriver === 'cloudinary'
      ? isValidCloudinaryArtworkKey(key)
      : SAFE_ARTWORK_KEY.test(key);
  return valid ? key : '[invalid-storage-key]';
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
