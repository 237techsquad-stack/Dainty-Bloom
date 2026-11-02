import type { MetadataRoute } from 'next';
import {
  getPublicCatalog,
  getPublicCategories,
  type PublicResult,
} from '@/lib/api/server';
import { PRODUCT_THEMES } from '@/lib/productThemes';
import type { CatalogPage, Category } from '@/lib/api/types';
import {
  getConfiguredSiteUrl,
  getProductCanonicalUrl,
  isProductionIndexingEnabled,
} from '@/lib/siteUrl';

export const dynamic = 'force-dynamic';

function flattenCategories(categories: Category[]): Category[] {
  return categories.flatMap((category) =>
    category.isActive === false
      ? flattenCategories(category.children ?? [])
      : [category, ...flattenCategories(category.children ?? [])],
  );
}

function requireData<T>(result: PublicResult<T>, resource: string): T {
  if (result.unavailable || result.data == null) {
    console.error('[seo] Sitemap source unavailable.', {
      resource,
      ...(result.status ? { status: result.status } : {}),
    });
    throw new Error(
      `Unable to generate sitemap because the public ${resource} source is unavailable.`,
    );
  }
  return result.data;
}

function invalidCatalogData(reason: string): never {
  console.error('[seo] Sitemap catalogue data is incomplete or invalid.', {
    reason,
  });
  throw new Error(
    'Unable to generate sitemap because public catalogue data is incomplete or invalid.',
  );
}

function requireCatalogPage(
  result: PublicResult<CatalogPage>,
  expectedPage: number,
) {
  const page = requireData(result, 'catalogue');
  if (!Array.isArray(page.items) || !page.pagination) {
    return invalidCatalogData('missing items or pagination');
  }

  const pagination = page.pagination;
  if (
    !Number.isInteger(pagination.page) ||
    !Number.isInteger(pagination.limit) ||
    pagination.limit < 1 ||
    !Number.isInteger(pagination.total) ||
    pagination.total < 0 ||
    !Number.isInteger(pagination.totalPages) ||
    pagination.totalPages !== Math.ceil(pagination.total / pagination.limit) ||
    pagination.page !== expectedPage ||
    pagination.hasNextPage !== expectedPage < pagination.totalPages
  ) {
    return invalidCatalogData('inconsistent pagination');
  }

  if (
    page.items.some(
      (product) =>
        !product ||
        typeof product.slug !== 'string' ||
        product.slug.trim().length === 0,
    )
  ) {
    return invalidCatalogData('product without a valid slug');
  }

  return page;
}

function productCanonicalUrl(slug: string, siteUrl: URL): string {
  const canonicalUrl = getProductCanonicalUrl(slug, undefined, siteUrl);
  if (!canonicalUrl) {
    throw new Error('Unable to generate sitemap without a canonical origin.');
  }
  return canonicalUrl;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isProductionIndexingEnabled()) return [];

  const siteUrl = getConfiguredSiteUrl();
  if (!siteUrl) return [];

  const [categoryResult, firstPage] = await Promise.all([
    getPublicCategories(),
    getPublicCatalog('?page=1&limit=48'),
  ]);
  const categoriesData = requireData(categoryResult, 'categories');
  const firstCatalogPage = requireCatalogPage(firstPage, 1);
  const catalogPages = firstCatalogPage.pagination.totalPages;
  const productPages = [];
  for (let start = 2; start <= catalogPages; start += 5) {
    const pageNumbers = Array.from(
      { length: Math.min(5, catalogPages - start + 1) },
      (_, index) => start + index,
    );
    const batch = await Promise.all(
      pageNumbers.map((page) => getPublicCatalog(`?page=${page}&limit=48`)),
    );
    productPages.push(
      ...batch.map((result, index) =>
        requireCatalogPage(result, pageNumbers[index]),
      ),
    );
  }
  const products = [
    ...firstCatalogPage.items,
    ...productPages.flatMap((page) => page.items),
  ];
  if (
    products.length !== firstCatalogPage.pagination.total ||
    productPages.some(
      (page) =>
        page.pagination.total !== firstCatalogPage.pagination.total ||
        page.pagination.totalPages !== catalogPages ||
        page.pagination.limit !== firstCatalogPage.pagination.limit,
    )
  ) {
    invalidCatalogData('catalogue changed while pages were being collected');
  }
  const productSlugs = new Set(products.map((product) => product.slug));
  if (productSlugs.size !== products.length) {
    invalidCatalogData('duplicate product slugs across catalogue pages');
  }
  const categories = flattenCategories(categoriesData);
  const urls: MetadataRoute.Sitemap = [
    {
      url: new URL('/', siteUrl).toString(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: new URL('/shop', siteUrl).toString(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: new URL('/themes', siteUrl).toString(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    ...PRODUCT_THEMES.map((theme) => ({
      url: new URL(`/themes/${theme.slug}`, siteUrl).toString(),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    {
      url: new URL('/about', siteUrl).toString(),
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: new URL('/contact', siteUrl).toString(),
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: new URL('/faq', siteUrl).toString(),
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: new URL('/custom-3d-request', siteUrl).toString(),
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    ...categories.map((category) => ({
      url: new URL(
        `/category/${encodeURIComponent(category.slug)}`,
        siteUrl,
      ).toString(),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...products.map((product) => ({
      url: productCanonicalUrl(product.slug, siteUrl),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
  return [...new Map(urls.map((entry) => [entry.url, entry])).values()];
}
