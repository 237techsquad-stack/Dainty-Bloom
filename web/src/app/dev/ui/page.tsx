import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CartView, CatalogCard, CatalogPage, Category, CustomerOrder, PublicProduct } from '@/lib/api/types';
import { UiPreview } from './ui-preview';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'UI preview',
  robots: { index: false, follow: false },
};

const sampleImage = {
  url: '/images/dainty-bloom-logo.png',
  alt: 'Preview image for Dainty Bloom sample product',
  variants: {
    thumb: '/images/dainty-bloom-logo.png',
    medium: '/images/dainty-bloom-logo.png',
    large: '/images/dainty-bloom-logo.png',
  },
};

const sampleProducts: CatalogCard[] = [
  {
    id: 'preview-standard',
    title: 'Sample product — standard',
    slug: 'preview-standard',
    primaryImage: null,
    category: { id: '3d-printed-goods', name: '3D Printed Goods', slug: '3d-printed-goods' },
    productType: 'three_d_printed',
    startingPriceMinor: 1850,
    currency: 'GBP',
    availability: 'in_stock',
    isFeatured: false,
    customizationCues: ['Choose a colour', 'Made for you'],
  },
  {
    id: 'preview-sale',
    title: 'Sample product — sale with compare-at price',
    slug: 'preview-sale',
    primaryImage: sampleImage,
    category: { id: 'mugs', name: 'Mugs', slug: 'mugs' },
    productType: 'mug',
    startingPriceMinor: 1200,
    compareAtPriceMinor: 1600,
    currency: 'GBP',
    availability: 'in_stock',
    isFeatured: false,
    customizationCues: ['Upload your artwork'],
  },
  {
    id: 'preview-made-to-order',
    title: 'Sample product — made to order',
    slug: 'preview-made-to-order',
    primaryImage: null,
    category: { id: '3d-printed-goods', name: '3D Printed Goods', slug: '3d-printed-goods' },
    productType: 'three_d_printed',
    startingPriceMinor: 2400,
    currency: 'GBP',
    availability: 'made_to_order',
    madeToOrder: true,
    isFeatured: false,
    customizationCues: ['Select a size'],
  },
  {
    id: 'preview-low-stock',
    title: 'Sample product — low stock',
    slug: 'preview-low-stock',
    primaryImage: null,
    category: { id: 't-shirts', name: 'T-Shirts', slug: 't-shirts' },
    productType: 'tshirt',
    startingPriceMinor: 2250,
    currency: 'GBP',
    availability: 'low_stock',
    isFeatured: false,
    customizationCues: ['Choose a size'],
  },
  {
    id: 'preview-out-of-stock',
    title: 'Sample product — out of stock',
    slug: 'preview-out-of-stock',
    primaryImage: null,
    category: { id: 'canvas', name: 'Canvas', slug: 'paint-it-yourself-canvas' },
    productType: 'canvas_paint_yourself',
    startingPriceMinor: 1900,
    currency: 'GBP',
    availability: 'out_of_stock',
    isFeatured: false,
    customizationCues: [],
  },
  {
    id: 'preview-rating-eco',
    title: 'Sample product — rating and eco note',
    slug: 'preview-rating-eco',
    primaryImage: null,
    category: { id: 't-shirts', name: 'T-Shirts', slug: 't-shirts' },
    productType: 'tshirt',
    startingPriceMinor: 2800,
    currency: 'GBP',
    availability: 'in_stock',
    ratingAverage: 4.8,
    ratingCount: 12,
    ecoNote: 'Sample eco note for visual preview',
    isFeatured: false,
    customizationCues: ['Choose a colour', 'Choose a size'],
  },
  {
    id: 'preview-image',
    title: 'Sample product — with image',
    slug: 'preview-image',
    primaryImage: sampleImage,
    category: { id: 'mugs', name: 'Mugs', slug: 'mugs' },
    productType: 'mug',
    startingPriceMinor: 1450,
    currency: 'GBP',
    availability: 'in_stock',
    isFeatured: false,
    customizationCues: [],
  },
  {
    id: 'preview-no-image',
    title: 'Sample product — without image',
    slug: 'preview-no-image',
    primaryImage: null,
    category: null,
    productType: 'other',
    startingPriceMinor: 990,
    currency: 'GBP',
    availability: 'in_stock',
    isFeatured: false,
    customizationCues: [],
  },
];

const sampleCategories: Category[] = [
  {
    _id: '3d-printed-goods',
    name: '3D Printed Goods',
    slug: '3d-printed-goods',
    sortOrder: 1,
    productCount: 3,
    children: [
      { _id: 'toys', name: 'Toys', slug: 'toys', sortOrder: 1, productCount: 0, children: [] },
      { _id: 'home-decor', name: 'Home Decor', slug: 'home-decor', sortOrder: 2, productCount: 2, children: [] },
    ],
  },
  { _id: 'mugs', name: 'Mugs', slug: 'mugs', sortOrder: 2, productCount: 0, children: [] },
  { _id: 't-shirts', name: 'T-Shirts', slug: 't-shirts', sortOrder: 3, productCount: 1, children: [] },
  { _id: 'canvas', name: 'Paint-It-Yourself Canvas', slug: 'paint-it-yourself-canvas', sortOrder: 4, productCount: 0, children: [] },
];

const sampleCatalog: CatalogPage = {
  items: sampleProducts,
  pagination: { page: 1, limit: 12, total: sampleProducts.length, totalPages: 1, hasNextPage: false },
  facets: {
    minPrice: 990,
    maxPrice: 2800,
    productTypes: ['three_d_printed', 'mug', 'tshirt'],
    printTechniques: ['sublimation'],
    colors: [
      { value: 'lavender', label: 'Lavender', hex: '#9D8DF1' },
      { value: 'mint', label: 'Mint', hex: '#A8E6CF' },
      { value: 'peach', label: 'Peach', hex: '#FFD3B6' },
    ],
    sizes: ['small', 'medium', 'large'],
  },
};

const sampleProduct: PublicProduct = {
  ...sampleProducts[1],
  id: 'preview-detail',
  title: 'Sample product — product detail preview',
  slug: 'preview-detail',
  description: 'Clearly labelled sample content for checking the real product detail component.',
  sku: 'PREVIEW-001',
  media: [{ ...sampleImage, view: 'front', isPrimary: true, sortOrder: 0 }],
  basePriceMinor: 1200,
  optionGroups: [
    {
      key: 'colour',
      label: 'Colour',
      required: true,
      values: [
        { label: 'Lavender', value: 'lavender', priceModifierMinor: 0, hex: '#9D8DF1', isAvailable: true },
        { label: 'Mint', value: 'mint', priceModifierMinor: 0, hex: '#A8E6CF', isAvailable: true },
        { label: 'Peach', value: 'peach', priceModifierMinor: 0, hex: '#FFD3B6', isAvailable: true },
      ],
    },
    {
      key: 'size',
      label: 'Size',
      required: true,
      values: [
        { label: 'Small', value: 'small', priceModifierMinor: 0, isAvailable: true },
        { label: 'Medium', value: 'medium', priceModifierMinor: 300, isAvailable: true },
        { label: 'Large', value: 'large', priceModifierMinor: 600, isAvailable: true },
      ],
    },
    {
      key: 'finish',
      label: 'Finish',
      required: false,
      values: ['Matte', 'Gloss', 'Satin', 'Pearl', 'Metallic', 'Natural'].map((label) => ({
        label,
        value: label.toLowerCase(),
        priceModifierMinor: 0,
        isAvailable: true,
      })),
    },
  ],
  quantityPricing: [],
  printTechniques: [],
  specifications: [{ label: 'Preview', value: 'Sample only' }],
  artworkRequirements: {
    allowedFormats: ['image/png', 'image/jpeg'],
    minimumResolutionNote: 'Sample resolution guidance',
    notes: 'Sample artwork guidance shown only on this development preview.',
  },
  artworkRequired: false,
  leadTimeDays: 5,
  minOrderQuantity: 1,
  maxOrderQuantity: 20,
  seo: {},
  category: { id: 'mugs', name: 'Mugs', slug: 'mugs' },
  breadcrumb: [{ id: 'mugs', name: 'Mugs', slug: 'mugs' }],
  relatedProducts: [],
  reviewSummary: { average: null, count: 0, distribution: {} },
};

const sampleCartLine: CartView['items'][number] = {
  itemId: 'preview-cart-line',
  productId: 'preview-product',
  slug: 'preview-product',
  title: 'Sample custom print — cart line',
  image: sampleImage.url,
  selectedOptions: [{ key: 'size', label: 'Size', value: 'medium', valueLabel: 'Medium' }],
  quantity: 2,
  unitPriceMinor: 1850,
  lineTotalMinor: 3700,
  artworkStatus: 'pending_review',
  artworkRequired: true,
  artworkAccepted: true,
  artworkRequirements: { allowedFormats: ['image/png', 'image/jpeg'] },
  artwork: {
    id: 'preview-artwork',
    originalFilename: 'sample-artwork.png',
    detectedMimeType: 'image/png',
    previewUrl: sampleImage.url,
    reviewStatus: 'pending',
  },
  availability: 'ok',
  issues: [{
    code: 'PRICE_CHANGED',
    message: 'The sample product price changed.',
    oldPriceMinor: 1600,
    newPriceMinor: 1850,
    blocking: false,
  }],
};

const sampleOrder: Pick<CustomerOrder, 'orderNumber' | 'status' | 'statusHistory'> = {
  orderNumber: 'SAMPLE-ORDER-001',
  status: 'in_printing',
  statusHistory: [
    { from: 'pending_payment', to: 'pending_proof_approval', at: '2025-02-02T10:00:00.000Z' },
    { from: 'pending_proof_approval', to: 'in_printing', at: '2025-02-04T14:30:00.000Z' },
  ],
};

export default function UiPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return (
    <UiPreview
      products={sampleProducts}
      categories={sampleCategories}
      catalog={sampleCatalog}
      product={sampleProduct}
      cartLine={sampleCartLine}
      orderPreview={sampleOrder}
    />
  );
}
