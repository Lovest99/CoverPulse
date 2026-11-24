export type RoleKey =
  | 'platform_super_admin'
  | 'org_owner'
  | 'operations_manager'
  | 'facility_manager'
  | 'workforce_coordinator'
  | 'worker'
  | 'auditor';

export type ShiftStatus =
  | 'draft'
  | 'open'
  | 'broadcasting'
  | 'partially_covered'
  | 'covered'
  | 'cancelled'
  | 'expired';

export type ShiftUrgency = 'standard' | 'high' | 'critical';

export type DispatchMode = 'sequential' | 'tiered' | 'parallel_waves';

export type OfferStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'withdrawn'
  | 'failed'
  | 'bounced';

export const HEALTHCARE_ROLES = [
  'Registered Nurse (RN)',
  'Enrolled Nurse (EN)',
  'Personal Care Worker (PCW)',
  'Disability Support Worker (DSW)',
  'Community Care Worker (CCW)',
] as const;

export const ROLE_LABELS: Record<RoleKey, string> = {
  platform_super_admin: 'Platform Super Admin',
  org_owner: 'Organisation Owner',
  operations_manager: 'Operations Manager',
  facility_manager: 'Facility Manager',
  workforce_coordinator: 'Workforce Coordinator',
  worker: 'Worker',
  auditor: 'Auditor (Read-only)',
};

export const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  broadcasting: 'Broadcasting',
  partially_covered: 'Partially Covered',
  covered: 'Covered',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export interface ScoreBreakdown {
  facilityDistance: number;
  skillsFit: number;
  reliability: number;
  fairRotation: number;
}

export interface EligibilityEvaluationResult {
  workerId: string;
  workerName: string;
  primaryRole: string;
  employmentType: string;
  preferredChannel: string;
  eligible: boolean;
  canManualOverride: boolean;
  safetyBlocked: boolean;
  totalScore: number;
  scoreBreakdown: ScoreBreakdown;
  inclusionReasons: string[];
  exclusionReasons: string[];
  distanceKm: number | null;
  weeklyHoursScheduled: number;
  rankOrder: number | null;
}

export interface SessionContext {
  userId: string;
  uid: string;
  email: string;
  fullName: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  isDemoTenant: boolean;
  roleKey: RoleKey;
  permissions: string[];
  permittedFacilityIds: string[];
  workerId: string | null;
  isPlatformAdmin: boolean;
  authMode: 'firebase' | 'demo_session';
}
