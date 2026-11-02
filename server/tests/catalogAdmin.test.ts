import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../src/config/env';
import { app } from '../src/app';
import {
  AuditEvent,
  Category,
  Order,
  Product,
  User,
  Wishlist,
} from '../src/models';
import { ensureBusinessCategories } from '../src/scripts/categoryDefinitions';

const CSRF_HEADER = { 'X-Requested-With': 'dainty-bloom' };
const PASSWORD = 'a-secure-password-123';
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    AuditEvent.init(),
    Category.init(),
    Order.init(),
    Product.init(),
    User.init(),
    Wishlist.init(),
  ]);
});

afterEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('admin product and category management', () => {
  it('requires product permissions for product and category routes', async () => {
    expect((await request(app).get('/api/admin/products')).status).toBe(401);
    expect((await request(app).get('/api/admin/categories')).status).toBe(401);

    const customerCookie = await signIn('customer');
    expect(
      (
        await request(app)
          .get('/api/admin/products')
          .set('Cookie', customerCookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/admin/categories')
          .set('Cookie', customerCookie)
          .set(CSRF_HEADER)
          .send({ name: 'Unauthorized category' })
      ).status,
    ).toBe(403);
  });

  it('creates, updates, lists, and safely deletes categories', async () => {
    const cookie = await signIn('admin');
    const created = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({
        name: 'Canvas Prints',
        slug: 'canvas-prints',
        image: 'https://images.example.test/canvas.png',
        description: 'Canvas products.',
        sortOrder: 2,
        isActive: true,
      });

    expect(created.status).toBe(201);
    expect(created.body.data.category).toMatchObject({
      slug: 'canvas-prints',
      image: 'https://images.example.test/canvas.png',
      isActive: true,
    });

    const duplicateSlug = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ name: 'Canvas Duplicate', slug: 'canvas-prints' });
    expect(duplicateSlug.status).toBe(201);
    expect(duplicateSlug.body.data.category.slug).toBe('canvas-prints-2');

    const invalidSlug = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ name: 'Invalid Slug', slug: '!!!' });
    expect(invalidSlug.status).toBe(400);
    expect(invalidSlug.body.error.code).toBe('INVALID_SLUG');

    const updated = await request(app)
      .patch(`/api/admin/categories/${created.body.data.category._id}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({
        name: 'Paintable Canvas',
        image: 'https://images.example.test/paintable-canvas.png',
        isActive: false,
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.category).toMatchObject({
      name: 'Paintable Canvas',
      slug: 'paintable-canvas',
      image: 'https://images.example.test/paintable-canvas.png',
      isActive: false,
    });

    const parentId = updated.body.data.category._id as string;
    const child = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ name: 'Small Canvas', parent: parentId });
    expect(child.status).toBe(201);

    const blockedDelete = await request(app)
      .delete(`/api/admin/categories/${parentId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER);
    expect(blockedDelete.status).toBe(409);
    expect(blockedDelete.body.error.code).toBe('CATEGORY_HAS_PRODUCTS');

    const childDelete = await request(app)
      .delete(`/api/admin/categories/${child.body.data.category._id}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER);
    expect(childDelete.status).toBe(200);
    expect(await Category.exists({ _id: parentId })).toBeTruthy();
  });

  it('validates, defaults, persists, and returns category form profiles', async () => {
    const cookie = await signIn('admin');
    const profiles = [
      'apparel',
      'drinkware',
      'canvas_art',
      'three_d_printed',
      'bags',
      'general',
    ] as const;

    for (const [index, formProfile] of profiles.entries()) {
      const created = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', cookie)
        .set(CSRF_HEADER)
        .send({ name: `Profile category ${index}`, formProfile });

      expect(created.status).toBe(201);
      expect(created.body.data.category.formProfile).toBe(formProfile);
    }

    const defaulted = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ name: 'Category with default profile' });
    expect(defaulted.status).toBe(201);
    expect(defaulted.body.data.category.formProfile).toBe('general');

    const legacyCategory = await Category.collection.insertOne({
      name: 'Legacy category without a profile',
      slug: 'legacy-category-without-a-profile',
      sortOrder: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const legacyId = legacyCategory.insertedId.toString();
    const adminList = await request(app)
      .get('/api/admin/categories')
      .set('Cookie', cookie);
    expect(adminList.status).toBe(200);
    expect(
      adminList.body.data.categories.find(
        (category: { _id: string }) => category._id === legacyId,
      ).formProfile,
    ).toBe('general');

    const legacyDetail = await request(app).get(
      '/api/categories/legacy-category-without-a-profile',
    );
    expect(legacyDetail.status).toBe(200);
    expect(legacyDetail.body.data.category.formProfile).toBe('general');

    const categoryId = defaulted.body.data.category._id as string;
    const updated = await request(app)
      .patch(`/api/admin/categories/${categoryId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ formProfile: 'canvas_art' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.category.formProfile).toBe('canvas_art');

    const partialUpdate = await request(app)
      .patch(`/api/admin/categories/${categoryId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ description: 'Keep the selected profile.' });
    expect(partialUpdate.status).toBe(200);
    expect(partialUpdate.body.data.category).toMatchObject({
      formProfile: 'canvas_art',
      description: 'Keep the selected profile.',
    });

    const invalidCreate = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ name: 'Invalid profile category', formProfile: 'unknown' });
    expect(invalidCreate.status).toBe(400);
    expect(invalidCreate.body.error.code).toBe('VALIDATION_ERROR');

    const invalidUpdate = await request(app)
      .patch(`/api/admin/categories/${categoryId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ formProfile: 'unknown' });
    expect(invalidUpdate.status).toBe(400);
    expect(invalidUpdate.body.error.code).toBe('VALIDATION_ERROR');

    const categoryList = await request(app)
      .get('/api/admin/categories')
      .set('Cookie', cookie);
    expect(categoryList.status).toBe(200);
    expect(
      categoryList.body.data.categories.find(
        (category: { _id: string }) => category._id === categoryId,
      ).formProfile,
    ).toBe('canvas_art');

    const publicCategories = await request(app).get('/api/categories');
    expect(publicCategories.status).toBe(200);
    expect(publicCategories.body.data.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: categoryId,
          formProfile: 'canvas_art',
        }),
      ]),
    );

    const categoryDetail = await request(app).get(
      '/api/categories/category-with-default-profile',
    );
    expect(categoryDetail.status).toBe(200);
    expect(categoryDetail.body.data.category.formProfile).toBe('canvas_art');
  });

  it('seeds profiles for new categories without overwriting admin assignments', async () => {
    await Category.create({ name: 'T-Shirts', formProfile: 'bags' });

    await ensureBusinessCategories();

    expect(
      await Category.findOne({ slug: 't-shirts' }).then(
        (category) => category?.formProfile,
      ),
    ).toBe('bags');
    expect(
      await Category.findOne({ slug: 'mugs' }).then(
        (category) => category?.formProfile,
      ),
    ).toBe('drinkware');
    expect(
      await Category.findOne({ slug: 'toys' }).then(
        (category) => category?.formProfile,
      ),
    ).toBe('three_d_printed');
    expect(
      await Category.findOne({ slug: 'phone-cases' }).then(
        (category) => category?.formProfile,
      ),
    ).toBe('general');
  });

  it('creates, searches, edits, publishes, and updates inventory for products', async () => {
    const cookie = await signIn('admin');
    const category = await Category.create({ name: 'T-Shirts' });
    const payload = {
      ...productPayload(category._id.toString()),
      themes: ['christmas', 'anime'],
    };

    const created = await request(app)
      .post('/api/admin/products')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send(payload);
    expect(created.status).toBe(201);
    expect(created.body.data.product).toMatchObject({
      title: payload.title,
      sku: payload.sku,
      status: 'draft',
      themes: ['christmas', 'anime'],
      optionGroups: payload.optionGroups,
      stock: payload.stock,
    });

    const productId = created.body.data.product._id as string;
    const list = await request(app)
      .get('/api/admin/products')
      .query({
        q: payload.sku,
        category: category._id.toString(),
        status: 'draft',
      })
      .set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]._id).toBe(productId);

    const updated = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({
        title: 'Updated Classic Tee',
        basePriceMinor: 3200,
        themes: ['halloween', 'kids'],
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.product).toMatchObject({
      title: 'Updated Classic Tee',
      basePriceMinor: 3200,
      themes: ['halloween', 'kids'],
      optionGroups: payload.optionGroups,
    });

    const invalidThemeUpdate = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ themes: ['winter'] });
    expect(invalidThemeUpdate.status).toBe(400);
    expect(invalidThemeUpdate.body.error.code).toBe('VALIDATION_ERROR');

    const published = await request(app)
      .patch(`/api/admin/products/${productId}/status`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ status: 'active' });
    expect(published.status).toBe(200);
    expect(published.body.data.product.status).toBe('active');

    const publicCatalog = await request(app)
      .get('/api/products')
      .query({ productType: 'tshirt', theme: 'halloween' });
    expect(publicCatalog.status).toBe(200);
    expect(publicCatalog.body.data.pagination.total).toBe(1);
    expect(publicCatalog.body.data.items[0].slug).toBe(payload.slug);

    const activeEdit = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ title: 'Updated Classic Tee Again' });
    expect(activeEdit.status).toBe(200);
    expect(activeEdit.body.data.product).toMatchObject({
      title: 'Updated Classic Tee Again',
      status: 'active',
      themes: ['halloween', 'kids'],
      stock: payload.stock,
      optionGroups: payload.optionGroups,
    });

    const clearedThemes = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ themes: [] });
    expect(clearedThemes.status).toBe(200);
    expect(clearedThemes.body.data.product.themes).toEqual([]);

    const stock = await request(app)
      .patch(`/api/admin/products/${productId}/stock`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ mode: 'set', quantity: 0, note: 'Inventory count' });
    expect(stock.status).toBe(200);
    expect(stock.body.data.product.stock.quantity).toBe(0);
    expect(stock.body.data.product.status).toBe('out_of_stock');

    const blockedCategoryDelete = await request(app)
      .delete(`/api/admin/categories/${category._id}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER);
    expect(blockedCategoryDelete.status).toBe(409);
    expect(blockedCategoryDelete.body.error.code).toBe('CATEGORY_HAS_PRODUCTS');
  });

  it('returns clear validation and duplicate-SKU errors', async () => {
    const cookie = await signIn('admin');
    const category = await Category.create({ name: 'Mugs' });

    const invalid = await request(app)
      .post('/api/admin/products')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ title: 'Incomplete product' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const defaultsProduct = await request(app)
      .post('/api/admin/products')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({
        title: 'Defaulted Product',
        description: 'A product using the server defaults.',
        category: category._id.toString(),
        productType: 'mug',
        media: [],
        sku: 'DEFAULTS-001',
        basePriceMinor: 1000,
      });
    expect(defaultsProduct.status).toBe(201);
    expect(defaultsProduct.body.data.product).toMatchObject({
      status: 'draft',
      optionGroups: [],
      quantityPricing: [],
      stock: {
        trackInventory: false,
        quantity: 0,
        lowStockThreshold: 0,
        allowBackorder: false,
        reserveBlanksForMadeToOrder: false,
      },
      isFeatured: false,
      minOrderQuantity: 1,
    });
    expect(defaultsProduct.body.data.product).not.toHaveProperty('themes');

    const legacyProductId = defaultsProduct.body.data.product._id as string;
    const legacyProductUpdate = await request(app)
      .patch(`/api/admin/products/${legacyProductId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({ title: 'Updated Product Without Themes' });
    expect(legacyProductUpdate.status).toBe(200);
    expect(legacyProductUpdate.body.data.product).not.toHaveProperty('themes');

    const invalidThemes = await request(app)
      .post('/api/admin/products')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send({
        ...productPayload(category._id.toString(), 'INVALID-THEME-001'),
        themes: ['lamps-and-lighting'],
      });
    expect(invalidThemes.status).toBe(400);
    expect(invalidThemes.body.error.code).toBe('VALIDATION_ERROR');

    await Product.create(productPayload(category._id.toString()));
    const duplicateSku = await request(app)
      .post('/api/admin/products')
      .set('Cookie', cookie)
      .set(CSRF_HEADER)
      .send(productPayload(category._id.toString()));
    expect(duplicateSku.status).toBe(409);
    expect(duplicateSku.body.error.code).toBe('SKU_ALREADY_EXISTS');
  });

  it('filters the public catalog by themes without exposing unpublished products', async () => {
    const category = await Category.create({
      name: 'Theme Test Category',
      slug: 'theme-test-category',
    });
    const themedProducts = [
      { theme: 'christmas', productType: 'mug' },
      { theme: 'halloween', productType: 'tshirt' },
      { theme: 'autumn', productType: 'three_d_printed' },
      { theme: 'kids', productType: 'canvas_paint_yourself' },
      { theme: 'anime', productType: 'other' },
    ] as const;

    for (const { theme, productType } of themedProducts) {
      await Product.create({
        ...productPayload(category._id.toString(), `THEME-${theme}`),
        slug: `theme-${theme}`,
        productType,
        status: 'active',
        themes: [theme],
      });
    }

    await Product.create({
      ...productPayload(category._id.toString(), 'THEME-KIDS-ANIME'),
      slug: 'theme-kids-anime',
      productType: 'canvas_custom_print',
      status: 'active',
      themes: ['kids', 'anime'],
    });
    await Product.create({
      ...productPayload(category._id.toString(), 'THEME-UNTHEMED'),
      slug: 'theme-unthemed',
      status: 'active',
    });
    await Product.create({
      ...productPayload(category._id.toString(), 'THEME-DRAFT'),
      slug: 'theme-draft',
      status: 'draft',
      themes: ['christmas'],
    });
    await Product.create({
      ...productPayload(category._id.toString(), 'THEME-ARCHIVED'),
      slug: 'theme-archived',
      status: 'archived',
      themes: ['halloween'],
    });
    await Product.create({
      ...productPayload(category._id.toString(), 'THEME-OUT-OF-STOCK'),
      slug: 'theme-out-of-stock',
      status: 'out_of_stock',
      themes: ['kids'],
    });

    for (const { theme } of themedProducts) {
      const response = await request(app).get('/api/products').query({ theme });
      expect(response.status).toBe(200);
      const slugs = (response.body.data.items as Array<{ slug: string }>).map(
        (product) => product.slug,
      );
      expect(slugs).toContain(`theme-${theme}`);
      expect(slugs).not.toContain('theme-unthemed');
      expect(slugs).not.toContain('theme-draft');
      expect(slugs).not.toContain('theme-archived');
      expect(slugs).not.toContain('theme-out-of-stock');
      if (theme === 'kids' || theme === 'anime') {
        expect(slugs).toContain('theme-kids-anime');
      }
    }

    const invalidTheme = await request(app)
      .get('/api/products')
      .query({ theme: 'winter' });
    expect(invalidTheme.status).toBe(400);
    expect(invalidTheme.body.error.code).toBe('VALIDATION_ERROR');

    const noThemeFilter = await request(app).get('/api/products');
    expect(noThemeFilter.status).toBe(200);
    expect(noThemeFilter.body.data.pagination.total).toBe(7);

    const categoryFilter = await request(app)
      .get('/api/products')
      .query({ theme: 'christmas', category: category.slug });
    expect(categoryFilter.status).toBe(200);
    expect(categoryFilter.body.data.pagination.total).toBe(1);

    const productTypeFilter = await request(app)
      .get('/api/products')
      .query({ theme: 'christmas', productType: 'mug' });
    expect(productTypeFilter.status).toBe(200);
    expect(productTypeFilter.body.data.pagination.total).toBe(1);
  });

  it('exposes lighting gallery data only for the eligible persisted category', async () => {
    const eligibleCategory = await Category.create({
      name: 'Lamps and Lighting',
      slug: 'lamps-and-lighting',
      formProfile: 'three_d_printed',
    });
    const ineligibleCategory = await Category.create({
      name: '3D Printed Goods',
      slug: '3d-printed-goods',
      formProfile: 'three_d_printed',
    });
    const media = [
      {
        url: 'https://images.example.test/lamp-on.png',
        alt: 'Lamp switched on',
        isPrimary: true,
        view: 'front',
        lightingState: 'on',
        sortOrder: 0,
      },
      {
        url: 'https://images.example.test/lamp-off.png',
        alt: 'Lamp switched off',
        isPrimary: true,
        view: 'front',
        lightingState: 'off',
        sortOrder: 1,
      },
      {
        url: 'https://images.example.test/lamp-legacy.png',
        alt: 'Legacy lamp image without a lighting assignment',
        isPrimary: false,
        view: 'detail',
        sortOrder: 2,
      },
    ];
    await Product.create({
      ...productPayload(eligibleCategory._id.toString(), 'LAMP-GALLERY-001'),
      slug: 'eligible-lamp-gallery',
      productType: 'three_d_printed',
      status: 'active',
      lightingGalleryEnabled: true,
      media,
    });
    await Product.create({
      ...productPayload(ineligibleCategory._id.toString(), 'OTHER-GALLERY-001'),
      slug: 'ineligible-lamp-gallery',
      productType: 'three_d_printed',
      status: 'active',
      lightingGalleryEnabled: true,
      media,
    });

    const eligible = await request(app).get(
      '/api/products/eligible-lamp-gallery',
    );
    expect(eligible.status).toBe(200);
    expect(eligible.body.data.product.lightingGalleryEnabled).toBe(true);
    expect(
      eligible.body.data.product.media.map(
        (image: { lightingState?: string }) => image.lightingState,
      ),
    ).toEqual(['on', 'off', undefined]);
    expect(eligible.body.data.product.media[0]).not.toHaveProperty('publicId');
    expect(eligible.body.data.product.media[2]).not.toHaveProperty(
      'lightingState',
    );

    await Product.create({
      ...productPayload(eligibleCategory._id.toString(), 'LAMP-GALLERY-002'),
      slug: 'lamp-gallery-feature-disabled',
      productType: 'three_d_printed',
      status: 'active',
      lightingGalleryEnabled: false,
      media,
    });
    const featureDisabled = await request(app).get(
      '/api/products/lamp-gallery-feature-disabled',
    );
    expect(featureDisabled.status).toBe(200);
    expect(featureDisabled.body.data.product.lightingGalleryEnabled).toBe(
      false,
    );
    expect(
      featureDisabled.body.data.product.media.map(
        (image: { url: string }) => image.url,
      ),
    ).toEqual(media.map((image) => image.url));
    expect(featureDisabled.body.data.product.media[0]).not.toHaveProperty(
      'lightingState',
    );

    const ineligible = await request(app).get(
      '/api/products/ineligible-lamp-gallery',
    );
    expect(ineligible.status).toBe(200);
    expect(ineligible.body.data.product.lightingGalleryEnabled).toBe(false);
    expect(ineligible.body.data.product.media[0]).not.toHaveProperty(
      'lightingState',
    );

    await Category.updateOne(
      { _id: eligibleCategory._id },
      { $set: { formProfile: 'general' } },
    );
    const invalidProfile = await request(app).get(
      '/api/products/eligible-lamp-gallery',
    );
    expect(invalidProfile.status).toBe(200);
    expect(invalidProfile.body.data.product.lightingGalleryEnabled).toBe(false);
    expect(invalidProfile.body.data.product.media[0]).not.toHaveProperty(
      'lightingState',
    );
  });

  it('returns complete descriptions and explicitly matched lighting images for catalog and wishlist cards', async () => {
    const category = await Category.create({
      name: 'Lamps and Lighting',
      slug: 'lamps-and-lighting',
      formProfile: 'three_d_printed',
    });
    const description =
      'A long lamp description that remains unchanged in storage and is returned in full for card previews.';
    const completePair = await Product.create({
      ...productPayload(category._id.toString(), 'LAMP-CARD-001'),
      slug: 'lamp-card-complete-pair',
      description,
      productType: 'three_d_printed',
      status: 'active',
      lightingGalleryEnabled: true,
      media: [
        {
          url: 'https://images.example.test/lamp-default.png',
          alt: 'Lamp default view',
          isPrimary: true,
          view: 'front',
          sortOrder: 0,
        },
        {
          url: 'https://images.example.test/lamp-off.png',
          alt: 'Lamp off',
          view: 'detail',
          lightingState: 'off',
          sortOrder: 1,
        },
        {
          url: 'https://images.example.test/lamp-on.png',
          alt: 'Lamp on',
          view: 'detail',
          lightingState: 'on',
          sortOrder: 2,
        },
      ],
    });
    const incompletePair = await Product.create({
      ...productPayload(category._id.toString(), 'LAMP-CARD-002'),
      slug: 'lamp-card-incomplete-pair',
      productType: 'three_d_printed',
      status: 'active',
      lightingGalleryEnabled: true,
      media: [
        {
          url: 'https://images.example.test/lamp-incomplete-default.png',
          alt: 'Lamp default view',
          isPrimary: true,
          view: 'front',
          sortOrder: 0,
        },
        {
          url: 'https://images.example.test/lamp-incomplete-on.png',
          alt: 'Lamp on',
          view: 'detail',
          lightingState: 'on',
          sortOrder: 1,
        },
      ],
    });

    const catalog = await request(app)
      .get('/api/products')
      .query({ category: 'lamps-and-lighting' });
    expect(catalog.status).toBe(200);
    const catalogCards = catalog.body.data.items as Array<{
      id: string;
      description?: string;
      primaryImage: { url: string } | null;
      lightingImages?: {
        on?: { primary: { url: string } };
        off?: { primary: { url: string } };
      };
    }>;
    const completeCard = catalogCards.find(
      (card) => card.id === completePair._id.toString(),
    );
    const incompleteCard = catalogCards.find(
      (card) => card.id === incompletePair._id.toString(),
    );
    expect(completeCard).toMatchObject({
      description,
      primaryImage: { url: 'https://images.example.test/lamp-default.png' },
      lightingImages: {
        on: { primary: { url: 'https://images.example.test/lamp-on.png' } },
        off: { primary: { url: 'https://images.example.test/lamp-off.png' } },
      },
    });
    expect(incompleteCard?.lightingImages).toEqual({
      on: {
        primary: {
          url: 'https://images.example.test/lamp-incomplete-on.png',
          alt: 'Lamp on',
          variants: expect.any(Object),
        },
      },
    });
    expect(
      await Product.findById(completePair._id).then(
        (product) => product?.description,
      ),
    ).toBe(description);

    const guest = request.agent(app);
    const added = await guest
      .post('/api/wishlist/items')
      .set(CSRF_HEADER)
      .send({ productId: completePair._id.toString() });
    expect(added.status).toBe(201);
    const wishlist = await guest.get('/api/wishlist');
    expect(wishlist.status).toBe(200);
    expect(wishlist.body.data.products[0]).toMatchObject({
      id: completePair._id.toString(),
      description,
      lightingImages: {
        on: { primary: { url: 'https://images.example.test/lamp-on.png' } },
        off: { primary: { url: 'https://images.example.test/lamp-off.png' } },
      },
    });
  });
});

async function signIn(role: 'admin' | 'customer'): Promise<string> {
  const suffix = Math.random().toString(36).slice(2);
  const user = await User.create({
    name: 'Catalog Test User',
    email: `${role}-${suffix}@example.test`,
    passwordHash: await bcrypt.hash(PASSWORD, env.BCRYPT_COST),
    role,
  });
  const response = await request(app)
    .post('/api/auth/login')
    .set(CSRF_HEADER)
    .send({
      email: user.email,
      password: PASSWORD,
      portal: role === 'admin' ? 'admin' : 'customer',
    });
  if (response.status !== 200) {
    throw new Error(`Test user login failed with status ${response.status}`);
  }
  const cookies = response.headers['set-cookie'];
  if (!Array.isArray(cookies))
    throw new Error('Login did not set auth cookies');
  return cookies
    .filter(
      (cookie) =>
        /^(daintyAccessToken|daintyRefreshToken)=/.test(cookie) &&
        cookie.split(';')[0].length > cookie.split(';')[0].indexOf('=') + 1,
    )
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

function productPayload(category: string, sku = 'CLASSIC-TEE-001') {
  return {
    title: 'Classic Tee',
    slug: 'classic-tee',
    description: 'A custom printed classic tee for catalog workflow tests.',
    category,
    productType: 'tshirt',
    media: [
      {
        url: 'https://images.example.test/classic-tee.png',
        alt: 'Front view of the classic tee',
        isPrimary: true,
        view: 'front',
      },
    ],
    sku,
    basePriceMinor: 2800,
    currency: 'GBP',
    optionGroups: [
      {
        key: 'size',
        label: 'Size',
        required: true,
        values: [
          {
            label: 'Medium',
            value: 'medium',
            priceModifierMinor: 0,
            isAvailable: true,
          },
        ],
      },
    ],
    quantityPricing: [],
    printTechniques: [],
    specifications: [],
    artworkRequirements: { allowedFormats: [] },
    artworkRequired: false,
    stock: {
      trackInventory: true,
      quantity: 4,
      lowStockThreshold: 1,
      allowBackorder: false,
      reserveBlanksForMadeToOrder: false,
    },
    status: 'draft',
    seo: {},
    isFeatured: false,
    minOrderQuantity: 1,
  };
}
