import type {
  ApiFailure,
  ApiSuccess,
  AdminDashboard,
  AdminCategory,
  AdminMessageDetail,
  AdminMessageList,
  AdminMessageStatus,
  CustomRequestStatus,
  AdminMessageType,
  AdminOrderDetail,
  AdminOrderList,
  AdminOrderStatus,
  AdminPrintQueue,
  AdminArtworkListItem,
  AdminAboutMedia,
  AdminReviewListItem,
  AdminCustomerDetail,
  AdminCustomerListItem,
  AdminStaffList,
  AdminSettings,
  AdminNotifications,
  AdminProduct,
  AdminProductList,
  AdminSearchResult,
  AuthResponse,
  AuthCredentials,
  ProfileUpdateInput,
  CartSummary,
  CartView,
  CheckoutPreview,
  ContactMessageInput,
  CustomerCustomRequest,
  CustomerCustomRequestSummary,
  CustomOfferSummary,
  CustomProductRequestInput,
  CreateOrderInput,
  CustomerOrder,
  CustomerOrderList,
  CreatedReview,
  Category,
  CategoriesResponse,
  DashboardRange,
  ProductStatus,
  ProductTheme,
  NewsletterInput,
  RegisterInput,
  SearchSuggestion,
  SiteSettings,
  ArtworkMetadata,
  CatalogPage,
  CatalogQuery,
  ProductQuote,
  ProductReviews,
  PublicFaqs,
  MessageToken,
  PublicProduct,
  WishlistResponse,
} from './types';
import { isSearchSuggestion, normalizeCategoryList } from './normalizers';

export class ApiError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly status: number;

  constructor(message: string, code: string, details: unknown, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

function unwrapObject<T>(value: unknown, key: string): T {
  if (!isRecord(value) || !(key in value)) {
    throw invalidResponseError(200);
  }
  return value[key] as T;
}

function normalizeAdminCategoryTree(flat: AdminCategory[]): AdminCategory[] {
  const nodes = new Map<string, AdminCategory>();
  for (const category of flat) {
    nodes.set(category._id, { ...category, children: [] });
  }
  const roots: AdminCategory[] = [];
  for (const node of nodes.values()) {
    const parentId = node.parent;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function apiQuery(params: object) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export interface ProductWriteInput {
  title: string;
  slug?: string;
  description: string;
  category: string;
  productType: AdminProduct['productType'];
  media: Array<
    Pick<
      AdminProduct['media'][number],
      'url' | 'alt' | 'view' | 'isPrimary' | 'lightingState'
    >
  >;
  lightingGalleryEnabled?: boolean;
  sku: string;
  basePriceMinor: number;
  compareAtPriceMinor?: number;
  currency: string;
  optionGroups: AdminProduct['optionGroups'];
  quantityPricing: AdminProduct['quantityPricing'];
  printTechniques: string[];
  specifications: AdminProduct['specifications'];
  artworkRequirements: AdminProduct['artworkRequirements'];
  artworkRequired: boolean;
  stock: AdminProduct['stock'];
  status: ProductStatus;
  themes?: ProductTheme[];
  seo: AdminProduct['seo'];
  leadTimeDays?: number;
  madeToOrder?: boolean;
  ecoNote?: string;
  isFeatured: boolean;
  minOrderQuantity: number;
  maxOrderQuantity?: number;
}

export interface AdminProductFilters {
  q?: string;
  category?: string;
  status?: ProductStatus;
  minPrice?: number;
  maxPrice?: number;
  stockState?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'made_to_order';
  sort?: 'newest' | 'title' | 'price_asc' | 'price_desc' | 'popular';
  page?: number;
  limit?: number;
}

export function uploadAdminProductImage(
  productId: string,
  input: {
    file: File;
    alt: string;
    view: AdminProduct['media'][number]['view'];
    isPrimary: boolean;
    lightingState?: AdminProduct['media'][number]['lightingState'];
  },
  onProgress: (progress: number) => void,
): Promise<AdminProduct['media'][number]> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      'POST',
      `/api/admin/products/${encodeURIComponent(productId)}/media`,
    );
    request.withCredentials = true;
    request.setRequestHeader('X-Requested-With', 'dainty-bloom');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () =>
      reject(
        new ApiError('The API could not be reached.', 'NETWORK_ERROR', null, 0),
      );
    request.onload = () => {
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText) as unknown;
      } catch {
        reject(invalidResponseError(request.status));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        const error =
          isRecord(payload) && isRecord(payload.error)
            ? payload.error
            : undefined;
        reject(
          new ApiError(
            typeof error?.message === 'string'
              ? error.message
              : 'The request could not be completed.',
            typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
            error?.details ?? null,
            request.status,
          ),
        );
        return;
      }
      if (
        !isRecord(payload) ||
        payload.success !== true ||
        !isRecord(payload.data)
      ) {
        reject(invalidResponseError(request.status));
        return;
      }
      try {
        resolve(
          unwrapObject<AdminProduct['media'][number]>(payload.data, 'media'),
        );
      } catch (error) {
        reject(error);
      }
    };
    const body = new FormData();
    body.append('file', input.file);
    body.append('alt', input.alt);
    body.append('view', input.view);
    body.append('isPrimary', String(input.isPrimary));
    if (input.lightingState) body.append('lightingState', input.lightingState);
    request.send(body);
  });
}

export function uploadAdminAboutMedia(
  input: {
    file: File;
    title?: string;
    description?: string;
    altText?: string;
  },
  onProgress: (progress: number) => void,
): Promise<AdminAboutMedia> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/admin/about-media');
    request.withCredentials = true;
    request.setRequestHeader('X-Requested-With', 'dainty-bloom');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () =>
      reject(
        new ApiError('The API could not be reached.', 'NETWORK_ERROR', null, 0),
      );
    request.onload = () => {
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText) as unknown;
      } catch {
        reject(invalidResponseError(request.status));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        const error =
          isRecord(payload) && isRecord(payload.error)
            ? payload.error
            : undefined;
        reject(
          new ApiError(
            typeof error?.message === 'string'
              ? error.message
              : 'The request could not be completed.',
            typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
            error?.details ?? null,
            request.status,
          ),
        );
        return;
      }
      if (
        !isRecord(payload) ||
        payload.success !== true ||
        !isRecord(payload.data)
      ) {
        reject(invalidResponseError(request.status));
        return;
      }
      try {
        resolve(unwrapObject<AdminAboutMedia>(payload.data, 'media'));
      } catch (error) {
        reject(error);
      }
    };
    const body = new FormData();
    body.append('file', input.file);
    if (input.title !== undefined) body.append('title', input.title);
    if (input.description !== undefined)
      body.append('description', input.description);
    if (input.altText !== undefined) body.append('altText', input.altText);
    request.send(body);
  });
}

export function uploadArtwork(
  file: File,
  onProgress: (progress: number) => void,
): Promise<ArtworkMetadata> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/artwork');
    request.withCredentials = true;
    request.setRequestHeader('X-Requested-With', 'dainty-bloom');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () =>
      reject(
        new ApiError('The API could not be reached.', 'NETWORK_ERROR', null, 0),
      );
    request.onload = () => {
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText) as unknown;
      } catch {
        reject(invalidResponseError(request.status));
        return;
      }
      if (
        request.status < 200 ||
        request.status >= 300 ||
        !isRecord(payload) ||
        payload.success !== true ||
        !isRecord(payload.data)
      ) {
        const error =
          isRecord(payload) && isRecord(payload.error)
            ? payload.error
            : undefined;
        reject(
          new ApiError(
            typeof error?.message === 'string'
              ? error.message
              : 'The upload could not be completed.',
            typeof error?.code === 'string'
              ? error.code
              : 'INVALID_API_RESPONSE',
            error?.details ?? null,
            request.status,
          ),
        );
        return;
      }
      resolve(payload.data as unknown as ArtworkMetadata);
    };
    const body = new FormData();
    body.append('file', file);
    request.send(body);
  });
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  retryAuth?: boolean;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
let refreshInFlight: Promise<void> | null = null;

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

function serializeBody(body: unknown): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (isFormData(body)) return body;
  const serialized = JSON.stringify(body);
  if (serialized === undefined) {
    throw new TypeError('Request body could not be serialized.');
  }
  return serialized;
}

function refreshSession(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = request<{ message: string }>(
      '/auth/refresh',
      { method: 'POST' },
      false,
    )
      .then(() => undefined)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { retryAuth = true, ...requestOptions } = options;
  return request<T>(path, requestOptions, retryAuth);
}

let cachedMessageToken: MessageToken | null = null;
let messageTokenRequest: Promise<MessageToken> | null = null;

function getMessageToken(forceRefresh = false): Promise<MessageToken> {
  if (forceRefresh) cachedMessageToken = null;

  const tokenAge = cachedMessageToken
    ? Date.now() - Date.parse(cachedMessageToken.issuedAt)
    : Number.NaN;
  if (
    cachedMessageToken &&
    Number.isFinite(tokenAge) &&
    tokenAge >= 0 &&
    tokenAge < 9 * 60 * 1000
  ) {
    return Promise.resolve(cachedMessageToken);
  }
  if (messageTokenRequest) return messageTokenRequest;

  messageTokenRequest = apiRequest<MessageToken>('/messages/token', {
    retryAuth: false,
  })
    .then((token) => {
      cachedMessageToken = token;
      return token;
    })
    .finally(() => {
      messageTokenRequest = null;
    });
  return messageTokenRequest;
}

async function request<T>(
  path: string,
  options: RequestOptions,
  retryAuth: boolean,
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  const multipartBody = isFormData(options.body);
  if (options.body !== undefined && !multipartBody)
    headers.set('Content-Type', 'application/json');
  if (MUTATING_METHODS.has(method)) {
    headers.set('X-Requested-With', 'dainty-bloom');
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      method,
      headers,
      body: serializeBody(options.body),
      credentials: 'include',
    });
  } catch {
    throw new ApiError(
      'The API could not be reached.',
      'NETWORK_ERROR',
      null,
      0,
    );
  }

  const canRefreshAuthRequest =
    path === '/auth/me' && response.status === 401 && retryAuth;
  const canRefreshRequest =
    response.status === 401 &&
    retryAuth &&
    (!path.startsWith('/auth/') || canRefreshAuthRequest);
  if (canRefreshRequest) {
    try {
      await refreshSession();
    } catch {
      window.dispatchEvent(new Event('auth:logged-out'));
      throw await toApiError(response);
    }
    if (!SAFE_METHODS.has(method)) throw await toApiError(response);
    try {
      return await request<T>(path, options, false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        window.dispatchEvent(new Event('auth:logged-out'));
      }
      throw error;
    }
  }

  if (!response.ok) throw await toApiError(response);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw invalidResponseError(response.status);
  }
  if (!isRecord(payload)) throw invalidResponseError(response.status);
  if (payload.success === false) {
    if (!isApiFailure(payload)) throw invalidResponseError(response.status);
    throw new ApiError(
      payload.error.message,
      payload.error.code,
      payload.error.details,
      response.status,
    );
  }
  if (!isApiSuccess<T>(payload)) throw invalidResponseError(response.status);
  return payload.data;
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: ApiFailure | undefined;
  try {
    payload = (await response.json()) as ApiFailure;
  } catch {
    payload = undefined;
  }
  return new ApiError(
    payload?.error?.message ?? 'The request could not be completed.',
    payload?.error?.code ?? 'REQUEST_FAILED',
    payload?.error?.details ?? null,
    response.status,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiFailure(value: unknown): value is ApiFailure {
  if (!isRecord(value) || value.success !== false || !isRecord(value.error)) {
    return false;
  }
  return (
    typeof value.error.message === 'string' &&
    typeof value.error.code === 'string'
  );
}

function isApiSuccess<T>(value: unknown): value is ApiSuccess<T> {
  return isRecord(value) && value.success === true && 'data' in value;
}

function invalidResponseError(status: number) {
  return new ApiError(
    'The API returned an invalid response.',
    'INVALID_API_RESPONSE',
    null,
    status,
  );
}

export const api = {
  settings: () => apiRequest<SiteSettings>('/settings/public'),
  categories: async (): Promise<Category[]> => {
    const data = await apiRequest<CategoriesResponse>('/categories');
    if (!data || !Array.isArray(data.categories)) {
      throw invalidResponseError(200);
    }
    return normalizeCategoryList(data.categories);
  },
  cartSummary: () => apiRequest<CartSummary>('/cart/summary'),
  cart: () => apiRequest<CartView>('/cart'),
  updateCartItem: (
    itemId: string,
    input: {
      quantity?: number;
      selectedOptions?: Array<{ key: string; value: string }>;
      artworkId?: string | null;
    },
  ) =>
    apiRequest<CartView>(`/cart/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: input,
    }),
  removeCartItem: (itemId: string) =>
    apiRequest<CartView>(`/cart/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
    }),
  clearCart: () => apiRequest<CartView>('/cart', { method: 'DELETE' }),
  checkoutPreview: () => apiRequest<CheckoutPreview>('/checkout/preview'),
  createOrder: (input: CreateOrderInput, idempotencyKey: string) =>
    apiRequest<{ order: CustomerOrder }>('/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: input,
    }).then((data) => unwrapObject<CustomerOrder>(data, 'order')),
  startOrderPayment: async (orderNumber: string, email?: string) => {
    const data = await apiRequest<unknown>(
      `/orders/${encodeURIComponent(orderNumber)}/pay`,
      { method: 'POST', body: email ? { email } : {} },
    );
    if (
      !isRecord(data) ||
      typeof data.checkoutUrl !== 'string' ||
      typeof data.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(data.expiresAt))
    ) {
      throw invalidResponseError(200);
    }

    let checkoutUrl: URL;
    try {
      checkoutUrl = new URL(data.checkoutUrl);
    } catch {
      throw invalidResponseError(200);
    }
    if (
      checkoutUrl.protocol !== 'https:' ||
      checkoutUrl.hostname.toLowerCase() !== 'checkout.stripe.com'
    ) {
      throw invalidResponseError(200);
    }

    return { checkoutUrl: checkoutUrl.href, expiresAt: data.expiresAt };
  },
  confirmOrderPayment: (orderNumber: string, email?: string) =>
    apiRequest<{ status: string }>(
      `/orders/${encodeURIComponent(orderNumber)}/payment/confirm`,
      { method: 'POST', body: email ? { email } : {} },
    ),
  orderPaymentStatus: (orderNumber: string, email?: string) =>
    apiRequest<{ status: string; orderStatus: string }>(
      `/orders/${encodeURIComponent(orderNumber)}/payment-status${apiQuery({ email })}`,
    ),
  customerOrders: (query: { page?: number; limit?: number; status?: string }) =>
    apiRequest<CustomerOrderList>(`/orders${apiQuery(query)}`),
  customerCustomRequests: () =>
    apiRequest<{ requests: CustomerCustomRequestSummary[] }>(
      '/messages/custom-requests',
    ).then((data) => data.requests),
  customerCustomRequest: async (id: string) =>
    unwrapObject<CustomerCustomRequest>(
      await apiRequest<{ request: CustomerCustomRequest }>(
        `/messages/custom-requests/${encodeURIComponent(id)}`,
      ),
      'request',
    ),
  customerOrder: async (orderNumber: string) =>
    unwrapObject<CustomerOrder>(
      await apiRequest<{ order: CustomerOrder }>(
        `/orders/${encodeURIComponent(orderNumber)}`,
      ),
      'order',
    ),
  lookupOrder: async (orderNumber: string, email: string) =>
    unwrapObject<CustomerOrder>(
      await apiRequest<{ order: CustomerOrder }>('/orders/lookup', {
        method: 'POST',
        body: { orderNumber, email },
        retryAuth: false,
      }),
      'order',
    ),
  cancelCustomerOrder: async (orderNumber: string, email?: string) =>
    unwrapObject<CustomerOrder>(
      await apiRequest<{ order: CustomerOrder }>(
        `/orders/${encodeURIComponent(orderNumber)}/cancel`,
        { method: 'POST', body: email ? { email } : {} },
      ),
      'order',
    ),
  replaceCustomerOrderArtwork: async (
    orderNumber: string,
    itemId: string,
    artworkId: string,
    email?: string,
  ) =>
    unwrapObject<CustomerOrder>(
      await apiRequest<{ order: CustomerOrder }>(
        `/orders/${encodeURIComponent(orderNumber)}/items/${encodeURIComponent(itemId)}/artwork`,
        { method: 'POST', body: { artworkId, ...(email ? { email } : {}) } },
      ),
      'order',
    ),
  catalogProducts: (query: CatalogQuery = {}) =>
    apiRequest<CatalogPage>(`/products${apiQuery(query)}`),
  featuredProducts: (limit = 12) =>
    apiRequest<CatalogPage>(`/products/featured${apiQuery({ limit })}`),
  newProducts: (limit = 12) =>
    apiRequest<CatalogPage>(`/products/new${apiQuery({ limit })}`),
  category: async (slug: string) =>
    unwrapObject<Category>(
      await apiRequest<{ category: Category }>(
        `/categories/${encodeURIComponent(slug)}`,
      ),
      'category',
    ),
  product: async (slug: string) =>
    unwrapObject<PublicProduct>(
      await apiRequest<{ product: PublicProduct }>(
        `/products/${encodeURIComponent(slug)}`,
      ),
      'product',
    ),
  quote: (
    slug: string,
    input: {
      selectedOptions: Array<{ key: string; value: string }>;
      quantity: number;
    },
  ) =>
    apiRequest<ProductQuote>(`/products/${encodeURIComponent(slug)}/quote`, {
      method: 'POST',
      body: input,
    }),
  addCartItem: (input: {
    productId: string;
    selectedOptions: Array<{ key: string; value: string }>;
    quantity: number;
    artworkId?: string;
  }) => apiRequest<CartView>('/cart/items', { method: 'POST', body: input }),
  wishlist: () => apiRequest<WishlistResponse>('/wishlist'),
  addWishlistItem: (productId: string) =>
    apiRequest<WishlistResponse>('/wishlist/items', {
      method: 'POST',
      body: { productId },
    }),
  removeWishlistItem: (productId: string) =>
    apiRequest<WishlistResponse>(
      `/wishlist/items/${encodeURIComponent(productId)}`,
      { method: 'DELETE' },
    ),
  removeArtwork: (id: string) =>
    apiRequest<{ deleted: boolean }>(`/artwork/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  reviews: (
    slug: string,
    query: {
      page?: number;
      limit?: number;
      sort?: 'newest' | 'highest' | 'lowest';
    } = {},
  ) =>
    apiRequest<ProductReviews>(
      `/products/${encodeURIComponent(slug)}/reviews${apiQuery(query)}`,
    ),
  reviewEligibility: (slug: string) =>
    apiRequest<{ canReview: boolean; reason: string | null }>(
      `/products/${encodeURIComponent(slug)}/reviews/eligibility`,
    ),
  createReview: (
    slug: string,
    input: { rating: number; title: string; body: string },
  ) =>
    apiRequest<CreatedReview>(`/products/${encodeURIComponent(slug)}/reviews`, {
      method: 'POST',
      body: input,
    }),
  faqs: () => apiRequest<PublicFaqs>('/faqs'),
  messageToken: (forceRefresh = false) => getMessageToken(forceRefresh),
  submitContactMessage: (input: ContactMessageInput) => {
    const body = new FormData();
    body.set('name', input.name);
    body.set('email', input.email);
    body.set('subject', input.subject);
    body.set('message', input.message);
    body.set('token', input.token);
    body.set('type', 'general');
    body.set('website', input.website ?? '');
    if (input.submissionId) body.set('submissionId', input.submissionId);
    if (input.orderNumber) body.set('orderNumber', input.orderNumber);
    return apiRequest<{ message: string }>('/messages', {
      method: 'POST',
      body,
      retryAuth: false,
    });
  },
  submitCustomProductRequest: (input: CustomProductRequestInput) => {
    const body = new FormData();
    body.set('name', input.name);
    body.set('email', input.email);
    body.set('subject', input.subject);
    body.set('message', input.message);
    body.set('token', input.token);
    body.set('type', 'custom_3d_request');
    body.set('website', input.website ?? '');
    body.set('requestDetails', JSON.stringify(input.requestDetails));
    body.set('imagePurpose', input.imagePurpose);
    if (input.referenceImage) body.set('referenceImage', input.referenceImage);
    return apiRequest<{ message: string }>('/messages', {
      method: 'POST',
      body,
      retryAuth: false,
    });
  },
  suggestions: async (
    query: string,
  ): Promise<{ suggestions: SearchSuggestion[] }> => {
    const data = await apiRequest<{ suggestions: SearchSuggestion[] }>(
      `/products/search-suggestions?q=${encodeURIComponent(query)}`,
    );
    return {
      suggestions: Array.isArray(data?.suggestions)
        ? data.suggestions.filter(isSearchSuggestion)
        : [],
    };
  },
  me: () => apiRequest<AuthResponse>('/auth/me'),
  updateProfile: (input: ProfileUpdateInput) =>
    apiRequest<{ user: AuthResponse['user'] }>('/auth/me', {
      method: 'PATCH',
      body: input,
    }),
  login: (input: AuthCredentials) =>
    apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: input,
      retryAuth: false,
    }),
  adminCategories: async (): Promise<AdminCategory[]> => {
    const data = await apiRequest<{ categories: AdminCategory[] }>(
      '/admin/categories',
    );
    if (!Array.isArray(data?.categories)) throw invalidResponseError(200);
    return normalizeAdminCategoryTree(data.categories);
  },
  createAdminCategory: async (
    input: Omit<
      AdminCategory,
      '_id' | 'children' | 'productCount' | 'createdAt' | 'updatedAt'
    >,
  ) =>
    unwrapObject<AdminCategory>(
      await apiRequest<{ category: AdminCategory }>('/admin/categories', {
        method: 'POST',
        body: input,
      }),
      'category',
    ),
  updateAdminCategory: async (
    id: string,
    input: Partial<
      Omit<
        AdminCategory,
        '_id' | 'children' | 'productCount' | 'createdAt' | 'updatedAt'
      >
    >,
  ) =>
    unwrapObject<AdminCategory>(
      await apiRequest<{ category: AdminCategory }>(
        `/admin/categories/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: input },
      ),
      'category',
    ),
  deleteAdminCategory: (id: string) =>
    apiRequest<{ message: string }>(
      `/admin/categories/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  adminProducts: (filters: AdminProductFilters) =>
    apiRequest<AdminProductList>(`/admin/products${apiQuery({ ...filters })}`),
  adminMessages: (filters: {
    page?: number;
    limit?: number;
    status?: AdminMessageStatus;
    type?: AdminMessageType;
    q?: string;
  }) => apiRequest<AdminMessageList>(`/admin/messages${apiQuery(filters)}`),
  updateAdminMessage: (
    id: string,
    input: { status?: AdminMessageStatus; assignedTo?: string | null },
  ) =>
    apiRequest<{ message: AdminMessageDetail }>(
      `/admin/messages/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: input },
    ).then((data) => unwrapObject<AdminMessageDetail>(data, 'message')),
  transitionAdminCustomRequest: (
    id: string,
    input: {
      status: Extract<
        CustomRequestStatus,
        'under_review' | 'accepted' | 'declined'
      >;
      message?: string;
    },
  ) =>
    apiRequest<{ message: AdminMessageDetail }>(
      `/admin/messages/${encodeURIComponent(id)}/custom-request-lifecycle`,
      { method: 'POST', body: input },
    ).then((data) => unwrapObject<AdminMessageDetail>(data, 'message')),
  createAdminCustomOffer: async (id: string, input: FormData) =>
    unwrapObject<CustomOfferSummary>(
      await apiRequest<{ offer: CustomOfferSummary }>(
        `/admin/messages/${encodeURIComponent(id)}/custom-offer`,
        { method: 'POST', body: input },
      ),
      'offer',
    ),
  replyAdminMessage: (
    id: string,
    input: { body: string; quotedPriceMinor?: number; note?: string },
  ) =>
    apiRequest<{ message: AdminMessageDetail }>(
      `/admin/messages/${encodeURIComponent(id)}/reply`,
      { method: 'POST', body: input },
    ).then((data) => unwrapObject<AdminMessageDetail>(data, 'message')),
  adminOrders: (query: {
    page?: number;
    limit?: number;
    tab?: string;
    q?: string;
    sort?: string;
  }) => apiRequest<AdminOrderList>(`/admin/orders${apiQuery(query)}`),
  adminOrder: async (id: string) =>
    unwrapObject<AdminOrderDetail>(
      await apiRequest<{ order: AdminOrderDetail }>(
        `/admin/orders/${encodeURIComponent(id)}`,
      ),
      'order',
    ),
  updateAdminOrderStatus: (
    id: string,
    input: { status: AdminOrderStatus; note?: string },
  ) =>
    apiRequest<{ order: AdminOrderDetail }>(
      `/admin/orders/${encodeURIComponent(id)}/status`,
      { method: 'PATCH', body: input },
    ).then((data) => unwrapObject<AdminOrderDetail>(data, 'order')),
  cancelAdminOrder: (id: string, input: { reason: string; restock: boolean }) =>
    apiRequest<{ order: AdminOrderDetail }>(
      `/admin/orders/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', body: input },
    ).then((data) => unwrapObject<AdminOrderDetail>(data, 'order')),
  dispatchAdminOrder: (
    id: string,
    input: {
      carrier: string;
      trackingNumber: string;
      trackingUrl?: string;
      note?: string;
    },
  ) =>
    apiRequest<{ order: AdminOrderDetail }>(
      `/admin/orders/${encodeURIComponent(id)}/dispatch`,
      { method: 'POST', body: input },
    ).then((data) => unwrapObject<AdminOrderDetail>(data, 'order')),
  completeAdminOrder: (id: string, note?: string) =>
    apiRequest<{ order: AdminOrderDetail }>(
      `/admin/orders/${encodeURIComponent(id)}/complete`,
      { method: 'POST', body: note ? { note } : {} },
    ).then((data) => unwrapObject<AdminOrderDetail>(data, 'order')),
  addAdminOrderNote: (id: string, note: string) =>
    apiRequest<{ order: AdminOrderDetail }>(
      `/admin/orders/${encodeURIComponent(id)}/notes`,
      { method: 'POST', body: { note } },
    ).then((data) => unwrapObject<AdminOrderDetail>(data, 'order')),
  refundAdminOrder: (
    id: string,
    input: { amountMinor: number; reason: string; reference?: string },
  ) =>
    apiRequest<{ order: AdminOrderDetail }>(
      `/admin/orders/${encodeURIComponent(id)}/refund`,
      { method: 'POST', body: input },
    ).then((data) => unwrapObject<AdminOrderDetail>(data, 'order')),
  adminPrintQueue: (
    query: {
      status?: string;
      technique?: string;
      q?: string;
      page?: number;
      limit?: number;
    } = {},
  ) =>
    apiRequest<AdminPrintQueue>(`/admin/orders/print-queue${apiQuery(query)}`),
  updateAdminPrintStatus: (
    orderId: string,
    itemId: string,
    input: {
      status: 'queued' | 'printing' | 'printed' | 'quality_check' | 'ready';
      note?: string;
    },
  ) =>
    apiRequest<{ order: AdminOrderDetail }>(
      `/admin/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/print-status`,
      { method: 'PATCH', body: input },
    ).then((data) => unwrapObject<AdminOrderDetail>(data, 'order')),
  adminArtwork: (
    query: {
      page?: number;
      limit?: number;
      reviewStatus?: string;
      orderNumber?: string;
      from?: string;
      to?: string;
    } = {},
  ) =>
    apiRequest<{
      items: AdminArtworkListItem[];
      pagination: AdminMessageList['pagination'];
    }>(`/admin/artwork${apiQuery(query)}`),
  adminAboutMedia: () =>
    apiRequest<{ media: AdminAboutMedia[] }>('/admin/about-media').then(
      (data) => unwrapObject<AdminAboutMedia[]>(data, 'media'),
    ),
  uploadAdminAboutMedia,
  updateAdminAboutMedia: (
    id: string,
    input: {
      title?: string;
      description?: string;
      altText?: string;
      isPublished?: boolean;
    },
  ) =>
    apiRequest<{ media: AdminAboutMedia }>(
      `/admin/about-media/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: input },
    ).then((data) => unwrapObject<AdminAboutMedia>(data, 'media')),
  reorderAdminAboutMedia: (mediaIds: string[]) =>
    apiRequest<{ reordered: boolean }>('/admin/about-media/order', {
      method: 'PUT',
      body: { mediaIds },
    }),
  deleteAdminAboutMedia: (id: string) =>
    apiRequest<{ deleted: boolean }>(
      `/admin/about-media/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  reviewAdminArtwork: (
    id: string,
    input: { decision: 'approved' | 'replacement_requested'; note?: string },
  ) =>
    apiRequest<{ artwork: AdminArtworkListItem }>(
      `/admin/artwork/${encodeURIComponent(id)}/review`,
      { method: 'PATCH', body: input },
    ).then((data) => unwrapObject<AdminArtworkListItem>(data, 'artwork')),
  artworkDownloadLink: (id: string) =>
    apiRequest<{ downloadUrl: string; expiresAt: string }>(
      `/artwork/${encodeURIComponent(id)}/download-link`,
      { method: 'POST', body: {} },
    ),
  adminReviews: (
    query: {
      page?: number;
      limit?: number;
      moderationState?: string;
      rating?: number;
    } = {},
  ) =>
    apiRequest<{
      items: AdminReviewListItem[];
      pagination: AdminMessageList['pagination'];
    }>(`/admin/reviews${apiQuery(query)}`),
  moderateAdminReview: (
    id: string,
    input: { decision: 'approved' | 'rejected'; reason?: string },
  ) =>
    apiRequest<{
      id: string;
      moderationState: string;
      moderationReason: string | null;
    }>(`/admin/reviews/${encodeURIComponent(id)}/moderate`, {
      method: 'PATCH',
      body: input,
    }),
  adminCustomers: (query: { page?: number; limit?: number; q?: string } = {}) =>
    apiRequest<{
      items: AdminCustomerListItem[];
      pagination: AdminMessageList['pagination'];
    }>(`/admin/customers${apiQuery(query)}`),
  adminCustomer: (id: string) =>
    apiRequest<AdminCustomerDetail>(
      `/admin/customers/${encodeURIComponent(id)}`,
    ),
  adminStaff: (query: { page?: number; limit?: number } = {}) =>
    apiRequest<AdminStaffList>(`/admin/staff${apiQuery(query)}`),
  createAdminStaff: (input: {
    name: string;
    email: string;
    role: 'admin' | 'production' | 'support';
  }) =>
    apiRequest<{ staff: AdminStaffList['items'][number] }>('/admin/staff', {
      method: 'POST',
      body: input,
    }).then((data) =>
      unwrapObject<AdminStaffList['items'][number]>(data, 'staff'),
    ),
  updateAdminStaff: (
    id: string,
    input: {
      role?: 'admin' | 'production' | 'support';
      accountState?: 'active' | 'suspended';
    },
  ) =>
    apiRequest<{ staff: AdminStaffList['items'][number] }>(
      `/admin/staff/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: input },
    ).then((data) =>
      unwrapObject<AdminStaffList['items'][number]>(data, 'staff'),
    ),
  adminSettings: () => apiRequest<AdminSettings>('/admin/settings'),
  updateAdminSettings: (input: Partial<AdminSettings>) =>
    apiRequest<AdminSettings>('/admin/settings', {
      method: 'PATCH',
      body: input,
    }),
  adminMessage: async (id: string) =>
    unwrapObject<AdminMessageDetail>(
      await apiRequest<{ message: AdminMessageDetail }>(
        `/admin/messages/${encodeURIComponent(id)}`,
      ),
      'message',
    ),
  adminProduct: async (id: string) =>
    unwrapObject<AdminProduct>(
      await apiRequest<{ product: AdminProduct }>(
        `/admin/products/${encodeURIComponent(id)}`,
      ),
      'product',
    ),
  createAdminProduct: async (input: ProductWriteInput) =>
    unwrapObject<AdminProduct>(
      await apiRequest<{ product: AdminProduct }>('/admin/products', {
        method: 'POST',
        body: input,
      }),
      'product',
    ),
  updateAdminProduct: async (id: string, input: Partial<ProductWriteInput>) =>
    unwrapObject<AdminProduct>(
      await apiRequest<{ product: AdminProduct }>(
        `/admin/products/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: input },
      ),
      'product',
    ),
  setAdminProductStatus: async (id: string, status: ProductStatus) =>
    unwrapObject<AdminProduct>(
      await apiRequest<{ product: AdminProduct }>(
        `/admin/products/${encodeURIComponent(id)}/status`,
        { method: 'PATCH', body: { status } },
      ),
      'product',
    ),
  adjustAdminProductStock: async (
    id: string,
    input: {
      mode: 'set' | 'adjust';
      quantity?: number;
      delta?: number;
      note: string;
    },
  ) =>
    unwrapObject<AdminProduct>(
      await apiRequest<{ product: AdminProduct }>(
        `/admin/products/${encodeURIComponent(id)}/stock`,
        { method: 'PATCH', body: input },
      ),
      'product',
    ),
  bulkAdminProductStatus: (ids: string[], status: ProductStatus) =>
    apiRequest<{ updated: number }>('/admin/products/bulk-status', {
      method: 'POST',
      body: { ids, status },
    }),
  deleteAdminProduct: (id: string) =>
    apiRequest<{ archived: boolean; message: string }>(
      `/admin/products/${encodeURIComponent(id)}?confirm=true`,
      { method: 'DELETE' },
    ),
  updateProductMedia: async (
    productId: string,
    mediaId: string,
    input: Partial<AdminProduct['media'][number]>,
  ) =>
    unwrapObject<AdminProduct['media'][number]>(
      await apiRequest<{ media: AdminProduct['media'][number] }>(
        `/admin/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(mediaId)}`,
        { method: 'PATCH', body: input },
      ),
      'media',
    ),
  reorderProductMedia: (productId: string, mediaIds: string[]) =>
    apiRequest<{ reordered: boolean }>(
      `/admin/products/${encodeURIComponent(productId)}/media/order`,
      { method: 'PUT', body: { mediaIds } },
    ),
  deleteProductMedia: (productId: string, mediaId: string) =>
    apiRequest<{ deleted: boolean }>(
      `/admin/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(mediaId)}`,
      { method: 'DELETE' },
    ),
  register: (input: RegisterInput) =>
    apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: input,
      retryAuth: false,
    }),
  logout: () =>
    apiRequest<{ message: string }>('/auth/logout', { method: 'POST' }),
  forgotPassword: (email: string) =>
    apiRequest<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      retryAuth: false,
    }),
  resetPassword: (token: string, password: string) =>
    apiRequest<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: { token, password },
      retryAuth: false,
    }),
  subscribe: (input: NewsletterInput) =>
    apiRequest<{ message: string }>('/newsletter/subscribe', {
      method: 'POST',
      body: input,
    }),
  adminDashboard: (range: DashboardRange, timezone: string) =>
    apiRequest<AdminDashboard>(
      `/admin/dashboard?range=${encodeURIComponent(range)}&tz=${encodeURIComponent(timezone)}`,
    ),
  adminNotifications: () =>
    apiRequest<AdminNotifications>('/admin/notifications'),
  adminSearch: (query: string) =>
    apiRequest<AdminSearchResult>(
      `/admin/search?q=${encodeURIComponent(query)}`,
    ),
};

export type ApiResponse<T> = ApiSuccess<T>;
