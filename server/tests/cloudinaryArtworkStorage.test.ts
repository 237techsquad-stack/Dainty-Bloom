import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cloudinaryMock } = vi.hoisted(() => ({
  cloudinaryMock: {
    uploader: {
      upload_stream: vi.fn(),
      destroy: vi.fn(),
    },
    api: { resource: vi.fn() },
    utils: { private_download_url: vi.fn() },
  },
}));

vi.mock('../src/config/cloudinary', () => ({
  getCloudinary: () => cloudinaryMock,
}));

import { CloudinaryArtworkDriver } from '../src/services/storage/CloudinaryArtworkDriver';
import type { StorageMeta } from '../src/services/storage/StorageDriver';

const IMAGE_KEY =
  'dainty-bloom/private-artwork/2026/10/29/123e4567-e89b-42d3-a456-426614174000';
const RAW_PDF_KEY = `${IMAGE_KEY}.pdf`;

describe('private Cloudinary artwork storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloudinaryMock.uploader.upload_stream.mockImplementation(
      (_options, callback) => {
        queueMicrotask(() =>
          callback?.(undefined, uploadResult(IMAGE_KEY, 'image')),
        );
        return new PassThrough();
      },
    );
    cloudinaryMock.uploader.destroy.mockResolvedValue({ result: 'ok' });
    cloudinaryMock.api.resource.mockResolvedValue({ public_id: IMAGE_KEY });
    cloudinaryMock.utils.private_download_url.mockReturnValue(
      'https://res.cloudinary.com/test/private-download',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uploads images as authenticated assets without overwriting', async () => {
    const driver = new CloudinaryArtworkDriver();
    await driver.put(IMAGE_KEY, Buffer.from('synthetic image'), {
      contentType: 'image/png',
      resourceType: 'image',
    });

    const options = cloudinaryMock.uploader.upload_stream.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      public_id: IMAGE_KEY,
      resource_type: 'image',
      type: 'authenticated',
      access_mode: 'authenticated',
      overwrite: false,
      allowed_formats: ['png'],
    });
  });

  it('does not delete an asset when migration upload metadata is unexpected', async () => {
    cloudinaryMock.uploader.upload_stream.mockImplementation(
      (_options, callback) => {
        queueMicrotask(() =>
          callback?.(undefined, {
            ...uploadResult(IMAGE_KEY, 'image'),
            type: 'upload',
          }),
        );
        return new PassThrough();
      },
    );

    await expect(
      new CloudinaryArtworkDriver().putForMigration(
        IMAGE_KEY,
        Buffer.from('synthetic image'),
        imageMeta,
      ),
    ).rejects.toMatchObject({ code: 'ARTWORK_STORAGE_ERROR' });
    expect(cloudinaryMock.uploader.destroy).not.toHaveBeenCalled();
  });

  it('preserves ordinary upload cleanup for unexpected metadata', async () => {
    cloudinaryMock.uploader.upload_stream.mockImplementation(
      (_options, callback) => {
        queueMicrotask(() =>
          callback?.(undefined, {
            ...uploadResult(IMAGE_KEY, 'image'),
            type: 'upload',
          }),
        );
        return new PassThrough();
      },
    );

    await expect(
      new CloudinaryArtworkDriver().put(
        IMAGE_KEY,
        Buffer.from('image'),
        imageMeta,
      ),
    ).rejects.toMatchObject({ code: 'ARTWORK_STORAGE_ERROR' });
    expect(cloudinaryMock.uploader.destroy).toHaveBeenCalledWith(
      IMAGE_KEY,
      expect.objectContaining({ type: 'authenticated' }),
    );
  });

  it.each([
    ['application/pdf', RAW_PDF_KEY, 'pdf'],
    ['image/svg+xml', `${IMAGE_KEY}.svg`, 'svg'],
  ] as const)(
    'preserves %s as a raw asset',
    async (contentType, publicId, format) => {
      cloudinaryMock.uploader.upload_stream.mockImplementation(
        (_options, callback) => {
          queueMicrotask(() =>
            callback?.(undefined, uploadResult(publicId, 'raw')),
          );
          return new PassThrough();
        },
      );
      await new CloudinaryArtworkDriver().put(publicId, Buffer.from('bytes'), {
        contentType,
        resourceType: 'raw',
      });

      expect(
        cloudinaryMock.uploader.upload_stream.mock.calls[0]?.[0],
      ).toMatchObject({
        resource_type: 'raw',
        type: 'authenticated',
        access_mode: 'authenticated',
        allowed_formats: [format],
      });
    },
  );

  it('returns a safe provider error when an upload fails', async () => {
    cloudinaryMock.uploader.upload_stream.mockImplementation(
      (_options, callback) => {
        queueMicrotask(() => callback?.(new Error('provider detail')));
        return new PassThrough();
      },
    );

    await expect(
      new CloudinaryArtworkDriver().put(IMAGE_KEY, Buffer.from('bytes'), {
        contentType: 'image/png',
        resourceType: 'image',
      }),
    ).rejects.toMatchObject({
      code: 'ARTWORK_STORAGE_ERROR',
      message: 'Private artwork upload failed',
    });
  });

  it('proxies short-lived private downloads rather than returning a URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('synthetic private bytes')),
    );
    const driver = new CloudinaryArtworkDriver();
    const chunks: Buffer[] = [];
    const stream = driver.getStream(IMAGE_KEY, imageMeta);
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    await new Promise<void>((resolve, reject) => {
      stream.once('end', resolve);
      stream.once('error', reject);
    });

    expect(Buffer.concat(chunks).toString()).toBe('synthetic private bytes');
    expect(cloudinaryMock.utils.private_download_url).toHaveBeenCalledWith(
      IMAGE_KEY,
      'png',
      expect.objectContaining({
        resource_type: 'image',
        type: 'authenticated',
        expires_at: expect.any(Number),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://res.cloudinary.com/test/private-download',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('does not expose a URL when private delivery fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const stream = new CloudinaryArtworkDriver().getStream(
      IMAGE_KEY,
      imageMeta,
    );

    await expect(
      new Promise<void>((resolve, reject) => {
        stream.resume();
        stream.once('end', resolve);
        stream.once('error', reject);
      }),
    ).rejects.toMatchObject({ code: 'ARTWORK_STORAGE_ERROR' });
  });

  it('uses the trusted key and resource type for deletion and existence checks', async () => {
    const driver = new CloudinaryArtworkDriver();
    await driver.delete(IMAGE_KEY, imageMeta);

    expect(cloudinaryMock.uploader.destroy).toHaveBeenCalledWith(
      IMAGE_KEY,
      expect.objectContaining({
        resource_type: 'image',
        type: 'authenticated',
      }),
    );
    await expect(driver.exists(IMAGE_KEY, imageMeta)).resolves.toBe(true);
    expect(cloudinaryMock.api.resource).toHaveBeenCalledWith(
      IMAGE_KEY,
      expect.objectContaining({
        resource_type: 'image',
        type: 'authenticated',
      }),
    );
  });

  it('returns provider metadata without any delivery URL', async () => {
    cloudinaryMock.api.resource.mockResolvedValue({
      public_id: IMAGE_KEY,
      bytes: 42,
      resource_type: 'raw',
      type: 'authenticated',
    });

    await expect(
      new CloudinaryArtworkDriver().getMetadata(IMAGE_KEY, imageMeta),
    ).resolves.toEqual({
      publicId: IMAGE_KEY,
      sizeBytes: 42,
      resourceType: 'raw',
      deliveryType: 'authenticated',
    });
  });

  it('checks both supported resource types before reporting a missing asset', async () => {
    cloudinaryMock.api.resource.mockRejectedValue(
      Object.assign(new Error('not found'), { http_code: 404 }),
    );

    await expect(
      new CloudinaryArtworkDriver().getMetadata(IMAGE_KEY, imageMeta),
    ).rejects.toMatchObject({ code: 'ARTWORK_ASSET_NOT_FOUND' });
    expect(cloudinaryMock.api.resource).toHaveBeenNthCalledWith(
      1,
      IMAGE_KEY,
      expect.objectContaining({ resource_type: 'image' }),
    );
    expect(cloudinaryMock.api.resource).toHaveBeenNthCalledWith(
      2,
      IMAGE_KEY,
      expect.objectContaining({ resource_type: 'raw' }),
    );
  });

  it('surfaces provider inspection failures without provider details', async () => {
    cloudinaryMock.api.resource.mockRejectedValue(
      new Error('signed provider URL with synthetic secret'),
    );

    await expect(
      new CloudinaryArtworkDriver().getMetadata(IMAGE_KEY, imageMeta),
    ).rejects.toMatchObject({
      code: 'ARTWORK_PROVIDER_ERROR',
      message: 'Private artwork provider metadata could not be checked',
    });
  });

  it('rejects invalid keys and metadata without contacting Cloudinary', async () => {
    const driver = new CloudinaryArtworkDriver();
    const invalidStream = driver.getStream('../private.png', imageMeta);

    await expect(
      new Promise<void>((resolve, reject) => {
        invalidStream.resume();
        invalidStream.once('end', resolve);
        invalidStream.once('error', reject);
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STORAGE_REFERENCE' });
    await expect(
      driver.put(IMAGE_KEY, Buffer.from('bytes'), {
        contentType: 'application/pdf',
        resourceType: 'image',
      }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    expect(cloudinaryMock.uploader.upload_stream).not.toHaveBeenCalled();
  });
});

const imageMeta: StorageMeta = {
  contentType: 'image/png',
  resourceType: 'image',
};

function uploadResult(publicId: string, resourceType: 'image' | 'raw') {
  return {
    public_id: publicId,
    resource_type: resourceType,
    type: 'authenticated',
  };
}
