import React, { useEffect, useState } from 'react';
import { ChevronRight, Copy, Moon, Plus, Search, X } from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useMarket } from '../MarketContext.tsx';
import { useToast } from '../components/Toast.tsx';
import { HEALTHCARE_ROLES, SHIFT_STATUS_LABELS, type ShiftStatus } from '../../shared/types.ts';

interface ShiftListItem {
  id: string;
  facilityId: string;
  facilityName: string;
  facilityCode: string;
  title: string;
  roleRequired: string;
  shiftDate: string;
  startAt: string;
  endAt: string;
  breakMinutes: number;
  headcount: number;
  filledCount: number;
  urgency: string;
  status: ShiftStatus;
  isOvernight: boolean;
  paidHours: number;
  offersTotal: number;
  offersPending: number;
  escalatedAt: string | null;
  latestRun: {
    id: string;
    status: string;
    currentWave: number;
    totalWaves: number;
  } | null;
}

interface FacilityOption {
  id: string;
  name: string;
  code: string;
}

interface QualOption {
  id: string;
  code: string;
  name: string;
}

interface ShiftsViewProps {
  mode: 'queue' | 'all';
  selectedFacilityId: string;
  globalSearch: string;
  onOpenShift: (shiftId: string) => void;
}

export const ShiftsView: React.FC<ShiftsViewProps> = ({
  mode,
  selectedFacilityId,
  globalSearch,
  onOpenShift,
}) => {
  const { session } = useAuth();
  const { market } = useMarket();
  const { pushToast } = useToast();
  const canManage = session?.permissions.includes('shifts:manage') ?? false;

  const [shiftsList, setShiftsList] = useState<ShiftListItem[]>([]);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [qualifications, setQualifications] = useState<QualOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>(mode === 'queue' ? 'open_queue' : 'all');
  const [localSearch, setLocalSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    facilityId: '',
    title: 'Urgent RN Night Shift — Wing B',
    roleRequired: 'Registered Nurse (RN)',
    shiftDate: tomorrow,
    startTime: '22:00',
    endTime: '06:30',
    breakMinutes: 30,
    headcount: 1,
    urgency: 'critical' as 'standard' | 'high' | 'critical',
    hourlyRateAud: 68,
    showRateToWorker: true,
    requiresManagerConfirmation: false,
    publishNow: true,
    notes: 'Overnight clinical supervision. Verified active nursing registration and First Aid/CPR mandatory.',
    requiredQualificationIds: [] as string[],
    requiredSkillsText: 'Dementia Care',
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const q = (localSearch || globalSearch).trim();
      const apiStatus = statusFilter === 'open_queue' ? 'all' : statusFilter;
      const [res, qRes] = await Promise.all([
        apiFetch<{ shifts: ShiftListItem[]; facilities: FacilityOption[] }>(
          `/api/shifts?facilityId=${encodeURIComponent(selectedFacilityId)}&status=${encodeURIComponent(apiStatus)}&q=${encodeURIComponent(q)}`,
        ),
        apiFetch<{ qualifications: QualOption[] }>('/api/qualifications'),
      ]);

      let list = res.shifts;
      if (statusFilter === 'open_queue') {
        list = list.filter((s) => ['open', 'broadcasting', 'partially_covered'].includes(s.status));
      }
      setShiftsList(list);
      setFacilities(res.facilities);
      setQualifications(qRes.qualifications);

      if (!form.facilityId && res.facilities.length > 0) {
        const defaultQualIds = qRes.qualifications
          .filter((ql) => ql.code === 'AHPRA-RN' || ql.code === 'FIRST-AID-CPR')
          .map((ql) => ql.id);
        setForm((prev) => ({
          ...prev,
          facilityId: res.facilities[0].id,
          requiredQualificationIds:
            prev.requiredQualificationIds.length > 0 ? prev.requiredQualificationIds : defaultQualIds,
        }));
      }
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Unable to load shifts',
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setStatusFilter(mode === 'queue' ? 'open_queue' : 'all');
  }, [mode]);

  useEffect(() => {
    load();
  }, [selectedFacilityId, statusFilter, globalSearch]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch<{ shift: { id: string } }>('/api/shifts', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          requiredSkills: form.requiredSkillsText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setCreateOpen(false);
      pushToast({
        type: 'success',
        title: 'Shift created',
        detail: 'Deterministic candidate eligibility is ready to review.',
      });
      onOpenShift(res.shift.id);
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Could not create shift',
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (e: React.MouseEvent, shiftId: string) => {
    e.stopPropagation();
    try {
      await apiFetch(`/api/shifts/${shiftId}/duplicate`, { method: 'POST' });
      pushToast({ type: 'success', title: 'Shift duplicated into Draft' });
      load();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Duplicate failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const toggleQual = (id: string) => {
    setForm((prev) => ({
      ...prev,
      requiredQualificationIds: prev.requiredQualificationIds.includes(id)
        ? prev.requiredQualificationIds.filter((x) => x !== id)
        : [...prev.requiredQualificationIds, id],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">
            {mode === 'queue' ? 'Coverage Queue' : 'Shift Management'}
          </h1>
          <p className="text-xs text-[#52647D] mt-0.5">
            {mode === 'queue'
              ? 'Active unfilled, broadcasting, and escalated shifts requiring coordination.'
              : 'Create, publish, duplicate, and monitor shifts across authorised facilities.'}
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold hover:bg-[#132f63] transition-colors w-full sm:w-auto cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4 text-[#06B6D4]" />
            Create Shift
          </button>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        <div className="flex items-center p-0.5 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full">
          {[
            { key: 'open_queue', label: 'Active Queue' },
            { key: 'all', label: 'All Shifts' },
            { key: 'open', label: 'Open' },
            { key: 'broadcasting', label: 'Broadcasting' },
            { key: 'covered', label: 'Covered' },
            { key: 'draft', label: 'Draft' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`min-h-[34px] px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer shrink-0 ${
                statusFilter === tab.key
                  ? 'bg-white text-[#0B1F44] shadow-2xs'
                  : 'text-[#52647D] hover:text-[#0B1F44]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className="relative w-full md:w-60"
        >
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Filter by title or role..."
            aria-label="Filter shifts"
            className="w-full min-h-[38px] pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-base sm:text-xs text-[#0B1F44] focus:border-[#0E8BFF] focus:outline-none"
          />
        </form>
      </div>

      {/* Compact Desktop Table & Native Mobile Cards */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-2.5">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-11 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : shiftsList.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold text-[#0B1F44]">No shifts match this filter</p>
            <p className="text-xs text-[#52647D] mt-1">
              Adjust the facility or status filter, or create a new shift to launch Coverage Autopilot.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-[#52647D]">
                    <th className="py-2.5 px-4">Priority &amp; Shift</th>
                    <th className="py-2.5 px-3">Facility</th>
                    <th className="py-2.5 px-3">Role</th>
                    <th className="py-2.5 px-3">Date &amp; Hours</th>
                    <th className="py-2.5 px-3">Coverage Stage</th>
                    <th className="py-2.5 px-3">Fill</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shiftsList.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => onOpenShift(s.id)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[11px] font-bold uppercase shrink-0 ${
                              s.escalatedAt || s.urgency === 'critical'
                                ? 'text-[#DC4C64]'
                                : s.urgency === 'high'
                                  ? 'text-[#F59E0B]'
                                  : 'text-[#52647D]'
                            }`}
                          >
                            {s.escalatedAt ? 'Escalated' : s.urgency}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="font-semibold text-[#0B1F44] text-xs lg:text-sm truncate max-w-[240px]">
                            {s.title}
                          </span>
                          {s.isOvernight && (
                            <Moon className="w-3.5 h-3.5 text-[#0E8BFF] shrink-0" aria-label="Overnight shift" />
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-[#52647D]">{s.facilityName}</td>
                      <td className="py-2.5 px-3 text-xs text-[#0B1F44]">{s.roleRequired}</td>
                      <td className="py-2.5 px-3 text-xs font-mono tabular-nums text-[#0B1F44] whitespace-nowrap">
                        {s.shiftDate} · {s.paidHours}h
                      </td>
                      <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            s.status === 'covered'
                              ? 'text-[#16A879]'
                              : s.escalatedAt
                                ? 'text-[#DC4C64]'
                                : s.status === 'broadcasting'
                                  ? 'text-[#0E8BFF]'
                                  : 'text-[#0B1F44]'
                          }`}
                        >
                          {SHIFT_STATUS_LABELS[s.status]}
                        </span>
                        {s.latestRun && (
                          <span className="text-[#52647D] ml-1 tabular-nums">
                            · W{s.latestRun.currentWave}/{Math.max(1, s.latestRun.totalWaves)} ({s.offersTotal})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-xs font-mono tabular-nums text-[#0B1F44]">
                        {s.filledCount}/{s.headcount}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {canManage && (
                            <button
                              type="button"
                              onClick={(e) => handleDuplicate(e, s.id)}
                              title="Duplicate shift"
                              aria-label={`Duplicate ${s.title}`}
                              className="p-1.5 rounded text-slate-400 hover:text-[#0B1F44] hover:bg-slate-100 cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenShift(s.id);
                            }}
                            className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-semibold text-[#0B1F44] hover:border-[#0E8BFF] cursor-pointer"
                          >
                            Open
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {shiftsList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onOpenShift(s.id)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span
                        className={`font-bold uppercase ${
                          s.escalatedAt || s.urgency === 'critical'
                            ? 'text-[#DC4C64]'
                            : s.urgency === 'high'
                              ? 'text-[#F59E0B]'
                              : 'text-[#52647D]'
                        }`}
                      >
                        {s.escalatedAt ? 'Escalated' : s.urgency}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span
                        className={`font-semibold ${
                          s.status === 'covered'
                            ? 'text-[#16A879]'
                            : s.status === 'broadcasting'
                              ? 'text-[#0E8BFF]'
                              : 'text-[#0B1F44]'
                        }`}
                      >
                        {SHIFT_STATUS_LABELS[s.status]} ({s.filledCount}/{s.headcount})
                      </span>
                      {s.isOvernight && <Moon className="w-3 h-3 text-[#0E8BFF]" />}
                    </div>
                    <p className="mt-0.5 text-sm font-bold text-[#0B1F44] truncate">{s.title}</p>
                    <p className="mt-0.5 text-xs text-[#52647D] tabular-nums truncate">
                      {s.facilityName} · {s.roleRequired} · {s.shiftDate} ({s.paidHours}h)
                    </p>
                    {s.latestRun && (
                      <p className="mt-0.5 text-[11px] font-mono text-[#52647D] tabular-nums">
                        Wave {s.latestRun.currentWave}/{Math.max(1, s.latestRun.totalWaves)} · {s.offersTotal} offers dispatched
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Sticky Header & Footer Create Shift Modal (Bottom-Sheet on Mobile) */}
      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-shift-title"
          className="fixed inset-0 z-50 bg-[#0B1F44]/60 flex items-end sm:items-center justify-center sm:p-4"
        >
          <div className="bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-w-2xl w-full max-h-[92vh] flex flex-col shadow-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h2 id="create-shift-title" className="text-base font-bold text-[#0B1F44]">
                Create Shift
              </h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                aria-label="Close modal"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-[#0B1F44] hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form id="create-shift-form" onSubmit={handleCreate} className="overflow-y-auto px-5 py-4 space-y-3.5 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Facility *</label>
                  <select
                    required
                    value={form.facilityId}
                    onChange={(e) => setForm({ ...form, facilityId: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm bg-white"
                  >
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Required Role *</label>
                  <select
                    value={form.roleRequired}
                    onChange={(e) => setForm({ ...form, roleRequired: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm bg-white"
                  >
                    {HEALTHCARE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Shift Title *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    value={form.shiftDate}
                    onChange={(e) => setForm({ ...form, shiftDate: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Start *</label>
                  <input
                    type="time"
                    required
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">End *</label>
                  <input
                    type="time"
                    required
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Break (min)</label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={form.breakMinutes}
                    onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono"
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#52647D]">
                Overnight shifts (end earlier than start, e.g. 22:00–06:30) span midnight automatically in site timezone.
              </p>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Headcount</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={form.headcount}
                    onChange={(e) => setForm({ ...form, headcount: Number(e.target.value) })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Urgency</label>
                  <select
                    value={form.urgency}
                    onChange={(e) =>
                      setForm({ ...form, urgency: e.target.value as 'standard' | 'high' | 'critical' })
                    }
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm bg-white"
                  >
                    <option value="standard">Standard</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">
                    Rate ({market.currencyCode})
                  </label>
                  <input
                    type="number"
                    min={25}
                    max={250}
                    value={form.hourlyRateAud}
                    onChange={(e) => setForm({ ...form, hourlyRateAud: Number(e.target.value) })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B1F44] mb-1.5">
                  Mandatory Verified Qualifications (Deterministic Hard Filters)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {qualifications.map((q) => (
                    <label
                      key={q.id}
                      className="flex items-center gap-2 text-xs text-[#0B1F44] border border-slate-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={form.requiredQualificationIds.includes(q.id)}
                        onChange={() => toggleQual(q.id)}
                      />
                      <span className="font-mono font-semibold">{q.code}</span>
                      <span className="text-[#52647D] truncate">{q.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B1F44] mb-1">
                  Preferred Clinical Skills (ranking only)
                </label>
                <input
                  type="text"
                  value={form.requiredSkillsText}
                  onChange={(e) => setForm({ ...form, requiredSkillsText: e.target.value })}
                  placeholder="Dementia Care, Wound Management"
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Handover Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
                />
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-xs text-[#0B1F44]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.publishNow}
                    onChange={(e) => setForm({ ...form, publishNow: e.target.checked })}
                  />
                  Publish immediately
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.showRateToWorker}
                    onChange={(e) => setForm({ ...form, showRateToWorker: e.target.checked })}
                  />
                  Show rate to workers
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.requiresManagerConfirmation}
                    onChange={(e) => setForm({ ...form, requiresManagerConfirmation: e.target.checked })}
                  />
                  Require manager sign-off
                </label>
              </div>
            </form>

            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2.5 shrink-0 pb-safe">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-[#0B1F44] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="create-shift-form"
                disabled={saving}
                className="min-h-[40px] px-5 py-2 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold hover:bg-[#132f63] disabled:opacity-60 cursor-pointer"
              >
                {saving ? 'Creating...' : form.publishNow ? 'Create & Publish' : 'Save Draft'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
