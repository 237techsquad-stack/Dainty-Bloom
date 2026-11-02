import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock3, Mail, MapPin, Phone } from 'lucide-react';
import { ContactForm } from '@/components/contact/ContactForm';
import { getPublicSettings } from '@/lib/api/server';
import { getCanonicalUrl } from '@/lib/siteUrl';

const description =
  'Contact Dainty Bloom with a question about an order, a product, or another general enquiry.';
const canonical = getCanonicalUrl('/contact');
export const metadata: Metadata = {
  title: 'Contact Us',
  description,
  ...(canonical ? { alternates: { canonical } } : {}),
  openGraph: {
    title: 'Contact Dainty Bloom',
    description,
    type: 'website',
    ...(canonical ? { url: canonical } : {}),
  },
  twitter: { card: 'summary', title: 'Contact Dainty Bloom', description },
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const [result, params] = await Promise.all([
    getPublicSettings(),
    searchParams,
  ]);
  const settings = result.data;
  const address = settings?.studioAddress
    ? [
        settings.studioAddress.label,
        settings.studioAddress.city,
        settings.studioAddress.country,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const hasContactDetails = Boolean(
    settings?.contactEmail ||
    settings?.contactPhone ||
    address ||
    settings?.openingHoursDisplayText,
  );
  const customRequest = params.type === 'custom-3d';

  return (
    <div className="commerce-page contact-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Contact</span>
      </nav>

      <header className="contact-page__heading">
        <span className="eyebrow">We’re here to help</span>
        <h1>Contact us</h1>
        <p>
          Send us a message about an order, a product, or another general
          question.
        </p>
      </header>

      {customRequest ? (
        <div className="commerce-alert contact-page__notice" role="note">
          <span>
            Custom product ideas use a separate request form. This form is for
            general questions only.
          </span>
          <Link className="button button--secondary" href="/custom-3d-request">
            Request a custom product
          </Link>
        </div>
      ) : null}

      <div className="contact-page__layout">
        <aside className="commerce-card contact-information">
          <h2>Contact details</h2>
          {hasContactDetails ? (
            <ul className="contact-information__list">
              {settings?.contactEmail ? (
                <li>
                  <Mail size={19} aria-hidden="true" />
                  <a href={`mailto:${settings.contactEmail}`}>
                    {settings.contactEmail}
                  </a>
                </li>
              ) : null}
              {settings?.contactPhone ? (
                <li>
                  <Phone size={19} aria-hidden="true" />
                  <a href={`tel:${settings.contactPhone}`}>
                    {settings.contactPhone}
                  </a>
                </li>
              ) : null}
              {address ? (
                <li>
                  <MapPin size={19} aria-hidden="true" />
                  <address>{address}</address>
                </li>
              ) : null}
              {settings?.openingHoursDisplayText ? (
                <li>
                  <Clock3 size={19} aria-hidden="true" />
                  <span>{settings.openingHoursDisplayText}</span>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="contact-information__empty">
              {result.unavailable
                ? 'Contact details are temporarily unavailable. You can still send a message using the form.'
                : 'No additional contact details are currently listed. You can reach us using the form.'}
            </p>
          )}
          <p className="contact-information__hint">
            For a question about an existing order, include the order number so
            we can understand your enquiry.
          </p>
        </aside>

        <ContactForm />
      </div>
    </div>
  );
}
