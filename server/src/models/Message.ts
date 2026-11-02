import {
  Schema,
  Types,
  model,
  models,
  type Document,
  type Model,
} from 'mongoose';

import {
  CUSTOM_REQUEST_IMAGE_PURPOSES,
  CUSTOM_REQUEST_NOTIFICATION_STATUSES,
  CUSTOM_REQUEST_RESPONSE_STATUSES,
  CUSTOM_REQUEST_STATUSES,
  MESSAGE_STATUSES,
  MESSAGE_EMAIL_DELIVERY_STATUSES,
  type CustomRequestNotificationStatus,
  type CustomRequestResponseStatus,
  type CustomRequestStatus,
  MESSAGE_TYPES,
  type CustomRequestImagePurpose,
  type MessageEmailDeliveryStatus,
  type MessageStatus,
  type MessageType,
} from '../constants/message';

export interface IMessage extends Document {
  name: string;
  email: string;
  orderNumber?: string;
  subject: string;
  body: string;
  submissionId?: string;
  type: MessageType;
  customerId?: Types.ObjectId;
  customRequestStatus?: CustomRequestStatus;
  customRequestResponses: Array<{
    _id?: Types.ObjectId;
    status: CustomRequestResponseStatus;
    message: string;
    author: Types.ObjectId;
    notificationStatus: CustomRequestNotificationStatus;
    createdAt: Date;
  }>;
  emailDeliveryStatus: MessageEmailDeliveryStatus;
  requestDetails?: {
    description?: string;
    productName?: string;
    productType?: string;
    otherProductType?: string;
    phone?: string;
    imagePurpose?: CustomRequestImagePurpose;
    approximateSize?: string;
    preferredColour?: string;
    preferredMaterial?: string;
    budget?: string;
    quantity?: number;
    neededByDate?: Date;
  };
  quotedPriceMinor?: number;
  quotedPriceCurrency?: string;
  quoteNote?: string;
  attachment?: Types.ObjectId;
  status: MessageStatus;
  assignedTo?: Types.ObjectId;
  ipHash?: string;
  replies: Array<{
    _id?: Types.ObjectId;
    author: Types.ObjectId;
    body: string;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    orderNumber: { type: String, trim: true, index: true },
    subject: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    submissionId: { type: String, trim: true },
    type: {
      type: String,
      enum: MESSAGE_TYPES,
      default: 'general',
      index: true,
    },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    customRequestStatus: {
      type: String,
      enum: CUSTOM_REQUEST_STATUSES,
      index: true,
    },
    customRequestResponses: {
      type: [
        new Schema(
          {
            status: {
              type: String,
              enum: CUSTOM_REQUEST_RESPONSE_STATUSES,
              required: true,
            },
            message: {
              type: String,
              required: true,
              trim: true,
              maxlength: 2000,
            },
            author: {
              type: Schema.Types.ObjectId,
              ref: 'User',
              required: true,
            },
            notificationStatus: {
              type: String,
              enum: CUSTOM_REQUEST_NOTIFICATION_STATUSES,
              required: true,
              default: 'pending',
            },
            createdAt: { type: Date, required: true, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    emailDeliveryStatus: {
      type: String,
      enum: MESSAGE_EMAIL_DELIVERY_STATUSES,
      default: 'not_required',
    },
    requestDetails: {
      description: { type: String, trim: true, minlength: 20, maxlength: 2000 },
      productName: { type: String, trim: true, maxlength: 160 },
      productType: { type: String, trim: true, maxlength: 120 },
      otherProductType: { type: String, trim: true, maxlength: 120 },
      phone: { type: String, trim: true, maxlength: 40 },
      imagePurpose: {
        type: String,
        enum: CUSTOM_REQUEST_IMAGE_PURPOSES,
      },
      approximateSize: { type: String, trim: true, maxlength: 200 },
      preferredColour: { type: String, trim: true, maxlength: 120 },
      preferredMaterial: { type: String, trim: true, maxlength: 120 },
      budget: { type: String, trim: true, maxlength: 120 },
      quantity: { type: Number, min: 1, validate: Number.isInteger },
      neededByDate: { type: Date },
    },
    quotedPriceMinor: {
      type: Number,
      min: 0,
      validate: Number.isInteger,
    },
    quotedPriceCurrency: { type: String, uppercase: true, enum: ['GBP'] },
    quoteNote: { type: String, trim: true, maxlength: 2000 },
    attachment: { type: Schema.Types.ObjectId, ref: 'ArtworkAsset' },
    status: {
      type: String,
      enum: MESSAGE_STATUSES,
      default: 'new',
      index: true,
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    ipHash: { type: String, trim: true },
    replies: {
      type: [
        new Schema(
          {
            author: {
              type: Schema.Types.ObjectId,
              ref: 'User',
              required: true,
            },
            body: { type: String, required: true, trim: true },
            createdAt: { type: Date, required: true, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

messageSchema.index({ status: 1, createdAt: -1 });
messageSchema.index({ status: 1, assignedTo: 1, createdAt: -1 });
messageSchema.index({ submissionId: 1 }, { unique: true, sparse: true });

export const Message: Model<IMessage> =
  (models.Message as Model<IMessage> | undefined) ??
  model<IMessage>('Message', messageSchema);
