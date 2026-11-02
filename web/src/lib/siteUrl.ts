const PRODUCTION_SITE_ORIGIN = 'https://daintybloome.com';

export function getConfiguredSiteUrl(): URL | undefined {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must be an absolute HTTP(S) origin without a path, query, or fragment.',
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin without a path, query, or fragment.',
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  ) {
    return undefined;
  }

  return url;
}

export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

export function isProductionIndexingEnabled(): boolean {
  if (!isProductionDeployment()) return false;

  const siteUrl = getConfiguredSiteUrl();
  return (
    siteUrl?.protocol === 'https:' && siteUrl.origin === PRODUCTION_SITE_ORIGIN
  );
}

export function getAbsoluteUrl(value: string, base?: URL): string | undefined {
  if (/^https?:\/\//i.test(value)) return new URL(value).toString();
  if (!base) return undefined;
  return new URL(value, base).toString();
}

export function getCanonicalUrl(path: string): string | undefined {
  const siteUrl = getConfiguredSiteUrl();
  return siteUrl ? new URL(path, siteUrl).toString() : undefined;
}

export function getProductCanonicalUrl(
  slug: string,
  override?: string,
  siteUrl = getConfiguredSiteUrl(),
): string | undefined {
  const path = `/product/${encodeURIComponent(slug)}`;

  if (override) {
    const comparisonOrigin = siteUrl ?? new URL('https://canonical.invalid');
    let candidate: URL | undefined;
    try {
      candidate = new URL(override, comparisonOrigin);
    } catch {
      candidate = undefined;
    }

    if (
      !candidate ||
      candidate.origin !== comparisonOrigin.origin ||
      candidate.pathname !== path ||
      candidate.search ||
      candidate.hash
    ) {
      console.warn(
        '[seo] Ignoring a product canonical override that does not match its public product route.',
      );
    }
  }

  return siteUrl ? new URL(path, siteUrl).toString() : undefined;
}
