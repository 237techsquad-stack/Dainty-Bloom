'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Filter, X } from 'lucide-react';
import type {
  CatalogPage as CatalogPageData,
  Category,
  ProductTheme,
} from '@/lib/api/types';
import { api } from '@/lib/api/client';
import {
  ProductGrid,
  EmptyStateCatalog,
  ErrorStateCatalog,
  CatalogSkeleton,
  Pagination,
  hasCompleteLightingImagePair,
  LightingStateToggle,
} from './CatalogComponents';
import { Button, Checkbox, Input, Modal } from '@/components/ui';
import { currencySymbol, formatMoney } from '@/lib/utils/formatMoney';
import { useSettings } from '@/hooks/useSettings';
import { PRODUCT_THEMES } from '@/lib/productThemes';

interface CatalogBrowseProps {
  initialData: CatalogPageData | null;
  category?: Category;
  categories: Category[];
  initialQuery: Record<string, string>;
  theme?: ProductTheme;
  customBanner?: React.ReactNode;
}

const OTHER_PRODUCT_CATEGORIES = [
  { slug: 't-shirts', name: 'T-Shirts' },
  { slug: 'mugs', name: 'Mugs' },
  { slug: 'paint-it-yourself-canvas', name: 'Paint-It-Yourself Canvas' },
  { slug: '3d-printed-goods', name: '3D Printed Goods' },
  { slug: 'hoodies', name: 'Hoodies' },
  { slug: 'phone-cases', name: 'Phone Cases' },
] as const;

function flattenCategories(
  items: Category[],
  depth = 0,
): Array<{ category: Category; depth: number }> {
  return items.flatMap((item) => [
    { category: item, depth },
    ...flattenCategories(item.children ?? [], depth + 1),
  ]);
}

function humanize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseMajorToMinor(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (!/^\d{1,8}(?:\.\d{0,2})?$/.test(normalized)) return undefined;
  const [whole = '0', fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function normalizeQueryString(value: string) {
  const entries = Array.from(new URLSearchParams(value).entries()).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return new URLSearchParams(entries).toString();
}

export function CatalogBrowse({
  initialData,
  category,
  categories,
  initialQuery,
  theme,
  customBanner,
}: CatalogBrowseProps) {
  const router = useRouter();
  const settings = useSettings();
  const currency = settings.data?.currency ?? 'GBP';
  const symbol = currencySymbol(currency);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const themeDetails = theme
    ? PRODUCT_THEMES.find((item) => item.slug === theme)
    : undefined;
  const queryString = searchParams.toString();
  const initialString = normalizeQueryString(
    new URLSearchParams(initialQuery).toString(),
  );
  const normalizedQueryString = normalizeQueryString(queryString);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lightingState, setLightingState] = useState<'on' | 'off'>('on');
  const [priceInputState, setPriceInputState] = useState(() => ({
    query: normalizedQueryString,
    min: searchParams.get('minPrice')
      ? (Number(searchParams.get('minPrice')) / 100).toFixed(2)
      : '',
    max: searchParams.get('maxPrice')
      ? (Number(searchParams.get('maxPrice')) / 100).toFixed(2)
      : '',
    error: '',
  }));
  const priceInputs =
    priceInputState.query === normalizedQueryString
      ? priceInputState
      : {
          query: normalizedQueryString,
          min: searchParams.get('minPrice')
            ? (Number(searchParams.get('minPrice')) / 100).toFixed(2)
            : '',
          max: searchParams.get('maxPrice')
            ? (Number(searchParams.get('maxPrice')) / 100).toFixed(2)
            : '',
          error: '',
        };
  const minPriceInput = priceInputs.min;
  const maxPriceInput = priceInputs.max;

  function updatePriceInputs(
    changes: Partial<Pick<typeof priceInputs, 'min' | 'max' | 'error'>>,
  ) {
    setPriceInputState({
      ...priceInputs,
      ...changes,
      query: normalizedQueryString,
    });
  }

  const query = useMemo(
    () => ({
      q: searchParams.get('q') ?? undefined,
      category: category?.slug ?? searchParams.get('category') ?? undefined,
      productType: searchParams.get('productType') ?? undefined,
      theme,
      printTechnique: searchParams.get('printTechnique') ?? undefined,
      minPrice: searchParams.has('minPrice')
        ? Number(searchParams.get('minPrice'))
        : undefined,
      maxPrice: searchParams.has('maxPrice')
        ? Number(searchParams.get('maxPrice'))
        : undefined,
      color: searchParams.get('color') ?? undefined,
      size: searchParams.get('size') ?? undefined,
      inStock: searchParams.get('inStock') === 'true' ? true : undefined,
      sort: (searchParams.get('sort') ?? 'newest') as
        'newest' | 'price_asc' | 'price_desc' | 'popular',
      page: Number(searchParams.get('page') ?? '1'),
      limit: 12,
    }),
    [category?.slug, searchParams, theme],
  );
  const catalog = useQuery({
    queryKey: ['catalog', pathname, queryString],
    queryFn: () => api.catalogProducts(query),
    initialData:
      normalizedQueryString === initialString
        ? (initialData ?? undefined)
        : undefined,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const data = catalog.data;
  const showLightingToggle =
    category?.slug === 'lamps-and-lighting' &&
    Boolean(data?.items.length && hasCompleteLightingImagePair(data.items));
  const allCategories = flattenCategories(categories);

  function updateParams(
    changes: Record<string, string | undefined>,
    resetPage = true,
  ) {
    const next = new URLSearchParams(searchParams.toString());
    if (category) next.delete('category');
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage && !('page' in changes)) next.delete('page');
    const serialized = next.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, {
      scroll: false,
    });
  }

  function applyPriceFilter() {
    updatePriceInputs({ error: '' });
    if (
      (minPriceInput && parseMajorToMinor(minPriceInput) === undefined) ||
      (maxPriceInput && parseMajorToMinor(maxPriceInput) === undefined)
    ) {
      updatePriceInputs({
        error: `Enter a price in ${currency} and up to two decimal places.`,
      });
      return;
    }
    const minPrice = parseMajorToMinor(minPriceInput);
    const maxPrice = parseMajorToMinor(maxPriceInput);
    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      minPrice > maxPrice
    ) {
      updatePriceInputs({
        error: 'The minimum price must not be greater than the maximum.',
      });
      return;
    }
    updateParams({
      minPrice: minPrice === undefined ? undefined : String(minPrice),
      maxPrice: maxPrice === undefined ? undefined : String(maxPrice),
    });
    setFiltersOpen(false);
  }

  const activeFilters = Array.from(searchParams.entries()).filter(
    ([key]) => key !== 'page' && key !== 'sort',
  );
  const activeFilterCount = activeFilters.length;
  const title = query.q
    ? `Results for "${query.q}"`
    : (themeDetails?.name ?? category?.name ?? 'All products');
  const availableCategories = new Map(
    allCategories.map(({ category: item }) => [item.slug, item]),
  );
  const productCategoryChips = OTHER_PRODUCT_CATEGORIES.flatMap(
    ({ slug, name }) => {
      const item = availableCategories.get(slug);
      return item ? [{ ...item, name }] : [];
    },
  );

  const filterPanel = (
    <div className="catalog-filter-content">
      {!category ? (
        <section className="catalog-filter-group">
          <h3>Category</h3>
          <ul className="filter-category-list">
            {allCategories.map(({ category: item, depth }) => (
              <li key={item.slug}>
                <Link
                  className="filter-category-link"
                  href={`/category/${item.slug}`}
                  style={{ paddingInlineStart: `${0.75 + depth * 0.9}rem` }}
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data?.facets.productTypes.length ? (
        <section className="catalog-filter-group">
          <h3>Product type</h3>
          {data.facets.productTypes.map((value) => (
            <Checkbox
              key={value}
              label={humanize(value)}
              checked={searchParams.get('productType') === value}
              onChange={() =>
                updateParams({
                  productType:
                    searchParams.get('productType') === value
                      ? undefined
                      : value,
                })
              }
            />
          ))}
        </section>
      ) : null}
      {data?.facets.printTechniques.length ? (
        <section className="catalog-filter-group">
          <h3>Print technique</h3>
          {data.facets.printTechniques.map((value) => (
            <Checkbox
              key={value}
              label={humanize(value)}
              checked={searchParams.get('printTechnique') === value}
              onChange={() =>
                updateParams({
                  printTechnique:
                    searchParams.get('printTechnique') === value
                      ? undefined
                      : value,
                })
              }
            />
          ))}
        </section>
      ) : null}
      <section className="catalog-filter-group">
        <h3>Price range</h3>
        <div className="filter-price-fields">
          <Input
            label={`From (${symbol})`}
            inputMode="decimal"
            value={minPriceInput}
            onChange={(event) =>
              updatePriceInputs({ min: event.target.value, error: '' })
            }
          />
          <Input
            label={`To (${symbol})`}
            inputMode="decimal"
            value={maxPriceInput}
            onChange={(event) =>
              updatePriceInputs({ max: event.target.value, error: '' })
            }
          />
        </div>
        {priceInputs.error ? (
          <p className="catalog-inline-error" role="alert">
            {priceInputs.error}
          </p>
        ) : null}
        <Button variant="secondary" size="sm" onClick={applyPriceFilter}>
          Apply price
        </Button>
      </section>
      {data?.facets.colors.length ? (
        <section className="catalog-filter-group">
          <h3>Colour</h3>
          <div className="filter-color-list">
            {data.facets.colors.map((color) => (
              <button
                className={`filter-color${searchParams.get('color') === color.value ? ' is-selected' : ''}`}
                key={color.value}
                aria-label={`Filter by colour ${color.label}`}
                aria-pressed={searchParams.get('color') === color.value}
                onClick={() =>
                  updateParams({
                    color:
                      searchParams.get('color') === color.value
                        ? undefined
                        : color.value,
                  })
                }
              >
                <span
                  className="filter-color__swatch"
                  style={{ backgroundColor: color.hex ?? '#E2E8F0' }}
                />
                {color.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {data?.facets.sizes.length ? (
        <section className="catalog-filter-group">
          <h3>Size</h3>
          <div className="filter-size-list">
            {data.facets.sizes.map((value) => (
              <button
                className={
                  searchParams.get('size') === value ? 'is-selected' : ''
                }
                key={value}
                aria-pressed={searchParams.get('size') === value}
                onClick={() =>
                  updateParams({
                    size:
                      searchParams.get('size') === value ? undefined : value,
                  })
                }
              >
                {humanize(value)}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section className="catalog-filter-group">
        <Checkbox
          label="In stock or made to order"
          checked={searchParams.get('inStock') === 'true'}
          onChange={(event) =>
            updateParams({ inStock: event.target.checked ? 'true' : undefined })
          }
        />
      </section>
    </div>
  );

  return (
    <div className="catalog-page container">
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumbs">
          <li>
            <Link href="/">Home</Link>
          </li>
          {themeDetails ? (
            <>
              <li>
                <Link href="/themes">Themes</Link>
              </li>
              <li>
                <span aria-current="page">{themeDetails.name}</span>
              </li>
            </>
          ) : (
            <li>
              {category ? (
                <Link href="/shop">Shop</Link>
              ) : (
                <span aria-current="page">Shop</span>
              )}
            </li>
          )}
          {category ? (
            <li>
              <span aria-current="page">{category.name}</span>
            </li>
          ) : null}
        </ol>
      </nav>
      <header
        className={`catalog-heading${themeDetails ? ' catalog-heading--theme' : ''}`}
      >
        <div>
          <h1>{title}</h1>
          {themeDetails ? <p>{themeDetails.description}</p> : null}
          {!themeDetails && category?.description ? (
            <p>{category.description}</p>
          ) : null}
        </div>
      </header>
      {themeDetails ? (
        <nav className="theme-collection-nav" aria-label="Browse themes">
          <Link href="/themes">All themes</Link>
          {PRODUCT_THEMES.map((item) => (
            <Link
              aria-current={item.slug === theme ? 'page' : undefined}
              href={`/themes/${item.slug}`}
              key={item.slug}
            >
              {item.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {productCategoryChips.length ? (
        <section
          className="category-chip-section"
          aria-label="Other product categories"
        >
          <p className="category-chip-label">Other Products</p>
          <nav className="category-chips" aria-label="Other product categories">
            {productCategoryChips.map((item) => (
              <Link
                aria-current={item.slug === category?.slug ? 'page' : undefined}
                key={item.slug}
                href={`/category/${item.slug}`}
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </section>
      ) : null}
      {customBanner}
      <div className="catalog-toolbar">
        <div className="catalog-toolbar__actions">
          <Button
            className="catalog-filter-trigger"
            variant="secondary"
            onClick={() => setFiltersOpen(true)}
          >
            <Filter size={16} /> Filters
            {activeFilterCount ? (
              <span className="catalog-filter-count">{activeFilterCount}</span>
            ) : null}
          </Button>
          <label className="catalog-sort">
            <span>Sort by</span>
            <select
              value={query.sort}
              onChange={(event) => updateParams({ sort: event.target.value })}
            >
              <option value="newest">Newest</option>
              <option value="popular">Popular</option>
              <option value="price_asc">Price low to high</option>
              <option value="price_desc">Price high to low</option>
            </select>
          </label>
        </div>
        {showLightingToggle ? (
          <LightingStateToggle
            value={lightingState}
            onChange={setLightingState}
          />
        ) : null}
      </div>
      {activeFilters.length ? (
        <div className="filter-chips" aria-label="Active filters">
          {activeFilters.map(([key, value]) => (
            <button
              key={key}
              onClick={() => updateParams({ [key]: undefined })}
            >
              {key === 'minPrice' || key === 'maxPrice'
                ? formatMoney(Number(value), currency)
                : humanize(value)}{' '}
              <X size={14} aria-hidden="true" />
            </button>
          ))}
          <button
            className="filter-chips__clear"
            onClick={() =>
              router.replace(category || themeDetails ? pathname : '/shop')
            }
          >
            Clear all
          </button>
        </div>
      ) : null}
      <div className="catalog-layout">
        <aside className="catalog-sidebar" aria-label="Product filters">
          {filterPanel}
        </aside>
        <section className="catalog-results" aria-label="Products">
          {catalog.isPending ? <CatalogSkeleton /> : null}
          {catalog.isError ? (
            <ErrorStateCatalog retry={() => void catalog.refetch()} />
          ) : null}
          {data?.items.length ? (
            <>
              <ProductGrid
                products={data.items}
                lightingState={
                  category?.slug === 'lamps-and-lighting'
                    ? lightingState
                    : undefined
                }
              />
              <Pagination
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                onChange={(page) => updateParams({ page: String(page) }, false)}
              />
            </>
          ) : null}
          {!catalog.isPending &&
          !catalog.isError &&
          data &&
          !data.items.length ? (
            activeFilterCount ? (
              <EmptyStateCatalog
                title="No products match your filters"
                variant="plain"
                action={
                  <Button
                    variant="secondary"
                    onClick={() =>
                      router.replace(
                        category || themeDetails ? pathname : '/shop',
                      )
                    }
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyStateCatalog
                title={
                  themeDetails
                    ? 'No products available yet'
                    : 'No products here yet'
                }
                variant="plain"
                action={
                  <Button
                    variant="secondary"
                    onClick={() => router.push('/shop')}
                  >
                    Continue browsing
                  </Button>
                }
              >
                {themeDetails
                  ? `There are no published products in the ${themeDetails.name} collection yet. Please check back soon.`
                  : 'We’re preparing this collection. Please check back soon.'}
              </EmptyStateCatalog>
            )
          ) : null}
        </section>
      </div>
      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filter products"
      >
        {filterPanel}
        <Button
          className="filter-sheet-submit"
          onClick={() => setFiltersOpen(false)}
        >
          Show results
        </Button>
      </Modal>
    </div>
  );
}
