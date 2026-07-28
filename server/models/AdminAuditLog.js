import mongoose from 'mongoose';

const adminAuditLogSchema = new mongoose.Schema(
  {
    actorEmail: { type: String, trim: true, default: 'admin-key', index: true },
    action: { type: String, trim: true, required: true, index: true },
    entityType: { type: String, trim: true, required: true, index: true },
    entityId: { type: String, trim: true },
    label: { type: String, trim: true },
    detail: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

adminAuditLogSchema.index({ createdAt: -1 });

export default mongoose.model('AdminAuditLog', adminAuditLogSchema);
