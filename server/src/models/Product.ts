import {
  Schema,
  Types,
  model,
  models,
  type Document,
  type Model,
} from 'mongoose';

import {
  PRINT_TECHNIQUE,
  LEGACY_PRODUCT_TYPE,
  PRODUCT_MEDIA_VIEWS,
  PRODUCT_LIGHTING_STATES,
  PRODUCT_STATUS,
  PRODUCT_THEMES,
  PRODUCT_TYPE,
  type PrintTechnique,
  type ProductMediaView,
  type ProductLightingState,
  type ProductStatus,
  type ProductTheme,
  type ProductType,
} from '../constants/product';
import { env } from '../config/env';
import { slugify } from '../utils/slugify';

export interface IProductMedia {
  _id?: Types.ObjectId;
  url: string;
  alt?: string;
  isPrimary?: boolean;
  view?: ProductMediaView;
  lightingState?: ProductLightingState;
  publicId?: string;
  width?: number;
  height?: number;
  sortOrder?: number;
}

export interface IProductOptionValue {
  label: string;
  value: string;
  priceModifierMinor: number;
  hex?: string;
  skuSuffix?: string;
  isAvailable: boolean;
}

export interface IProductOptionGroup {
  key: string;
  label: string;
  required: boolean;
  values: IProductOptionValue[];
}

export interface IQuantityPrice {
  minQty: number;
  unitPriceMinor: number;
}

export interface IProductSpecification {
  label: string;
  value: string;
}

export interface IArtworkRequirements {
  allowedFormats: string[];
  minimumResolutionNote?: string;
  notes?: string;
}

export interface IProductStock {
  trackInventory: boolean;
  quantity: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
  reserveBlanksForMadeToOrder: boolean;
}

export interface IProductSeo {
  metaTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
}

export type ProductVisibility = 'public' | 'private';

export interface IProduct extends Document {
  __v: number;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  slug: string;
  description: string;
  category: Types.ObjectId;
  productType: ProductType;
  media: IProductMedia[];
  lightingGalleryEnabled?: boolean;
  sku: string;
  basePriceMinor: number;
  compareAtPriceMinor?: number;
  currency: string;
  optionGroups: IProductOptionGroup[];
  quantityPricing: IQuantityPrice[];
  printTechniques: PrintTechnique[];
  specifications: IProductSpecification[];
  artworkRequirements: IArtworkRequirements;
  artworkRequired: boolean;
  stock: IProductStock;
  status: ProductStatus;
  visibility?: ProductVisibility;
  themes?: ProductTheme[];
  seo: IProductSeo;
  viewCount: number;
  soldCount: number;
  customOfferSoldCountApplied?: boolean;
  ratingAverage: number;
  ratingCount: number;
  leadTimeDays?: number;
  madeToOrder?: boolean;
  ecoNote?: string;
  isFeatured: boolean;
  minOrderQuantity: number;
  maxOrderQuantity?: number;
}

const moneyField = (required = true): Record<string, unknown> => ({
  type: Number,
  ...(required ? { required: true } : {}),
  min: 0,
  validate: {
    validator: Number.isInteger,
    message: 'Money values must be integer minor units',
  },
});

const productSchema = new Schema<IProduct>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: { type: String, required: true, trim: true },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },
    productType: {
      type: String,
      enum: [...PRODUCT_TYPE, ...LEGACY_PRODUCT_TYPE],
      required: true,
      index: true,
    },
    media: {
      type: [
        new Schema<IProductMedia>(
          {
            url: { type: String, required: true, trim: true },
            alt: { type: String, trim: true, default: '' },
            isPrimary: { type: Boolean, default: false },
            view: {
              type: String,
              enum: PRODUCT_MEDIA_VIEWS,
              default: 'front',
            },
            lightingState: {
              type: String,
              enum: PRODUCT_LIGHTING_STATES,
            },
            publicId: { type: String, trim: true },
            width: { type: Number, min: 1, validate: Number.isInteger },
            height: { type: Number, min: 1, validate: Number.isInteger },
            sortOrder: { type: Number, min: 0, validate: Number.isInteger },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    lightingGalleryEnabled: { type: Boolean },
    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    basePriceMinor: moneyField(),
    compareAtPriceMinor: moneyField(false),
    currency: {
      type: String,
      required: true,
      uppercase: true,
      enum: ['GBP'],
      default: () => env.DEFAULT_CURRENCY,
    },
    optionGroups: {
      type: [
        new Schema<IProductOptionGroup>(
          {
            key: { type: String, required: true, trim: true },
            label: { type: String, required: true, trim: true },
            required: { type: Boolean, default: false },
            values: {
              type: [
                new Schema<IProductOptionValue>(
                  {
                    label: { type: String, required: true, trim: true },
                    value: { type: String, required: true, trim: true },
                    priceModifierMinor: {
                      type: Number,
                      required: true,
                      default: 0,
                      validate: {
                        validator: Number.isInteger,
                        message: 'Money values must be integer minor units',
                      },
                    },
                    hex: {
                      type: String,
                      match: /^#[0-9A-Fa-f]{6}$/,
                    },
                    skuSuffix: { type: String, trim: true },
                    isAvailable: { type: Boolean, default: true },
                  },
                  { _id: false },
                ),
              ],
              default: [],
            },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    quantityPricing: {
      type: [
        new Schema<IQuantityPrice>(
          {
            minQty: {
              type: Number,
              required: true,
              min: 1,
              validate: Number.isInteger,
            },
            unitPriceMinor: moneyField(),
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    printTechniques: [{ type: String, enum: PRINT_TECHNIQUE }],
    specifications: {
      type: [
        new Schema<IProductSpecification>(
          {
            label: { type: String, required: true, trim: true },
            value: { type: String, required: true, trim: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    artworkRequirements: {
      allowedFormats: { type: [String], default: [] },
      minimumResolutionNote: { type: String, trim: true },
      notes: { type: String, trim: true },
    },
    artworkRequired: { type: Boolean, default: false },
    stock: {
      trackInventory: { type: Boolean, default: false },
      quantity: {
        type: Number,
        default: 0,
        min: 0,
        validate: Number.isInteger,
      },
      lowStockThreshold: {
        type: Number,
        default: 0,
        min: 0,
        validate: Number.isInteger,
      },
      allowBackorder: { type: Boolean, default: false },
      reserveBlanksForMadeToOrder: { type: Boolean, default: false },
    },
    status: {
      type: String,
      enum: PRODUCT_STATUS,
      default: 'draft',
      index: true,
    },
    visibility: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
      index: true,
    },
    themes: {
      type: [{ type: String, enum: PRODUCT_THEMES }],
      default: undefined,
    },
    seo: {
      metaTitle: { type: String, trim: true },
      metaDescription: { type: String, trim: true },
      canonicalUrl: { type: String, trim: true },
    },
    viewCount: { type: Number, default: 0, min: 0 },
    soldCount: { type: Number, default: 0, min: 0 },
    customOfferSoldCountApplied: {
      type: Boolean,
      default: false,
      select: false,
    },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    leadTimeDays: { type: Number, min: 0, validate: Number.isInteger },
    madeToOrder: { type: Boolean },
    ecoNote: { type: String, trim: true, maxlength: 300 },
    isFeatured: { type: Boolean, default: false, index: true },
    minOrderQuantity: {
      type: Number,
      default: 1,
      min: 1,
      validate: Number.isInteger,
    },
    maxOrderQuantity: {
      type: Number,
      min: 1,
      validate: Number.isInteger,
    },
  },
  { timestamps: true },
);

productSchema.pre('validate', function () {
  if (!this.slug && this.title) this.slug = slugify(this.title);
});
productSchema.index({ status: 1, category: 1 });
productSchema.index({ status: 1, visibility: 1, category: 1 });
productSchema.index({ status: 1, isFeatured: 1 });
productSchema.index({ status: 1, productType: 1, basePriceMinor: 1 });
productSchema.index({ status: 1, soldCount: -1, viewCount: -1 });
productSchema.index({
  status: 1,
  'stock.trackInventory': 1,
  'stock.quantity': 1,
  'stock.allowBackorder': 1,
});
productSchema.index({ title: 'text', description: 'text' });

export const Product: Model<IProduct> =
  (models.Product as Model<IProduct> | undefined) ??
  model<IProduct>('Product', productSchema);
