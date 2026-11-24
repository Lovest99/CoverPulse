import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  auditEvents,
  candidateMatches,
  coveragePolicies,
  coverageRuns,
  facilities,
  notifications,
  offerEvents,
  shiftAssignments,
  shiftOffers,
  shifts,
  subscriptions,
  workerProfiles,
} from '../../db/schema.ts';
import { evaluateShiftEligibilityFromDb, shiftsOverlap } from './eligibility.ts';
import { dispatchOfferViaChannel } from './providers.ts';
import { recordAuditEvent } from './audit.ts';
import type { SessionContext } from '../../shared/types.ts';

function isWithinQuietHours(now: Date, startHHMM: string, endHHMM: string): boolean {
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin > endMin) {
    return currentMin >= startMin || currentMin < endMin;
  }
  return currentMin >= startMin && currentMin < endMin;
}

export async function startCoverageRun(params: {
  session: SessionContext;
  shiftId: string;
  policyId: string;
  bypassQuietHours?: boolean;
}) {
  const { session, shiftId, policyId, bypassQuietHours = false } = params;

  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.tenantId, session.tenantId)))
    .limit(1);

  if (!shift) throw new Error('Shift not found in organisation scope.');
  if (shift.status === 'covered' || shift.status === 'cancelled' || shift.status === 'expired') {
    throw new Error(`Cannot start coverage autopilot for a ${shift.status} shift.`);
  }

  const [policy] = await db
    .select()
    .from(coveragePolicies)
    .where(and(eq(coveragePolicies.id, policyId), eq(coveragePolicies.tenantId, session.tenantId)))
    .limit(1);

  if (!policy) throw new Error('Coverage policy not found in organisation scope.');

  const [facility] = await db
    .select()
    .from(facilities)
    .where(and(eq(facilities.id, shift.facilityId), eq(facilities.tenantId, session.tenantId)))
    .limit(1);

  // 1. Evaluate deterministic candidate eligibility
  const evaluated = await evaluateShiftEligibilityFromDb(session.tenantId, shiftId);
  const eligibleCandidates = evaluated.filter((c) => c.eligible);

  // Stop any previously running run for this shift
  await db
    .update(coverageRuns)
    .set({
      status: 'stopped',
      completedAt: new Date(),
      stoppedReason: 'Superseded by new coverage run',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(coverageRuns.tenantId, session.tenantId),
        eq(coverageRuns.shiftId, shiftId),
        eq(coverageRuns.status, 'running'),
      ),
    );

  const effectiveBatchSize =
    policy.dispatchMode === 'sequential'
      ? 1
      : policy.dispatchMode === 'parallel_waves'
        ? Math.max(policy.batchSize, 5)
        : policy.batchSize;

  const totalWaves =
    eligibleCandidates.length === 0
      ? 0
      : Math.min(policy.maxAttempts, Math.ceil(eligibleCandidates.length / effectiveBatchSize));

  const [run] = await db
    .insert(coverageRuns)
    .values({
      tenantId: session.tenantId,
      facilityId: shift.facilityId,
      shiftId,
      policyId,
      status: eligibleCandidates.length === 0 ? 'escalated' : 'running',
      currentWave: eligibleCandidates.length === 0 ? 0 : 1,
      totalWaves,
      attemptsCount: eligibleCandidates.length === 0 ? 0 : 1,
      startedByUserId: session.userId,
      completedAt: eligibleCandidates.length === 0 ? new Date() : null,
      stoppedReason:
        eligibleCandidates.length === 0
          ? 'No eligible candidates matched mandatory clinical/availability rules'
          : null,
    })
    .returning();

  // Persist snapshot of candidate matches for auditability
  await db
    .delete(candidateMatches)
    .where(and(eq(candidateMatches.tenantId, session.tenantId), eq(candidateMatches.shiftId, shiftId)));

  if (evaluated.length > 0) {
    await db.insert(candidateMatches).values(
      evaluated.map((c) => ({
        tenantId: session.tenantId,
        shiftId,
        runId: run.id,
        workerId: c.workerId,
        eligible: c.eligible,
        totalScore: c.totalScore,
        scoreBreakdownJson: c.scoreBreakdown,
        inclusionReasonsJson: c.inclusionReasons,
        exclusionReasonsJson: c.exclusionReasons,
        rankOrder: c.rankOrder,
      })),
    );
  }

  // If 0 eligible candidates -> escalate immediately
  if (eligibleCandidates.length === 0) {
    const reason = 'Zero eligible workers passed hard qualification, facility, overlap, and rest filters.';
    await db
      .update(shifts)
      .set({
        status: 'open',
        escalatedAt: new Date(),
        escalationReason: reason,
        updatedAt: new Date(),
      })
      .where(and(eq(shifts.id, shiftId), eq(shifts.tenantId, session.tenantId)));

    await db.insert(offerEvents).values({
      tenantId: session.tenantId,
      shiftId,
      eventType: 'wave_escalated',
      summary: `Escalated to ${policy.escalationRecipientEmail}: ${reason}`,
      metadataJson: { policyName: policy.name, runId: run.id },
    });

    await db.insert(notifications).values({
      tenantId: session.tenantId,
      title: `Coverage escalation: ${shift.title}`,
      body: `${facility?.name ?? 'Facility'} shift escalated immediately — no eligible candidates matched mandatory filters.`,
      category: 'escalation',
      linkPath: `/shifts/${shift.id}`,
    });

    await recordAuditEvent({
      tenantId: session.tenantId,
      facilityId: shift.facilityId,
      actorUserId: session.userId,
      actorEmail: session.email,
      actorRole: session.roleKey,
      action: 'autopilot.escalated_no_candidates',
      entityType: 'shift',
      entityId: shift.id,
      summary: `Coverage run escalated immediately for ${shift.title} (0 eligible workers).`,
      metadata: { runId: run.id, policyId },
    });

    return { run, dispatchedOffers: [], eligibleCount: 0, escalated: true };
  }

  // Update shift to broadcasting
  await db
    .update(shifts)
    .set({
      status: shift.filledCount > 0 ? 'partially_covered' : 'broadcasting',
      publishedAt: shift.publishedAt ?? new Date(),
      requiresManagerConfirmation: policy.requireManagerConfirmation || shift.requiresManagerConfirmation,
      updatedAt: new Date(),
    })
    .where(and(eq(shifts.id, shiftId), eq(shifts.tenantId, session.tenantId)));

  await db.insert(offerEvents).values({
    tenantId: session.tenantId,
    shiftId,
    eventType: 'autopilot_started',
    summary: `Coverage Autopilot started with "${policy.name}" (${policy.dispatchMode}, batch ${effectiveBatchSize}). ${eligibleCandidates.length} eligible workers ranked.`,
    metadataJson: {
      runId: run.id,
      policyName: policy.name,
      dispatchMode: policy.dispatchMode,
      eligibleCount: eligibleCandidates.length,
    },
  });

  // Dispatch Wave 1
  const wave1Workers = eligibleCandidates.slice(0, effectiveBatchSize);
  const dispatchedOffers = await dispatchWaveOffers({
    tenantId: session.tenantId,
    facilityId: shift.facilityId,
    facilityName: facility?.name ?? 'Facility',
    shift,
    policy,
    runId: run.id,
    waveNumber: 1,
    candidateIds: wave1Workers.map((w) => w.workerId),
    bypassQuietHours,
  });

  await recordAuditEvent({
    tenantId: session.tenantId,
    facilityId: shift.facilityId,
    actorUserId: session.userId,
    actorEmail: session.email,
    actorRole: session.roleKey,
    action: 'autopilot.started',
    entityType: 'coverage_run',
    entityId: run.id,
    summary: `Started "${policy.name}" on ${shift.title}; dispatched Wave 1 to ${dispatchedOffers.length} eligible workers.`,
    metadata: { shiftId, policyId, wave1Count: dispatchedOffers.length },
  });

  return { run, dispatchedOffers, eligibleCount: eligibleCandidates.length, escalated: false };
}

async function dispatchWaveOffers(params: {
  tenantId: string;
  facilityId: string;
  facilityName: string;
  shift: typeof shifts.$inferSelect;
  policy: typeof coveragePolicies.$inferSelect;
  runId: string;
  waveNumber: number;
  candidateIds: string[];
  bypassQuietHours: boolean;
}) {
  const { tenantId, facilityId, facilityName, shift, policy, runId, waveNumber, candidateIds, bypassQuietHours } =
    params;

  if (candidateIds.length === 0) return [];

  const workers = await db
    .select()
    .from(workerProfiles)
    .where(and(eq(workerProfiles.tenantId, tenantId), inArray(workerProfiles.id, candidateIds)));

  const now = new Date();
  const quietActive =
    !bypassQuietHours &&
    shift.urgency !== 'critical' &&
    isWithinQuietHours(now, policy.quietHoursStart, policy.quietHoursEnd);

  const expiresAt = new Date(now.getTime() + policy.responseWindowMinutes * 60000);
  const createdOffers = [];
  let smsDispatchedCount = 0;

  for (const worker of workers) {
    const idempotencyKey = `offer:${runId}:${worker.id}:w${waveNumber}`;
    const preferred = worker.preferredChannel as 'in_app' | 'sms' | 'email';
    let channel: 'in_app' | 'sms' | 'email' = policy.channelsJson.includes(preferred)
      ? preferred
      : ((policy.channelsJson[0] as 'in_app' | 'sms' | 'email') || 'in_app');

    // Respect quiet hours for SMS unless shift is critical
    if (quietActive && channel === 'sms') {
      channel = 'in_app';
    }

    const dispatchRes = await dispatchOfferViaChannel({
      channel,
      recipientEmail: worker.email,
      recipientPhone: worker.phone,
      idempotencyKey,
      messageSubject: `Shift offer: ${shift.roleRequired} at ${facilityName}`,
      messageBody: `${shift.title} on ${shift.shiftDate}. Respond within ${policy.responseWindowMinutes} mins in CoverPulse.`,
    });

    if (channel === 'sms' && dispatchRes.status !== 'failed') {
      smsDispatchedCount++;
    }

    const inserted = await db
      .insert(shiftOffers)
      .values({
        tenantId,
        facilityId,
        shiftId: shift.id,
        runId,
        workerId: worker.id,
        waveNumber,
        channel,
        status: dispatchRes.status,
        idempotencyKey,
        attemptNumber: 1,
        sentAt: now,
        expiresAt,
      })
      .onConflictDoNothing({ target: shiftOffers.idempotencyKey })
      .returning();

    if (inserted.length > 0) {
      const offer = inserted[0];
      createdOffers.push(offer);

      await db.insert(offerEvents).values({
        tenantId,
        shiftId: shift.id,
        offerId: offer.id,
        eventType: dispatchRes.status === 'failed' ? 'offer_failed' : 'offer_delivered',
        channel,
        providerMessageId: dispatchRes.providerMessageId,
        summary: `Wave ${waveNumber} offer ${dispatchRes.status} to ${worker.firstName} ${worker.lastName} via ${channel.toUpperCase()} (${dispatchRes.detail})`,
        metadataJson: {
          waveNumber,
          idempotencyKey,
          providerMode: dispatchRes.providerMode,
          quietHoursApplied: quietActive,
        },
      });

      await db.insert(notifications).values({
        tenantId,
        workerId: worker.id,
        title: `New shift offer: ${shift.roleRequired}`,
        body: `${facilityName} · ${shift.shiftDate} · Respond within ${policy.responseWindowMinutes} minutes.`,
        category: 'coverage',
        linkPath: `/worker/offers/${offer.id}`,
      });
    }
  }

  if (smsDispatchedCount > 0) {
    await db
      .update(subscriptions)
      .set({
        smsUsedThisPeriod: sql`${subscriptions.smsUsedThisPeriod} + ${smsDispatchedCount}`,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.tenantId, tenantId));
  }

  return createdOffers;
}

// ATOMIC CONCURRENCY-SAFE SHIFT OFFER ACCEPTANCE WITH ROW LOCKING
export async function acceptShiftOfferAtomic(params: {
  tenantId: string;
  offerId: string;
  workerId: string;
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
}) {
  const { tenantId, offerId, workerId, actorUserId, actorEmail, actorRole } = params;

  return db.transaction(async (tx) => {
    // 1. Load offer strictly scoped to tenant + worker
    const [offer] = await tx
      .select()
      .from(shiftOffers)
      .where(
        and(
          eq(shiftOffers.id, offerId),
          eq(shiftOffers.tenantId, tenantId),
          eq(shiftOffers.workerId, workerId),
        ),
      )
      .limit(1);

    if (!offer) {
      throw new Error('Shift offer not found or not assigned to this worker.');
    }

    if (!['queued', 'sent', 'delivered', 'opened'].includes(offer.status)) {
      throw new Error(`This shift offer is no longer active (current status: ${offer.status}).`);
    }

    if (offer.expiresAt.getTime() < Date.now()) {
      await tx
        .update(shiftOffers)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(shiftOffers.id, offer.id));
      throw new Error('This shift offer has expired before acceptance.');
    }

    // 2. Lock the shift row with FOR UPDATE to prevent concurrent double-booking!
    const lockedResult = await tx.execute(
      sql`SELECT id, tenant_id, facility_id, title, start_at, end_at, headcount, filled_count, status, requires_manager_confirmation, published_at, first_response_at FROM shifts WHERE id = ${offer.shiftId} AND tenant_id = ${tenantId} FOR UPDATE`,
    );

    const lockedShift = lockedResult.rows[0] as
      | {
          id: string;
          tenant_id: string;
          facility_id: string;
          title: string;
          start_at: Date;
          end_at: Date;
          headcount: number;
          filled_count: number;
          status: string;
          requires_manager_confirmation: boolean;
          published_at: Date | null;
          first_response_at: Date | null;
        }
      | undefined;

    if (!lockedShift) {
      throw new Error('Shift no longer exists.');
    }

    if (
      ['covered', 'cancelled', 'expired'].includes(lockedShift.status) ||
      lockedShift.filled_count >= lockedShift.headcount
    ) {
      await tx
        .update(shiftOffers)
        .set({ status: 'withdrawn', updatedAt: new Date() })
        .where(eq(shiftOffers.id, offer.id));
      throw new Error('Shift was already covered by another worker just moments ago.');
    }

    // 3. Re-check worker overlap inside the transaction
    const existingWorkerShifts = await tx
      .select({
        shiftId: shiftAssignments.shiftId,
        startAt: shifts.startAt,
        endAt: shifts.endAt,
        status: shiftAssignments.status,
      })
      .from(shiftAssignments)
      .innerJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
      .where(
        and(
          eq(shiftAssignments.tenantId, tenantId),
          eq(shiftAssignments.workerId, workerId),
          inArray(shiftAssignments.status, ['confirmed', 'pending_confirmation']),
        ),
      );

    const shiftStart = new Date(lockedShift.start_at);
    const shiftEnd = new Date(lockedShift.end_at);

    for (const existing of existingWorkerShifts) {
      if (shiftsOverlap(shiftStart, shiftEnd, existing.startAt, existing.endAt)) {
        throw new Error('Cannot accept: this shift overlaps another confirmed shift on your roster.');
      }
    }

    const now = new Date();
    const latencySec = Math.max(1, Math.round((now.getTime() - offer.sentAt.getTime()) / 1000));

    // 4. Mark offer accepted
    await tx
      .update(shiftOffers)
      .set({
        status: 'accepted',
        respondedAt: now,
        responseLatencySec: latencySec,
        updatedAt: now,
      })
      .where(eq(shiftOffers.id, offer.id));

    const assignmentStatus = lockedShift.requires_manager_confirmation
      ? 'pending_confirmation'
      : 'confirmed';

    // 5. Create assignment
    const [assignment] = await tx
      .insert(shiftAssignments)
      .values({
        tenantId,
        facilityId: lockedShift.facility_id,
        shiftId: lockedShift.id,
        workerId,
        offerId: offer.id,
        status: assignmentStatus,
        confirmedAt: assignmentStatus === 'confirmed' ? now : null,
      })
      .returning();

    const newFilledCount = lockedShift.filled_count + 1;
    const fullyCovered = newFilledCount >= lockedShift.headcount;
    const newShiftStatus =
      assignmentStatus === 'pending_confirmation'
        ? 'broadcasting'
        : fullyCovered
          ? 'covered'
          : 'partially_covered';

    // 6. Update shift counts & timestamps
    await tx
      .update(shifts)
      .set({
        filledCount: newFilledCount,
        status: newShiftStatus,
        firstResponseAt: lockedShift.first_response_at ?? now,
        filledAt: fullyCovered && assignmentStatus === 'confirmed' ? now : null,
        updatedAt: now,
      })
      .where(eq(shifts.id, lockedShift.id));

    const [worker] = await tx
      .select()
      .from(workerProfiles)
      .where(eq(workerProfiles.id, workerId))
      .limit(1);

    // 7. Withdraw all remaining pending offers if shift capacity is reached
    let withdrawnCount = 0;
    if (fullyCovered) {
      const withdrawn = await tx
        .update(shiftOffers)
        .set({ status: 'withdrawn', updatedAt: now })
        .where(
          and(
            eq(shiftOffers.tenantId, tenantId),
            eq(shiftOffers.shiftId, lockedShift.id),
            ne(shiftOffers.id, offer.id),
            inArray(shiftOffers.status, ['queued', 'sent', 'delivered', 'opened']),
          ),
        )
        .returning({ id: shiftOffers.id });

      withdrawnCount = withdrawn.length;

      // Stop active coverage runs
      await tx
        .update(coverageRuns)
        .set({
          status: 'completed',
          completedAt: now,
          stoppedReason:
            assignmentStatus === 'confirmed'
              ? `Shift covered by ${worker?.firstName ?? ''} ${worker?.lastName ?? ''}`.trim()
              : 'Acceptance received — awaiting manager confirmation',
          updatedAt: now,
        })
        .where(
          and(
            eq(coverageRuns.tenantId, tenantId),
            eq(coverageRuns.shiftId, lockedShift.id),
            eq(coverageRuns.status, 'running'),
          ),
        );
    }

    // 8. Record timeline events
    await tx.insert(offerEvents).values({
      tenantId,
      shiftId: lockedShift.id,
      offerId: offer.id,
      eventType: 'offer_accepted',
      channel: offer.channel,
      summary: `${worker?.firstName ?? 'Worker'} ${worker?.lastName ?? ''} accepted shift offer in ${Math.round(latencySec / 60) || 1}m (${assignmentStatus === 'confirmed' ? 'confirmed atomically' : 'pending manager confirmation'}).`,
      metadataJson: { workerId, latencySec, assignmentId: assignment.id, withdrawnCount },
    });

    if (withdrawnCount > 0) {
      await tx.insert(offerEvents).values({
        tenantId,
        shiftId: lockedShift.id,
        eventType: 'offer_withdrawn',
        summary: `Automatically withdrew ${withdrawnCount} remaining pending offer(s) and halted Coverage Autopilot.`,
        metadataJson: { withdrawnCount },
      });
    }

    if (fullyCovered && assignmentStatus === 'confirmed') {
      await tx.insert(offerEvents).values({
        tenantId,
        shiftId: lockedShift.id,
        eventType: 'shift_covered',
        summary: `Shift fully covered (${newFilledCount}/${lockedShift.headcount}).`,
        metadataJson: { assignmentId: assignment.id },
      });
    }

    // Manager notification
    await tx.insert(notifications).values({
      tenantId,
      title:
        assignmentStatus === 'confirmed'
          ? `Shift covered: ${lockedShift.title}`
          : `Approval needed: ${lockedShift.title}`,
      body: `${worker?.firstName ?? 'Worker'} ${worker?.lastName ?? ''} accepted the shift offer. ${withdrawnCount > 0 ? `${withdrawnCount} other offers were withdrawn.` : ''}`,
      category: 'coverage',
      linkPath: `/shifts/${lockedShift.id}`,
    });

    // Audit event inside same transaction
    await tx.insert(auditEvents).values({
      tenantId,
      facilityId: lockedShift.facility_id,
      actorUserId,
      actorEmail,
      actorRole,
      action: 'offer.accepted',
      entityType: 'shift_assignment',
      entityId: assignment.id,
      summary: `${worker?.firstName ?? ''} ${worker?.lastName ?? ''} accepted offer for ${lockedShift.title} (${newShiftStatus}).`,
      metadataJson: { shiftId: lockedShift.id, offerId: offer.id, withdrawnCount },
    });

    return {
      assignment,
      shiftStatus: newShiftStatus,
      filledCount: newFilledCount,
      headcount: lockedShift.headcount,
      withdrawnCount,
    };
  });
}

export async function declineShiftOffer(params: {
  tenantId: string;
  offerId: string;
  workerId: string;
  reason?: string;
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
}) {
  const { tenantId, offerId, workerId, reason, actorUserId, actorEmail, actorRole } = params;

  const [offer] = await db
    .select()
    .from(shiftOffers)
    .where(
      and(
        eq(shiftOffers.id, offerId),
        eq(shiftOffers.tenantId, tenantId),
        eq(shiftOffers.workerId, workerId),
      ),
    )
    .limit(1);

  if (!offer) throw new Error('Shift offer not found.');
  if (!['queued', 'sent', 'delivered', 'opened'].includes(offer.status)) {
    throw new Error(`Offer cannot be declined in status "${offer.status}".`);
  }

  const now = new Date();
  const latencySec = Math.max(1, Math.round((now.getTime() - offer.sentAt.getTime()) / 1000));

  await db
    .update(shiftOffers)
    .set({
      status: 'declined',
      declineReason: reason || 'Unavailable for this shift',
      respondedAt: now,
      responseLatencySec: latencySec,
      updatedAt: now,
    })
    .where(eq(shiftOffers.id, offer.id));

  await db
    .update(shifts)
    .set({
      firstResponseAt: sql`COALESCE(${shifts.firstResponseAt}, ${now})`,
      updatedAt: now,
    })
    .where(and(eq(shifts.id, offer.shiftId), eq(shifts.tenantId, tenantId)));

  const [worker] = await db
    .select()
    .from(workerProfiles)
    .where(eq(workerProfiles.id, workerId))
    .limit(1);

  await db.insert(offerEvents).values({
    tenantId,
    shiftId: offer.shiftId,
    offerId: offer.id,
    eventType: 'offer_declined',
    channel: offer.channel,
    summary: `${worker?.firstName ?? 'Worker'} ${worker?.lastName ?? ''} declined offer (${reason || 'Unavailable'}).`,
    metadataJson: { workerId, reason: reason || 'Unavailable' },
  });

  await recordAuditEvent({
    tenantId,
    facilityId: offer.facilityId,
    actorUserId,
    actorEmail,
    actorRole,
    action: 'offer.declined',
    entityType: 'shift_offer',
    entityId: offer.id,
    summary: `${worker?.firstName ?? ''} ${worker?.lastName ?? ''} declined shift offer.`,
    metadata: { shiftId: offer.shiftId, reason },
  });

  // Check if all offers in the active run's current wave are now declined/expired -> auto-advance or escalate
  if (offer.runId) {
    const remainingPending = await db
      .select({ id: shiftOffers.id })
      .from(shiftOffers)
      .where(
        and(
          eq(shiftOffers.tenantId, tenantId),
          eq(shiftOffers.runId, offer.runId),
          eq(shiftOffers.waveNumber, offer.waveNumber),
          inArray(shiftOffers.status, ['queued', 'sent', 'delivered', 'opened']),
        ),
      );

    if (remainingPending.length === 0) {
      await advanceOrEscalateRun({
        tenantId,
        shiftId: offer.shiftId,
        actorUserId,
        actorEmail,
        actorRole,
        triggerReason: 'All offers in current wave were declined',
      });
    }
  }

  return { ok: true };
}

export async function advanceOrEscalateRun(params: {
  tenantId: string;
  shiftId: string;
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  triggerReason?: string;
}) {
  const { tenantId, shiftId, actorUserId, actorEmail, actorRole, triggerReason } = params;

  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.tenantId, tenantId)))
    .limit(1);

  if (!shift) throw new Error('Shift not found.');
  if (shift.status === 'covered' || shift.status === 'cancelled') {
    return { action: 'noop', reason: `Shift is already ${shift.status}` };
  }

  const [run] = await db
    .select()
    .from(coverageRuns)
    .where(
      and(
        eq(coverageRuns.tenantId, tenantId),
        eq(coverageRuns.shiftId, shiftId),
        eq(coverageRuns.status, 'running'),
      ),
    )
    .limit(1);

  if (!run) {
    throw new Error('No active Coverage Autopilot run found for this shift.');
  }

  const [policy] = await db
    .select()
    .from(coveragePolicies)
    .where(and(eq(coveragePolicies.id, run.policyId), eq(coveragePolicies.tenantId, tenantId)))
    .limit(1);

  const [facility] = await db
    .select()
    .from(facilities)
    .where(eq(facilities.id, shift.facilityId))
    .limit(1);

  const now = new Date();

  // Expire any unresponded offers in current wave
  const expiredRows = await db
    .update(shiftOffers)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        eq(shiftOffers.tenantId, tenantId),
        eq(shiftOffers.runId, run.id),
        eq(shiftOffers.waveNumber, run.currentWave),
        inArray(shiftOffers.status, ['queued', 'sent', 'delivered', 'opened']),
      ),
    )
    .returning();

  if (expiredRows.length > 0) {
    await db.insert(offerEvents).values({
      tenantId,
      shiftId,
      eventType: 'offer_expired',
      summary: `Wave ${run.currentWave} response window closed — ${expiredRows.length} unresponded offer(s) expired.`,
      metadataJson: { wave: run.currentWave, expiredCount: expiredRows.length },
    });
  }

  // Find already offered worker IDs in this run
  const priorOffers = await db
    .select({ workerId: shiftOffers.workerId })
    .from(shiftOffers)
    .where(and(eq(shiftOffers.tenantId, tenantId), eq(shiftOffers.runId, run.id)));

  const offeredSet = new Set(priorOffers.map((o) => o.workerId));

  // Re-evaluate live eligibility so no newly-booked worker gets offered
  const liveCandidates = await evaluateShiftEligibilityFromDb(tenantId, shiftId);
  const remainingEligible = liveCandidates.filter((c) => c.eligible && !offeredSet.has(c.workerId));

  const effectiveBatchSize =
    policy?.dispatchMode === 'sequential'
      ? 1
      : policy?.dispatchMode === 'parallel_waves'
        ? Math.max(policy?.batchSize ?? 5, 5)
        : (policy?.batchSize ?? 3);

  const nextWave = run.currentWave + 1;

  if (policy && nextWave <= policy.maxAttempts && remainingEligible.length > 0) {
    const nextBatch = remainingEligible.slice(0, effectiveBatchSize);

    await db
      .update(coverageRuns)
      .set({
        currentWave: nextWave,
        attemptsCount: run.attemptsCount + 1,
        updatedAt: now,
      })
      .where(eq(coverageRuns.id, run.id));

    const dispatched = await dispatchWaveOffers({
      tenantId,
      facilityId: shift.facilityId,
      facilityName: facility?.name ?? 'Facility',
      shift,
      policy,
      runId: run.id,
      waveNumber: nextWave,
      candidateIds: nextBatch.map((w) => w.workerId),
      bypassQuietHours: false,
    });

    await recordAuditEvent({
      tenantId,
      facilityId: shift.facilityId,
      actorUserId,
      actorEmail,
      actorRole,
      action: 'autopilot.wave_advanced',
      entityType: 'coverage_run',
      entityId: run.id,
      summary: `Advanced Coverage Autopilot to Wave ${nextWave} (${dispatched.length} offers dispatched).`,
      metadata: { shiftId, nextWave, triggerReason },
    });

    return { action: 'wave_dispatched', wave: nextWave, dispatchedCount: dispatched.length };
  }

  // No more eligible candidates or max attempts reached -> ESCALATE
  const escalationReason =
    triggerReason ||
    `All ${run.currentWave} wave(s) exhausted with no accepted offer. Escalated to ${policy?.escalationRecipientEmail ?? 'Operations Manager'}.`;

  await db
    .update(coverageRuns)
    .set({
      status: 'escalated',
      completedAt: now,
      stoppedReason: escalationReason,
      updatedAt: now,
    })
    .where(eq(coverageRuns.id, run.id));

  await db
    .update(shifts)
    .set({
      status: shift.filledCount > 0 ? 'partially_covered' : 'open',
      escalatedAt: now,
      escalationReason,
      updatedAt: now,
    })
    .where(eq(shifts.id, shiftId));

  await db.insert(offerEvents).values({
    tenantId,
    shiftId,
    eventType: 'wave_escalated',
    summary: `Coverage escalated to ${policy?.escalationRecipientRole ?? 'operations_manager'} (${policy?.escalationRecipientEmail ?? 'manager'}): ${escalationReason}`,
    metadataJson: { runId: run.id, wavesAttempted: run.currentWave },
  });

  await db.insert(notifications).values({
    tenantId,
    title: `Escalation required: ${shift.title}`,
    body: `${facility?.name ?? 'Facility'} · Unresolved after ${run.currentWave} wave(s). Manual coordinator intervention required.`,
    category: 'escalation',
    linkPath: `/shifts/${shift.id}`,
  });

  await recordAuditEvent({
    tenantId,
    facilityId: shift.facilityId,
    actorUserId,
    actorEmail,
    actorRole,
    action: 'autopilot.escalated',
    entityType: 'shift',
    entityId: shiftId,
    summary: `Shift escalated after ${run.currentWave} wave(s) without acceptance.`,
    metadata: { runId: run.id, escalationReason },
  });

  return { action: 'escalated', escalationReason };
}

export async function manualOverrideAssign(params: {
  session: SessionContext;
  shiftId: string;
  workerId: string;
  reason: string;
}) {
  const { session, shiftId, workerId, reason } = params;
  if (!reason || reason.trim().length < 10) {
    throw new Error('A mandatory audit reason (at least 10 characters) is required for manual overrides.');
  }

  const evaluations = await evaluateShiftEligibilityFromDb(session.tenantId, shiftId);
  const target = evaluations.find((e) => e.workerId === workerId);
  if (!target) {
    throw new Error('Worker not found in organisation scope.');
  }

  // Safety-critical lock: NEVER allow bypassing clinical/safety qualification failures, role mismatch, or active overlap
  if (target.safetyBlocked) {
    throw new Error(
      `Manual override blocked by safety policy: ${target.exclusionReasons.join('; ')}`,
    );
  }

  return db.transaction(async (tx) => {
    const lockedResult = await tx.execute(
      sql`SELECT id, tenant_id, facility_id, title, headcount, filled_count, status FROM shifts WHERE id = ${shiftId} AND tenant_id = ${session.tenantId} FOR UPDATE`,
    );
    const shift = lockedResult.rows[0] as
      | {
          id: string;
          tenant_id: string;
          facility_id: string;
          title: string;
          headcount: number;
          filled_count: number;
          status: string;
        }
      | undefined;

    if (!shift) throw new Error('Shift not found.');
    if (shift.filled_count >= shift.headcount) {
      throw new Error('Shift is already at full headcount.');
    }

    const now = new Date();
    const [assignment] = await tx
      .insert(shiftAssignments)
      .values({
        tenantId: session.tenantId,
        facilityId: shift.facility_id,
        shiftId: shift.id,
        workerId,
        status: 'confirmed',
        assignedByUserId: session.userId,
        isOverride: !target.eligible,
        overrideReason: !target.eligible ? reason.trim() : null,
        confirmedAt: now,
      })
      .returning();

    const newFilled = shift.filled_count + 1;
    const fullyCovered = newFilled >= shift.headcount;

    await tx
      .update(shifts)
      .set({
        filledCount: newFilled,
        status: fullyCovered ? 'covered' : 'partially_covered',
        filledAt: fullyCovered ? now : null,
        updatedAt: now,
      })
      .where(eq(shifts.id, shift.id));

    if (fullyCovered) {
      await tx
        .update(shiftOffers)
        .set({ status: 'withdrawn', updatedAt: now })
        .where(
          and(
            eq(shiftOffers.tenantId, session.tenantId),
            eq(shiftOffers.shiftId, shift.id),
            inArray(shiftOffers.status, ['queued', 'sent', 'delivered', 'opened']),
          ),
        );

      await tx
        .update(coverageRuns)
        .set({
          status: 'completed',
          completedAt: now,
          stoppedReason: `Covered via manual assignment by ${session.fullName}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(coverageRuns.tenantId, session.tenantId),
            eq(coverageRuns.shiftId, shift.id),
            eq(coverageRuns.status, 'running'),
          ),
        );
    }

    await tx.insert(offerEvents).values({
      tenantId: session.tenantId,
      shiftId: shift.id,
      eventType: 'manager_override',
      summary: `${session.fullName} manually assigned ${target.workerName}${!target.eligible ? ' (non-safety override)' : ''}. Reason: ${reason.trim()}`,
      metadataJson: { workerId, isOverride: !target.eligible, reason: reason.trim() },
    });

    await tx.insert(auditEvents).values({
      tenantId: session.tenantId,
      facilityId: shift.facility_id,
      actorUserId: session.userId,
      actorEmail: session.email,
      actorRole: session.roleKey,
      action: !target.eligible ? 'shift.manual_override_assign' : 'shift.manual_assign',
      entityType: 'shift_assignment',
      entityId: assignment.id,
      summary: `Assigned ${target.workerName} to ${shift.title}. Reason: ${reason.trim()}`,
      metadataJson: {
        shiftId: shift.id,
        workerId,
        overriddenExclusions: target.exclusionReasons,
      },
    });

    return { assignment, shiftStatus: fullyCovered ? 'covered' : 'partially_covered' };
  });
}
