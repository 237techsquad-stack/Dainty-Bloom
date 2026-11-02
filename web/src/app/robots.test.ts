import { afterEach, describe, expect, it } from 'vitest';
import robots from './robots';

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const originalVercelEnv = process.env.VERCEL_ENV;

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
  if (originalVercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnv;
  }
});

describe('robots.txt', () => {
  it('omits the sitemap directive from preview deployments', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://store.example';
    process.env.VERCEL_ENV = 'preview';

    const config = robots();
    expect(config.sitemap).toBeUndefined();
    expect(config.rules).toMatchObject({
      userAgent: '*',
      allow: '/',
      disallow: expect.arrayContaining(['/admin', '/api/']),
    });
  });

  it('links the sitemap only for production and a configured public origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://daintybloome.com';
    process.env.VERCEL_ENV = 'production';

    expect(robots().sitemap).toBe('https://daintybloome.com/sitemap.xml');

    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    expect(robots().sitemap).toBeUndefined();
  });

  it('does not publish a sitemap for a noncanonical production origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://other.example';
    process.env.VERCEL_ENV = 'production';

    expect(robots().sitemap).toBeUndefined();
  });
});
