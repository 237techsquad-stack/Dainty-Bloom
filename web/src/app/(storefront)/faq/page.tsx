import type { Metadata } from 'next';
import Link from 'next/link';
import { FaqAccordion } from '@/components/faq/FaqAccordion';
import { getPublicFaqs } from '@/lib/api/server';
import { getCanonicalUrl } from '@/lib/siteUrl';

const description =
  'Find answers to common questions about shopping with Dainty Bloom.';
const canonical = getCanonicalUrl('/faq');
export const metadata: Metadata = {
  title: 'Frequently Asked Questions',
  description,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title: 'Frequently Asked Questions | Dainty Bloom',
    description,
    type: 'website',
    ...(canonical ? { url: canonical } : {}),
  },
  twitter: {
    card: 'summary',
    title: 'Frequently Asked Questions | Dainty Bloom',
    description,
  },
};

export const revalidate = 60;

export default async function FaqPage() {
  const result = await getPublicFaqs();
  const categories = result.data?.categories ?? [];
  const hasQuestions = categories.some((category) => category.items.length > 0);

  return (
    <div className="commerce-page faq-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">FAQ</span>
      </nav>

      <header className="faq-page__heading">
        <span className="eyebrow">A few helpful details</span>
        <h1>Frequently asked questions</h1>
        <p>
          Browse answers to common questions. The information below is managed
          by the Dainty Bloom team.
        </p>
      </header>

      {result.unavailable ? (
        <section
          className="commerce-alert commerce-alert--error faq-page__state"
          role="alert"
        >
          <div>
            <h2>Questions are temporarily unavailable</h2>
            <p>
              We could not load the FAQ content right now. For a general
              enquiry, please use our contact page.
            </p>
            <Link className="button button--secondary" href="/contact">
              Contact us
            </Link>
          </div>
        </section>
      ) : hasQuestions ? (
        <>
          <FaqAccordion categories={categories} />
          <div className="faq-page__contact">
            <p>Didn’t find the information you need?</p>
            <Link className="text-link" href="/contact">
              Send us a general enquiry
            </Link>
          </div>
        </>
      ) : (
        <section className="commerce-card faq-page__state" role="status">
          <h2>No published questions are available</h2>
          <p>You can send a general enquiry through our contact page.</p>
          <Link className="button button--secondary" href="/contact">
            Contact us
          </Link>
        </section>
      )}
    </div>
  );
}
