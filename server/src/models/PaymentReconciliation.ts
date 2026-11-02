import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface IPaymentReconciliation {
  dedupeKey: string;
  provider: 'stripe';
  reason: string;
  status: 'manual_review' | 'resolved';
  webhookEventId?: string;
  sessionId?: string;
  paymentIntentId?: string;
  order?: Types.ObjectId;
  candidateOrderId?: string;
  offer?: Types.ObjectId;
  customer?: Types.ObjectId;
  product?: Types.ObjectId;
  amountMinor: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentReconciliationSchema = new Schema<IPaymentReconciliation>(
  {
    dedupeKey: { type: String, required: true },
    provider: { type: String, enum: ['stripe'], required: true },
    reason: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['manual_review', 'resolved'],
      default: 'manual_review',
      required: true,
    },
    webhookEventId: { type: String, trim: true },
    sessionId: { type: String, trim: true },
    paymentIntentId: { type: String, trim: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    candidateOrderId: { type: String, trim: true },
    offer: { type: Schema.Types.ObjectId, ref: 'CustomOffer' },
    customer: { type: Schema.Types.ObjectId, ref: 'User' },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    amountMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true },
  },
  { timestamps: true },
);

paymentReconciliationSchema.index(
  { dedupeKey: 1 },
  { unique: true, name: 'payment_reconciliation_dedupe_unique' },
);
paymentReconciliationSchema.index({ status: 1, createdAt: 1 });

export const PaymentReconciliation: Model<IPaymentReconciliation> =
  (models.PaymentReconciliation as Model<IPaymentReconciliation> | undefined) ??
  model<IPaymentReconciliation>(
    'PaymentReconciliation',
    paymentReconciliationSchema,
  );
