import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, Plus, Search, ShieldAlert, Upload, X } from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useMarket } from '../MarketContext.tsx';
import { useToast } from '../components/Toast.tsx';
import { HEALTHCARE_ROLES } from '../../shared/types.ts';

interface WorkerRecord {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  primaryRole: string;
  employmentType: string;
  preferredChannel: string;
  travelRadiusKm: number;
  postcode: string;
  maxWeeklyHours: number;
  minRestHours: number;
  availabilityStatus: string;
  reliabilityScore: number;
  recentShiftsCount: number;
  restrictionsJson: { noNightShifts?: boolean; notes?: string };
  credentialHealth: 'verified' | 'expiring_soon' | 'expired';
  facilities: Array<{ facilityId: string; facilityName: string; isPrimary: boolean; distanceKm: number }>;
  credentials: Array<{
    id: string;
    code: string;
    name: string;
    referenceNumber: string;
    expiresAt: string;
    reviewStatus: string;
    isExpired: boolean;
    isExpiringSoon: boolean;
  }>;
  skills: string[];
}

interface WorkforceViewProps {
  selectedFacilityId: string;
  globalSearch: string;
}

export const WorkforceView: React.FC<WorkforceViewProps> = ({ selectedFacilityId, globalSearch }) => {
  const { session } = useAuth();
  const { market } = useMarket();
  const { pushToast } = useToast();
  const canManage = session?.permissions.includes('workers:manage') ?? false;
  const canReviewCreds = session?.permissions.includes('credentials:review') ?? false;

  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [facilities, setFacilities] = useState<Array<{ id: string; name: string }>>([]);
  const [roleFilter, setRoleFilter] = useState('all');
  const [credFilter, setCredFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeWorker, setActiveWorker] = useState<WorkerRecord | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState(
    'firstName,lastName,email,phone,primaryRole,employmentType\nElena,Rossi,elena.rossi@caregroup.demo,+61422990112,Registered Nurse (RN),Casual',
  );
  const [newWorker, setNewWorker] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    primaryRole: 'Registered Nurse (RN)',
    employmentType: 'Casual',
    preferredChannel: 'sms',
    postcode: '',
    travelRadiusKm: 20,
    facilityId: '',
    skillsText: 'Dementia Care',
  });

  const load = async () => {
    setLoading(true);
    try {
      const q = (search || globalSearch).trim();
      const res = await apiFetch<{ workers: WorkerRecord[]; facilities: Array<{ id: string; name: string }> }>(
        `/api/workers?facilityId=${encodeURIComponent(selectedFacilityId)}&role=${encodeURIComponent(roleFilter)}&credentialStatus=${encodeURIComponent(credFilter)}&q=${encodeURIComponent(q)}`,
      );
      setWorkers(res.workers);
      setFacilities(res.facilities);
      if (!newWorker.facilityId && res.facilities.length > 0) {
        setNewWorker((prev) => ({ ...prev, facilityId: res.facilities[0].id }));
      }
      if (activeWorker) {
        const refreshed = res.workers.find((w) => w.id === activeWorker.id) ?? null;
        setActiveWorker(refreshed);
      }
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Unable to load workforce',
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [selectedFacilityId, roleFilter, credFilter, globalSearch]);

  const handleReviewCredential = async (
    evidenceId: string,
    reviewStatus: 'verified' | 'rejected',
    extendOneYear = false,
  ) => {
    try {
      const expiresAt = extendOneYear
        ? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
        : undefined;
      await apiFetch(`/api/credentials/${evidenceId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ reviewStatus, expiresAt }),
      });
      pushToast({
        type: 'success',
        title: extendOneYear ? 'Credential verified & renewed (+12m)' : `Credential marked ${reviewStatus}`,
      });
      load();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Credential review failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleAddWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/workers', {
        method: 'POST',
        body: JSON.stringify({
          ...newWorker,
          postcode: newWorker.postcode || market.postalPlaceholder,
          skills: newWorker.skillsText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setAddOpen(false);
      pushToast({ type: 'success', title: 'Worker added to directory' });
      load();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Could not add worker',
        detail: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleCsvImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorker.facilityId) return;
    try {
      const res = await apiFetch<{ importedCount: number }>('/api/workers/import-csv', {
        method: 'POST',
        body: JSON.stringify({ csvText, facilityId: newWorker.facilityId }),
      });
      setCsvOpen(false);
      pushToast({ type: 'success', title: `Imported ${res.importedCount} worker(s) from CSV` });
      load();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'CSV import failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">Workforce Directory</h1>
          <p className="text-xs text-[#52647D] mt-0.5 tabular-nums">
            {workers.length} active profiles in current scope · Inspect qualifications, restrictions, and availability
          </p>
        </div>

        {canManage && (
          <div className="grid grid-cols-2 sm:flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCsvOpen(true)}
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              Import CSV
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold hover:bg-[#132f63] cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4 text-[#06B6D4]" />
              Add Worker
            </button>
          </div>
        )}
      </div>

      {/* Mobile-First Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <select
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-[#0B1F44] w-full sm:w-auto"
          >
            <option value="all">All Roles</option>
            {HEALTHCARE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <div className="flex items-center p-0.5 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full">
            {[
              { key: 'all', label: 'All Checks' },
              { key: 'verified', label: 'Verified' },
              { key: 'expiring_soon', label: 'Expiring ≤30d' },
              { key: 'expired', label: 'Expired' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setCredFilter(tab.key)}
                className={`min-h-[34px] px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                  credFilter === tab.key ? 'bg-white text-[#0B1F44] shadow-2xs' : 'text-[#52647D]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className="relative w-full lg:w-64 lg:ml-auto"
        >
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, skill, or email..."
            className="w-full min-h-[38px] pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-base sm:text-xs"
          />
        </form>
      </div>

      {/* Native Mobile Worker List + Compact Desktop Table */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-2.5">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-11 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : workers.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#52647D]">
            No workers match the selected filters.
          </div>
        ) : (
          <>
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {workers.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setActiveWorker(w)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-[#0B1F44] truncate">{w.fullName}</p>
                      <span
                        className={`text-[11px] font-semibold capitalize shrink-0 ${
                          w.availabilityStatus === 'available'
                            ? 'text-[#16A879]'
                            : w.availabilityStatus === 'unavailable'
                              ? 'text-[#DC4C64]'
                              : 'text-[#F59E0B]'
                        }`}
                      >
                        {w.availabilityStatus}
                      </span>
                    </div>
                    <p className="text-xs text-[#52647D] mt-0.5 truncate">
                      {w.primaryRole} · {w.employmentType}
                      {w.restrictionsJson?.noNightShifts ? ' · No nights' : ''}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[11px]">
                      {w.credentialHealth === 'expired' ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#DC4C64]">
                          <ShieldAlert className="w-3.5 h-3.5" /> Expired check
                        </span>
                      ) : w.credentialHealth === 'expiring_soon' ? (
                        <span className="font-semibold text-[#F59E0B]">Expiring ≤30d</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#16A879]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Verified ({w.credentials.length})
                        </span>
                      )}
                      <span className="text-slate-300">·</span>
                      <span className="text-[#52647D] truncate">
                        {w.facilities.map((f) => f.facilityName).join(', ')}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-[#52647D]">
                    <th className="py-2.5 px-4">Worker</th>
                    <th className="py-2.5 px-3">Role &amp; Basis</th>
                    <th className="py-2.5 px-3">Inducted Sites</th>
                    <th className="py-2.5 px-3">Availability</th>
                    <th className="py-2.5 px-3">Credentials</th>
                    <th className="py-2.5 px-4 text-right">Profile</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workers.map((w) => (
                    <tr
                      key={w.id}
                      onClick={() => setActiveWorker(w)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4">
                        <p className="font-semibold text-[#0B1F44] text-xs lg:text-sm">{w.fullName}</p>
                        <p className="text-xs text-[#52647D]">{w.email}</p>
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        <p className="font-medium text-[#0B1F44]">{w.primaryRole}</p>
                        <p className="text-[#52647D]">{w.employmentType}</p>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-[#52647D] max-w-[200px] truncate">
                        {w.facilities.map((f) => f.facilityName).join(', ')}
                      </td>
                      <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                        <span
                          className={`font-semibold capitalize ${
                            w.availabilityStatus === 'available'
                              ? 'text-[#16A879]'
                              : w.availabilityStatus === 'unavailable'
                                ? 'text-[#DC4C64]'
                                : 'text-[#F59E0B]'
                          }`}
                        >
                          {w.availabilityStatus}
                        </span>
                        {w.restrictionsJson?.noNightShifts && (
                          <span className="text-[#52647D] ml-1">· No nights</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                        {w.credentialHealth === 'expired' ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-[#DC4C64]">
                            <ShieldAlert className="w-3.5 h-3.5" /> Expired
                          </span>
                        ) : w.credentialHealth === 'expiring_soon' ? (
                          <span className="font-semibold text-[#F59E0B]">Expiring ≤30d</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-[#16A879]">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Verified ({w.credentials.length})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveWorker(w);
                          }}
                          className="text-xs font-semibold text-[#0E8BFF] hover:text-[#0B1F44] cursor-pointer"
                        >
                          Inspect →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Accessible Worker Profile Drawer */}
      {activeWorker && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="worker-drawer-title"
          className="fixed inset-0 z-50 bg-[#0B1F44]/50 flex justify-end"
        >
          <div className="bg-white w-full max-w-lg h-full overflow-y-auto p-4 sm:p-6 shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="flex items-start justify-between gap-4 pb-3.5 border-b border-slate-100">
              <div>
                <h2 id="worker-drawer-title" className="text-lg font-bold text-[#0B1F44]">
                  {activeWorker.fullName}
                </h2>
                <p className="text-xs text-[#52647D] mt-0.5">
                  {activeWorker.primaryRole} · {activeWorker.employmentType}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveWorker(null)}
                aria-label="Close worker drawer"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-[#0B1F44] hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-5 flex-1 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <p className="text-[#52647D]">Contact</p>
                  <p className="font-semibold text-[#0B1F44] font-mono mt-0.5">{activeWorker.phone}</p>
                  <p className="text-[#52647D] truncate">{activeWorker.email}</p>
                </div>
                <div>
                  <p className="text-[#52647D]">Preferences &amp; Limits</p>
                  <p className="font-semibold text-[#0B1F44] mt-0.5 tabular-nums">
                    {activeWorker.preferredChannel.toUpperCase()} · Max {activeWorker.maxWeeklyHours}h/wk
                  </p>
                  <p className="text-[#52647D] tabular-nums">
                    Min rest {activeWorker.minRestHours}h · Radius {activeWorker.travelRadiusKm}km
                  </p>
                </div>
              </div>

              {activeWorker.restrictionsJson?.noNightShifts && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[#0B1F44]">
                  <strong>Work restriction:</strong> No overnight shifts (
                  {activeWorker.restrictionsJson.notes || 'Configured on profile'}).
                </div>
              )}

              <div>
                <p className="font-bold text-[#0B1F44] mb-1.5">Clinical Skills</p>
                <p className="text-[#52647D]">{activeWorker.skills.join(' · ') || 'None listed'}</p>
              </div>

              <div>
                <p className="font-bold text-[#0B1F44] mb-2">Qualifications &amp; Credential Verification</p>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {activeWorker.credentials.map((cred) => (
                    <div key={cred.id} className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#0B1F44]">
                            {cred.code} — {cred.name}
                          </p>
                          <p className="text-[#52647D] font-mono tabular-nums mt-0.5">
                            Ref: {cred.referenceNumber} · Exp {cred.expiresAt.slice(0, 10)}
                          </p>
                        </div>
                        <span
                          className={`font-bold uppercase shrink-0 ${
                            cred.isExpired
                              ? 'text-[#DC4C64]'
                              : cred.isExpiringSoon
                                ? 'text-[#F59E0B]'
                                : 'text-[#16A879]'
                          }`}
                        >
                          {cred.reviewStatus}
                        </span>
                      </div>

                      {canReviewCreds && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleReviewCredential(cred.id, 'verified', true)}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#0B1F44] text-white font-semibold hover:bg-[#132f63] cursor-pointer"
                          >
                            Verify &amp; Renew (+12m)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReviewCredential(cred.id, 'rejected', false)}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 text-[#DC4C64] font-semibold hover:bg-red-50 cursor-pointer"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Worker Modal */}
      {addOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#0B1F44]/60 flex items-end sm:items-center justify-center sm:p-4"
        >
          <div className="bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 shadow-xl pb-safe">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-[#0B1F44]">Add Worker Profile</h2>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                aria-label="Close"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-[#0B1F44] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddWorker} className="mt-4 space-y-3 text-base sm:text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  required
                  placeholder="First name"
                  value={newWorker.firstName}
                  onChange={(e) => setNewWorker({ ...newWorker, firstName: e.target.value })}
                  className="min-h-[42px] rounded-lg border border-slate-300 px-3 py-2"
                />
                <input
                  required
                  placeholder="Last name"
                  value={newWorker.lastName}
                  onChange={(e) => setNewWorker({ ...newWorker, lastName: e.target.value })}
                  className="min-h-[42px] rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={newWorker.email}
                  onChange={(e) => setNewWorker({ ...newWorker, email: e.target.value })}
                  className="min-h-[42px] rounded-lg border border-slate-300 px-3 py-2"
                />
                <input
                  required
                  placeholder={market.phonePlaceholder}
                  value={newWorker.phone}
                  onChange={(e) => setNewWorker({ ...newWorker, phone: e.target.value })}
                  className="min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 font-mono"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={newWorker.primaryRole}
                  onChange={(e) => setNewWorker({ ...newWorker, primaryRole: e.target.value })}
                  className="min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 bg-white"
                >
                  {HEALTHCARE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <select
                  value={newWorker.facilityId}
                  onChange={(e) => setNewWorker({ ...newWorker, facilityId: e.target.value })}
                  className="min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 bg-white"
                >
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold cursor-pointer"
                >
                  Save Worker
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {csvOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#0B1F44]/60 flex items-end sm:items-center justify-center sm:p-4"
        >
          <div className="bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 shadow-xl pb-safe">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-[#0B1F44]">Import Workers via CSV</h2>
              <button
                type="button"
                onClick={() => setCsvOpen(false)}
                aria-label="Close"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-[#0B1F44] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCsvImport} className="mt-4 space-y-3 text-xs">
              <p className="text-[#52647D]">
                Format: <code>firstName,lastName,email,phone,primaryRole,employmentType</code>
              </p>
              <select
                value={newWorker.facilityId}
                onChange={(e) => setNewWorker({ ...newWorker, facilityId: e.target.value })}
                className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 bg-white text-base sm:text-sm"
              >
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    Primary Facility: {f.name}
                  </option>
                ))}
              </select>
              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCsvOpen(false)}
                  className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#0B1F44] text-white font-semibold cursor-pointer"
                >
                  Import Rows
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
