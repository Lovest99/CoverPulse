import React, { useState } from 'react';
import { ArrowLeft, Building2, Shield, Smartphone, UserCheck } from 'lucide-react';
import { useAuth, type DemoPersona } from '../AuthContext.tsx';
import { ROLE_LABELS, type RoleKey } from '../../shared/types.ts';

interface SignInViewProps {
  onBackToPublic: () => void;
}

const PERSONA_NOTES: Record<string, string> = {
  'demo-org-owner': 'Full organisation control: settings, billing, facilities, shifts, and audit log.',
  'demo-ops-manager': 'Manages shifts, policies, workers, escalations, and analytics across all 4 facilities.',
  'demo-facility-manager': 'Scoped strictly to Bayside Gardens Aged Care — site-level isolation.',
  'demo-coordinator': 'Creates shifts, starts Coverage Autopilot waves, and tracks offer responses.',
  'demo-worker-chloe': 'Mobile-first Worker PWA for Chloe Nguyen (RN) — view & accept active shift offers.',
  'demo-auditor': 'Read-only assurance access to analytics, exports, and immutable audit trail.',
  'demo-platform-admin': 'Platform Super Admin — configure plan tiers, view all tenants, and manage support grants.',
  'demo-tenant-b-worker': 'Isolated Tenant B Worker (Southern Cross Community Care) — verifies zero cross-tenant access.',
};

export const SignInView: React.FC<SignInViewProps> = ({ onBackToPublic }) => {
  const { personas, signInWithGoogle, signInDemoPersona, authError } = useAuth();
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleGoogle = async () => {
    setGoogleBusy(true);
    await signInWithGoogle();
    setGoogleBusy(false);
  };

  const handleDemo = async (uid: string) => {
    setBusyUid(uid);
    await signInDemoPersona(uid);
    setBusyUid(null);
  };

  const groups: Array<{ title: string; items: DemoPersona[] }> = [
    {
      title: 'Care Operations & Leadership (Harbourview Care Group)',
      items: personas.filter((p) =>
        ['org_owner', 'operations_manager', 'facility_manager', 'workforce_coordinator'].includes(
          p.roleKey,
        ),
      ),
    },
    {
      title: 'Frontline Worker PWA',
      items: personas.filter(
        (p) => p.roleKey === 'worker' && p.tenantSlug === 'harbourview-care-demo',
      ),
    },
    {
      title: 'Governance, Platform & Cross-Tenant Isolation',
      items: personas.filter(
        (p) =>
          p.roleKey === 'auditor' ||
          p.roleKey === 'platform_super_admin' ||
          p.tenantSlug !== 'harbourview-care-demo',
      ),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackToPublic}
          className="min-h-[44px] inline-flex items-center gap-2 text-sm font-medium text-[#52647D] hover:text-[#0B1F44] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">Back to CoverPulse website</span>
          <span className="sm:hidden">Back</span>
        </button>
        <img
          src="/assets/aistudio/coverpulse-logo-light_442458be.svg"
          alt="CoverPulse"
          className="h-7 w-auto"
          referrerPolicy="no-referrer"
        />
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start">
          {/* Standard Firebase SSO Sign-In */}
          <div className="lg:col-span-5 rounded-xl bg-white border border-slate-200 p-5 sm:p-6">
            <h1 className="text-xl sm:text-2xl font-bold text-[#0B1F44] tracking-tight">
              Sign in to CoverPulse
            </h1>
            <p className="mt-2 text-sm text-[#52647D] leading-relaxed">
              Authenticate with your organisation Google account via Firebase Authentication.
              Sessions use short-lived server-verified tokens held strictly in memory.
            </p>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleBusy}
              className="mt-5 w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-[#0B1F44] text-white text-sm font-semibold hover:bg-[#132f63] disabled:opacity-60 transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
            >
              <Shield className="w-4 h-4 text-[#06B6D4]" />
              {googleBusy ? 'Verifying with Google...' : 'Continue with Google SSO'}
            </button>

            {authError && (
              <p role="alert" className="mt-3 text-xs font-semibold text-[#DC4C64]">
                {authError}
              </p>
            )}

            <div className="mt-5 pt-4 border-t border-slate-100 space-y-1 text-xs text-[#52647D]">
              <p className="font-semibold text-[#0B1F44]">Security &amp; Session Posture</p>
              <p>Server-verified Firebase ID tokens · Least-privilege RBAC · Multi-tenant isolation.</p>
            </div>
          </div>

          {/* Interactive Demo Sandbox Accounts */}
          <div className="lg:col-span-7 rounded-xl bg-white border border-slate-200 p-5 sm:p-6">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#0B1F44]">
                Interactive Synthetic Demo Workspace
              </h2>
              <p className="mt-1 text-xs text-[#52647D] leading-relaxed">
                Seeded with the Australian launch dataset (Harbourview Care Group). Select any role
                to test server-enforced permissions, Worker PWA flows, or cross-tenant isolation.
              </p>
            </div>

            {personas.length === 0 ? (
              <div className="mt-4 space-y-2.5">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="mt-4 space-y-5">
                {groups.map((group) => (
                  <div key={group.title}>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#52647D] pb-1.5 border-b border-slate-100">
                      {group.title}
                    </p>
                    <div className="divide-y divide-slate-100">
                      {group.items.map((p) => {
                        const isWorker = p.roleKey === 'worker';
                        const isTenantB = p.tenantSlug !== 'harbourview-care-demo';
                        return (
                          <div
                            key={p.uid}
                            className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                                {isWorker ? (
                                  <Smartphone className="w-4 h-4 text-[#06B6D4] shrink-0" />
                                ) : isTenantB ? (
                                  <Building2 className="w-4 h-4 text-[#F59E0B] shrink-0" />
                                ) : (
                                  <UserCheck className="w-4 h-4 text-[#0E8BFF] shrink-0" />
                                )}
                                <span className="font-semibold text-[#0B1F44]">{p.fullName}</span>
                                <span className="text-xs text-slate-300" aria-hidden="true">·</span>
                                <span className="text-xs font-semibold text-[#0E8BFF]">
                                  {ROLE_LABELS[p.roleKey as RoleKey] ?? p.roleKey}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs text-[#52647D] sm:pl-6 leading-snug">
                                {PERSONA_NOTES[p.uid] || p.tenantName}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleDemo(p.uid)}
                              disabled={busyUid !== null}
                              className="w-full sm:w-auto min-h-[40px] px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 hover:border-[#0E8BFF] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                            >
                              {busyUid === p.uid
                                ? 'Entering...'
                                : isWorker
                                  ? 'Open Worker PWA'
                                  : 'Enter Console'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
