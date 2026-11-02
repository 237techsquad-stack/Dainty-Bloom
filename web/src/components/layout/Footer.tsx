'use client';

import Link from 'next/link';
import { Brand } from '@/components/layout/Brand';
import { useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Camera, Music2, MessageCircle } from 'lucide-react';
import type { Category, SiteSettings } from '@/lib/api/types';
import { normalizeCategoryList } from '@/lib/api/normalizers';
import { api, ApiError } from '@/lib/api/client';
import { Button, Checkbox, Input, useToast } from '@/components/ui';

const newsletterSchema = z.object({
  email: z.string().email(),
  consent: z.literal(true, {
    error: 'Please consent to receive email updates.',
  }),
});
type NewsletterValues = z.infer<typeof newsletterSchema>;

function flattenCategories(categories: unknown): Category[] {
  return normalizeCategoryList(categories).flatMap((category) => [
    category,
    ...flattenCategories(category.children),
  ]);
}

export function Footer({
  settings,
  categories,
}: {
  settings: SiteSettings | null;
  categories: Category[] | null;
}) {
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NewsletterValues>({
    resolver: zodResolver(newsletterSchema),
  });

  const submit = handleSubmit(async (values) => {
    try {
      const result = await api.subscribe({
        email: values.email,
        consent: true,
        source: 'footer',
      });
      toast(result.message, 'success');
      reset();
    } catch (error) {
      toast(
        error instanceof ApiError
          ? error.message
          : 'Unable to subscribe right now.',
        'error',
      );
    }
  });

  const instagram = settings?.socialLinks?.instagram;
  const tiktok = settings?.socialLinks?.tiktok;
  const whatsapp = settings?.socialLinks?.whatsapp;
  const whatsAppHref =
    whatsapp ??
    (settings?.whatsappNumber
      ? `https://wa.me/${settings.whatsappNumber.replace(/\D/g, '')}`
      : undefined);
  const address = settings?.studioAddress
    ? [
        settings.studioAddress.label,
        settings.studioAddress.city,
        settings.studioAddress.country,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const shopCategories = flattenCategories(categories);

  return (
    <footer className="site-footer">
      <div className="footer-grid container">
        <div className="footer-brand">
          <Brand footer />
          {settings?.aboutNote ? <p>{settings.aboutNote}</p> : null}
          {instagram || tiktok || whatsAppHref ? (
            <nav className="social-links" aria-label="Social media">
              {instagram ? (
                <a
                  href={instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Instagram"
                >
                  <Camera />
                </a>
              ) : null}
              {tiktok ? (
                <a
                  href={tiktok}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="TikTok"
                >
                  <Music2 />
                </a>
              ) : null}
              {whatsAppHref ? (
                <a
                  href={whatsAppHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="WhatsApp"
                >
                  <MessageCircle />
                </a>
              ) : null}
            </nav>
          ) : null}
        </div>
        <FooterColumn title="Shop">
          {shopCategories.map((category) => (
            <Link key={category.slug} href={`/category/${category.slug}`}>
              {category.name}
            </Link>
          ))}
          <Link href="/shop">All products</Link>
        </FooterColumn>
        <FooterColumn title="Help">
          <Link href="/faq">Frequently asked questions</Link>
          <Link href="/about">About Us</Link>
          <Link href="/contact">Contact Us</Link>
          <Link href="/track-order">Track order</Link>
          <Link href="/admin/login">Staff Login</Link>
        </FooterColumn>
        <div className="footer-column">
          <h2>Contact</h2>
          {settings?.contactEmail ? (
            <a href={`mailto:${settings.contactEmail}`}>
              {settings.contactEmail}
            </a>
          ) : null}
          {settings?.contactPhone ? (
            <a href={`tel:${settings.contactPhone}`}>{settings.contactPhone}</a>
          ) : null}
          {whatsAppHref ? (
            <a href={whatsAppHref} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          ) : null}
          {address ? <address>{address}</address> : null}
          {settings?.openingHoursDisplayText ? (
            <p>{settings.openingHoursDisplayText}</p>
          ) : null}
          <form
            className="newsletter-form"
            onSubmit={(event) => void submit(event)}
          >
            <h3>Newsletter</h3>
            <Input
              label="Email address"
              type="email"
              autoComplete="email"
              error={errors.email?.message}
              {...register('email')}
            />
            <Checkbox
              label="I consent to receive email updates."
              {...register('consent')}
            />
            {errors.consent ? (
              <p className="field-error">{errors.consent.message}</p>
            ) : null}
            <Button type="submit" loading={isSubmitting}>
              Subscribe
            </Button>
          </form>
        </div>
      </div>
      <div className="footer-bottom">
        <div className="container footer-bottom__inner">
          <p>© {new Date().getFullYear()} Dainty Bloom</p>
          {settings?.stripePublishableKey ? (
            <p>Secure payments powered by Stripe</p>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="footer-column">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
