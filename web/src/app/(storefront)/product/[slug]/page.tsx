import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ErrorStateCatalog } from '@/components/catalog/CatalogComponents';
import { ProductDetailClient } from '@/components/catalog/ProductDetailClient';
import { getPublicProduct } from '@/lib/api/server';
import type { PublicProduct } from '@/lib/api/types';
import { getPublicSettings } from '@/lib/api/server';
import {
  getAbsoluteUrl,
  getConfiguredSiteUrl,
  getProductCanonicalUrl,
} from '@/lib/siteUrl';
import { minorToMajor } from '@/lib/utils/formatMoney';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicProduct(slug);
  const product = result.data;
  if (!product) {
    return {
      title: 'Product unavailable',
      robots: { index: false, follow: false },
    };
  }
  const siteUrl = getConfiguredSiteUrl();
  const image = primaryImage(product);
  const imageUrl = image ? getAbsoluteUrl(image, siteUrl) : undefined;
  const canonical = getProductCanonicalUrl(
    product.slug,
    product.seo.canonicalUrl,
    siteUrl,
  );
  const title = product.seo.metaTitle || product.title;
  const description = product.seo.metaDescription || product.description;
  return {
    title,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title,
      description,
      type: 'website',
      ...(canonical ? { url: canonical } : {}),
      ...(imageUrl ? { images: [{ url: imageUrl }] } : {}),
    },
    twitter: {
      card: imageUrl ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  const [result, settingsResult] = await Promise.all([
    getPublicProduct(slug),
    getPublicSettings(),
  ]);
  if (!result.data && result.status === 404) notFound();
  if (!result.data) {
    return (
      <div className="container catalog-error-page">
        <ErrorStateCatalog title="This product could not be loaded" />
      </div>
    );
  }
  const product = result.data;
  const jsonLd = productJsonLd(product, getConfiguredSiteUrl());
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <ProductDetailClient
        product={product}
        initialSettings={settingsResult.data}
      />
    </>
  );
}

function primaryImage(product: PublicProduct): string | undefined {
  const image =
    product.media.find((item) => item.isPrimary) ?? product.media[0];
  return image?.variants?.large ?? image?.url;
}

function productJsonLd(product: PublicProduct, siteUrl?: URL) {
  const hasVariablePricing =
    product.optionGroups.some((group) =>
      group.values.some((option) => option.priceModifierMinor !== 0),
    ) || product.quantityPricing.length > 0;
  const hasReliableOffer =
    !hasVariablePricing && product.availability !== 'made_to_order';
  const stockAvailability: Record<PublicProduct['availability'], string> = {
    in_stock: 'https://schema.org/InStock',
    low_stock: 'https://schema.org/LimitedAvailability',
    out_of_stock: 'https://schema.org/OutOfStock',
    made_to_order: 'https://schema.org/PreOrder',
  };
  const productUrl = siteUrl
    ? new URL(
        `/product/${encodeURIComponent(product.slug)}`,
        siteUrl,
      ).toString()
    : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description,
    sku: product.sku,
    image: product.media.map((image) => image.variants?.large ?? image.url),
    ...(hasReliableOffer
      ? {
          offers: {
            '@type': 'Offer',
            priceCurrency: product.currency,
            price: minorToMajor(product.basePriceMinor, product.currency),
            availability: stockAvailability[product.availability],
            ...(productUrl ? { url: productUrl } : {}),
          },
        }
      : {}),
    ...(product.reviewSummary.count > 0 &&
    product.reviewSummary.average !== null
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.reviewSummary.average,
            reviewCount: product.reviewSummary.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}
