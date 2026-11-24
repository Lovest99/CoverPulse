import type { RoleKey } from '../shared/types.ts';

export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard:view',
  SHIFTS_VIEW: 'shifts:view',
  SHIFTS_MANAGE: 'shifts:manage',
  SHIFTS_OVERRIDE: 'shifts:override',
  WORKERS_VIEW: 'workers:view',
  WORKERS_MANAGE: 'workers:manage',
  CREDENTIALS_REVIEW: 'credentials:review',
  FACILITIES_VIEW: 'facilities:view',
  FACILITIES_MANAGE: 'facilities:manage',
  POLICIES_VIEW: 'policies:view',
  POLICIES_MANAGE: 'policies:manage',
  AUTOPILOT_RUN: 'autopilot:run',
  ANALYTICS_VIEW: 'analytics:view',
  ANALYTICS_EXPORT: 'analytics:export',
  INTEGRATIONS_VIEW: 'integrations:view',
  INTEGRATIONS_MANAGE: 'integrations:manage',
  SETTINGS_VIEW: 'settings:view',
  SETTINGS_MANAGE: 'settings:manage',
  BILLING_VIEW: 'billing:view',
  BILLING_MANAGE: 'billing:manage',
  AUDIT_VIEW: 'audit:view',
  WORKER_SELF: 'worker:self',
  PLATFORM_ADMIN: 'platform:admin',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSION_MATRIX: Record<RoleKey, PermissionKey[]> = {
  platform_super_admin: Object.values(PERMISSIONS),
  org_owner: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.SHIFTS_VIEW,
    PERMISSIONS.SHIFTS_MANAGE,
    PERMISSIONS.SHIFTS_OVERRIDE,
    PERMISSIONS.WORKERS_VIEW,
    PERMISSIONS.WORKERS_MANAGE,
    PERMISSIONS.CREDENTIALS_REVIEW,
    PERMISSIONS.FACILITIES_VIEW,
    PERMISSIONS.FACILITIES_MANAGE,
    PERMISSIONS.POLICIES_VIEW,
    PERMISSIONS.POLICIES_MANAGE,
    PERMISSIONS.AUTOPILOT_RUN,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,
    PERMISSIONS.INTEGRATIONS_VIEW,
    PERMISSIONS.INTEGRATIONS_MANAGE,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.BILLING_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
  ],
  operations_manager: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.SHIFTS_VIEW,
    PERMISSIONS.SHIFTS_MANAGE,
    PERMISSIONS.SHIFTS_OVERRIDE,
    PERMISSIONS.WORKERS_VIEW,
    PERMISSIONS.WORKERS_MANAGE,
    PERMISSIONS.CREDENTIALS_REVIEW,
    PERMISSIONS.FACILITIES_VIEW,
    PERMISSIONS.POLICIES_VIEW,
    PERMISSIONS.POLICIES_MANAGE,
    PERMISSIONS.AUTOPILOT_RUN,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,
    PERMISSIONS.INTEGRATIONS_VIEW,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.AUDIT_VIEW,
  ],
  facility_manager: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.SHIFTS_VIEW,
    PERMISSIONS.SHIFTS_MANAGE,
    PERMISSIONS.SHIFTS_OVERRIDE,
    PERMISSIONS.WORKERS_VIEW,
    PERMISSIONS.CREDENTIALS_REVIEW,
    PERMISSIONS.FACILITIES_VIEW,
    PERMISSIONS.POLICIES_VIEW,
    PERMISSIONS.AUTOPILOT_RUN,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,
  ],
  workforce_coordinator: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.SHIFTS_VIEW,
    PERMISSIONS.SHIFTS_MANAGE,
    PERMISSIONS.WORKERS_VIEW,
    PERMISSIONS.FACILITIES_VIEW,
    PERMISSIONS.POLICIES_VIEW,
    PERMISSIONS.AUTOPILOT_RUN,
    PERMISSIONS.ANALYTICS_VIEW,
  ],
  worker: [PERMISSIONS.WORKER_SELF],
  auditor: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.SHIFTS_VIEW,
    PERMISSIONS.WORKERS_VIEW,
    PERMISSIONS.FACILITIES_VIEW,
    PERMISSIONS.POLICIES_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,
    PERMISSIONS.AUDIT_VIEW,
  ],
};

export function hasPermission(roleKey: RoleKey, permission: PermissionKey): boolean {
  const perms = ROLE_PERMISSION_MATRIX[roleKey] ?? [];
  return perms.includes(permission);
}

export function canAccessFacility(
  roleKey: RoleKey,
  permittedFacilityIds: string[],
  facilityId: string | null | undefined,
): boolean {
  if (!facilityId) return true;
  if (
    roleKey === 'platform_super_admin' ||
    roleKey === 'org_owner' ||
    roleKey === 'auditor'
  ) {
    return true;
  }
  if (permittedFacilityIds.length === 0) {
    // Empty array for operations_manager / workforce_coordinator means all facilities in tenant
    return roleKey === 'operations_manager' || roleKey === 'workforce_coordinator';
  }
  return permittedFacilityIds.includes(facilityId);
}
