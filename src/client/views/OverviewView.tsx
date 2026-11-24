import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Clock,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../api.ts';
import { useMarket } from '../MarketContext.tsx';
import { convertAudRate, formatMarketDollars } from '../../shared/markets.ts';
import { SHIFT_STATUS_LABELS, type ShiftStatus } from '../../shared/types.ts';

interface DashboardResponse {
  periodDays: number;
  kpis: {
    coverageRatePct: number;
    coveredPositions: number;
    totalPublishedPositions: number;
    openShiftsCount: number;
    escalatedCount: number;
    avgFirstResponseMin: number;
    avgTimeToFillMin: number;
    estimatedAvoidedAgencyAud: number;
    coveredHours: number;
    costAssumptions: {
      agencyHourlyRateAud: number;
      internalHourlyRateAud: number;
      differentialPerHourAud: number;
      label: string;
    };
    pendingApprovalsCount: number;
    expiredCredentialsCount: number;
    expiringSoonCredentialsCount: number;
  };
  trend: Array<{
    label: string;
    published: number;
    covered: number;
    fillRatePct: number;
  }>;
  urgentQueue: Array<{
    id: string;
    title: string;
    roleRequired: string;
    shiftDate: string;
    startAt: string;
    endAt: string;
    status: ShiftStatus;
    urgency: string;
    isOvernight: boolean;
    facilityName: string;
    facilityCode: string;
    offersDispatched: number;
    minutesOpen: number;
    escalatedAt: string | null;
    escalationReason: string | null;
    headcount: number;
    filledCount: number;
  }>;
  upcomingShifts: Array<{
    id: string;
    title: string;
    roleRequired: string;
    shiftDate: string;
    startAt: string;
    endAt: string;
    status: ShiftStatus;
    urgency: string;
    facilityName: string;
    headcount: number;
    filledCount: number;
  }>;
}

interface OverviewViewProps {
  selectedFacilityId: string;
  onNavigate: (tab: string) => void;
  onOpenShift: (shiftId: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  selectedFacilityId,
  onNavigate,
  onOpenShift,
}) => {
  const { market } = useMarket();
  const [periodDays, setPeriodDays] = useState(30);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DashboardResponse>(
        `/api/dashboard?periodDays=${periodDays}&facilityId=${encodeURIComponent(selectedFacilityId)}`,
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [periodDays, selectedFacilityId]);

  if (loading && !data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-8 text-center">
        <AlertTriangle className="w-6 h-6 text-[#DC4C64] mx-auto" />
        <p className="mt-2 text-sm font-semibold text-[#0B1F44]">{error || 'Dashboard unavailable'}</p>
        <button
          type="button"
          onClick={load}
          className="mt-4 min-h-[40px] px-4 py-2 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const { kpis } = data;
  const diffPerHrLocal = convertAudRate(kpis.costAssumptions.differentialPerHourAud, market);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Compact Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">
            Operations Overview
          </h1>
          <p className="text-xs text-[#52647D] mt-0.5">
            Synthetic demo · Last {periodDays}d · {market.currencyCode} display · Click any metric to drill down
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-lg">
            {[7, 14, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setPeriodDays(d)}
                className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  periodDays === d
                    ? 'bg-white text-[#0B1F44] shadow-2xs'
                    : 'text-[#52647D] hover:text-[#0B1F44]'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={load}
            aria-label="Refresh dashboard"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-[#52647D] hover:text-[#0B1F44] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Compact 2x2 Mobile / 4-col Desktop KPI Row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => onNavigate('analytics')}
          className="text-left rounded-xl bg-white border border-slate-200 p-3.5 sm:p-4 hover:border-[#0E8BFF] transition-colors cursor-pointer"
        >
          <p className="text-[11px] sm:text-xs font-semibold text-[#52647D] truncate">
            Fill Rate ({periodDays}d)
          </p>
          <p className="mt-1.5 text-2xl sm:text-[26px] font-bold text-[#0B1F44] font-mono tabular-nums leading-none">
            {kpis.coverageRatePct}%
          </p>
          <p className="mt-1.5 text-[11px] sm:text-xs text-[#52647D] tabular-nums truncate">
            {kpis.coveredPositions}/{kpis.totalPublishedPositions} covered
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('queue')}
          className="text-left rounded-xl bg-white border border-slate-200 p-3.5 sm:p-4 hover:border-[#0E8BFF] transition-colors cursor-pointer"
        >
          <p className="text-[11px] sm:text-xs font-semibold text-[#52647D] truncate">
            Open / Active Shifts
          </p>
          <p className="mt-1.5 text-2xl sm:text-[26px] font-bold text-[#0B1F44] font-mono tabular-nums leading-none">
            {kpis.openShiftsCount}
          </p>
          <p className="mt-1.5 text-[11px] sm:text-xs tabular-nums truncate">
            {kpis.escalatedCount > 0 ? (
              <span className="font-semibold text-[#DC4C64]">
                {kpis.escalatedCount} escalated
              </span>
            ) : (
              <span className="text-[#16A879] font-medium">Zero escalations</span>
            )}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('analytics')}
          className="text-left rounded-xl bg-white border border-slate-200 p-3.5 sm:p-4 hover:border-[#0E8BFF] transition-colors cursor-pointer"
        >
          <p className="text-[11px] sm:text-xs font-semibold text-[#52647D] truncate">
            Response / Fill Time
          </p>
          <p className="mt-1.5 text-2xl sm:text-[26px] font-bold text-[#0B1F44] font-mono tabular-nums leading-none">
            {kpis.avgFirstResponseMin}m
            <span className="text-xs sm:text-sm font-medium text-[#52647D] ml-1">
              / {kpis.avgTimeToFillMin}m
            </span>
          </p>
          <p className="mt-1.5 text-[11px] sm:text-xs text-[#52647D] truncate">
            First reply / confirm
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('analytics')}
          className="text-left rounded-xl bg-white border border-slate-200 p-3.5 sm:p-4 hover:border-[#0E8BFF] transition-colors cursor-pointer"
        >
          <p className="text-[11px] sm:text-xs font-semibold text-[#52647D] truncate">
            Est. Agency Savings*
          </p>
          <p className="mt-1.5 text-2xl sm:text-[26px] font-bold text-[#16A879] font-mono tabular-nums leading-none">
            {formatMarketDollars(kpis.estimatedAvoidedAgencyAud, market)}
          </p>
          <p className="mt-1.5 text-[11px] sm:text-xs text-[#52647D] tabular-nums truncate">
            *{kpis.coveredHours}h × {market.currencySymbol}{diffPerHrLocal}/h diff
          </p>
        </button>
      </div>

      {/* Compact Operational Alerts Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl bg-white border border-slate-200 px-3.5 sm:px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <ShieldAlert className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-[#0B1F44] tabular-nums">
                {kpis.expiredCredentialsCount} expired · {kpis.expiringSoonCredentialsCount} expiring ≤30d
              </p>
              <p className="text-[11px] text-[#52647D] truncate">
                Expired mandatory checks are deterministically excluded.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('workforce')}
            className="text-xs font-semibold text-[#0E8BFF] hover:text-[#0B1F44] whitespace-nowrap cursor-pointer shrink-0"
          >
            Review →
          </button>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 px-3.5 sm:px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <Clock className="w-4 h-4 text-[#0E8BFF] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-[#0B1F44] tabular-nums">
                {kpis.pendingApprovalsCount} pending shift confirmation(s)
              </p>
              <p className="text-[11px] text-[#52647D] truncate">
                Policies requiring supervisor sign-off surface before lock.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('shifts')}
            className="text-xs font-semibold text-[#0E8BFF] hover:text-[#0B1F44] whitespace-nowrap cursor-pointer shrink-0"
          >
            Shifts →
          </button>
        </div>
      </div>

      {/* Main Split: Coverage Trend + Urgent Coverage Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        {/* Coverage Trend Chart */}
        <div className="lg:col-span-5 rounded-xl bg-white border border-slate-200 p-4 sm:p-5 flex flex-col">
          <div>
            <h2 className="text-sm font-bold text-[#0B1F44] flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#0E8BFF]" />
              Coverage Fill Rate Trend
            </h2>
            <p className="text-xs text-[#52647D] mt-0.5">
              Covered positions as % of published ({periodDays}d)
            </p>
          </div>

          <div className="mt-4 h-52 sm:h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#52647D' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#52647D' }} unit="%" />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid #E2E8F0',
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="fillRatePct"
                  name="Fill Rate %"
                  stroke="#0E8BFF"
                  fill="#06B6D4"
                  fillOpacity={0.14}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Urgent Coverage Queue */}
        <div className="lg:col-span-7 rounded-xl bg-white border border-slate-200 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-[#0B1F44]">Urgent Coverage Queue</h2>
              <p className="text-xs text-[#52647D] mt-0.5">
                Prioritised by escalation state and clinical urgency
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('queue')}
              className="text-xs font-semibold text-[#0E8BFF] hover:text-[#0B1F44] whitespace-nowrap cursor-pointer"
            >
              Full queue →
            </button>
          </div>

          {data.urgentQueue.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#52647D]">
              All published shifts in this scope are currently covered.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.urgentQueue.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  onClick={() => onOpenShift(item.id)}
                  className="py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer hover:bg-slate-50/70 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span
                        className={`font-bold text-[11px] uppercase shrink-0 ${
                          item.escalatedAt || item.urgency === 'critical'
                            ? 'text-[#DC4C64]'
                            : item.urgency === 'high'
                              ? 'text-[#F59E0B]'
                              : 'text-[#52647D]'
                        }`}
                      >
                        {item.escalatedAt ? 'ESCALATED' : item.urgency}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="font-semibold text-[#0B1F44] truncate">{item.title}</span>
                    </div>
                    <p className="text-xs text-[#52647D] mt-0.5 tabular-nums truncate">
                      {item.facilityName} · {item.roleRequired} · {item.shiftDate}
                      {item.isOvernight ? ' (Night)' : ''} · {item.offersDispatched} offers
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                    <span className="text-xs font-semibold text-[#0B1F44] font-mono tabular-nums">
                      {SHIFT_STATUS_LABELS[item.status]} ({item.filledCount}/{item.headcount})
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenShift(item.id);
                      }}
                      className="inline-flex items-center gap-1 min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-[#0B1F44] hover:border-[#0E8BFF] cursor-pointer"
                    >
                      Manage
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Upcoming Shifts — Native Mobile List + Compact Desktop Table */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[#0B1F44]">Upcoming Rostered &amp; Open Shifts</h2>
            <p className="text-xs text-[#52647D] mt-0.5">Displayed in each site&apos;s local timezone</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('shifts')}
            className="text-xs font-semibold text-[#0E8BFF] hover:text-[#0B1F44] whitespace-nowrap cursor-pointer"
          >
            All shifts →
          </button>
        </div>

        {/* Mobile Touch List */}
        <div className="md:hidden divide-y divide-slate-100">
          {data.upcomingShifts.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpenShift(s.id)}
              className="w-full text-left px-4 py-3 hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#0B1F44] truncate">{s.title}</p>
                <p className="text-xs text-[#52647D] mt-0.5 truncate">
                  {s.facilityName} · {s.roleRequired}
                </p>
                <p className="text-[11px] font-mono tabular-nums text-[#52647D] mt-0.5">
                  {s.shiftDate} · {s.filledCount}/{s.headcount} filled
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-xs font-semibold ${
                    s.status === 'covered'
                      ? 'text-[#16A879]'
                      : s.status === 'broadcasting'
                        ? 'text-[#0E8BFF]'
                        : s.status === 'open'
                          ? 'text-[#F59E0B]'
                          : 'text-[#52647D]'
                  }`}
                >
                  {SHIFT_STATUS_LABELS[s.status]}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
            </button>
          ))}
        </div>

        {/* Desktop Data Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-[#52647D]">
                <th className="py-2.5 px-5">Shift</th>
                <th className="py-2.5 px-4">Facility</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-4">Fill</th>
                <th className="py-2.5 px-5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.upcomingShifts.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => onOpenShift(s.id)}
                  className="hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <td className="py-2.5 px-5 font-semibold text-[#0B1F44]">{s.title}</td>
                  <td className="py-2.5 px-4 text-xs text-[#52647D]">{s.facilityName}</td>
                  <td className="py-2.5 px-4 text-xs text-[#52647D]">{s.roleRequired}</td>
                  <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-[#0B1F44]">{s.shiftDate}</td>
                  <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-[#0B1F44]">
                    {s.filledCount}/{s.headcount}
                  </td>
                  <td className="py-2.5 px-5 text-right">
                    <span
                      className={`text-xs font-semibold ${
                        s.status === 'covered'
                          ? 'text-[#16A879]'
                          : s.status === 'broadcasting'
                            ? 'text-[#0E8BFF]'
                            : s.status === 'open'
                              ? 'text-[#F59E0B]'
                              : 'text-[#52647D]'
                      }`}
                    >
                      {SHIFT_STATUS_LABELS[s.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
