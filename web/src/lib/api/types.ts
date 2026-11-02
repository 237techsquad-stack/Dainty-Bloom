export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export interface CategoriesResponse {
  categories: Category[];
}

export interface ProductLine {
  key: string;
  label: string;
  description: string;
  isActive: boolean;
}

export interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string | null;
  formProfile?: CategoryFormProfile;
  parent?: string | null;
  sortOrder: number;
  productCount: number;
  children: Category[];
  isActive?: boolean;
}

export interface AdminCategory {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  formProfile?: CategoryFormProfile;
  parent?: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
  children: AdminCategory[];
}

export type CategoryFormProfile =
  | 'apparel'
  | 'drinkware'
  | 'canvas_art'
  | 'three_d_printed'
  | 'bags'
  | 'general';

export interface ProductMedia {
  _id?: string;
  id?: string;
  url: string;
  publicId?: string;
  width?: number;
  height?: number;
  alt: string;
  view:
    | 'front'
    | 'back'
    | 'detail'
    | 'size_reference'
    | 'sample'
    | 'side'
    | 'lifestyle';
  lightingState?: 'on' | 'off';
  isPrimary: boolean;
  sortOrder: number;
  variants?: { thumb: string; medium: string; large: string };
}

export interface PublicAboutMedia {
  id: string;
  type: 'image' | 'video';
  title?: string;
  description?: string;
  altText?: string;
  sortOrder: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  url: string;
  thumbnailUrl?: string;
}

export type ProductStatus = 'draft' | 'active' | 'archived' | 'out_of_stock';
export type ProductTheme =
  'christmas' | 'halloween' | 'autumn' | 'kids' | 'anime';
export type ProductType =
  | 'tshirt'
  | 'mug'
  | 'canvas_paint_yourself'
  | 'canvas_custom_print'
  | 'three_d_printed'
  | 'other';

export type CustomOfferProductType =
  | ProductType
  | 'hoodie'
  | 'canvas'
  | 'poster'
  | 'tote_bag'
  | 'banner'
  | 'signage'
  | 'accessory';

export interface AdminProduct {
  _id: string;
  title: string;
  slug: string;
  description: string;
  category: string | { _id: string; name: string; slug: string };
  productType: ProductType;
  media: ProductMedia[];
  lightingGalleryEnabled?: boolean;
  sku: string;
  basePriceMinor: number;
  compareAtPriceMinor?: number;
  currency: string;
  optionGroups: Array<{
    key: string;
    label: string;
    required: boolean;
    values: Array<{
      label: string;
      value: string;
      priceModifierMinor: number;
      hex?: string;
      skuSuffix?: string;
      isAvailable: boolean;
    }>;
  }>;
  quantityPricing: Array<{ minQty: number; unitPriceMinor: number }>;
  printTechniques: string[];
  specifications: Array<{ label: string; value: string }>;
  artworkRequirements: {
    allowedFormats: string[];
    minimumResolutionNote?: string;
    notes?: string;
  };
  artworkRequired: boolean;
  stock: {
    trackInventory: boolean;
    quantity: number;
    lowStockThreshold: number;
    allowBackorder: boolean;
    reserveBlanksForMadeToOrder: boolean;
  };
  status: ProductStatus;
  themes?: ProductTheme[];
  seo: { metaTitle?: string; metaDescription?: string; canonicalUrl?: string };
  viewCount: number;
  soldCount: number;
  ratingAverage: number;
  ratingCount: number;
  leadTimeDays?: number;
  madeToOrder?: boolean;
  ecoNote?: string;
  isFeatured: boolean;
  minOrderQuantity: number;
  maxOrderQuantity?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductListItem extends Omit<
  AdminProduct,
  | 'description'
  | 'optionGroups'
  | 'quantityPricing'
  | 'printTechniques'
  | 'specifications'
  | 'artworkRequirements'
  | 'artworkRequired'
  | 'seo'
  | 'ratingAverage'
  | 'ratingCount'
  | 'minOrderQuantity'
  | 'maxOrderQuantity'
> {
  category: { _id: string; name: string; slug: string } | string;
}

export interface AdminProductList {
  items: AdminProductListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

export interface SiteSettings {
  storeName: string;
  currency: string;
  country: string;
  supportedCountries: string[];
  announcementBar: { enabled: boolean; text: string };
  turnaroundMessage: string;
  contact: {
    email: string;
    phone: string;
    address: string;
    openingHours: string[];
  };
  guestCheckoutEnabled: boolean;
  shippingConfigured: boolean;
  socialLinks: {
    instagram: string;
    tiktok: string;
    whatsapp: string;
  };
  contactEmail: string;
  contactPhone: string;
  whatsappNumber: string;
  studioAddress: { label: string; city: string; country: string };
  openingHours: Array<{
    days: string[];
    open: string;
    close: string;
    timezone: string;
  }>;
  openingHoursDisplayText: string;
  aboutNote: string;
  productLines: ProductLine[];
  stripePublishableKey: string | null;
  artwork: { maxBytes: number; allowedMimeTypes: string[] };
}

export interface CartSummary {
  itemCount: number;
  subtotalMinor: number;
  currency: string;
  wishlistCount: number;
}

export interface CartView {
  items: Array<{
    itemId: string;
    productId: string;
    slug: string | null;
    title: string;
    image: string | null;
    selectedOptions: Array<{
      key: string;
      label: string;
      value: string;
      valueLabel: string;
    }>;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    artworkStatus: string;
    artworkRequired: boolean;
    artworkAccepted: boolean;
    artworkRequirements: {
      allowedFormats: string[];
      notes?: string;
      minimumResolutionNote?: string;
    };
    artwork: {
      id: string;
      originalFilename: string;
      detectedMimeType: string;
      previewUrl?: string;
      reviewStatus: string;
    } | null;
    availability: string;
    issues: Array<{
      code: string;
      message: string;
      blocking: boolean;
      oldPriceMinor?: number;
      newPriceMinor?: number;
    }>;
  }>;
  totals: {
    subtotalMinor: number;
    discountMinor: number;
    estimatedShippingMinor: null;
    shippingCalculatedAtCheckout: true;
    totalMinor: number;
    currency: string;
    itemCount: number;
  };
  hasBlockingIssues: boolean;
}

export interface CheckoutPreview {
  lines: CartView['items'];
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  issues: Array<{
    itemId: string;
    code: string;
    message: string;
    oldPriceMinor?: number;
    newPriceMinor?: number;
    blocking: boolean;
  }>;
  hasBlockingIssues: boolean;
  shippingConfigured: boolean;
  taxConfigured: boolean;
}

export interface CustomerOrder {
  orderNumber: string;
  status: string;
  payment: { status: string };
  contact: { name: string; email: string; phone: string | null };
  shippingAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  billingAddress: CustomerOrder['shippingAddress'];
  items: Array<{
    id: string;
    title: string;
    sku: string;
    image: string | null;
    selectedOptions: Array<{
      key: string;
      value: string;
      label?: string;
      valueLabel?: string;
    }>;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    artwork: {
      id: string;
      reviewStatus: string | null;
      originalFilename?: string;
      detectedMimeType?: string;
      reviewNote?: string;
    } | null;
  }>;
  totals: {
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    taxMinor: number;
    totalMinor: number;
    currency: string;
  };
  statusHistory: Array<{
    from: string;
    to: string;
    at: string;
  }>;
  shipment: {
    carrier: string;
    trackingNumber: string;
    trackingUrl?: string;
    dispatchedAt: string;
  } | null;
  createdAt: string;
}

export interface CustomerOrderList {
  items: Array<{
    orderNumber: string;
    status: string;
    totalMinor: number;
    currency: string;
    paymentStatus: string;
    itemCount: number;
    createdAt: string;
  }>;
  pagination: CatalogPage['pagination'];
}

export interface CreateOrderInput {
  contact: { name: string; email: string; phone?: string };
  shippingAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  billingAddress?: CreateOrderInput['shippingAddress'];
  billingSameAsShipping: boolean;
  customerNote?: string;
}

export interface CatalogCard {
  id: string;
  title: string;
  slug: string;
  description?: string;
  primaryImage: {
    url: string;
    alt: string;
    variants: { thumb: string; medium: string; large: string };
  } | null;
  secondaryImage?: {
    url: string;
    alt: string;
    variants: { thumb: string; medium: string; large: string };
  } | null;
  lightingImages?: {
    on?: {
      primary: NonNullable<CatalogCard['primaryImage']>;
      secondary?: NonNullable<CatalogCard['primaryImage']>;
    };
    off?: {
      primary: NonNullable<CatalogCard['primaryImage']>;
      secondary?: NonNullable<CatalogCard['primaryImage']>;
    };
  };
  category: { id: string; name: string; slug: string } | null;
  productType: string;
  startingPriceMinor: number;
  compareAtPriceMinor?: number;
  currency: string;
  availability: 'in_stock' | 'low_stock' | 'out_of_stock' | 'made_to_order';
  ratingAverage?: number;
  ratingCount?: number;
  isFeatured: boolean;
  customizationCues: string[];
  ecoNote?: string;
  madeToOrder?: boolean;
}

export interface CatalogFacets {
  minPrice: number | null;
  maxPrice: number | null;
  productTypes: string[];
  printTechniques: string[];
  colors: Array<{ value: string; label: string; hex?: string }>;
  sizes: string[];
}

export interface CatalogPage {
  items: CatalogCard[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
  facets: CatalogFacets;
}

export interface CatalogQuery {
  q?: string;
  category?: string;
  productType?: string;
  theme?: ProductTheme;
  printTechnique?: string;
  minPrice?: number;
  maxPrice?: number;
  color?: string;
  size?: string;
  inStock?: boolean;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'popular';
  page?: number;
  limit?: number;
}

export interface PublicProduct extends Omit<CatalogCard, 'primaryImage'> {
  description: string;
  sku: string;
  media: ProductMedia[];
  lightingGalleryEnabled?: boolean;
  basePriceMinor: number;
  optionGroups: AdminProduct['optionGroups'];
  quantityPricing: AdminProduct['quantityPricing'];
  printTechniques: string[];
  specifications: Array<{ label: string; value: string }>;
  artworkRequirements: AdminProduct['artworkRequirements'];
  artworkRequired: boolean;
  leadTimeDays?: number;
  minOrderQuantity: number;
  maxOrderQuantity: number;
  seo: AdminProduct['seo'];
  category: { id: string; name: string; slug: string };
  breadcrumb: Array<{ id: string; name: string; slug: string }>;
  relatedProducts: CatalogCard[];
  reviewSummary: ReviewSummary;
}

export interface ReviewSummary {
  average: number | null;
  count: number;
  distribution: Record<string, number>;
}

export interface ProductQuote {
  unitPriceMinor: number | null;
  lineTotalMinor: number | null;
  currency: string;
  breakdown: {
    basePriceMinor: number;
    optionModifiersMinor: number;
    quantityTierDiscountMinor: number;
    appliedQuantityTier?: { minQty: number; unitPriceMinor: number };
  } | null;
  availability: CatalogCard['availability'];
  issues: Array<{ code: string; message: string }>;
}

export interface WishlistResponse {
  products: CatalogCard[];
  count: number;
  removedCount: number;
}

export interface ArtworkMetadata {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  detectedMimeType: string;
  width?: number;
  height?: number;
  reviewStatus: string;
  createdAt: string;
}

export interface PublicFaqs {
  categories: Array<{
    category: string;
    items: Array<{
      id: string;
      question: string;
      answer: string;
      sortOrder: number;
    }>;
  }>;
}

export interface MessageToken {
  token: string;
  issuedAt: string;
}

export type AdminMessageType = 'general' | 'custom_3d_request' | 'bulk_quote';
export type AdminMessageStatus = 'new' | 'in_progress' | 'quoted' | 'resolved';
export type CustomRequestStatus =
  | 'submitted'
  | 'under_review'
  | 'accepted'
  | 'declined'
  | 'offer_created'
  | 'completed';
export type CustomRequestNotificationStatus = 'pending' | 'sent' | 'failed';
export type AdminMessageEmailDeliveryStatus =
  'not_tracked' | 'not_required' | 'pending' | 'sent' | 'failed';

export interface AdminMessageRequestDetails {
  description?: string;
  productName?: string;
  productType?: string;
  otherProductType?: string;
  phone?: string;
  imagePurpose?: 'no_image' | 'my_design' | 'reference' | 'example';
  approximateSize?: string;
  preferredColour?: string;
  preferredMaterial?: string;
  budget?: string;
  quantity?: number;
  neededByDate?: string;
}

export interface AdminMessageListItem {
  id: string;
  name: string;
  email: string;
  customer: { id: string; name: string; email: string } | null;
  orderNumber: string | null;
  subject: string;
  message: string;
  type: AdminMessageType;
  customRequestStatus: CustomRequestStatus | null;
  emailDeliveryStatus: AdminMessageEmailDeliveryStatus;
  requestDetails: AdminMessageRequestDetails | null;
  quotedPriceMinor: number | null;
  quotedPriceCurrency: string | null;
  quoteNote: string | null;
  status: AdminMessageStatus;
  assignedTo: string | null;
  hasAttachment: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminMessageDetail extends AdminMessageListItem {
  customOffer: CustomOfferSummary | null;
  customRequestResponses: Array<{
    id: string | null;
    status: 'accepted' | 'declined';
    message: string;
    authorName: string | null;
    notificationStatus: CustomRequestNotificationStatus;
    createdAt: string;
  }>;
  order: { id: string; status: string } | null;
  attachment: {
    id: string;
    originalFilename: string;
    detectedMimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    createdAt: string;
  } | null;
  replies: Array<{
    id: string | null;
    authorName: string | null;
    body: string;
    createdAt: string;
  }>;
}

export interface CustomerCustomRequestSummary {
  id: string;
  subject: string;
  productName: string | null;
  productType: string | null;
  customRequestStatus: CustomRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerCustomRequest {
  id: string;
  subject: string;
  message: string;
  requestDetails: AdminMessageRequestDetails | null;
  customRequestStatus: CustomRequestStatus;
  customOffer: CustomOfferSummary | null;
  attachment: {
    id: string;
    originalFilename: string;
    detectedMimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    createdAt: string;
    url: string;
  } | null;
  responses: Array<{
    id: string | null;
    status: 'accepted' | 'declined';
    message: string;
    authorName: string;
    notificationStatus: CustomRequestNotificationStatus;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface CustomOfferSummary {
  id: string;
  status: 'available' | 'reserved' | 'purchased' | 'expired' | 'cancelled';
  agreedPriceMinor: number;
  currency: 'GBP';
  agreedQuantity: number;
  specifications: Array<{ label: string; value: string }>;
  expiresAt: string;
  product: {
    id: string;
    title: string;
    description: string;
    productType: string;
  };
  image: {
    id: string;
    originalFilename: string;
    detectedMimeType: string;
    width: number | null;
    height: number | null;
    url: string;
  } | null;
}

export interface AdminMessageList {
  items: AdminMessageListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

export type AdminOrderStatus =
  | 'pending_payment'
  | 'pending_proof_approval'
  | 'artwork_rejected'
  | 'in_printing'
  | 'ready'
  | 'shipped'
  | 'completed'
  | 'cancelled';

export interface AdminOrderListItem {
  id: string;
  orderNumber: string;
  status: AdminOrderStatus;
  fulfillmentStatus: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  payment: { status: string };
  contactSnapshot: { name: string; email: string };
  itemCount: number;
}

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  status: AdminOrderStatus;
  fulfillmentStatus: string;
  allowedNextStatuses: AdminOrderStatus[];
  contact: { name: string; email: string; phone: string | null };
  guestEmail: string | null;
  customerNote: string | null;
  shippingAddress: Record<string, string>;
  billingAddress: Record<string, string>;
  items: Array<{
    id: string;
    productId: string;
    title: string;
    sku: string;
    selectedOptions: Array<{ key: string; value: string; valueLabel?: string }>;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    itemPrintStatus: string;
    printTechniques: string[];
    artwork: {
      id: string;
      originalFilename: string;
      detectedMimeType: string;
      sizeBytes: number;
      reviewStatus: string;
      reviewNote: string | null;
    } | null;
  }>;
  totals: {
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    taxMinor: number;
    totalMinor: number;
    currency: string;
  };
  payment: {
    provider: string;
    providerReference: string | null;
    stripePaymentIntentId: string | null;
    status: string;
    paidAt: string | null;
  };
  shipment: {
    carrier: string;
    trackingNumber: string;
    trackingUrl: string | null;
    dispatchedAt: string;
    note: string | null;
  } | null;
  statusHistory: Array<{
    from: AdminOrderStatus;
    to: AdminOrderStatus;
    actorName: string | null;
    note?: string;
    at: string;
  }>;
  internalNotes: Array<{ authorName: string | null; note: string; at: string }>;
  refunds: Array<{ amountMinor: number; reason: string; at: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOrderList {
  items: AdminOrderListItem[];
  counts: Record<string, number>;
  pagination: AdminMessageList['pagination'];
}

export interface AdminPrintQueueItem {
  orderId: string;
  itemId: string;
  orderNumber: string;
  status: AdminOrderStatus;
  createdAt: string;
  customerName: string;
  productTitle: string;
  selectedOptions: Array<{ key: string; value?: string; valueLabel?: string }>;
  printTechniques: string[];
  quantity: number;
  artworkId: string | null;
  artworkReviewStatus: string | null;
  itemPrintStatus: string;
}

export interface AdminPrintQueue {
  items: AdminPrintQueueItem[];
  pagination: AdminMessageList['pagination'];
}

export interface AdminArtworkListItem {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  detectedMimeType: string;
  width?: number;
  height?: number;
  reviewStatus: string;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt: string;
  orderNumber?: string;
  productTitle?: string;
}

export interface AdminAboutMedia {
  id: string;
  type: 'image' | 'video';
  title?: string;
  description?: string;
  altText?: string;
  isPublished: boolean;
  sortOrder: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  url: string;
  thumbnailUrl?: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminReviewListItem {
  id: string;
  product: { _id: string; title: string; slug: string } | null;
  reviewer: { _id: string; name: string; email: string } | null;
  orderId: string | null;
  rating: number;
  title: string;
  body: string;
  moderationState: 'pending' | 'approved' | 'rejected';
  moderationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCustomerListItem {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  accountState: 'active' | 'suspended';
  createdAt: string;
  orderCount: number;
  totalSpentMinor: number;
}

export interface AdminCustomerDetail {
  customer: {
    _id: string;
    name: string;
    email: string;
    phone?: string;
    accountState: 'active' | 'suspended';
    emailVerified: boolean;
    addresses: Array<{
      label: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
      isDefault: boolean;
    }>;
    createdAt: string;
  };
  orders: Array<{
    _id: string;
    orderNumber: string;
    status: AdminOrderStatus;
    totalMinor: number;
    currency: string;
    payment: { status: string };
    createdAt: string;
  }>;
}

export interface AdminStaffList {
  items: Array<{
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'production' | 'support';
    accountState: 'active' | 'suspended';
    emailVerified: boolean;
    lastLoginAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  pagination: AdminMessageList['pagination'];
}

export type AdminSettings = Omit<
  SiteSettings,
  'artwork' | 'stripePublishableKey'
> & {
  artworkLimits: { maxBytes: number; allowedMimeTypes: string[] };
  shippingFlatMinor: number;
  freeShippingThresholdMinor: number | null;
  taxRateBasisPoints: number;
  taxConfigured: boolean;
  shippingConfigured: boolean;
  orderCancellationWindowNote: string;
};

export interface ContactMessageInput {
  name: string;
  email: string;
  subject: string;
  message: string;
  token: string;
  submissionId?: string;
  website?: string;
  orderNumber?: string;
}

export interface CustomProductRequestInput extends Omit<
  ContactMessageInput,
  'orderNumber'
> {
  requestDetails: {
    description: string;
    productName: string;
    productType: string;
    otherProductType?: string;
    phone?: string;
    approximateSize?: string;
    preferredColour?: string;
    preferredMaterial?: string;
    budget?: string;
    quantity?: number;
    neededByDate?: string;
  };
  imagePurpose: 'no_image' | 'my_design' | 'reference' | 'example';
  referenceImage?: File;
}

export type Custom3DRequestInput = CustomProductRequestInput;

export interface ProductReviews {
  productId: string;
  items: Array<{
    id: string;
    reviewerName: string;
    rating: number;
    title: string;
    body: string;
    verifiedPurchase: boolean;
    date: string;
  }>;
  summary: ReviewSummary;
  pagination: CatalogPage['pagination'];
}

export interface CreatedReview {
  id: string;
  productId: string;
  rating: number;
  title: string;
  body: string;
  moderationState: 'pending';
  createdAt: string;
}

export interface SearchSuggestion {
  type: 'product' | 'category';
  title: string;
  slug: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'customer' | 'admin' | 'production' | 'support';
  accountState: 'active' | 'suspended';
  phone?: string;
  addresses: Array<{
    _id?: string;
    label: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    isDefault: boolean;
  }>;
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type Permission =
  | 'products:read'
  | 'products:write'
  | 'media:manage'
  | 'orders:read'
  | 'orders:update_status'
  | 'orders:refund'
  | 'artwork:review'
  | 'messages:manage'
  | 'reviews:moderate'
  | 'staff:manage'
  | 'customers:read'
  | 'analytics:read'
  | 'settings:write'
  | 'audit:read';

export interface AuthResponse {
  user: AuthUser;
  permissions: Permission[];
}

export interface ProfileUpdateInput {
  name?: string;
  phone?: string;
  addresses?: Array<{
    label: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    isDefault: boolean;
  }>;
}

export type DashboardRange = '7d' | '30d' | '90d';

export interface AdminDashboard {
  range: DashboardRange;
  timezone: string;
  period: { from: string; to: string };
  currency: string;
  ordersByStatus: Record<string, number>;
  newOrdersInRange: number;
  jobsInPrinting: number;
  jobsReady: number;
  artworkAwaitingReview: number;
  pendingPayment: number;
  unreadMessages: number;
  pendingReviews: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  revenueInRange: {
    revenueMinor: number;
    paidOrderCount: number;
    averageOrderValueMinor: number | null;
    previousPeriodRevenueMinor: number;
    comparisonPercent: number | null;
  };
  dailySeries: Array<{
    date: string;
    orders: number;
    revenueMinor: number;
  }>;
  topProducts: Array<{
    productId: string;
    title: string;
    unitsSold: number;
  }>;
  recentOrders: Array<{
    orderNumber: string;
    status: string;
    totalMinor: number;
    currency: string;
    createdAt: string;
  }>;
  printQueue: Array<{
    orderNumber: string;
    status: 'in_printing' | 'ready';
    createdAt: string;
    productTitle: string;
    selectedOptions: unknown[];
    printTechniques: string[];
    quantity: number;
    artworkId: string | null;
    artworkReviewStatus: string | null;
    itemPrintStatus: string;
  }>;
}

export interface AdminNotifications {
  counts: Record<string, number>;
  items: Array<{
    type:
      | 'paid_order_awaiting_proof'
      | 'artwork_awaiting_review'
      | 'new_message'
      | 'pending_review'
      | 'low_stock';
    label: string;
    count: number;
    route: string;
    latest: Array<Record<string, unknown>>;
  }>;
}

export interface AdminSearchResult {
  orders?: Array<{
    orderNumber: string;
    status: string;
    totalMinor: number;
    currency: string;
    customerName: string;
    email: string;
    createdAt: string;
  }>;
  products?: Array<{
    id: string;
    title: string;
    sku: string;
    slug: string;
    status: string;
  }>;
  customers?: Array<{ id: string; name: string; email: string }>;
  messages?: Array<{
    id: string;
    name: string;
    email: string;
    subject: string;
    status: string;
    createdAt: string;
  }>;
}

export interface AuthCredentials {
  email: string;
  password: string;
  portal?: 'customer' | 'admin';
}

export interface RegisterInput extends AuthCredentials {
  name: string;
}

export interface NewsletterInput {
  email: string;
  consent: true;
  source: string;
}
