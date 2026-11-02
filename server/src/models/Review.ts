import {
  Schema,
  Types,
  model,
  models,
  type Document,
  type Model,
} from 'mongoose';

import {
  REVIEW_MODERATION_STATES,
  type ReviewModerationState,
} from '../constants/review';

export interface IReview extends Document {
  product: Types.ObjectId;
  user: Types.ObjectId;
  order?: Types.ObjectId;
  rating: number;
  title: string;
  body: string;
  moderationState: ReviewModerationState;
  moderatedBy?: Types.ObjectId;
  moderatedAt?: Date;
  moderationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: Number.isInteger,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    moderationState: {
      type: String,
      enum: REVIEW_MODERATION_STATES,
      default: 'pending',
      index: true,
    },
    moderatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    moderatedAt: Date,
    moderationReason: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

reviewSchema.index({ product: 1, user: 1 }, { unique: true });
reviewSchema.index({ product: 1, moderationState: 1, createdAt: -1 });
reviewSchema.index({ moderationState: 1, rating: 1, createdAt: -1 });
reviewSchema.index({ moderationState: 1, product: 1, createdAt: -1 });

export const Review: Model<IReview> =
  (models.Review as Model<IReview> | undefined) ??
  model<IReview>('Review', reviewSchema);
