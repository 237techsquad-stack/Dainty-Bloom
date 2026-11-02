import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
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

const mocks = vi.hoisted(() => ({
  uploadStream: vi.fn(),
  destroy: vi.fn(),
  cloudinaryUrl: vi.fn(),
  detectFileType: vi.fn(),
}));

vi.mock('../src/config/cloudinary', () => ({
  getCloudinary: () => ({
    uploader: {
      upload_stream: mocks.uploadStream,
      destroy: mocks.destroy,
    },
    url: mocks.cloudinaryUrl,
  }),
  isCloudinaryConfigured: () => true,
  requireCloudinary: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../src/utils/fileType', () => ({
  detectFileType: mocks.detectFileType,
}));

import { env } from '../src/config/env';
import { app } from '../src/app';
import { AboutMedia, User } from '../src/models';

const CSRF_HEADER = { 'X-Requested-With': 'dainty-bloom' };
const PASSWORD = 'a-secure-password-123';
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([AboutMedia.init(), User.init()]);
});

beforeEach(() => {
  mocks.uploadStream.mockReset();
  mocks.destroy.mockReset();
  mocks.cloudinaryUrl.mockReset();
  mocks.detectFileType.mockReset();
  mocks.detectFileType.mockResolvedValue({ mime: 'image/png' });
  mocks.uploadStream.mockImplementation((_options, callback) => ({
    end: () =>
      callback(null, {
        secure_url: 'https://res.cloudinary.com/test/image/upload/about/test',
        public_id: 'dainty-bloom/about/test',
        width: 1200,
        height: 800,
        bytes: 2048,
      }),
  }));
  mocks.destroy.mockResolvedValue({ result: 'ok' });
  mocks.cloudinaryUrl.mockReturnValue(
    'https://res.cloudinary.com/test/video/upload/about/test.jpg',
  );
});

afterEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('About Media API', () => {
  it('returns published items only in deterministic order and a safe projection', async () => {
    await createMedia({
      id: '000000000000000000000003',
      type: 'video',
      isPublished: true,
      sortOrder: 1,
    });
    await createMedia({
      id: '000000000000000000000002',
      type: 'image',
      isPublished: false,
      sortOrder: 0,
    });
    await createMedia({
      id: '000000000000000000000001',
      type: 'image',
      isPublished: true,
      sortOrder: 1,
    });

    const response = await request(app).get('/api/about/media');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      response.body.data.media.map((item: { id: string }) => item.id),
    ).toEqual(['000000000000000000000001', '000000000000000000000003']);
    expect(response.body.data.media[0]).toMatchObject({
      type: 'image',
      title: 'About image',
      altText: 'A finished product',
      url: 'https://res.cloudinary.com/test/image/upload/about/test',
    });
    expect(response.body.data.media[1].thumbnailUrl).toBe(
      'https://res.cloudinary.com/test/video/upload/about/test.jpg',
    );
    expect(mocks.cloudinaryUrl).toHaveBeenCalledWith(
      'private-file-name',
      expect.objectContaining({
        secure: true,
        resource_type: 'video',
        format: 'jpg',
        transformation: [{ width: 640, height: 360, crop: 'fit' }],
      }),
    );
    expect(mocks.cloudinaryUrl.mock.calls[0]?.[1]).not.toMatchObject({
      transformation: [expect.objectContaining({ crop: 'fill' })],
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /cloudinaryPublicId|cloudinaryResourceType|isPublished|private-file-name/,
    );
  });

  it('serves both publication states to an admin and rejects other roles', async () => {
    await createMedia({ type: 'image', isPublished: true, sortOrder: 0 });
    await createMedia({ type: 'video', isPublished: false, sortOrder: 1 });
    expect((await request(app).get('/api/admin/about-media')).status).toBe(401);

    const adminCookie = await signIn('admin');
    const response = await request(app)
      .get('/api/admin/about-media')
      .set('Cookie', adminCookie);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(
      response.body.data.media.map(
        (media: { isPublished: boolean }) => media.isPublished,
      ),
    ).toEqual([true, false]);

    for (const role of ['customer', 'production', 'support'] as const) {
      const cookie = await signIn(role);
      expect(
        (await request(app).get('/api/admin/about-media').set('Cookie', cookie))
          .status,
      ).toBe(403);
    }
  });

  it('uploads image and video bytes with matching Cloudinary resource types', async () => {
    const cookie = await signIn('admin');
    const imageUpload = await request(app)
      .post('/api/admin/about-media')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .field('title', 'Studio image')
      .attach('file', Buffer.from('fake image bytes'), 'ignored.txt');

    expect(imageUpload.status).toBe(201);
    expect(imageUpload.body.data.media).toMatchObject({
      type: 'image',
      title: 'Studio image',
      isPublished: false,
      mimeType: 'image/png',
      sizeBytes: 2048,
    });
    expect(mocks.uploadStream.mock.calls[0]?.[0]).toMatchObject({
      resource_type: 'image',
      type: 'upload',
      allowed_formats: ['png'],
    });

    mocks.detectFileType.mockResolvedValueOnce({ mime: 'video/mp4' });
    mocks.uploadStream.mockImplementationOnce((_options, callback) => ({
      end: () =>
        callback(null, {
          secure_url:
            'https://res.cloudinary.com/test/video/upload/about/movie',
          public_id: 'dainty-bloom/about/movie',
          width: 1920,
          height: 1080,
          bytes: 4096,
          duration: 12.5,
        }),
    }));

    const videoUpload = await request(app)
      .post('/api/admin/about-media')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .field('altText', 'Video poster alt text')
      .attach('file', Buffer.from('fake video bytes'), 'clip.mov');

    expect(videoUpload.status).toBe(201);
    expect(videoUpload.body.data.media).toMatchObject({
      type: 'video',
      mimeType: 'video/mp4',
      durationSeconds: 12.5,
      thumbnailUrl:
        'https://res.cloudinary.com/test/video/upload/about/test.jpg',
    });
    expect(mocks.cloudinaryUrl).toHaveBeenCalledWith(
      'dainty-bloom/about/movie',
      expect.objectContaining({
        secure: true,
        resource_type: 'video',
        format: 'jpg',
        transformation: [{ width: 640, height: 360, crop: 'fit' }],
      }),
    );
    expect(mocks.cloudinaryUrl.mock.calls.at(-1)?.[1]).not.toMatchObject({
      transformation: [expect.objectContaining({ crop: 'fill' })],
    });
    expect(mocks.uploadStream.mock.calls[1]?.[0]).toMatchObject({
      resource_type: 'video',
      type: 'upload',
      allowed_formats: ['mp4'],
    });
  });

  it('rejects unsupported detected file types and arbitrary URL fields', async () => {
    const cookie = await signIn('admin');
    mocks.detectFileType.mockResolvedValueOnce({ mime: 'application/pdf' });
    const invalidType = await request(app)
      .post('/api/admin/about-media')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .attach('file', Buffer.from('not image/video'), 'document.pdf');
    expect(invalidType.status).toBe(415);
    expect(mocks.uploadStream).not.toHaveBeenCalled();

    const arbitraryUrl = await request(app)
      .post('/api/admin/about-media')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .field('url', 'https://example.test/remote-file.png')
      .attach('file', Buffer.from('image bytes'), 'image.png');
    expect(arbitraryUrl.status).toBe(400);
    expect(mocks.uploadStream).not.toHaveBeenCalled();
  });

  it('updates publication, orders all items, and deletes the Cloudinary asset', async () => {
    const first = await createMedia({
      type: 'image',
      isPublished: false,
      sortOrder: 0,
    });
    const second = await createMedia({
      type: 'video',
      isPublished: false,
      sortOrder: 1,
    });
    const cookie = await signIn('admin');

    const published = await request(app)
      .patch(`/api/admin/about-media/${first._id}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ title: 'Published item', isPublished: true });
    expect(published.status).toBe(200);
    expect(
      (await request(app).get('/api/about/media')).body.data.media,
    ).toHaveLength(1);

    const reordered = await request(app)
      .put('/api/admin/about-media/order')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ mediaIds: [second._id.toString(), first._id.toString()] });
    expect(reordered.status).toBe(200);
    expect(
      (
        await request(app).get('/api/admin/about-media').set('Cookie', cookie)
      ).body.data.media.map((item: { id: string }) => item.id),
    ).toEqual([second._id.toString(), first._id.toString()]);

    const deleted = await request(app)
      .delete(`/api/admin/about-media/${second._id}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER);
    expect(deleted.status).toBe(200);
    expect(await AboutMedia.exists({ _id: second._id })).toBeNull();
    expect(mocks.destroy).toHaveBeenCalledWith(
      'private-file-name',
      expect.objectContaining({ resource_type: 'video', type: 'upload' }),
    );
  });

  it('rejects oversized uploads', async () => {
    const cookie = await signIn('admin');
    const originalLimit = env.UPLOAD_MAX_BYTES;
    env.UPLOAD_MAX_BYTES = 64;
    try {
      const response = await request(app)
        .post('/api/admin/about-media')
        .set('Cookie', cookie)
        .set(CSRF_HEADER)
        .attach('file', Buffer.alloc(65), 'large.png');

      expect(response.status).toBe(413);
      expect(mocks.uploadStream).not.toHaveBeenCalled();
    } finally {
      env.UPLOAD_MAX_BYTES = originalLimit;
    }
  });

  it('cleans up Cloudinary when Mongo persistence fails and reports upload errors', async () => {
    const cookie = await signIn('admin');
    vi.spyOn(AboutMedia, 'create').mockRejectedValueOnce(
      new Error('test persistence failure'),
    );
    const persistenceFailure = await request(app)
      .post('/api/admin/about-media')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .attach('file', Buffer.from('fake image bytes'), 'image.png');
    expect(persistenceFailure.status).toBe(500);
    expect(mocks.destroy).toHaveBeenCalledWith(
      'dainty-bloom/about/test',
      expect.objectContaining({ resource_type: 'image' }),
    );

    mocks.uploadStream.mockImplementationOnce((_options, callback) => ({
      end: () => callback(new Error('provider failure')),
    }));
    const uploadFailure = await request(app)
      .post('/api/admin/about-media')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .attach('file', Buffer.from('fake image bytes'), 'image.png');
    expect(uploadFailure.status).toBe(502);
  });

  it('removes the database record and reports failed provider cleanup', async () => {
    const media = await createMedia({
      type: 'image',
      isPublished: false,
      sortOrder: 0,
    });
    mocks.destroy.mockRejectedValueOnce(new Error('provider failure'));
    const cookie = await signIn('admin');
    const response = await request(app)
      .delete(`/api/admin/about-media/${media._id}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER);

    expect(response.status).toBe(502);
    expect(await AboutMedia.exists({ _id: media._id })).toBeNull();
  });
});

async function createMedia(input: {
  id?: string;
  type: 'image' | 'video';
  isPublished: boolean;
  sortOrder: number;
}) {
  return AboutMedia.create({
    ...(input.id ? { _id: new mongoose.Types.ObjectId(input.id) } : {}),
    type: input.type,
    title: input.type === 'image' ? 'About image' : 'About video',
    ...(input.type === 'image' ? { altText: 'A finished product' } : {}),
    cloudinaryPublicId: 'private-file-name',
    cloudinaryResourceType: input.type,
    url: `https://res.cloudinary.com/test/${input.type}/upload/about/test`,
    ...(input.type === 'video'
      ? {
          thumbnailUrl:
            'https://res.cloudinary.com/test/video/upload/about/test.jpg',
          durationSeconds: 12.5,
        }
      : {}),
    isPublished: input.isPublished,
    sortOrder: input.sortOrder,
    width: 1200,
    height: 800,
    mimeType: input.type === 'image' ? 'image/webp' : 'video/mp4',
    sizeBytes: 2048,
  });
}

async function signIn(
  role: 'admin' | 'customer' | 'production' | 'support',
): Promise<string> {
  const email = `${role}-${Math.random().toString(36).slice(2)}@example.test`;
  await User.create({
    name: 'About Media Test User',
    email,
    passwordHash: await bcrypt.hash(PASSWORD, env.BCRYPT_COST),
    role,
  });
  const response = await request(app)
    .post('/api/auth/login')
    .set(CSRF_HEADER)
    .send({
      email,
      password: PASSWORD,
      portal: role === 'customer' ? 'customer' : 'admin',
    });
  if (response.status !== 200) {
    throw new Error(`Test user login failed with status ${response.status}`);
  }
  const cookies = response.headers['set-cookie'];
  if (!Array.isArray(cookies)) {
    throw new Error('Login did not set auth cookies');
  }
  return cookies
    .filter(
      (cookie) =>
        /^(daintyAccessToken|daintyRefreshToken)=/.test(cookie) &&
        cookie.split(';')[0].length > cookie.split(';')[0].indexOf('=') + 1,
    )
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}
