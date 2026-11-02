import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface IWishlist extends Document {
  user?: Schema.Types.ObjectId;
  sessionId?: string;
  products: Schema.Types.ObjectId[];
}

const wishlistSchema = new Schema<IWishlist>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    sessionId: { type: String, trim: true },
    products: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
      default: [],
    },
  },
  { timestamps: true },
);

wishlistSchema.pre('validate', function () {
  if (!this.user && !this.sessionId) {
    this.invalidate(
      'user',
      'A wishlist must belong to a user or guest session',
    );
  }
});
wishlistSchema.index({ user: 1 }, { unique: true, sparse: true });
wishlistSchema.index({ sessionId: 1 }, { unique: true, sparse: true });

export const Wishlist: Model<IWishlist> =
  (models.Wishlist as Model<IWishlist> | undefined) ??
  model<IWishlist>('Wishlist', wishlistSchema);
