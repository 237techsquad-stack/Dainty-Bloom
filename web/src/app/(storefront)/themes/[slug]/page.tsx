import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CatalogBrowse } from '@/components/catalog/CatalogBrowse';
import { CollectionHero } from '@/components/catalog/CollectionHero';
import { getPublicCatalog, getPublicCategories } from '@/lib/api/server';
import { getProductTheme } from '@/lib/productThemes';
import { getCanonicalUrl } from '@/lib/siteUrl';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const theme = getProductTheme(slug);
  if (!theme) notFound();

  const description = `Browse Dainty Bloom products in the ${theme.name} collection.`;
  const canonical = getCanonicalUrl(`/themes/${theme.slug}`);
  return {
    title: theme.name,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title: `${theme.name} | Dainty Bloom`,
      description,
      type: 'website',
      ...(canonical ? { url: canonical } : {}),
    },
    twitter: { card: 'summary', title: theme.name, description },
  };
}

export default async function ThemePage({ params, searchParams }: PageProps) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const theme = getProductTheme(slug);
  if (!theme) notFound();

  const initialQuery: Record<string, string> = {};
  for (const key of [
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
  ]) {
    const value = raw[key];
    if (typeof value === 'string' && value) initialQuery[key] = value;
  }

  const query = new URLSearchParams({ ...initialQuery, theme: theme.slug });
  const [catalogResult, categoriesResult] = await Promise.all([
    getPublicCatalog(`?${query.toString()}`),
    getPublicCategories(),
  ]);

  return (
    <CatalogBrowse
      initialData={catalogResult.data}
      categories={categoriesResult.data ?? []}
      initialQuery={initialQuery}
      theme={theme.slug}
      customBanner={
        theme.slug === 'christmas' ? (
          <CollectionHero
            imageSrc="/images/Christmas%20Theme.png"
            imageAlt="Christmas-themed products from Dainty Bloom"
            title="A little creativity for Christmas"
            description="Explore a festive mix that may include 3D-printed decorations, paint-yourself canvases, and other Christmas-themed products."
          />
        ) : null
      }
    />
  );
}
