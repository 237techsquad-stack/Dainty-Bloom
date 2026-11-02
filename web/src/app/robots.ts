import type { MetadataRoute } from 'next';
import {
  getConfiguredSiteUrl,
  isProductionIndexingEnabled,
} from '@/lib/siteUrl';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getConfiguredSiteUrl();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/cart',
        '/checkout',
        '/account',
        '/orders',
        '/track-order',
        '/wishlist',
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
        '/api/',
      ],
    },
    ...(siteUrl && isProductionIndexingEnabled()
      ? { sitemap: new URL('/sitemap.xml', siteUrl).toString() }
      : {}),
  };
}
