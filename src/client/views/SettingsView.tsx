import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, Globe, Lock, RefreshCw, Save, Shield, Trash2, Users } from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useMarket } from '../MarketContext.tsx';
import { ALL_TIMEZONE_GROUPS, MARKET_LIST, type MarketCode } from '../../shared/markets.ts';
import { useToast } from '../components/Toast.tsx';
import { ROLE_LABELS, type RoleKey } from '../../shared/types.ts';

interface TenantSettingsData {
  tenant: {
    id: string;
    name: string;
    slug: string;
    abn: string | null;
    timezone: string;
    planTier: string;
    isDemo: boolean;
    settingsJson: {
      defaultMaxWeeklyHours: number;
      defaultMinRestHours: number;
      agencyHourlyRateAud: number;
      internalHourlyRateAud: number;
      overtimeMultiplier: number;
      retentionDays: number;
      quietHoursDefaultStart: string;
      quietHoursDefaultEnd: string;
    };
  };
  members: Array<{
    id: string;
    roleKey: RoleKey;
    permittedFacilityIds: string[];
    status: string;
    fullName: string;
    email: string;
    mfaEnabled: boolean;
  }>;
  supportGrants: Array<{
    id: string;
    grantedToEmail: string;
    reason: string;
    expiresAt: string;
    revokedAt: string | null;
  }>;
}

interface PlanConfigItem {
  id: string;
  tierKey: string;
  displayName: string;
  monthlyPriceAudCents: number;
  maxFacilities: number;
  maxWorkers: number;
  includedSmsPerMonth: number;
}

export const SettingsView: React.FC = () => {
  const { session } = useAuth();
  const { market, marketCode, setMarketCode } = useMarket();
  const { pushToast } = useToast();
  const canManage = Boolean(session?.permissions.includes('settings:manage'));
  const isPlatformAdmin = Boolean(session?.permissions.includes('platform:admin'));

  const [data, setData] = useState<TenantSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [orgName, setOrgName] = useState('');
  const [abn, setAbn] = useState('');
  const [timezone, setTimezone] = useState('Australia/Sydney');
  const [settingsForm, setSettingsForm] = useState({
    defaultMaxWeeklyHours: 38,
    defaultMinRestHours: 10,
    agencyHourlyRateAud: 96,
    internalHourlyRateAud: 54,
    overtimeMultiplier: 1.5,
    retentionDays: 2555,
    quietHoursDefaultStart: '22:00',
    quietHoursDefaultEnd: '06:00',
  });

  const [privacyBusy, setPrivacyBusy] = useState<string | null>(null);
  const [privacyExportPreview, setPrivacyExportPreview] = useState<string | null>(null);

  const [adminPlans, setAdminPlans] = useState<PlanConfigItem[]>([]);
  const [adminTenantsCount, setAdminTenantsCount] = useState<number>(0);
  const [savingTier, setSavingTier] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<TenantSettingsData>('/api/settings');
      setData(res);
      if (res.tenant) {
        setOrgName(res.tenant.name);
        setAbn(res.tenant.abn || '');
        setTimezone(res.tenant.timezone);
        setSettingsForm(res.tenant.settingsJson);
      }

      if (isPlatformAdmin) {
        const adminData = await apiFetch<{
          tenants: Array<{ id: string }>;
          plans: PlanConfigItem[];
        }>('/api/admin/overview');
        setAdminPlans(adminData.plans);
        setAdminTenantsCount(adminData.tenants.length);
      }
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to load settings.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [isPlatformAdmin]);

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          name: orgName,
          abn: abn || undefined,
          timezone,
          settingsJson: {
            ...settingsForm,
            defaultMaxWeeklyHours: Number(settingsForm.defaultMaxWeeklyHours),
            defaultMinRestHours: Number(settingsForm.defaultMinRestHours),
            agencyHourlyRateAud: Number(settingsForm.agencyHourlyRateAud),
            internalHourlyRateAud: Number(settingsForm.internalHourlyRateAud),
            overtimeMultiplier: Number(settingsForm.overtimeMultiplier),
            retentionDays: Number(settingsForm.retentionDays),
          },
        }),
      });
      pushToast({ type: 'success', title: 'Organisation settings saved and audited.' });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePrivacyRequest = async (requestType: 'privacy_export' | 'privacy_deletion') => {
    setPrivacyBusy(requestType);
    try {
      const res = await apiFetch<{ id: string; exportPackage: unknown }>('/api/privacy/request', {
        method: 'POST',
        body: JSON.stringify({ requestType }),
      });
      if (res.exportPackage) {
        setPrivacyExportPreview(JSON.stringify(res.exportPackage, null, 2));
      }
      pushToast({
        type: 'success',
        title:
          requestType === 'privacy_export'
            ? 'Privacy Data Export package generated and audited.'
            : 'Deletion request logged for organisation privacy officer review.',
      });
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Privacy request failed.' });
    } finally {
      setPrivacyBusy(null);
    }
  };

  const handleSavePlan = async (plan: PlanConfigItem) => {
    setSavingTier(plan.tierKey);
    try {
      await apiFetch(`/api/admin/plans/${plan.tierKey}`, {
        method: 'PATCH',
        body: JSON.stringify({
          monthlyPriceAudCents: Number(plan.monthlyPriceAudCents),
          maxFacilities: Number(plan.maxFacilities),
          maxWorkers: Number(plan.maxWorkers),
          includedSmsPerMonth: Number(plan.includedSmsPerMonth),
        }),
      });
      pushToast({ type: 'success', title: `${plan.displayName} plan pricing updated live.` });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to update plan.' });
    } finally {
      setSavingTier(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-52 rounded-xl bg-white border border-slate-200 animate-pulse" />
        <div className="h-40 rounded-xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">
            Settings, Governance &amp; Privacy
          </h1>
          <p className="text-xs text-[#52647D] mt-0.5">
            Organisation profile, market localisation ({market.name}), rest guardrails, RBAC, and {market.privacyFramework}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          aria-label="Refresh settings"
          className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-[#52647D] hover:text-[#0B1F44] cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Organisation & Operational Guardrails Form */}
      <form onSubmit={handleSaveOrg} className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-[#0B1F44]">Organisation Profile &amp; Matching Defaults</h2>
            <p className="text-xs text-[#52647D]">
              Updates deterministic rest-period, weekly hour caps, regional profile, and cost estimate baselines.
            </p>
          </div>
          {canManage && (
            <button
              type="submit"
              disabled={saving}
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#0B1F44] hover:bg-[#132f63] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer self-start sm:self-auto whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5 text-[#06B6D4]" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Organisation Name</label>
            <input
              disabled={!canManage}
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B1F44] mb-1 flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-[#0E8BFF]" />
              Market / Currency Profile
            </label>
            <select
              value={marketCode}
              onChange={(e) => setMarketCode(e.target.value as MarketCode)}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] bg-white"
            >
              {MARKET_LIST.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name} ({m.currencyCode}){m.code === 'AU' ? ' · Launch' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B1F44] mb-1 truncate">
              {market.businessIdLabel}
            </label>
            <input
              disabled={!canManage}
              value={abn}
              onChange={(e) => setAbn(e.target.value)}
              placeholder={market.businessIdPlaceholder}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono text-[#0B1F44] disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Default Timezone</label>
            <select
              disabled={!canManage}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] bg-white disabled:bg-slate-50"
            >
              {ALL_TIMEZONE_GROUPS.map((grp) => (
                <optgroup key={grp.label} label={grp.label}>
                  {grp.zones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
          <div>
            <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Max Weekly (h)</label>
            <input
              type="number"
              disabled={!canManage}
              value={settingsForm.defaultMaxWeeklyHours}
              onChange={(e) => setSettingsForm({ ...settingsForm, defaultMaxWeeklyHours: Number(e.target.value) })}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono tabular-nums disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Min Rest (h)</label>
            <input
              type="number"
              disabled={!canManage}
              value={settingsForm.defaultMinRestHours}
              onChange={(e) => setSettingsForm({ ...settingsForm, defaultMinRestHours: Number(e.target.value) })}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono tabular-nums disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Agency (AUD/h)</label>
            <input
              type="number"
              disabled={!canManage}
              value={settingsForm.agencyHourlyRateAud}
              onChange={(e) => setSettingsForm({ ...settingsForm, agencyHourlyRateAud: Number(e.target.value) })}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono tabular-nums disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Internal (AUD/h)</label>
            <input
              type="number"
              disabled={!canManage}
              value={settingsForm.internalHourlyRateAud}
              onChange={(e) => setSettingsForm({ ...settingsForm, internalHourlyRateAud: Number(e.target.value) })}
              className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono tabular-nums disabled:bg-slate-50"
            />
          </div>
        </div>
      </form>

      {/* Team Members & Roles: Mobile List + Desktop Table */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-sm font-bold text-[#0B1F44] flex items-center gap-2">
            <Users className="w-4 h-4 text-[#0E8BFF]" />
            Role-Based Access Members ({data?.members.length ?? 0})
          </h2>
        </div>

        {/* Mobile List */}
        <div className="md:hidden divide-y divide-slate-100">
          {(data?.members ?? []).map((m) => (
            <div key={m.id} className="px-4 py-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-[#0B1F44] truncate">{m.fullName}</p>
                <span className={`font-semibold shrink-0 ${m.mfaEnabled ? 'text-[#16A879]' : 'text-[#F59E0B]'}`}>
                  MFA: {m.mfaEnabled ? 'Enforced' : 'Recommended'}
                </span>
              </div>
              <p className="font-mono text-[#52647D] truncate">{m.email}</p>
              <p className="text-[#52647D]">
                <span className="font-semibold text-[#0B1F44]">{ROLE_LABELS[m.roleKey] ?? m.roleKey}</span> ·{' '}
                {m.permittedFacilityIds.length === 0
                  ? 'All sites'
                  : `${m.permittedFacilityIds.length} assigned site(s)`}
              </p>
            </div>
          ))}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-[#52647D]">
                <th className="py-2.5 px-5">User</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Facility Scope</th>
                <th className="py-2.5 px-5 text-right">MFA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.members ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="py-2.5 px-5">
                    <p className="font-semibold text-[#0B1F44] text-xs lg:text-sm">{m.fullName}</p>
                    <p className="text-xs font-mono text-[#52647D]">{m.email}</p>
                  </td>
                  <td className="py-2.5 px-4 text-xs font-semibold text-[#0B1F44]">
                    {ROLE_LABELS[m.roleKey] ?? m.roleKey}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-[#52647D] tabular-nums">
                    {m.permittedFacilityIds.length === 0
                      ? 'All organisation sites'
                      : `${m.permittedFacilityIds.length} assigned site(s)`}
                  </td>
                  <td className="py-2.5 px-5 text-right text-xs font-semibold">
                    <span className={m.mfaEnabled ? 'text-[#16A879]' : 'text-[#F59E0B]'}>
                      {m.mfaEnabled ? 'Enforced' : 'Recommended'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Privacy & Architecture Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <div className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5 space-y-3.5">
          <h2 className="text-sm font-bold text-[#0B1F44] flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#0E8BFF]" />
            {market.privacyFramework} Self-Service
          </h2>
          <p className="text-xs text-[#52647D] leading-relaxed">
            Built to support regional access, correction, and retention governance for {market.regulatoryBody}.
            Formal legal and care-sector compliance review remains the responsibility of each provider.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handlePrivacyRequest('privacy_export')}
              disabled={privacyBusy !== null}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#0E8BFF]" />
              {privacyBusy === 'privacy_export' ? 'Exporting...' : 'Request Data Export'}
            </button>
            <button
              type="button"
              onClick={() => handlePrivacyRequest('privacy_deletion')}
              disabled={privacyBusy !== null}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[#DC4C64]/40 text-xs font-semibold text-[#DC4C64] hover:bg-[#DC4C64]/5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {privacyBusy === 'privacy_deletion' ? 'Logging...' : 'Log Deletion Request'}
            </button>
          </div>
          {privacyExportPreview && (
            <pre className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono text-[#0B1F44] overflow-x-auto">
              {privacyExportPreview}
            </pre>
          )}
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5 space-y-3">
          <h2 className="text-sm font-bold text-[#0B1F44] flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#16A879]" />
            Implemented Architecture Controls
          </h2>
          <ul className="space-y-2 text-xs text-[#52647D]">
            {[
              'Tenant isolation enforced on every server query via authenticated tenant_id',
              'Atomic PostgreSQL FOR UPDATE shift locking prevents concurrent double-booking',
              'Safety-locked manual overrides block expired mandatory credentials and overlaps',
              'Immutable audit log records overrides, credential reviews, exports, and escalations',
              'In-memory bearer authentication tokens — zero credential storage in browser localStorage',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16A879] shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Platform Super Admin Plan Config Console */}
      {isPlatformAdmin && adminPlans.length > 0 && (
        <div className="rounded-xl bg-white border border-[#0E8BFF]/40 p-4 sm:p-5 space-y-3.5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#0E8BFF]">
              Platform Super Admin Control
            </p>
            <h2 className="text-sm font-bold text-[#0B1F44]">
              Live Commercial Plan Entitlements ({adminTenantsCount} active tenants)
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {adminPlans.map((plan) => (
              <div key={plan.tierKey} className="rounded-lg border border-slate-200 p-4 space-y-3">
                <p className="text-sm font-bold text-[#0B1F44]">{plan.displayName}</p>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="block text-[#52647D] mb-0.5">Monthly AUD (cents)</label>
                    <input
                      type="number"
                      value={plan.monthlyPriceAudCents}
                      onChange={(e) =>
                        setAdminPlans((prev) =>
                          prev.map((p) =>
                            p.tierKey === plan.tierKey
                              ? { ...p, monthlyPriceAudCents: Number(e.target.value) }
                              : p,
                          ),
                        )
                      }
                      className="w-full min-h-[38px] rounded border border-slate-300 px-2.5 py-1.5 font-mono text-[#0B1F44]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[#52647D] mb-0.5">Max Sites</label>
                      <input
                        type="number"
                        value={plan.maxFacilities}
                        onChange={(e) =>
                          setAdminPlans((prev) =>
                            prev.map((p) =>
                              p.tierKey === plan.tierKey
                                ? { ...p, maxFacilities: Number(e.target.value) }
                                : p,
                            ),
                          )
                        }
                        className="w-full min-h-[38px] rounded border border-slate-300 px-2.5 py-1.5 font-mono text-[#0B1F44]"
                      />
                    </div>
                    <div>
                      <label className="block text-[#52647D] mb-0.5">Max Workers</label>
                      <input
                        type="number"
                        value={plan.maxWorkers}
                        onChange={(e) =>
                          setAdminPlans((prev) =>
                            prev.map((p) =>
                              p.tierKey === plan.tierKey ? { ...p, maxWorkers: Number(e.target.value) } : p,
                            ),
                          )
                        }
                        className="w-full min-h-[38px] rounded border border-slate-300 px-2.5 py-1.5 font-mono text-[#0B1F44]"
                      />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleSavePlan(plan)}
                  disabled={savingTier === plan.tierKey}
                  className="w-full min-h-[38px] py-2 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold hover:bg-[#143066] cursor-pointer"
                >
                  {savingTier === plan.tierKey ? 'Updating...' : 'Update Public Pricing'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
