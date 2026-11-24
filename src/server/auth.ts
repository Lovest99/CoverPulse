import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { memberships, tenants, users, workerProfiles } from '../db/schema.ts';
import {
  ROLE_PERMISSION_MATRIX,
  canAccessFacility,
  hasPermission,
  type PermissionKey,
} from './rbac.ts';
import type { RoleKey, SessionContext } from '../shared/types.ts';

// Ephemeral in-memory HMAC signing secret fallback per securecoder-persona (never hardcoded)
const DEMO_TOKEN_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export interface AuthedRequest extends Request {
  session?: SessionContext;
}

interface DemoTokenPayload {
  userId: string;
  tenantId: string;
  roleKey: RoleKey;
  exp: number;
}

export function issueDemoSessionToken(payload: Omit<DemoTokenPayload, 'exp'>): string {
  const full: DemoTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8, // 8 hours
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', DEMO_TOKEN_SECRET).update(encoded).digest('base64url');
  return `cpdemo.${encoded}.${sig}`;
}

export function verifyDemoSessionToken(token: string): DemoTokenPayload | null {
  if (!token.startsWith('cpdemo.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', DEMO_TOKEN_SECRET).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as DemoTokenPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function buildSessionContext(
  userId: string,
  tenantId: string,
  authMode: 'firebase' | 'demo_session',
): Promise<SessionContext | null> {
  const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userRow || userRow.status !== 'active') return null;

  const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenantRow || tenantRow.status !== 'active') return null;

  if (authMode === 'demo_session' && !tenantRow.isDemo) {
    // Demo tokens can NEVER access non-demo tenants
    return null;
  }

  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
    .limit(1);

  if (!membership || membership.status !== 'active') return null;

  const roleKey = membership.roleKey as RoleKey;
  const [workerRow] = await db
    .select({ id: workerProfiles.id })
    .from(workerProfiles)
    .where(and(eq(workerProfiles.tenantId, tenantId), eq(workerProfiles.userId, userId)))
    .limit(1);

  return {
    userId: userRow.id,
    uid: userRow.uid,
    email: userRow.email,
    fullName: userRow.fullName,
    tenantId: tenantRow.id,
    tenantName: tenantRow.name,
    tenantSlug: tenantRow.slug,
    isDemoTenant: tenantRow.isDemo,
    roleKey,
    permissions: ROLE_PERMISSION_MATRIX[roleKey] ?? [],
    permittedFacilityIds: membership.permittedFacilityIds ?? [],
    workerId: workerRow?.id ?? null,
    isPlatformAdmin: userRow.isPlatformAdmin,
    authMode,
  };
}

export async function syncFirebaseUserToDemoTenant(
  uid: string,
  email: string,
  fullName: string,
): Promise<SessionContext | null> {
  const isOwnerEmail = email.toLowerCase() === 'brightcheteni1@gmail.com';
  const [upsertedUser] = await db
    .insert(users)
    .values({
      uid,
      email,
      fullName: fullName || email.split('@')[0],
      isPlatformAdmin: isOwnerEmail,
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: {
        email,
        fullName: fullName || email.split('@')[0],
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  const [primaryTenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, 'harbourview-care-demo'))
    .limit(1);

  if (!primaryTenant) return null;

  await db
    .insert(memberships)
    .values({
      tenantId: primaryTenant.id,
      userId: upsertedUser.id,
      roleKey: isOwnerEmail ? 'platform_super_admin' : 'org_owner',
      permittedFacilityIds: [],
      status: 'active',
    })
    .onConflictDoNothing();

  return buildSessionContext(upsertedUser.id, primaryTenant.id, 'firebase');
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
  }

  const token = authHeader.slice('Bearer '.length).trim();

  // 1. Check server-signed demo session token
  if (token.startsWith('cpdemo.')) {
    const payload = verifyDemoSessionToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    }
    try {
      const ctx = await buildSessionContext(payload.userId, payload.tenantId, 'demo_session');
      if (!ctx) {
        return res.status(401).json({ error: 'Account membership is inactive or unavailable.' });
      }
      req.session = ctx;
      return next();
    } catch (error) {
      console.error('Demo session lookup failed:', error);
      return res.status(500).json({ error: 'Authentication verification failed.' });
    }
  }

  // 2. Verify Firebase ID Token
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = decoded.email || `${decoded.uid}@users.coverpulse.local`;
    const name = decoded.name || email.split('@')[0];
    const ctx = await syncFirebaseUserToDemoTenant(decoded.uid, email, name);
    if (!ctx) {
      return res.status(403).json({ error: 'No active organisation membership found for account.' });
    }
    req.session = ctx;
    return next();
  } catch (error) {
    console.error('Firebase token verification error:', error);
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

export function requirePermission(permission: PermissionKey) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.session) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!hasPermission(req.session.roleKey, permission)) {
      return res.status(403).json({
        error: `Forbidden: role "${req.session.roleKey}" lacks required permission "${permission}".`,
      });
    }
    return next();
  };
}

export function assertFacilityScope(session: SessionContext, facilityId: string | null | undefined): boolean {
  return canAccessFacility(session.roleKey, session.permittedFacilityIds, facilityId);
}
