import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// 1. Tenant (Care Organisation)
export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  abn: text('abn').notNull(),
  sector: text('sector').notNull().default('Aged Care'),
  state: text('state').notNull().default('NSW'),
  timezone: text('timezone').notNull().default('Australia/Sydney'),
  planTier: text('plan_tier').notNull().default('growth'),
  status: text('status').notNull().default('active'),
  isDemo: boolean('is_demo').notNull().default(false),
  settingsJson: jsonb('settings_json').$type<{
    defaultMaxWeeklyHours: number;
    defaultMinRestHours: number;
    agencyHourlyRateAud: number;
    internalHourlyRateAud: number;
    overtimeMultiplier: number;
    retentionDays: number;
    quietHoursDefaultStart: string;
    quietHoursDefaultEnd: string;
    notificationTemplates?: {
      smsOffer: string;
      emailOfferSubject: string;
      escalationNotice: string;
    };
  }>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 2. Users (linked to Firebase Auth UID or synthetic demo UID)
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  status: text('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 3. Roles
export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  isSystem: boolean('is_system').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 4. Permissions
export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 5. Role Permissions join table
export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('role_perm_unique_idx').on(table.roleId, table.permissionId)],
);

// 6. Memberships (User <-> Tenant + Role + Permitted Facilities)
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleKey: text('role_key').notNull(),
    permittedFacilityIds: jsonb('permitted_facility_ids').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('membership_tenant_user_idx').on(table.tenantId, table.userId),
    index('membership_tenant_idx').on(table.tenantId),
  ],
);

// 7. Facilities
export const facilities = pgTable(
  'facilities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    serviceType: text('service_type').notNull(), // Aged Care | Disability Support | Community Care
    address: text('address').notNull(),
    suburb: text('suburb').notNull(),
    state: text('state').notNull().default('NSW'),
    postcode: text('postcode').notNull(),
    timezone: text('timezone').notNull().default('Australia/Sydney'),
    phone: text('phone').notNull(),
    bedOrClientCapacity: integer('bed_or_client_capacity').notNull().default(60),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('facilities_tenant_idx').on(table.tenantId)],
);

// 8. Worker Profiles
export const workerProfiles = pgTable(
  'worker_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    primaryRole: text('primary_role').notNull(), // Registered Nurse (RN), Enrolled Nurse (EN), Personal Care Worker (PCW), Disability Support Worker (DSW), Community Care Worker (CCW)
    employmentType: text('employment_type').notNull(), // Permanent Part-Time | Casual | Permanent Full-Time
    preferredChannel: text('preferred_channel').notNull().default('sms'), // in_app | sms | email
    travelRadiusKm: integer('travel_radius_km').notNull().default(20),
    postcode: text('postcode').notNull(),
    maxWeeklyHours: integer('max_weekly_hours').notNull().default(38),
    minRestHours: integer('min_rest_hours').notNull().default(10),
    restrictionsJson: jsonb('restrictions_json')
      .$type<{
        noNightShifts?: boolean;
        noDoubleShifts?: boolean;
        maxConsecutiveDays?: number;
        notes?: string;
      }>()
      .notNull()
      .default({}),
    availabilityStatus: text('availability_status').notNull().default('available'), // available | limited | unavailable
    reliabilityScore: integer('reliability_score').notNull().default(88), // 0-100 based on response history
    recentShiftsCount: integer('recent_shifts_count').notNull().default(3),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('workers_tenant_idx').on(table.tenantId),
    index('workers_tenant_role_idx').on(table.tenantId, table.primaryRole),
  ],
);

// 9. Worker <-> Facility Eligibility
export const workerFacilities = pgTable(
  'worker_facilities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workerProfiles.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    distanceKm: integer('distance_km').notNull().default(8),
    approved: boolean('approved').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('worker_facility_unique_idx').on(table.workerId, table.facilityId),
    index('worker_facility_tenant_idx').on(table.tenantId, table.facilityId),
  ],
);

// 10. Skills
export const skills = pgTable(
  'skills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workerProfiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    level: text('level').notNull().default('competent'), // competent | experienced | lead
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('skills_tenant_worker_idx').on(table.tenantId, table.workerId)],
);

// 11. Qualifications catalog
export const qualifications = pgTable(
  'qualifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(), // Registration | Screening | Clinical | Safety
    isMandatorySafety: boolean('is_mandatory_safety').notNull().default(true),
    defaultValidityDays: integer('default_validity_days').notNull().default(365),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('qual_tenant_code_idx').on(table.tenantId, table.code),
    index('qual_tenant_idx').on(table.tenantId),
  ],
);

// 12. Qualification Evidence
export const qualificationEvidence = pgTable(
  'qualification_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workerProfiles.id, { onDelete: 'cascade' }),
    qualificationId: uuid('qualification_id')
      .notNull()
      .references(() => qualifications.id, { onDelete: 'cascade' }),
    referenceNumber: text('reference_number').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    reviewStatus: text('review_status').notNull().default('verified'), // verified | pending | expired | rejected
    reviewerUserId: uuid('reviewer_user_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    documentRef: text('document_ref'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('qual_ev_tenant_worker_idx').on(table.tenantId, table.workerId),
    index('qual_ev_expiry_idx').on(table.tenantId, table.expiresAt),
  ],
);

// 13. Availability Windows
export const availabilityWindows = pgTable(
  'availability_windows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workerProfiles.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(), // 0=Sun..6=Sat
    startTime: text('start_time').notNull(), // "06:00"
    endTime: text('end_time').notNull(), // "23:59"
    specificDate: text('specific_date'), // optional YYYY-MM-DD override
    isAvailable: boolean('is_available').notNull().default(true),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('avail_tenant_worker_idx').on(table.tenantId, table.workerId)],
);

// 14. Shifts
export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    roleRequired: text('role_required').notNull(),
    shiftDate: text('shift_date').notNull(), // YYYY-MM-DD in facility timezone
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    breakMinutes: integer('break_minutes').notNull().default(30),
    headcount: integer('headcount').notNull().default(1),
    filledCount: integer('filled_count').notNull().default(0),
    urgency: text('urgency').notNull().default('standard'), // standard | high | critical
    status: text('status').notNull().default('open'), // draft | open | broadcasting | partially_covered | covered | cancelled | expired
    isOvernight: boolean('is_overnight').notNull().default(false),
    hourlyRateCents: integer('hourly_rate_cents').notNull().default(4600),
    showRateToWorker: boolean('show_rate_to_worker').notNull().default(true),
    requiresManagerConfirmation: boolean('requires_manager_confirmation').notNull().default(false),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    filledAt: timestamp('filled_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    escalationReason: text('escalation_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('shifts_tenant_status_idx').on(table.tenantId, table.status),
    index('shifts_tenant_facility_start_idx').on(table.tenantId, table.facilityId, table.startAt),
  ],
);

// 15. Shift Requirements
export const shiftRequirements = pgTable(
  'shift_requirements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    qualificationId: uuid('qualification_id').references(() => qualifications.id, { onDelete: 'cascade' }),
    requiredSkillName: text('required_skill_name'),
    isMandatory: boolean('is_mandatory').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('shift_req_tenant_shift_idx').on(table.tenantId, table.shiftId)],
);

// 16. Shift Assignments
export const shiftAssignments = pgTable(
  'shift_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id, { onDelete: 'cascade' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workerProfiles.id, { onDelete: 'cascade' }),
    offerId: uuid('offer_id'),
    status: text('status').notNull().default('confirmed'), // confirmed | pending_confirmation | cancelled | completed
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    isOverride: boolean('is_override').notNull().default(false),
    overrideReason: text('override_reason'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('assignments_tenant_shift_idx').on(table.tenantId, table.shiftId),
    index('assignments_tenant_worker_idx').on(table.tenantId, table.workerId),
  ],
);

// 17. Coverage Policies
export const coveragePolicies = pgTable(
  'coverage_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    dispatchMode: text('dispatch_mode').notNull().default('tiered'), // sequential | tiered | parallel_waves
    batchSize: integer('batch_size').notNull().default(3),
    responseWindowMinutes: integer('response_window_minutes').notNull().default(15),
    quietHoursStart: text('quiet_hours_start').notNull().default('22:00'),
    quietHoursEnd: text('quiet_hours_end').notNull().default('06:00'),
    maxAttempts: integer('max_attempts').notNull().default(3),
    reminderAfterMinutes: integer('reminder_after_minutes').notNull().default(7),
    channelsJson: jsonb('channels_json').$type<string[]>().notNull().default(['in_app', 'sms', 'email']),
    escalationRecipientRole: text('escalation_recipient_role').notNull().default('operations_manager'),
    escalationRecipientEmail: text('escalation_recipient_email').notNull(),
    requireManagerConfirmation: boolean('require_manager_confirmation').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('policies_tenant_idx').on(table.tenantId)],
);

// 18. Coverage Runs
export const coverageRuns = pgTable(
  'coverage_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id, { onDelete: 'cascade' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => coveragePolicies.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('running'), // running | completed | escalated | stopped | failed
    currentWave: integer('current_wave').notNull().default(1),
    totalWaves: integer('total_waves').notNull().default(1),
    attemptsCount: integer('attempts_count').notNull().default(0),
    startedByUserId: uuid('started_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    stoppedReason: text('stopped_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('runs_tenant_shift_idx').on(table.tenantId, table.shiftId),
    index('runs_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

// 19. Candidate Matches
export const candidateMatches = pgTable(
  'candidate_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => coverageRuns.id, { onDelete: 'set null' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workerProfiles.id, { onDelete: 'cascade' }),
    eligible: boolean('eligible').notNull(),
    totalScore: integer('total_score').notNull().default(0),
    scoreBreakdownJson: jsonb('score_breakdown_json')
      .$type<{
        facilityDistance: number;
        skillsFit: number;
        reliability: number;
        fairRotation: number;
      }>()
      .notNull(),
    inclusionReasonsJson: jsonb('inclusion_reasons_json').$type<string[]>().notNull().default([]),
    exclusionReasonsJson: jsonb('exclusion_reasons_json').$type<string[]>().notNull().default([]),
    rankOrder: integer('rank_order'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('matches_tenant_shift_idx').on(table.tenantId, table.shiftId)],
);

// 20. Shift Offers
export const shiftOffers = pgTable(
  'shift_offers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facilities.id, { onDelete: 'cascade' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => coverageRuns.id, { onDelete: 'set null' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workerProfiles.id, { onDelete: 'cascade' }),
    waveNumber: integer('wave_number').notNull().default(1),
    channel: text('channel').notNull().default('sms'), // in_app | sms | email
    status: text('status').notNull().default('sent'), // queued | sent | delivered | opened | accepted | declined | expired | withdrawn | failed | bounced
    idempotencyKey: text('idempotency_key').notNull().unique(),
    attemptNumber: integer('attempt_number').notNull().default(1),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    declineReason: text('decline_reason'),
    responseLatencySec: integer('response_latency_sec'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('offers_tenant_shift_idx').on(table.tenantId, table.shiftId),
    index('offers_tenant_worker_status_idx').on(table.tenantId, table.workerId, table.status),
  ],
);

// 21. Offer Events (Timeline)
export const offerEvents = pgTable(
  'offer_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    offerId: uuid('offer_id').references(() => shiftOffers.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(), // shift_created | shift_published | autopilot_started | offer_queued | offer_sent | offer_delivered | offer_opened | offer_accepted | offer_declined | offer_expired | offer_withdrawn | offer_failed | wave_escalated | shift_covered | manager_override | shift_cancelled
    channel: text('channel'),
    providerMessageId: text('provider_message_id'),
    summary: text('summary').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('offer_events_tenant_shift_idx').on(table.tenantId, table.shiftId, table.createdAt)],
);

// 22. Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id').references(() => workerProfiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    category: text('category').notNull().default('coverage'), // coverage | escalation | credential | system
    linkPath: text('link_path'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('notif_tenant_created_idx').on(table.tenantId, table.createdAt)],
);

// 23. Integrations
export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    category: text('category').notNull(), // rostering | hris | payroll | identity | sms | email
    providerName: text('provider_name').notNull(),
    status: text('status').notNull().default('disconnected'), // disconnected | sandbox | connected | error
    description: text('description').notNull(),
    configJson: jsonb('config_json').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('integrations_tenant_idx').on(table.tenantId)],
);

// 24. Webhook Endpoints
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description').notNull(),
    eventsJson: jsonb('events_json').$type<string[]>().notNull().default([]),
    signingSecretHash: text('signing_secret_hash').notNull(),
    signingSecretPreview: text('signing_secret_preview').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('webhooks_tenant_idx').on(table.tenantId)],
);

// 25. Webhook Deliveries
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
    signatureHeader: text('signature_header').notNull(),
    status: text('status').notNull().default('delivered'), // pending | delivered | failed | dead_letter
    httpStatus: integer('http_status'),
    attempts: integer('attempts').notNull().default(1),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('webhook_del_tenant_idx').on(table.tenantId, table.createdAt)],
);

// 26. Plan Configurations (Platform Admin editable commercial model)
export const planConfigs = pgTable('plan_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tierKey: text('tier_key').notNull().unique(), // essential | growth | enterprise
  displayName: text('display_name').notNull(),
  targetAudience: text('target_audience').notNull(),
  monthlyPriceAudCents: integer('monthly_price_aud_cents').notNull(),
  annualDiscountPct: integer('annual_discount_pct').notNull().default(15),
  onboardingFeeAudCents: integer('onboarding_fee_aud_cents').notNull().default(150000),
  maxFacilities: integer('max_facilities').notNull(),
  maxWorkers: integer('max_workers').notNull(),
  includedSmsPerMonth: integer('included_sms_per_month').notNull(),
  smsOverageCents: integer('sms_overage_cents').notNull().default(12),
  featuresJson: jsonb('features_json').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 27. Subscriptions
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .unique()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planTier: text('plan_tier').notNull().default('growth'),
    billingCycle: text('billing_cycle').notNull().default('monthly'), // monthly | annual
    status: text('status').notNull().default('active'), // trialing | paid_pilot | active | past_due | cancelled
    monthlyPriceCents: integer('monthly_price_cents').notNull(),
    onboardingFeeCents: integer('onboarding_fee_cents').notNull().default(0),
    includedFacilities: integer('included_facilities').notNull().default(10),
    includedWorkers: integer('included_workers').notNull().default(250),
    includedSms: integer('included_sms').notNull().default(2500),
    smsUsedThisPeriod: integer('sms_used_this_period').notNull().default(412),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    externalCustomerId: text('external_customer_id'),
    lastWebhookEventId: text('last_webhook_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('subs_tenant_idx').on(table.tenantId)],
);

// 28. Invoice References
export const invoiceReferences = pgTable(
  'invoice_references',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    invoiceNumber: text('invoice_number').notNull(),
    periodLabel: text('period_label').notNull(),
    subscriptionCents: integer('subscription_cents').notNull(),
    smsUsageCents: integer('sms_usage_cents').notNull().default(0),
    integrationCents: integer('integration_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    status: text('status').notNull().default('paid'), // paid | open | void
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    externalUrl: text('external_url'),
  },
  (table) => [index('invoices_tenant_idx').on(table.tenantId)],
);

// 29. Audit Events (Immutable)
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'set null' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email').notNull(),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    summary: text('summary').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('audit_tenant_action_idx').on(table.tenantId, table.action),
  ],
);

// 30. Support Access Grants (Audited, Time-limited Super Admin Elevation)
export const supportAccessGrants = pgTable(
  'support_access_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    supportUserEmail: text('support_user_email').notNull(),
    reason: text('reason').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('support_grants_tenant_idx').on(table.tenantId)],
);

// 31. Consent Records (Lead Capture, Privacy Requests, SMS Opt-ins)
export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    subjectEmail: text('subject_email').notNull(),
    subjectName: text('subject_name').notNull(),
    organisationName: text('organisation_name'),
    consentType: text('consent_type').notNull(), // demo_lead | privacy_export | privacy_deletion | sms_opt_in
    granted: boolean('granted').notNull().default(true),
    privacyVersion: text('privacy_version').notNull().default('APP-2026.1'),
    detailsJson: jsonb('details_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('consent_email_idx').on(table.subjectEmail)],
);
