import { describe, expect, it } from 'vitest';
import {
  computeShiftPaidHours,
  evaluateCandidatesDeterministic,
  shiftsOverlap,
  type PureShiftInput,
  type PureWorkerInput,
} from '../src/server/services/eligibility.ts';
import { canAccessFacility, hasPermission, PERMISSIONS } from '../src/server/rbac.ts';
import {
  normalizeAustralianPhone,
  signWebhookPayload,
  validateSafeWebhookUrl,
  verifyWebhookSignature,
} from '../src/server/services/providers.ts';

function makeBaseShift(overrides: Partial<PureShiftInput> = {}): PureShiftInput {
  return {
    id: 'shift-1',
    tenantId: 'tenant-a',
    facilityId: 'fac-a',
    roleRequired: 'Registered Nurse (RN)',
    startAt: new Date('2026-06-15T12:00:00.000Z'), // 22:00 AEST
    endAt: new Date('2026-06-15T20:30:00.000Z'), // 06:30 AEST next day (8.5h - 0.5h break = 8h)
    breakMinutes: 30,
    isOvernight: true,
    requiredQualifications: [
      { qualificationId: 'qual-ahpra', code: 'AHPRA', name: 'AHPRA Registration', isMandatorySafety: true },
      { qualificationId: 'qual-cpr', code: 'CPR', name: 'First Aid & CPR', isMandatorySafety: true },
    ],
    requiredSkills: ['Dementia Care', 'Medication Administration'],
    ...overrides,
  };
}

function makeBaseWorker(overrides: Partial<PureWorkerInput> = {}): PureWorkerInput {
  const futureExpiry = new Date('2027-12-31T00:00:00.000Z');
  return {
    id: 'worker-1',
    tenantId: 'tenant-a',
    firstName: 'Chloe',
    lastName: 'Nguyen',
    primaryRole: 'Registered Nurse (RN)',
    employmentType: 'Part-Time',
    preferredChannel: 'sms',
    travelRadiusKm: 25,
    maxWeeklyHours: 38,
    minRestHours: 10,
    availabilityStatus: 'available',
    reliabilityScore: 94,
    recentShiftsCount: 2,
    active: true,
    restrictions: {},
    approvedFacilities: [{ facilityId: 'fac-a', isPrimary: true, distanceKm: 6, approved: true }],
    qualifications: [
      { qualificationId: 'qual-ahpra', reviewStatus: 'verified', expiresAt: futureExpiry },
      { qualificationId: 'qual-cpr', reviewStatus: 'verified', expiresAt: futureExpiry },
    ],
    skills: ['Dementia Care', 'Medication Administration'],
    availabilityWindows: [
      { dayOfWeek: 1, startTime: '00:00', endTime: '23:59', specificDate: null, isAvailable: true },
    ],
    existingAssignments: [],
    ...overrides,
  };
}

describe('CoverPulse Deterministic Shift Eligibility & Ranking Engine', () => {
  it('computes overnight shift paid hours accurately minus break minutes', () => {
    const start = new Date('2026-06-15T22:00:00+10:00');
    const end = new Date('2026-06-16T06:30:00+10:00');
    expect(computeShiftPaidHours(start, end, 30)).toBe(8);
  });

  it('detects exact shift overlaps and allows adjacent non-overlapping shifts', () => {
    const aStart = new Date('2026-06-15T08:00:00Z');
    const aEnd = new Date('2026-06-15T16:00:00Z');
    expect(shiftsOverlap(aStart, aEnd, new Date('2026-06-15T15:00:00Z'), new Date('2026-06-15T20:00:00Z'))).toBe(true);
    expect(shiftsOverlap(aStart, aEnd, new Date('2026-06-15T16:00:00Z'), new Date('2026-06-15T22:00:00Z'))).toBe(false);
  });

  it('excludes workers with expired mandatory qualifications and locks manual override (safetyBlocked)', () => {
    const shift = makeBaseShift();
    const expiredWorker = makeBaseWorker({
      id: 'w-expired',
      firstName: 'Expired',
      qualifications: [
        { qualificationId: 'qual-ahpra', reviewStatus: 'verified', expiresAt: new Date('2025-01-01T00:00:00Z') },
        { qualificationId: 'qual-cpr', reviewStatus: 'verified', expiresAt: new Date('2027-12-31T00:00:00Z') },
      ],
    });
    const [res] = evaluateCandidatesDeterministic(shift, [expiredWorker]);
    expect(res.eligible).toBe(false);
    expect(res.safetyBlocked).toBe(true);
    expect(res.canManualOverride).toBe(false);
    expect(res.exclusionReasons.some((r) => r.includes('AHPRA'))).toBe(true);
  });

  it('excludes overlapping shifts, rest-period breaches, overnight restrictions, and cross-tenant workers', () => {
    const shift = makeBaseShift();
    const wOverlap = makeBaseWorker({
      id: 'w-overlap',
      existingAssignments: [
        {
          shiftId: 'other-1',
          startAt: new Date('2026-06-15T10:00:00.000Z'),
          endAt: new Date('2026-06-15T14:00:00.000Z'),
          breakMinutes: 0,
          status: 'confirmed',
        },
      ],
    });
    const wRestViolation = makeBaseWorker({
      id: 'w-rest',
      existingAssignments: [
        {
          shiftId: 'other-2',
          startAt: new Date('2026-06-15T00:00:00.000Z'),
          endAt: new Date('2026-06-15T06:00:00.000Z'), // only 6h rest before 12:00Z (<10h minRestHours)
          breakMinutes: 30,
          status: 'confirmed',
        },
      ],
    });
    const wNoNights = makeBaseWorker({
      id: 'w-nonights',
      restrictions: { noNightShifts: true },
    });
    const wCrossTenant = makeBaseWorker({
      id: 'w-tenant-b',
      tenantId: 'tenant-b',
    });

    const results = evaluateCandidatesDeterministic(shift, [
      wOverlap,
      wRestViolation,
      wNoNights,
      wCrossTenant,
    ]);

    for (const r of results) {
      expect(r.eligible).toBe(false);
    }
    expect(results.find((r) => r.workerId === 'w-overlap')?.safetyBlocked).toBe(true);
    expect(results.find((r) => r.workerId === 'w-tenant-b')?.safetyBlocked).toBe(true);
    expect(results.find((r) => r.workerId === 'w-rest')?.exclusionReasons.join(' ')).toMatch(/rest/i);
    expect(results.find((r) => r.workerId === 'w-nonights')?.exclusionReasons.join(' ')).toMatch(/overnight/i);
  });

  it('excludes workers exceeding weekly working-hour caps while allowing audited override for non-clinical cap', () => {
    const shift = makeBaseShift();
    const wOverCap = makeBaseWorker({
      id: 'w-cap',
      maxWeeklyHours: 20,
      existingAssignments: [
        {
          shiftId: 's-prev-1',
          startAt: new Date('2026-06-13T00:00:00.000Z'),
          endAt: new Date('2026-06-13T16:30:00.000Z'), // 16h paid
          breakMinutes: 30,
          status: 'confirmed',
        },
      ],
    });

    const [res] = evaluateCandidatesDeterministic(shift, [wOverCap]);
    expect(res.eligible).toBe(false);
    expect(res.safetyBlocked).toBe(false);
    expect(res.canManualOverride).toBe(true);
    expect(res.exclusionReasons.join(' ')).toMatch(/weekly/i);
  });

  it('deterministically ranks eligible workers with transparent 100-point score breakdown', () => {
    const shift = makeBaseShift();
    const highFit = makeBaseWorker({
      id: 'w-high',
      firstName: 'Amelia',
      reliabilityScore: 98,
      recentShiftsCount: 1,
      approvedFacilities: [{ facilityId: 'fac-a', isPrimary: true, distanceKm: 3, approved: true }],
      skills: ['Dementia Care', 'Medication Administration'],
    });
    const lowerFit = makeBaseWorker({
      id: 'w-low',
      firstName: 'Jordan',
      reliabilityScore: 76,
      recentShiftsCount: 9,
      approvedFacilities: [{ facilityId: 'fac-a', isPrimary: false, distanceKm: 20, approved: true }],
      skills: [],
    });

    const results = evaluateCandidatesDeterministic(shift, [lowerFit, highFit]);
    expect(results[0].workerId).toBe('w-high');
    expect(results[0].rankOrder).toBe(1);
    expect(results[1].workerId).toBe('w-low');
    expect(results[1].rankOrder).toBe(2);
    expect(results[0].totalScore).toBeGreaterThan(results[1].totalScore);
    expect(results[0].inclusionReasons.length).toBeGreaterThan(0);
  });
});

describe('RBAC Permissions & Facility Scope Guardrails', () => {
  it('enforces least-privilege permissions across roles', () => {
    expect(hasPermission('org_owner', PERMISSIONS.BILLING_MANAGE)).toBe(true);
    expect(hasPermission('auditor', PERMISSIONS.AUDIT_VIEW)).toBe(true);
    expect(hasPermission('auditor', PERMISSIONS.SHIFTS_MANAGE)).toBe(false);
    expect(hasPermission('worker', PERMISSIONS.WORKER_SELF)).toBe(true);
    expect(hasPermission('worker', PERMISSIONS.SHIFTS_VIEW)).toBe(false);
    expect(hasPermission('workforce_coordinator', PERMISSIONS.AUTOPILOT_RUN)).toBe(true);
    expect(hasPermission('workforce_coordinator', PERMISSIONS.BILLING_MANAGE)).toBe(false);
  });

  it('restricts facility_manager strictly to assigned facility IDs', () => {
    expect(canAccessFacility('facility_manager', ['fac-a'], 'fac-a')).toBe(true);
    expect(canAccessFacility('facility_manager', ['fac-a'], 'fac-b')).toBe(false);
    expect(canAccessFacility('org_owner', [], 'fac-b')).toBe(true);
  });
});

describe('Australian Phone Validation, SSRF Webhook Protection & HMAC Replay Guard', () => {
  it('normalizes AU mobile numbers to +61 E.164 format and rejects invalid formats', () => {
    expect(normalizeAustralianPhone('0412 345 678')).toEqual({ valid: true, e164: '+61412345678' });
    expect(normalizeAustralianPhone('+61498765432')).toEqual({ valid: true, e164: '+61498765432' });
    expect(normalizeAustralianPhone('12345')).toMatchObject({ valid: false });
  });

  it('blocks localhost, loopback, and private RFC1918 webhook URLs (SSRF protection)', () => {
    expect(validateSafeWebhookUrl('https://payroll.provider.com.au/hooks').valid).toBe(true);
    expect(validateSafeWebhookUrl('http://localhost:3000/hook').valid).toBe(false);
    expect(validateSafeWebhookUrl('http://127.0.0.1/admin').valid).toBe(false);
    expect(validateSafeWebhookUrl('http://169.254.169.254/latest/meta-data').valid).toBe(false);
    expect(validateSafeWebhookUrl('http://10.0.0.8/internal').valid).toBe(false);
    expect(validateSafeWebhookUrl('http://192.168.1.50/hook').valid).toBe(false);
  });

  it('verifies valid HMAC-SHA256 timestamped signatures and rejects tampered or replayed requests', () => {
    const secret = 'whsec_test_secret_123456';
    const body = JSON.stringify({ event: 'shift.covered', shiftId: 's-1' });
    const nowSec = Math.floor(Date.now() / 1000);
    const sig = signWebhookPayload(body, secret, nowSec);

    expect(verifyWebhookSignature(body, sig, secret).valid).toBe(true);
    expect(verifyWebhookSignature(`${body}tampered`, sig, secret).valid).toBe(false);

    const staleSig = signWebhookPayload(body, secret, nowSec - 600);
    expect(verifyWebhookSignature(body, staleSig, secret, 300).valid).toBe(false);
  });
});
