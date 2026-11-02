import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface IPaymentFulfillment {
  order: Types.ObjectId;
  status: 'pending' | 'processing' | 'completed' | 'blocked';
  leaseToken?: string;
  leaseUntil?: Date;
  attempts: number;
  offerCompletedAt?: Date;
  orderPaidAt?: Date;
  soldCountAppliedAt?: Date;
  auditLoggedAt?: Date;
  emailSentAt?: Date;
  lastError?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentFulfillmentSchema = new Schema<IPaymentFulfillment>(
  {
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'blocked'],
      default: 'pending',
      required: true,
    },
    leaseToken: { type: String },
    leaseUntil: { type: Date },
    attempts: { type: Number, min: 0, default: 0 },
    offerCompletedAt: Date,
    orderPaidAt: Date,
    soldCountAppliedAt: Date,
    auditLoggedAt: Date,
    emailSentAt: Date,
    lastError: { type: String, trim: true },
    completedAt: Date,
  },
  { timestamps: true },
);

paymentFulfillmentSchema.index(
  { order: 1 },
  { unique: true, name: 'payment_fulfillment_order_unique' },
);
paymentFulfillmentSchema.index({ status: 1, leaseUntil: 1, updatedAt: 1 });

export const PaymentFulfillment: Model<IPaymentFulfillment> =
  (models.PaymentFulfillment as Model<IPaymentFulfillment> | undefined) ??
  model<IPaymentFulfillment>('PaymentFulfillment', paymentFulfillmentSchema);
