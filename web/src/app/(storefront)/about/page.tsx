import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Palette, Sparkles } from 'lucide-react';
import { Suspense } from 'react';
import { AboutMediaGallery } from '@/components/about/AboutMediaGallery';
import { ProductLineIcon } from '@/components/catalog/CatalogComponents';
import { getPublicAboutMedia, getPublicSettings } from '@/lib/api/server';
import { getCanonicalUrl } from '@/lib/siteUrl';

const description =
  'Discover Dainty Bloom’s custom printing collections and creative ways to make selected pieces your own.';
const canonical = getCanonicalUrl('/about');
export const metadata: Metadata = {
  title: 'About',
  description,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title: 'About Dainty Bloom',
    description,
    type: 'website',
    ...(canonical ? { url: canonical } : {}),
  },
  twitter: { card: 'summary', title: 'About Dainty Bloom', description },
};

export default async function AboutPage() {
  const mediaResultPromise = getPublicAboutMedia();
  const result = await getPublicSettings();
  const settings = result.data;
  const productLines =
    settings?.productLines.filter((line) => line.isActive) ?? [];

  return (
    <div className="commerce-page about-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">About us</span>
      </nav>

      <section className="about-hero" aria-labelledby="about-title">
        <div className="about-hero__copy">
          <span className="eyebrow">A little about Dainty Bloom</span>
          <h1 id="about-title">Creative prints, made personal.</h1>
          <p>
            Dainty Bloom brings custom printing and creative projects together.
            Explore the current collections, find a piece to personalise where
            supported, or tell us about a custom product you have in mind.
          </p>
          <div className="button-row">
            <Link className="button button--primary button--lg" href="/shop">
              Explore the shop
            </Link>
            <Link
              className="button button--secondary button--lg"
              href="/custom-3d-request"
            >
              Request a custom product
            </Link>
          </div>
        </div>
        <div className="about-hero__visual">
          <span
            className="about-hero__shape about-hero__shape--mint"
            aria-hidden="true"
          />
          <span
            className="about-hero__shape about-hero__shape--peach"
            aria-hidden="true"
          />
          <div className="about-hero__art">
            <Image
              src="/images/dainty-bloom-logo.png"
              alt="Dainty Bloom floral monogram"
              width={640}
              height={426}
              sizes="(max-width: 600px) 72vw, (max-width: 900px) 40vw, 352px"
              loading="eager"
            />
          </div>
          <span className="about-hero__caption">
            <Sparkles size={16} aria-hidden="true" />
            Made to add a personal touch
          </span>
        </div>
      </section>

      {result.unavailable ? (
        <p className="about-data-note" role="status">
          Store details are temporarily unavailable. You can still explore the
          shop and its current product information.
        </p>
      ) : null}

      <section className="about-story" aria-labelledby="about-story-title">
        <div className="about-story__icon" aria-hidden="true">
          <Palette size={25} />
        </div>
        <div>
          <span className="eyebrow">Our approach</span>
          <h2 id="about-story-title">A space for thoughtful, creative finds</h2>
          <p>
            {settings?.aboutNote ||
              'Dainty Bloom is a custom printing store with a mix of printed products and creative projects. The collection and product pages share the options available for each item, so you can choose what suits your idea.'}
          </p>
        </div>
      </section>

      <Suspense fallback={<AboutMediaLoading />}>
        <AboutMediaGallery resultPromise={mediaResultPromise} />
      </Suspense>

      <section
        className="about-offerings"
        aria-labelledby="about-offerings-title"
      >
        <header className="about-section-heading">
          <span className="eyebrow">Explore the collections</span>
          <h2 id="about-offerings-title">What you’ll find</h2>
          <p>
            The available collections and descriptions are managed by the Dainty
            Bloom team.
          </p>
        </header>
        {productLines.length ? (
          <ul className="about-offerings__grid">
            {productLines.map((line) => (
              <li className="about-offering-card" key={line.key}>
                <span className="about-offering-card__icon" aria-hidden="true">
                  <ProductLineIcon value={`${line.key} ${line.label}`} />
                </span>
                <h3>{line.label}</h3>
                <p>{line.description}</p>
                <Link className="text-link" href="/shop">
                  Browse the shop <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p
            className="about-data-note"
            role={result.unavailable ? 'status' : 'note'}
          >
            {result.unavailable
              ? 'The current collections could not be loaded.'
              : 'Browse the shop to see the products currently available.'}
          </p>
        )}
      </section>

      <section
        className="about-experience"
        aria-labelledby="about-experience-title"
      >
        <div>
          <span className="eyebrow">Your creative journey</span>
          <h2 id="about-experience-title">
            Choose the details that feel right
          </h2>
          <p>
            Product pages explain the options available for each piece. Selected
            products support customer artwork uploads, while paint-it-yourself
            canvases are designed by the studio and do not require customer
            artwork.
          </p>
        </div>
        <Link className="text-link" href="/faq">
          Read frequently asked questions{' '}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <section className="about-cta" aria-labelledby="about-cta-title">
        <div>
          <span className="eyebrow">Ready to explore?</span>
          <h2 id="about-cta-title">Find a piece or start with an idea</h2>
          <p>
            Browse the current shop or tell us about a custom product you have
            in mind.
          </p>
        </div>
        <div className="button-row">
          <Link className="button button--primary" href="/shop">
            Visit the shop
          </Link>
          <Link className="button button--secondary" href="/custom-3d-request">
            Custom product request
          </Link>
        </div>
      </section>
    </div>
  );
}

function AboutMediaLoading() {
  return (
    <section
      className="about-media about-media--loading"
      aria-labelledby="about-media-loading-title"
      role="status"
    >
      <header className="about-section-heading">
        <span className="eyebrow">Inside Dainty Bloom</span>
        <h2 id="about-media-loading-title">Loading the creative collection…</h2>
      </header>
      <div className="about-media__loading-grid" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}
