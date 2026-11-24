import React, { useEffect, useState } from 'react';
import { Bell, Clock, Plus, RefreshCw, ShieldCheck, Sliders, X } from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useToast } from '../components/Toast.tsx';
import type { DispatchMode } from '../../shared/types.ts';

interface CoveragePolicy {
  id: string;
  name: string;
  description: string;
  dispatchMode: DispatchMode;
  batchSize: number;
  responseWindowMinutes: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  maxAttempts: number;
  reminderAfterMinutes: number;
  channelsJson: string[];
  escalationRecipientRole: string;
  escalationRecipientEmail: string;
  requireManagerConfirmation: boolean;
  active: boolean;
}

const MODE_LABELS: Record<DispatchMode, string> = {
  sequential: 'Sequential (1-by-1 ranked)',
  tiered: 'Tiered Waves (Controlled batches)',
  parallel_waves: 'Parallel Urgent Waves',
};

export const PoliciesView: React.FC = () => {
  const { session } = useAuth();
  const { pushToast } = useToast();
  const canManage = Boolean(session?.permissions.includes('policies:manage'));

  const [policies, setPolicies] = useState<CoveragePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    description: '',
    dispatchMode: 'tiered' as DispatchMode,
    batchSize: 3,
    responseWindowMinutes: 15,
    quietHoursStart: '22:00',
    quietHoursEnd: '06:00',
    maxAttempts: 3,
    reminderAfterMinutes: 8,
    channelsJson: ['in_app', 'sms'] as Array<'in_app' | 'sms' | 'email'>,
    escalationRecipientRole: 'operations_manager',
    escalationRecipientEmail: 'ops.escalation@harbourview.demo',
    requireManagerConfirmation: false,
  });

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ policies: CoveragePolicy[] }>('/api/policies');
      setPolicies(res.policies);
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to load coverage policies.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleChannel = (ch: 'in_app' | 'sms' | 'email') => {
    setForm((prev) => {
      const exists = prev.channelsJson.includes(ch);
      if (exists && prev.channelsJson.length === 1) return prev;
      return {
        ...prev,
        channelsJson: exists ? prev.channelsJson.filter((c) => c !== ch) : [...prev.channelsJson, ch],
      };
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/policies', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          batchSize: Number(form.batchSize),
          responseWindowMinutes: Number(form.responseWindowMinutes),
          maxAttempts: Number(form.maxAttempts),
          reminderAfterMinutes: Number(form.reminderAfterMinutes),
        }),
      });
      pushToast({ type: 'success', title: 'Coverage policy created and available for Autopilot runs.' });
      setShowCreate(false);
      setForm({
        name: '',
        description: '',
        dispatchMode: 'tiered',
        batchSize: 3,
        responseWindowMinutes: 15,
        quietHoursStart: '22:00',
        quietHoursEnd: '06:00',
        maxAttempts: 3,
        reminderAfterMinutes: 8,
        channelsJson: ['in_app', 'sms'],
        escalationRecipientRole: 'operations_manager',
        escalationRecipientEmail: 'ops.escalation@harbourview.demo',
        requireManagerConfirmation: false,
      });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to create policy.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">
            Coverage Policies &amp; Autopilot Rules
          </h1>
          <p className="text-xs text-[#52647D] mt-0.5">
            Deterministic outreach waves, quiet hours, escalation recipients, and confirmation rules
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            aria-label="Refresh policies"
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
              New Policy
            </button>
          )}
        </div>
      </div>

      {loading && policies.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-28 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 sm:gap-4">
          {policies.map((p) => (
            <div
              key={p.id}
              className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5 flex flex-col justify-between gap-3.5"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0E8BFF]">{MODE_LABELS[p.dispatchMode]}</p>
                    <h2 className="mt-0.5 text-base font-bold text-[#0B1F44]">{p.name}</h2>
                  </div>
                  <span className="text-xs font-semibold text-[#16A879] shrink-0">
                    {p.active ? 'Active' : 'Archived'}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-[#52647D] leading-relaxed">{p.description}</p>

                <div className="mt-3.5 grid grid-cols-3 gap-2.5 pt-3 border-t border-slate-100 text-xs">
                  <div>
                    <p className="text-[11px] text-[#52647D]">Wave Batch</p>
                    <p className="mt-0.5 font-mono font-semibold text-[#0B1F44] tabular-nums">
                      {p.batchSize} × {p.maxAttempts}w
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#52647D]">Window</p>
                    <p className="mt-0.5 font-mono font-semibold text-[#0B1F44] tabular-nums">
                      {p.responseWindowMinutes}m ({p.reminderAfterMinutes}m rem)
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#52647D]">Quiet Hours</p>
                    <p className="mt-0.5 font-mono font-semibold text-[#0B1F44] tabular-nums">
                      {p.quietHoursStart}–{p.quietHoursEnd}
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-[#52647D]">
                <div className="flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-[#0E8BFF]" />
                  <span className="font-medium text-[#0B1F44] uppercase">
                    {p.channelsJson.join(' · ')}
                  </span>
                </div>
                <div>
                  {p.requireManagerConfirmation ? (
                    <span className="text-[#F59E0B] font-semibold inline-flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" /> Sign-off required
                    </span>
                  ) : (
                    <span className="text-[#16A879] font-medium inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Auto-confirm
                    </span>
                  )}
                </div>
                <div className="w-full text-[11px] text-[#52647D] truncate">
                  Escalation: <span className="font-semibold text-[#0B1F44]">{p.escalationRecipientRole}</span> ({p.escalationRecipientEmail})
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Deterministic Stop-Rule Explanation */}
      <div className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5">
        <h3 className="text-sm font-bold text-[#0B1F44] flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[#0E8BFF]" />
          Built-in Stop &amp; Escalation Guardrails
        </h3>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs text-[#52647D] leading-relaxed">
          <div>
            <p className="font-semibold text-[#0B1F44]">1. Immediate Atomic Stop</p>
            <p className="mt-1">
              The instant a shift reaches headcount, PostgreSQL row locking withdraws all remaining pending offers atomically.
            </p>
          </div>
          <div>
            <p className="font-semibold text-[#0B1F44]">2. Quiet-Hour Respect</p>
            <p className="mt-1">
              Non-critical outreach pauses during quiet windows. Critical clinical gaps require audited coordinator bypass.
            </p>
          </div>
          <div>
            <p className="font-semibold text-[#0B1F44]">3. Escalation When Exhausted</p>
            <p className="mt-1">
              If no eligible worker accepts after configured waves, Autopilot halts and alerts the designated Operations Manager.
            </p>
          </div>
        </div>
      </div>

      {/* Create Policy Modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1F44]/55 flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-policy-title"
        >
          <div className="w-full max-w-xl rounded-t-2xl sm:rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h2 id="create-policy-title" className="text-base font-bold text-[#0B1F44]">
                Create Coverage Autopilot Policy
              </h2>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                aria-label="Close modal"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#52647D] hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form id="create-policy-form" onSubmit={handleCreate} className="p-5 space-y-3.5 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Policy Name</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Weekend Complex Care Tiered Fill"
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Operational Description</label>
                <textarea
                  required
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="When to use this outreach rule and who it escalates to..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Dispatch Mode</label>
                  <select
                    value={form.dispatchMode}
                    onChange={(e) => setForm({ ...form, dispatchMode: e.target.value as DispatchMode })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] bg-white"
                  >
                    <option value="sequential">Sequential (1-by-1)</option>
                    <option value="tiered">Tiered Waves</option>
                    <option value="parallel_waves">Parallel Urgent Waves</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Workers per Wave</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    required
                    value={form.batchSize}
                    onChange={(e) => setForm({ ...form, batchSize: Number(e.target.value) })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Window (m)</label>
                  <input
                    type="number"
                    min={5}
                    max={240}
                    required
                    value={form.responseWindowMinutes}
                    onChange={(e) => setForm({ ...form, responseWindowMinutes: Number(e.target.value) })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Remind (m)</label>
                  <input
                    type="number"
                    min={2}
                    max={120}
                    required
                    value={form.reminderAfterMinutes}
                    onChange={(e) => setForm({ ...form, reminderAfterMinutes: Number(e.target.value) })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Max Waves</label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    required
                    value={form.maxAttempts}
                    onChange={(e) => setForm({ ...form, maxAttempts: Number(e.target.value) })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Quiet Start</label>
                  <input
                    type="time"
                    required
                    value={form.quietHoursStart}
                    onChange={(e) => setForm({ ...form, quietHoursStart: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Quiet End</label>
                  <input
                    type="time"
                    required
                    value={form.quietHoursEnd}
                    onChange={(e) => setForm({ ...form, quietHoursEnd: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-[#0B1F44] mb-1.5">Outreach Channels</p>
                <div className="flex flex-wrap items-center gap-4">
                  {(['in_app', 'sms', 'email'] as const).map((ch) => (
                    <label
                      key={ch}
                      className="inline-flex items-center gap-2 text-xs font-medium text-[#0B1F44] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={form.channelsJson.includes(ch)}
                        onChange={() => toggleChannel(ch)}
                        className="rounded border-slate-300 text-[#0E8BFF]"
                      />
                      {ch === 'in_app' ? 'In-App PWA' : ch.toUpperCase()}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Escalation Role</label>
                  <input
                    required
                    value={form.escalationRecipientRole}
                    onChange={(e) => setForm({ ...form, escalationRecipientRole: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Escalation Email</label>
                  <input
                    type="email"
                    required
                    value={form.escalationRecipientEmail}
                    onChange={(e) => setForm({ ...form, escalationRecipientEmail: e.target.value })}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44]"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-[#0B1F44] cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.requireManagerConfirmation}
                  onChange={(e) => setForm({ ...form, requireManagerConfirmation: e.target.checked })}
                  className="rounded border-slate-300 text-[#0E8BFF]"
                />
                Require explicit supervisor confirmation before locking accepted shift
              </label>
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
                form="create-policy-form"
                disabled={saving}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-[#0B1F44] hover:bg-[#132f63] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Policy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
