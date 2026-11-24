import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db/index.ts';
import {
  auditEvents,
  coveragePolicies,
  coverageRuns,
  facilities,
  notifications,
  qualifications,
  shiftAssignments,
  shiftOffers,
  shiftRequirements,
  shifts,
  subscriptions,
  tenants,
  users,
} from '../src/db/schema.ts';
import { ensureSeeded } from '../src/db/seed.ts';
import {
  acceptShiftOfferAtomic,
  advanceOrEscalateRun,
  startCoverageRun,
} from '../src/server/services/autopilot.ts';
import { signWebhookPayload } from '../src/server/services/providers.ts';
import type { SessionContext } from '../src/shared/types.ts';

describe('CoverPulse Live PostgreSQL Integration & Acceptance Scenarios', () => {
  it(
    'Scenario 1: Concurrent atomic offer acceptance locks shift row, confirms exactly 1 worker, withdraws others, and writes audit trail',
    async () => {
      await ensureSeeded();

      const [tenantA] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.slug, 'harbourview-care-demo'))
        .limit(1);
      expect(tenantA).toBeTruthy();

      const [facA] = await db
        .select()
        .from(facilities)
        .where(and(eq(facilities.tenantId, tenantA.id), eq(facilities.code, 'BGA-01')))
        .limit(1);
      expect(facA).toBeTruthy();

      const [opsUser] = await db
        .select()
        .from(users)
        .where(eq(users.uid, 'demo-ops-manager'))
        .limit(1);

      const [policy] = await db
        .select()
        .from(coveragePolicies)
        .where(and(eq(coveragePolicies.tenantId, tenantA.id), eq(coveragePolicies.dispatchMode, 'parallel_waves')))
        .limit(1);
      expect(policy).toBeTruthy();

      const [ahpra] = await db
        .select()
        .from(qualifications)
        .where(and(eq(qualifications.tenantId, tenantA.id), eq(qualifications.code, 'AHPRA')))
        .limit(1);

      // Create an isolated future overnight RN shift for atomic concurrency test
      const futureDate = '2026-11-28';
      const [testShift] = await db
        .insert(shifts)
        .values({
          tenantId: tenantA.id,
          facilityId: facA.id,
          title: 'Integration Test — Atomic RN Night Shift',
          roleRequired: 'Registered Nurse (RN)',
          shiftDate: futureDate,
          startAt: new Date(`${futureDate}T22:00:00+10:00`),
          endAt: new Date('2026-11-29T06:30:00+10:00'),
          breakMinutes: 30,
          headcount: 1,
          filledCount: 0,
          urgency: 'critical',
          status: 'open',
          isOvernight: true,
          hourlyRateCents: 6800,
          showRateToWorker: true,
          requiresManagerConfirmation: false,
          createdByUserId: opsUser.id,
          publishedAt: new Date(),
        })
        .returning();

      try {
        if (ahpra) {
          await db.insert(shiftRequirements).values({
            tenantId: tenantA.id,
            shiftId: testShift.id,
            qualificationId: ahpra.id,
            isMandatory: true,
          });
        }

        const mockSession: SessionContext = {
          userId: opsUser.id,
          uid: opsUser.uid,
          email: opsUser.email,
          fullName: opsUser.fullName,
          tenantId: tenantA.id,
          tenantName: tenantA.name,
          tenantSlug: tenantA.slug,
          isDemoTenant: true,
          roleKey: 'operations_manager',
          permissions: ['autopilot:run', 'shifts:manage'],
          permittedFacilityIds: [],
          workerId: null,
          isPlatformAdmin: false,
          authMode: 'demo_session',
        };

        const runResult = await startCoverageRun({
          session: mockSession,
          shiftId: testShift.id,
          policyId: policy.id,
          bypassQuietHours: true,
        });

        expect(runResult.dispatchedOffers.length).toBeGreaterThanOrEqual(2);

        const createdOffers = await db
          .select()
          .from(shiftOffers)
          .where(and(eq(shiftOffers.shiftId, testShift.id), eq(shiftOffers.tenantId, tenantA.id)));
        expect(createdOffers.length).toBeGreaterThanOrEqual(2);

        // Fire two simultaneous acceptance attempts against PostgreSQL FOR UPDATE lock
        const [offer1, offer2] = createdOffers;
        const settled = await Promise.allSettled([
          acceptShiftOfferAtomic({
            tenantId: tenantA.id,
            offerId: offer1.id,
            workerId: offer1.workerId,
            actorUserId: opsUser.id,
            actorEmail: 'worker1@test.demo',
            actorRole: 'worker',
          }),
          acceptShiftOfferAtomic({
            tenantId: tenantA.id,
            offerId: offer2.id,
            workerId: offer2.workerId,
            actorUserId: opsUser.id,
            actorEmail: 'worker2@test.demo',
            actorRole: 'worker',
          }),
        ]);

        const fulfilled = settled.filter((r) => r.status === 'fulfilled');
        const rejected = settled.filter((r) => r.status === 'rejected');
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);

        // Verify final database state: shift covered, 1 assignment, remaining offers withdrawn, run completed
        const [finalShift] = await db.select().from(shifts).where(eq(shifts.id, testShift.id)).limit(1);
        expect(finalShift.status).toBe('covered');
        expect(finalShift.filledCount).toBe(1);

        const finalAssignments = await db
          .select()
          .from(shiftAssignments)
          .where(eq(shiftAssignments.shiftId, testShift.id));
        expect(finalAssignments.length).toBe(1);

        const finalOffers = await db.select().from(shiftOffers).where(eq(shiftOffers.shiftId, testShift.id));
        expect(finalOffers.filter((o) => o.status === 'accepted').length).toBe(1);
        expect(finalOffers.filter((o) => o.status === 'withdrawn').length).toBe(finalOffers.length - 1);

        const [finalRun] = await db
          .select()
          .from(coverageRuns)
          .where(eq(coverageRuns.shiftId, testShift.id))
          .limit(1);
        expect(finalRun.status).toBe('completed');

        const assignAudits = await db
          .select()
          .from(auditEvents)
          .where(and(eq(auditEvents.tenantId, tenantA.id), eq(auditEvents.entityId, finalAssignments[0].id)));
        expect(assignAudits.some((a) => a.action === 'offer.accepted')).toBe(true);
      } finally {
        await db.delete(notifications).where(eq(notifications.linkPath, `/shifts/${testShift.id}`));
        await db.delete(shifts).where(eq(shifts.id, testShift.id));
      }
    },
    15000,
  );

  it(
    'Scenario 2: Exhausting waves with no acceptance escalates shift cleanly and notifies Operations Manager',
    async () => {
      await ensureSeeded();

      const [tenantA] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.slug, 'harbourview-care-demo'))
        .limit(1);
      const [facA] = await db
        .select()
        .from(facilities)
        .where(and(eq(facilities.tenantId, tenantA.id), eq(facilities.code, 'BGA-01')))
        .limit(1);
      const [opsUser] = await db
        .select()
        .from(users)
        .where(eq(users.uid, 'demo-ops-manager'))
        .limit(1);
      const [policy] = await db
        .select()
        .from(coveragePolicies)
        .where(and(eq(coveragePolicies.tenantId, tenantA.id), eq(coveragePolicies.dispatchMode, 'parallel_waves')))
        .limit(1);

      const futureDate = '2026-11-30';
      const [testShift] = await db
        .insert(shifts)
        .values({
          tenantId: tenantA.id,
          facilityId: facA.id,
          title: 'Integration Test — Escalation Exhaustion Shift',
          roleRequired: 'Registered Nurse (RN)',
          shiftDate: futureDate,
          startAt: new Date(`${futureDate}T07:00:00+10:00`),
          endAt: new Date(`${futureDate}T15:30:00+10:00`),
          breakMinutes: 30,
          headcount: 1,
          filledCount: 0,
          urgency: 'high',
          status: 'open',
          isOvernight: false,
          hourlyRateCents: 6000,
          showRateToWorker: true,
          requiresManagerConfirmation: false,
          createdByUserId: opsUser.id,
          publishedAt: new Date(),
        })
        .returning();

      try {
        const mockSession: SessionContext = {
          userId: opsUser.id,
          uid: opsUser.uid,
          email: opsUser.email,
          fullName: opsUser.fullName,
          tenantId: tenantA.id,
          tenantName: tenantA.name,
          tenantSlug: tenantA.slug,
          isDemoTenant: true,
          roleKey: 'operations_manager',
          permissions: ['autopilot:run', 'shifts:manage'],
          permittedFacilityIds: [],
          workerId: null,
          isPlatformAdmin: false,
          authMode: 'demo_session',
        };

        await startCoverageRun({
          session: mockSession,
          shiftId: testShift.id,
          policyId: policy.id,
          bypassQuietHours: true,
        });

        let escalated = false;
        for (let step = 0; step < 5; step++) {
          const outcome = await advanceOrEscalateRun({
            tenantId: tenantA.id,
            shiftId: testShift.id,
            actorUserId: opsUser.id,
            actorEmail: opsUser.email,
            actorRole: 'operations_manager',
            triggerReason: 'Test window expired without acceptance',
          });
          if (outcome.action === 'escalated') {
            escalated = true;
            break;
          }
        }

        expect(escalated).toBe(true);

        const [finalShift] = await db.select().from(shifts).where(eq(shifts.id, testShift.id)).limit(1);
        expect(finalShift.escalatedAt).toBeTruthy();

        const escNotifs = await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.tenantId, tenantA.id), eq(notifications.category, 'escalation')));
        expect(escNotifs.some((n) => n.title.includes(testShift.title))).toBe(true);
      } finally {
        await db.delete(notifications).where(eq(notifications.linkPath, `/shifts/${testShift.id}`));
        await db.delete(shifts).where(eq(shifts.id, testShift.id));
      }
    },
    15000,
  );

  it('Scenario 3: Billing webhook rejects invalid signatures and deduplicates replayed valid events', async () => {
    const [tenantA] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, 'harbourview-care-demo'))
      .limit(1);
    const [subBefore] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantA.id))
      .limit(1);

    const payload = {
      eventId: `evt_test_${crypto.randomUUID()}`,
      type: 'invoice.paid',
      tenantId: tenantA.id,
      status: subBefore.status,
    };
    const raw = JSON.stringify(payload);
    const secret = process.env.BILLING_WEBHOOK_SECRET || 'coverpulse_billing_sandbox_secret';
    const validSig = signWebhookPayload(raw, secret, Math.floor(Date.now() / 1000));

    const badRes = await fetch('http://127.0.0.1:3000/api/webhooks/billing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-coverpulse-billing-signature': 't=12345,v1=invalid',
      },
      body: raw,
    });
    expect(badRes.status).toBe(401);

    const firstRes = await fetch('http://127.0.0.1:3000/api/webhooks/billing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-coverpulse-billing-signature': validSig,
      },
      body: raw,
    });
    expect(firstRes.status).toBe(200);
    const firstJson = (await firstRes.json()) as { received: boolean; duplicate: boolean };
    expect(firstJson).toEqual({ received: true, duplicate: false });

    // Exact replay must be idempotent
    const replayRes = await fetch('http://127.0.0.1:3000/api/webhooks/billing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-coverpulse-billing-signature': validSig,
      },
      body: raw,
    });
    expect(replayRes.status).toBe(200);
    const replayJson = (await replayRes.json()) as { received: boolean; duplicate: boolean };
    expect(replayJson).toEqual({ received: true, duplicate: true });
  });
});
