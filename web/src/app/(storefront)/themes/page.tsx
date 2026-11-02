import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { getPublicCatalog } from '@/lib/api/server';
import { PRODUCT_THEMES } from '@/lib/productThemes';
import { getCanonicalUrl } from '@/lib/siteUrl';
import { getProductImageAlt } from '@/lib/productImageAlt';

const description =
  'Explore creative finds across Christmas, Halloween, Autumn / Fall, Kids, and Anime collections at Dainty Bloom.';
const canonical = getCanonicalUrl('/themes');

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Themes',
  description,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title: 'Themes | Dainty Bloom',
    description,
    type: 'website',
    ...(canonical ? { url: canonical } : {}),
  },
  twitter: { card: 'summary', title: 'Themes | Dainty Bloom', description },
};

export default async function ThemesPage() {
  const collections = await Promise.all(
    PRODUCT_THEMES.map(async (theme) => {
      const query = new URLSearchParams({ theme: theme.slug, limit: '12' });
      const result = await getPublicCatalog(`?${query.toString()}`);
      return { theme, catalog: result.data };
    }),
  );

  return (
    <div className="themes-page container">
      <header className="themes-intro">
        <p className="eyebrow">Dainty Bloom collections</p>
        <h1 id="themes-title">Find your kind of lovely</h1>
        <p>
          Browse thoughtful finds by the moments, moods, and stories that
          inspire them. Each collection brings together products from across the
          shop.
        </p>
      </header>
      <section aria-labelledby="themes-title" className="themes-grid">
        {collections.map(({ theme, catalog }) => {
          const product =
            catalog?.items.find((item) => item.primaryImage) ??
            catalog?.items[0];
          const image = product?.primaryImage;
          return (
            <article className="theme-card" key={theme.slug}>
              <Link
                className="theme-card__link"
                href={`/themes/${theme.slug}`}
                aria-label={`Shop the ${theme.name} theme`}
              >
                <div className="theme-card__image">
                  {image ? (
                    <Image
                      src={image.variants.large || image.url}
                      alt={getProductImageAlt(
                        product?.title ?? theme.name,
                        image.alt,
                      )}
                      fill
                      sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 33vw"
                    />
                  ) : (
                    <div className="theme-card__image-empty" aria-hidden="true">
                      <Sparkles />
                    </div>
                  )}
                </div>
                <div className="theme-card__body">
                  <h2>{theme.name}</h2>
                  <p>{theme.description}</p>
                  <span className="theme-card__action">Shop this theme</span>
                </div>
              </Link>
            </article>
          );
        })}
      </section>
      <div className="themes-shop-link">
        <Link className="button button--secondary button--md" href="/shop">
          Browse all products
        </Link>
      </div>
    </div>
  );
}
