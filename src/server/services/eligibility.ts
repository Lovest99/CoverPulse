import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  availabilityWindows,
  qualificationEvidence,
  qualifications,
  shiftAssignments,
  shiftRequirements,
  shifts,
  skills,
  workerFacilities,
  workerProfiles,
} from '../../db/schema.ts';
import type { EligibilityEvaluationResult, ScoreBreakdown } from '../../shared/types.ts';

export interface PureShiftInput {
  id: string;
  tenantId: string;
  facilityId: string;
  roleRequired: string;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
  isOvernight: boolean;
  requiredQualifications: Array<{
    qualificationId: string;
    code: string;
    name: string;
    isMandatorySafety: boolean;
  }>;
  requiredSkills: string[];
}

export interface PureWorkerInput {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  primaryRole: string;
  employmentType: string;
  preferredChannel: string;
  travelRadiusKm: number;
  maxWeeklyHours: number;
  minRestHours: number;
  availabilityStatus: string;
  reliabilityScore: number;
  recentShiftsCount: number;
  active: boolean;
  restrictions: {
    noNightShifts?: boolean;
    noDoubleShifts?: boolean;
    maxConsecutiveDays?: number;
    notes?: string;
  };
  approvedFacilities: Array<{
    facilityId: string;
    isPrimary: boolean;
    distanceKm: number;
    approved: boolean;
  }>;
  qualifications: Array<{
    qualificationId: string;
    reviewStatus: string;
    expiresAt: Date;
  }>;
  skills: string[];
  availabilityWindows: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    specificDate: string | null;
    isAvailable: boolean;
  }>;
  existingAssignments: Array<{
    shiftId: string;
    startAt: Date;
    endAt: Date;
    breakMinutes: number;
    status: string;
  }>;
}

export function shiftsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

export function computeShiftPaidHours(startAt: Date, endAt: Date, breakMinutes: number): number {
  const diffMin = Math.max(0, (endAt.getTime() - startAt.getTime()) / 60000 - breakMinutes);
  return Number((diffMin / 60).toFixed(2));
}

export function evaluateCandidatesDeterministic(
  shift: PureShiftInput,
  workers: PureWorkerInput[],
): EligibilityEvaluationResult[] {
  const shiftHours = computeShiftPaidHours(shift.startAt, shift.endAt, shift.breakMinutes);
  const shiftDayOfWeek = shift.startAt.getUTCDay();
  const shiftDateIso = shift.startAt.toISOString().slice(0, 10);

  // Calculate start/end of same ISO week (7-day rolling window centered on shift start)
  const weekStartMs = shift.startAt.getTime() - 3.5 * 24 * 3600 * 1000;
  const weekEndMs = shift.startAt.getTime() + 3.5 * 24 * 3600 * 1000;

  const evaluated = workers.map<EligibilityEvaluationResult>((w) => {
    const inclusionReasons: string[] = [];
    const exclusionReasons: string[] = [];
    let safetyBlocked = false;

    // 1. Tenant isolation check (defense in depth)
    if (w.tenantId !== shift.tenantId) {
      exclusionReasons.push('Cross-tenant worker boundary violation');
      safetyBlocked = true;
    }

    // 2. Active status
    if (!w.active) {
      exclusionReasons.push('Worker profile is inactive');
      safetyBlocked = true;
    }

    // 3. Role match
    if (w.primaryRole !== shift.roleRequired) {
      exclusionReasons.push(`Role mismatch: worker is ${w.primaryRole}, shift requires ${shift.roleRequired}`);
      safetyBlocked = true;
    } else {
      inclusionReasons.push(`Matches required role (${w.primaryRole})`);
    }

    // 4. Mandatory verified qualifications (never expired on shift end date)
    for (const reqQual of shift.requiredQualifications) {
      const evidence = w.qualifications.find((q) => q.qualificationId === reqQual.qualificationId);
      if (!evidence) {
        exclusionReasons.push(`Missing required qualification: ${reqQual.name} (${reqQual.code})`);
        if (reqQual.isMandatorySafety) safetyBlocked = true;
      } else if (evidence.reviewStatus !== 'verified') {
        exclusionReasons.push(
          `Qualification ${reqQual.code} is ${evidence.reviewStatus} (verified status required)`,
        );
        if (reqQual.isMandatorySafety) safetyBlocked = true;
      } else if (evidence.expiresAt.getTime() < shift.endAt.getTime()) {
        exclusionReasons.push(
          `Qualification ${reqQual.code} expired on ${evidence.expiresAt.toISOString().slice(0, 10)}`,
        );
        if (reqQual.isMandatorySafety) safetyBlocked = true;
      } else {
        inclusionReasons.push(`Verified ${reqQual.code} valid through ${evidence.expiresAt.toISOString().slice(0, 10)}`);
      }
    }

    // 5. Facility eligibility
    const facilityLink = w.approvedFacilities.find(
      (f) => f.facilityId === shift.facilityId && f.approved,
    );
    if (!facilityLink) {
      exclusionReasons.push('Not inducted/approved for this facility');
    } else {
      inclusionReasons.push(
        facilityLink.isPrimary
          ? `Primary facility (${facilityLink.distanceKm} km)`
          : `Approved secondary facility (${facilityLink.distanceKm} km)`,
      );
      if (facilityLink.distanceKm > w.travelRadiusKm) {
        exclusionReasons.push(
          `Facility distance (${facilityLink.distanceKm} km) exceeds worker travel preference (${w.travelRadiusKm} km)`,
        );
      }
    }

    // 6. Availability status & windows
    if (w.availabilityStatus === 'unavailable') {
      exclusionReasons.push('Worker status currently set to Unavailable');
    } else {
      const dateOverride = w.availabilityWindows.find((aw) => aw.specificDate === shiftDateIso);
      if (dateOverride && !dateOverride.isAvailable) {
        exclusionReasons.push(`Unavailable on ${shiftDateIso} (calendar override)`);
      } else {
        const dayWindows = w.availabilityWindows.filter(
          (aw) => aw.specificDate === null && aw.dayOfWeek === shiftDayOfWeek,
        );
        if (dayWindows.length > 0 && dayWindows.every((aw) => !aw.isAvailable)) {
          exclusionReasons.push('Marked unavailable for this day of week');
        } else {
          inclusionReasons.push('Available for scheduled shift window');
        }
      }
    }

    // 7. Overnight / work restrictions
    if (shift.isOvernight && w.restrictions.noNightShifts) {
      exclusionReasons.push('Work restriction: No overnight shifts');
      safetyBlocked = true;
    }

    // 8. Overlap & Rest-period & Weekly-hours constraints
    const activeAssignments = w.existingAssignments.filter(
      (a) => a.status === 'confirmed' || a.status === 'pending_confirmation',
    );
    let weeklyHoursScheduled = 0;
    let hasOverlap = false;
    let restViolationHours: number | null = null;

    for (const a of activeAssignments) {
      if (a.shiftId === shift.id) {
        exclusionReasons.push('Already assigned to this shift');
        hasOverlap = true;
        safetyBlocked = true;
        continue;
      }
      if (shiftsOverlap(shift.startAt, shift.endAt, a.startAt, a.endAt)) {
        hasOverlap = true;
        safetyBlocked = true;
        exclusionReasons.push(
          `Overlaps existing shift (${a.startAt.toISOString().slice(11, 16)}–${a.endAt.toISOString().slice(11, 16)} UTC)`,
        );
      } else {
        // Compute rest gap in hours
        const gapBeforeHrs = (shift.startAt.getTime() - a.endAt.getTime()) / 3600000;
        const gapAfterHrs = (a.startAt.getTime() - shift.endAt.getTime()) / 3600000;
        const minGap =
          gapBeforeHrs >= 0 && gapBeforeHrs < w.minRestHours
            ? gapBeforeHrs
            : gapAfterHrs >= 0 && gapAfterHrs < w.minRestHours
              ? gapAfterHrs
              : null;
        if (minGap !== null) {
          restViolationHours = Number(minGap.toFixed(1));
        }
      }

      if (a.startAt.getTime() >= weekStartMs && a.startAt.getTime() <= weekEndMs) {
        weeklyHoursScheduled += computeShiftPaidHours(a.startAt, a.endAt, a.breakMinutes);
      }
    }

    if (restViolationHours !== null) {
      exclusionReasons.push(
        `Insufficient rest break (${restViolationHours}h gap < ${w.minRestHours}h minimum rest policy)`,
      );
      if (w.restrictions.noDoubleShifts) safetyBlocked = true;
    }

    if (weeklyHoursScheduled + shiftHours > w.maxWeeklyHours) {
      exclusionReasons.push(
        `Exceeds weekly hour limit (${(weeklyHoursScheduled + shiftHours).toFixed(1)}h > ${w.maxWeeklyHours}h cap)`,
      );
    }

    const eligible = exclusionReasons.length === 0;

    // Transparent configurable ranking strictly AFTER hard filters pass
    const scoreBreakdown: ScoreBreakdown = {
      facilityDistance: 0,
      skillsFit: 0,
      reliability: 0,
      fairRotation: 0,
    };

    if (eligible) {
      // Facility & Travel (0-25)
      if (facilityLink) {
        const primaryBonus = facilityLink.isPrimary ? 10 : 4;
        const distScore = Math.max(0, Math.round(15 * (1 - facilityLink.distanceKm / Math.max(1, w.travelRadiusKm))));
        scoreBreakdown.facilityDistance = Math.min(25, primaryBonus + distScore);
      }

      // Preferred Skills Fit (0-25)
      if (shift.requiredSkills.length === 0) {
        scoreBreakdown.skillsFit = 20;
      } else {
        const matched = shift.requiredSkills.filter((sk) =>
          w.skills.some((ws) => ws.toLowerCase() === sk.toLowerCase()),
        );
        scoreBreakdown.skillsFit = Math.round((matched.length / shift.requiredSkills.length) * 25);
        if (matched.length > 0) {
          inclusionReasons.push(`Matched clinical skills: ${matched.join(', ')}`);
        }
      }

      // Response reliability (0-25)
      scoreBreakdown.reliability = Math.round((Math.min(100, Math.max(0, w.reliabilityScore)) / 100) * 25);

      // Fair rotation — workers with fewer recent shifts get higher rotation priority (0-25)
      scoreBreakdown.fairRotation = Math.max(4, Math.min(25, 25 - w.recentShiftsCount * 3));
    }

    const totalScore =
      scoreBreakdown.facilityDistance +
      scoreBreakdown.skillsFit +
      scoreBreakdown.reliability +
      scoreBreakdown.fairRotation;

    return {
      workerId: w.id,
      workerName: `${w.firstName} ${w.lastName}`,
      primaryRole: w.primaryRole,
      employmentType: w.employmentType,
      preferredChannel: w.preferredChannel,
      eligible,
      canManualOverride: !eligible && !safetyBlocked && !hasOverlap,
      safetyBlocked,
      totalScore,
      scoreBreakdown,
      inclusionReasons,
      exclusionReasons,
      distanceKm: facilityLink?.distanceKm ?? null,
      weeklyHoursScheduled: Number(weeklyHoursScheduled.toFixed(1)),
      rankOrder: null,
    };
  });

  // Sort: eligible first by descending totalScore (deterministic tie-break by workerName), then ineligible
  evaluated.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.workerName.localeCompare(b.workerName);
  });

  let rank = 1;
  for (const item of evaluated) {
    if (item.eligible) {
      item.rankOrder = rank++;
    }
  }

  return evaluated;
}

export async function evaluateShiftEligibilityFromDb(
  tenantId: string,
  shiftId: string,
): Promise<EligibilityEvaluationResult[]> {
  try {
    const [shift] = await db
      .select()
      .from(shifts)
      .where(and(eq(shifts.id, shiftId), eq(shifts.tenantId, tenantId)))
      .limit(1);

    if (!shift) {
      throw new Error('Shift not found in tenant scope');
    }

    const reqRows = await db
      .select({
        qualificationId: shiftRequirements.qualificationId,
        requiredSkillName: shiftRequirements.requiredSkillName,
        qualCode: qualifications.code,
        qualName: qualifications.name,
        isMandatorySafety: qualifications.isMandatorySafety,
      })
      .from(shiftRequirements)
      .leftJoin(qualifications, eq(shiftRequirements.qualificationId, qualifications.id))
      .where(and(eq(shiftRequirements.shiftId, shiftId), eq(shiftRequirements.tenantId, tenantId)));

    const requiredQualifications = reqRows
      .filter((r) => r.qualificationId && r.qualCode && r.qualName)
      .map((r) => ({
        qualificationId: r.qualificationId!,
        code: r.qualCode!,
        name: r.qualName!,
        isMandatorySafety: r.isMandatorySafety ?? true,
      }));

    const requiredSkills = reqRows
      .filter((r) => Boolean(r.requiredSkillName))
      .map((r) => r.requiredSkillName!);

    // Load all tenant workers (strictly scoped by tenantId)
    const workerRows = await db
      .select()
      .from(workerProfiles)
      .where(eq(workerProfiles.tenantId, tenantId));

    if (workerRows.length === 0) return [];
    const workerIds = workerRows.map((w) => w.id);

    const [wfRows, qualEvRows, skillRows, availRows, assignRows] = await Promise.all([
      db
        .select()
        .from(workerFacilities)
        .where(and(eq(workerFacilities.tenantId, tenantId), inArray(workerFacilities.workerId, workerIds))),
      db
        .select()
        .from(qualificationEvidence)
        .where(
          and(
            eq(qualificationEvidence.tenantId, tenantId),
            inArray(qualificationEvidence.workerId, workerIds),
          ),
        ),
      db
        .select()
        .from(skills)
        .where(and(eq(skills.tenantId, tenantId), inArray(skills.workerId, workerIds))),
      db
        .select()
        .from(availabilityWindows)
        .where(
          and(
            eq(availabilityWindows.tenantId, tenantId),
            inArray(availabilityWindows.workerId, workerIds),
          ),
        ),
      db
        .select({
          workerId: shiftAssignments.workerId,
          shiftId: shiftAssignments.shiftId,
          status: shiftAssignments.status,
          startAt: shifts.startAt,
          endAt: shifts.endAt,
          breakMinutes: shifts.breakMinutes,
        })
        .from(shiftAssignments)
        .innerJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
        .where(
          and(
            eq(shiftAssignments.tenantId, tenantId),
            inArray(shiftAssignments.workerId, workerIds),
          ),
        ),
    ]);

    const pureWorkers: PureWorkerInput[] = workerRows.map((w) => ({
      id: w.id,
      tenantId: w.tenantId,
      firstName: w.firstName,
      lastName: w.lastName,
      primaryRole: w.primaryRole,
      employmentType: w.employmentType,
      preferredChannel: w.preferredChannel,
      travelRadiusKm: w.travelRadiusKm,
      maxWeeklyHours: w.maxWeeklyHours,
      minRestHours: w.minRestHours,
      availabilityStatus: w.availabilityStatus,
      reliabilityScore: w.reliabilityScore,
      recentShiftsCount: w.recentShiftsCount,
      active: w.active,
      restrictions: w.restrictionsJson ?? {},
      approvedFacilities: wfRows
        .filter((f) => f.workerId === w.id)
        .map((f) => ({
          facilityId: f.facilityId,
          isPrimary: f.isPrimary,
          distanceKm: f.distanceKm,
          approved: f.approved,
        })),
      qualifications: qualEvRows
        .filter((q) => q.workerId === w.id)
        .map((q) => ({
          qualificationId: q.qualificationId,
          reviewStatus: q.reviewStatus,
          expiresAt: q.expiresAt,
        })),
      skills: skillRows.filter((s) => s.workerId === w.id).map((s) => s.name),
      availabilityWindows: availRows
        .filter((a) => a.workerId === w.id)
        .map((a) => ({
          dayOfWeek: a.dayOfWeek,
          startTime: a.startTime,
          endTime: a.endTime,
          specificDate: a.specificDate,
          isAvailable: a.isAvailable,
        })),
      existingAssignments: assignRows
        .filter((a) => a.workerId === w.id)
        .map((a) => ({
          shiftId: a.shiftId,
          startAt: a.startAt,
          endAt: a.endAt,
          breakMinutes: a.breakMinutes,
          status: a.status,
        })),
    }));

    return evaluateCandidatesDeterministic(
      {
        id: shift.id,
        tenantId: shift.tenantId,
        facilityId: shift.facilityId,
        roleRequired: shift.roleRequired,
        startAt: shift.startAt,
        endAt: shift.endAt,
        breakMinutes: shift.breakMinutes,
        isOvernight: shift.isOvernight,
        requiredQualifications,
        requiredSkills,
      },
      pureWorkers,
    );
  } catch (error) {
    console.error('Eligibility evaluation failed:', error);
    throw new Error('Unable to evaluate candidate eligibility at this time.', { cause: error });
  }
}
