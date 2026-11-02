import {
  Schema,
  Types,
  model,
  models,
  type Document,
  type Model,
} from 'mongoose';

import { ArtworkAsset } from './ArtworkAsset';
import { Message } from './Message';
import { Order } from './Order';
import { Product } from './Product';
import { User } from './User';

export const CUSTOM_OFFER_STATUSES = [
  'available',
  'reserved',
  'purchased',
  'expired',
  'cancelled',
] as const;
export type CustomOfferStatus = (typeof CUSTOM_OFFER_STATUSES)[number];

export interface ICustomOffer extends Document {
  request: Types.ObjectId;
  product: Types.ObjectId;
  customer: Types.ObjectId;
  image?: Types.ObjectId;
  order?: Types.ObjectId;
  status: CustomOfferStatus;
  agreedPriceMinor: number;
  currency: 'GBP';
  agreedQuantity: number;
  specifications: Array<{ label: string; value: string }>;
  expiresAt: Date;
  reservedAt?: Date;
  reservationExpiresAt?: Date;
  purchasedAt?: Date;
  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  cancellationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const customOfferSchema = new Schema<ICustomOffer>(
  {
    request: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
      immutable: true,
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      immutable: true,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },
    image: {
      type: Schema.Types.ObjectId,
      ref: 'ArtworkAsset',
      immutable: true,
    },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    status: {
      type: String,
      enum: CUSTOM_OFFER_STATUSES,
      required: true,
      default: 'available',
      index: true,
    },
    agreedPriceMinor: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
      validate: {
        validator: Number.isSafeInteger,
        message: 'Agreed price must be an integer number of minor units',
      },
    },
    currency: {
      type: String,
      required: true,
      enum: ['GBP'],
      default: 'GBP',
      immutable: true,
    },
    agreedQuantity: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      validate: {
        validator: Number.isSafeInteger,
        message: 'Agreed quantity must be a positive integer',
      },
    },
    specifications: {
      type: [
        new Schema(
          {
            label: { type: String, required: true, trim: true, maxlength: 120 },
            value: { type: String, required: true, trim: true, maxlength: 500 },
          },
          { _id: false },
        ),
      ],
      required: true,
      default: [],
      immutable: true,
    },
    expiresAt: { type: Date, required: true, immutable: true },
    reservedAt: Date,
    reservationExpiresAt: Date,
    purchasedAt: Date,
    cancelledAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancellationReason: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

customOfferSchema.index(
  { request: 1 },
  { unique: true, name: 'custom_offer_request_unique' },
);
customOfferSchema.index(
  { product: 1 },
  { unique: true, name: 'custom_offer_product_unique' },
);
customOfferSchema.index(
  { order: 1 },
  { unique: true, sparse: true, name: 'custom_offer_order_unique' },
);
customOfferSchema.index({ customer: 1, status: 1, expiresAt: 1 });
customOfferSchema.index({ status: 1, reservationExpiresAt: 1 });

customOfferSchema.pre('validate', async function () {
  const [request, product, customer, image] = await Promise.all([
    Message.findById(this.request)
      .select('type customerId customRequestStatus')
      .lean(),
    Product.findById(this.product).select('visibility').lean(),
    User.findById(this.customer).select('role').lean(),
    this.image
      ? ArtworkAsset.findOne({
          _id: this.image,
          owner: this.customer,
          message: { $exists: false },
        })
          .select('customOffer')
          .lean()
      : null,
  ]);
  if (
    !request ||
    request.type !== 'custom_3d_request' ||
    !['accepted', 'offer_created', 'completed'].includes(
      request.customRequestStatus ?? '',
    ) ||
    request.customerId?.toString() !== this.customer.toString()
  ) {
    this.invalidate(
      'request',
      'An offer must belong to an accepted custom request from the same customer',
    );
  }
  if (!product || product.visibility !== 'private') {
    this.invalidate('product', 'An offer must reference a private product');
  }
  if (!customer || customer.role !== 'customer') {
    this.invalidate('customer', 'An offer must belong to a customer account');
  }
  if (
    this.image &&
    (!image ||
      (image.customOffer &&
        image.customOffer.toString() !== this._id.toString()))
  ) {
    this.invalidate(
      'image',
      'An offer image must be private artwork owned by its customer',
    );
  }
  if (this.isNew && this.expiresAt && this.expiresAt <= new Date()) {
    this.invalidate('expiresAt', 'An offer expiry must be in the future');
  }
  if (
    this.status === 'reserved' &&
    (!this.order || !this.reservedAt || !this.reservationExpiresAt)
  ) {
    this.invalidate(
      'order',
      'A reserved offer requires an order and reservation timestamps',
    );
  }
  if (this.status === 'purchased' && (!this.order || !this.purchasedAt)) {
    this.invalidate(
      'order',
      'A purchased offer requires an order and purchase timestamp',
    );
  }
  if (this.status === 'cancelled' && !this.cancelledAt) {
    this.invalidate(
      'cancelledAt',
      'A cancelled offer requires a cancellation timestamp',
    );
  }
  if (this.status === 'reserved' || this.status === 'purchased') {
    const order = this.order
      ? await Order.findById(this.order)
          .select(
            'user status payment.status payment.fulfillmentCompletedAt items.product',
          )
          .lean()
      : null;
    if (
      !order ||
      order.user?.toString() !== this.customer.toString() ||
      !order.items.some(
        (item) => item.product.toString() === this.product.toString(),
      )
    ) {
      this.invalidate(
        'order',
        'The offer order must belong to its customer and include its product',
      );
    } else if (
      this.status === 'reserved' &&
      !(
        (order.status === 'pending_payment' &&
          order.payment.status !== 'paid') ||
        (order.payment.status === 'paid' &&
          !order.payment.fulfillmentCompletedAt)
      )
    ) {
      this.invalidate(
        'order',
        'A reserved offer requires an unpaid order awaiting payment or a paid order with unfinished fulfillment',
      );
    } else if (this.status === 'purchased' && order.payment.status !== 'paid') {
      this.invalidate(
        'order',
        'A purchased offer requires a successfully paid order',
      );
    }
  }
});

export const CustomOffer: Model<ICustomOffer> =
  (models.CustomOffer as Model<ICustomOffer> | undefined) ??
  model<ICustomOffer>('CustomOffer', customOfferSchema);
