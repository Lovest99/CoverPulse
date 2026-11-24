import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FastForward,
  Lock,
  Moon,
  Play,
  ShieldAlert,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useMarket } from '../MarketContext.tsx';
import { useToast } from '../components/Toast.tsx';
import { formatMarketCents } from '../../shared/markets.ts';
import {
  SHIFT_STATUS_LABELS,
  type EligibilityEvaluationResult,
  type ShiftStatus,
} from '../../shared/types.ts';

interface ShiftDetailPayload {
  shift: {
    id: string;
    facilityId: string;
    title: string;
    roleRequired: string;
    shiftDate: string;
    startAt: string;
    endAt: string;
    breakMinutes: number;
    paidHours: number;
    headcount: number;
    filledCount: number;
    urgency: string;
    status: ShiftStatus;
    isOvernight: boolean;
    hourlyRateCents: number;
    showRateToWorker: boolean;
    requiresManagerConfirmation: boolean;
    notes: string | null;
    escalatedAt: string | null;
    escalationReason: string | null;
  };
  facility: {
    id: string;
    name: string;
    code: string;
    suburb: string;
    state: string;
    timezone: string;
  };
  requirements: Array<{
    id: string;
    qualCode: string | null;
    qualName: string | null;
    requiredSkillName: string | null;
    isMandatory: boolean;
  }>;
  candidates: EligibilityEvaluationResult[];
  runs: Array<{
    id: string;
    status: string;
    currentWave: number;
    totalWaves: number;
    startedAt: string;
    stoppedReason: string | null;
  }>;
  offers: Array<{
    id: string;
    workerId: string;
    workerFirstName: string;
    workerLastName: string;
    waveNumber: number;
    channel: string;
    status: string;
    sentAt: string;
    expiresAt: string;
    respondedAt: string | null;
    declineReason: string | null;
  }>;
  assignments: Array<{
    id: string;
    workerId: string;
    workerFirstName: string;
    workerLastName: string;
    workerRole: string;
    status: string;
    isOverride: boolean;
    overrideReason: string | null;
    confirmedAt: string | null;
  }>;
  timeline: Array<{
    id: string;
    eventType: string;
    channel: string | null;
    summary: string;
    createdAt: string;
  }>;
  policies: Array<{
    id: string;
    name: string;
    dispatchMode: string;
    batchSize: number;
    responseWindowMinutes: number;
  }>;
}

interface ShiftDetailViewProps {
  shiftId: string;
  onBack: () => void;
}

export const ShiftDetailView: React.FC<ShiftDetailViewProps> = ({ shiftId, onBack }) => {
  const { session } = useAuth();
  const { market } = useMarket();
  const { pushToast } = useToast();
  const canRunAutopilot = session?.permissions.includes('autopilot:run') ?? false;
  const canManage = session?.permissions.includes('shifts:manage') ?? false;
  const canOverride = session?.permissions.includes('shifts:override') ?? false;

  const [data, setData] = useState<ShiftDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [candidateTab, setCandidateTab] = useState<'eligible' | 'excluded'>('eligible');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [overrideTarget, setOverrideTarget] = useState<EligibilityEvaluationResult | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const [aiResult, setAiResult] = useState<{
    summary: string;
    model: string;
    disclaimer: string;
  } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ShiftDetailPayload>(`/api/shifts/${shiftId}`);
      setData(res);
      if (!selectedPolicyId && res.policies.length > 0) {
        setSelectedPolicyId(res.policies[0].id);
      }
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Unable to load shift detail',
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [shiftId]);

  const handleStartAutopilot = async () => {
    if (!selectedPolicyId) return;
    setBusyAction('start');
    try {
      const res = await apiFetch<{ dispatchedOffers: unknown[]; escalated: boolean; eligibleCount: number }>(
        `/api/shifts/${shiftId}/autopilot/start`,
        {
          method: 'POST',
          body: JSON.stringify({ policyId: selectedPolicyId, bypassQuietHours: true }),
        },
      );
      pushToast({
        type: res.escalated ? 'info' : 'success',
        title: res.escalated ? 'Escalated immediately' : 'Coverage Autopilot launched',
        detail: res.escalated
          ? 'Zero eligible candidates matched mandatory rules.'
          : `Dispatched Wave 1 to ${res.dispatchedOffers.length} of ${res.eligibleCount} eligible workers.`,
      });
      load();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Autopilot could not start',
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleAdvanceOrEscalate = async () => {
    setBusyAction('advance');
    try {
      const res = await apiFetch<{ action: string; wave?: number; escalationReason?: string }>(
        `/api/shifts/${shiftId}/autopilot/advance`,
        { method: 'POST', body: JSON.stringify({ reason: 'Response window closed with no acceptance' }) },
      );
      pushToast({
        type: res.action === 'escalated' ? 'info' : 'success',
        title: res.action === 'escalated' ? 'Shift escalated to Operations Manager' : `Dispatched Wave ${res.wave}`,
        detail: res.escalationReason,
      });
      load();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Advance wave failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleStatusChange = async (nextStatus: 'open' | 'cancelled') => {
    setBusyAction(nextStatus);
    try {
      await apiFetch(`/api/shifts/${shiftId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      pushToast({
        type: 'success',
        title: nextStatus === 'open' ? 'Shift published' : 'Shift cancelled',
      });
      load();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Update failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleManualOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideTarget) return;
    setBusyAction('override');
    try {
      await apiFetch(`/api/shifts/${shiftId}/override-assign`, {
        method: 'POST',
        body: JSON.stringify({ workerId: overrideTarget.workerId, reason: overrideReason }),
      });
      pushToast({
        type: 'success',
        title: 'Assignment recorded',
        detail: `${overrideTarget.workerName} assigned with immutable audit entry.`,
      });
      setOverrideTarget(null);
      setOverrideReason('');
      load();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Assignment blocked',
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmAssignment = async (assignmentId: string) => {
    setBusyAction(assignmentId);
    try {
      await apiFetch(`/api/shifts/${shiftId}/assignments/${assignmentId}/confirm`, { method: 'POST' });
      pushToast({ type: 'success', title: 'Shift assignment confirmed' });
      load();
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Confirmation failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleAiExplain = async () => {
    setBusyAction('ai');
    setAiError(null);
    try {
      const res = await apiFetch<{ summary: string; model: string; disclaimer: string }>(
        `/api/shifts/${shiftId}/ai-explain`,
        { method: 'POST' },
      );
      setAiResult(res);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to fetch AI decision-support explanation.');
    } finally {
      setBusyAction(null);
    }
  };

  if (loading || !data) {
    return <div className="h-80 rounded-xl bg-white border border-slate-200 animate-pulse" />;
  }

  const { shift, facility, requirements, candidates, runs, offers, assignments, timeline, policies } = data;
  const eligibleCandidates = candidates.filter((c) => c.eligible);
  const excludedCandidates = candidates.filter((c) => !c.eligible);
  const activeRun = runs.find((r) => r.status === 'running') ?? null;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[38px] inline-flex items-center gap-1.5 text-xs font-semibold text-[#52647D] hover:text-[#0B1F44] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to shifts
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && shift.status === 'draft' && (
            <button
              type="button"
              onClick={() => handleStatusChange('open')}
              disabled={busyAction !== null}
              className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#0E8BFF] text-white text-xs font-semibold hover:bg-[#0B1F44] cursor-pointer"
            >
              Publish Shift
            </button>
          )}
          {canManage && !['cancelled', 'covered', 'expired'].includes(shift.status) && (
            <button
              type="button"
              onClick={() => handleStatusChange('cancelled')}
              disabled={busyAction !== null}
              className="min-h-[38px] px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-[#DC4C64] hover:bg-red-50 cursor-pointer"
            >
              Cancel Shift
            </button>
          )}
        </div>
      </div>

      {/* Compact Shift Header Card */}
      <div className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span
                className={`font-bold uppercase ${
                  shift.status === 'covered'
                    ? 'text-[#16A879]'
                    : shift.escalatedAt
                      ? 'text-[#DC4C64]'
                      : 'text-[#0E8BFF]'
                }`}
              >
                {SHIFT_STATUS_LABELS[shift.status]}
              </span>
              <span className="text-slate-300">·</span>
              <span className="font-semibold text-[#0B1F44]">{facility.name} ({facility.code})</span>
              <span className="text-slate-300">·</span>
              <span className="text-[#52647D]">{facility.suburb}, {facility.state}</span>
              {shift.isOvernight && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-[#0E8BFF]">
                    <Moon className="w-3.5 h-3.5" /> Overnight
                  </span>
                </>
              )}
            </div>

            <h1 className="mt-1.5 text-lg sm:text-2xl font-bold text-[#0B1F44] tracking-tight">
              {shift.title}
            </h1>
            {shift.notes && <p className="mt-1 text-xs sm:text-sm text-[#52647D] max-w-2xl">{shift.notes}</p>}

            {/* Structured 4-Cell Metadata Strip */}
            <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-3 border-t border-slate-100 text-xs">
              <div>
                <p className="text-[11px] text-[#52647D]">Role</p>
                <p className="font-semibold text-[#0B1F44] mt-0.5 truncate">{shift.roleRequired}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#52647D]">Date &amp; Hours</p>
                <p className="font-semibold font-mono tabular-nums text-[#0B1F44] mt-0.5">
                  {shift.shiftDate} · {shift.paidHours}h
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#52647D]">Headcount</p>
                <p className="font-semibold font-mono tabular-nums text-[#0B1F44] mt-0.5">
                  {shift.filledCount}/{shift.headcount} filled
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#52647D]">Hourly Rate</p>
                <p className="font-semibold font-mono tabular-nums text-[#0B1F44] mt-0.5">
                  {formatMarketCents(shift.hourlyRateCents, market, { decimals: 2 })}/h
                </p>
              </div>
            </div>

            {requirements.length > 0 && (
              <p className="mt-2.5 text-xs text-[#52647D]">
                <strong className="text-[#0B1F44]">Mandatory checks:</strong>{' '}
                {requirements
                  .filter((r) => r.qualCode)
                  .map((r) => `${r.qualCode} (${r.qualName})`)
                  .join(' · ') || 'Role & active status'}
                {requirements.some((r) => r.requiredSkillName) && (
                  <>
                    {' · '}
                    <strong className="text-[#0B1F44]">Preferred skills:</strong>{' '}
                    {requirements
                      .filter((r) => r.requiredSkillName)
                      .map((r) => r.requiredSkillName)
                      .join(', ')}
                  </>
                )}
              </p>
            )}
          </div>

          {/* Autopilot Action Panel */}
          {shift.status !== 'covered' && shift.status !== 'cancelled' && (
            <div className="lg:w-76 shrink-0 rounded-lg bg-[#F8FAFC] border border-slate-200 p-3.5 space-y-2.5">
              <p className="text-xs font-bold text-[#0B1F44]">Coverage Autopilot</p>
              {activeRun ? (
                <div className="space-y-2">
                  <p className="text-xs text-[#0E8BFF] font-semibold tabular-nums">
                    Running · Wave {activeRun.currentWave} of {Math.max(1, activeRun.totalWaves)}
                  </p>
                  <p className="text-xs text-[#52647D] leading-snug">
                    Waiting for worker response. Switch to Chloe Nguyen&apos;s Worker PWA to accept live, or
                    close this wave to advance/escalate.
                  </p>
                  {canRunAutopilot && (
                    <button
                      type="button"
                      onClick={handleAdvanceOrEscalate}
                      disabled={busyAction !== null}
                      className="w-full min-h-[40px] py-2 px-3 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold hover:bg-[#132f63] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FastForward className="w-3.5 h-3.5 text-[#06B6D4]" />
                      {busyAction === 'advance' ? 'Processing...' : 'Close Wave & Advance / Escalate'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <select
                    aria-label="Select coverage policy"
                    value={selectedPolicyId}
                    onChange={(e) => setSelectedPolicyId(e.target.value)}
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0B1F44]"
                  >
                    {policies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.dispatchMode}, batch {p.batchSize})
                      </option>
                    ))}
                  </select>
                  {canRunAutopilot ? (
                    <button
                      type="button"
                      onClick={handleStartAutopilot}
                      disabled={busyAction !== null || shift.status === 'draft'}
                      className="w-full min-h-[40px] py-2 px-3 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold hover:bg-[#132f63] disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 text-[#06B6D4]" />
                      {busyAction === 'start'
                        ? 'Dispatching Wave 1...'
                        : shift.status === 'draft'
                          ? 'Publish shift first'
                          : `Start Autopilot (${eligibleCandidates.length} eligible)`}
                    </button>
                  ) : (
                    <p className="text-xs text-[#52647D]">Read-only access — cannot launch offers.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Escalation Alert */}
        {shift.escalatedAt && shift.status !== 'covered' && (
          <div className="mt-4 rounded-lg border border-[#DC4C64]/30 bg-[#DC4C64]/5 px-3.5 py-2.5 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#DC4C64] shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-bold text-[#DC4C64]">Auditable Escalation Active</p>
              <p className="text-[#0B1F44] mt-0.5">{shift.escalationReason}</p>
            </div>
          </div>
        )}

        {/* Confirmed / Pending Assignments */}
        {assignments.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-slate-100 space-y-2">
            <p className="text-xs font-bold text-[#0B1F44]">Assigned Clinicians / Workers</p>
            {assignments.map((a) => (
              <div
                key={a.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg bg-[#16A879]/5 border border-[#16A879]/25 px-3.5 py-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#16A879] shrink-0" />
                  <span className="font-bold text-[#0B1F44]">
                    {a.workerFirstName} {a.workerLastName}
                  </span>
                  <span className="text-[#52647D]">· {a.workerRole}</span>
                  <span className="font-semibold text-[#16A879]">
                    · {a.status === 'confirmed' ? 'Confirmed' : 'Pending Sign-off'}
                  </span>
                  {a.isOverride && (
                    <span className="text-[#F59E0B] font-semibold">· Override: {a.overrideReason}</span>
                  )}
                </div>
                {a.status === 'pending_confirmation' && canManage && (
                  <button
                    type="button"
                    onClick={() => handleConfirmAssignment(a.id)}
                    className="min-h-[36px] px-3 py-1.5 rounded-md bg-[#16A879] text-white font-semibold cursor-pointer self-start sm:self-auto"
                  >
                    Confirm Assignment
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Deterministic Eligibility & Ranking Engine */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[#0B1F44]">
              Deterministic Eligibility &amp; Transparent Ranking
            </h2>
            <p className="text-xs text-[#52647D] mt-0.5">
              Hard safety filters run first. Eligible workers ranked by Distance (25), Skills (25), Reliability (25), Rotation (25).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                onClick={() => setCandidateTab('eligible')}
                className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
                  candidateTab === 'eligible' ? 'bg-white text-[#0B1F44] shadow-2xs' : 'text-[#52647D]'
                }`}
              >
                Eligible ({eligibleCandidates.length})
              </button>
              <button
                type="button"
                onClick={() => setCandidateTab('excluded')}
                className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
                  candidateTab === 'excluded' ? 'bg-white text-[#0B1F44] shadow-2xs' : 'text-[#52647D]'
                }`}
              >
                Excluded ({excludedCandidates.length})
              </button>
            </div>

            <button
              type="button"
              onClick={handleAiExplain}
              disabled={busyAction === 'ai'}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-[#0B1F44] hover:border-[#0E8BFF] cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#06B6D4]" />
              {busyAction === 'ai' ? 'Analysing...' : 'AI Trade-off Summary'}
            </button>
          </div>
        </div>

        {/* AI Decision-Support Summary Panel */}
        {aiResult && (
          <div className="px-4 sm:px-5 py-3.5 bg-[#F8FAFC] border-b border-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-[#0B1F44]">
                  AI Decision-Support Explanation ({aiResult.model})
                </p>
                <p className="mt-1 text-sm text-[#0B1F44] leading-relaxed">{aiResult.summary}</p>
                <p className="mt-1.5 text-[11px] text-[#52647D]">{aiResult.disclaimer}</p>
              </div>
              <button
                type="button"
                onClick={() => setAiResult(null)}
                aria-label="Dismiss AI explanation"
                className="p-1 text-slate-400 hover:text-[#0B1F44] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        {aiError && (
          <div className="px-4 sm:px-5 py-2.5 bg-red-50 border-b border-red-100 text-xs text-[#DC4C64] font-medium">
            {aiError}
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {(candidateTab === 'eligible' ? eligibleCandidates : excludedCandidates).map((c) => (
            <div
              key={c.workerId}
              className="px-4 sm:px-5 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  {c.eligible ? (
                    <span className="font-mono text-xs font-bold text-[#0E8BFF]">#{c.rankOrder}</span>
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-[#DC4C64] shrink-0" />
                  )}
                  <span className="font-bold text-[#0B1F44]">{c.workerName}</span>
                  <span className="text-xs text-[#52647D]">
                    · {c.primaryRole} · {c.employmentType} · {c.preferredChannel.toUpperCase()}
                  </span>
                </div>

                {c.eligible ? (
                  <p className="mt-0.5 text-xs text-[#52647D]">{c.inclusionReasons.join(' · ')}</p>
                ) : (
                  <ul className="mt-0.5 space-y-0.5 text-xs text-[#DC4C64]">
                    {c.exclusionReasons.map((r, i) => (
                      <li key={i}>Excluded: {r}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 shrink-0">
                {c.eligible ? (
                  <div className="lg:text-right font-mono tabular-nums">
                    <p className="text-sm font-bold text-[#16A879]">{c.totalScore}/100</p>
                    <p className="text-[11px] text-[#52647D]">
                      Dist {c.scoreBreakdown.facilityDistance} · Skill {c.scoreBreakdown.skillsFit} · Rel{' '}
                      {c.scoreBreakdown.reliability} · Rot {c.scoreBreakdown.fairRotation}
                    </p>
                  </div>
                ) : c.safetyBlocked ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#DC4C64]">
                    <Lock className="w-3.5 h-3.5" /> Safety-locked
                  </span>
                ) : null}

                {canOverride && shift.status !== 'covered' && shift.status !== 'cancelled' && !c.safetyBlocked && (
                  <button
                    type="button"
                    onClick={() => setOverrideTarget(c)}
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-[#0B1F44] hover:border-[#0E8BFF] cursor-pointer whitespace-nowrap"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    {c.eligible ? 'Assign Directly' : 'Audited Override'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Offer History & Shift Event Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <div className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5">
          <h2 className="text-sm font-bold text-[#0B1F44] pb-2.5 border-b border-slate-100">
            Offer Delivery &amp; Response Log ({offers.length})
          </h2>
          {offers.length === 0 ? (
            <p className="py-7 text-xs text-[#52647D] text-center">
              No shift offers dispatched yet. Start Coverage Autopilot above to send Wave 1.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {offers.map((o) => (
                <div key={o.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#0B1F44] truncate">
                      {o.workerFirstName} {o.workerLastName}{' '}
                      <span className="font-normal text-[#52647D]">
                        · W{o.waveNumber} · {o.channel.toUpperCase()}
                      </span>
                    </p>
                    <p className="text-[#52647D] mt-0.5 tabular-nums">
                      Sent {new Date(o.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {o.declineReason ? ` · ${o.declineReason}` : ''}
                    </p>
                  </div>
                  <span
                    className={`font-bold uppercase shrink-0 ${
                      o.status === 'accepted'
                        ? 'text-[#16A879]'
                        : o.status === 'declined' || o.status === 'failed'
                          ? 'text-[#DC4C64]'
                          : o.status === 'withdrawn' || o.status === 'expired'
                            ? 'text-[#52647D]'
                            : 'text-[#0E8BFF]'
                    }`}
                  >
                    {o.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5">
          <h2 className="text-sm font-bold text-[#0B1F44] pb-2.5 border-b border-slate-100">
            Shift Event Timeline ({timeline.length})
          </h2>
          <div className="mt-2.5 space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {timeline.map((ev) => (
              <div key={ev.id} className="pb-2.5 border-b border-slate-100 last:border-b-0 text-xs">
                <div className="flex items-center justify-between gap-2 text-[#52647D] font-mono tabular-nums">
                  <span className="font-semibold text-[#0B1F44] truncate">
                    {ev.eventType.replace(/_/g, ' ')}
                  </span>
                  <span className="shrink-0">
                    {new Date(ev.createdAt).toLocaleString([], {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="mt-0.5 text-[#52647D] leading-snug">{ev.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Audited Manual Assignment / Override Modal */}
      {overrideTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#0B1F44]/60 flex items-end sm:items-center justify-center sm:p-4"
        >
          <div className="bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-w-md w-full p-5 shadow-xl pb-safe">
            <h3 className="text-base font-bold text-[#0B1F44]">
              {overrideTarget.eligible ? 'Confirm Direct Assignment' : 'Audited Manual Override'}
            </h3>
            <p className="mt-1 text-xs text-[#52647D]">
              Assigning <strong>{overrideTarget.workerName}</strong> to {shift.title}. Writes an immutable audit
              event and withdraws open offers once filled.
            </p>
            {!overrideTarget.eligible && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-[#0B1F44]">
                Non-safety criteria bypassed: {overrideTarget.exclusionReasons.join('; ')}
              </div>
            )}
            <form onSubmit={handleManualOverride} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#0B1F44] mb-1">
                  Mandatory audit reason (min 10 characters) *
                </label>
                <textarea
                  required
                  minLength={10}
                  rows={3}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Worker confirmed verbal travel exception with Site Manager for tonight's shift."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOverrideTarget(null)}
                  className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-[#0B1F44] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'override'}
                  className="min-h-[40px] px-4 py-2 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold cursor-pointer"
                >
                  {busyAction === 'override' ? 'Recording...' : 'Confirm Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
