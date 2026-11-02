import { Schema, model, models, type Document, type Model } from 'mongoose';

import {
  ACCOUNT_STATES,
  USER_ROLES,
  type AccountState,
  type UserRole,
} from '../constants/roles';

export interface IAddress {
  label: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  accountState: AccountState;
  phone?: string;
  addresses: IAddress[];
  emailVerified: boolean;
  lastLoginAt?: Date;
  tokenVersion: number;
  failedLoginAttempts: number;
  lockUntil?: Date;
  passwordResetTokenHash?: string;
  passwordResetExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema<IAddress>(
  {
    label: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, default: 'customer', index: true },
    accountState: {
      type: String,
      enum: ACCOUNT_STATES,
      default: 'active',
      index: true,
    },
    phone: { type: String, trim: true },
    addresses: { type: [addressSchema], default: [] },
    emailVerified: { type: Boolean, default: false, index: true },
    lastLoginAt: Date,
    tokenVersion: { type: Number, default: 0, min: 0 },
    failedLoginAttempts: { type: Number, default: 0, min: 0, select: false },
    lockUntil: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
  },
  { timestamps: true },
);

userSchema.index({ role: 1, accountState: 1 });

export const User: Model<IUser> =
  (models.User as Model<IUser> | undefined) ?? model<IUser>('User', userSchema);
