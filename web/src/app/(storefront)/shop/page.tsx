import type { Metadata } from 'next';
import { CatalogBrowse } from '@/components/catalog/CatalogBrowse';
import { getPublicCatalog, getPublicCategories } from '@/lib/api/server';
import { getCanonicalUrl } from '@/lib/siteUrl';

export const revalidate = 60;
const description =
  'Browse current products from Dainty Bloom and explore the options available for each item.';
const canonical = getCanonicalUrl('/shop');
export const metadata: Metadata = {
  title: 'Shop',
  description,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title: 'Shop Dainty Bloom',
    description,
    type: 'website',
    ...(canonical ? { url: canonical } : {}),
  },
  twitter: { card: 'summary', title: 'Shop Dainty Bloom', description },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTER_KEYS = [
  'q',
  'category',
  'productType',
  'printTechnique',
  'minPrice',
  'maxPrice',
  'color',
  'size',
  'inStock',
  'sort',
  'page',
] as const;

export default async function ShopPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;
  const initialQuery: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value) initialQuery[key] = value;
  }
  const queryString = new URLSearchParams(initialQuery).toString();
  const [catalogResult, categoriesResult] = await Promise.all([
    getPublicCatalog(queryString ? `?${queryString}` : ''),
    getPublicCategories(),
  ]);
  return (
    <CatalogBrowse
      initialData={catalogResult.data}
      categories={categoriesResult.data ?? []}
      initialQuery={initialQuery}
    />
  );
}
