'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LayoutGrid,
  List,
  Package,
  Pause,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  AdminConfirmDialog,
  AdminEmptyState,
  PageHeader,
  ProductStatusBadge,
} from '@/components/admin';
import { AdminIconButton } from '@/components/admin/AdminIconButton';
import { MoneyInput } from '@/components/admin/ManagementFields';
import {
  Button,
  ErrorState,
  Input,
  Modal,
  Select,
  useToast,
} from '@/components/ui';
import { api, ApiError, type AdminProductFilters } from '@/lib/api/client';
import { formatMoney } from '@/lib/utils/formatMoney';
import { usePermissions } from '@/components/providers/AuthProvider';
import { useSettings } from '@/hooks/useSettings';
import type { AdminProductListItem, ProductStatus } from '@/lib/api/types';

function productFilters(params: URLSearchParams): AdminProductFilters {
  const asNumber = (value: string | null) =>
    value && /^\d+$/.test(value) ? Number(value) : undefined;
  const status = params.get('status');
  const stockState = params.get('stockState');
  const sort = params.get('sort');
  const productStatuses = ['active', 'draft', 'archived', 'out_of_stock'];
  const stockStates = [
    'in_stock',
    'low_stock',
    'out_of_stock',
    'made_to_order',
  ];
  const sorts = ['newest', 'title', 'price_asc', 'price_desc', 'popular'];
  return {
    q: params.get('q') || undefined,
    category: params.get('category') || undefined,
    status: productStatuses.includes(status ?? '')
      ? (status as ProductStatus)
      : undefined,
    minPrice: asNumber(params.get('minPrice')),
    maxPrice: asNumber(params.get('maxPrice')),
    stockState: stockStates.includes(stockState ?? '')
      ? (stockState as AdminProductFilters['stockState'])
      : undefined,
    sort: sorts.includes(sort ?? '')
      ? (sort as AdminProductFilters['sort'])
      : 'newest',
    page: asNumber(params.get('page')) ?? 1,
    limit: [10, 25, 50].includes(asNumber(params.get('limit')) ?? 0)
      ? asNumber(params.get('limit'))
      : 25,
  };
}

function flattenCategories(
  categories: Awaited<ReturnType<typeof api.adminCategories>>,
  depth = 0,
  parentPath = '',
  ancestorsActive = true,
): Array<{ id: string; label: string; depth: number; isActive: boolean }> {
  return categories.flatMap((category) => [
    {
      id: category._id,
      label: parentPath ? `${parentPath} / ${category.name}` : category.name,
      depth,
      isActive: ancestorsActive && category.isActive,
    },
    ...flattenCategories(
      category.children,
      depth + 1,
      parentPath ? `${parentPath} / ${category.name}` : category.name,
      ancestorsActive && category.isActive,
    ),
  ]);
}

function stockDescription(product: AdminProductListItem) {
  if (product.madeToOrder) return 'Made to order';
  if (!product.stock.trackInventory) return 'Not tracked';
  return String(product.stock.quantity);
}

export function ProductsManagement() {
  return (
    <Suspense
      fallback={
        <div className="admin-skeleton-grid" role="status">
          Loading products…
        </div>
      }
    >
      <ProductsManagementContent />
    </Suspense>
  );
}

function ProductsManagementContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = usePermissions();
  const canRead = can('products:read');
  const settings = useSettings();
  const currency = settings.data?.currency;
  const canWrite = can('products:write');
  const params = new URLSearchParams(searchParams.toString());
  const filters = productFilters(params);
  const searchParamText = filters.q ?? '';
  const [searchDraft, setSearchDraft] = useState({
    source: searchParamText,
    text: searchParamText,
  });
  const queryText =
    searchDraft.source === searchParamText ? searchDraft.text : searchParamText;
  const [selected, setSelected] = useState<string[]>([]);
  const [stockTarget, setStockTarget] = useState<AdminProductListItem | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<AdminProductListItem | null>(
    null,
  );
  const [bulkAction, setBulkAction] = useState<ProductStatus | null>(null);
  const [stockMode, setStockMode] = useState<'set' | 'adjust'>('set');
  const [stockValue, setStockValue] = useState('');
  const [stockNote, setStockNote] = useState('');
  const [stockError, setStockError] = useState('');
  const [bulkResult, setBulkResult] = useState('');
  const [priceDraft, setPriceDraft] = useState({
    minSource: filters.minPrice,
    min: filters.minPrice,
    maxSource: filters.maxPrice,
    max: filters.maxPrice,
  });
  const minimumPrice =
    priceDraft.minSource === filters.minPrice
      ? priceDraft.min
      : filters.minPrice;
  const maximumPrice =
    priceDraft.maxSource === filters.maxPrice
      ? priceDraft.max
      : filters.maxPrice;
  const [priceTouched, setPriceTouched] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [newProductCategory, setNewProductCategory] = useState('');
  const serializedSearchParams = searchParams.toString();
  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(serializedSearchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}${next.size ? `?${next.toString()}` : ''}`, {
        scroll: false,
      });
    },
    [pathname, router, serializedSearchParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () => updateParams({ q: queryText.trim(), page: '1' }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [queryText, updateParams]);

  const products = useQuery({
    queryKey: ['admin-products', Object.fromEntries(params.entries())],
    queryFn: () => api.adminProducts(filters),
    retry: false,
    enabled: canRead,
  });
  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: api.adminCategories,
    retry: false,
  });
  const categoryOptions = useMemo(
    () => flattenCategories(categories.data ?? []),
    [categories.data],
  );
  const activeCategoryOptions = useMemo(
    () => categoryOptions.filter((category) => category.isActive),
    [categoryOptions],
  );
  const items = Array.isArray(products.data?.items) ? products.data.items : [];
  const pagination = products.data?.pagination;
  const allVisibleSelected =
    items.length > 0 && items.every((item) => selected.includes(item._id));
  const hasFilters = Boolean(
    filters.q ||
    filters.category ||
    filters.status ||
    filters.stockState ||
    filters.minPrice !== undefined ||
    filters.maxPrice !== undefined,
  );

  function updateFilter(key: string, value: string) {
    updateParams({ [key]: value, page: key === 'page' ? value : '1' });
  }

  function clearFilters() {
    setSearchDraft({ source: searchParamText, text: '' });
    setPriceDraft({
      minSource: filters.minPrice,
      min: undefined,
      maxSource: filters.maxPrice,
      max: undefined,
    });
    setPriceTouched(false);
    setFiltersOpen(false);
    router.replace(pathname, { scroll: false });
  }

  function selectProduct(id: string, checked: boolean) {
    if (!checked) {
      setSelected((current) =>
        current.filter((selectedId) => selectedId !== id),
      );
      return;
    }
    setSelected((current) => {
      if (current.includes(id)) return current;
      if (current.length >= 100) {
        toast('Bulk actions are limited to 100 products.', 'error');
        return current;
      }
      return [...current, id];
    });
  }

  function applyPrices() {
    if (
      minimumPrice !== undefined &&
      maximumPrice !== undefined &&
      minimumPrice > maximumPrice
    ) {
      toast('Minimum price cannot exceed maximum price.', 'error');
      return;
    }
    setPriceTouched(false);
    updateParams({
      minPrice: minimumPrice === undefined ? undefined : String(minimumPrice),
      maxPrice: maximumPrice === undefined ? undefined : String(maximumPrice),
      page: '1',
    });
  }

  function openAddProduct() {
    setNewProductCategory('');
    setAddProductOpen(true);
  }

  function continueToNewProduct() {
    if (
      !activeCategoryOptions.some(
        (category) => category.id === newProductCategory,
      )
    )
      return;
    setAddProductOpen(false);
    router.push(
      `/admin/products/new?category=${encodeURIComponent(newProductCategory)}`,
    );
  }

  async function changeStatus(
    product: AdminProductListItem,
    status: ProductStatus,
  ) {
    try {
      await api.setAdminProductStatus(product._id, status);
      await queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast(`Product status set to ${status.replaceAll('_', ' ')}.`, 'success');
    } catch (error) {
      toast(
        error instanceof ApiError
          ? error.message
          : 'Product status could not be changed.',
        'error',
      );
    }
  }

  async function saveStock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stockTarget) return;
    const parsed = Number(stockValue);
    if (
      !Number.isSafeInteger(parsed) ||
      (stockMode === 'set'
        ? parsed < 0
        : stockTarget.stock.quantity + parsed < 0)
    ) {
      setStockError('Stock quantity cannot be negative. Enter a whole number.');
      return;
    }
    if (!stockNote.trim()) {
      setStockError('Add a note to explain this stock adjustment.');
      return;
    }
    setStockError('');
    try {
      await api.adjustAdminProductStock(
        stockTarget._id,
        stockMode === 'set'
          ? { mode: 'set', quantity: parsed, note: stockNote.trim() }
          : { mode: 'adjust', delta: parsed, note: stockNote.trim() },
      );
      await queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast('Stock updated.', 'success');
      setStockTarget(null);
    } catch (error) {
      setStockError(
        error instanceof ApiError
          ? error.message
          : 'Stock could not be updated.',
      );
    }
  }

  async function deleteProduct() {
    if (!deleteTarget) return;
    try {
      const result = await api.deleteAdminProduct(deleteTarget._id);
      await queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      toast(result.message, 'success');
      setDeleteTarget(null);
    } catch (error) {
      toast(
        error instanceof ApiError
          ? error.message
          : 'Product could not be deleted.',
        'error',
      );
      setDeleteTarget(null);
    }
  }

  async function applyBulkStatus() {
    if (!bulkAction) return;
    try {
      const result = await api.bulkAdminProductStatus(selected, bulkAction);
      setBulkResult(
        `${result.updated} product${result.updated === 1 ? '' : 's'} updated. The server applies this action atomically; no individual failure list was returned.`,
      );
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      setBulkAction(null);
    } catch (error) {
      setBulkResult(
        error instanceof ApiError
          ? error.message
          : 'The bulk action could not be completed.',
      );
      setBulkAction(null);
    }
  }

  const isGrid = searchParams.get('view') === 'grid';

  if (!canRead) {
    return (
      <main className="admin-access-denied">
        <h1>You do not have permission to view products.</h1>
      </main>
    );
  }

  return (
    <>
      <PageHeader
        title="Products"
        description={`${pagination?.total ?? 0} products`}
        actions={
          canWrite ? (
            <Button onClick={openAddProduct}>
              <Plus size={17} /> Add product
            </Button>
          ) : null
        }
      />
      <Button
        className="admin-mobile-filter-trigger"
        variant="secondary"
        onClick={() => setFiltersOpen(true)}
      >
        <SlidersHorizontal size={16} /> Filters
      </Button>
      {filtersOpen ? (
        <button
          type="button"
          className="admin-filter-backdrop"
          aria-label="Close product filters"
          onClick={() => setFiltersOpen(false)}
        />
      ) : null}
      <section
        className={`admin-panel admin-product-filters${filtersOpen ? ' is-open' : ''}`}
        aria-label="Product filters"
      >
        <div className="admin-filter-sheet-heading">
          <h2>Filters</h2>
          <Button
            variant="ghost"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
          >
            <X size={18} />
          </Button>
        </div>
        <div className="admin-product-filter-search">
          <label className="visually-hidden" htmlFor="product-search">
            Search by product name or SKU
          </label>
          <Search size={18} aria-hidden="true" />
          <input
            id="product-search"
            type="search"
            value={queryText}
            placeholder="Search by name or SKU"
            onChange={(event) =>
              setSearchDraft({
                source: searchParamText,
                text: event.target.value,
              })
            }
          />
        </div>
        <Select
          label="Category"
          value={filters.category ?? ''}
          onChange={(event) => updateFilter('category', event.target.value)}
        >
          <option value="">All categories</option>
          {categoryOptions.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </Select>
        {categories.isError ? (
          <p className="field-error" role="alert">
            Categories could not be loaded, so category filtering is
            unavailable.
          </p>
        ) : null}
        <Select
          label="Status"
          value={filters.status ?? ''}
          onChange={(event) => updateFilter('status', event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
          <option value="out_of_stock">Out of stock</option>
        </Select>
        <Select
          label="Stock state"
          value={filters.stockState ?? ''}
          onChange={(event) => updateFilter('stockState', event.target.value)}
        >
          <option value="">All stock states</option>
          <option value="in_stock">In stock</option>
          <option value="low_stock">Low stock</option>
          <option value="out_of_stock">Out of stock</option>
          <option value="made_to_order">Made to order / untracked</option>
        </Select>
        <div className="admin-price-range">
          {currency ? (
            <>
              <MoneyInput
                label="Minimum price"
                currency={currency}
                valueMinor={minimumPrice}
                onChange={(value) => {
                  setPriceTouched(true);
                  setPriceDraft((draft) => ({
                    ...draft,
                    minSource: filters.minPrice,
                    min: value,
                  }));
                }}
              />
              <MoneyInput
                label="Maximum price"
                currency={currency}
                valueMinor={maximumPrice}
                onChange={(value) => {
                  setPriceTouched(true);
                  setPriceDraft((draft) => ({
                    ...draft,
                    maxSource: filters.maxPrice,
                    max: value,
                  }));
                }}
              />
            </>
          ) : (
            <p role={settings.isError ? 'alert' : 'status'}>
              {settings.isError
                ? 'Store currency could not be loaded; price filters are unavailable.'
                : 'Loading store currency…'}
            </p>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void applyPrices()}
          >
            Apply price
          </Button>
        </div>
        <Select
          label="Sort by"
          value={filters.sort ?? 'newest'}
          onChange={(event) => updateFilter('sort', event.target.value)}
        >
          <option value="newest">Newest</option>
          <option value="title">Name</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="popular">Most popular</option>
        </Select>
        <div
          className="admin-view-toggle"
          role="group"
          aria-label="Product view"
        >
          <Button
            variant={isGrid ? 'ghost' : 'secondary'}
            size="sm"
            aria-pressed={!isGrid}
            title="Table view"
            onClick={() => updateFilter('view', 'table')}
          >
            <List size={17} /> Table
          </Button>
          <Button
            variant={isGrid ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={isGrid}
            title="Grid view"
            onClick={() => updateFilter('view', 'grid')}
          >
            <LayoutGrid size={17} /> Grid
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
        <Button
          className="admin-filter-apply"
          onClick={() => setFiltersOpen(false)}
        >
          Show products
        </Button>
      </section>
      {canWrite && selected.length ? (
        <div
          className="admin-bulk-bar"
          role="region"
          aria-label="Bulk product actions"
        >
          <span>{selected.length} selected</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setBulkAction('active')}
          >
            Set active
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setBulkAction('draft')}
          >
            Set draft
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setBulkAction('archived')}
          >
            Archive
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </div>
      ) : null}
      {bulkResult ? (
        <p className="admin-result-message" role="status">
          {bulkResult}
        </p>
      ) : null}
      {priceTouched ? (
        <p className="visually-hidden" aria-live="polite">
          Price filter changed. Apply price to search.
        </p>
      ) : null}
      {products.isPending ? (
        <ProductSkeleton />
      ) : products.isError ? (
        <section className="admin-panel">
          <ErrorState title="Products could not be loaded">
            The product list could not be fetched from the API.
          </ErrorState>
          <Button variant="secondary" onClick={() => void products.refetch()}>
            Try again
          </Button>
        </section>
      ) : !items.length ? (
        <section className="admin-panel">
          <AdminEmptyState
            title={
              hasFilters ? 'No products match these filters' : 'No products yet'
            }
          >
            {canWrite && !hasFilters ? (
              <div className="admin-empty-action">
                <Button onClick={openAddProduct}>Add your first product</Button>
              </div>
            ) : (
              <p>Try clearing one or more filters.</p>
            )}
          </AdminEmptyState>
        </section>
      ) : isGrid ? (
        <div className="admin-product-grid">
          {items.map((product) => (
            <ProductCard
              key={product._id}
              product={product}
              canWrite={canWrite}
              onStatus={(status) => void changeStatus(product, status)}
              onDelete={() => setDeleteTarget(product)}
              onStock={() => {
                setStockTarget(product);
                setStockValue(String(product.stock.quantity));
                setStockNote('');
              }}
            />
          ))}
        </div>
      ) : (
        <section className="admin-panel admin-products-table-wrap">
          <div className="admin-products-table-scroll">
            <table className="admin-products-table">
              <thead>
                <tr>
                  {canWrite ? (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all visible products"
                        checked={allVisibleSelected}
                        onChange={(event) => {
                          if (event.target.checked) {
                            const next = [
                              ...new Set([
                                ...selected,
                                ...items.map((item) => item._id),
                              ]),
                            ];
                            if (next.length > 100)
                              toast(
                                'Bulk actions are limited to 100 products. Select fewer products.',
                                'error',
                              );
                            setSelected(next.slice(0, 100));
                          } else
                            setSelected(
                              selected.filter(
                                (id) => !items.some((item) => item._id === id),
                              ),
                            );
                        }}
                      />
                    </th>
                  ) : null}
                  <th>Product</th>
                  <th>SKU</th>
                  <th>
                    <button
                      type="button"
                      onClick={() =>
                        updateFilter(
                          'sort',
                          filters.sort === 'price_asc'
                            ? 'price_desc'
                            : 'price_asc',
                        )
                      }
                    >
                      Price ↕
                    </button>
                  </th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Views / sold</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((product) => (
                  <tr key={product._id}>
                    {canWrite ? (
                      <td data-label="Select">
                        <input
                          type="checkbox"
                          aria-label={`Select ${product.title}`}
                          checked={selected.includes(product._id)}
                          onChange={(event) =>
                            selectProduct(product._id, event.target.checked)
                          }
                        />
                      </td>
                    ) : null}
                    <td data-label="Product">
                      <div className="admin-product-name-cell">
                        <ProductThumbnail product={product} />
                        <span>
                          <Link href={`/admin/products/${product._id}`}>
                            <strong>{product.title}</strong>
                          </Link>
                          <small>
                            {product.productType.replaceAll('_', ' ')}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td data-label="SKU">{product.sku}</td>
                    <td data-label="Price">
                      {formatMoney(product.basePriceMinor, product.currency)}
                    </td>
                    <td data-label="Stock">
                      {stockDescription(product)}
                      {product.stock.trackInventory &&
                      product.stock.quantity > 0 &&
                      product.stock.quantity <=
                        product.stock.lowStockThreshold ? (
                        <small className="admin-low-stock">Low stock</small>
                      ) : null}
                    </td>
                    <td data-label="Status">
                      <ProductStatusBadge status={product.status} />
                    </td>
                    <td data-label="Views / sold">
                      {product.viewCount} / {product.soldCount}
                    </td>
                    <td data-label="Actions">
                      <ProductActions
                        product={product}
                        canWrite={canWrite}
                        onStatus={(status) =>
                          void changeStatus(product, status)
                        }
                        onStock={() => {
                          setStockTarget(product);
                          setStockValue(String(product.stock.quantity));
                          setStockNote('');
                        }}
                        onDelete={() => setDeleteTarget(product)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {pagination && pagination.total > 0 ? (
        <div className="admin-pagination">
          <span>
            Showing {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
            {pagination.total}
          </span>
          <label>
            Page size{' '}
            <select
              value={filters.limit}
              onChange={(event) =>
                updateParams({ limit: event.target.value, page: '1' })
              }
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
          </label>
          <Button
            variant="secondary"
            size="sm"
            disabled={pagination.page <= 1}
            onClick={() => updateParams({ page: String(pagination.page - 1) })}
          >
            <ChevronLeft size={16} /> Previous
          </Button>
          <span>
            Page {pagination.page} of {Math.max(1, pagination.totalPages)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={!pagination.hasNextPage}
            onClick={() => updateParams({ page: String(pagination.page + 1) })}
          >
            Next <ChevronRight size={16} />
          </Button>
        </div>
      ) : null}
      <Modal
        open={Boolean(stockTarget)}
        onClose={() => setStockTarget(null)}
        title={`Adjust stock${stockTarget ? ` · ${stockTarget.title}` : ''}`}
      >
        <form
          className="admin-form"
          onSubmit={(event) => void saveStock(event)}
        >
          <Select
            label="Mode"
            value={stockMode}
            onChange={(event) =>
              setStockMode(event.target.value as 'set' | 'adjust')
            }
          >
            <option value="set">Set quantity</option>
            <option value="adjust">Adjust by delta</option>
          </Select>
          <Input
            label={
              stockMode === 'set'
                ? 'New quantity'
                : 'Adjustment (use a negative value to reduce)'
            }
            type="number"
            step="1"
            value={stockValue}
            onChange={(event) => setStockValue(event.target.value)}
            required
          />
          <Input
            label="Note"
            value={stockNote}
            onChange={(event) => setStockNote(event.target.value)}
            maxLength={500}
            required
          />
          {stockError ? (
            <p className="field-error" role="alert">
              {stockError}
            </p>
          ) : null}
          <Button type="submit">Save stock</Button>
        </form>
      </Modal>
      <Modal
        open={addProductOpen}
        onClose={() => setAddProductOpen(false)}
        title="Choose a product category"
      >
        {categories.isPending ? (
          <p role="status">Loading active categories…</p>
        ) : categories.isError ? (
          <div>
            <ErrorState title="Categories could not be loaded">
              Retry loading categories before choosing one.
            </ErrorState>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void categories.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : activeCategoryOptions.length === 0 ? (
          <p role="status">
            There are no active categories. Activate or create a category before
            adding a product.
          </p>
        ) : (
          <>
            <Select
              label="Category"
              value={newProductCategory}
              onChange={(event) => setNewProductCategory(event.target.value)}
            >
              <option value="">Select a category</option>
              {activeCategoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </Select>
            <div className="button-row">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAddProductOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!newProductCategory}
                onClick={continueToNewProduct}
              >
                Continue
              </Button>
            </div>
          </>
        )}
      </Modal>
      <AdminConfirmDialog
        open={Boolean(bulkAction)}
        title="Confirm bulk status change"
        onClose={() => setBulkAction(null)}
        onConfirm={() => void applyBulkStatus()}
      >{`Set ${selected.length} selected products to ${bulkAction ?? 'the selected status'}? Activating requires each product to pass the server's readiness checks.`}</AdminConfirmDialog>
      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete or archive product?"
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void deleteProduct()}
      >{`The server permanently deletes “${deleteTarget?.title ?? 'this product'}” only when it has no order history. Products used by orders are archived instead; the API response will state what happened.`}</AdminConfirmDialog>
    </>
  );
}

function ProductThumbnail({ product }: { product: AdminProductListItem }) {
  const primary =
    product.media?.find((media) => media.isPrimary) ?? product.media?.[0];
  const source = primary?.variants?.thumb ?? primary?.url;
  return source ? (
    <img className="admin-product-thumbnail" src={source} alt="" />
  ) : (
    <span
      className="admin-product-thumbnail is-empty"
      aria-label="No product image"
    >
      <Package size={22} />
    </span>
  );
}

function ProductCard({
  product,
  canWrite,
  onStatus,
  onDelete,
  onStock,
}: {
  product: AdminProductListItem;
  canWrite: boolean;
  onStatus: (status: ProductStatus) => void;
  onDelete: () => void;
  onStock: () => void;
}) {
  return (
    <article className="admin-product-card">
      <ProductThumbnail product={product} />
      <div className="admin-product-card__body">
        <div className="admin-product-card__title">
          <Link href={`/admin/products/${product._id}`}>
            <strong>{product.title}</strong>
          </Link>
          <ProductStatusBadge status={product.status} />
        </div>
        <small>{product.sku}</small>
        <strong>{formatMoney(product.basePriceMinor, product.currency)}</strong>
      </div>
      <ProductActions
        product={product}
        canWrite={canWrite}
        onStatus={onStatus}
        onDelete={onDelete}
        onStock={onStock}
      />
    </article>
  );
}

function ProductActions({
  product,
  canWrite,
  onStatus,
  onDelete,
  onStock,
}: {
  product: AdminProductListItem;
  canWrite: boolean;
  onStatus: (status: ProductStatus) => void;
  onDelete: () => void;
  onStock: () => void;
}) {
  return (
    <div
      className="admin-icon-actions"
      role="group"
      aria-label={`Actions for ${product.title}`}
    >
      <Link
        className="admin-icon-link"
        href={`/admin/products/${product._id}`}
        aria-label={`Edit ${product.title}`}
        title="Edit product"
      >
        <Pencil size={16} aria-hidden="true" />
      </Link>
      {canWrite ? (
        <>
          <AdminIconButton
            label={`Adjust stock for ${product.title}`}
            onClick={onStock}
          >
            <Package size={16} aria-hidden="true" />
          </AdminIconButton>
          <AdminIconButton
            label={
              product.status === 'active'
                ? `Set ${product.title} to draft`
                : `Set ${product.title} active`
            }
            onClick={() =>
              onStatus(product.status === 'active' ? 'draft' : 'active')
            }
          >
            {product.status === 'active' ? (
              <Pause size={16} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={16} aria-hidden="true" />
            )}
          </AdminIconButton>
          {product.status === 'active' ? (
            <a
              className="admin-icon-link"
              href={`/product/${product.slug}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${product.title} on storefront`}
              title="View on storefront"
            >
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          ) : null}
          <AdminIconButton
            label={`Archive ${product.title}`}
            onClick={() => onStatus('archived')}
          >
            <Archive size={16} aria-hidden="true" />
          </AdminIconButton>
          <AdminIconButton
            label={`Delete ${product.title}`}
            danger
            onClick={onDelete}
          >
            <Trash2 size={16} aria-hidden="true" />
          </AdminIconButton>
        </>
      ) : null}
    </div>
  );
}

function ProductSkeleton() {
  return (
    <section
      className="admin-panel admin-product-skeleton"
      role="status"
      aria-label="Loading products"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <span className="loading-skeleton" key={index} />
      ))}
    </section>
  );
}
