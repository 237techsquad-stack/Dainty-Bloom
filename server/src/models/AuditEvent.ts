import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface IAuditEvent extends Document {
  actor?: Schema.Types.ObjectId;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  ip?: string;
  idempotencyKey?: string;
}

const auditEventSchema = new Schema<IAuditEvent>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorRole: { type: String, required: true, trim: true },
    action: { type: String, required: true, trim: true, index: true },
    targetType: { type: String, required: true, trim: true, index: true },
    targetId: { type: String, required: true, trim: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, trim: true },
    idempotencyKey: { type: String, trim: true },
  },
  { timestamps: true },
);

const immutableError = (): Error => new Error('Audit events are append-only');

auditEventSchema.pre('save', function () {
  if (!this.isNew) throw immutableError();
});
auditEventSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function () {
    throw immutableError();
  },
);
for (const operation of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  auditEventSchema.pre(operation, function () {
    throw immutableError();
  });
}

auditEventSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditEventSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
auditEventSchema.index({ actor: 1, createdAt: -1 });
auditEventSchema.index({ action: 1, createdAt: -1 });
auditEventSchema.index({ targetType: 1, createdAt: -1 });
auditEventSchema.index({ createdAt: -1 });

export const AuditEvent: Model<IAuditEvent> =
  (models.AuditEvent as Model<IAuditEvent> | undefined) ??
  model<IAuditEvent>('AuditEvent', auditEventSchema);
