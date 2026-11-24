import { db } from '../../db/index.ts';
import { auditEvents } from '../../db/schema.ts';

export interface AuditLogInput {
  tenantId: string;
  facilityId?: string | null;
  actorUserId?: string | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export function logStructured(level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown> = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    service: 'coverpulse-api',
    event,
    ...data,
  };
  if (level === 'error') {
    console.error(JSON.stringify(payload));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}

export async function recordAuditEvent(input: AuditLogInput) {
  try {
    const [created] = await db
      .insert(auditEvents)
      .values({
        tenantId: input.tenantId,
        facilityId: input.facilityId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorEmail: input.actorEmail,
        actorRole: input.actorRole,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        metadataJson: input.metadata ?? {},
        ipAddress: input.ipAddress ?? null,
      })
      .returning();
    logStructured('info', 'audit_event_recorded', {
      tenantId: input.tenantId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorRole: input.actorRole,
    });
    return created;
  } catch (error) {
    logStructured('error', 'audit_event_failed', {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to write immutable audit record.', { cause: error });
  }
}
