import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getConfiguredSiteUrl,
  getProductCanonicalUrl,
  isProductionDeployment,
  isProductionIndexingEnabled,
} from './siteUrl';

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
  vi.restoreAllMocks();
});

describe('site URL configuration', () => {
  it('does not use localhost as a canonical origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';

    expect(getConfiguredSiteUrl()).toBeUndefined();
  });

  it('accepts an explicit non-local origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://daintybloome.com';

    expect(getConfiguredSiteUrl()?.origin).toBe('https://daintybloome.com');
  });

  it('rejects a URL that is not an origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://store.example/path';

    expect(() => getConfiguredSiteUrl()).toThrow(
      'NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin',
    );
  });
});

describe('deployment indexing mode', () => {
  it('allows indexing only for production with the confirmed HTTPS origin', () => {
    process.env.VERCEL_ENV = 'preview';
    expect(isProductionDeployment()).toBe(false);
    expect(isProductionIndexingEnabled()).toBe(false);

    process.env.VERCEL_ENV = 'production';
    expect(isProductionDeployment()).toBe(true);
    expect(isProductionIndexingEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_SITE_URL = 'https://daintybloome.com';
    expect(isProductionIndexingEnabled()).toBe(true);

    process.env.NEXT_PUBLIC_SITE_URL = 'http://daintybloome.com';
    expect(isProductionIndexingEnabled()).toBe(false);
  });
});

describe('product canonical URLs', () => {
  it('uses the public product route and warns on a mismatched override', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_SITE_URL = 'https://daintybloome.com';

    expect(
      getProductCanonicalUrl('painted-mug', 'https://other.example/old-url'),
    ).toBe('https://daintybloome.com/product/painted-mug');
    expect(warning).toHaveBeenCalledOnce();
  });

  it('accepts only an override matching the canonical product path', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://daintybloome.com';
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      getProductCanonicalUrl(
        'painted-mug',
        'https://daintybloome.com/product/painted-mug',
      ),
    ).toBe('https://daintybloome.com/product/painted-mug');
    expect(warning).not.toHaveBeenCalled();
  });
});
