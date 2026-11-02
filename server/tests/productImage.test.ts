import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import sharp from 'sharp';
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
  audit: vi.fn(),
}));

vi.mock('../src/config/cloudinary', () => ({
  getCloudinary: () => ({
    uploader: {
      upload_stream: mocks.uploadStream,
      destroy: mocks.destroy,
    },
  }),
  isCloudinaryConfigured: () => true,
}));

vi.mock('../src/services/audit.service', () => ({
  logAuditEvent: mocks.audit,
}));

vi.mock('../src/utils/fileType', () => ({
  detectFileType: async () => ({ mime: 'image/png' }),
}));

import {
  PRODUCT_MEDIA_MAX_IMAGES,
  PRODUCT_LIGHTING_STATES,
  PRODUCT_MEDIA_VIEWS,
  type ProductMediaView,
} from '../src/constants/product';
import { Category, Product, type IUser } from '../src/models';
import {
  deleteProductImage,
  reorderProductImages,
  updateProductImage,
  uploadProductImage,
} from '../src/services/productImage.service';
import {
  createProductSchema,
  updateProductSchema,
} from '../src/validators/catalog.validators';
import {
  reorderProductMediaSchema,
  updateProductMediaSchema,
  uploadProductMediaSchema,
} from '../src/validators/upload.validators';
import {
  changeProductStatus,
  createProduct as createAdminProduct,
  updateProduct,
  type ProductAdminInput,
} from '../src/services/productAdmin.service';
import { AppError } from '../src/utils/AppError';

const objectId = '0123456789abcdef01234567';
const actor = {
  _id: new mongoose.Types.ObjectId(),
  role: 'admin',
} as IUser;

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Category.init(), Product.init()]);
});

beforeEach(() => {
  mocks.uploadStream.mockReset();
  mocks.destroy.mockReset();
  mocks.audit.mockReset();
  mocks.uploadStream.mockImplementation((_options, callback) => ({
    end: () =>
      callback(null, {
        secure_url: 'https://res.cloudinary.com/test/image/upload/test',
        public_id: 'dainty-bloom/products/test-image',
        width: 600,
        height: 600,
      }),
  }));
  mocks.destroy.mockResolvedValue({ result: 'ok' });
  mocks.audit.mockResolvedValue(undefined);
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

describe('product image media contract', () => {
  it('accepts side and lifestyle view labels and rejects unsupported labels', async () => {
    for (const view of ['side', 'lifestyle']) {
      expect(PRODUCT_MEDIA_VIEWS).toContain(view);
      expect(
        uploadProductMediaSchema.safeParse({
          params: { id: objectId },
          body: { alt: 'Product image', view, isPrimary: 'false' },
          query: {},
        }).success,
      ).toBe(true);
    }
    const product = await createProduct([
      image('side-view', 'side'),
      image('lifestyle-view', 'lifestyle'),
    ]);
    expect(product.media.map((media) => media.view)).toEqual([
      'side',
      'lifestyle',
    ]);

    expect(
      uploadProductMediaSchema.safeParse({
        params: { id: objectId },
        body: { alt: 'Product image', view: 'top' },
        query: {},
      }).success,
    ).toBe(false);
  });

  it('validates supported lighting-state request values strictly', () => {
    for (const lightingState of PRODUCT_LIGHTING_STATES) {
      expect(
        uploadProductMediaSchema.safeParse({
          params: { id: objectId },
          body: {
            alt: 'Lamp image',
            view: 'front',
            lightingState,
          },
          query: {},
        }).success,
      ).toBe(true);
      expect(
        updateProductMediaSchema.safeParse({
          params: { id: objectId, mediaId: objectId },
          body: { lightingState },
          query: {},
        }).success,
      ).toBe(true);
    }
    expect(
      uploadProductMediaSchema.safeParse({
        params: { id: objectId },
        body: { alt: 'Lamp image', view: 'front', lightingState: 'dim' },
        query: {},
      }).success,
    ).toBe(false);
    expect(
      updateProductMediaSchema.safeParse({
        params: { id: objectId, mediaId: objectId },
        body: { lightingState: 'dim' },
        query: {},
      }).success,
    ).toBe(false);
  });

  it('limits new products and media ordering to ten images', () => {
    const validProduct = {
      title: 'Image limit product',
      slug: 'image-limit-product',
      description: 'Product used to verify image media count limits.',
      category: objectId,
      productType: 'tshirt',
      sku: 'IMAGE-LIMIT-001',
      basePriceMinor: 1000,
      currency: 'GBP',
      media: Array.from({ length: PRODUCT_MEDIA_MAX_IMAGES }, (_, index) => ({
        url: `https://images.example.test/${index}.png`,
        alt: `Product image ${index}`,
        isPrimary: index === 0,
        view: 'front',
      })),
      optionGroups: [],
      quantityPricing: [],
      printTechniques: [],
      specifications: [],
      artworkRequirements: { allowedFormats: [] },
      artworkRequired: false,
      stock: {
        trackInventory: false,
        quantity: 0,
        lowStockThreshold: 0,
        allowBackorder: false,
        reserveBlanksForMadeToOrder: false,
      },
      status: 'draft',
      seo: {},
      isFeatured: false,
      minOrderQuantity: 1,
    };

    expect(
      createProductSchema.safeParse({
        params: {},
        query: {},
        body: validProduct,
      }).success,
    ).toBe(true);
    expect(
      createProductSchema.safeParse({
        params: {},
        query: {},
        body: {
          ...validProduct,
          media: [...validProduct.media, validProduct.media[0]],
        },
      }).success,
    ).toBe(false);

    const lightingProduct = {
      ...validProduct,
      productType: 'three_d_printed',
      lightingGalleryEnabled: true,
      media: [
        {
          ...validProduct.media[0],
          lightingState: 'on',
          isPrimary: true,
        },
        {
          ...validProduct.media[1],
          lightingState: 'off',
          isPrimary: true,
        },
      ],
    };
    expect(
      createProductSchema.safeParse({
        params: {},
        query: {},
        body: lightingProduct,
      }).success,
    ).toBe(true);
    expect(
      createProductSchema.safeParse({
        params: {},
        query: {},
        body: {
          ...lightingProduct,
          media: [
            { ...lightingProduct.media[0], lightingState: 'glow' },
            lightingProduct.media[1],
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      createProductSchema.safeParse({
        params: {},
        query: {},
        body: {
          ...lightingProduct,
          media: [
            { ...lightingProduct.media[0], lightingState: 'on' },
            { ...lightingProduct.media[1], lightingState: 'on' },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      createProductSchema.safeParse({
        params: {},
        query: {},
        body: {
          ...lightingProduct,
          media: [{ ...lightingProduct.media[0], lightingState: undefined }],
        },
      }).success,
    ).toBe(false);

    const atCombinedLimit = Array.from(
      { length: PRODUCT_MEDIA_MAX_IMAGES },
      (_, index) => ({
        ...validProduct.media[index],
        isPrimary: index === 0,
        lightingState: index < 5 ? 'on' : 'off',
      }),
    );
    expect(
      createProductSchema.safeParse({
        params: {},
        query: {},
        body: {
          ...lightingProduct,
          media: atCombinedLimit,
        },
      }).success,
    ).toBe(true);
    expect(
      createProductSchema.safeParse({
        params: {},
        query: {},
        body: {
          ...lightingProduct,
          media: [
            ...atCombinedLimit,
            { ...atCombinedLimit[0], isPrimary: false },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      reorderProductMediaSchema.safeParse({
        params: { id: objectId },
        query: {},
        body: {
          mediaIds: Array.from({ length: 11 }, (_, index) =>
            String(index + 1).padStart(24, '0'),
          ),
        },
      }).success,
    ).toBe(false);
  });

  it('persists ON and OFF media for an eligible draft while allowing one primary per state', async () => {
    const category = await lampCategory();
    const input = adminProductInput(category.id, {
      lightingGalleryEnabled: true,
      media: [
        { ...image('lamp-on'), lightingState: 'on', isPrimary: true },
        { ...image('lamp-off'), lightingState: 'off', isPrimary: true },
      ],
    });

    const created = await createAdminProduct(input, actor);

    expect(created.lightingGalleryEnabled).toBe(true);
    expect(created.media).toHaveLength(2);
    expect(created.media.map((item) => item.lightingState)).toEqual([
      'on',
      'off',
    ]);
    expect(created.media.map((item) => item.isPrimary)).toEqual([true, true]);
    expect(created.media[0]._id).not.toEqual(created.media[1]._id);
  });

  it('rejects enabling the lighting gallery outside the persisted Lamps and Lighting category', async () => {
    const category = await Category.create({
      name: 'Other 3D Prints',
      slug: 'other-3d-prints',
      formProfile: 'three_d_printed',
    });
    await expect(
      createAdminProduct(
        adminProductInput(category.id, { lightingGalleryEnabled: true }),
        actor,
      ),
    ).rejects.toMatchObject({
      code: 'LIGHTING_GALLERY_UNSUPPORTED_CATEGORY',
    });

    await expect(
      updateProduct(
        (await createAdminProduct(adminProductInput(category.id), actor)).id,
        { lightingGalleryEnabled: true },
        actor,
      ),
    ).rejects.toMatchObject({
      code: 'LIGHTING_GALLERY_UNSUPPORTED_CATEGORY',
    });
  });

  it('enforces ten images across both lighting states in product service writes', async () => {
    const category = await lampCategory();
    const media: ProductAdminInput['media'] = Array.from(
      { length: PRODUCT_MEDIA_MAX_IMAGES + 1 },
      (_, index) => ({
        ...image(`lamp-limit-${index}`),
        lightingState: index % 2 === 0 ? 'on' : 'off',
        isPrimary: index < 2,
      }),
    );
    await expect(
      createAdminProduct(
        adminProductInput(category.id, {
          lightingGalleryEnabled: true,
          media,
        }),
        actor,
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_IMAGE_LIMIT' });
  });

  it('rejects duplicate primaries within one lighting state in service writes', async () => {
    const category = await lampCategory();
    await expect(
      createAdminProduct(
        adminProductInput(category.id, {
          lightingGalleryEnabled: true,
          media: [
            { ...image('lamp-on-one'), lightingState: 'on', isPrimary: true },
            { ...image('lamp-on-two'), lightingState: 'on', isPrimary: true },
          ],
        }),
        actor,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PRIMARY_IMAGE' });
  });

  it('allows an empty lamp draft to be enabled and edited before images are configured', async () => {
    const category = await lampCategory();
    const draft = await createAdminProduct(
      adminProductInput(category.id),
      actor,
    );

    const enabled = await updateProduct(
      draft.id,
      { lightingGalleryEnabled: true },
      actor,
    );
    const edited = await updateProduct(
      enabled.id,
      { title: 'Lamp draft being configured' },
      actor,
    );

    expect(edited.lightingGalleryEnabled).toBe(true);
    expect(edited.status).toBe('draft');
    expect(edited.media).toHaveLength(0);
  });

  it('requires a primary for each configured state before activating a lamp gallery', async () => {
    const category = await lampCategory();
    const draft = await createAdminProduct(
      adminProductInput(category.id, {
        lightingGalleryEnabled: true,
        media: [
          { ...image('lamp-on'), lightingState: 'on', isPrimary: true },
          { ...image('lamp-off'), lightingState: 'off', isPrimary: true },
        ],
      }),
      actor,
    );
    const active = await updateProduct(draft.id, { status: 'active' }, actor);
    expect(active.status).toBe('active');

    const incompleteDraft = await createAdminProduct(
      adminProductInput(category.id, {
        lightingGalleryEnabled: true,
        media: [{ ...image('lamp-off-no-primary'), lightingState: 'off' }],
      }),
      actor,
    );
    await expect(
      updateProduct(incompleteDraft.id, { status: 'active' }, actor),
    ).rejects.toMatchObject({ code: 'LIGHTING_GALLERY_PRIMARY_REQUIRED' });
    await expect(
      changeProductStatus(incompleteDraft.id, 'active', actor),
    ).rejects.toMatchObject({ code: 'LIGHTING_GALLERY_PRIMARY_REQUIRED' });
  });

  it('rejects an enabled gallery with legacy untagged media without assigning a state', async () => {
    const category = await lampCategory();
    await expect(
      createAdminProduct(
        adminProductInput(category.id, {
          lightingGalleryEnabled: true,
          media: [{ ...image('lamp-untagged'), isPrimary: true }],
        }),
        actor,
      ),
    ).rejects.toMatchObject({ code: 'LIGHTING_GALLERY_STATE_REQUIRED' });
  });

  it('rejects multiple primary images in create validation and service writes', async () => {
    const category = await Category.create({ name: 'Primary image tests' });
    const media = [
      {
        url: 'https://images.example.test/primary-one.png',
        alt: 'First product image',
        view: 'front',
        isPrimary: true,
      },
      {
        url: 'https://images.example.test/primary-two.png',
        alt: 'Second product image',
        view: 'back',
        isPrimary: true,
      },
    ];
    const createInput = {
      title: 'Duplicate primary test',
      slug: 'duplicate-primary-test',
      description: 'Product used to validate primary image integrity.',
      category: category.id,
      productType: 'tshirt',
      media,
      sku: 'DUPLICATE-PRIMARY-001',
      basePriceMinor: 1000,
      currency: 'GBP',
      optionGroups: [],
      quantityPricing: [],
      printTechniques: [],
      specifications: [],
      artworkRequirements: { allowedFormats: [] },
      artworkRequired: false,
      stock: {
        trackInventory: false,
        quantity: 0,
        lowStockThreshold: 0,
        allowBackorder: false,
        reserveBlanksForMadeToOrder: false,
      },
      status: 'draft' as const,
      seo: {},
      isFeatured: false,
      minOrderQuantity: 1,
    };

    expect(
      createProductSchema.safeParse({
        params: {},
        query: {},
        body: createInput,
      }).success,
    ).toBe(false);
    await expect(createAdminProduct(createInput, actor)).rejects.toMatchObject({
      code: 'INVALID_PRIMARY_IMAGE',
    });
    expect(await Product.exists({ sku: createInput.sku })).toBeNull();
  });

  it('rejects media changes through generic product updates', async () => {
    const product = await createProduct([image('legacy-image')]);
    const media = {
      url: product.media[0].url,
      alt: product.media[0].alt,
      view: product.media[0].view,
      isPrimary: product.media[0].isPrimary,
    };
    const parsed = updateProductSchema.safeParse({
      params: { id: product.id },
      query: {},
      body: { media: [media] },
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['body', 'media'],
          message:
            'Product media must be managed using the dedicated media endpoints',
        }),
      );
    }
    await expect(
      updateProduct(product.id, { media: [media] }, actor),
    ).rejects.toMatchObject({
      code: 'PRODUCT_MEDIA_USE_DEDICATED_ENDPOINTS',
    });
    expect((await Product.findById(product.id))?.media).toHaveLength(1);
  });

  it('preserves legacy media metadata when updating other product fields', async () => {
    const legacyImage = {
      ...image('legacy-image', 'lifestyle'),
      width: 1280,
      height: 960,
      isPrimary: true,
      sortOrder: 7,
    };
    const legacySecondImage = {
      ...image('legacy-second-image', 'side'),
      width: 800,
      height: 800,
      isPrimary: true,
      sortOrder: 8,
    };
    const product = await createProduct([legacyImage, legacySecondImage]);

    const updated = await updateProduct(
      product.id,
      { title: 'Updated product title' },
      actor,
    );

    expect(updated.title).toBe('Updated product title');
    expect(updated.media).toHaveLength(2);
    expect(updated.media[0]).toMatchObject({
      publicId: legacyImage.publicId,
      view: 'lifestyle',
      alt: legacyImage.alt,
      isPrimary: true,
      width: 1280,
      height: 960,
      sortOrder: 7,
    });
    expect(updated.media[1]).toMatchObject({
      publicId: legacySecondImage.publicId,
      view: 'side',
      alt: legacySecondImage.alt,
      isPrimary: true,
      width: 800,
      height: 800,
      sortOrder: 8,
    });
    expect(
      updated.media.every((media) => media.lightingState === undefined),
    ).toBe(true);
    expect(updated.lightingGalleryEnabled).toBeUndefined();
  });

  it('rejects uploads when the product already has ten images', async () => {
    const product = await createProduct(
      Array.from({ length: PRODUCT_MEDIA_MAX_IMAGES }, (_, index) =>
        image(`image-${index}`),
      ),
    );

    await expect(
      uploadProductImage(
        product.id,
        {
          buffer: await validPng(),
          alt: 'Additional product view',
          view: 'side',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_IMAGE_LIMIT' });
    expect(mocks.uploadStream).not.toHaveBeenCalled();
  });

  it('uploads ordinary product images without a lighting state', async () => {
    const product = await createProduct();

    const uploaded = await uploadProductImage(
      product.id,
      {
        buffer: await validPng(),
        alt: 'Ordinary product image',
        view: 'front',
      },
      actor,
    );

    expect(uploaded.lightingState).toBeUndefined();
    expect((await Product.findById(product.id))?.media).toHaveLength(1);
    expect(mocks.uploadStream).toHaveBeenCalledTimes(1);
  });

  it('uploads images into either configured lighting state and preserves independent primaries', async () => {
    const product = await createProduct(
      [{ ...image('lamp-on'), lightingState: 'on', isPrimary: true }],
      { lightingGalleryEnabled: true, categorySlug: 'lamps-and-lighting' },
    );

    const onImage = await uploadProductImage(
      product.id,
      {
        buffer: await validPng(),
        alt: 'Lamp illuminated',
        view: 'front',
        lightingState: 'on',
        isPrimary: true,
      },
      actor,
    );
    const offImage = await uploadProductImage(
      product.id,
      {
        buffer: await validPng(),
        alt: 'Lamp turned off',
        view: 'front',
        lightingState: 'off',
      },
      actor,
    );

    const saved = await Product.findById(product.id);
    expect(onImage.lightingState).toBe('on');
    expect(offImage.lightingState).toBe('off');
    expect(saved?.media.filter((media) => media.isPrimary)).toHaveLength(2);
    expect(
      saved?.media.find((media) => media.lightingState === 'off')?.isPrimary,
    ).toBe(true);
  });

  it('rejects lighting states for unsupported products and requires a state when an enabled lamp uploads', async () => {
    const ordinary = await createProduct();
    await expect(
      uploadProductImage(
        ordinary.id,
        {
          buffer: await validPng(),
          alt: 'Unexpected state image',
          view: 'front',
          lightingState: 'on',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'LIGHTING_GALLERY_NOT_ENABLED' });
    expect((await Product.findById(ordinary.id))?.media).toHaveLength(0);
    expect(mocks.uploadStream).not.toHaveBeenCalled();

    const ineligible = await createProduct([], {
      lightingGalleryEnabled: true,
      categorySlug: 'other-3d-prints',
    });
    await expect(
      uploadProductImage(
        ineligible.id,
        {
          buffer: await validPng(),
          alt: 'Lamp image',
          view: 'front',
          lightingState: 'on',
        },
        actor,
      ),
    ).rejects.toMatchObject({
      code: 'LIGHTING_GALLERY_UNSUPPORTED_CATEGORY',
    });
    expect((await Product.findById(ineligible.id))?.media).toHaveLength(0);
    expect(mocks.uploadStream).not.toHaveBeenCalled();

    const eligible = await createProduct([], {
      lightingGalleryEnabled: true,
      categorySlug: 'lamps-and-lighting',
    });
    await expect(
      uploadProductImage(
        eligible.id,
        {
          buffer: await validPng(),
          alt: 'Lamp image',
          view: 'front',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'LIGHTING_GALLERY_STATE_REQUIRED' });
  });

  it('keeps ON and OFF primary selection independent', async () => {
    const product = await createProduct(
      [
        { ...image('on-primary'), lightingState: 'on', isPrimary: true },
        { ...image('on-secondary'), lightingState: 'on', isPrimary: false },
        { ...image('off-primary'), lightingState: 'off', isPrimary: true },
        { ...image('off-secondary'), lightingState: 'off', isPrimary: false },
      ],
      { lightingGalleryEnabled: true, categorySlug: 'lamps-and-lighting' },
    );

    await updateProductImage(
      product.id,
      product.media[1]._id!.toString(),
      { isPrimary: true },
      actor,
    );
    let saved = await Product.findById(product.id);
    expect(
      saved?.media
        .find((media) => media.lightingState === 'on' && media.isPrimary)
        ?._id?.toString(),
    ).toBe(product.media[1]._id!.toString());
    expect(
      saved?.media
        .find((media) => media.lightingState === 'off' && media.isPrimary)
        ?._id?.toString(),
    ).toBe(product.media[2]._id!.toString());

    await updateProductImage(
      product.id,
      product.media[3]._id!.toString(),
      { isPrimary: true },
      actor,
    );
    saved = await Product.findById(product.id);
    expect(
      saved?.media.filter(
        (media) => media.lightingState === 'on' && media.isPrimary,
      ),
    ).toHaveLength(1);
    expect(
      saved?.media.filter(
        (media) => media.lightingState === 'off' && media.isPrimary,
      ),
    ).toHaveLength(1);
  });

  it('promotes the earliest remaining source image when its primary moves to a state with an existing primary', async () => {
    const product = await createProduct(
      [
        {
          ...image('on-primary'),
          lightingState: 'on',
          isPrimary: true,
          sortOrder: 0,
        },
        {
          ...image('on-next'),
          lightingState: 'on',
          isPrimary: false,
          sortOrder: 1,
        },
        {
          ...image('off-primary'),
          lightingState: 'off',
          isPrimary: true,
          sortOrder: 2,
        },
      ],
      { lightingGalleryEnabled: true, categorySlug: 'lamps-and-lighting' },
    );

    await updateProductImage(
      product.id,
      product.media[0]._id!.toString(),
      { lightingState: 'off' },
      actor,
    );

    const saved = await Product.findById(product.id);
    expect(
      saved?.media
        .find((media) => media.lightingState === 'on' && media.isPrimary)
        ?._id?.toString(),
    ).toBe(product.media[1]._id!.toString());
    expect(
      saved?.media
        .find((media) => media.lightingState === 'off' && media.isPrimary)
        ?._id?.toString(),
    ).toBe(product.media[2]._id!.toString());
    expect(
      saved?.media.find((media) => media._id?.equals(product.media[0]._id!))
        ?.isPrimary,
    ).toBe(false);
  });

  it('does not change the source primary when a non-primary image changes state', async () => {
    const product = await createProduct(
      [
        { ...image('on-primary'), lightingState: 'on', isPrimary: true },
        { ...image('on-secondary'), lightingState: 'on', isPrimary: false },
        { ...image('off-primary'), lightingState: 'off', isPrimary: true },
      ],
      { lightingGalleryEnabled: true, categorySlug: 'lamps-and-lighting' },
    );

    await updateProductImage(
      product.id,
      product.media[1]._id!.toString(),
      { lightingState: 'off' },
      actor,
    );

    const saved = await Product.findById(product.id);
    expect(
      saved?.media
        .find((media) => media.lightingState === 'on' && media.isPrimary)
        ?._id?.toString(),
    ).toBe(product.media[0]._id!.toString());
    expect(
      saved?.media
        .find((media) => media.lightingState === 'off' && media.isPrimary)
        ?._id?.toString(),
    ).toBe(product.media[2]._id!.toString());
    expect(
      saved?.media.find((media) => media._id?.equals(product.media[1]._id!))
        ?.isPrimary,
    ).toBe(false);
  });

  it('moves the last source primary to an empty state without leaving a primary in the empty source', async () => {
    const product = await createProduct(
      [{ ...image('only-on'), lightingState: 'on', isPrimary: true }],
      { lightingGalleryEnabled: true, categorySlug: 'lamps-and-lighting' },
    );

    await updateProductImage(
      product.id,
      product.media[0]._id!.toString(),
      { lightingState: 'off' },
      actor,
    );

    const saved = await Product.findById(product.id);
    expect(
      saved?.media.filter((media) => media.lightingState === 'on'),
    ).toHaveLength(0);
    expect(saved?.media[0]).toMatchObject({
      lightingState: 'off',
      isPrimary: true,
    });
  });

  it('preserves ordinary product-wide primary behavior when updating media', async () => {
    const product = await createProduct([
      { ...image('ordinary-primary'), isPrimary: true },
      { ...image('ordinary-secondary'), isPrimary: false },
    ]);

    await updateProductImage(
      product.id,
      product.media[1]._id!.toString(),
      { isPrimary: true },
      actor,
    );

    const saved = await Product.findById(product.id);
    expect(
      saved?.media.filter((media) => media.isPrimary).map((media) => media.alt),
    ).toEqual(['ordinary-secondary product image']);
    await expect(
      updateProductImage(
        product.id,
        product.media[1]._id!.toString(),
        { lightingState: 'on' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'LIGHTING_GALLERY_NOT_ENABLED' });
  });

  it('rejects sort order in individual media updates and preserves order for metadata changes', async () => {
    const product = await createProduct([
      { ...image('first'), sortOrder: 0 },
      { ...image('second'), sortOrder: 1 },
    ]);
    const mediaId = product.media[0]._id!.toString();

    expect(
      updateProductMediaSchema.safeParse({
        params: { id: product.id, mediaId },
        body: { sortOrder: 1 },
        query: {},
      }).success,
    ).toBe(false);

    await updateProductImage(
      product.id,
      mediaId,
      { alt: 'Updated first image' },
      actor,
    );
    const saved = await Product.findById(product.id);
    expect(saved?.media.map((media) => media.sortOrder)).toEqual([0, 1]);
    expect(saved?.media[0].alt).toBe('Updated first image');
  });

  it('preserves lighting states and group primaries when reordering and deleting media', async () => {
    const product = await createProduct(
      [
        { ...image('on-primary'), lightingState: 'on', isPrimary: true },
        { ...image('on-next'), lightingState: 'on', isPrimary: false },
        { ...image('off-primary'), lightingState: 'off', isPrimary: true },
      ],
      { lightingGalleryEnabled: true, categorySlug: 'lamps-and-lighting' },
    );
    const mediaIds = product.media.map((media) => media._id!.toString());
    await reorderProductImages(
      product.id,
      [mediaIds[2], mediaIds[1], mediaIds[0]],
      actor,
    );

    let saved = await Product.findById(product.id);
    expect(
      saved?.media.map((media) => [media._id?.toString(), media.lightingState]),
    ).toEqual([
      [mediaIds[2], 'off'],
      [mediaIds[1], 'on'],
      [mediaIds[0], 'on'],
    ]);

    await deleteProductImage(product.id, mediaIds[0], actor);
    saved = await Product.findById(product.id);
    expect(
      saved?.media.find((media) => media.lightingState === 'on')?.isPrimary,
    ).toBe(true);
    expect(
      saved?.media.find((media) => media.lightingState === 'off')?.isPrimary,
    ).toBe(true);
  });

  it('assigns a legacy image only when explicitly requested and preserves its metadata and id', async () => {
    const legacy = {
      ...image('legacy-unassigned'),
      publicId: 'legacy/storage-id',
      width: 900,
      height: 700,
      alt: 'Legacy lamp image',
      sortOrder: 4,
    };
    const product = await createProduct([legacy], {
      lightingGalleryEnabled: true,
      categorySlug: 'lamps-and-lighting',
    });
    const id = product.media[0]._id!.toString();

    const assigned = await updateProductImage(
      product.id,
      id,
      { lightingState: 'off' },
      actor,
    );

    expect(assigned._id?.toString()).toBe(id);
    expect(assigned).toMatchObject({
      lightingState: 'off',
      url: legacy.url,
      publicId: legacy.publicId,
      width: 900,
      height: 700,
      alt: legacy.alt,
      sortOrder: 4,
      isPrimary: true,
    });
  });

  it('assigns lighting states only when the persisted gallery flag and category are eligible', async () => {
    const enabled = await createProduct([image('eligible-lamp')], {
      lightingGalleryEnabled: true,
      categorySlug: 'lamps-and-lighting',
    });
    const assigned = await updateProductImage(
      enabled.id,
      enabled.media[0]._id!.toString(),
      { lightingState: 'on' },
      actor,
    );
    expect(assigned.lightingState).toBe('on');
    expect((await Product.findById(enabled.id))?.lightingGalleryEnabled).toBe(
      true,
    );

    await Product.updateOne(
      { _id: enabled._id },
      { $set: { lightingGalleryEnabled: false } },
    );
    await expect(
      updateProductImage(
        enabled.id,
        enabled.media[0]._id!.toString(),
        { lightingState: 'off' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'LIGHTING_GALLERY_NOT_ENABLED' });

    await Category.updateOne(
      { _id: enabled.category },
      { $set: { slug: 'other-3d-prints' } },
    );
    await Product.updateOne(
      { _id: enabled._id },
      { $set: { lightingGalleryEnabled: true } },
    );
    await expect(
      updateProductImage(
        enabled.id,
        enabled.media[0]._id!.toString(),
        { lightingState: 'on' },
        actor,
      ),
    ).rejects.toMatchObject({
      code: 'LIGHTING_GALLERY_UNSUPPORTED_CATEGORY',
    });
  });

  it('deletes ordinary images when the lighting gallery is disabled', async () => {
    const product = await createProduct([image('ordinary-lamp')], {
      lightingGalleryEnabled: false,
      categorySlug: 'lamps-and-lighting',
    });
    const mediaId = product.media[0]._id!.toString();

    await deleteProductImage(product.id, mediaId, actor);

    expect((await Product.findById(product.id))?.media).toHaveLength(0);
    expect(mocks.destroy).toHaveBeenCalledWith(
      'dainty-bloom/products/ordinary-lamp',
      expect.any(Object),
    );
  });

  it('rejects state changes for an unsupported category and preserves media on conflicts', async () => {
    const ineligible = await createProduct([image('ineligible-image')], {
      lightingGalleryEnabled: true,
      categorySlug: 'other-3d-prints',
    });
    await expect(
      updateProductImage(
        ineligible.id,
        ineligible.media[0]._id!.toString(),
        { lightingState: 'on' },
        actor,
      ),
    ).rejects.toMatchObject({
      code: 'LIGHTING_GALLERY_UNSUPPORTED_CATEGORY',
    });

    const product = await createProduct(
      [{ ...image('conflict-image'), lightingState: 'on', isPrimary: true }],
      { lightingGalleryEnabled: true, categorySlug: 'lamps-and-lighting' },
    );
    const write = vi
      .spyOn(Product, 'findOneAndUpdate')
      .mockImplementationOnce(() => null as never);
    await expect(
      updateProductImage(
        product.id,
        product.media[0]._id!.toString(),
        { alt: 'Conflicting edit' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_MEDIA_CONFLICT' });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ _id: product._id, __v: product.__v }),
      expect.objectContaining({ $inc: { __v: 1 } }),
      expect.objectContaining({ new: true, runValidators: true }),
    );
    expect((await Product.findById(product.id))?.media[0].alt).toBe(
      'conflict-image product image',
    );
  });

  it('persists a successful upload even when audit logging fails', async () => {
    const product = await createProduct();
    mocks.audit.mockRejectedValueOnce(new Error('Audit database unavailable'));

    const uploaded = await uploadProductImage(
      product.id,
      {
        buffer: await validPng(),
        alt: 'Front product view',
        view: 'front',
      },
      actor,
    );

    const saved = await Product.findById(product.id);
    expect(uploaded.publicId).toBe('dainty-bloom/products/test-image');
    expect(saved?.media).toHaveLength(1);
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it('cleans up a Cloudinary upload when the product media write fails', async () => {
    const product = await createProduct();
    vi.spyOn(Product, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error('Database unavailable');
    });

    await expect(
      uploadProductImage(
        product.id,
        {
          buffer: await validPng(),
          alt: 'Front product view',
          view: 'front',
        },
        actor,
      ),
    ).rejects.toThrow('Database unavailable');
    expect(mocks.destroy).toHaveBeenCalledWith(
      'dainty-bloom/products/test-image',
      expect.any(Object),
    );
    expect((await Product.findById(product.id))?.media).toHaveLength(0);
  });

  it('does not delete the Cloudinary asset before a successful media removal write', async () => {
    const product = await createProduct([image('image-one')]);
    const mediaId = product.media[0]._id!.toString();
    vi.spyOn(Product, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error('Database unavailable');
    });

    await expect(
      deleteProductImage(product.id, mediaId, actor),
    ).rejects.toThrow('Database unavailable');

    expect(mocks.destroy).not.toHaveBeenCalled();
    expect((await Product.findById(product.id))?.media).toHaveLength(1);
  });

  it('rejects a media write when another request changed the product version', async () => {
    const product = await createProduct([image('image-one')]);
    const mediaId = product.media[0]._id!.toString();
    const atomicUpdate = vi
      .spyOn(Product, 'findOneAndUpdate')
      .mockImplementationOnce(() => null as never);

    await expect(
      updateProductImage(
        product.id,
        mediaId,
        { alt: 'Updated side view' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_MEDIA_CONFLICT' });
    expect(atomicUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: product._id, __v: product.__v }),
      expect.objectContaining({ $inc: { __v: 1 } }),
      expect.objectContaining({ new: true, runValidators: true }),
    );
  });

  it('reports Cloudinary cleanup failure after removing the database reference', async () => {
    const product = await createProduct([image('image-one')]);
    const mediaId = product.media[0]._id!.toString();
    mocks.destroy.mockRejectedValueOnce(new Error('Cloudinary unavailable'));

    await expect(
      deleteProductImage(product.id, mediaId, actor),
    ).rejects.toMatchObject({
      code: 'IMAGE_DELETE_CLEANUP_FAILED',
      message:
        'Product image reference was removed, but Cloudinary cleanup failed',
    } satisfies Partial<AppError>);
    expect((await Product.findById(product.id))?.media).toHaveLength(0);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product.media_delete',
        metadata: expect.objectContaining({
          mediaId,
          storageCleanup: 'failed',
          storageCleanupCode: 'IMAGE_DELETE_CLEANUP_FAILED',
        }),
      }),
    );
  });

  it('retains cleanup failure semantics when deletion audit logging also fails', async () => {
    const product = await createProduct([image('image-one')]);
    const mediaId = product.media[0]._id!.toString();
    mocks.destroy.mockRejectedValueOnce(new Error('Cloudinary unavailable'));
    mocks.audit.mockRejectedValueOnce(new Error('Audit database unavailable'));

    await expect(
      deleteProductImage(product.id, mediaId, actor),
    ).rejects.toMatchObject({
      code: 'IMAGE_DELETE_CLEANUP_FAILED',
    } satisfies Partial<AppError>);
    expect((await Product.findById(product.id))?.media).toHaveLength(0);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product.media_delete',
        metadata: expect.objectContaining({ storageCleanup: 'failed' }),
      }),
    );
  });

  it('preserves primary-image selection when reordering media', async () => {
    const product = await createProduct([
      { ...image('image-one'), isPrimary: true, sortOrder: 0 },
      { ...image('image-two'), isPrimary: false, sortOrder: 1 },
    ]);
    const primaryId = product.media[0]._id!.toString();
    const secondId = product.media[1]._id!.toString();

    await reorderProductImages(product.id, [secondId, primaryId], actor);

    const saved = await Product.findById(product.id);
    expect(saved?.media.map((media) => media._id?.toString())).toEqual([
      secondId,
      primaryId,
    ]);
    expect(saved?.media.find((media) => media.isPrimary)?._id?.toString()).toBe(
      primaryId,
    );
    expect(saved?.media.map((media) => media.sortOrder)).toEqual([0, 1]);
  });

  it('enforces one primary image when changing the selected image', async () => {
    const product = await createProduct([
      { ...image('image-one'), isPrimary: true, sortOrder: 0 },
      { ...image('image-two'), isPrimary: false, sortOrder: 1 },
    ]);

    await updateProductImage(
      product.id,
      product.media[1]._id!.toString(),
      { isPrimary: true },
      actor,
    );

    const saved = await Product.findById(product.id);
    expect(saved?.media.filter((media) => media.isPrimary)).toHaveLength(1);
    expect(saved?.media[1].isPrimary).toBe(true);
  });
});

async function createProduct(
  media: Array<
    ReturnType<typeof image> & { lightingState?: 'on' | 'off' }
  > = [],
  options: {
    lightingGalleryEnabled?: boolean;
    categorySlug?: string;
    status?: 'draft' | 'active' | 'archived' | 'out_of_stock';
  } = {},
) {
  const category = await Category.create({
    name: 'Product image tests',
    ...(options.categorySlug ? { slug: options.categorySlug } : {}),
    ...(options.categorySlug === 'lamps-and-lighting'
      ? { formProfile: 'three_d_printed' }
      : {}),
  });
  return Product.create({
    title: 'Product image test',
    slug: `product-image-test-${new mongoose.Types.ObjectId().toString()}`,
    description: 'Product used to verify image media service behavior.',
    category: category._id,
    productType: 'tshirt',
    media,
    sku: `IMAGE-TEST-${new mongoose.Types.ObjectId().toString()}`,
    basePriceMinor: 1000,
    currency: 'GBP',
    status: options.status ?? 'draft',
    ...(options.lightingGalleryEnabled !== undefined
      ? { lightingGalleryEnabled: options.lightingGalleryEnabled }
      : {}),
    optionGroups: [],
    quantityPricing: [],
    printTechniques: [],
    specifications: [],
    artworkRequirements: { allowedFormats: [] },
    artworkRequired: false,
    stock: {
      trackInventory: false,
      quantity: 0,
      lowStockThreshold: 0,
      allowBackorder: false,
      reserveBlanksForMadeToOrder: false,
    },
    seo: {},
    isFeatured: false,
    minOrderQuantity: 1,
  });
}

async function lampCategory() {
  return Category.create({
    name: 'Lamps and Lighting',
    slug: 'lamps-and-lighting',
    formProfile: 'three_d_printed',
  });
}

function adminProductInput(
  category: string,
  overrides: Partial<ProductAdminInput> = {},
): ProductAdminInput {
  const id = new mongoose.Types.ObjectId().toString();
  return {
    title: 'Lighting gallery test product',
    slug: `lighting-gallery-test-${id}`,
    description: 'Product used to verify lighting gallery behavior.',
    category,
    productType: 'three_d_printed',
    media: [],
    sku: `LAMP-TEST-${id}`,
    basePriceMinor: 1000,
    currency: 'GBP',
    optionGroups: [],
    quantityPricing: [],
    printTechniques: [],
    specifications: [],
    artworkRequirements: { allowedFormats: [] },
    artworkRequired: false,
    stock: {
      trackInventory: false,
      quantity: 0,
      lowStockThreshold: 0,
      allowBackorder: false,
      reserveBlanksForMadeToOrder: false,
    },
    status: 'draft',
    seo: {},
    isFeatured: false,
    minOrderQuantity: 1,
    ...overrides,
  };
}

function image(publicId: string, view: ProductMediaView = 'front') {
  return {
    url: `https://res.cloudinary.com/test/image/upload/${publicId}`,
    publicId: `dainty-bloom/products/${publicId}`,
    alt: `${publicId} product image`,
    view,
    isPrimary: false,
    sortOrder: 0,
  };
}

function validPng() {
  return sharp({
    create: {
      width: 600,
      height: 600,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
}
