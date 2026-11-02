import {
  Schema,
  Types,
  model,
  models,
  type Document,
  type Model,
} from 'mongoose';

import { env } from '../config/env';

export interface ISelectedOption {
  key: string;
  value: string;
}

export interface ICartItem {
  _id: Types.ObjectId;
  product: Schema.Types.ObjectId;
  selectedOptions: ISelectedOption[];
  quantity: number;
  artwork?: Schema.Types.ObjectId;
  unitPriceSnapshotMinor: number;
  titleSnapshot: string;
  imageSnapshot?: string;
}

export interface ICart extends Document {
  createdAt: Date;
  updatedAt: Date;
  user?: Schema.Types.ObjectId;
  sessionId?: string;
  items: ICartItem[];
  mergedGuestItemIds: Types.ObjectId[];
  currency: string;
  expiresAt?: Date;
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

const cartSchema = new Schema<ICart>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    sessionId: { type: String, trim: true },
    items: {
      type: [
        new Schema<ICartItem>(
          {
            product: {
              type: Schema.Types.ObjectId,
              ref: 'Product',
              required: true,
            },
            selectedOptions: {
              type: [
                new Schema<ISelectedOption>(
                  {
                    key: { type: String, required: true },
                    value: { type: String, required: true },
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
            artwork: { type: Schema.Types.ObjectId, ref: 'ArtworkAsset' },
            unitPriceSnapshotMinor: moneyField,
            titleSnapshot: { type: String, required: true, trim: true },
            imageSnapshot: { type: String, trim: true },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    mergedGuestItemIds: {
      type: [{ type: Schema.Types.ObjectId }],
      default: [],
      select: false,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      enum: ['GBP'],
      default: () => env.DEFAULT_CURRENCY,
    },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

cartSchema.pre('validate', function () {
  if (!this.user && !this.sessionId) {
    this.invalidate('user', 'A cart must belong to a user or guest session');
  }
});
cartSchema.index(
  { sessionId: 1 },
  { unique: true, partialFilterExpression: { sessionId: { $type: 'string' } } },
);
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });
cartSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { user: { $type: 'objectId' } } },
);
cartSchema.index({ user: 1, updatedAt: -1 });

export const Cart: Model<ICart> =
  (models.Cart as Model<ICart> | undefined) ?? model<ICart>('Cart', cartSchema);
