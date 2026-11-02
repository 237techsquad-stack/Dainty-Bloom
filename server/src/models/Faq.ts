import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface IFaq extends Document {
  question: string;
  answer: string;
  category: string;
  sortOrder: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const faqSchema = new Schema<IFaq>(
  {
    question: { type: String, required: true, trim: true, maxlength: 300 },
    answer: { type: String, required: true, trim: true, maxlength: 10000 },
    category: { type: String, required: true, trim: true, maxlength: 100 },
    sortOrder: { type: Number, required: true, min: 0, validate: Number.isInteger },
    isPublished: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

faqSchema.index({ isPublished: 1, category: 1, sortOrder: 1 });

export const Faq: Model<IFaq> =
  (models.Faq as Model<IFaq> | undefined) ?? model<IFaq>('Faq', faqSchema);
