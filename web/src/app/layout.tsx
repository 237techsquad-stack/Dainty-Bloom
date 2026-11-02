import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Cormorant_Garamond, Inter } from 'next/font/google';
import '@/styles/globals.css';
import '@/styles/commerce.css';
import { AppProviders } from '@/components/providers/AppProviders';
import {
  getConfiguredSiteUrl,
  isProductionIndexingEnabled,
} from '@/lib/siteUrl';

const inter = Inter({
  variable: '--font-body',
  subsets: ['latin'],
});

const cormorant = Cormorant_Garamond({
  variable: '--font-heading',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

const description =
  'Explore custom-printed goods and creative projects from Dainty Bloom. Browse current products and the options available for each item.';
const siteUrl = getConfiguredSiteUrl();
const indexingEnabled = isProductionIndexingEnabled();

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: siteUrl } : {}),
  ...(!indexingEnabled ? { robots: { index: false, follow: false } } : {}),
  title: {
    default: 'Dainty Bloom',
    template: '%s | Dainty Bloom',
  },
  description,
  openGraph: {
    title: 'Dainty Bloom',
    description,
    type: 'website',
    ...(siteUrl
      ? {
          images: [
            {
              url: new URL('/images/dainty-bloom-logo.png', siteUrl).toString(),
              width: 640,
              height: 426,
              alt: 'Dainty Bloom',
            },
          ],
        }
      : {}),
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dainty Bloom',
    description,
    ...(siteUrl
      ? {
          images: [
            new URL('/images/dainty-bloom-logo.png', siteUrl).toString(),
          ],
        }
      : {}),
  },
  icons: { icon: '/images/dainty-bloom-logo.png' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${cormorant.variable}`}
      data-scroll-behavior="smooth"
    >
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
