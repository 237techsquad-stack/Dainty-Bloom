interface CacheEntry {
  expiresAt: number;
  value: Promise<unknown>;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 45_000;

export function getCachedPublicValue<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as Promise<T>;
  }

  const value = Promise.resolve().then(load);
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  void value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

export function invalidatePublicCache(...prefixes: string[]): void {
  for (const key of cache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) cache.delete(key);
  }
}

export function invalidateCatalogPublicCache(): void {
  invalidatePublicCache('catalog:categories', 'catalog:facets:');
}
