import type { Metadata } from 'next';
import Link from 'next/link';
import { CustomProductRequestForm } from '@/components/contact/Custom3DRequestForm';
import { getPublicSettings } from '@/lib/api/server';
import { getCanonicalUrl } from '@/lib/siteUrl';

const description =
  'Tell us about a custom product you would love us to make. Requests are reviewed for availability, pricing, and production feasibility.';
const canonical = getCanonicalUrl('/custom-3d-request');
export const metadata: Metadata = {
  title: 'Request a Custom Product',
  description,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title: 'Request a Custom Product | Dainty Bloom',
    description,
    type: 'website',
    ...(canonical ? { url: canonical } : {}),
  },
  twitter: {
    card: 'summary',
    title: 'Request a Custom Product | Dainty Bloom',
    description,
  },
};

export default async function Custom3DRequestPage() {
  const settingsResult = await getPublicSettings();
  const maxUploadBytes = settingsResult.data?.artwork.maxBytes ?? null;

  return (
    <div className="commerce-page custom-3d-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Custom product request</span>
      </nav>

      <header className="custom-3d-page__heading">
        <span className="eyebrow">Made to your idea</span>
        <h1>Request a Custom Product</h1>
        <p>
          Have an idea for something you&apos;d love us to make? Tell us about
          it. You can upload your own design, share an image for inspiration,
          or describe your idea in your own words. We&apos;ll review your
          request and contact you about availability, pricing, and the next
          steps.
        </p>
      </header>

      <CustomProductRequestForm maxUploadBytes={maxUploadBytes} />

      <nav className="custom-3d-page__links" aria-label="More options">
        <Link className="text-link" href="/shop">
          Browse the shop
        </Link>
        <Link className="text-link" href="/contact">
          General enquiries
        </Link>
      </nav>
    </div>
  );
}
