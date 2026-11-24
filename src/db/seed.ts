import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditEvents,
  availabilityWindows,
  coveragePolicies,
  coverageRuns,
  facilities,
  integrations,
  invoiceReferences,
  memberships,
  notifications,
  offerEvents,
  permissions,
  planConfigs,
  qualificationEvidence,
  qualifications,
  rolePermissions,
  roles,
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
} from './schema.ts';
import { PERMISSIONS, ROLE_PERMISSION_MATRIX } from '../server/rbac.ts';
import { signWebhookPayload } from '../server/services/providers.ts';
import type { RoleKey } from '../shared/types.ts';

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

function daysFromNow(days: number, hour = 7, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

async function runSeed() {
  // Check if primary demo tenant already exists
  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, 'harbourview-care-demo'))
    .limit(1);

  if (existing.length > 0) {
    return;
  }

  console.log('[CoverPulse Seed] Seeding synthetic Australian healthcare demo data...');

  // 1. Seed Roles & Permissions
  const roleDefs: Array<{ key: RoleKey; name: string; description: string }> = [
    { key: 'platform_super_admin', name: 'Platform Super Admin', description: 'Manages tenant accounts, plan configuration, platform health, and audited support access.' },
    { key: 'org_owner', name: 'Organisation Owner', description: 'Manages organisation settings, facilities, billing, and users.' },
    { key: 'operations_manager', name: 'Operations Manager', description: 'Manages shifts, coverage policies, workers, reporting, and escalations.' },
    { key: 'facility_manager', name: 'Facility Manager', description: 'Manages shifts, workers, and credentials strictly for assigned facilities.' },
    { key: 'workforce_coordinator', name: 'Workforce Coordinator', description: 'Creates shifts, launches coverage offers, and confirms assignments.' },
    { key: 'worker', name: 'Worker', description: 'Maintains own availability, qualifications, profile, and responds to shift offers.' },
    { key: 'auditor', name: 'Auditor (Read-only)', description: 'Reviews authorised analytics, exports, and immutable audit logs without editing.' },
  ];

  const insertedRoles = await db
    .insert(roles)
    .values(roleDefs)
    .onConflictDoNothing()
    .returning();

  const allRoles = insertedRoles.length > 0 ? insertedRoles : await db.select().from(roles);
  const roleByKey = new Map(allRoles.map((r) => [r.key, r.id]));

  const permEntries = Object.values(PERMISSIONS).map((key) => ({
    key,
    description: `Permission for ${key.replace(':', ' ')}`,
  }));
  await db.insert(permissions).values(permEntries).onConflictDoNothing();
  const allPerms = await db.select().from(permissions);
  const permByKey = new Map(allPerms.map((p) => [p.key, p.id]));

  const rpValues: Array<{ roleId: string; permissionId: string }> = [];
  for (const [rKey, pList] of Object.entries(ROLE_PERMISSION_MATRIX)) {
    const rId = roleByKey.get(rKey);
    if (!rId) continue;
    for (const pKey of pList) {
      const pId = permByKey.get(pKey);
      if (pId) rpValues.push({ roleId: rId, permissionId: pId });
    }
  }
  if (rpValues.length > 0) {
    await db.insert(rolePermissions).values(rpValues).onConflictDoNothing();
  }

  // 2. Seed Configurable Plan Tiers (Platform Admin editable)
  await db
    .insert(planConfigs)
    .values([
      {
        tierKey: 'essential',
        displayName: 'Essential',
        targetAudience: 'For single-site or boutique community care teams',
        monthlyPriceAudCents: 49000,
        annualDiscountPct: 15,
        onboardingFeeAudCents: 120000,
        maxFacilities: 3,
        maxWorkers: 75,
        includedSmsPerMonth: 750,
        smsOverageCents: 14,
        featuresJson: [
          'Up to 3 facilities and 75 active workers',
          'Deterministic qualification & overlap matching',
          'In-app, email & Australian SMS shift offers',
          'Worker mobile-first PWA & availability calendar',
          'CSV import/export and 90-day audit retention',
        ],
      },
      {
        tierKey: 'growth',
        displayName: 'Growth',
        targetAudience: 'For multi-site aged care and NDIS providers',
        monthlyPriceAudCents: 119000,
        annualDiscountPct: 15,
        onboardingFeeAudCents: 240000,
        maxFacilities: 12,
        maxWorkers: 350,
        includedSmsPerMonth: 2500,
        smsOverageCents: 12,
        featuresJson: [
          'Up to 12 facilities and 350 active workers',
          'Tiered & parallel Coverage Autopilot with quiet hours',
          'Facility-scoped RBAC & audited manual override controls',
          'Signed webhooks, rostering adapters & custom analytics',
          'AI decision-support explanations & 7-year audit log',
        ],
      },
      {
        tierKey: 'enterprise',
        displayName: 'Enterprise',
        targetAudience: 'For regional & national care networks',
        monthlyPriceAudCents: 249000,
        annualDiscountPct: 18,
        onboardingFeeAudCents: 450000,
        maxFacilities: 100,
        maxWorkers: 2500,
        includedSmsPerMonth: 10000,
        smsOverageCents: 9,
        featuresJson: [
          'Up to 100 facilities and 2,500+ active workers',
          'Dedicated Australian region data residency options',
          'Custom HRIS/Payroll/SSO integration engineering',
          'Time-limited audited support elevation & SLA review',
          'Paid pilot onboarding & executive quarterly reviews',
        ],
      },
    ])
    .onConflictDoNothing();

  // 3. Create Primary Demo Tenant (Tenant A — Harbourview Care Group)
  const [tenantA] = await db
    .insert(tenants)
    .values({
      name: 'Harbourview Care Group (Demo)',
      slug: 'harbourview-care-demo',
      abn: '48 612 904 318',
      sector: 'Aged Care & Disability Support',
      state: 'NSW',
      timezone: 'Australia/Sydney',
      planTier: 'growth',
      status: 'active',
      isDemo: true,
      settingsJson: {
        defaultMaxWeeklyHours: 38,
        defaultMinRestHours: 10,
        agencyHourlyRateAud: 96,
        internalHourlyRateAud: 54,
        overtimeMultiplier: 1.5,
        retentionDays: 2555,
        quietHoursDefaultStart: '22:00',
        quietHoursDefaultEnd: '06:00',
        notificationTemplates: {
          smsOffer:
            'CoverPulse: {{role}} shift at {{facility}} on {{date}} ({{time}}). Reply in app within {{window}}m.',
          emailOfferSubject: 'Shift Offer: {{role}} at {{facility}} — {{date}}',
          escalationNotice:
            'Escalation: {{facility}} {{role}} shift remains uncovered after {{waves}} wave(s). Coordinator action required.',
        },
      },
    })
    .returning();

  // Create Isolated Second Demo Tenant (Tenant B — Southern Cross Community Care)
  const [tenantB] = await db
    .insert(tenants)
    .values({
      name: 'Southern Cross Community Care (Demo Tenant B)',
      slug: 'southern-cross-demo-b',
      abn: '91 402 881 704',
      sector: 'Community Care',
      state: 'VIC',
      timezone: 'Australia/Melbourne',
      planTier: 'essential',
      status: 'active',
      isDemo: true,
      settingsJson: {
        defaultMaxWeeklyHours: 38,
        defaultMinRestHours: 10,
        agencyHourlyRateAud: 92,
        internalHourlyRateAud: 52,
        overtimeMultiplier: 1.5,
        retentionDays: 1825,
        quietHoursDefaultStart: '21:30',
        quietHoursDefaultEnd: '06:30',
      },
    })
    .returning();

  // 4. Create Facilities for Tenant A (4 facilities) and Tenant B (1 facility)
  const [facBayside, facParramatta, facNorthShore, facIllawarra] = await db
    .insert(facilities)
    .values([
      {
        tenantId: tenantA.id,
        name: 'Bayside Gardens Aged Care',
        code: 'BGA-01',
        serviceType: 'Aged Care',
        address: '42 Gerrale Street',
        suburb: 'Cronulla',
        state: 'NSW',
        postcode: '2230',
        timezone: 'Australia/Sydney',
        phone: '+61 2 9523 4100',
        bedOrClientCapacity: 84,
      },
      {
        tenantId: tenantA.id,
        name: 'Parramatta Supported Living',
        code: 'PSL-02',
        serviceType: 'Disability Support',
        address: '118 Marsden Street',
        suburb: 'Parramatta',
        state: 'NSW',
        postcode: '2150',
        timezone: 'Australia/Sydney',
        phone: '+61 2 9635 8820',
        bedOrClientCapacity: 36,
      },
      {
        tenantId: tenantA.id,
        name: 'North Shore Community Care',
        code: 'NSC-03',
        serviceType: 'Community Care',
        address: '19 Help Street',
        suburb: 'Chatswood',
        state: 'NSW',
        postcode: '2067',
        timezone: 'Australia/Sydney',
        phone: '+61 2 9411 6300',
        bedOrClientCapacity: 145,
      },
      {
        tenantId: tenantA.id,
        name: 'Illawarra Coastal Lodge',
        code: 'ICL-04',
        serviceType: 'Aged Care',
        address: '75 Crown Street',
        suburb: 'Wollongong',
        state: 'NSW',
        postcode: '2500',
        timezone: 'Australia/Sydney',
        phone: '+61 2 4228 5190',
        bedOrClientCapacity: 62,
      },
    ])
    .returning();

  const [facTenantB] = await db
    .insert(facilities)
    .values([
      {
        tenantId: tenantB.id,
        name: 'Yarra Valley Home Support',
        code: 'YVH-01',
        serviceType: 'Community Care',
        address: '84 Main Street',
        suburb: 'Lilydale',
        state: 'VIC',
        postcode: '3140',
        timezone: 'Australia/Melbourne',
        phone: '+61 3 9735 2200',
        bedOrClientCapacity: 90,
      },
    ])
    .returning();

  // 5. Create Demo Users & Memberships for all 7 roles + Tenant B Worker
  const [
    userOwner,
    userOpsMgr,
    userFacMgr,
    userCoord,
    userWorkerChloe,
    userAuditor,
    userSuperAdmin,
    userTenantBWorker,
  ] = await db
    .insert(users)
    .values([
      {
        uid: 'demo-org-owner',
        email: 'claire.henderson@harbourview.demo.au',
        fullName: 'Claire Henderson',
        phone: '+61411200101',
        mfaEnabled: true,
        isPlatformAdmin: false,
      },
      {
        uid: 'demo-ops-manager',
        email: 'david.callaghan@harbourview.demo.au',
        fullName: 'David Callaghan',
        phone: '+61411200102',
        mfaEnabled: true,
        isPlatformAdmin: false,
      },
      {
        uid: 'demo-facility-manager',
        email: 'priya.nair@harbourview.demo.au',
        fullName: 'Priya Nair',
        phone: '+61411200103',
        mfaEnabled: true,
        isPlatformAdmin: false,
      },
      {
        uid: 'demo-coordinator',
        email: 'sam.whitaker@harbourview.demo.au',
        fullName: 'Sam Whitaker',
        phone: '+61411200104',
        mfaEnabled: false,
        isPlatformAdmin: false,
      },
      {
        uid: 'demo-worker-chloe',
        email: 'chloe.nguyen@harbourview.demo.au',
        fullName: 'Chloe Nguyen',
        phone: '+61422310401',
        mfaEnabled: false,
        isPlatformAdmin: false,
      },
      {
        uid: 'demo-auditor',
        email: 'helen.kerr@audit-assurance.demo.au',
        fullName: 'Helen Kerr',
        phone: '+61411200106',
        mfaEnabled: true,
        isPlatformAdmin: false,
      },
      {
        uid: 'demo-platform-admin',
        email: 'platform.ops@coverpulse.demo.au',
        fullName: 'Marcus Vance',
        phone: '+61411200100',
        mfaEnabled: true,
        isPlatformAdmin: true,
      },
      {
        uid: 'demo-tenant-b-worker',
        email: 'liam.connor@southerncross.demo.au',
        fullName: 'Liam Connor',
        phone: '+61433910200',
        mfaEnabled: false,
        isPlatformAdmin: false,
      },
    ])
    .returning();

  await db.insert(memberships).values([
    { tenantId: tenantA.id, userId: userOwner.id, roleKey: 'org_owner', permittedFacilityIds: [] },
    { tenantId: tenantA.id, userId: userOpsMgr.id, roleKey: 'operations_manager', permittedFacilityIds: [] },
    { tenantId: tenantA.id, userId: userFacMgr.id, roleKey: 'facility_manager', permittedFacilityIds: [facBayside.id] },
    { tenantId: tenantA.id, userId: userCoord.id, roleKey: 'workforce_coordinator', permittedFacilityIds: [facBayside.id, facParramatta.id, facNorthShore.id] },
    { tenantId: tenantA.id, userId: userWorkerChloe.id, roleKey: 'worker', permittedFacilityIds: [facBayside.id, facIllawarra.id] },
    { tenantId: tenantA.id, userId: userAuditor.id, roleKey: 'auditor', permittedFacilityIds: [] },
    { tenantId: tenantA.id, userId: userSuperAdmin.id, roleKey: 'platform_super_admin', permittedFacilityIds: [] },
    { tenantId: tenantB.id, userId: userTenantBWorker.id, roleKey: 'worker', permittedFacilityIds: [facTenantB.id] },
  ]);

  // 6. Create Qualifications for Tenant A & Tenant B
  const [qAhpraRn, qAhpraEn, qNdisWsc, qNpc, qFirstAid, qMedComp] = await db
    .insert(qualifications)
    .values([
      { tenantId: tenantA.id, code: 'AHPRA-RN', name: 'AHPRA Registered Nurse Registration', category: 'Registration', isMandatorySafety: true, defaultValidityDays: 365 },
      { tenantId: tenantA.id, code: 'AHPRA-EN', name: 'AHPRA Enrolled Nurse Registration', category: 'Registration', isMandatorySafety: true, defaultValidityDays: 365 },
      { tenantId: tenantA.id, code: 'NDIS-WSC', name: 'NDIS Worker Screening Check', category: 'Screening', isMandatorySafety: true, defaultValidityDays: 1825 },
      { tenantId: tenantA.id, code: 'NPC', name: 'National Police Check', category: 'Screening', isMandatorySafety: true, defaultValidityDays: 1095 },
      { tenantId: tenantA.id, code: 'FIRST-AID-CPR', name: 'HLTAID011 First Aid & Annual CPR', category: 'Safety', isMandatorySafety: true, defaultValidityDays: 365 },
      { tenantId: tenantA.id, code: 'MED-COMP', name: 'Medication Administration Competency', category: 'Clinical', isMandatorySafety: true, defaultValidityDays: 365 },
    ])
    .returning();

  const [qTenantBNpc] = await db
    .insert(qualifications)
    .values([
      { tenantId: tenantB.id, code: 'NPC', name: 'National Police Check', category: 'Screening', isMandatorySafety: true, defaultValidityDays: 1095 },
    ])
    .returning();

  // 7. Create 32 Fictional Australian Workers for Tenant A
  const syntheticWorkersSpec: Array<{
    firstName: string;
    lastName: string;
    role: string;
    empType: string;
    channel: string;
    suburbPostcode: string;
    travelKm: number;
    reliability: number;
    recentShifts: number;
    facs: Array<{ facId: string; primary: boolean; dist: number }>;
    skills: string[];
    availStatus?: string;
    noNights?: boolean;
    expiredQual?: 'AHPRA-RN' | 'FIRST-AID-CPR' | 'NDIS-WSC';
    expiringSoon?: boolean;
    userId?: string;
  }> = [
    // Registered Nurses (10 RNs — rich pool for RN Night Shift acceptance scenario!)
    { firstName: 'Chloe', lastName: 'Nguyen', role: 'Registered Nurse (RN)', empType: 'Permanent Part-Time', channel: 'in_app', suburbPostcode: '2230', travelKm: 25, reliability: 96, recentShifts: 2, facs: [{ facId: facBayside.id, primary: true, dist: 4 }, { facId: facIllawarra.id, primary: false, dist: 19 }], skills: ['Dementia Care', 'Wound Management', 'Palliative Care', 'IV Cannulation'], userId: userWorkerChloe.id },
    { firstName: 'Lachlan', lastName: 'Reid', role: 'Registered Nurse (RN)', empType: 'Casual', channel: 'sms', suburbPostcode: '2229', travelKm: 22, reliability: 92, recentShifts: 1, facs: [{ facId: facBayside.id, primary: true, dist: 6 }, { facId: facParramatta.id, primary: false, dist: 21 }], skills: ['Wound Management', 'Infection Control', 'Dementia Care'] },
    { firstName: 'Amina', lastName: 'Haddad', role: 'Registered Nurse (RN)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2224', travelKm: 30, reliability: 94, recentShifts: 3, facs: [{ facId: facBayside.id, primary: true, dist: 8 }, { facId: facNorthShore.id, primary: false, dist: 24 }], skills: ['Palliative Care', 'Catheter Care', 'Clinical Handover'] },
    { firstName: 'Grace', lastName: 'Okafor', role: 'Registered Nurse (RN)', empType: 'Casual', channel: 'email', suburbPostcode: '2232', travelKm: 20, reliability: 89, recentShifts: 2, facs: [{ facId: facBayside.id, primary: true, dist: 7 }, { facId: facIllawarra.id, primary: false, dist: 18 }], skills: ['Dementia Care', 'Falls Prevention', 'Medication Audit'] },
    { firstName: 'Benjamin', lastName: 'Kowalski', role: 'Registered Nurse (RN)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2228', travelKm: 18, reliability: 91, recentShifts: 4, facs: [{ facId: facBayside.id, primary: true, dist: 5 }], skills: ['Wound Management', 'Clinical Triage'], noNights: true },
    { firstName: 'Sienna', lastName: 'Patel', role: 'Registered Nurse (RN)', empType: 'Casual', channel: 'sms', suburbPostcode: '2230', travelKm: 25, reliability: 85, recentShifts: 2, facs: [{ facId: facBayside.id, primary: true, dist: 3 }], skills: ['Dementia Care', 'Palliative Care'], expiredQual: 'AHPRA-RN' },
    { firstName: 'Toby', lastName: 'McAllister', role: 'Registered Nurse (RN)', empType: 'Permanent Full-Time', channel: 'in_app', suburbPostcode: '2231', travelKm: 20, reliability: 90, recentShifts: 5, facs: [{ facId: facBayside.id, primary: true, dist: 6 }], skills: ['Wound Management', 'Dementia Care'], availStatus: 'unavailable' },
    { firstName: 'Mei-Ling', lastName: 'Zhou', role: 'Registered Nurse (RN)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2067', travelKm: 20, reliability: 95, recentShifts: 2, facs: [{ facId: facNorthShore.id, primary: true, dist: 4 }, { facId: facParramatta.id, primary: false, dist: 17 }], skills: ['Community Nursing', 'Wound Management', 'Diabetes Care'] },
    { firstName: 'Rohan', lastName: 'Deshmukh', role: 'Registered Nurse (RN)', empType: 'Casual', channel: 'sms', suburbPostcode: '2500', travelKm: 28, reliability: 88, recentShifts: 1, facs: [{ facId: facIllawarra.id, primary: true, dist: 5 }, { facId: facBayside.id, primary: false, dist: 25 }], skills: ['Palliative Care', 'Dementia Care', 'Infection Control'], expiringSoon: true },
    { firstName: 'Isla', lastName: 'MacLeod', role: 'Registered Nurse (RN)', empType: 'Permanent Part-Time', channel: 'email', suburbPostcode: '2150', travelKm: 25, reliability: 93, recentShifts: 3, facs: [{ facId: facParramatta.id, primary: true, dist: 5 }, { facId: facNorthShore.id, primary: false, dist: 18 }], skills: ['Complex Behaviour Support', 'Epilepsy Management', 'PEG Feeding'] },

    // Enrolled Nurses (6 ENs)
    { firstName: 'Hannah', lastName: 'Bates', role: 'Enrolled Nurse (EN)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2230', travelKm: 20, reliability: 91, recentShifts: 2, facs: [{ facId: facBayside.id, primary: true, dist: 5 }, { facId: facIllawarra.id, primary: false, dist: 19 }], skills: ['Medication Administration', 'Wound Dressing', 'Vital Signs'] },
    { firstName: 'Noah', lastName: 'Tuala', role: 'Enrolled Nurse (EN)', empType: 'Casual', channel: 'in_app', suburbPostcode: '2226', travelKm: 22, reliability: 87, recentShifts: 1, facs: [{ facId: facBayside.id, primary: true, dist: 9 }], skills: ['Dementia Care', 'Medication Administration'] },
    { firstName: 'Zara', lastName: 'Al-Mansoor', role: 'Enrolled Nurse (EN)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2500', travelKm: 20, reliability: 94, recentShifts: 3, facs: [{ facId: facIllawarra.id, primary: true, dist: 6 }, { facId: facBayside.id, primary: false, dist: 20 }], skills: ['Falls Prevention', 'Medication Administration'], expiringSoon: true },
    { firstName: 'Caleb', lastName: 'Donovan', role: 'Enrolled Nurse (EN)', empType: 'Casual', channel: 'sms', suburbPostcode: '2065', travelKm: 18, reliability: 84, recentShifts: 2, facs: [{ facId: facNorthShore.id, primary: true, dist: 5 }], skills: ['Community Nursing', 'Wound Dressing'] },
    { firstName: 'Priyanka', lastName: 'Sharma', role: 'Enrolled Nurse (EN)', empType: 'Permanent Part-Time', channel: 'email', suburbPostcode: '2150', travelKm: 25, reliability: 90, recentShifts: 2, facs: [{ facId: facParramatta.id, primary: true, dist: 4 }, { facId: facBayside.id, primary: false, dist: 22 }], skills: ['Medication Administration', 'Diabetes Care'] },
    { firstName: 'Owen', lastName: 'Gallagher', role: 'Enrolled Nurse (EN)', empType: 'Casual', channel: 'sms', suburbPostcode: '2229', travelKm: 15, reliability: 79, recentShifts: 4, facs: [{ facId: facBayside.id, primary: true, dist: 4 }], skills: ['Vital Signs'], expiredQual: 'FIRST-AID-CPR' },

    // Personal Care Workers (7 PCWs)
    { firstName: 'Tahlia', lastName: 'Vargas', role: 'Personal Care Worker (PCW)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2230', travelKm: 18, reliability: 93, recentShifts: 2, facs: [{ facId: facBayside.id, primary: true, dist: 4 }], skills: ['Manual Handling', 'Dementia Support', 'Personal Hygiene'] },
    { firstName: 'Jayden', lastName: 'Moriarty', role: 'Personal Care Worker (PCW)', empType: 'Casual', channel: 'in_app', suburbPostcode: '2232', travelKm: 24, reliability: 88, recentShifts: 1, facs: [{ facId: facBayside.id, primary: true, dist: 8 }, { facId: facIllawarra.id, primary: false, dist: 20 }], skills: ['Manual Handling', 'Meal Assistance'] },
    { firstName: 'Eleanor', lastName: 'Fletcher', role: 'Personal Care Worker (PCW)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2500', travelKm: 20, reliability: 95, recentShifts: 3, facs: [{ facId: facIllawarra.id, primary: true, dist: 4 }], skills: ['Dementia Support', 'Palliative Assistance', 'Manual Handling'] },
    { firstName: 'Kofi', lastName: 'Mensah', role: 'Personal Care Worker (PCW)', empType: 'Casual', channel: 'sms', suburbPostcode: '2502', travelKm: 25, reliability: 90, recentShifts: 2, facs: [{ facId: facIllawarra.id, primary: true, dist: 7 }, { facId: facBayside.id, primary: false, dist: 23 }], skills: ['Manual Handling', 'Hoist Transfer'] },
    { firstName: 'Ruby', lastName: 'Sinclair', role: 'Personal Care Worker (PCW)', empType: 'Permanent Part-Time', channel: 'email', suburbPostcode: '2228', travelKm: 15, reliability: 86, recentShifts: 3, facs: [{ facId: facBayside.id, primary: true, dist: 5 }], skills: ['Dementia Support', 'Activity Coordination'], expiringSoon: true },
    { firstName: 'Arjun', lastName: 'Kapoor', role: 'Personal Care Worker (PCW)', empType: 'Casual', channel: 'sms', suburbPostcode: '2225', travelKm: 22, reliability: 91, recentShifts: 2, facs: [{ facId: facBayside.id, primary: true, dist: 9 }, { facId: facParramatta.id, primary: false, dist: 19 }], skills: ['Hoist Transfer', 'Manual Handling'] },
    { firstName: 'Maya', lastName: 'Lindqvist', role: 'Personal Care Worker (PCW)', empType: 'Permanent Full-Time', channel: 'in_app', suburbPostcode: '2500', travelKm: 15, reliability: 92, recentShifts: 5, facs: [{ facId: facIllawarra.id, primary: true, dist: 3 }], skills: ['Dementia Support', 'Manual Handling'] },

    // Disability Support Workers (5 DSWs)
    { firstName: 'Jordan', lastName: 'Kemp', role: 'Disability Support Worker (DSW)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2150', travelKm: 22, reliability: 94, recentShifts: 2, facs: [{ facId: facParramatta.id, primary: true, dist: 3 }, { facId: facNorthShore.id, primary: false, dist: 18 }], skills: ['Positive Behaviour Support', 'Epilepsy Management', 'Community Access'] },
    { firstName: 'Fatima', lastName: 'El-Sayed', role: 'Disability Support Worker (DSW)', empType: 'Casual', channel: 'in_app', suburbPostcode: '2145', travelKm: 20, reliability: 91, recentShifts: 1, facs: [{ facId: facParramatta.id, primary: true, dist: 6 }], skills: ['PEG Feeding', 'Positive Behaviour Support', 'Manual Handling'] },
    { firstName: 'Declan', lastName: 'Byrne', role: 'Disability Support Worker (DSW)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2151', travelKm: 25, reliability: 89, recentShifts: 3, facs: [{ facId: facParramatta.id, primary: true, dist: 5 }, { facId: facNorthShore.id, primary: false, dist: 16 }], skills: ['Community Access', 'AAC Communication'] },
    { firstName: 'Keiko', lastName: 'Tanaka', role: 'Disability Support Worker (DSW)', empType: 'Casual', channel: 'email', suburbPostcode: '2148', travelKm: 20, reliability: 87, recentShifts: 2, facs: [{ facId: facParramatta.id, primary: true, dist: 9 }], skills: ['Positive Behaviour Support', 'Meal Assistance'], expiredQual: 'NDIS-WSC' },
    { firstName: 'Samuel', lastName: 'Adebayo', role: 'Disability Support Worker (DSW)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2150', travelKm: 18, reliability: 96, recentShifts: 2, facs: [{ facId: facParramatta.id, primary: true, dist: 4 }], skills: ['Epilepsy Management', 'PEG Feeding', 'Hoist Transfer'] },

    // Community Care Workers (4 CCWs)
    { firstName: 'Sophie', lastName: 'Maddox', role: 'Community Care Worker (CCW)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2067', travelKm: 25, reliability: 95, recentShifts: 2, facs: [{ facId: facNorthShore.id, primary: true, dist: 3 }], skills: ['In-Home Personal Care', 'Transport Support', 'Medication Prompting'] },
    { firstName: 'Mateo', lastName: 'Salazar', role: 'Community Care Worker (CCW)', empType: 'Casual', channel: 'in_app', suburbPostcode: '2069', travelKm: 30, reliability: 90, recentShifts: 1, facs: [{ facId: facNorthShore.id, primary: true, dist: 7 }, { facId: facParramatta.id, primary: false, dist: 19 }], skills: ['In-Home Personal Care', 'Respite Support'] },
    { firstName: 'Nadia', lastName: 'Khoury', role: 'Community Care Worker (CCW)', empType: 'Permanent Part-Time', channel: 'sms', suburbPostcode: '2066', travelKm: 22, reliability: 92, recentShifts: 3, facs: [{ facId: facNorthShore.id, primary: true, dist: 5 }], skills: ['Medication Prompting', 'Dementia Support'], expiringSoon: true },
    { firstName: 'Ethan', lastName: 'Walshe', role: 'Community Care Worker (CCW)', empType: 'Casual', channel: 'sms', suburbPostcode: '2070', travelKm: 25, reliability: 86, recentShifts: 2, facs: [{ facId: facNorthShore.id, primary: true, dist: 8 }], skills: ['Transport Support', 'Domestic Assistance'] },
  ];

  const insertedWorkers = await db
    .insert(workerProfiles)
    .values(
      syntheticWorkersSpec.map((w, idx) => ({
        tenantId: tenantA.id,
        userId: w.userId ?? null,
        firstName: w.firstName,
        lastName: w.lastName,
        email: `${w.firstName.toLowerCase()}.${w.lastName.toLowerCase().replace(/[^a-z]/g, '')}@harbourview.demo.au`,
        phone: `+61422310${String(401 + idx).padStart(3, '0')}`,
        primaryRole: w.role,
        employmentType: w.empType,
        preferredChannel: w.channel,
        travelRadiusKm: w.travelKm,
        postcode: w.suburbPostcode,
        maxWeeklyHours: w.empType === 'Permanent Full-Time' ? 38 : 34,
        minRestHours: 10,
        restrictionsJson: w.noNights ? { noNightShifts: true, notes: 'Day/evening shifts only per agreement' } : {},
        availabilityStatus: w.availStatus ?? 'available',
        reliabilityScore: w.reliability,
        recentShiftsCount: w.recentShifts,
        active: true,
      })),
    )
    .returning();

  // Populate worker_facilities, skills, qualifications, and availability windows
  const wfInserts: Array<typeof workerFacilities.$inferInsert> = [];
  const skillInserts: Array<typeof skills.$inferInsert> = [];
  const qualEvInserts: Array<typeof qualificationEvidence.$inferInsert> = [];
  const availInserts: Array<typeof availabilityWindows.$inferInsert> = [];

  insertedWorkers.forEach((worker, idx) => {
    const spec = syntheticWorkersSpec[idx];
    for (const f of spec.facs) {
      wfInserts.push({
        tenantId: tenantA.id,
        workerId: worker.id,
        facilityId: f.facId,
        isPrimary: f.primary,
        distanceKm: f.dist,
        approved: true,
      });
    }
    for (const sk of spec.skills) {
      skillInserts.push({
        tenantId: tenantA.id,
        workerId: worker.id,
        name: sk,
        level: 'experienced',
      });
    }

    // Standard availability windows Mon-Sun
    for (let day = 0; day <= 6; day++) {
      availInserts.push({
        tenantId: tenantA.id,
        workerId: worker.id,
        dayOfWeek: day,
        startTime: '06:00',
        endTime: '23:59',
        isAvailable: spec.availStatus !== 'unavailable',
      });
    }

    // Assign qualifications per role
    const addQual = (
      qualId: string,
      code: string,
      opts?: { expired?: boolean; expiringSoon?: boolean; pending?: boolean },
    ) => {
      const expiresAt = opts?.expired
        ? daysFromNow(-18)
        : opts?.expiringSoon
          ? daysFromNow(14)
          : daysFromNow(320);
      qualEvInserts.push({
        tenantId: tenantA.id,
        workerId: worker.id,
        qualificationId: qualId,
        referenceNumber: `${code}-${202600 + idx}`,
        issuedAt: daysFromNow(-300),
        expiresAt,
        reviewStatus: opts?.expired ? 'expired' : opts?.pending ? 'pending' : 'verified',
        reviewerUserId: userOpsMgr.id,
        reviewedAt: daysFromNow(-120),
        documentRef: `vault://harbourview-demo/${code.toLowerCase()}-${idx + 1}.pdf`,
      });
    };

    addQual(qNpc.id, 'NPC');
    addQual(qFirstAid.id, 'FIRST-AID-CPR', {
      expired: spec.expiredQual === 'FIRST-AID-CPR',
      expiringSoon: spec.expiringSoon,
    });

    if (spec.role === 'Registered Nurse (RN)') {
      addQual(qAhpraRn.id, 'AHPRA-RN', { expired: spec.expiredQual === 'AHPRA-RN' });
      addQual(qMedComp.id, 'MED-COMP');
    } else if (spec.role === 'Enrolled Nurse (EN)') {
      addQual(qAhpraEn.id, 'AHPRA-EN');
      addQual(qMedComp.id, 'MED-COMP');
    } else if (spec.role === 'Disability Support Worker (DSW)') {
      addQual(qNdisWsc.id, 'NDIS-WSC', { expired: spec.expiredQual === 'NDIS-WSC' });
    } else if (spec.role === 'Community Care Worker (CCW)') {
      addQual(qNdisWsc.id, 'NDIS-WSC');
    }
  });

  await db.insert(workerFacilities).values(wfInserts);
  await db.insert(skills).values(skillInserts);
  await db.insert(qualificationEvidence).values(qualEvInserts);
  await db.insert(availabilityWindows).values(availInserts);

  // Seed Tenant B Worker & Shift (for Tenant Isolation verification!)
  const [workerTenantB] = await db
    .insert(workerProfiles)
    .values({
      tenantId: tenantB.id,
      userId: userTenantBWorker.id,
      firstName: 'Liam',
      lastName: 'Connor',
      email: 'liam.connor@southerncross.demo.au',
      phone: '+61433910200',
      primaryRole: 'Community Care Worker (CCW)',
      employmentType: 'Permanent Part-Time',
      preferredChannel: 'in_app',
      travelRadiusKm: 25,
      postcode: '3140',
      maxWeeklyHours: 38,
      minRestHours: 10,
      availabilityStatus: 'available',
      reliabilityScore: 92,
      recentShiftsCount: 2,
    })
    .returning();

  await db.insert(workerFacilities).values({
    tenantId: tenantB.id,
    workerId: workerTenantB.id,
    facilityId: facTenantB.id,
    isPrimary: true,
    distanceKm: 4,
    approved: true,
  });

  await db.insert(qualificationEvidence).values({
    tenantId: tenantB.id,
    workerId: workerTenantB.id,
    qualificationId: qTenantBNpc.id,
    referenceNumber: 'NPC-VIC-8812',
    issuedAt: daysFromNow(-180),
    expiresAt: daysFromNow(540),
    reviewStatus: 'verified',
  });

  await db.insert(shifts).values({
    tenantId: tenantB.id,
    facilityId: facTenantB.id,
    title: 'Morning Home Support Run — Lilydale (Tenant B)',
    roleRequired: 'Community Care Worker (CCW)',
    shiftDate: daysFromNow(1).toISOString().slice(0, 10),
    startAt: daysFromNow(1, 7, 30),
    endAt: daysFromNow(1, 13, 30),
    breakMinutes: 30,
    headcount: 1,
    filledCount: 0,
    urgency: 'standard',
    status: 'open',
    isOvernight: false,
    hourlyRateCents: 4400,
    showRateToWorker: true,
    notes: 'Isolated Tenant B synthetic shift — invisible to Tenant A users.',
  });

  // 8. Create 3 Coverage Policies for Tenant A
  const [policyTiered, policySequential, policyParallel] = await db
    .insert(coveragePolicies)
    .values([
      {
        tenantId: tenantA.id,
        facilityId: null,
        name: 'Urgent Clinical Tiered Wave',
        description: 'Dispatches top 3 ranked eligible clinicians first, waits 15 mins, then expands up to 3 waves before escalating to Operations Manager.',
        dispatchMode: 'tiered',
        batchSize: 3,
        responseWindowMinutes: 15,
        quietHoursStart: '22:00',
        quietHoursEnd: '06:00',
        maxAttempts: 3,
        reminderAfterMinutes: 7,
        channelsJson: ['in_app', 'sms', 'email'],
        escalationRecipientRole: 'operations_manager',
        escalationRecipientEmail: 'david.callaghan@harbourview.demo.au',
        requireManagerConfirmation: false,
        active: true,
      },
      {
        tenantId: tenantA.id,
        facilityId: facBayside.id,
        name: 'Sequential Preferred Pool',
        description: 'Offers shifts one-by-one in strict fairness & primary-facility order with 20-minute response windows.',
        dispatchMode: 'sequential',
        batchSize: 1,
        responseWindowMinutes: 20,
        quietHoursStart: '21:30',
        quietHoursEnd: '06:30',
        maxAttempts: 4,
        reminderAfterMinutes: 10,
        channelsJson: ['in_app', 'sms'],
        escalationRecipientRole: 'facility_manager',
        escalationRecipientEmail: 'priya.nair@harbourview.demo.au',
        requireManagerConfirmation: false,
        active: true,
      },
      {
        tenantId: tenantA.id,
        facilityId: null,
        name: 'Critical Parallel Rapid Cover',
        description: 'Immediate parallel wave to up to 6 eligible workers across SMS, in-app, and email with manager confirmation optional.',
        dispatchMode: 'parallel_waves',
        batchSize: 6,
        responseWindowMinutes: 10,
        quietHoursStart: '23:00',
        quietHoursEnd: '05:00',
        maxAttempts: 2,
        reminderAfterMinutes: 5,
        channelsJson: ['sms', 'in_app', 'email'],
        escalationRecipientRole: 'operations_manager',
        escalationRecipientEmail: 'david.callaghan@harbourview.demo.au',
        requireManagerConfirmation: false,
        active: true,
      },
    ])
    .returning();

  // 9. Create 26 Realistic Shifts across 30 days (historical covered + upcoming active/open/broadcasting/escalated)
  const chloeWorker = insertedWorkers[0];
  const lachlanWorker = insertedWorkers[1];
  const aminaWorker = insertedWorkers[2];
  const graceWorker = insertedWorkers[3];
  const hannahWorker = insertedWorkers[10];
  const tahliWorker = insertedWorkers[16];
  const jordanWorker = insertedWorkers[23];
  const sophieWorker = insertedWorkers[28];

  // Key live operational shifts (next 0–4 days)
  const [shiftUrgentRnNight, shiftBroadcastingRn, shiftEscalatedDsw, shiftOpenPcw, shiftPartialEn, shiftDraftCcw] =
    await db
      .insert(shifts)
      .values([
        {
          tenantId: tenantA.id,
          facilityId: facBayside.id,
          title: 'Urgent RN Night Duty — Wing B Memory Support',
          roleRequired: 'Registered Nurse (RN)',
          shiftDate: daysFromNow(1).toISOString().slice(0, 10),
          startAt: daysFromNow(1, 12, 0), // 22:00 AEST (UTC+10 -> 12:00 UTC)
          endAt: daysFromNow(1, 20, 30), // 06:30 AEST next morning
          breakMinutes: 30,
          headcount: 1,
          filledCount: 0,
          urgency: 'critical',
          status: 'open',
          isOvernight: true,
          hourlyRateCents: 6850,
          showRateToWorker: true,
          requiresManagerConfirmation: false,
          notes: 'Overnight clinical lead covering 42 memory-support residents. Verified AHPRA-RN and First Aid/CPR mandatory.',
          createdByUserId: userFacMgr.id,
          publishedAt: new Date(Date.now() - 25 * 60000),
        },
        {
          tenantId: tenantA.id,
          facilityId: facBayside.id,
          title: 'Afternoon RN Medication Round — Bayside Wing A',
          roleRequired: 'Registered Nurse (RN)',
          shiftDate: daysFromNow(2).toISOString().slice(0, 10),
          startAt: daysFromNow(2, 4, 0),
          endAt: daysFromNow(2, 12, 0),
          breakMinutes: 30,
          headcount: 1,
          filledCount: 0,
          urgency: 'high',
          status: 'broadcasting',
          isOvernight: false,
          hourlyRateCents: 6100,
          showRateToWorker: true,
          requiresManagerConfirmation: false,
          notes: 'PM medication round and clinical handover with evening team.',
          createdByUserId: userCoord.id,
          publishedAt: new Date(Date.now() - 40 * 60000),
        },
        {
          tenantId: tenantA.id,
          facilityId: facParramatta.id,
          title: 'SIL Complex Support Evening — Parramatta House 2',
          roleRequired: 'Disability Support Worker (DSW)',
          shiftDate: daysFromNow(1).toISOString().slice(0, 10),
          startAt: daysFromNow(1, 5, 0),
          endAt: daysFromNow(1, 12, 0),
          breakMinutes: 30,
          headcount: 1,
          filledCount: 0,
          urgency: 'critical',
          status: 'open',
          isOvernight: false,
          hourlyRateCents: 4850,
          showRateToWorker: true,
          notes: 'High-intensity participant support requiring current NDIS Worker Screening and epilepsy response.',
          createdByUserId: userOpsMgr.id,
          publishedAt: new Date(Date.now() - 95 * 60000),
          escalatedAt: new Date(Date.now() - 12 * 60000),
          escalationReason: 'All 2 waves exhausted without acceptance — escalated to Operations Manager (David Callaghan).',
        },
        {
          tenantId: tenantA.id,
          facilityId: facIllawarra.id,
          title: 'Morning Personal Care — Illawarra Coastal East',
          roleRequired: 'Personal Care Worker (PCW)',
          shiftDate: daysFromNow(2).toISOString().slice(0, 10),
          startAt: daysFromNow(1, 21, 0),
          endAt: daysFromNow(2, 5, 0),
          breakMinutes: 30,
          headcount: 2,
          filledCount: 0,
          urgency: 'high',
          status: 'open',
          isOvernight: false,
          hourlyRateCents: 4100,
          showRateToWorker: true,
          notes: 'Morning ADLs, hoist transfers, and breakfast support.',
          createdByUserId: userCoord.id,
          publishedAt: new Date(Date.now() - 50 * 60000),
        },
        {
          tenantId: tenantA.id,
          facilityId: facBayside.id,
          title: 'Weekend EN Clinical Support — Bayside',
          roleRequired: 'Enrolled Nurse (EN)',
          shiftDate: daysFromNow(3).toISOString().slice(0, 10),
          startAt: daysFromNow(2, 21, 0),
          endAt: daysFromNow(3, 5, 0),
          breakMinutes: 30,
          headcount: 2,
          filledCount: 1,
          urgency: 'standard',
          status: 'partially_covered',
          isOvernight: false,
          hourlyRateCents: 5100,
          showRateToWorker: true,
          notes: '1 of 2 positions filled; seeking second EN for morning clinical observations.',
          createdByUserId: userFacMgr.id,
          publishedAt: new Date(Date.now() - 120 * 60000),
          firstResponseAt: new Date(Date.now() - 106 * 60000),
        },
        {
          tenantId: tenantA.id,
          facilityId: facNorthShore.id,
          title: 'Community Home Care Morning Route — Chatswood',
          roleRequired: 'Community Care Worker (CCW)',
          shiftDate: daysFromNow(4).toISOString().slice(0, 10),
          startAt: daysFromNow(3, 22, 0),
          endAt: daysFromNow(4, 4, 0),
          breakMinutes: 30,
          headcount: 1,
          filledCount: 0,
          urgency: 'standard',
          status: 'draft',
          isOvernight: false,
          hourlyRateCents: 4300,
          showRateToWorker: true,
          notes: 'Draft route awaiting final client visit sequence confirmation.',
          createdByUserId: userCoord.id,
        },
      ])
      .returning();

  // Add shift requirements to active shifts
  await db.insert(shiftRequirements).values([
    { tenantId: tenantA.id, shiftId: shiftUrgentRnNight.id, qualificationId: qAhpraRn.id, isMandatory: true },
    { tenantId: tenantA.id, shiftId: shiftUrgentRnNight.id, qualificationId: qFirstAid.id, isMandatory: true },
    { tenantId: tenantA.id, shiftId: shiftUrgentRnNight.id, requiredSkillName: 'Dementia Care', isMandatory: false },
    { tenantId: tenantA.id, shiftId: shiftBroadcastingRn.id, qualificationId: qAhpraRn.id, isMandatory: true },
    { tenantId: tenantA.id, shiftId: shiftBroadcastingRn.id, qualificationId: qMedComp.id, isMandatory: true },
    { tenantId: tenantA.id, shiftId: shiftEscalatedDsw.id, qualificationId: qNdisWsc.id, isMandatory: true },
    { tenantId: tenantA.id, shiftId: shiftEscalatedDsw.id, requiredSkillName: 'Epilepsy Management', isMandatory: false },
    { tenantId: tenantA.id, shiftId: shiftOpenPcw.id, qualificationId: qNpc.id, isMandatory: true },
    { tenantId: tenantA.id, shiftId: shiftPartialEn.id, qualificationId: qAhpraEn.id, isMandatory: true },
  ]);

  // Add confirmed assignment for the partially covered EN shift
  await db.insert(shiftAssignments).values({
    tenantId: tenantA.id,
    facilityId: facBayside.id,
    shiftId: shiftPartialEn.id,
    workerId: hannahWorker.id,
    status: 'confirmed',
    confirmedAt: new Date(Date.now() - 90 * 60000),
  });

  // Add an upcoming confirmed shift for Chloe Nguyen (day +3) so Worker PWA shows upcoming shifts too
  const [shiftChloeUpcoming] = await db
    .insert(shifts)
    .values({
      tenantId: tenantA.id,
      facilityId: facBayside.id,
      title: 'Morning RN Clinical Floor — Bayside Wing A',
      roleRequired: 'Registered Nurse (RN)',
      shiftDate: daysFromNow(3).toISOString().slice(0, 10),
      startAt: daysFromNow(2, 21, 0),
      endAt: daysFromNow(3, 5, 0),
      breakMinutes: 30,
      headcount: 1,
      filledCount: 1,
      urgency: 'standard',
      status: 'covered',
      isOvernight: false,
      hourlyRateCents: 6000,
      showRateToWorker: true,
      notes: 'Standard morning clinical shift and resident care reviews.',
      createdByUserId: userFacMgr.id,
      publishedAt: daysFromNow(-1, 2, 0),
      firstResponseAt: daysFromNow(-1, 2, 9),
      filledAt: daysFromNow(-1, 2, 14),
    })
    .returning();

  await db.insert(shiftAssignments).values({
    tenantId: tenantA.id,
    facilityId: facBayside.id,
    shiftId: shiftChloeUpcoming.id,
    workerId: chloeWorker.id,
    status: 'confirmed',
    confirmedAt: daysFromNow(-1, 2, 14),
  });

  // Active broadcasting coverage run + pending offers (including for Chloe Nguyen!)
  const [activeRun] = await db
    .insert(coverageRuns)
    .values({
      tenantId: tenantA.id,
      facilityId: facBayside.id,
      shiftId: shiftBroadcastingRn.id,
      policyId: policyTiered.id,
      status: 'running',
      currentWave: 1,
      totalWaves: 2,
      attemptsCount: 1,
      startedByUserId: userCoord.id,
      startedAt: new Date(Date.now() - 18 * 60000),
    })
    .returning();

  const [offerChloe, offerLachlan, offerAmina] = await db
    .insert(shiftOffers)
    .values([
      {
        tenantId: tenantA.id,
        facilityId: facBayside.id,
        shiftId: shiftBroadcastingRn.id,
        runId: activeRun.id,
        workerId: chloeWorker.id,
        waveNumber: 1,
        channel: 'in_app',
        status: 'delivered',
        idempotencyKey: `seed-offer-chloe-${shiftBroadcastingRn.id}`,
        sentAt: new Date(Date.now() - 18 * 60000),
        expiresAt: new Date(Date.now() + 180 * 60000),
      },
      {
        tenantId: tenantA.id,
        facilityId: facBayside.id,
        shiftId: shiftBroadcastingRn.id,
        runId: activeRun.id,
        workerId: lachlanWorker.id,
        waveNumber: 1,
        channel: 'sms',
        status: 'sent',
        idempotencyKey: `seed-offer-lachlan-${shiftBroadcastingRn.id}`,
        sentAt: new Date(Date.now() - 18 * 60000),
        expiresAt: new Date(Date.now() + 180 * 60000),
      },
      {
        tenantId: tenantA.id,
        facilityId: facBayside.id,
        shiftId: shiftBroadcastingRn.id,
        runId: activeRun.id,
        workerId: aminaWorker.id,
        waveNumber: 1,
        channel: 'sms',
        status: 'sent',
        idempotencyKey: `seed-offer-amina-${shiftBroadcastingRn.id}`,
        sentAt: new Date(Date.now() - 18 * 60000),
        expiresAt: new Date(Date.now() + 180 * 60000),
      },
    ])
    .returning();

  await db.insert(offerEvents).values([
    {
      tenantId: tenantA.id,
      shiftId: shiftBroadcastingRn.id,
      eventType: 'autopilot_started',
      summary: 'Coverage Autopilot started with "Urgent Clinical Tiered Wave" (3 Wave 1 offers dispatched).',
      createdAt: new Date(Date.now() - 18 * 60000),
    },
    {
      tenantId: tenantA.id,
      shiftId: shiftBroadcastingRn.id,
      offerId: offerChloe.id,
      eventType: 'offer_delivered',
      channel: 'in_app',
      summary: 'Wave 1 offer delivered to Chloe Nguyen via IN_APP.',
      createdAt: new Date(Date.now() - 18 * 60000),
    },
    {
      tenantId: tenantA.id,
      shiftId: shiftBroadcastingRn.id,
      offerId: offerLachlan.id,
      eventType: 'offer_sent',
      channel: 'sms',
      summary: 'Wave 1 offer queued in AU SMS sandbox for Lachlan Reid (+61422310402).',
      createdAt: new Date(Date.now() - 18 * 60000),
    },
    {
      tenantId: tenantA.id,
      shiftId: shiftBroadcastingRn.id,
      offerId: offerAmina.id,
      eventType: 'offer_sent',
      channel: 'sms',
      summary: 'Wave 1 offer queued in AU SMS sandbox for Amina Haddad (+61422310403).',
      createdAt: new Date(Date.now() - 18 * 60000),
    },
    {
      tenantId: tenantA.id,
      shiftId: shiftUrgentRnNight.id,
      eventType: 'shift_published',
      summary: 'Urgent RN Night Duty published by Priya Nair (Bayside Gardens Aged Care). Ready for Coverage Autopilot.',
      createdAt: new Date(Date.now() - 25 * 60000),
    },
    {
      tenantId: tenantA.id,
      shiftId: shiftEscalatedDsw.id,
      eventType: 'wave_escalated',
      summary: 'Coverage escalated to Operations Manager (david.callaghan@harbourview.demo.au) after 2 waves received no acceptance.',
      createdAt: new Date(Date.now() - 12 * 60000),
    },
  ]);

  // Seed 20 historical shifts across the past 28 days for authentic 30-day analytics!
  const historicalSpecs = [
    { dayOffset: -26, fac: facBayside, role: 'Registered Nurse (RN)', status: 'covered', firstRespMin: 8, fillMin: 19, worker: chloeWorker, channel: 'in_app' },
    { dayOffset: -24, fac: facParramatta, role: 'Disability Support Worker (DSW)', status: 'covered', firstRespMin: 11, fillMin: 24, worker: jordanWorker, channel: 'sms' },
    { dayOffset: -22, fac: facNorthShore, role: 'Community Care Worker (CCW)', status: 'covered', firstRespMin: 9, fillMin: 21, worker: sophieWorker, channel: 'sms' },
    { dayOffset: -20, fac: facIllawarra, role: 'Personal Care Worker (PCW)', status: 'covered', firstRespMin: 14, fillMin: 31, worker: tahliWorker, channel: 'sms' },
    { dayOffset: -19, fac: facBayside, role: 'Enrolled Nurse (EN)', status: 'covered', firstRespMin: 7, fillMin: 16, worker: hannahWorker, channel: 'in_app' },
    { dayOffset: -17, fac: facBayside, role: 'Registered Nurse (RN)', status: 'expired', firstRespMin: 22, fillMin: null, worker: null, channel: 'sms' },
    { dayOffset: -16, fac: facParramatta, role: 'Disability Support Worker (DSW)', status: 'covered', firstRespMin: 6, fillMin: 14, worker: jordanWorker, channel: 'sms' },
    { dayOffset: -14, fac: facNorthShore, role: 'Community Care Worker (CCW)', status: 'covered', firstRespMin: 10, fillMin: 23, worker: sophieWorker, channel: 'in_app' },
    { dayOffset: -13, fac: facBayside, role: 'Registered Nurse (RN)', status: 'covered', firstRespMin: 5, fillMin: 12, worker: lachlanWorker, channel: 'sms' },
    { dayOffset: -11, fac: facIllawarra, role: 'Personal Care Worker (PCW)', status: 'covered', firstRespMin: 12, fillMin: 27, worker: tahliWorker, channel: 'email' },
    { dayOffset: -10, fac: facBayside, role: 'Registered Nurse (RN)', status: 'covered', firstRespMin: 6, fillMin: 15, worker: aminaWorker, channel: 'sms' },
    { dayOffset: -9, fac: facParramatta, role: 'Disability Support Worker (DSW)', status: 'cancelled', firstRespMin: 9, fillMin: null, worker: null, channel: 'sms' },
    { dayOffset: -8, fac: facNorthShore, role: 'Community Care Worker (CCW)', status: 'covered', firstRespMin: 8, fillMin: 18, worker: sophieWorker, channel: 'in_app' },
    { dayOffset: -6, fac: facBayside, role: 'Enrolled Nurse (EN)', status: 'covered', firstRespMin: 7, fillMin: 15, worker: hannahWorker, channel: 'sms' },
    { dayOffset: -5, fac: facIllawarra, role: 'Personal Care Worker (PCW)', status: 'covered', firstRespMin: 11, fillMin: 22, worker: tahliWorker, channel: 'sms' },
    { dayOffset: -4, fac: facBayside, role: 'Registered Nurse (RN)', status: 'covered', firstRespMin: 4, fillMin: 11, worker: graceWorker, channel: 'email' },
    { dayOffset: -3, fac: facParramatta, role: 'Disability Support Worker (DSW)', status: 'covered', firstRespMin: 6, fillMin: 14, worker: jordanWorker, channel: 'sms' },
    { dayOffset: -2, fac: facNorthShore, role: 'Community Care Worker (CCW)', status: 'covered', firstRespMin: 5, fillMin: 13, worker: sophieWorker, channel: 'in_app' },
    { dayOffset: -1, fac: facBayside, role: 'Registered Nurse (RN)', status: 'covered', firstRespMin: 6, fillMin: 16, worker: chloeWorker, channel: 'in_app' },
    { dayOffset: -1, fac: facIllawarra, role: 'Personal Care Worker (PCW)', status: 'covered', firstRespMin: 9, fillMin: 20, worker: tahliWorker, channel: 'sms' },
  ];

  for (let i = 0; i < historicalSpecs.length; i++) {
    const hs = historicalSpecs[i];
    const startAt = daysFromNow(hs.dayOffset, 7, 0);
    const endAt = daysFromNow(hs.dayOffset, 15, 0);
    const pubAt = new Date(startAt.getTime() - 18 * 3600000);
    const firstRespAt = new Date(pubAt.getTime() + hs.firstRespMin * 60000);
    const filledAt = hs.fillMin ? new Date(pubAt.getTime() + hs.fillMin * 60000) : null;

    const [histShift] = await db
      .insert(shifts)
      .values({
        tenantId: tenantA.id,
        facilityId: hs.fac.id,
        title: `${hs.role.split(' (')[0]} Shift — ${hs.fac.suburb}`,
        roleRequired: hs.role,
        shiftDate: startAt.toISOString().slice(0, 10),
        startAt,
        endAt,
        breakMinutes: 30,
        headcount: 1,
        filledCount: hs.status === 'covered' ? 1 : 0,
        urgency: i % 4 === 0 ? 'high' : 'standard',
        status: hs.status,
        isOvernight: false,
        hourlyRateCents: hs.role.includes('RN') ? 6100 : 4400,
        showRateToWorker: true,
        createdByUserId: userCoord.id,
        publishedAt: pubAt,
        firstResponseAt: firstRespAt,
        filledAt,
      })
      .returning();

    if (hs.worker && hs.status === 'covered') {
      const [histOffer] = await db
        .insert(shiftOffers)
        .values({
          tenantId: tenantA.id,
          facilityId: hs.fac.id,
          shiftId: histShift.id,
          workerId: hs.worker.id,
          waveNumber: 1,
          channel: hs.channel,
          status: 'accepted',
          idempotencyKey: `seed-hist-offer-${i}-${histShift.id}`,
          sentAt: pubAt,
          expiresAt: new Date(pubAt.getTime() + 1800000),
          respondedAt: filledAt!,
          responseLatencySec: hs.fillMin! * 60,
        })
        .returning();

      await db.insert(shiftAssignments).values({
        tenantId: tenantA.id,
        facilityId: hs.fac.id,
        shiftId: histShift.id,
        workerId: hs.worker.id,
        offerId: histOffer.id,
        status: 'completed',
        confirmedAt: filledAt!,
      });
    }
  }

  // 10. Seed Integrations, Webhooks, Subscriptions, Invoices, Notifications, Support Grant, Audit Trail
  await db.insert(integrations).values([
    {
      tenantId: tenantA.id,
      category: 'rostering',
      providerName: 'Deputy Rostering Adapter',
      status: 'sandbox',
      description: 'Syncs open roster vacancies and writes back confirmed shift assignments via signed webhook contract.',
      configJson: { syncMode: 'webhook_and_csv', region: 'ap-southeast-2' },
      lastSyncAt: new Date(Date.now() - 45 * 60000),
    },
    {
      tenantId: tenantA.id,
      category: 'hris',
      providerName: 'Employment Hero HRIS Adapter',
      status: 'disconnected',
      description: 'Imports worker profiles, employment types, and credential expiry dates. Connect API credentials or use CSV import.',
      configJson: { requiresSetup: true },
    },
    {
      tenantId: tenantA.id,
      category: 'payroll',
      providerName: 'Xero Payroll AU Export',
      status: 'sandbox',
      description: 'Generates SCHADS & Nurses Award-aligned confirmed shift timesheet CSV exports for payroll reconciliation.',
      configJson: { format: 'AU-CSV-v2' },
      lastSyncAt: daysFromNow(-2, 8, 0),
    },
    {
      tenantId: tenantA.id,
      category: 'identity',
      providerName: 'Firebase / Google SSO',
      status: 'connected',
      description: 'Active identity provider verifying user authentication tokens with MFA-ready session enforcement.',
      configJson: { provider: 'google_oidc' },
      lastSyncAt: new Date(),
    },
    {
      tenantId: tenantA.id,
      category: 'sms',
      providerName: 'Australian SMS Gateway (MessageMedia / Twilio AU)',
      status: process.env.SMS_PROVIDER_API_KEY ? 'connected' : 'disconnected',
      description: 'Delivers +61 E.164 shift offers and escalation alerts. Operates in auditable sandbox mode until SMS_PROVIDER_API_KEY is configured.',
      configJson: { countryCode: '+61', quietHoursEnforced: true },
    },
    {
      tenantId: tenantA.id,
      category: 'email',
      providerName: 'Transactional Email Adapter (Postmark / SES)',
      status: process.env.EMAIL_PROVIDER_API_KEY ? 'connected' : 'disconnected',
      description: 'Delivers shift offer digests, credential expiry reminders, and audit export notices.',
      configJson: { senderDomain: 'coverpulse.example.com.au' },
    },
  ]);

  const sampleWebhookSecret = 'whsec_demo_sandbox_signing_key_harbourview';
  const [whEndpoint] = await db
    .insert(webhookEndpoints)
    .values({
      tenantId: tenantA.id,
      url: 'https://sandbox-rostering.example.com.au/webhooks/coverpulse',
      description: 'Sandbox Rostering Write-Back Listener',
      eventsJson: ['shift.covered', 'shift.escalated', 'offer.accepted', 'credential.expiring'],
      signingSecretHash: crypto.createHash('sha256').update(sampleWebhookSecret).digest('hex'),
      signingSecretPreview: 'whsec_••••view',
      active: true,
    })
    .returning();

  const samplePayload = {
    event: 'shift.covered',
    tenantId: tenantA.id,
    shiftId: shiftChloeUpcoming.id,
    facilityCode: 'BGA-01',
    coveredAt: new Date().toISOString(),
  };
  const tsSec = Math.floor(Date.now() / 1000);
  await db.insert(webhookDeliveries).values({
    tenantId: tenantA.id,
    endpointId: whEndpoint.id,
    eventType: 'shift.covered',
    idempotencyKey: `wh_seed_${shiftChloeUpcoming.id}`,
    payloadJson: samplePayload,
    signatureHeader: signWebhookPayload(JSON.stringify(samplePayload), sampleWebhookSecret, tsSec),
    status: 'delivered',
    httpStatus: 200,
    attempts: 1,
  });

  const [subA] = await db
    .insert(subscriptions)
    .values({
      tenantId: tenantA.id,
      planTier: 'growth',
      billingCycle: 'monthly',
      status: 'active',
      monthlyPriceCents: 119000,
      onboardingFeeCents: 240000,
      includedFacilities: 12,
      includedWorkers: 350,
      includedSms: 2500,
      smsUsedThisPeriod: 684,
      currentPeriodEnd: daysFromNow(18),
      externalCustomerId: 'cus_demo_harbourview_au',
    })
    .returning();

  await db.insert(invoiceReferences).values([
    {
      tenantId: tenantA.id,
      subscriptionId: subA.id,
      invoiceNumber: 'CP-2026-1042',
      periodLabel: 'Oct 2026',
      subscriptionCents: 119000,
      smsUsageCents: 0,
      integrationCents: 0,
      totalCents: 119000,
      status: 'paid',
      issuedAt: daysFromNow(-30),
    },
    {
      tenantId: tenantA.id,
      subscriptionId: subA.id,
      invoiceNumber: 'CP-2026-1118',
      periodLabel: 'Nov 2026',
      subscriptionCents: 119000,
      smsUsageCents: 1840,
      integrationCents: 0,
      totalCents: 120840,
      status: 'paid',
      issuedAt: daysFromNow(-2),
    },
  ]);

  await db.insert(notifications).values([
    {
      tenantId: tenantA.id,
      title: 'Escalation required: SIL Complex Support Evening',
      body: 'Parramatta Supported Living shift remains open after 2 waves. Coordinator review required.',
      category: 'escalation',
      linkPath: `/shifts/${shiftEscalatedDsw.id}`,
    },
    {
      tenantId: tenantA.id,
      title: '3 worker credentials expired, 4 expiring within 30 days',
      body: 'Expired AHPRA-RN, HLTAID011 CPR, and NDIS Worker Screening checks automatically exclude affected workers from clinical shifts.',
      category: 'credential',
      linkPath: '/workforce',
    },
    {
      tenantId: tenantA.id,
      workerId: chloeWorker.id,
      title: 'New shift offer: Afternoon RN Medication Round',
      body: 'Bayside Gardens Aged Care · Respond in CoverPulse Worker App.',
      category: 'coverage',
      linkPath: `/worker/offers/${offerChloe.id}`,
    },
  ]);

  await db.insert(supportAccessGrants).values({
    tenantId: tenantA.id,
    grantedByUserId: userOwner.id,
    supportUserEmail: 'platform.ops@coverpulse.demo.au',
    reason: 'Initial onboarding check for Bayside Gardens policy configuration',
    expiresAt: daysFromNow(2),
  });

  await db.insert(auditEvents).values([
    {
      tenantId: tenantA.id,
      facilityId: facBayside.id,
      actorUserId: userFacMgr.id,
      actorEmail: userFacMgr.email,
      actorRole: 'facility_manager',
      action: 'shift.created',
      entityType: 'shift',
      entityId: shiftUrgentRnNight.id,
      summary: 'Created urgent overnight RN shift at Bayside Gardens Aged Care (Wing B Memory Support).',
      metadataJson: { urgency: 'critical', isOvernight: true },
    },
    {
      tenantId: tenantA.id,
      facilityId: facBayside.id,
      actorUserId: userCoord.id,
      actorEmail: userCoord.email,
      actorRole: 'workforce_coordinator',
      action: 'autopilot.started',
      entityType: 'coverage_run',
      entityId: activeRun.id,
      summary: 'Started Urgent Clinical Tiered Wave on Afternoon RN Medication Round (3 Wave 1 offers dispatched).',
      metadataJson: { policyId: policyTiered.id, wave: 1 },
    },
    {
      tenantId: tenantA.id,
      facilityId: facParramatta.id,
      actorUserId: userOpsMgr.id,
      actorEmail: userOpsMgr.email,
      actorRole: 'operations_manager',
      action: 'autopilot.escalated',
      entityType: 'shift',
      entityId: shiftEscalatedDsw.id,
      summary: 'Escalated SIL Complex Support Evening after 2 waves received no acceptance.',
      metadataJson: { facilityCode: 'PSL-02' },
    },
  ]);

  console.log('[CoverPulse Seed] Synthetic demo seed completed successfully.');
}
