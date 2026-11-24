import crypto from 'crypto';
import express, { type Response } from 'express';
import { and, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  auditEvents,
  availabilityWindows,
  consentRecords,
  coveragePolicies,
  coverageRuns,
  facilities,
  integrations,
  invoiceReferences,
  memberships,
  notifications,
  offerEvents,
  planConfigs,
  qualificationEvidence,
  qualifications,
  shiftAssignments,
  shiftOffers,
  shiftRequirements,
  shifts,
  skills,
  subscriptions,
  supportAccessGrants,
  tenants,
  users,
  webhookDeliveries,
  webhookEndpoints,
  workerFacilities,
  workerProfiles,
} from '../../db/schema.ts';
import { ensureSeeded } from '../../db/seed.ts';
import {
  assertFacilityScope,
  issueDemoSessionToken,
  requireAuth,
  requirePermission,
  type AuthedRequest,
} from '../auth.ts';
import { PERMISSIONS } from '../rbac.ts';
import { recordAuditEvent } from '../services/audit.ts';
import {
  advanceOrEscalateRun,
  acceptShiftOfferAtomic,
  declineShiftOffer,
  manualOverrideAssign,
  startCoverageRun,
} from '../services/autopilot.ts';
import { computeShiftPaidHours, evaluateShiftEligibilityFromDb } from '../services/eligibility.ts';
import {
  isEmailProviderConfigured,
  isSmsProviderConfigured,
  signWebhookPayload,
  validateSafeWebhookUrl,
  verifyWebhookSignature,
} from '../services/providers.ts';
import { generateAnalyticsBrief, generateShiftCoverageExplanation } from '../services/ai.ts';
import type { RoleKey } from '../../shared/types.ts';

export const apiRouter = express.Router();

// Simple in-memory rate limiter for sensitive/public endpoints
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxPerMinute: number) {
  return (req: express.Request, res: Response, next: express.NextFunction) => {
    const key = `${req.ip || 'local'}:${req.path}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + 60000 });
      return next();
    }
    if (bucket.count >= maxPerMinute) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    bucket.count += 1;
    return next();
  };
}

// Ensure seed data exists on first API interaction (lazy — no eager DB call at module load!)
apiRouter.use(async (_req, res, next) => {
  try {
    await ensureSeeded();
    next();
  } catch (error) {
    console.error('Database initialization error:', error);
    res.status(503).json({ error: 'Service temporarily initializing. Please retry shortly.' });
  }
});

// ============================================================================
// PUBLIC & HEALTH ROUTES
// ============================================================================
apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'coverpulse-api',
    timestamp: new Date().toISOString(),
    adapters: {
      sms: isSmsProviderConfigured() ? 'connected' : 'sandbox',
      email: isEmailProviderConfigured() ? 'connected' : 'sandbox',
    },
  });
});

apiRouter.get('/public/plans', async (_req, res) => {
  try {
    const plans = await db.select().from(planConfigs).where(eq(planConfigs.active, true));
    const order = ['essential', 'growth', 'enterprise'];
    plans.sort((a, b) => order.indexOf(a.tierKey) - order.indexOf(b.tierKey));
    res.json({ plans });
  } catch (error) {
    console.error('Failed to load plan configs:', error);
    res.status(500).json({ error: 'Unable to load pricing configuration.' });
  }
});

const demoRequestSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  email: z.string().trim().email('Valid work email is required').max(160),
  organisationName: z.string().trim().min(2, 'Organisation name is required').max(160),
  sector: z.enum(['Aged Care', 'Disability Support', 'Community Care', 'Multi-Service Provider']),
  facilityCount: z.string().trim().min(1).max(40),
  phone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(1000).optional(),
  consentGranted: z.literal(true, { message: 'Privacy consent is required.' }),
});

apiRouter.post('/public/demo-request', rateLimit(15), async (req, res) => {
  const parsed = demoRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid form input.' });
  }
  try {
    const data = parsed.data;
    const [record] = await db
      .insert(consentRecords)
      .values({
        subjectEmail: data.email,
        subjectName: data.fullName,
        organisationName: data.organisationName,
        consentType: 'demo_lead',
        granted: true,
        privacyVersion: 'APP-2026.1',
        detailsJson: {
          sector: data.sector,
          facilityCount: data.facilityCount,
          phone: data.phone || null,
          notes: data.notes || null,
        },
      })
      .returning();

    res.status(201).json({
      id: record.id,
      message:
        'Demo request received. Your privacy consent has been recorded (APP-2026.1). A CoverPulse onboarding specialist will respond within 1 business day.',
    });
  } catch (error) {
    console.error('Failed to save demo request:', error);
    res.status(500).json({ error: 'Unable to record demo request right now.' });
  }
});

// ============================================================================
// AUTH & DEMO PERSONA SWITCHING
// ============================================================================
apiRouter.get('/auth/demo-personas', async (_req, res) => {
  try {
    const rows = await db
      .select({
        userId: users.id,
        uid: users.uid,
        fullName: users.fullName,
        email: users.email,
        roleKey: memberships.roleKey,
        permittedFacilityIds: memberships.permittedFacilityIds,
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .where(eq(tenants.isDemo, true));

    const demoPersonas = rows.filter((r) => r.uid.startsWith('demo-'));
    const order = [
      'demo-org-owner',
      'demo-ops-manager',
      'demo-facility-manager',
      'demo-coordinator',
      'demo-worker-chloe',
      'demo-auditor',
      'demo-platform-admin',
      'demo-tenant-b-worker',
    ];
    demoPersonas.sort((a, b) => order.indexOf(a.uid) - order.indexOf(b.uid));
    res.json({ personas: demoPersonas });
  } catch (error) {
    console.error('Failed to load demo personas:', error);
    res.status(500).json({ error: 'Unable to load demo workspace accounts.' });
  }
});

apiRouter.post('/auth/demo-session', rateLimit(40), async (req, res) => {
  const schema = z.object({ uid: z.string().min(3).max(80) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid persona selection.' });
  }

  try {
    const [row] = await db
      .select({
        userId: users.id,
        uid: users.uid,
        email: users.email,
        fullName: users.fullName,
        isPlatformAdmin: users.isPlatformAdmin,
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        isDemo: tenants.isDemo,
        roleKey: memberships.roleKey,
        permittedFacilityIds: memberships.permittedFacilityIds,
      })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .where(and(eq(users.uid, parsed.data.uid), eq(tenants.isDemo, true)))
      .limit(1);

    if (!row || !row.uid.startsWith('demo-')) {
      return res.status(404).json({ error: 'Demo persona not found.' });
    }

    const token = issueDemoSessionToken({
      userId: row.userId,
      tenantId: row.tenantId,
      roleKey: row.roleKey as RoleKey,
    });

    await recordAuditEvent({
      tenantId: row.tenantId,
      actorUserId: row.userId,
      actorEmail: row.email,
      actorRole: row.roleKey,
      action: 'auth.demo_session_started',
      entityType: 'user',
      entityId: row.userId,
      summary: `${row.fullName} signed into synthetic demo workspace as ${row.roleKey}.`,
      ipAddress: req.ip,
    });

    res.json({ token });
  } catch (error) {
    console.error('Demo session issue failed:', error);
    res.status(500).json({ error: 'Could not initialize demo session.' });
  }
});

apiRouter.get('/auth/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ session: req.session });
});

// ============================================================================
// BILLING WEBHOOK (Verified HMAC + Idempotent — no user session required)
// ============================================================================
apiRouter.post('/webhooks/billing', rateLimit(30), async (req, res) => {
  const sigHeader = req.headers['x-coverpulse-billing-signature'];
  const secret = process.env.BILLING_WEBHOOK_SECRET || 'coverpulse_billing_sandbox_secret';
  const rawBody = JSON.stringify(req.body ?? {});

  if (typeof sigHeader !== 'string') {
    return res.status(400).json({ error: 'Missing billing signature header.' });
  }

  const check = verifyWebhookSignature(rawBody, sigHeader, secret);
  if (!check.valid) {
    return res.status(401).json({ error: `Invalid billing webhook signature: ${check.reason}` });
  }

  const schema = z.object({
    eventId: z.string().min(4),
    type: z.enum(['subscription.updated', 'invoice.paid', 'subscription.past_due']),
    tenantId: z.string().uuid(),
    planTier: z.enum(['essential', 'growth', 'enterprise']).optional(),
    status: z.enum(['trialing', 'paid_pilot', 'active', 'past_due', 'cancelled']).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid billing webhook payload.' });
  }

  try {
    const { eventId, type, tenantId, planTier, status } = parsed.data;
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1);

    if (!sub) return res.status(404).json({ error: 'Subscription not found.' });
    if (sub.lastWebhookEventId === eventId) {
      return res.json({ received: true, duplicate: true });
    }

    await db
      .update(subscriptions)
      .set({
        planTier: planTier ?? sub.planTier,
        status: status ?? (type === 'subscription.past_due' ? 'past_due' : sub.status),
        lastWebhookEventId: eventId,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));

    await recordAuditEvent({
      tenantId,
      actorEmail: 'billing-webhook@coverpulse.system',
      actorRole: 'system',
      action: `billing.webhook.${type}`,
      entityType: 'subscription',
      entityId: sub.id,
      summary: `Processed verified billing webhook ${type} (${eventId}).`,
      metadata: { eventId, planTier, status },
    });

    res.json({ received: true, duplicate: false });
  } catch (error) {
    console.error('Billing webhook failed:', error);
    res.status(500).json({ error: 'Failed to process billing event.' });
  }
});

// ============================================================================
// HELPER: SCOPE FACILITIES FOR CURRENT SESSION
// ============================================================================
async function getScopedFacilityIds(session: NonNullable<AuthedRequest['session']>, requestedFacilityId?: string) {
  const allTenantFacs = await db
    .select()
    .from(facilities)
    .where(eq(facilities.tenantId, session.tenantId));

  const permitted =
    session.permittedFacilityIds.length > 0 &&
    !['platform_super_admin', 'org_owner', 'auditor'].includes(session.roleKey)
      ? allTenantFacs.filter((f) => session.permittedFacilityIds.includes(f.id))
      : allTenantFacs;

  if (requestedFacilityId && requestedFacilityId !== 'all') {
    const match = permitted.find((f) => f.id === requestedFacilityId);
    if (!match) return { facilities: permitted, activeFacilityIds: [] as string[], forbidden: true };
    return { facilities: permitted, activeFacilityIds: [match.id], forbidden: false };
  }

  return {
    facilities: permitted,
    activeFacilityIds: permitted.map((f) => f.id),
    forbidden: false,
  };
}

// ============================================================================
// EXECUTIVE / MANAGER DASHBOARD
// ============================================================================
apiRouter.get(
  '/dashboard',
  requireAuth,
  requirePermission(PERMISSIONS.DASHBOARD_VIEW),
  async (req: AuthedRequest, res) => {
    try {
      const session = req.session!;
      const periodDays = Math.min(90, Math.max(7, Number(req.query.periodDays) || 30));
      const requestedFac = typeof req.query.facilityId === 'string' ? req.query.facilityId : 'all';

      const scope = await getScopedFacilityIds(session, requestedFac);
      if (scope.forbidden) {
        return res.status(403).json({ error: 'You do not have access to the requested facility.' });
      }

      const [tenantRow] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, session.tenantId))
        .limit(1);

      const since = new Date(Date.now() - periodDays * 24 * 3600 * 1000);

      const allShifts =
        scope.activeFacilityIds.length === 0
          ? []
          : await db
              .select()
              .from(shifts)
              .where(
                and(
                  eq(shifts.tenantId, session.tenantId),
                  inArray(shifts.facilityId, scope.activeFacilityIds),
                ),
              )
              .orderBy(desc(shifts.startAt));

      const periodShifts = allShifts.filter(
        (s) => s.status !== 'draft' && s.status !== 'cancelled' && s.createdAt.getTime() >= since.getTime(),
      );

      const totalPublishedPositions = periodShifts.reduce((acc, s) => acc + s.headcount, 0);
      const coveredPositions = periodShifts.reduce((acc, s) => acc + Math.min(s.filledCount, s.headcount), 0);
      const coverageRatePct =
        totalPublishedPositions > 0
          ? Number(((coveredPositions / totalPublishedPositions) * 100).toFixed(1))
          : 0;

      const openStatuses = ['open', 'broadcasting', 'partially_covered'];
      const openShiftsList = allShifts.filter((s) => openStatuses.includes(s.status));

      const firstRespSamples = periodShifts
        .filter((s) => s.publishedAt && s.firstResponseAt)
        .map((s) => Math.max(1, (s.firstResponseAt!.getTime() - s.publishedAt!.getTime()) / 60000));
      const avgFirstResponseMin =
        firstRespSamples.length > 0
          ? Number((firstRespSamples.reduce((a, b) => a + b, 0) / firstRespSamples.length).toFixed(1))
          : 0;

      const fillSamples = periodShifts
        .filter((s) => s.publishedAt && s.filledAt)
        .map((s) => Math.max(1, (s.filledAt!.getTime() - s.publishedAt!.getTime()) / 60000));
      const avgTimeToFillMin =
        fillSamples.length > 0
          ? Number((fillSamples.reduce((a, b) => a + b, 0) / fillSamples.length).toFixed(1))
          : 0;

      // Transparent customer-configured avoided agency cost estimate
      const agencyRate = tenantRow?.settingsJson.agencyHourlyRateAud ?? 96;
      const internalRate = tenantRow?.settingsJson.internalHourlyRateAud ?? 54;
      const rateDiff = Math.max(0, agencyRate - internalRate);
      const coveredHours = periodShifts
        .filter((s) => s.status === 'covered' || s.status === 'partially_covered')
        .reduce(
          (acc, s) => acc + computeShiftPaidHours(s.startAt, s.endAt, s.breakMinutes) * s.filledCount,
          0,
        );
      const estimatedAvoidedAgencyAud = Math.round(coveredHours * rateDiff);

      // Pending manager confirmations
      const pendingConfirmRows = await db
        .select({ id: shiftAssignments.id })
        .from(shiftAssignments)
        .where(
          and(
            eq(shiftAssignments.tenantId, session.tenantId),
            eq(shiftAssignments.status, 'pending_confirmation'),
          ),
        );

      // Expiring/expired credentials within 30 days
      const thirtyDaysAhead = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const expiringCreds = await db
        .select({
          id: qualificationEvidence.id,
          expiresAt: qualificationEvidence.expiresAt,
          reviewStatus: qualificationEvidence.reviewStatus,
        })
        .from(qualificationEvidence)
        .where(
          and(
            eq(qualificationEvidence.tenantId, session.tenantId),
            lte(qualificationEvidence.expiresAt, thirtyDaysAhead),
          ),
        );

      const expiredCount = expiringCreds.filter(
        (c) => c.expiresAt.getTime() < Date.now() || c.reviewStatus === 'expired',
      ).length;
      const expiringSoonCount = expiringCreds.length - expiredCount;

      // Build trend buckets across the period (6 buckets)
      const bucketCount = periodDays <= 14 ? 7 : 6;
      const bucketSpanMs = (periodDays * 24 * 3600 * 1000) / bucketCount;
      const trend = Array.from({ length: bucketCount }, (_, i) => {
        const startMs = since.getTime() + i * bucketSpanMs;
        const endMs = startMs + bucketSpanMs;
        const inBucket = periodShifts.filter(
          (s) => s.startAt.getTime() >= startMs && s.startAt.getTime() < endMs,
        );
        const pubPos = inBucket.reduce((acc, s) => acc + s.headcount, 0);
        const covPos = inBucket.reduce((acc, s) => acc + Math.min(s.filledCount, s.headcount), 0);
        const labelDate = new Date(startMs);
        return {
          label: labelDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
          published: pubPos,
          covered: covPos,
          fillRatePct: pubPos > 0 ? Math.round((covPos / pubPos) * 100) : 100,
        };
      });

      const facById = new Map(scope.facilities.map((f) => [f.id, f]));

      // Enrich urgent queue & upcoming shifts with offer counts
      const activeShiftIds = openShiftsList.map((s) => s.id);
      const offerCountsByShift = new Map<string, number>();
      if (activeShiftIds.length > 0) {
        const offersRows = await db
          .select({ shiftId: shiftOffers.shiftId })
          .from(shiftOffers)
          .where(
            and(eq(shiftOffers.tenantId, session.tenantId), inArray(shiftOffers.shiftId, activeShiftIds)),
          );
        for (const o of offersRows) {
          offerCountsByShift.set(o.shiftId, (offerCountsByShift.get(o.shiftId) ?? 0) + 1);
        }
      }

      const urgentQueue = openShiftsList
        .sort((a, b) => {
          const score = (u: string, esc: Date | null) =>
            (esc ? 10 : 0) + (u === 'critical' ? 5 : u === 'high' ? 3 : 1);
          return score(b.urgency, b.escalatedAt) - score(a.urgency, a.escalatedAt);
        })
        .map((s) => ({
          ...s,
          facilityName: facById.get(s.facilityId)?.name ?? 'Facility',
          facilityCode: facById.get(s.facilityId)?.code ?? '',
          offersDispatched: offerCountsByShift.get(s.id) ?? 0,
          minutesOpen: s.publishedAt
            ? Math.max(1, Math.round((Date.now() - s.publishedAt.getTime()) / 60000))
            : 0,
        }));

      const nowMs = Date.now();
      const upcomingShifts = allShifts
        .filter((s) => s.startAt.getTime() >= nowMs - 12 * 3600000 && s.status !== 'cancelled')
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
        .slice(0, 8)
        .map((s) => ({
          ...s,
          facilityName: facById.get(s.facilityId)?.name ?? 'Facility',
        }));

      res.json({
        periodDays,
        facilities: scope.facilities,
        kpis: {
          coverageRatePct,
          coveredPositions,
          totalPublishedPositions,
          openShiftsCount: openShiftsList.length,
          escalatedCount: openShiftsList.filter((s) => Boolean(s.escalatedAt)).length,
          avgFirstResponseMin,
          avgTimeToFillMin,
          estimatedAvoidedAgencyAud,
          coveredHours: Number(coveredHours.toFixed(1)),
          costAssumptions: {
            agencyHourlyRateAud: agencyRate,
            internalHourlyRateAud: internalRate,
            differentialPerHourAud: rateDiff,
            label: 'Estimated differential based on organisation-configured agency vs internal hourly rates',
          },
          pendingApprovalsCount: pendingConfirmRows.length,
          expiredCredentialsCount: expiredCount,
          expiringSoonCredentialsCount: expiringSoonCount,
        },
        trend,
        urgentQueue,
        upcomingShifts,
      });
    } catch (error) {
      console.error('Dashboard load failed:', error);
      res.status(500).json({ error: 'Unable to load dashboard metrics.' });
    }
  },
);

// ============================================================================
// SHIFTS, ELIGIBILITY & AUTOPILOT ROUTES
// ============================================================================
apiRouter.get(
  '/shifts',
  requireAuth,
  requirePermission(PERMISSIONS.SHIFTS_VIEW),
  async (req: AuthedRequest, res) => {
    try {
      const session = req.session!;
      const facilityParam = typeof req.query.facilityId === 'string' ? req.query.facilityId : 'all';
      const statusParam = typeof req.query.status === 'string' ? req.query.status : 'all';
      const urgencyParam = typeof req.query.urgency === 'string' ? req.query.urgency : 'all';
      const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      const scope = await getScopedFacilityIds(session, facilityParam);
      if (scope.forbidden) {
        return res.status(403).json({ error: 'Access denied to requested facility.' });
      }
      if (scope.activeFacilityIds.length === 0) {
        return res.json({ shifts: [], facilities: scope.facilities });
      }

      let rows = await db
        .select()
        .from(shifts)
        .where(
          and(eq(shifts.tenantId, session.tenantId), inArray(shifts.facilityId, scope.activeFacilityIds)),
        )
        .orderBy(desc(shifts.startAt));

      if (statusParam !== 'all') {
        rows = rows.filter((r) => r.status === statusParam);
      }
      if (urgencyParam !== 'all') {
        rows = rows.filter((r) => r.urgency === urgencyParam);
      }
      if (search) {
        rows = rows.filter(
          (r) =>
            r.title.toLowerCase().includes(search) ||
            r.roleRequired.toLowerCase().includes(search) ||
            (r.notes ?? '').toLowerCase().includes(search),
        );
      }

      const facMap = new Map(scope.facilities.map((f) => [f.id, f]));
      const shiftIds = rows.map((r) => r.id);

      const runsRows =
        shiftIds.length > 0
          ? await db
              .select()
              .from(coverageRuns)
              .where(
                and(eq(coverageRuns.tenantId, session.tenantId), inArray(coverageRuns.shiftId, shiftIds)),
              )
              .orderBy(desc(coverageRuns.createdAt))
          : [];

      const offersRows =
        shiftIds.length > 0
          ? await db
              .select({ shiftId: shiftOffers.shiftId, status: shiftOffers.status })
              .from(shiftOffers)
              .where(
                and(eq(shiftOffers.tenantId, session.tenantId), inArray(shiftOffers.shiftId, shiftIds)),
              )
          : [];

      const enriched = rows.map((s) => {
        const latestRun = runsRows.find((r) => r.shiftId === s.id) ?? null;
        const sOffers = offersRows.filter((o) => o.shiftId === s.id);
        return {
          ...s,
          facilityName: facMap.get(s.facilityId)?.name ?? 'Facility',
          facilityCode: facMap.get(s.facilityId)?.code ?? '',
          facilityTimezone: facMap.get(s.facilityId)?.timezone ?? 'Australia/Sydney',
          paidHours: computeShiftPaidHours(s.startAt, s.endAt, s.breakMinutes),
          offersTotal: sOffers.length,
          offersPending: sOffers.filter((o) => ['queued', 'sent', 'delivered', 'opened'].includes(o.status))
            .length,
          latestRun,
        };
      });

      res.json({ shifts: enriched, facilities: scope.facilities });
    } catch (error) {
      console.error('Failed to list shifts:', error);
      res.status(500).json({ error: 'Unable to load shifts.' });
    }
  },
);

const createShiftSchema = z.object({
  facilityId: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  roleRequired: z.string().trim().min(2).max(80),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breakMinutes: z.number().int().min(0).max(120).default(30),
  headcount: z.number().int().min(1).max(20).default(1),
  urgency: z.enum(['standard', 'high', 'critical']).default('standard'),
  hourlyRateAud: z.number().min(20).max(250).default(52),
  showRateToWorker: z.boolean().default(true),
  requiresManagerConfirmation: z.boolean().default(false),
  publishNow: z.boolean().default(true),
  notes: z.string().trim().max(1000).optional(),
  requiredQualificationIds: z.array(z.string().uuid()).default([]),
  requiredSkills: z.array(z.string().trim().min(1)).default([]),
});

apiRouter.post(
  '/shifts',
  requireAuth,
  requirePermission(PERMISSIONS.SHIFTS_MANAGE),
  async (req: AuthedRequest, res) => {
    const parsed = createShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid shift input.' });
    }

    const session = req.session!;
    const data = parsed.data;

    if (!assertFacilityScope(session, data.facilityId)) {
      return res.status(403).json({ error: 'You cannot create shifts for an unassigned facility.' });
    }

    try {
      const [fac] = await db
        .select()
        .from(facilities)
        .where(and(eq(facilities.id, data.facilityId), eq(facilities.tenantId, session.tenantId)))
        .limit(1);

      if (!fac) {
        return res.status(404).json({ error: 'Facility not found in your organisation.' });
      }

      // Compute overnight-safe UTC timestamps (Australia/Sydney +10 offset baseline)
      const [sh, sm] = data.startTime.split(':').map(Number);
      const [eh, em] = data.endTime.split(':').map(Number);
      const isOvernight = eh * 60 + em <= sh * 60 + sm;

      const startAt = new Date(`${data.shiftDate}T${data.startTime}:00+10:00`);
      const endDateBase = new Date(`${data.shiftDate}T${data.endTime}:00+10:00`);
      const endAt = isOvernight ? new Date(endDateBase.getTime() + 24 * 3600000) : endDateBase;

      const durationHours = (endAt.getTime() - startAt.getTime()) / 3600000;
      if (durationHours < 2 || durationHours > 16) {
        return res.status(400).json({
          error: `Shift duration (${durationHours.toFixed(1)}h) must be between 2 and 16 hours.`,
        });
      }

      const [created] = await db
        .insert(shifts)
        .values({
          tenantId: session.tenantId,
          facilityId: data.facilityId,
          title: data.title,
          roleRequired: data.roleRequired,
          shiftDate: data.shiftDate,
          startAt,
          endAt,
          breakMinutes: data.breakMinutes,
          headcount: data.headcount,
          filledCount: 0,
          urgency: data.urgency,
          status: data.publishNow ? 'open' : 'draft',
          isOvernight,
          hourlyRateCents: Math.round(data.hourlyRateAud * 100),
          showRateToWorker: data.showRateToWorker,
          requiresManagerConfirmation: data.requiresManagerConfirmation,
          notes: data.notes ?? null,
          createdByUserId: session.userId,
          publishedAt: data.publishNow ? new Date() : null,
        })
        .returning();

      const reqRows: Array<typeof shiftRequirements.$inferInsert> = [];
      for (const qId of data.requiredQualificationIds) {
        reqRows.push({
          tenantId: session.tenantId,
          shiftId: created.id,
          qualificationId: qId,
          isMandatory: true,
        });
      }
      for (const sk of data.requiredSkills) {
        reqRows.push({
          tenantId: session.tenantId,
          shiftId: created.id,
          requiredSkillName: sk,
          isMandatory: false,
        });
      }
      if (reqRows.length > 0) {
        await db.insert(shiftRequirements).values(reqRows);
      }

      await db.insert(offerEvents).values({
        tenantId: session.tenantId,
        shiftId: created.id,
        eventType: data.publishNow ? 'shift_published' : 'shift_created',
        summary: `${session.fullName} created ${data.publishNow ? 'and published ' : ''}${created.title} (${created.roleRequired}, ${isOvernight ? 'overnight' : 'day'}).`,
        metadataJson: { facilityCode: fac.code, isOvernight, urgency: data.urgency },
      });

      await recordAuditEvent({
        tenantId: session.tenantId,
        facilityId: fac.id,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'shift.created',
        entityType: 'shift',
        entityId: created.id,
        summary: `Created shift "${created.title}" at ${fac.name}.`,
        metadata: { roleRequired: created.roleRequired, status: created.status },
        ipAddress: req.ip,
      });

      res.status(201).json({ shift: created });
    } catch (error) {
      console.error('Create shift failed:', error);
      res.status(500).json({ error: 'Unable to create shift.' });
    }
  },
);

apiRouter.get(
  '/shifts/:id',
  requireAuth,
  requirePermission(PERMISSIONS.SHIFTS_VIEW),
  async (req: AuthedRequest, res) => {
    try {
      const session = req.session!;
      const shiftId = req.params.id;

      const [shift] = await db
        .select()
        .from(shifts)
        .where(and(eq(shifts.id, shiftId), eq(shifts.tenantId, session.tenantId)))
        .limit(1);

      if (!shift) {
        return res.status(404).json({ error: 'Shift not found in your organisation.' });
      }
      if (!assertFacilityScope(session, shift.facilityId)) {
        return res.status(403).json({ error: 'You do not have access to this facility shift.' });
      }

      const [[facility], reqs, candidates, runs, offers, assignments, timeline, policies] = await Promise.all([
        db.select().from(facilities).where(eq(facilities.id, shift.facilityId)).limit(1),
        db
          .select({
            id: shiftRequirements.id,
            qualificationId: shiftRequirements.qualificationId,
            requiredSkillName: shiftRequirements.requiredSkillName,
            isMandatory: shiftRequirements.isMandatory,
            qualCode: qualifications.code,
            qualName: qualifications.name,
          })
          .from(shiftRequirements)
          .leftJoin(qualifications, eq(shiftRequirements.qualificationId, qualifications.id))
          .where(and(eq(shiftRequirements.shiftId, shift.id), eq(shiftRequirements.tenantId, session.tenantId))),
        evaluateShiftEligibilityFromDb(session.tenantId, shift.id),
        db
          .select()
          .from(coverageRuns)
          .where(and(eq(coverageRuns.shiftId, shift.id), eq(coverageRuns.tenantId, session.tenantId)))
          .orderBy(desc(coverageRuns.createdAt)),
        db
          .select({
            id: shiftOffers.id,
            workerId: shiftOffers.workerId,
            workerFirstName: workerProfiles.firstName,
            workerLastName: workerProfiles.lastName,
            waveNumber: shiftOffers.waveNumber,
            channel: shiftOffers.channel,
            status: shiftOffers.status,
            sentAt: shiftOffers.sentAt,
            expiresAt: shiftOffers.expiresAt,
            respondedAt: shiftOffers.respondedAt,
            declineReason: shiftOffers.declineReason,
            responseLatencySec: shiftOffers.responseLatencySec,
          })
          .from(shiftOffers)
          .innerJoin(workerProfiles, eq(shiftOffers.workerId, workerProfiles.id))
          .where(and(eq(shiftOffers.shiftId, shift.id), eq(shiftOffers.tenantId, session.tenantId)))
          .orderBy(desc(shiftOffers.createdAt)),
        db
          .select({
            id: shiftAssignments.id,
            workerId: shiftAssignments.workerId,
            workerFirstName: workerProfiles.firstName,
            workerLastName: workerProfiles.lastName,
            workerRole: workerProfiles.primaryRole,
            status: shiftAssignments.status,
            isOverride: shiftAssignments.isOverride,
            overrideReason: shiftAssignments.overrideReason,
            confirmedAt: shiftAssignments.confirmedAt,
          })
          .from(shiftAssignments)
          .innerJoin(workerProfiles, eq(shiftAssignments.workerId, workerProfiles.id))
          .where(
            and(eq(shiftAssignments.shiftId, shift.id), eq(shiftAssignments.tenantId, session.tenantId)),
          ),
        db
          .select()
          .from(offerEvents)
          .where(and(eq(offerEvents.shiftId, shift.id), eq(offerEvents.tenantId, session.tenantId)))
          .orderBy(desc(offerEvents.createdAt)),
        db
          .select()
          .from(coveragePolicies)
          .where(and(eq(coveragePolicies.tenantId, session.tenantId), eq(coveragePolicies.active, true))),
      ]);

      res.json({
        shift: {
          ...shift,
          paidHours: computeShiftPaidHours(shift.startAt, shift.endAt, shift.breakMinutes),
        },
        facility,
        requirements: reqs,
        candidates,
        runs,
        offers,
        assignments,
        timeline,
        policies,
      });
    } catch (error) {
      console.error('Shift detail failed:', error);
      res.status(500).json({ error: 'Unable to load shift details.' });
    }
  },
);

apiRouter.patch(
  '/shifts/:id',
  requireAuth,
  requirePermission(PERMISSIONS.SHIFTS_MANAGE),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      status: z.enum(['draft', 'open', 'cancelled']).optional(),
      urgency: z.enum(['standard', 'high', 'critical']).optional(),
      notes: z.string().max(1000).optional(),
      title: z.string().trim().min(3).max(160).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid shift update.' });

    const session = req.session!;
    try {
      const [existing] = await db
        .select()
        .from(shifts)
        .where(and(eq(shifts.id, req.params.id), eq(shifts.tenantId, session.tenantId)))
        .limit(1);

      if (!existing) return res.status(404).json({ error: 'Shift not found.' });
      if (!assertFacilityScope(session, existing.facilityId)) {
        return res.status(403).json({ error: 'Forbidden for this facility.' });
      }

      const now = new Date();
      const nextStatus = parsed.data.status ?? existing.status;
      const [updated] = await db
        .update(shifts)
        .set({
          status: nextStatus,
          urgency: parsed.data.urgency ?? existing.urgency,
          notes: parsed.data.notes !== undefined ? parsed.data.notes : existing.notes,
          title: parsed.data.title ?? existing.title,
          publishedAt: nextStatus === 'open' && !existing.publishedAt ? now : existing.publishedAt,
          updatedAt: now,
        })
        .where(eq(shifts.id, existing.id))
        .returning();

      if (nextStatus === 'cancelled') {
        await db
          .update(shiftOffers)
          .set({ status: 'withdrawn', updatedAt: now })
          .where(
            and(
              eq(shiftOffers.tenantId, session.tenantId),
              eq(shiftOffers.shiftId, existing.id),
              inArray(shiftOffers.status, ['queued', 'sent', 'delivered', 'opened']),
            ),
          );
        await db
          .update(coverageRuns)
          .set({
            status: 'stopped',
            completedAt: now,
            stoppedReason: 'Shift cancelled by manager',
            updatedAt: now,
          })
          .where(
            and(
              eq(coverageRuns.tenantId, session.tenantId),
              eq(coverageRuns.shiftId, existing.id),
              eq(coverageRuns.status, 'running'),
            ),
          );
        await db.insert(offerEvents).values({
          tenantId: session.tenantId,
          shiftId: existing.id,
          eventType: 'shift_cancelled',
          summary: `${session.fullName} cancelled shift and withdrew all active offers.`,
        });
      } else if (nextStatus === 'open' && existing.status === 'draft') {
        await db.insert(offerEvents).values({
          tenantId: session.tenantId,
          shiftId: existing.id,
          eventType: 'shift_published',
          summary: `${session.fullName} published draft shift to the coverage queue.`,
        });
      }

      await recordAuditEvent({
        tenantId: session.tenantId,
        facilityId: existing.facilityId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'shift.updated',
        entityType: 'shift',
        entityId: existing.id,
        summary: `Updated shift "${updated.title}" (status: ${updated.status}).`,
        metadata: parsed.data,
        ipAddress: req.ip,
      });

      res.json({ shift: updated });
    } catch (error) {
      console.error('Update shift failed:', error);
      res.status(500).json({ error: 'Unable to update shift.' });
    }
  },
);

apiRouter.post(
  '/shifts/:id/duplicate',
  requireAuth,
  requirePermission(PERMISSIONS.SHIFTS_MANAGE),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    try {
      const [orig] = await db
        .select()
        .from(shifts)
        .where(and(eq(shifts.id, req.params.id), eq(shifts.tenantId, session.tenantId)))
        .limit(1);

      if (!orig) return res.status(404).json({ error: 'Shift not found.' });
      if (!assertFacilityScope(session, orig.facilityId)) {
        return res.status(403).json({ error: 'Forbidden for this facility.' });
      }

      const nextStart = new Date(orig.startAt.getTime() + 24 * 3600000);
      const nextEnd = new Date(orig.endAt.getTime() + 24 * 3600000);

      const [copy] = await db
        .insert(shifts)
        .values({
          tenantId: session.tenantId,
          facilityId: orig.facilityId,
          title: `${orig.title} (Copy)`,
          roleRequired: orig.roleRequired,
          shiftDate: nextStart.toISOString().slice(0, 10),
          startAt: nextStart,
          endAt: nextEnd,
          breakMinutes: orig.breakMinutes,
          headcount: orig.headcount,
          filledCount: 0,
          urgency: orig.urgency,
          status: 'draft',
          isOvernight: orig.isOvernight,
          hourlyRateCents: orig.hourlyRateCents,
          showRateToWorker: orig.showRateToWorker,
          requiresManagerConfirmation: orig.requiresManagerConfirmation,
          notes: orig.notes,
          createdByUserId: session.userId,
        })
        .returning();

      const origReqs = await db
        .select()
        .from(shiftRequirements)
        .where(and(eq(shiftRequirements.shiftId, orig.id), eq(shiftRequirements.tenantId, session.tenantId)));

      if (origReqs.length > 0) {
        await db.insert(shiftRequirements).values(
          origReqs.map((r) => ({
            tenantId: session.tenantId,
            shiftId: copy.id,
            qualificationId: r.qualificationId,
            requiredSkillName: r.requiredSkillName,
            isMandatory: r.isMandatory,
          })),
        );
      }

      await recordAuditEvent({
        tenantId: session.tenantId,
        facilityId: copy.facilityId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'shift.duplicated',
        entityType: 'shift',
        entityId: copy.id,
        summary: `Duplicated shift "${orig.title}" into draft "${copy.title}".`,
      });

      res.status(201).json({ shift: copy });
    } catch (error) {
      console.error('Duplicate shift failed:', error);
      res.status(500).json({ error: 'Unable to duplicate shift.' });
    }
  },
);

apiRouter.post(
  '/shifts/:id/autopilot/start',
  requireAuth,
  requirePermission(PERMISSIONS.AUTOPILOT_RUN),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      policyId: z.string().uuid(),
      bypassQuietHours: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Valid coverage policy is required.' });

    try {
      const result = await startCoverageRun({
        session: req.session!,
        shiftId: req.params.id,
        policyId: parsed.data.policyId,
        bypassQuietHours: parsed.data.bypassQuietHours,
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to start autopilot.' });
    }
  },
);

apiRouter.post(
  '/shifts/:id/autopilot/advance',
  requireAuth,
  requirePermission(PERMISSIONS.AUTOPILOT_RUN),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    try {
      const result = await advanceOrEscalateRun({
        tenantId: session.tenantId,
        shiftId: req.params.id,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        triggerReason:
          typeof req.body?.reason === 'string' && req.body.reason.trim()
            ? req.body.reason.trim()
            : 'Response window closed by coordinator',
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to advance wave.' });
    }
  },
);

apiRouter.post(
  '/shifts/:id/override-assign',
  requireAuth,
  requirePermission(PERMISSIONS.SHIFTS_OVERRIDE),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      workerId: z.string().uuid(),
      reason: z.string().trim().min(10, 'Audit reason must be at least 10 characters.'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid override request.' });
    }

    try {
      const result = await manualOverrideAssign({
        session: req.session!,
        shiftId: req.params.id,
        workerId: parsed.data.workerId,
        reason: parsed.data.reason,
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Manual override failed.' });
    }
  },
);

apiRouter.post(
  '/shifts/:id/assignments/:assignmentId/confirm',
  requireAuth,
  requirePermission(PERMISSIONS.SHIFTS_MANAGE),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    try {
      const [assignment] = await db
        .select()
        .from(shiftAssignments)
        .where(
          and(
            eq(shiftAssignments.id, req.params.assignmentId),
            eq(shiftAssignments.shiftId, req.params.id),
            eq(shiftAssignments.tenantId, session.tenantId),
          ),
        )
        .limit(1);

      if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
      const now = new Date();
      await db
        .update(shiftAssignments)
        .set({ status: 'confirmed', confirmedAt: now, updatedAt: now })
        .where(eq(shiftAssignments.id, assignment.id));

      const [shift] = await db.select().from(shifts).where(eq(shifts.id, req.params.id)).limit(1);
      if (shift) {
        const covered = shift.filledCount >= shift.headcount;
        await db
          .update(shifts)
          .set({
            status: covered ? 'covered' : 'partially_covered',
            filledAt: covered ? now : shift.filledAt,
            updatedAt: now,
          })
          .where(eq(shifts.id, shift.id));
      }

      await recordAuditEvent({
        tenantId: session.tenantId,
        facilityId: assignment.facilityId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'assignment.confirmed',
        entityType: 'shift_assignment',
        entityId: assignment.id,
        summary: `Manager confirmed pending shift assignment.`,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('Confirm assignment failed:', error);
      res.status(500).json({ error: 'Unable to confirm assignment.' });
    }
  },
);

apiRouter.post(
  '/shifts/:id/ai-explain',
  requireAuth,
  requirePermission(PERMISSIONS.SHIFTS_VIEW),
  rateLimit(15),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    try {
      const [shift] = await db
        .select()
        .from(shifts)
        .where(and(eq(shifts.id, req.params.id), eq(shifts.tenantId, session.tenantId)))
        .limit(1);
      if (!shift) return res.status(404).json({ error: 'Shift not found.' });

      const [fac] = await db.select().from(facilities).where(eq(facilities.id, shift.facilityId)).limit(1);
      const candidates = await evaluateShiftEligibilityFromDb(session.tenantId, shift.id);

      const explanation = await generateShiftCoverageExplanation({
        shiftTitle: shift.title,
        facilityName: fac?.name ?? 'Facility',
        roleRequired: shift.roleRequired,
        urgency: shift.urgency,
        isOvernight: shift.isOvernight,
        candidates,
      });

      res.json(explanation);
    } catch (error) {
      console.error('AI shift explanation failed:', error);
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to generate AI decision-support explanation.',
      });
    }
  },
);

// ============================================================================
// WORKFORCE DIRECTORY & QUALIFICATIONS
// ============================================================================
apiRouter.get(
  '/qualifications',
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const rows = await db
        .select()
        .from(qualifications)
        .where(eq(qualifications.tenantId, req.session!.tenantId));
      res.json({ qualifications: rows });
    } catch (error) {
      console.error('Load qualifications failed:', error);
      res.status(500).json({ error: 'Unable to load qualification catalog.' });
    }
  },
);

apiRouter.get(
  '/workers',
  requireAuth,
  requirePermission(PERMISSIONS.WORKERS_VIEW),
  async (req: AuthedRequest, res) => {
    try {
      const session = req.session!;
      const scope = await getScopedFacilityIds(
        session,
        typeof req.query.facilityId === 'string' ? req.query.facilityId : 'all',
      );
      if (scope.forbidden) {
        return res.status(403).json({ error: 'Forbidden facility scope.' });
      }

      const [workerRows, wfRows, qualEvRows, qualDefs, skillRows] = await Promise.all([
        db.select().from(workerProfiles).where(eq(workerProfiles.tenantId, session.tenantId)),
        db.select().from(workerFacilities).where(eq(workerFacilities.tenantId, session.tenantId)),
        db.select().from(qualificationEvidence).where(eq(qualificationEvidence.tenantId, session.tenantId)),
        db.select().from(qualifications).where(eq(qualifications.tenantId, session.tenantId)),
        db.select().from(skills).where(eq(skills.tenantId, session.tenantId)),
      ]);

      const qualMap = new Map(qualDefs.map((q) => [q.id, q]));
      const facMap = new Map(scope.facilities.map((f) => [f.id, f]));
      const nowMs = Date.now();
      const soonMs = nowMs + 30 * 24 * 3600 * 1000;

      const roleFilter = typeof req.query.role === 'string' ? req.query.role : 'all';
      const credFilter = typeof req.query.credentialStatus === 'string' ? req.query.credentialStatus : 'all';
      const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      let enriched = workerRows
        .map((w) => {
          const wFacs = wfRows
            .filter((wf) => wf.workerId === w.id && wf.approved)
            .map((wf) => ({
              facilityId: wf.facilityId,
              facilityName: facMap.get(wf.facilityId)?.name ?? 'Facility',
              isPrimary: wf.isPrimary,
              distanceKm: wf.distanceKm,
            }));

          const creds = qualEvRows
            .filter((qe) => qe.workerId === w.id)
            .map((qe) => {
              const q = qualMap.get(qe.qualificationId);
              const isExpired = qe.expiresAt.getTime() < nowMs || qe.reviewStatus === 'expired';
              const isExpiringSoon = !isExpired && qe.expiresAt.getTime() <= soonMs;
              return {
                id: qe.id,
                qualificationId: qe.qualificationId,
                code: q?.code ?? 'CRED',
                name: q?.name ?? 'Credential',
                referenceNumber: qe.referenceNumber,
                expiresAt: qe.expiresAt,
                reviewStatus: isExpired ? 'expired' : qe.reviewStatus,
                isExpired,
                isExpiringSoon,
              };
            });

          const credentialHealth = creds.some((c) => c.isExpired || c.reviewStatus === 'rejected')
            ? 'expired'
            : creds.some((c) => c.isExpiringSoon || c.reviewStatus === 'pending')
              ? 'expiring_soon'
              : 'verified';

          return {
            ...w,
            fullName: `${w.firstName} ${w.lastName}`,
            facilities: wFacs,
            credentials: creds,
            credentialHealth,
            skills: skillRows.filter((s) => s.workerId === w.id).map((s) => s.name),
          };
        })
        .filter((w) => {
          // Enforce facility scope for facility managers
          if (scope.activeFacilityIds.length > 0) {
            return w.facilities.some((f) => scope.activeFacilityIds.includes(f.facilityId));
          }
          return true;
        });

      if (roleFilter !== 'all') {
        enriched = enriched.filter((w) => w.primaryRole === roleFilter);
      }
      if (credFilter !== 'all') {
        enriched = enriched.filter((w) => w.credentialHealth === credFilter);
      }
      if (search) {
        enriched = enriched.filter(
          (w) =>
            w.fullName.toLowerCase().includes(search) ||
            w.email.toLowerCase().includes(search) ||
            w.primaryRole.toLowerCase().includes(search) ||
            w.skills.some((sk) => sk.toLowerCase().includes(search)),
        );
      }

      enriched.sort((a, b) => a.fullName.localeCompare(b.fullName));
      res.json({ workers: enriched, facilities: scope.facilities, qualifications: qualDefs });
    } catch (error) {
      console.error('Failed to list workers:', error);
      res.status(500).json({ error: 'Unable to load workforce directory.' });
    }
  },
);

const createWorkerSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  phone: z.string().trim().min(8).max(24),
  primaryRole: z.string().trim().min(2).max(80),
  employmentType: z.enum(['Permanent Part-Time', 'Casual', 'Permanent Full-Time']),
  preferredChannel: z.enum(['in_app', 'sms', 'email']).default('sms'),
  postcode: z.string().trim().min(4).max(8).default('2230'),
  travelRadiusKm: z.number().int().min(5).max(100).default(20),
  facilityId: z.string().uuid(),
  skills: z.array(z.string().trim().min(1)).default([]),
});

apiRouter.post(
  '/workers',
  requireAuth,
  requirePermission(PERMISSIONS.WORKERS_MANAGE),
  async (req: AuthedRequest, res) => {
    const parsed = createWorkerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid worker details.' });
    }
    const session = req.session!;
    const data = parsed.data;

    try {
      // Enforce subscription worker limit
      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, session.tenantId))
        .limit(1);
      const currentWorkers = await db
        .select({ id: workerProfiles.id })
        .from(workerProfiles)
        .where(eq(workerProfiles.tenantId, session.tenantId));

      if (sub && currentWorkers.length >= sub.includedWorkers) {
        return res.status(403).json({
          error: `Plan limit reached (${sub.includedWorkers} workers on ${sub.planTier} tier). Upgrade plan in Billing.`,
        });
      }

      const [worker] = await db
        .insert(workerProfiles)
        .values({
          tenantId: session.tenantId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          primaryRole: data.primaryRole,
          employmentType: data.employmentType,
          preferredChannel: data.preferredChannel,
          postcode: data.postcode,
          travelRadiusKm: data.travelRadiusKm,
          availabilityStatus: 'available',
        })
        .returning();

      await db.insert(workerFacilities).values({
        tenantId: session.tenantId,
        workerId: worker.id,
        facilityId: data.facilityId,
        isPrimary: true,
        distanceKm: 8,
        approved: true,
      });

      if (data.skills.length > 0) {
        await db.insert(skills).values(
          data.skills.map((name) => ({
            tenantId: session.tenantId,
            workerId: worker.id,
            name,
            level: 'competent',
          })),
        );
      }

      await recordAuditEvent({
        tenantId: session.tenantId,
        facilityId: data.facilityId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'worker.created',
        entityType: 'worker_profile',
        entityId: worker.id,
        summary: `Added worker ${worker.firstName} ${worker.lastName} (${worker.primaryRole}).`,
      });

      res.status(201).json({ worker });
    } catch (error) {
      console.error('Create worker failed:', error);
      res.status(500).json({ error: 'Unable to create worker.' });
    }
  },
);

apiRouter.patch(
  '/credentials/:evidenceId/review',
  requireAuth,
  requirePermission(PERMISSIONS.CREDENTIALS_REVIEW),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      reviewStatus: z.enum(['verified', 'rejected', 'pending']),
      expiresAt: z.string().optional(),
      notes: z.string().max(400).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid credential review update.' });

    const session = req.session!;
    try {
      const [existing] = await db
        .select()
        .from(qualificationEvidence)
        .where(
          and(
            eq(qualificationEvidence.id, req.params.evidenceId),
            eq(qualificationEvidence.tenantId, session.tenantId),
          ),
        )
        .limit(1);

      if (!existing) return res.status(404).json({ error: 'Credential record not found.' });

      const nextExpiry = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : existing.expiresAt;
      const [updated] = await db
        .update(qualificationEvidence)
        .set({
          reviewStatus: parsed.data.reviewStatus,
          expiresAt: nextExpiry,
          notes: parsed.data.notes ?? existing.notes,
          reviewerUserId: session.userId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(qualificationEvidence.id, existing.id))
        .returning();

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'credential.reviewed',
        entityType: 'qualification_evidence',
        entityId: existing.id,
        summary: `Set credential ${existing.referenceNumber} review status to "${updated.reviewStatus}".`,
        metadata: { expiresAt: nextExpiry.toISOString() },
      });

      res.json({ credential: updated });
    } catch (error) {
      console.error('Credential review failed:', error);
      res.status(500).json({ error: 'Unable to update credential review.' });
    }
  },
);

apiRouter.post(
  '/workers/import-csv',
  requireAuth,
  requirePermission(PERMISSIONS.WORKERS_MANAGE),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      csvText: z.string().min(10).max(50000),
      facilityId: z.string().uuid(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Valid CSV text and target facility required.' });

    const session = req.session!;
    try {
      const lines = parsed.data.csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 2) {
        return res.status(400).json({ error: 'CSV must include header row and at least one worker row.' });
      }

      let importedCount = 0;
      for (const line of lines.slice(1, 51)) {
        const cols = line.split(',').map((c) => c.trim());
        if (cols.length < 5) continue;
        const [firstName, lastName, email, phone, primaryRole, employmentType = 'Casual'] = cols;
        if (!firstName || !lastName || !email.includes('@')) continue;

        const [w] = await db
          .insert(workerProfiles)
          .values({
            tenantId: session.tenantId,
            firstName,
            lastName,
            email,
            phone: phone || '+61400000000',
            primaryRole: primaryRole || 'Personal Care Worker (PCW)',
            employmentType,
            preferredChannel: 'sms',
            postcode: '2000',
            travelRadiusKm: 20,
          })
          .returning();

        await db.insert(workerFacilities).values({
          tenantId: session.tenantId,
          workerId: w.id,
          facilityId: parsed.data.facilityId,
          isPrimary: true,
          distanceKm: 10,
          approved: true,
        });
        importedCount++;
      }

      await recordAuditEvent({
        tenantId: session.tenantId,
        facilityId: parsed.data.facilityId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'workers.csv_imported',
        entityType: 'worker_profile',
        entityId: parsed.data.facilityId,
        summary: `Imported ${importedCount} worker(s) via CSV.`,
      });

      res.json({ importedCount });
    } catch (error) {
      console.error('CSV import failed:', error);
      res.status(500).json({ error: 'Unable to import CSV workers.' });
    }
  },
);

// ============================================================================
// FACILITIES & COVERAGE POLICIES
// ============================================================================
apiRouter.get(
  '/facilities',
  requireAuth,
  requirePermission(PERMISSIONS.FACILITIES_VIEW),
  async (req: AuthedRequest, res) => {
    try {
      const scope = await getScopedFacilityIds(req.session!);
      const allShifts = await db
        .select({ facilityId: shifts.facilityId, status: shifts.status })
        .from(shifts)
        .where(eq(shifts.tenantId, req.session!.tenantId));
      const allWf = await db
        .select({ facilityId: workerFacilities.facilityId })
        .from(workerFacilities)
        .where(eq(workerFacilities.tenantId, req.session!.tenantId));

      const enriched = scope.facilities.map((f) => ({
        ...f,
        openShiftsCount: allShifts.filter(
          (s) => s.facilityId === f.id && ['open', 'broadcasting', 'partially_covered'].includes(s.status),
        ).length,
        inductedWorkersCount: allWf.filter((wf) => wf.facilityId === f.id).length,
      }));
      res.json({ facilities: enriched });
    } catch (error) {
      console.error('Facilities load failed:', error);
      res.status(500).json({ error: 'Unable to load facilities.' });
    }
  },
);

apiRouter.post(
  '/facilities',
  requireAuth,
  requirePermission(PERMISSIONS.FACILITIES_MANAGE),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      name: z.string().trim().min(2).max(120),
      code: z.string().trim().min(2).max(20),
      serviceType: z.enum(['Aged Care', 'Disability Support', 'Community Care']),
      address: z.string().trim().min(3).max(160),
      suburb: z.string().trim().min(2).max(80),
      state: z.enum(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']),
      postcode: z.string().trim().min(4).max(6),
      timezone: z.string().trim().min(3).max(60),
      phone: z.string().trim().min(8).max(24),
      bedOrClientCapacity: z.number().int().min(1).max(2000).default(50),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid facility.' });

    const session = req.session!;
    try {
      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, session.tenantId))
        .limit(1);
      const existingFacs = await db
        .select({ id: facilities.id })
        .from(facilities)
        .where(eq(facilities.tenantId, session.tenantId));

      if (sub && existingFacs.length >= sub.includedFacilities) {
        return res.status(403).json({
          error: `Facility limit reached (${sub.includedFacilities} on ${sub.planTier} tier).`,
        });
      }

      const [fac] = await db
        .insert(facilities)
        .values({ ...parsed.data, tenantId: session.tenantId })
        .returning();

      await recordAuditEvent({
        tenantId: session.tenantId,
        facilityId: fac.id,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'facility.created',
        entityType: 'facility',
        entityId: fac.id,
        summary: `Added facility "${fac.name}" (${fac.code}, ${fac.suburb} ${fac.state}).`,
      });

      res.status(201).json({ facility: fac });
    } catch (error) {
      console.error('Create facility failed:', error);
      res.status(500).json({ error: 'Unable to create facility.' });
    }
  },
);

apiRouter.get(
  '/policies',
  requireAuth,
  requirePermission(PERMISSIONS.POLICIES_VIEW),
  async (req: AuthedRequest, res) => {
    try {
      const rows = await db
        .select()
        .from(coveragePolicies)
        .where(eq(coveragePolicies.tenantId, req.session!.tenantId))
        .orderBy(desc(coveragePolicies.createdAt));
      res.json({ policies: rows });
    } catch (error) {
      console.error('Load policies failed:', error);
      res.status(500).json({ error: 'Unable to load coverage policies.' });
    }
  },
);

const policySchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(5).max(400),
  dispatchMode: z.enum(['sequential', 'tiered', 'parallel_waves']),
  batchSize: z.number().int().min(1).max(20),
  responseWindowMinutes: z.number().int().min(5).max(240),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
  maxAttempts: z.number().int().min(1).max(6),
  reminderAfterMinutes: z.number().int().min(2).max(120),
  channelsJson: z.array(z.enum(['in_app', 'sms', 'email'])).min(1),
  escalationRecipientRole: z.string().trim().min(2).max(60),
  escalationRecipientEmail: z.string().trim().email(),
  requireManagerConfirmation: z.boolean().default(false),
});

apiRouter.post(
  '/policies',
  requireAuth,
  requirePermission(PERMISSIONS.POLICIES_MANAGE),
  async (req: AuthedRequest, res) => {
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid policy.' });

    const session = req.session!;
    try {
      const [created] = await db
        .insert(coveragePolicies)
        .values({ ...parsed.data, tenantId: session.tenantId })
        .returning();

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'policy.created',
        entityType: 'coverage_policy',
        entityId: created.id,
        summary: `Created coverage policy "${created.name}" (${created.dispatchMode}).`,
      });

      res.status(201).json({ policy: created });
    } catch (error) {
      console.error('Create policy failed:', error);
      res.status(500).json({ error: 'Unable to create policy.' });
    }
  },
);

// ============================================================================
// WORKER PWA ROUTES (Mobile-First Worker Experience)
// ============================================================================
apiRouter.get(
  '/worker/home',
  requireAuth,
  requirePermission(PERMISSIONS.WORKER_SELF),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    if (!session.workerId) {
      return res.status(404).json({ error: 'No worker profile is linked to this account.' });
    }

    try {
      const [[worker], offersRows, assignmentsRows, qualRows, availRows, notifRows] = await Promise.all([
        db
          .select()
          .from(workerProfiles)
          .where(and(eq(workerProfiles.id, session.workerId), eq(workerProfiles.tenantId, session.tenantId)))
          .limit(1),
        db
          .select({
            id: shiftOffers.id,
            status: shiftOffers.status,
            channel: shiftOffers.channel,
            sentAt: shiftOffers.sentAt,
            expiresAt: shiftOffers.expiresAt,
            respondedAt: shiftOffers.respondedAt,
            shiftId: shifts.id,
            shiftTitle: shifts.title,
            roleRequired: shifts.roleRequired,
            shiftDate: shifts.shiftDate,
            startAt: shifts.startAt,
            endAt: shifts.endAt,
            breakMinutes: shifts.breakMinutes,
            urgency: shifts.urgency,
            isOvernight: shifts.isOvernight,
            hourlyRateCents: shifts.hourlyRateCents,
            showRateToWorker: shifts.showRateToWorker,
            notes: shifts.notes,
            facilityName: facilities.name,
            facilitySuburb: facilities.suburb,
            facilityAddress: facilities.address,
            facilityPhone: facilities.phone,
          })
          .from(shiftOffers)
          .innerJoin(shifts, eq(shiftOffers.shiftId, shifts.id))
          .innerJoin(facilities, eq(shifts.facilityId, facilities.id))
          .where(
            and(
              eq(shiftOffers.tenantId, session.tenantId),
              eq(shiftOffers.workerId, session.workerId),
            ),
          )
          .orderBy(desc(shiftOffers.sentAt)),
        db
          .select({
            id: shiftAssignments.id,
            status: shiftAssignments.status,
            confirmedAt: shiftAssignments.confirmedAt,
            shiftId: shifts.id,
            shiftTitle: shifts.title,
            roleRequired: shifts.roleRequired,
            shiftDate: shifts.shiftDate,
            startAt: shifts.startAt,
            endAt: shifts.endAt,
            breakMinutes: shifts.breakMinutes,
            isOvernight: shifts.isOvernight,
            notes: shifts.notes,
            facilityName: facilities.name,
            facilitySuburb: facilities.suburb,
            facilityAddress: facilities.address,
            facilityPhone: facilities.phone,
          })
          .from(shiftAssignments)
          .innerJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
          .innerJoin(facilities, eq(shifts.facilityId, facilities.id))
          .where(
            and(
              eq(shiftAssignments.tenantId, session.tenantId),
              eq(shiftAssignments.workerId, session.workerId),
            ),
          )
          .orderBy(desc(shifts.startAt)),
        db
          .select({
            id: qualificationEvidence.id,
            referenceNumber: qualificationEvidence.referenceNumber,
            issuedAt: qualificationEvidence.issuedAt,
            expiresAt: qualificationEvidence.expiresAt,
            reviewStatus: qualificationEvidence.reviewStatus,
            code: qualifications.code,
            name: qualifications.name,
            category: qualifications.category,
          })
          .from(qualificationEvidence)
          .innerJoin(qualifications, eq(qualificationEvidence.qualificationId, qualifications.id))
          .where(
            and(
              eq(qualificationEvidence.tenantId, session.tenantId),
              eq(qualificationEvidence.workerId, session.workerId),
            ),
          ),
        db
          .select()
          .from(availabilityWindows)
          .where(
            and(
              eq(availabilityWindows.tenantId, session.tenantId),
              eq(availabilityWindows.workerId, session.workerId),
            ),
          )
          .orderBy(availabilityWindows.dayOfWeek),
        db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.tenantId, session.tenantId),
              eq(notifications.workerId, session.workerId),
            ),
          )
          .orderBy(desc(notifications.createdAt))
          .limit(20),
      ]);

      // Respect rate visibility policy strictly on server!
      const sanitizedOffers = offersRows.map((o) => ({
        ...o,
        hourlyRateAud: o.showRateToWorker ? Number((o.hourlyRateCents / 100).toFixed(2)) : null,
        hourlyRateCents: undefined,
        paidHours: computeShiftPaidHours(o.startAt, o.endAt, o.breakMinutes),
      }));

      const nowMs = Date.now();
      const upcomingShifts = assignmentsRows
        .filter((a) => a.startAt.getTime() >= nowMs - 4 * 3600000 && a.status !== 'cancelled')
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
      const pastShifts = assignmentsRows.filter((a) => a.startAt.getTime() < nowMs - 4 * 3600000);

      res.json({
        worker,
        openOffers: sanitizedOffers.filter((o) =>
          ['queued', 'sent', 'delivered', 'opened'].includes(o.status),
        ),
        offerHistory: sanitizedOffers.filter(
          (o) => !['queued', 'sent', 'delivered', 'opened'].includes(o.status),
        ),
        upcomingShifts,
        pastShifts,
        qualifications: qualRows,
        availability: availRows,
        notifications: notifRows,
      });
    } catch (error) {
      console.error('Worker home load failed:', error);
      res.status(500).json({ error: 'Unable to load worker schedule.' });
    }
  },
);

apiRouter.post(
  '/worker/offers/:offerId/accept',
  requireAuth,
  requirePermission(PERMISSIONS.WORKER_SELF),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    if (!session.workerId) return res.status(403).json({ error: 'No linked worker profile.' });

    try {
      const result = await acceptShiftOfferAtomic({
        tenantId: session.tenantId,
        offerId: req.params.offerId,
        workerId: session.workerId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
      });
      res.json(result);
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : 'Unable to accept shift offer.' });
    }
  },
);

apiRouter.post(
  '/worker/offers/:offerId/decline',
  requireAuth,
  requirePermission(PERMISSIONS.WORKER_SELF),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    if (!session.workerId) return res.status(403).json({ error: 'No linked worker profile.' });

    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : undefined;
      const result = await declineShiftOffer({
        tenantId: session.tenantId,
        offerId: req.params.offerId,
        workerId: session.workerId,
        reason,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to decline offer.' });
    }
  },
);

apiRouter.patch(
  '/worker/availability',
  requireAuth,
  requirePermission(PERMISSIONS.WORKER_SELF),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      availabilityStatus: z.enum(['available', 'limited', 'unavailable']).optional(),
      windows: z
        .array(
          z.object({
            dayOfWeek: z.number().int().min(0).max(6),
            isAvailable: z.boolean(),
            startTime: z.string().regex(/^\d{2}:\d{2}$/),
            endTime: z.string().regex(/^\d{2}:\d{2}$/),
          }),
        )
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid availability payload.' });

    const session = req.session!;
    if (!session.workerId) return res.status(403).json({ error: 'No linked worker profile.' });

    try {
      if (parsed.data.availabilityStatus) {
        await db
          .update(workerProfiles)
          .set({ availabilityStatus: parsed.data.availabilityStatus, updatedAt: new Date() })
          .where(
            and(eq(workerProfiles.id, session.workerId), eq(workerProfiles.tenantId, session.tenantId)),
          );
      }

      if (parsed.data.windows) {
        for (const w of parsed.data.windows) {
          await db
            .update(availabilityWindows)
            .set({
              isAvailable: w.isAvailable,
              startTime: w.startTime,
              endTime: w.endTime,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(availabilityWindows.tenantId, session.tenantId),
                eq(availabilityWindows.workerId, session.workerId),
                eq(availabilityWindows.dayOfWeek, w.dayOfWeek),
              ),
            );
        }
      }

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'worker.availability_updated',
        entityType: 'worker_profile',
        entityId: session.workerId,
        summary: `${session.fullName} updated self-service availability preferences.`,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error('Availability update failed:', error);
      res.status(500).json({ error: 'Unable to save availability.' });
    }
  },
);

apiRouter.patch(
  '/worker/profile',
  requireAuth,
  requirePermission(PERMISSIONS.WORKER_SELF),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      preferredChannel: z.enum(['in_app', 'sms', 'email']),
      travelRadiusKm: z.number().int().min(5).max(100),
      phone: z.string().trim().min(8).max(24),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid profile preferences.' });

    const session = req.session!;
    if (!session.workerId) return res.status(403).json({ error: 'No linked worker profile.' });

    try {
      const [updated] = await db
        .update(workerProfiles)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(workerProfiles.id, session.workerId), eq(workerProfiles.tenantId, session.tenantId)))
        .returning();

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'worker.profile_updated',
        entityType: 'worker_profile',
        entityId: session.workerId,
        summary: `${session.fullName} updated contact channel (${updated.preferredChannel}) and travel radius (${updated.travelRadiusKm}km).`,
      });

      res.json({ worker: updated });
    } catch (error) {
      console.error('Worker profile update failed:', error);
      res.status(500).json({ error: 'Unable to update profile.' });
    }
  },
);

// ============================================================================
// ANALYTICS & REPORTING + EXPORTS + AI BRIEF
// ============================================================================
async function computeAnalyticsData(
  session: NonNullable<AuthedRequest['session']>,
  periodDays: number,
  facilityId: string,
  customAgencyRate?: number,
  customInternalRate?: number,
) {
  const scope = await getScopedFacilityIds(session, facilityId);
  if (scope.forbidden) throw new Error('FORBIDDEN_FACILITY');

  const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const since = new Date(Date.now() - periodDays * 24 * 3600 * 1000);

  const periodShifts =
    scope.activeFacilityIds.length === 0
      ? []
      : await db
          .select()
          .from(shifts)
          .where(
            and(
              eq(shifts.tenantId, session.tenantId),
              inArray(shifts.facilityId, scope.activeFacilityIds),
              gte(shifts.createdAt, since),
            ),
          );

  const published = periodShifts.filter((s) => s.status !== 'draft' && s.status !== 'cancelled');
  const cancelled = periodShifts.filter((s) => s.status === 'cancelled');

  const totalPositions = published.reduce((acc, s) => acc + s.headcount, 0);
  const coveredPositions = published.reduce((acc, s) => acc + Math.min(s.filledCount, s.headcount), 0);
  const fillRatePct = totalPositions > 0 ? Number(((coveredPositions / totalPositions) * 100).toFixed(1)) : 0;

  const unfilledHours = Number(
    published
      .reduce((acc, s) => {
        const remaining = Math.max(0, s.headcount - s.filledCount);
        return acc + remaining * computeShiftPaidHours(s.startAt, s.endAt, s.breakMinutes);
      }, 0)
      .toFixed(1),
  );

  const coveredHours = Number(
    published
      .reduce((acc, s) => acc + s.filledCount * computeShiftPaidHours(s.startAt, s.endAt, s.breakMinutes), 0)
      .toFixed(1),
  );

  const agencyRate = customAgencyRate ?? tenantRow?.settingsJson.agencyHourlyRateAud ?? 96;
  const internalRate = customInternalRate ?? tenantRow?.settingsJson.internalHourlyRateAud ?? 54;
  const diffRate = Math.max(0, agencyRate - internalRate);
  const estimatedAvoidedAgencyAud = Math.round(coveredHours * diffRate);

  const firstRespSamples = published
    .filter((s) => s.publishedAt && s.firstResponseAt)
    .map((s) => Math.max(1, (s.firstResponseAt!.getTime() - s.publishedAt!.getTime()) / 60000));
  const avgFirstResponseMin =
    firstRespSamples.length > 0
      ? Number((firstRespSamples.reduce((a, b) => a + b, 0) / firstRespSamples.length).toFixed(1))
      : 0;

  const fillSamples = published
    .filter((s) => s.publishedAt && s.filledAt)
    .map((s) => Math.max(1, (s.filledAt!.getTime() - s.publishedAt!.getTime()) / 60000));
  const avgTimeToFillMin =
    fillSamples.length > 0
      ? Number((fillSamples.reduce((a, b) => a + b, 0) / fillSamples.length).toFixed(1))
      : 0;

  const offersRows =
    scope.activeFacilityIds.length === 0
      ? []
      : await db
          .select()
          .from(shiftOffers)
          .where(
            and(
              eq(shiftOffers.tenantId, session.tenantId),
              inArray(shiftOffers.facilityId, scope.activeFacilityIds),
              gte(shiftOffers.sentAt, since),
            ),
          );

  const acceptedOffers = offersRows.filter((o) => o.status === 'accepted').length;
  const offerAcceptanceRatePct =
    offersRows.length > 0 ? Number(((acceptedOffers / offersRows.length) * 100).toFixed(1)) : 0;

  // By channel breakdown
  const channels = ['in_app', 'sms', 'email'].map((ch) => {
    const chOffers = offersRows.filter((o) => o.channel === ch);
    const chAccepted = chOffers.filter((o) => o.status === 'accepted').length;
    const lat = chOffers.filter((o) => o.responseLatencySec).map((o) => o.responseLatencySec! / 60);
    return {
      channel: ch,
      offersSent: chOffers.length,
      accepted: chAccepted,
      acceptanceRatePct: chOffers.length > 0 ? Number(((chAccepted / chOffers.length) * 100).toFixed(1)) : 0,
      avgResponseMin:
        lat.length > 0 ? Number((lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(1)) : 0,
    };
  });

  // By facility breakdown
  const byFacility = scope.facilities.map((f) => {
    const fShifts = published.filter((s) => s.facilityId === f.id);
    const fTotal = fShifts.reduce((a, s) => a + s.headcount, 0);
    const fCov = fShifts.reduce((a, s) => a + Math.min(s.filledCount, s.headcount), 0);
    return {
      facilityId: f.id,
      facilityName: f.name,
      serviceType: f.serviceType,
      publishedPositions: fTotal,
      coveredPositions: fCov,
      fillRatePct: fTotal > 0 ? Number(((fCov / fTotal) * 100).toFixed(1)) : 100,
    };
  });

  // By role breakdown
  const roleSet = Array.from(new Set(published.map((s) => s.roleRequired)));
  const byRole = roleSet.map((role) => {
    const rShifts = published.filter((s) => s.roleRequired === role);
    const rTotal = rShifts.reduce((a, s) => a + s.headcount, 0);
    const rCov = rShifts.reduce((a, s) => a + Math.min(s.filledCount, s.headcount), 0);
    return {
      role,
      publishedPositions: rTotal,
      coveredPositions: rCov,
      fillRatePct: rTotal > 0 ? Number(((rCov / rTotal) * 100).toFixed(1)) : 0,
    };
  });

  return {
    periodDays,
    facilities: scope.facilities,
    summary: {
      fillRatePct,
      coveredPositions,
      totalPositions,
      openShifts: published.filter((s) => ['open', 'broadcasting', 'partially_covered'].includes(s.status))
        .length,
      escalatedShifts: published.filter((s) => Boolean(s.escalatedAt)).length,
      lateCancellations: cancelled.length,
      unfilledHours,
      coveredHours,
      avgFirstResponseMin,
      avgTimeToFillMin,
      offerAcceptanceRatePct,
      totalOffersSent: offersRows.length,
      estimatedAvoidedAgencyAud,
      costAssumptions: {
        agencyHourlyRateAud: agencyRate,
        internalHourlyRateAud: internalRate,
        differentialPerHourAud: diffRate,
      },
    },
    definitions: {
      fillRate: 'Covered eligible shift positions divided by total published shift positions in the selected period (excluding Draft and Cancelled shifts).',
      timeToFirstResponse: 'Elapsed minutes from shift published_at timestamp to the earliest worker offer response (accept or decline).',
      timeToFill: 'Elapsed minutes from shift published_at timestamp to confirmed shift assignment reaching full headcount.',
      estimatedCostImpact: 'Transparent estimate: Covered shift hours multiplied by (Configured Agency Hourly Rate − Configured Internal Hourly Rate). Not audited accounting savings.',
    },
    byChannel: channels,
    byFacility,
    byRole,
  };
}

apiRouter.get(
  '/analytics',
  requireAuth,
  requirePermission(PERMISSIONS.ANALYTICS_VIEW),
  async (req: AuthedRequest, res) => {
    try {
      const periodDays = Math.min(90, Math.max(7, Number(req.query.periodDays) || 30));
      const facilityId = typeof req.query.facilityId === 'string' ? req.query.facilityId : 'all';
      const agencyRate = req.query.agencyRate ? Number(req.query.agencyRate) : undefined;
      const internalRate = req.query.internalRate ? Number(req.query.internalRate) : undefined;

      const data = await computeAnalyticsData(req.session!, periodDays, facilityId, agencyRate, internalRate);
      res.json(data);
    } catch (error) {
      if (error instanceof Error && error.message === 'FORBIDDEN_FACILITY') {
        return res.status(403).json({ error: 'Forbidden facility scope.' });
      }
      console.error('Analytics load failed:', error);
      res.status(500).json({ error: 'Unable to calculate coverage analytics.' });
    }
  },
);

apiRouter.get(
  '/analytics/export',
  requireAuth,
  requirePermission(PERMISSIONS.ANALYTICS_EXPORT),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    try {
      const periodDays = Math.min(90, Math.max(7, Number(req.query.periodDays) || 30));
      const facilityId = typeof req.query.facilityId === 'string' ? req.query.facilityId : 'all';
      const data = await computeAnalyticsData(session, periodDays, facilityId);

      const csvLines = [
        'Facility,Service Type,Published Positions,Covered Positions,Fill Rate (%)',
        ...data.byFacility.map(
          (f) =>
            `"${f.facilityName.replace(/"/g, '""')}","${f.serviceType}",${f.publishedPositions},${f.coveredPositions},${f.fillRatePct}`,
        ),
        '',
        'Role,Published Positions,Covered Positions,Fill Rate (%)',
        ...data.byRole.map((r) => `"${r.role}",${r.publishedPositions},${r.coveredPositions},${r.fillRatePct}`),
      ];

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'analytics.exported_csv',
        entityType: 'analytics_report',
        entityId: `${periodDays}d-${facilityId}`,
        summary: `Exported ${periodDays}-day coverage analytics CSV.`,
        ipAddress: req.ip,
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="coverpulse-analytics-${periodDays}d.csv"`);
      res.send(csvLines.join('\n'));
    } catch (error) {
      console.error('Analytics export failed:', error);
      res.status(500).json({ error: 'Unable to export analytics.' });
    }
  },
);

apiRouter.post(
  '/analytics/ai-brief',
  requireAuth,
  requirePermission(PERMISSIONS.ANALYTICS_VIEW),
  rateLimit(10),
  async (req: AuthedRequest, res) => {
    try {
      const periodDays = Math.min(90, Math.max(7, Number(req.body?.periodDays) || 30));
      const facilityId = typeof req.body?.facilityId === 'string' ? req.body.facilityId : 'all';
      const data = await computeAnalyticsData(req.session!, periodDays, facilityId);

      const brief = await generateAnalyticsBrief({
        periodDays,
        fillRatePct: data.summary.fillRatePct,
        openShifts: data.summary.openShifts,
        avgFirstResponseMin: data.summary.avgFirstResponseMin,
        avgTimeToFillMin: data.summary.avgTimeToFillMin,
        unfilledHours: data.summary.unfilledHours,
        estimatedAvoidedAgencyAud: data.summary.estimatedAvoidedAgencyAud,
        escalatedShifts: data.summary.escalatedShifts,
      });
      res.json(brief);
    } catch (error) {
      console.error('AI analytics brief failed:', error);
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Unable to generate AI analytics summary.',
      });
    }
  },
);

// ============================================================================
// INTEGRATIONS & SIGNED WEBHOOKS
// ============================================================================
apiRouter.get(
  '/integrations',
  requireAuth,
  requirePermission(PERMISSIONS.INTEGRATIONS_VIEW),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    try {
      const [adapterRows, endpoints, deliveries] = await Promise.all([
        db.select().from(integrations).where(eq(integrations.tenantId, session.tenantId)),
        db
          .select({
            id: webhookEndpoints.id,
            url: webhookEndpoints.url,
            description: webhookEndpoints.description,
            eventsJson: webhookEndpoints.eventsJson,
            signingSecretPreview: webhookEndpoints.signingSecretPreview,
            active: webhookEndpoints.active,
            createdAt: webhookEndpoints.createdAt,
          })
          .from(webhookEndpoints)
          .where(eq(webhookEndpoints.tenantId, session.tenantId)),
        db
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.tenantId, session.tenantId))
          .orderBy(desc(webhookDeliveries.createdAt))
          .limit(20),
      ]);

      res.json({
        integrations: adapterRows,
        webhookEndpoints: endpoints,
        webhookDeliveries: deliveries,
        samplePayloads: {
          'shift.covered': {
            event: 'shift.covered',
            version: '2026-01',
            tenantId: session.tenantId,
            shiftId: '00000000-0000-4000-8000-000000000001',
            facilityCode: 'BGA-01',
            workerExternalRef: 'EMP-401',
            confirmedAt: new Date().toISOString(),
          },
          'shift.escalated': {
            event: 'shift.escalated',
            version: '2026-01',
            tenantId: session.tenantId,
            shiftId: '00000000-0000-4000-8000-000000000002',
            wavesAttempted: 2,
            escalatedToRole: 'operations_manager',
          },
        },
      });
    } catch (error) {
      console.error('Integrations load failed:', error);
      res.status(500).json({ error: 'Unable to load integrations.' });
    }
  },
);

apiRouter.post(
  '/webhooks',
  requireAuth,
  requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      url: z.string().trim().url(),
      description: z.string().trim().min(3).max(160),
      events: z.array(z.string()).min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Valid webhook URL, description, and events required.' });

    const ssrfCheck = validateSafeWebhookUrl(parsed.data.url);
    if (!ssrfCheck.valid) {
      return res.status(400).json({ error: ssrfCheck.reason });
    }

    const session = req.session!;
    try {
      const plaintextSecret = `whsec_${crypto.randomBytes(20).toString('hex')}`;
      const secretHash = crypto.createHash('sha256').update(plaintextSecret).digest('hex');
      const preview = `whsec_••••${plaintextSecret.slice(-4)}`;

      const [endpoint] = await db
        .insert(webhookEndpoints)
        .values({
          tenantId: session.tenantId,
          url: parsed.data.url,
          description: parsed.data.description,
          eventsJson: parsed.data.events,
          signingSecretHash: secretHash,
          signingSecretPreview: preview,
        })
        .returning();

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'webhook.endpoint_created',
        entityType: 'webhook_endpoint',
        entityId: endpoint.id,
        summary: `Registered signed webhook endpoint "${endpoint.description}".`,
      });

      res.status(201).json({
        endpoint: {
          id: endpoint.id,
          url: endpoint.url,
          description: endpoint.description,
          eventsJson: endpoint.eventsJson,
          signingSecretPreview: endpoint.signingSecretPreview,
          active: endpoint.active,
        },
        signingSecretOnce: plaintextSecret,
      });
    } catch (error) {
      console.error('Create webhook failed:', error);
      res.status(500).json({ error: 'Unable to register webhook endpoint.' });
    }
  },
);

apiRouter.post(
  '/webhooks/:id/test',
  requireAuth,
  requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE),
  rateLimit(20),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    try {
      const [endpoint] = await db
        .select()
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.id, req.params.id), eq(webhookEndpoints.tenantId, session.tenantId)))
        .limit(1);

      if (!endpoint) return res.status(404).json({ error: 'Webhook endpoint not found.' });

      const eventType = endpoint.eventsJson[0] || 'shift.covered';
      const idempotencyKey = `wh_test_${crypto.randomUUID()}`;
      const payload = {
        event: eventType,
        sandboxTest: true,
        tenantId: session.tenantId,
        dispatchedAt: new Date().toISOString(),
        idempotencyKey,
      };
      const ts = Math.floor(Date.now() / 1000);
      const signatureHeader = signWebhookPayload(JSON.stringify(payload), endpoint.signingSecretHash, ts);

      const [delivery] = await db
        .insert(webhookDeliveries)
        .values({
          tenantId: session.tenantId,
          endpointId: endpoint.id,
          eventType,
          idempotencyKey,
          payloadJson: payload,
          signatureHeader,
          status: 'delivered',
          httpStatus: 200,
          attempts: 1,
        })
        .returning();

      res.json({
        delivery,
        note: 'Sandbox signed delivery recorded with HMAC-SHA256 timestamped signature and idempotency key.',
      });
    } catch (error) {
      console.error('Webhook test failed:', error);
      res.status(500).json({ error: 'Unable to dispatch sandbox webhook test.' });
    }
  },
);

apiRouter.get(
  '/integrations/export-timesheet-csv',
  requireAuth,
  requirePermission(PERMISSIONS.ANALYTICS_EXPORT),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    try {
      const rows = await db
        .select({
          shiftDate: shifts.shiftDate,
          facilityCode: facilities.code,
          facilityName: facilities.name,
          roleRequired: shifts.roleRequired,
          startAt: shifts.startAt,
          endAt: shifts.endAt,
          breakMinutes: shifts.breakMinutes,
          workerFirstName: workerProfiles.firstName,
          workerLastName: workerProfiles.lastName,
          employmentType: workerProfiles.employmentType,
          status: shiftAssignments.status,
        })
        .from(shiftAssignments)
        .innerJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
        .innerJoin(facilities, eq(shifts.facilityId, facilities.id))
        .innerJoin(workerProfiles, eq(shiftAssignments.workerId, workerProfiles.id))
        .where(
          and(
            eq(shiftAssignments.tenantId, session.tenantId),
            ne(shiftAssignments.status, 'cancelled'),
          ),
        )
        .orderBy(desc(shifts.startAt));

      const lines = [
        'Shift Date,Facility Code,Facility Name,Worker Name,Employment Type,Role,Paid Hours,Assignment Status',
        ...rows.map((r) =>
          [
            r.shiftDate,
            r.facilityCode,
            `"${r.facilityName.replace(/"/g, '""')}"`,
            `"${r.workerFirstName} ${r.workerLastName}"`,
            `"${r.employmentType}"`,
            `"${r.roleRequired}"`,
            computeShiftPaidHours(r.startAt, r.endAt, r.breakMinutes),
            r.status,
          ].join(','),
        ),
      ];

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'integrations.timesheet_exported',
        entityType: 'timesheet_export',
        entityId: session.tenantId,
        summary: `Exported ${rows.length} confirmed shift assignment rows for payroll.`,
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="coverpulse-payroll-timesheet.csv"');
      res.send(lines.join('\n'));
    } catch (error) {
      console.error('Timesheet export failed:', error);
      res.status(500).json({ error: 'Unable to export timesheet CSV.' });
    }
  },
);

// ============================================================================
// BILLING, SETTINGS, NOTIFICATIONS, AUDIT & PLATFORM SUPER ADMIN
// ============================================================================
apiRouter.get(
  '/billing',
  requireAuth,
  requirePermission(PERMISSIONS.BILLING_VIEW),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    try {
      const [[sub], invoices, plans, facs, workers] = await Promise.all([
        db.select().from(subscriptions).where(eq(subscriptions.tenantId, session.tenantId)).limit(1),
        db
          .select()
          .from(invoiceReferences)
          .where(eq(invoiceReferences.tenantId, session.tenantId))
          .orderBy(desc(invoiceReferences.issuedAt)),
        db.select().from(planConfigs).where(eq(planConfigs.active, true)),
        db.select({ id: facilities.id }).from(facilities).where(eq(facilities.tenantId, session.tenantId)),
        db.select({ id: workerProfiles.id }).from(workerProfiles).where(eq(workerProfiles.tenantId, session.tenantId)),
      ]);

      res.json({
        subscription: sub,
        usage: {
          facilitiesUsed: facs.length,
          workersUsed: workers.length,
          smsUsed: sub?.smsUsedThisPeriod ?? 0,
        },
        invoices,
        plans,
      });
    } catch (error) {
      console.error('Billing load failed:', error);
      res.status(500).json({ error: 'Unable to load billing information.' });
    }
  },
);

apiRouter.post(
  '/billing/change-plan',
  requireAuth,
  requirePermission(PERMISSIONS.BILLING_MANAGE),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      planTier: z.enum(['essential', 'growth', 'enterprise']),
      billingCycle: z.enum(['monthly', 'annual']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid plan change selection.' });

    const session = req.session!;
    try {
      const [plan] = await db
        .select()
        .from(planConfigs)
        .where(eq(planConfigs.tierKey, parsed.data.planTier))
        .limit(1);
      if (!plan) return res.status(404).json({ error: 'Plan configuration not found.' });

      const effectiveMonthlyCents =
        parsed.data.billingCycle === 'annual'
          ? Math.round(plan.monthlyPriceAudCents * (1 - plan.annualDiscountPct / 100))
          : plan.monthlyPriceAudCents;

      const [updated] = await db
        .update(subscriptions)
        .set({
          planTier: plan.tierKey,
          billingCycle: parsed.data.billingCycle,
          monthlyPriceCents: effectiveMonthlyCents,
          includedFacilities: plan.maxFacilities,
          includedWorkers: plan.maxWorkers,
          includedSms: plan.includedSmsPerMonth,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.tenantId, session.tenantId))
        .returning();

      await db
        .update(tenants)
        .set({ planTier: plan.tierKey, updatedAt: new Date() })
        .where(eq(tenants.id, session.tenantId));

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'billing.plan_changed',
        entityType: 'subscription',
        entityId: updated.id,
        summary: `Updated subscription to ${plan.displayName} (${parsed.data.billingCycle}).`,
      });

      res.json({ subscription: updated });
    } catch (error) {
      console.error('Plan update failed:', error);
      res.status(500).json({ error: 'Unable to update subscription plan.' });
    }
  },
);

apiRouter.get(
  '/settings',
  requireAuth,
  requirePermission(PERMISSIONS.SETTINGS_VIEW),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    try {
      const [[tenant], memberRows, grants] = await Promise.all([
        db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
        db
          .select({
            id: memberships.id,
            roleKey: memberships.roleKey,
            permittedFacilityIds: memberships.permittedFacilityIds,
            status: memberships.status,
            fullName: users.fullName,
            email: users.email,
            mfaEnabled: users.mfaEnabled,
          })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .where(eq(memberships.tenantId, session.tenantId)),
        db
          .select()
          .from(supportAccessGrants)
          .where(eq(supportAccessGrants.tenantId, session.tenantId))
          .orderBy(desc(supportAccessGrants.createdAt)),
      ]);
      res.json({ tenant, members: memberRows, supportGrants: grants });
    } catch (error) {
      console.error('Settings load failed:', error);
      res.status(500).json({ error: 'Unable to load settings.' });
    }
  },
);

apiRouter.patch(
  '/settings',
  requireAuth,
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      name: z.string().trim().min(2).max(140).optional(),
      abn: z.string().trim().min(9).max(20).optional(),
      timezone: z.string().trim().min(3).max(60).optional(),
      settingsJson: z
        .object({
          defaultMaxWeeklyHours: z.number().int().min(20).max(60),
          defaultMinRestHours: z.number().int().min(8).max(24),
          agencyHourlyRateAud: z.number().min(40).max(250),
          internalHourlyRateAud: z.number().min(25).max(180),
          overtimeMultiplier: z.number().min(1).max(3),
          retentionDays: z.number().int().min(90).max(3650),
          quietHoursDefaultStart: z.string().regex(/^\d{2}:\d{2}$/),
          quietHoursDefaultEnd: z.string().regex(/^\d{2}:\d{2}$/),
        })
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid settings update.' });

    const session = req.session!;
    try {
      const [existing] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      if (!existing) return res.status(404).json({ error: 'Organisation not found.' });

      const [updated] = await db
        .update(tenants)
        .set({
          name: parsed.data.name ?? existing.name,
          abn: parsed.data.abn ?? existing.abn,
          timezone: parsed.data.timezone ?? existing.timezone,
          settingsJson: parsed.data.settingsJson
            ? { ...existing.settingsJson, ...parsed.data.settingsJson }
            : existing.settingsJson,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, session.tenantId))
        .returning();

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'organisation.settings_updated',
        entityType: 'tenant',
        entityId: session.tenantId,
        summary: `Updated organisation settings and working-hour/cost policy rules.`,
      });

      res.json({ tenant: updated });
    } catch (error) {
      console.error('Settings update failed:', error);
      res.status(500).json({ error: 'Unable to save settings.' });
    }
  },
);

apiRouter.post('/privacy/request', requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    requestType: z.enum(['privacy_export', 'privacy_deletion']),
    notes: z.string().max(400).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid privacy request.' });

  const session = req.session!;
  try {
    const [rec] = await db
      .insert(consentRecords)
      .values({
        tenantId: session.tenantId,
        subjectEmail: session.email,
        subjectName: session.fullName,
        organisationName: session.tenantName,
        consentType: parsed.data.requestType,
        granted: true,
        detailsJson: { notes: parsed.data.notes ?? null, role: session.roleKey },
      })
      .returning();

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      actorEmail: session.email,
      actorRole: session.roleKey,
      action: `privacy.${parsed.data.requestType}`,
      entityType: 'consent_record',
      entityId: rec.id,
      summary: `Submitted Australian Privacy Act (APP) ${parsed.data.requestType.replace('privacy_', '')} request.`,
    });

    res.status(201).json({
      id: rec.id,
      exportPackage:
        parsed.data.requestType === 'privacy_export'
          ? {
              exportedAt: new Date().toISOString(),
              user: { email: session.email, fullName: session.fullName, role: session.roleKey },
              organisation: session.tenantName,
            }
          : null,
    });
  } catch (error) {
    console.error('Privacy request failed:', error);
    res.status(500).json({ error: 'Unable to log privacy request.' });
  }
});

apiRouter.get('/notifications', requireAuth, async (req: AuthedRequest, res) => {
  const session = req.session!;
  try {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        session.roleKey === 'worker' && session.workerId
          ? and(eq(notifications.tenantId, session.tenantId), eq(notifications.workerId, session.workerId))
          : eq(notifications.tenantId, session.tenantId),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(30);
    res.json({ notifications: rows });
  } catch (error) {
    console.error('Notifications failed:', error);
    res.status(500).json({ error: 'Unable to load notifications.' });
  }
});

apiRouter.post('/notifications/mark-read', requireAuth, async (req: AuthedRequest, res) => {
  const session = req.session!;
  try {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        session.roleKey === 'worker' && session.workerId
          ? and(eq(notifications.tenantId, session.tenantId), eq(notifications.workerId, session.workerId))
          : eq(notifications.tenantId, session.tenantId),
      );
    res.json({ ok: true });
  } catch (error) {
    console.error('Mark read failed:', error);
    res.status(500).json({ error: 'Unable to mark notifications as read.' });
  }
});

apiRouter.get(
  '/audit',
  requireAuth,
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  async (req: AuthedRequest, res) => {
    const session = req.session!;
    const actionFilter = typeof req.query.action === 'string' ? req.query.action.trim().toLowerCase() : '';
    try {
      let rows = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, session.tenantId))
        .orderBy(desc(auditEvents.createdAt))
        .limit(120);

      if (actionFilter) {
        rows = rows.filter(
          (r) =>
            r.action.toLowerCase().includes(actionFilter) ||
            r.summary.toLowerCase().includes(actionFilter) ||
            r.actorEmail.toLowerCase().includes(actionFilter),
        );
      }

      res.json({ events: rows });
    } catch (error) {
      console.error('Audit log load failed:', error);
      res.status(500).json({ error: 'Unable to load audit trail.' });
    }
  },
);

// Platform Super Admin routes (strictly guarded)
apiRouter.get(
  '/admin/overview',
  requireAuth,
  requirePermission(PERMISSIONS.PLATFORM_ADMIN),
  async (_req, res) => {
    try {
      const [allTenants, allPlans, allGrants] = await Promise.all([
        db.select().from(tenants),
        db.select().from(planConfigs),
        db.select().from(supportAccessGrants).orderBy(desc(supportAccessGrants.createdAt)).limit(20),
      ]);
      res.json({ tenants: allTenants, plans: allPlans, supportGrants: allGrants });
    } catch (error) {
      console.error('Platform admin load failed:', error);
      res.status(500).json({ error: 'Unable to load platform overview.' });
    }
  },
);

apiRouter.patch(
  '/admin/plans/:tierKey',
  requireAuth,
  requirePermission(PERMISSIONS.PLATFORM_ADMIN),
  async (req: AuthedRequest, res) => {
    const schema = z.object({
      monthlyPriceAudCents: z.number().int().min(10000).max(5000000),
      maxFacilities: z.number().int().min(1).max(1000),
      maxWorkers: z.number().int().min(10).max(50000),
      includedSmsPerMonth: z.number().int().min(100).max(500000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid plan parameters.' });

    const session = req.session!;
    try {
      const [updated] = await db
        .update(planConfigs)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(planConfigs.tierKey, req.params.tierKey))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Plan tier not found.' });

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email,
        actorRole: session.roleKey,
        action: 'platform.plan_config_updated',
        entityType: 'plan_config',
        entityId: updated.tierKey,
        summary: `Platform Super Admin updated ${updated.displayName} pricing/entitlements.`,
        metadata: parsed.data,
      });

      res.json({ plan: updated });
    } catch (error) {
      console.error('Update plan config failed:', error);
      res.status(500).json({ error: 'Unable to update plan configuration.' });
    }
  },
);
