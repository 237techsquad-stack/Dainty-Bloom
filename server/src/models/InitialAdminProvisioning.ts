import { Schema, model, models, type Model, type Types } from 'mongoose';

interface IInitialAdminProvisioning {
  _id: string;
  userId: Types.ObjectId;
  createdAt: Date;
}

const initialAdminProvisioningSchema = new Schema<IInitialAdminProvisioning>(
  {
    _id: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false },
);

export const InitialAdminProvisioning: Model<IInitialAdminProvisioning> =
  (models.InitialAdminProvisioning as
    Model<IInitialAdminProvisioning> | undefined) ??
  model<IInitialAdminProvisioning>(
    'InitialAdminProvisioning',
    initialAdminProvisioningSchema,
  );
