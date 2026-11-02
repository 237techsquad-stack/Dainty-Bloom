import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category, CatalogPage } from '@/lib/api/types';
import { getProductCanonicalUrl } from '@/lib/siteUrl';

const { getPublicCatalog, getPublicCategories } = vi.hoisted(() => ({
  getPublicCatalog: vi.fn(),
  getPublicCategories: vi.fn(),
}));

vi.mock('@/lib/api/server', () => ({
  getPublicCatalog,
  getPublicCategories,
}));

import sitemap from './sitemap';

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const originalVercelEnv = process.env.VERCEL_ENV;

function makeCatalogPage(): CatalogPage {
  return {
    items: [
      {
        id: 'public-product',
        title: 'Personalised mug',
        slug: 'personalised-mug',
        primaryImage: null,
        category: null,
        productType: 'mug',
        startingPriceMinor: 1200,
        currency: 'GBP',
        availability: 'in_stock',
        isFeatured: false,
        customizationCues: [],
      },
    ],
    pagination: {
      page: 1,
      limit: 48,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
    },
    facets: {
      minPrice: null,
      maxPrice: null,
      productTypes: [],
      printTechniques: [],
      colors: [],
      sizes: [],
    },
  };
}

function makeCategory(
  slug: string,
  isActive: boolean,
  children: Category[] = [],
): Category {
  return {
    _id: slug,
    name: slug,
    slug,
    sortOrder: 0,
    productCount: 0,
    children,
    isActive,
  };
}

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
  if (originalVercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnv;
  }
  vi.clearAllMocks();
});

describe('sitemap', () => {
  it('does not publish URLs outside a configured production deployment', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://other.example';

    await expect(sitemap()).resolves.toEqual([]);
    expect(getPublicCatalog).not.toHaveBeenCalled();
  });

  it('includes public routes and excludes inactive categories', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://daintybloome.com';
    process.env.VERCEL_ENV = 'production';
    getPublicCategories.mockResolvedValue({
      data: [
        makeCategory('active-category', true),
        makeCategory('inactive-category', false),
      ],
      unavailable: false,
    });
    getPublicCatalog.mockResolvedValue({
      data: makeCatalogPage(),
      unavailable: false,
    });

    const urls = (await sitemap()).map((entry) => entry.url);
    const productCanonical = getProductCanonicalUrl(
      'personalised-mug',
      undefined,
      new URL('https://daintybloome.com'),
    );
    expect(urls).toContain(productCanonical);
    expect(urls).toContain('https://daintybloome.com/category/active-category');
    expect(urls).not.toContain(
      'https://daintybloome.com/category/inactive-category',
    );
    expect(
      urls.every((url) => url.startsWith('https://daintybloome.com/')),
    ).toBe(true);
  });

  it('logs a sanitized error and rejects unavailable catalogue data', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_SITE_URL = 'https://daintybloome.com';
    process.env.VERCEL_ENV = 'production';
    getPublicCategories.mockResolvedValue({ data: [], unavailable: false });
    getPublicCatalog.mockResolvedValue({
      data: null,
      unavailable: true,
      status: 503,
    });

    await expect(sitemap()).rejects.toThrow(
      'public catalogue source is unavailable',
    );
    expect(errorLog).toHaveBeenCalledWith('[seo] Sitemap source unavailable.', {
      resource: 'catalogue',
      status: 503,
    });
  });

  it('rejects a failed later page instead of returning a partial sitemap', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_SITE_URL = 'https://daintybloome.com';
    process.env.VERCEL_ENV = 'production';
    getPublicCategories.mockResolvedValue({ data: [], unavailable: false });
    const firstPage = makeCatalogPage();
    firstPage.items = Array.from({ length: 48 }, (_, index) => ({
      ...firstPage.items[0],
      id: `product-${index}`,
      slug: `product-${index}`,
    }));
    firstPage.pagination.total = 49;
    firstPage.pagination.totalPages = 2;
    firstPage.pagination.hasNextPage = true;
    getPublicCatalog.mockImplementation((query: string) =>
      query.includes('page=1')
        ? Promise.resolve({ data: firstPage, unavailable: false })
        : Promise.resolve({ data: null, unavailable: true, status: 503 }),
    );

    await expect(sitemap()).rejects.toThrow(
      'public catalogue source is unavailable',
    );
    expect(errorLog).toHaveBeenCalledWith('[seo] Sitemap source unavailable.', {
      resource: 'catalogue',
      status: 503,
    });
  });
});
