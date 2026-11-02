import 'server-only';

import { cache } from 'react';
import type {
  ApiSuccess,
  CategoriesResponse,
  Category,
  SiteSettings,
  CatalogPage,
  PublicFaqs,
  PublicAboutMedia,
  PublicProduct,
} from './types';
import { normalizeCategoryList } from './normalizers';
import { buildApiEndpoint } from '../apiUrl';

export interface PublicResult<T> {
  data: T | null;
  unavailable: boolean;
  status?: number;
}

export async function fetchPublic<T>(
  path: string,
  options: { cache?: 'revalidate' | 'no-store' } = {},
): Promise<PublicResult<T>> {
  const endpoint = buildApiEndpoint(path);
  try {
    const response = await fetch(endpoint, {
      ...(options.cache === 'no-store'
        ? { cache: 'no-store' as const }
        : { cache: 'force-cache' as const, next: { revalidate: 60 } }),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok)
      return { data: null, unavailable: true, status: response.status };
    const payload: unknown = await response.json();
    if (!isSuccessEnvelope<T>(payload))
      return { data: null, unavailable: true, status: response.status };
    const envelope = payload;
    return { data: envelope.data, unavailable: false, status: response.status };
  } catch {
    return { data: null, unavailable: true };
  }
}

function isSuccessEnvelope<T>(value: unknown): value is ApiSuccess<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === true &&
    'data' in value
  );
}

export const getPublicSettings = cache(() =>
  fetchPublic<SiteSettings>('/settings/public'),
);

export const getPublicCatalog = cache((query = '') =>
  fetchPublic<CatalogPage>(`/products${query}`),
);

export const getPublicFeaturedProducts = cache((limit = 12) =>
  fetchPublic<CatalogPage>(`/products/featured?limit=${limit}`),
);

export const getPublicNewProducts = cache((limit = 12) =>
  fetchPublic<CatalogPage>(`/products/new?limit=${limit}`),
);

export const getPublicCategory = cache(async (slug: string) => {
  const result = await fetchPublic<{ category: Category }>(
    `/categories/${encodeURIComponent(slug)}`,
  );
  return {
    data: result.data?.category ?? null,
    unavailable: result.unavailable || !result.data?.category,
    status: result.status,
  };
});

export const getPublicProduct = cache(async (slug: string) => {
  const result = await fetchPublic<{ product: PublicProduct }>(
    `/products/${encodeURIComponent(slug)}`,
  );
  if (result.data?.product && result.data.product.slug !== slug) {
    return { ...result, data: null, unavailable: true };
  }
  return {
    data: result.data?.product ?? null,
    unavailable: result.unavailable || !result.data?.product,
    status: result.status,
  };
});

export const getPublicFaqs = cache(() => fetchPublic<PublicFaqs>('/faqs'));

export const getPublicAboutMedia = cache(
  async (): Promise<PublicResult<PublicAboutMedia[]>> => {
    const result = await fetchPublic<{ media: PublicAboutMedia[] }>(
      '/about/media',
      { cache: 'no-store' },
    );
    if (
      result.unavailable ||
      !result.data ||
      !Array.isArray(result.data.media)
    ) {
      return { data: null, unavailable: true, status: result.status };
    }
    return {
      data: result.data.media,
      unavailable: false,
      status: result.status,
    };
  },
);

export const getPublicCategories = cache(
  async (): Promise<PublicResult<Category[]>> => {
    const result = await fetchPublic<CategoriesResponse>('/categories');
    const payload = result.data;
    if (result.unavailable || !payload || !Array.isArray(payload.categories)) {
      return { data: null, unavailable: true };
    }
    return {
      data: normalizeCategoryList(payload.categories),
      unavailable: false,
    };
  },
);
