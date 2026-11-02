import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtworkAsset } from '../src/models/ArtworkAsset';
import {
  createArtworkIntegrityReport,
  type ArtworkIntegrityDependencies,
  type ArtworkIntegrityRecord,
} from '../src/services/artworkIntegrity.service';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'dainty-integrity-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('read-only artwork integrity report', () => {
  it('reports a readable local file whose SHA-256 checksum matches', async () => {
    const key = await writeSyntheticFile('matching');
    const bytes = Buffer.from('matching');
    const report = await createArtworkIntegrityReport(
      root,
      dependencies([record(key, checksum(bytes))]),
    );

    expect(report.records[0]).toMatchObject({
      fileStatus: 'readable',
      checksumStatus: 'matching',
      driverStatus: 'supported',
    });
    expect(report.summary).toMatchObject({
      records: 1,
      readable: 1,
      checksumMatches: 1,
      missing: 0,
      orphanFiles: 0,
    });
  });

  it('reports a record with no corresponding file as missing', async () => {
    const report = await createArtworkIntegrityReport(
      root,
      dependencies([
        record('2026/10/29/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png'),
      ]),
    );

    expect(report.records[0]).toMatchObject({
      fileStatus: 'missing',
      checksumStatus: 'unknown',
    });
    expect(report.summary.missing).toBe(1);
  });

  it('reports checksum mismatches without exposing file contents', async () => {
    const key = await writeSyntheticFile('actual content');
    const report = await createArtworkIntegrityReport(
      root,
      dependencies([record(key, checksum(Buffer.from('different content')))]),
    );

    expect(report.records[0]?.checksumStatus).toBe('mismatch');
    expect(JSON.stringify(report)).not.toContain('actual content');
    expect(report.summary.checksumMismatches).toBe(1);
  });

  it('identifies an unrecorded file by its safe storage key', async () => {
    const orphanKey = await writeSyntheticFile('orphan');
    const report = await createArtworkIntegrityReport(root, dependencies([]));

    expect(report.orphanFiles).toEqual([orphanKey]);
    expect(report.summary.orphanFiles).toBe(1);
  });

  it('reports read failures as unreadable and checksum unknown', async () => {
    const key = await writeSyntheticFile('unreadable');
    const dependenciesWithReadFailure = dependencies([
      record(key, checksum(Buffer.from('unreadable'))),
    ]);
    dependenciesWithReadFailure.createReadStream = () =>
      new Readable({
        read() {
          queueMicrotask(() =>
            this.destroy(new Error('simulated permission error')),
          );
        },
      });

    const report = await createArtworkIntegrityReport(
      root,
      dependenciesWithReadFailure,
    );

    expect(report.records[0]).toMatchObject({
      fileStatus: 'unreadable',
      checksumStatus: 'unknown',
    });
  });

  it('does not attempt local reads for unsupported storage drivers', async () => {
    const streamSpy = vi.fn(createReadStream);
    const dependenciesWithUnsupportedDriver = dependencies([
      {
        ...record('2026/10/29/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png'),
        storageDriver: 'remote',
      },
    ]);
    dependenciesWithUnsupportedDriver.createReadStream = streamSpy;

    const report = await createArtworkIntegrityReport(
      root,
      dependenciesWithUnsupportedDriver,
    );

    expect(report.records[0]).toMatchObject({
      driverStatus: 'unsupported',
      fileStatus: 'unknown',
      checksumStatus: 'unknown',
    });

    expect(streamSpy).not.toHaveBeenCalled();
    expect(report.summary.unsupportedDrivers).toBe(1);
  });

  it('checks Cloudinary records through the record-selected remote inspector', async () => {
    const contents = Buffer.from('cloud artwork bytes');
    const cloudRecord: ArtworkIntegrityRecord = {
      ...record(
        'dainty-bloom/private-artwork/2026/10/29/123e4567-e89b-42d3-a456-426614174000',
        checksum(contents),
      ),
      storageDriver: 'cloudinary',
      sizeBytes: contents.byteLength,
      detectedMimeType: 'image/png',
      storageResourceType: 'image',
    };
    const inspectCloudinaryRecord = vi.fn().mockResolvedValue({
      metadata: {
        sizeBytes: contents.byteLength,
        resourceType: 'image',
        deliveryType: 'authenticated',
      },
      stream: Readable.from([contents]),
    });
    const report = await createArtworkIntegrityReport(root, {
      ...dependencies([cloudRecord]),
      inspectCloudinaryRecord,
    });

    expect(inspectCloudinaryRecord).toHaveBeenCalledWith(cloudRecord);
    expect(report.records[0]).toMatchObject({
      driverStatus: 'supported',
      fileStatus: 'readable',
      checksumStatus: 'matching',
      metadataStatus: 'matching',
    });
    expect(report.records[0]?.storageKey).toBe(cloudRecord.storageKey);
    expect(report.summary.orphanFiles).toBe(0);
  });

  it('reports absent Cloudinary assets as missing, not successful', async () => {
    const cloudRecord = cloudinaryRecord();
    const error = Object.assign(new Error('synthetic not found'), {
      code: 'ARTWORK_ASSET_NOT_FOUND',
    });
    const report = await createArtworkIntegrityReport(root, {
      ...dependencies([cloudRecord]),
      inspectCloudinaryRecord: vi.fn().mockRejectedValue(error),
    });

    expect(report.records[0]).toMatchObject({
      fileStatus: 'missing',
      checksumStatus: 'unknown',
      metadataStatus: 'unknown',
    });
  });

  it('rejects Cloudinary keys outside the provider-specific key namespace', async () => {
    const cloudRecord: ArtworkIntegrityRecord = {
      ...cloudinaryRecord(),
      storageKey: '../private/artwork',
    };
    const inspectCloudinaryRecord = vi.fn();
    const report = await createArtworkIntegrityReport(root, {
      ...dependencies([cloudRecord]),
      inspectCloudinaryRecord,
    });

    expect(report.records[0]).toMatchObject({
      storageKey: '[invalid-storage-key]',
      fileStatus: 'invalid_key',
      metadataStatus: 'unknown',
    });
    expect(inspectCloudinaryRecord).not.toHaveBeenCalled();
  });

  it('reports Cloudinary provider errors without exposing sensitive details', async () => {
    const cloudRecord = cloudinaryRecord();
    const report = await createArtworkIntegrityReport(root, {
      ...dependencies([cloudRecord]),
      inspectCloudinaryRecord: vi
        .fn()
        .mockRejectedValue(
          new Error('https://private.example/signed?secret=synthetic'),
        ),
    });

    expect(report.records[0]?.fileStatus).toBe('provider_error');
    expect(report.summary.providerErrors).toBe(1);
    expect(JSON.stringify(report)).not.toContain('private.example');
    expect(JSON.stringify(report)).not.toContain('synthetic');
  });

  it('reports provider size, resource type, and checksum mismatches separately', async () => {
    const contents = Buffer.from('different cloud artwork');
    const cloudRecord = cloudinaryRecord();
    const report = await createArtworkIntegrityReport(root, {
      ...dependencies([cloudRecord]),
      inspectCloudinaryRecord: vi.fn().mockResolvedValue({
        metadata: {
          sizeBytes: cloudRecord.sizeBytes + 1,
          resourceType: 'raw',
          deliveryType: 'authenticated',
        },
        stream: Readable.from([contents]),
      }),
    });

    expect(report.records[0]).toMatchObject({
      fileStatus: 'readable',
      checksumStatus: 'mismatch',
      metadataStatus: 'mismatch',
    });
    expect(report.summary.metadataMismatches).toBe(1);
    expect(report.summary.checksumMismatches).toBe(1);
  });

  it('reports missing provider metadata as unknown rather than verified', async () => {
    const cloudRecord = cloudinaryRecord();
    const report = await createArtworkIntegrityReport(root, {
      ...dependencies([cloudRecord]),
      inspectCloudinaryRecord: vi.fn().mockResolvedValue({
        metadata: {},
        stream: Readable.from([Buffer.from('synthetic customer artwork')]),
      }),
    });

    expect(report.records[0]).toMatchObject({
      fileStatus: 'readable',
      checksumStatus: 'matching',
      metadataStatus: 'unknown',
    });
    expect(report.summary.metadataUnknown).toBe(1);
  });

  it('rejects invalid or traversal storage keys without touching paths outside root', async () => {
    const outsideFile = path.join(path.dirname(root), 'do-not-read.png');
    await writeFile(outsideFile, 'outside private root');
    try {
      const report = await createArtworkIntegrityReport(
        root,
        dependencies([
          record('../do-not-read.png'),
          record(
            '2026/10/29/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png/../../outside',
          ),
        ]),
      );

      expect(report.records.map((item) => item.fileStatus)).toEqual([
        'invalid_key',
        'invalid_key',
      ]);
      expect(report.records.map((item) => item.storageKey)).toEqual([
        '[invalid-storage-key]',
        '[invalid-storage-key]',
      ]);
      expect(report.summary.invalidKeys).toBe(2);
    } finally {
      await rm(outsideFile, { force: true });
    }
  });

  it('reports empty database and storage without findings', async () => {
    const report = await createArtworkIntegrityReport(root, dependencies([]));

    expect(report.summary).toMatchObject({
      records: 0,
      files: 0,
      orphanFiles: 0,
      filesystemErrors: 0,
    });
    expect(report.records).toEqual([]);
    expect(report.orphanFiles).toEqual([]);
  });

  it('surfaces database failures instead of returning an empty success report', async () => {
    const failingDependencies = dependencies([]);
    failingDependencies.records = async () => {
      throw new Error('simulated database failure');
    };

    await expect(
      createArtworkIntegrityReport(root, failingDependencies),
    ).rejects.toThrow('simulated database failure');
  });

  it('does not write or delete files or artwork records', async () => {
    const key = await writeSyntheticFile('unchanged synthetic bytes');
    const fullPath = path.join(root, ...key.split('/'));
    const beforeBytes = await readFile(fullPath);
    const beforeStat = await stat(fullPath);
    const createSpy = vi.spyOn(ArtworkAsset, 'create');
    const updateSpy = vi.spyOn(ArtworkAsset, 'updateOne');
    const deleteSpy = vi.spyOn(ArtworkAsset, 'deleteOne');
    const deleteManySpy = vi.spyOn(ArtworkAsset, 'deleteMany');

    await createArtworkIntegrityReport(
      root,
      dependencies([record(key, checksum(beforeBytes))]),
    );

    expect(await readFile(fullPath)).toEqual(beforeBytes);
    expect((await stat(fullPath)).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(deleteManySpy).not.toHaveBeenCalled();
  });
});

function dependencies(
  records: ArtworkIntegrityRecord[],
): ArtworkIntegrityDependencies {
  return {
    records: async () => records,
    createReadStream,
    readdir,
    lstat,
  };
}

async function writeSyntheticFile(content: string): Promise<string> {
  const date = new Date();
  const key = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${randomUUID()}.png`;
  const target = path.join(root, ...key.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return key;
}

function record(
  storageKey: string,
  storedChecksum = checksum(Buffer.from('synthetic customer artwork')),
): ArtworkIntegrityRecord {
  return {
    id: '507f1f77bcf86cd799439011',
    storageKey,
    storageDriver: 'local',
    checksum: storedChecksum,
    sizeBytes: Buffer.from('synthetic customer artwork').byteLength,
  };
}

function cloudinaryRecord(): ArtworkIntegrityRecord {
  return {
    ...record(
      'dainty-bloom/private-artwork/2026/10/29/123e4567-e89b-42d3-a456-426614174000',
    ),
    storageDriver: 'cloudinary',
    detectedMimeType: 'image/png',
    storageResourceType: 'image',
  };
}

function checksum(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
