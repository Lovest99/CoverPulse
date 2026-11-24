import React, { useEffect, useState } from 'react';
import { Building2, MapPin, Phone, Plus, RefreshCw, Users, X } from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useMarket } from '../MarketContext.tsx';
import { ALL_TIMEZONE_GROUPS } from '../../shared/markets.ts';
import { useToast } from '../components/Toast.tsx';

interface FacilityItem {
  id: string;
  name: string;
  code: string;
  serviceType: 'Aged Care' | 'Disability Support' | 'Community Care';
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  timezone: string;
  phone: string;
  bedOrClientCapacity: number;
  active: boolean;
  openShiftsCount: number;
  inductedWorkersCount: number;
}

interface FacilitiesViewProps {
  onSelectFacilityFilter: (facilityId: string) => void;
}

export const FacilitiesView: React.FC<FacilitiesViewProps> = ({ onSelectFacilityFilter }) => {
  const { session } = useAuth();
  const { market } = useMarket();
  const { pushToast } = useToast();
  const canManage = Boolean(session?.permissions.includes('facilities:manage'));

  const [items, setItems] = useState<FacilityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    code: '',
    serviceType: 'Aged Care' as 'Aged Care' | 'Disability Support' | 'Community Care',
    address: '',
    suburb: '',
    state: market.regions[0] ?? 'NSW',
    postcode: market.postalPlaceholder,
    timezone: market.defaultTimezone,
    phone: market.phonePlaceholder,
    bedOrClientCapacity: 60,
  });

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      state: market.regions[0] ?? prev.state,
      postcode: market.postalPlaceholder,
      timezone: market.defaultTimezone,
      phone: market.phonePlaceholder,
    }));
  }, [market.code]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ facilities: FacilityItem[] }>('/api/facilities');
      setItems(res.facilities);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load facilities.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/facilities', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          bedOrClientCapacity: Number(form.bedOrClientCapacity) || 50,
        }),
      });
      pushToast({ type: 'success', title: 'Facility added and logged to audit trail.' });
      setShowCreate(false);
      setForm({
        name: '',
        code: '',
        serviceType: 'Aged Care',
        address: '',
        suburb: '',
        state: market.regions[0] ?? 'NSW',
        postcode: market.postalPlaceholder,
        timezone: market.defaultTimezone,
        phone: market.phonePlaceholder,
        bedOrClientCapacity: 60,
      });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to add facility.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">Facilities &amp; Sites</h1>
          <p className="text-xs text-[#52647D] mt-0.5">
            Active care facilities, site inductions, and timezone-scoped rosters ({items.length} accessible)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            aria-label="Refresh facilities"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-[#52647D] hover:text-[#0B1F44] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex-1 sm:flex-none min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0B1F44] hover:bg-[#132f63] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#06B6D4]" />
              Add Facility
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-white border border-[#DC4C64]/30 p-4 text-sm text-[#DC4C64]">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl bg-white border border-slate-200 p-10 text-center">
          <Building2 className="w-7 h-7 text-slate-400 mx-auto" />
          <p className="mt-2 text-sm font-semibold text-[#0B1F44]">No facilities in your current scope</p>
          <p className="mt-1 text-xs text-[#52647D]">
            Contact your Organisation Owner to assign site permissions or create a facility.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
          {items.map((fac) => (
            <div
              key={fac.id}
              className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5 flex flex-col justify-between gap-3.5 hover:border-slate-300 transition-colors"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-[#0E8BFF]">{fac.code}</span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="text-xs font-medium text-[#52647D] truncate">{fac.serviceType}</span>
                    </div>
                    <h2 className="mt-0.5 text-base font-bold text-[#0B1F44] truncate">{fac.name}</h2>
                  </div>
                  <span
                    className={`text-xs font-semibold shrink-0 ${fac.active ? 'text-[#16A879]' : 'text-[#52647D]'}`}
                  >
                    {fac.active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="mt-2.5 space-y-1 text-xs text-[#52647D]">
                  <p className="flex items-start gap-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>
                      {fac.address}, {fac.suburb} {fac.state} {fac.postcode}
                    </span>
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono tabular-nums">{fac.phone}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span>{fac.timezone}</span>
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
                  <span className="text-[#0B1F44] font-semibold">
                    {fac.openShiftsCount} open
                  </span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="text-[#52647D] inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {fac.inductedWorkersCount} inducted
                  </span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="text-[#52647D]">{fac.bedOrClientCapacity} cap.</span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFacilityFilter(fac.id)}
                  className="text-xs font-semibold text-[#0E8BFF] hover:text-[#0B1F44] whitespace-nowrap cursor-pointer self-start sm:self-auto"
                >
                  Open queue →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Facility Modal (Scrollable Bottom-Sheet on Mobile) */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1F44]/55 flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-facility-title"
        >
          <div className="w-full max-w-lg rounded-t-2xl sm:rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div>
                <h2 id="add-facility-title" className="text-base font-bold text-[#0B1F44]">
                  Add Care Facility ({market.name})
                </h2>
                <p className="text-xs text-[#52647D]">Plan facility entitlements are validated server-side.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                aria-label="Close modal"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#52647D] hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form id="add-facility-form" onSubmit={handleCreate} className="p-5 space-y-3.5 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Facility Name</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Parramatta Valley Care"
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Site Code</label>
                  <input
                    required
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    placeholder="PVC-05"
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Service Type</label>
                  <select
                    value={form.serviceType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        serviceType: e.target.value as 'Aged Care' | 'Disability Support' | 'Community Care',
                      })
                    }
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] bg-white"
                  >
                    <option value="Aged Care">Aged Care / Senior Living</option>
                    <option value="Disability Support">Disability &amp; Complex Care</option>
                    <option value="Community Care">Home &amp; Community Care</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Timezone</label>
                  <select
                    value={form.timezone}
                    onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] bg-white"
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

              <div>
                <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Street Address</label>
                <input
                  required
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="48 River Road"
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44]"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">{market.suburbLabel}</label>
                  <input
                    required
                    value={form.suburb}
                    onChange={(e) => setForm({ ...form, suburb: e.target.value })}
                    placeholder={market.suburbPlaceholder}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">{market.regionLabel}</label>
                  <select
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm text-[#0B1F44] bg-white"
                  >
                    {market.regions.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">{market.postalLabel}</label>
                  <input
                    required
                    value={form.postcode}
                    onChange={(e) => setForm({ ...form, postcode: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Site Phone</label>
                  <input
                    required
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Bed / Client Capacity</label>
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    required
                    value={form.bedOrClientCapacity}
                    onChange={(e) => setForm({ ...form, bedOrClientCapacity: Number(e.target.value) })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                </div>
              </div>
            </form>

            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0 pb-safe">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-[#52647D] hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="add-facility-form"
                disabled={saving}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-[#0B1F44] hover:bg-[#132f63] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
              >
                {saving ? 'Adding...' : 'Create Facility'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
