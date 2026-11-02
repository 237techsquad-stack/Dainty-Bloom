import { Schema, model, models, type Model } from 'mongoose';

interface IStaffControl {
  _id: string;
  activeAdminCount: number;
}

const staffControlSchema = new Schema<IStaffControl>(
  {
    _id: { type: String, required: true },
    activeAdminCount: { type: Number, required: true, min: 0 },
  },
  { versionKey: false },
);

export const StaffControl: Model<IStaffControl> =
  (models.StaffControl as Model<IStaffControl> | undefined) ??
  model<IStaffControl>('StaffControl', staffControlSchema);
