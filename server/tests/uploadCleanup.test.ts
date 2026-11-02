import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import type { NextFunction, Response } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { detectFileTypeMock } = vi.hoisted(() => ({
  detectFileTypeMock: vi.fn(),
}));
vi.mock('../src/utils/fileType', () => ({
  detectFileType: detectFileTypeMock,
}));

import { env } from '../src/config/env';
import {
  ArtworkAsset,
  Cart,
  Message,
  Order,
  SiteSettings,
} from '../src/models';
import {
  cleanupUnattachedArtwork,
  deleteArtwork,
  saveArtworkUpload,
  streamArtwork,
} from '../src/services/upload.service';
import { LocalStorageDriver } from '../src/services/storage/LocalStorageDriver';
import { CloudinaryArtworkDriver } from '../src/services/storage/CloudinaryArtworkDriver';
import type {
  StorageDriver,
  StorageMeta,
} from '../src/services/storage/StorageDriver';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
const DAY_MS = 24 * 60 * 60 * 1000;

let mongo: MongoMemoryServer;
let storageRoot: string;
let storage: LocalStorageDriver;
let originalStorageDirectory: string;
let originalStorageDriver: typeof env.STORAGE_DRIVER;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    ArtworkAsset.init(),
    Cart.init(),
    Message.init(),
    Order.init(),
    SiteSettings.init(),
  ]);
});

beforeEach(async () => {
  detectFileTypeMock.mockResolvedValue({ mime: 'image/png' });
  originalStorageDirectory = env.STORAGE_PRIVATE_DIR;
  originalStorageDriver = env.STORAGE_DRIVER;
  storageRoot = await mkdtemp(path.join(os.tmpdir(), 'dainty-artwork-test-'));
  env.STORAGE_PRIVATE_DIR = storageRoot;
  storage = new LocalStorageDriver();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
  env.STORAGE_PRIVATE_DIR = originalStorageDirectory;
  env.STORAGE_DRIVER = originalStorageDriver;
  await rm(storageRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('customer artwork cleanup safety', () => {
  it('streams a Cloudinary record through its stored driver and metadata', async () => {
    const cloudKey =
      'dainty-bloom/private-artwork/2026/10/29/123e4567-e89b-42d3-a456-426614174000';
    const artwork = await createArtwork(cloudKey, {
      storageDriver: 'cloudinary',
      storageResourceType: 'image',
    });
    const getStream = vi
      .spyOn(CloudinaryArtworkDriver.prototype, 'getStream')
      .mockReturnValue(Readable.from([PNG]));
    const response = Object.assign(new PassThrough(), {
      setHeader: vi.fn(),
      removeHeader: vi.fn(),
      headersSent: false,
    });
    const finished = new Promise<void>((resolve) =>
      response.once('finish', resolve),
    );

    await streamArtwork(
      artwork._id.toString(),
      { sessionId: 'test-guest-session' },
      false,
      response as unknown as Response,
      vi.fn() as unknown as NextFunction,
    );
    await finished;

    expect(getStream).toHaveBeenCalledWith(cloudKey, {
      contentType: 'image/png',
      resourceType: 'image',
    });
  });

  it('refuses owner deletion while a cart still references artwork', async () => {
    const key = await writeFile();
    const artwork = await createArtwork(key);
    await Cart.create({
      sessionId: 'test-guest-session',
      expiresAt: new Date(Date.now() + DAY_MS),
      items: [
        {
          product: new Types.ObjectId(),
          selectedOptions: [],
          quantity: 1,
          artwork: artwork._id,
          unitPriceSnapshotMinor: 100,
          titleSnapshot: 'Test product',
        },
      ],
    });

    await expect(
      deleteArtwork(artwork._id.toString(), {
        sessionId: 'test-guest-session',
      }),
    ).rejects.toMatchObject({ code: 'ARTWORK_ATTACHED_TO_ORDER' });
    await expect(
      ArtworkAsset.exists({ _id: artwork._id }),
    ).resolves.not.toBeNull();
    await expect(storage.exists(key)).resolves.toBe(true);
  });

  it('cleans Cloudinary records via their provider, not the local file scanner', async () => {
    env.STORAGE_DRIVER = 'cloudinary';
    const cloudKey =
      'dainty-bloom/private-artwork/2026/10/29/123e4567-e89b-42d3-a456-426614174000';
    const artwork = await createArtwork(cloudKey, {
      createdAt: new Date(Date.now() - 2 * DAY_MS),
      storageDriver: 'cloudinary',
      storageResourceType: 'image',
    });
    const cloudDelete = vi
      .spyOn(CloudinaryArtworkDriver.prototype, 'delete')
      .mockResolvedValue(undefined);
    const localDelete = vi.spyOn(LocalStorageDriver.prototype, 'delete');

    const result = await cleanupUnattachedArtwork();

    expect(result.deletedRecords).toBe(1);
    expect(cloudDelete).toHaveBeenCalledWith(cloudKey, {
      contentType: 'image/png',
      resourceType: 'image',
    });
    expect(localDelete).not.toHaveBeenCalled();
    await expect(ArtworkAsset.exists({ _id: artwork._id })).resolves.toBeNull();
  });

  it('cleans up a Cloudinary upload if artwork metadata persistence fails', async () => {
    env.STORAGE_DRIVER = 'cloudinary';
    const put = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const cloudStorage: StorageDriver = {
      put,
      getStream: () => {
        throw new Error('not used');
      },
      delete: remove,
      exists: vi.fn().mockResolvedValue(true),
      getMetadata: vi.fn().mockResolvedValue({}),
    };
    vi.spyOn(ArtworkAsset, 'create').mockRejectedValue(
      new Error('simulated metadata persistence failure'),
    );

    await expect(
      saveArtworkUpload(
        { sessionId: 'cloud-upload-test' },
        { buffer: PNG, originalname: 'customer.png' },
        false,
        cloudStorage,
      ),
    ).rejects.toThrow('simulated metadata persistence failure');

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[0]).toMatch(
      /^dainty-bloom\/private-artwork\/\d{4}\/\d{2}\/\d{2}\//,
    );
    expect(put.mock.calls[0]?.[2]).toEqual({
      contentType: 'image/png',
      resourceType: 'image',
    });
    expect(remove).toHaveBeenCalledWith(put.mock.calls[0]?.[0], {
      contentType: 'image/png',
      resourceType: 'image',
    });
  });

  it('does not delete an upload in progress, even after its file exceeds the orphan grace period', async () => {
    let signalPutStarted!: () => void;
    let finishPut!: () => void;
    const putStarted = new Promise<void>((resolve) => {
      signalPutStarted = resolve;
    });
    const waitForFinish = new Promise<void>((resolve) => {
      finishPut = resolve;
    });
    const blockingStorage = new BlockingStorage(storage, async () => {
      signalPutStarted();
      await waitForFinish;
    });

    const upload = saveArtworkUpload(
      { sessionId: 'guest-upload-test' },
      { buffer: PNG, originalname: 'customer.png' },
      false,
      blockingStorage,
    );
    await putStarted;
    const storedFile = await findStoredFile(storageRoot);
    await ageFile(storedFile, 2 * DAY_MS);

    const result = await cleanupUnattachedArtwork(storage);
    expect(result.deletedFiles).toBe(0);
    await expect(
      storage.exists(
        path.relative(storageRoot, storedFile).replace(/\\/g, '/'),
      ),
    ).resolves.toBe(true);

    finishPut();
    const metadata = await upload;
    await expect(
      ArtworkAsset.exists({ _id: metadata.id }),
    ).resolves.not.toBeNull();
  });

  it('preserves a newly written file before its database record is created', async () => {
    const key = await writeFile();

    const result = await cleanupUnattachedArtwork(storage);

    expect(result.deletedFiles).toBe(0);
    await expect(storage.exists(key)).resolves.toBe(true);
  });

  it('deletes a genuinely old orphan and makes repeated cleanup safe', async () => {
    const key = await writeFile();
    await ageFile(path.join(storageRoot, ...key.split('/')), 2 * DAY_MS);

    const first = await cleanupUnattachedArtwork(storage);
    const second = await cleanupUnattachedArtwork(storage);

    expect(first.deletedFiles).toBe(1);
    expect(second.deletedFiles).toBe(0);
    await expect(storage.exists(key)).resolves.toBe(false);
  });

  it('clears a cart marker left after an expired guest cart is removed', async () => {
    const key = await writeFile();
    const artwork = await createArtwork(key, { createdAt: new Date() });
    const cartItemId = new Types.ObjectId();
    await Cart.create({
      sessionId: 'expired-guest',
      expiresAt: new Date(Date.now() - 60_000),
      items: [
        {
          _id: cartItemId,
          product: new Types.ObjectId(),
          selectedOptions: [],
          quantity: 1,
          artwork: artwork._id,
          unitPriceSnapshotMinor: 100,
          titleSnapshot: 'Test product',
        },
      ],
    });
    await ArtworkAsset.updateOne(
      { _id: artwork._id },
      { $set: { cartItemId } },
    );

    await cleanupUnattachedArtwork(storage);

    const retained = await ArtworkAsset.findById(artwork._id).select(
      '+storageKey cartItemId',
    );
    const expiredCart = await Cart.findOne({ sessionId: 'expired-guest' });
    expect(retained).not.toBeNull();
    expect(retained?.cartItemId).toBeUndefined();
    expect(expiredCart?.items[0]?.artwork).toBeUndefined();
    await expect(storage.exists(key)).resolves.toBe(true);
  });

  it.each(['order', 'message'] as const)(
    'preserves artwork referenced by a %s even if the asset backlink is missing',
    async (attachmentType) => {
      const key = await writeFile();
      const artwork = await createArtwork(key, {
        createdAt: new Date(Date.now() - 2 * DAY_MS),
      });

      if (attachmentType === 'order') {
        await Order.collection.insertOne({
          _id: new Types.ObjectId(),
          items: [{ artwork: artwork._id }],
        });
      } else {
        await Message.create({
          name: 'Test customer',
          email: 'customer@example.test',
          subject: 'Artwork reference',
          body: 'A message that references this artwork.',
          attachment: artwork._id,
        });
      }

      await cleanupUnattachedArtwork(storage);

      await expect(
        ArtworkAsset.exists({ _id: artwork._id }),
      ).resolves.not.toBeNull();
      await expect(storage.exists(key)).resolves.toBe(true);
    },
  );

  it('retains both records connected by supersession history', async () => {
    const originalKey = await writeFile();
    const original = await createArtwork(originalKey, {
      createdAt: new Date(Date.now() - 2 * DAY_MS),
    });
    const replacementKey = await writeFile();
    const replacement = await createArtwork(replacementKey, {
      createdAt: new Date(Date.now() - 2 * DAY_MS),
      supersedes: original._id,
    });

    await cleanupUnattachedArtwork(storage);

    await expect(
      ArtworkAsset.exists({ _id: original._id }),
    ).resolves.not.toBeNull();
    await expect(
      ArtworkAsset.exists({ _id: replacement._id }),
    ).resolves.not.toBeNull();
    await expect(storage.exists(originalKey)).resolves.toBe(true);
    await expect(storage.exists(replacementKey)).resolves.toBe(true);
  });

  it('leaves the record intact and retries when storage deletion fails', async () => {
    const key = await writeFile();
    const artwork = await createArtwork(key, {
      createdAt: new Date(Date.now() - 2 * DAY_MS),
    });
    const failingStorage = new FailingDeleteStorage(storage);

    await expect(cleanupUnattachedArtwork(failingStorage)).rejects.toThrow(
      'simulated storage failure',
    );
    await expect(
      ArtworkAsset.exists({ _id: artwork._id }),
    ).resolves.not.toBeNull();
    await expect(storage.exists(key)).resolves.toBe(true);

    await cleanupUnattachedArtwork(storage);
    await expect(ArtworkAsset.exists({ _id: artwork._id })).resolves.toBeNull();
    await expect(storage.exists(key)).resolves.toBe(false);
  });

  it('does not delete files when database inspection fails', async () => {
    const key = await writeFile();
    await ageFile(path.join(storageRoot, ...key.split('/')), 2 * DAY_MS);
    vi.spyOn(ArtworkAsset, 'find').mockImplementation(() => {
      throw new Error('simulated database failure');
    });

    await expect(cleanupUnattachedArtwork(storage)).rejects.toThrow(
      'simulated database failure',
    );
    await expect(storage.exists(key)).resolves.toBe(true);
  });
});

async function writeFile(): Promise<string> {
  const date = new Date();
  const key = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${randomUUID()}.png`;
  await storage.put(key, PNG, { contentType: 'image/png' });
  return key;
}

async function createArtwork(
  storageKey: string,
  overrides: {
    createdAt?: Date;
    storageDriver?: 'local' | 'cloudinary';
    storageResourceType?: 'image' | 'raw';
    supersedes?: Types.ObjectId;
  } = {},
) {
  return ArtworkAsset.create({
    sessionId: 'test-guest-session',
    storageKey,
    storageDriver: overrides.storageDriver ?? 'local',
    storageResourceType: overrides.storageResourceType,
    supersedes: overrides.supersedes,
    originalFilename: 'customer-artwork.png',
    detectedMimeType: 'image/png',
    sizeBytes: PNG.byteLength,
    width: 1,
    height: 1,
    checksum: createHash('sha256').update(PNG).digest('hex'),
    reviewStatus: 'pending',
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
  });
}

async function ageFile(file: string, age: number): Promise<void> {
  const oldDate = new Date(Date.now() - age);
  await utimes(file, oldDate, oldDate);
}

async function findStoredFile(directory: string): Promise<string> {
  const datePath = new Date();
  const parent = path.join(
    directory,
    String(datePath.getUTCFullYear()),
    String(datePath.getUTCMonth() + 1).padStart(2, '0'),
    String(datePath.getUTCDate()).padStart(2, '0'),
  );
  const [filename] = await readdir(parent);
  return path.join(parent, filename);
}

class BlockingStorage implements StorageDriver {
  constructor(
    private readonly delegate: StorageDriver,
    private readonly afterPut: () => Promise<void>,
  ) {}

  async put(key: string, buffer: Buffer, meta: StorageMeta): Promise<void> {
    await this.delegate.put(key, buffer, meta);
    await this.afterPut();
  }

  getStream(key: string) {
    return this.delegate.getStream(key);
  }

  delete(key: string): Promise<void> {
    return this.delegate.delete(key);
  }

  exists(key: string): Promise<boolean> {
    return this.delegate.exists(key);
  }

  getMetadata(key: string, meta?: StorageMeta) {
    return this.delegate.getMetadata(key, meta);
  }
}

class FailingDeleteStorage implements StorageDriver {
  constructor(private readonly delegate: StorageDriver) {}

  put(key: string, buffer: Buffer, meta: StorageMeta): Promise<void> {
    return this.delegate.put(key, buffer, meta);
  }

  getStream(key: string) {
    return this.delegate.getStream(key);
  }

  async delete(): Promise<void> {
    throw new Error('simulated storage failure');
  }

  exists(key: string): Promise<boolean> {
    return this.delegate.exists(key);
  }

  getMetadata(key: string, meta?: StorageMeta) {
    return this.delegate.getMetadata(key, meta);
  }
}
