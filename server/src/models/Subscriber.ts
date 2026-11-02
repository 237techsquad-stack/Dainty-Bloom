import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface ISubscriber extends Document {
  email: string;
  status: 'subscribed' | 'unsubscribed';
  consentAt: Date;
  source: string;
  unsubscribeTokenHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const subscriberSchema = new Schema<ISubscriber>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['subscribed', 'unsubscribed'],
      default: 'subscribed',
      index: true,
    },
    consentAt: { type: Date, required: true },
    source: { type: String, required: true, trim: true },
    unsubscribeTokenHash: { type: String, required: true, select: false },
  },
  { timestamps: true },
);
subscriberSchema.index({ status: 1, createdAt: -1 });

export const Subscriber: Model<ISubscriber> =
  (models.Subscriber as Model<ISubscriber> | undefined) ??
  model<ISubscriber>('Subscriber', subscriberSchema);
