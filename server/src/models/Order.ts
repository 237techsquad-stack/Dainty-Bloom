import {
  Schema,
  Types,
  model,
  models,
  type Document,
  type Model,
} from 'mongoose';

import {
  FULFILLMENT_STATUS,
  ORDER_STATUS_TRANSITIONS,
  PAYMENT_STATUS,
  PRINT_STATUS,
  canTransition,
  type FulfillmentStatus,
  type OrderStatus,
  type PaymentStatus,
  type PrintStatus,
} from '../constants/order';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { generateOrderNumber } from '../utils/orderNumber';

export interface IOrderContact {
  name: string;
  email: string;
  phone?: string;
}

export interface IOrderAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface IOrderItem extends Document {
  product: Types.ObjectId;
  titleSnapshot: string;
  skuSnapshot: string;
  selectedOptions: Array<{
    key: string;
    value: string;
    label?: string;
    valueLabel?: string;
  }>;
  quantity: number;
  productionQuantity?: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  artwork?: Types.ObjectId;
  itemPrintStatus: PrintStatus;
  requiresProof: boolean;
}

export interface IOrderStatusHistory {
  from: OrderStatus;
  to: OrderStatus;
  actor?: Types.ObjectId;
  note?: string;
  at: Date;
}

export interface IOrderShipment {
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  dispatchedAt: Date;
  note?: string;
}

export interface IOrderInternalNote {
  author: Types.ObjectId;
  note: string;
  at: Date;
}

export interface IOrderRefund {
  amountMinor: number;
  reason: string;
  reference?: string;
  actor?: Types.ObjectId;
  at: Date;
}

export interface IOrder extends Document {
  orderNumber: string;
  user?: Types.ObjectId;
  customOffer?: Types.ObjectId;
  guestEmail?: string;
  contactSnapshot: IOrderContact;
  shippingAddress: IOrderAddress;
  billingAddress: IOrderAddress;
  items: IOrderItem[];
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  payment: {
    provider: string;
    providerReference?: string;
    stripeCheckoutSessionId?: string;
    stripeCheckoutSessionStatus?: 'open' | 'complete' | 'expired';
    stripeCheckoutExpiresAt?: Date;
    stripeCheckoutCreatingUntil?: Date;
    stripeCheckoutAttempt: number;
    stripeCheckoutRecoveryStatus?:
      'ready' | 'creating' | 'awaiting_result' | 'needs_review';
    stripePaymentIntentId?: string;
    fulfillmentCompletedAt?: Date;
    mismatchNote?: string;
    method?: string;
    status: PaymentStatus;
    paidAt?: Date;
  };
  fulfillmentStatus: FulfillmentStatus;
  status: OrderStatus;
  statusHistory: IOrderStatusHistory[];
  idempotencyKey?: string;
  idempotencyScope?: string;
  notes?: string;
  shipment?: IOrderShipment;
  internalNotes: IOrderInternalNote[];
  refunds: IOrderRefund[];
  reservedStock: Array<{
    product: Types.ObjectId;
    quantity: number;
  }>;
  transitionTo(
    newStatus: OrderStatus,
    actorId?: Types.ObjectId,
    note?: string,
  ): void;
  createdAt: Date;
  updatedAt: Date;
}

const moneyField = {
  type: Number,
  required: true,
  min: 0,
  validate: {
    validator: Number.isInteger,
    message: 'Money values must be integer minor units',
  },
};

const addressSchema = new Schema<IOrderAddress>(
  {
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    customOffer: {
      type: Schema.Types.ObjectId,
      ref: 'CustomOffer',
      sparse: true,
    },
    guestEmail: { type: String, lowercase: true, trim: true, index: true },
    contactSnapshot: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, lowercase: true, trim: true },
      phone: { type: String, trim: true },
    },
    shippingAddress: { type: addressSchema, required: true },
    billingAddress: { type: addressSchema, required: true },
    items: {
      type: [
        new Schema<IOrderItem>(
          {
            product: {
              type: Schema.Types.ObjectId,
              ref: 'Product',
              required: true,
            },
            titleSnapshot: { type: String, required: true, trim: true },
            skuSnapshot: { type: String, required: true, trim: true },
            selectedOptions: {
              type: [
                new Schema(
                  {
                    key: { type: String, required: true },
                    value: { type: String, required: true },
                    label: { type: String, trim: true },
                    valueLabel: { type: String, trim: true },
                  },
                  { _id: false },
                ),
              ],
              default: [],
            },
            quantity: {
              type: Number,
              required: true,
              min: 1,
              validate: Number.isInteger,
            },
            productionQuantity: {
              type: Number,
              min: 1,
              validate: Number.isInteger,
              default: 1,
            },
            unitPriceMinor: moneyField,
            lineTotalMinor: moneyField,
            artwork: { type: Schema.Types.ObjectId, ref: 'ArtworkAsset' },
            itemPrintStatus: {
              type: String,
              enum: PRINT_STATUS,
              default: 'queued',
            },
            requiresProof: { type: Boolean, default: false },
          },
          { timestamps: true },
        ),
      ],
      required: true,
      default: [],
    },
    subtotalMinor: moneyField,
    discountMinor: { ...moneyField, default: 0 },
    shippingMinor: { ...moneyField, default: 0 },
    taxMinor: { ...moneyField, default: 0 },
    totalMinor: moneyField,
    currency: {
      type: String,
      required: true,
      uppercase: true,
      default: () => env.DEFAULT_CURRENCY,
    },
    payment: {
      provider: {
        type: String,
        required: true,
        default: () => env.PAYMENT_PROVIDER,
      },
      providerReference: { type: String, trim: true },
      stripeCheckoutSessionId: { type: String, trim: true },
      stripeCheckoutSessionStatus: {
        type: String,
        enum: ['open', 'complete', 'expired'],
      },
      stripeCheckoutExpiresAt: Date,
      stripeCheckoutCreatingUntil: Date,
      stripeCheckoutAttempt: { type: Number, default: 0, min: 0 },
      stripeCheckoutRecoveryStatus: {
        type: String,
        enum: ['ready', 'creating', 'awaiting_result', 'needs_review'],
        default: 'ready',
      },
      stripePaymentIntentId: { type: String, trim: true },
      fulfillmentCompletedAt: Date,
      mismatchNote: { type: String, trim: true },
      method: { type: String, trim: true },
      status: { type: String, enum: PAYMENT_STATUS, default: 'pending' },
      paidAt: Date,
    },
    fulfillmentStatus: {
      type: String,
      enum: FULFILLMENT_STATUS,
      default: 'unfulfilled',
      index: true,
    },
    status: {
      type: String,
      enum: Object.keys(ORDER_STATUS_TRANSITIONS),
      default: 'pending_payment',
      index: true,
    },
    statusHistory: {
      type: [
        new Schema<IOrderStatusHistory>(
          {
            from: {
              type: String,
              enum: Object.keys(ORDER_STATUS_TRANSITIONS),
              required: true,
            },
            to: {
              type: String,
              enum: Object.keys(ORDER_STATUS_TRANSITIONS),
              required: true,
            },
            actor: { type: Schema.Types.ObjectId, ref: 'User' },
            note: { type: String, trim: true },
            at: { type: Date, required: true, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    idempotencyKey: { type: String, trim: true },
    idempotencyScope: { type: String, trim: true },
    notes: { type: String, trim: true },
    shipment: {
      carrier: { type: String, trim: true },
      trackingNumber: { type: String, trim: true },
      trackingUrl: { type: String, trim: true },
      dispatchedAt: Date,
      note: { type: String, trim: true },
    },
    internalNotes: {
      type: [
        new Schema<IOrderInternalNote>(
          {
            author: {
              type: Schema.Types.ObjectId,
              ref: 'User',
              required: true,
            },
            note: { type: String, required: true, trim: true },
            at: { type: Date, required: true, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    refunds: {
      type: [
        new Schema<IOrderRefund>(
          {
            amountMinor: { ...moneyField, required: true },
            reason: { type: String, required: true, trim: true },
            reference: { type: String, trim: true },
            actor: { type: Schema.Types.ObjectId, ref: 'User' },
            at: { type: Date, required: true, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    reservedStock: {
      type: [
        new Schema(
          {
            product: {
              type: Schema.Types.ObjectId,
              ref: 'Product',
              required: true,
            },
            quantity: {
              type: Number,
              required: true,
              min: 1,
              validate: Number.isInteger,
            },
          },
          { _id: false },
        ),
      ],
      default: [],
      select: false,
    },
  },
  { timestamps: true },
);

orderSchema.pre('validate', function () {
  if (!this.orderNumber) this.orderNumber = generateOrderNumber();
});
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index(
  { customOffer: 1 },
  { unique: true, sparse: true, name: 'orders_customOffer_unique' },
);
orderSchema.index({ user: 1, 'payment.status': 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'payment.stripeCheckoutSessionId': 1 }, { sparse: true });
orderSchema.index({ 'payment.stripePaymentIntentId': 1 }, { sparse: true });
orderSchema.index({
  currency: 1,
  createdAt: -1,
  status: 1,
  'payment.paidAt': 1,
});
orderSchema.index({
  'items.product': 1,
  currency: 1,
  status: 1,
  'payment.paidAt': 1,
});
orderSchema.index(
  { idempotencyScope: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
orderSchema.index({ 'contactSnapshot.email': 1, createdAt: -1 });
orderSchema.index({ 'contactSnapshot.name': 1, createdAt: -1 });
orderSchema.index({ guestEmail: 1, createdAt: -1 });
orderSchema.index({ status: 1, 'items.itemPrintStatus': 1, createdAt: 1 });
orderSchema.methods.transitionTo = function (
  this: IOrder,
  newStatus: OrderStatus,
  actorId?: Types.ObjectId,
  note?: string,
): void {
  if (!canTransition(this.status, newStatus)) {
    throw new AppError(
      `Cannot transition order from ${this.status} to ${newStatus}`,
      400,
      'INVALID_STATUS_TRANSITION',
    );
  }

  const from = this.status;
  this.status = newStatus;
  this.statusHistory.push({
    from,
    to: newStatus,
    actor: actorId,
    note,
    at: new Date(),
  });
};

export const Order: Model<IOrder> =
  (models.Order as Model<IOrder> | undefined) ??
  model<IOrder>('Order', orderSchema);
