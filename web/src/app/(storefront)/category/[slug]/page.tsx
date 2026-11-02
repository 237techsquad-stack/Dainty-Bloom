import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CatalogBrowse } from '@/components/catalog/CatalogBrowse';
import { ErrorStateCatalog } from '@/components/catalog/CatalogComponents';
import { CollectionHero } from '@/components/catalog/CollectionHero';
import {
  getPublicCatalog,
  getPublicCategories,
  getPublicCategory,
} from '@/lib/api/server';
import { getAbsoluteUrl, getConfiguredSiteUrl } from '@/lib/siteUrl';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicCategory(slug);
  if (!result.data) {
    return {
      title: 'Category unavailable',
      robots: { index: false, follow: false },
    };
  }
  const siteUrl = getConfiguredSiteUrl();
  const description =
    result.data.description ||
    `Browse ${result.data.name} in the Dainty Bloom shop and explore the available products.`;
  const canonical = getAbsoluteUrl(
    result.data.slug
      ? `/category/${encodeURIComponent(result.data.slug)}`
      : `/category/${encodeURIComponent(slug)}`,
    siteUrl,
  );
  return {
    title: result.data.name,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title: result.data.name,
      description,
      type: 'website',
      ...(canonical ? { url: canonical } : {}),
    },
    twitter: { card: 'summary', title: result.data.name, description },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const initialQuery: Record<string, string> = {};
  for (const key of [
    'q',
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
  const catalogQuery = { ...initialQuery, category: slug };
  const queryString = new URLSearchParams(catalogQuery).toString();
  const [categoryResult, catalogResult, categoriesResult] = await Promise.all([
    getPublicCategory(slug),
    getPublicCatalog(`?${queryString}`),
    getPublicCategories(),
  ]);
  if (!categoryResult.data && categoryResult.status === 404) notFound();
  if (!categoryResult.data)
    return (
      <div className="container catalog-error-page">
        <ErrorStateCatalog title="This category could not be loaded" />
      </div>
    );
  return (
    <CatalogBrowse
      initialData={catalogResult.data}
      category={categoryResult.data}
      categories={categoriesResult.data ?? []}
      initialQuery={initialQuery}
      customBanner={
        <>
          {categoryResult.data.slug === 'lamps-and-lighting' ? (
            <CollectionHero
              imageSrc="/images/Lamp%20%26%20Lighting.png"
              imageAlt="A lamp from the Dainty Bloom lighting collection"
              title="How our lamps come together"
              description="Each lamp begins with 3D-printed components, then is assembled with its lamp parts and cables."
            />
          ) : null}
          {slug.toLowerCase().includes('3d') ? (
            <section className="custom-request-banner custom-request-banner--category">
              <div>
                <h2>Have a custom product in mind?</h2>
                <p>
                  Tell us what you&apos;d love us to make. We&apos;ll review
                  your idea and get back to you about a quote.
                </p>
              </div>
              <Link
                className="button button--primary"
                href="/custom-3d-request"
              >
                Request a custom product
              </Link>
            </section>
          ) : null}
        </>
      }
    />
  );
}
