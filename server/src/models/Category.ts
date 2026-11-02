import {
  Schema,
  Types,
  model,
  models,
  type Document,
  type Model,
} from 'mongoose';

import { slugify } from '../utils/slugify';
import {
  CATEGORY_FORM_PROFILES,
  DEFAULT_CATEGORY_FORM_PROFILE,
  type CategoryFormProfile,
} from '../constants/category';

export interface ICategory extends Document {
  name: string;
  slug: string;
  description?: string;
  image?: string;
  formProfile?: CategoryFormProfile;
  parent?: Types.ObjectId;
  sortOrder: number;
  isActive: boolean;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: { type: String, trim: true },
    image: { type: String, trim: true },
    formProfile: {
      type: String,
      enum: CATEGORY_FORM_PROFILES,
      default: DEFAULT_CATEGORY_FORM_PROFILE,
    },
    parent: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    sortOrder: { type: Number, default: 0, min: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

categorySchema.pre('validate', function () {
  if (!this.slug && this.name) this.slug = slugify(this.name);
});
categorySchema.index({ isActive: 1, sortOrder: 1 });

export const Category: Model<ICategory> =
  (models.Category as Model<ICategory> | undefined) ??
  model<ICategory>('Category', categorySchema);
