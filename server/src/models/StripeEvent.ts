import { Schema, model, models, type Model } from 'mongoose';

interface IStripeEvent {
  eventId: string;
  type: string;
  status: 'processing' | 'completed';
  leaseToken: string;
  leaseUntil: Date;
  attempts: number;
  lastError?: string;
  completedAt?: Date;
}

const stripeEventSchema = new Schema<IStripeEvent>(
  {
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    status: {
      type: String,
      enum: ['processing', 'completed'],
      required: true,
    },
    leaseToken: { type: String, required: true },
    leaseUntil: { type: Date, required: true },
    attempts: { type: Number, required: true, min: 1, default: 1 },
    lastError: { type: String, trim: true },
    completedAt: Date,
  },
  { versionKey: false },
);
stripeEventSchema.index({ eventId: 1 }, { unique: true });
stripeEventSchema.index(
  { completedAt: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60,
    partialFilterExpression: { status: 'completed' },
  },
);

export const StripeEvent: Model<IStripeEvent> =
  (models.StripeEvent as Model<IStripeEvent> | undefined) ??
  model<IStripeEvent>('StripeEvent', stripeEventSchema);
