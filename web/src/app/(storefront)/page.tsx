import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  PackageCheck,
  PencilRuler,
  Sparkles,
} from 'lucide-react';
import {
  EmptyStateCatalog,
  ErrorStateCatalog,
  ProductCard,
  ProductGrid,
  ProductLineIcon,
} from '@/components/catalog/CatalogComponents';
import {
  getPublicCatalog,
  getPublicFaqs,
  getPublicFeaturedProducts,
  getPublicNewProducts,
  getPublicSettings,
  getPublicCategories,
} from '@/lib/api/server';
import { PRODUCT_THEMES } from '@/lib/productThemes';
import type { CatalogCard, Category } from '@/lib/api/types';
import { getCanonicalUrl } from '@/lib/siteUrl';
import { getProductImageAlt } from '@/lib/productImageAlt';

export const revalidate = 60;
const canonical = getCanonicalUrl('/');
const FEATURED_CATEGORY_SLUGS = [
  't-shirts',
  'mugs',
  'paint-it-yourself-canvas',
  'toys',
  'home-decor',
  'lamps-and-lighting',
] as const;
const HOME_RAIL_PRODUCT_LIMIT = 4;
const THEME_PREVIEW_LIMIT = 1;

const homeTitle = 'Custom Printing & Personalised Gifts';
const homeDescription =
  'Create something personal with custom-printed clothing, gifts and homeware from Dainty Bloom. Explore products made to your specifications.';

export const metadata: Metadata = {
  title: homeTitle,
  description: homeDescription,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title: `${homeTitle} | Dainty Bloom`,
    description: homeDescription,
    type: 'website',
    ...(canonical ? { url: canonical } : {}),
  },
  twitter: {
    card: 'summary',
    title: `${homeTitle} | Dainty Bloom`,
    description: homeDescription,
  },
};

function flattenCategories(categories: Category[]): Category[] {
  return categories.flatMap((category) => [
    category,
    ...flattenCategories(category.children ?? []),
  ]);
}

function HomeProductGrid({
  products,
  label,
}: {
  products: CatalogCard[];
  label: string;
}) {
  return (
    <ul className="home-product-grid" aria-label={label}>
      {products.map((product) => (
        <li className="home-product-grid__item" key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}

export default async function HomePage() {
  const [
    settingsResult,
    categoriesResult,
    featuredResult,
    newResult,
    allResult,
    faqResult,
    themeResults,
    threeDResult,
    canvasResult,
  ] = await Promise.all([
    getPublicSettings(),
    getPublicCategories(),
    getPublicFeaturedProducts(8),
    getPublicNewProducts(8),
    getPublicCatalog('?limit=1'),
    getPublicFaqs(),
    Promise.all(
      PRODUCT_THEMES.map(async (theme) => {
        const query = new URLSearchParams({
          theme: theme.slug,
          limit: String(THEME_PREVIEW_LIMIT),
        });
        const result = await getPublicCatalog(`?${query.toString()}`);
        return { theme, result };
      }),
    ),
    getPublicCatalog(
      `?productType=three_d_printed&limit=${HOME_RAIL_PRODUCT_LIMIT}`,
    ),
    getPublicCatalog(
      `?productType=canvas_paint_yourself&limit=${HOME_RAIL_PRODUCT_LIMIT}`,
    ),
  ]);

  const settings = settingsResult.data;
  const categories = categoriesResult.data ?? [];
  const featured = featuredResult.data?.items ?? [];
  const featuredIds = new Set(featured.map(({ id }) => id));
  const newProducts = (newResult.data?.items ?? []).filter(
    ({ id }) => !featuredIds.has(id),
  );
  const hasProducts = (allResult.data?.pagination.total ?? 0) > 0;
  const flatCategories = flattenCategories(categories);
  const categoriesBySlug = new Map(
    flatCategories.map((category) => [category.slug, category]),
  );
  const featuredCategories = categoriesResult.data
    ? FEATURED_CATEGORY_SLUGS.flatMap((slug) => {
        const category = categoriesBySlug.get(slug);
        return category &&
          category.children.length === 0 &&
          category.productCount > 0
          ? [category]
          : [];
      })
    : [];
  const availableThemes = themeResults.flatMap(({ theme, result }) =>
    result.data && result.data.pagination.total > 0
      ? [{ theme, product: result.data.items[0] }]
      : [],
  );
  const threeDProducts = threeDResult.data?.items ?? [];
  const canvasProducts = canvasResult.data?.items ?? [];
  const productLines = (settings?.productLines ?? []).filter(
    (line) => line.isActive,
  );
  const faqs = faqResult.data?.categories ?? [];

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-hero__inner container">
          <div className="home-hero__copy">
            <span className="eyebrow">Made personal, made with care</span>
            <h1>Bring your ideas to life</h1>
            {settings?.aboutNote ? <p>{settings.aboutNote}</p> : null}
            <div className="button-row">
              <Link className="button button--primary button--lg" href="/shop">
                Shop now
              </Link>
              <Link
                className="button button--secondary button--lg"
                href="/custom-3d-request"
              >
                Request a custom product
              </Link>
            </div>
          </div>
          <div className="home-hero__visual">
            <Image
              className="home-hero__image"
              src="/images/Home%20Hero.png"
              alt="Dainty Bloom custom printing and creative products"
              width={1536}
              height={1024}
              sizes="(max-width: 767px) calc(100vw - 2rem), (max-width: 1200px) 45vw, 510px"
              priority
            />
          </div>
        </div>
      </section>
      {settingsResult.unavailable ? (
        <div className="container home-data-warning" role="status">
          Store information could not be loaded from the shop API.
        </div>
      ) : null}

      {productLines.length ? (
        <section
          className="home-section container"
          aria-labelledby="product-lines-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">Made to suit you</span>
              <h2 id="product-lines-title">What we make</h2>
            </div>
          </div>
          <div className="product-lines-grid">
            {productLines.map((line) => {
              const lineKey = line.key.toLowerCase().replaceAll('_', '-');
              const category = flatCategories.find((item) =>
                item.slug.toLowerCase().includes(lineKey),
              );
              return (
                <Link
                  className="product-line-card"
                  href={category ? `/category/${category.slug}` : '/shop'}
                  key={line.key}
                >
                  <span className="product-line-card__icon">
                    <ProductLineIcon value={`${line.key} ${line.label}`} />
                  </span>
                  <h3>{line.label}</h3>
                  <p>{line.description}</p>
                  <span className="text-link">
                    Explore <ArrowRight aria-hidden="true" size={16} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {featuredCategories.length ? (
        <section
          className="home-section container"
          aria-labelledby="featured-categories-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">Browse the collections</span>
              <h2 id="featured-categories-title">Featured Categories</h2>
            </div>
            <Link className="text-link" href="/shop">
              All categories <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
          <ul
            className="home-rail home-rail--categories"
            aria-label="Featured categories"
          >
            {featuredCategories.map((category) => (
              <li className="home-rail__item" key={category._id}>
                <Link
                  className="category-card home-category-card"
                  href={`/category/${encodeURIComponent(category.slug)}`}
                >
                  <span className="home-category-card__icon" aria-hidden="true">
                    <ProductLineIcon
                      value={`${category.name} ${category.formProfile ?? ''}`}
                    />
                  </span>
                  <h3>{category.name}</h3>
                  {category.description ? <p>{category.description}</p> : null}
                  <span className="text-link">
                    Explore collection{' '}
                    <ArrowRight aria-hidden="true" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {availableThemes.length ? (
        <section
          className="home-section container"
          aria-labelledby="explore-themes-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">Find something for the moment</span>
              <h2 id="explore-themes-title">Explore by Theme</h2>
            </div>
            <Link className="text-link" href="/themes">
              All themes <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
          <ul
            className="home-rail home-rail--themes"
            aria-label="Shop by theme"
          >
            {availableThemes.map(({ theme, product }) => (
              <li className="home-rail__item" key={theme.slug}>
                <article className="theme-card">
                  <Link
                    className="theme-card__link"
                    href={`/themes/${theme.slug}`}
                    aria-label={`Shop the ${theme.name} theme`}
                  >
                    <div className="theme-card__image">
                      {product?.primaryImage ? (
                        <Image
                          src={
                            product.primaryImage.variants.large ||
                            product.primaryImage.url
                          }
                          alt={getProductImageAlt(
                            product.title,
                            product.primaryImage.alt,
                          )}
                          fill
                          sizes="(max-width: 600px) 82vw, (max-width: 1023px) 44vw, 30vw"
                        />
                      ) : (
                        <div
                          className="theme-card__image-empty"
                          aria-hidden="true"
                        >
                          <Sparkles />
                        </div>
                      )}
                    </div>
                    <div className="theme-card__body">
                      <h3>{theme.name}</h3>
                      <p>{theme.description}</p>
                      <span className="theme-card__action">
                        Shop this theme
                      </span>
                    </div>
                  </Link>
                </article>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {threeDProducts.length ? (
        <section
          className="home-section container"
          aria-labelledby="three-d-products-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">Made layer by layer</span>
              <h2 id="three-d-products-title">3D Printed Products</h2>
            </div>
            <Link
              className="text-link"
              href="/shop?productType=three_d_printed"
            >
              View all <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
          <HomeProductGrid
            products={threeDProducts}
            label="3D printed products"
          />
        </section>
      ) : null}

      {canvasProducts.length ? (
        <section
          className="home-section container"
          aria-labelledby="paint-canvas-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                A creative project to make your own
              </span>
              <h2 id="paint-canvas-title">Paint-It-Yourself Canvas</h2>
            </div>
            <Link
              className="text-link"
              href="/shop?productType=canvas_paint_yourself"
            >
              View all <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
          <HomeProductGrid
            products={canvasProducts}
            label="Paint-it-yourself canvas products"
          />
        </section>
      ) : null}

      {allResult.unavailable ? (
        <section className="home-section container">
          <ErrorStateCatalog title="Products are unavailable" />
        </section>
      ) : !hasProducts ? (
        <section className="home-section container">
          <EmptyStateCatalog
            title="Our shop is being stocked. Please check back soon."
            variant="plain"
          />
        </section>
      ) : (
        <>
          {featuredResult.unavailable ? (
            <section className="home-section container">
              <ErrorStateCatalog title="Featured products are unavailable" />
            </section>
          ) : featured.length ? (
            <section
              className="home-section container"
              aria-labelledby="featured-title"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Selected for you</span>
                  <h2 id="featured-title">Featured products</h2>
                </div>
                <Link className="text-link" href="/shop">
                  View all <ArrowRight aria-hidden="true" size={16} />
                </Link>
              </div>
              <ProductGrid products={featured} />
            </section>
          ) : null}
          {newResult.unavailable ? (
            <section className="home-section container">
              <ErrorStateCatalog title="New arrivals are unavailable" />
            </section>
          ) : newProducts.length ? (
            <section
              className="home-section container"
              aria-labelledby="new-title"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Fresh from the studio</span>
                  <h2 id="new-title">New arrivals</h2>
                </div>
                <Link className="text-link" href="/shop">
                  View all <ArrowRight aria-hidden="true" size={16} />
                </Link>
              </div>
              <ProductGrid products={newProducts} />
            </section>
          ) : null}
        </>
      )}

      <section className="home-section container">
        <div className="custom-request-banner">
          <div>
            <span className="eyebrow">ONE-OF-A-KIND CREATIONS</span>
            <h2>Have something special in mind?</h2>
            <p>
              Tell us what you&apos;d love us to create. Share your design or a
              reference image, describe what you have in mind, and we&apos;ll
              get back to you with a quote.
            </p>
          </div>
          <Link className="button button--primary" href="/custom-3d-request">
            Request a Product
          </Link>
        </div>
      </section>

      <section className="home-section container" aria-labelledby="how-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">From idea to finished piece</span>
            <h2 id="how-title">How it works</h2>
          </div>
        </div>
        <ol className="how-it-works">
          {[
            { label: 'Choose a product', Icon: PackageCheck },
            {
              label: 'Pick your options or upload your artwork',
              Icon: PencilRuler,
            },
            { label: 'We check your proof', Icon: ClipboardCheck },
            { label: 'We make it and send it', Icon: Check },
          ].map(({ label, Icon }, index) => (
            <li key={label}>
              <span className="how-it-works__icon">
                <Icon aria-hidden="true" />
              </span>
              <span className="how-it-works__number">0{index + 1}</span>
              <h3>{label}</h3>
            </li>
          ))}
        </ol>
        <p className="home-note">
          Delivery time and cost are shown at checkout.
        </p>
      </section>

      {faqResult.unavailable ? (
        <section className="home-section container">
          <ErrorStateCatalog title="Frequently asked questions are unavailable" />
        </section>
      ) : faqs.length ? (
        <section
          className="home-section container faq-section"
          aria-labelledby="faq-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">A few helpful details</span>
              <h2 id="faq-title">Frequently asked questions</h2>
            </div>
            <Link className="text-link" href="/faq">
              View all FAQs <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
          {faqs.map((group) => (
            <section className="faq-group" key={group.category}>
              <h3>{group.category}</h3>
              <div className="faq-list">
                {group.items.map((faq) => (
                  <details className="faq-item" key={faq.id}>
                    <summary>{faq.question}</summary>
                    <p>{faq.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </section>
      ) : null}
    </div>
  );
}
