import AdminAuditLog from '../models/AdminAuditLog.js';

function adminActor(req) {
  return req.admin?.email || 'admin-key';
}

async function recordAdminAudit(req, entry = {}) {
  try {
    await AdminAuditLog.create({
      actorEmail: adminActor(req),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      label: entry.label,
      detail: entry.detail
    });
  } catch (error) {
    console.warn('[admin-audit] could not record action', error?.message || error);
  }
}

export { adminActor, recordAdminAudit };
