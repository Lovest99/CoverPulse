import React, { useEffect, useState } from 'react';
import { Download, Info, Printer, RefreshCw, Sparkles } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch, downloadAuthenticatedCsv } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useMarket } from '../MarketContext.tsx';
import { convertAudRate, formatMarketDollars } from '../../shared/markets.ts';
import { useToast } from '../components/Toast.tsx';

interface AnalyticsResponse {
  periodDays: number;
  summary: {
    fillRatePct: number;
    coveredPositions: number;
    totalPositions: number;
    openShifts: number;
    escalatedShifts: number;
    lateCancellations: number;
    unfilledHours: number;
    coveredHours: number;
    avgFirstResponseMin: number;
    avgTimeToFillMin: number;
    offerAcceptanceRatePct: number;
    totalOffersSent: number;
    estimatedAvoidedAgencyAud: number;
    costAssumptions: {
      agencyHourlyRateAud: number;
      internalHourlyRateAud: number;
      differentialPerHourAud: number;
    };
  };
  definitions: {
    fillRate: string;
    timeToFirstResponse: string;
    timeToFill: string;
    estimatedCostImpact: string;
  };
  byChannel: Array<{
    channel: string;
    offersSent: number;
    accepted: number;
    acceptanceRatePct: number;
    avgResponseMin: number;
  }>;
  byFacility: Array<{
    facilityId: string;
    facilityName: string;
    serviceType: string;
    publishedPositions: number;
    coveredPositions: number;
    fillRatePct: number;
  }>;
  byRole: Array<{
    role: string;
    publishedPositions: number;
    coveredPositions: number;
    fillRatePct: number;
  }>;
}

interface AnalyticsViewProps {
  selectedFacilityId: string;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ selectedFacilityId }) => {
  const { session } = useAuth();
  const { market } = useMarket();
  const { pushToast } = useToast();
  const canExport = Boolean(session?.permissions.includes('analytics:export'));

  const [periodDays, setPeriodDays] = useState(30);
  const [agencyRate, setAgencyRate] = useState<number>(96);
  const [internalRate, setInternalRate] = useState<number>(54);
  const [ratesInitialized, setRatesInitialized] = useState(false);

  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDefinitions, setShowDefinitions] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [aiBrief, setAiBrief] = useState<{ summary: string; disclaimer: string; model: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const load = async (customA?: number, customI?: number) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        periodDays: String(periodDays),
        facilityId: selectedFacilityId,
      });
      if (customA !== undefined) qs.set('agencyRate', String(customA));
      if (customI !== undefined) qs.set('internalRate', String(customI));

      const res = await apiFetch<AnalyticsResponse>(`/api/analytics?${qs.toString()}`);
      setData(res);
      if (!ratesInitialized) {
        setAgencyRate(res.summary.costAssumptions.agencyHourlyRateAud);
        setInternalRate(res.summary.costAssumptions.internalHourlyRateAud);
        setRatesInitialized(true);
      }
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to load analytics.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(ratesInitialized ? agencyRate : undefined, ratesInitialized ? internalRate : undefined);
  }, [periodDays, selectedFacilityId]);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await downloadAuthenticatedCsv(
        `/api/analytics/export?periodDays=${periodDays}&facilityId=${encodeURIComponent(selectedFacilityId)}`,
        `coverpulse-analytics-${periodDays}d.csv`,
      );
      pushToast({ type: 'success', title: 'Analytics CSV exported and logged to audit trail.' });
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'CSV export failed.' });
    } finally {
      setExporting(false);
    }
  };

  const handleGenerateBrief = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await apiFetch<{ summary: string; disclaimer: string; model: string }>(
        '/api/analytics/ai-brief',
        {
          method: 'POST',
          body: JSON.stringify({ periodDays, facilityId: selectedFacilityId }),
        },
      );
      setAiBrief(res);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to generate AI operational brief.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">
            Analytics &amp; Reporting
          </h1>
          <p className="text-xs text-[#52647D] mt-0.5">
            Formula-transparent coverage performance, channel velocity, and {market.currencyCode} cost models
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <div className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-lg">
            {[7, 14, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setPeriodDays(d)}
                className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                  periodDays === d ? 'bg-white text-[#0B1F44] shadow-2xs' : 'text-[#52647D]'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowDefinitions((v) => !v)}
            className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <Info className="w-3.5 h-3.5 text-[#0E8BFF]" />
            Formulas
          </button>

          {canExport && (
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exporting}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? 'Exporting...' : 'CSV'}
            </button>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold hover:bg-[#132E63] cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / PDF
          </button>
        </div>
      </div>

      {/* KPI Definitions Panel */}
      {showDefinitions && data && (
        <div className="rounded-xl bg-white border border-slate-200 p-4 grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
          <div>
            <p className="font-bold text-[#0B1F44]">Fill Rate</p>
            <p className="mt-0.5 text-[#52647D]">{data.definitions.fillRate}</p>
          </div>
          <div>
            <p className="font-bold text-[#0B1F44]">Time to First Response</p>
            <p className="mt-0.5 text-[#52647D]">{data.definitions.timeToFirstResponse}</p>
          </div>
          <div>
            <p className="font-bold text-[#0B1F44]">Time to Fill</p>
            <p className="mt-0.5 text-[#52647D]">{data.definitions.timeToFill}</p>
          </div>
          <div>
            <p className="font-bold text-[#0B1F44]">Estimated Avoided Agency Cost</p>
            <p className="mt-0.5 text-[#52647D]">{data.definitions.estimatedCostImpact}</p>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Compact 2x2 Mobile / 4-col Desktop Summary KPI Grid */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            <div className="rounded-xl bg-white border border-slate-200 p-3.5 sm:p-4">
              <p className="text-[11px] sm:text-xs font-semibold text-[#52647D] truncate">Fill Rate</p>
              <p className="mt-1.5 text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-[#0B1F44] leading-none">
                {data.summary.fillRatePct}%
              </p>
              <p className="mt-1.5 text-[11px] text-[#52647D] tabular-nums truncate">
                {data.summary.coveredPositions}/{data.summary.totalPositions} · {data.summary.unfilledHours}h open
              </p>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3.5 sm:p-4">
              <p className="text-[11px] sm:text-xs font-semibold text-[#52647D] truncate">Reply / Fill</p>
              <p className="mt-1.5 text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-[#0B1F44] leading-none">
                {data.summary.avgFirstResponseMin}m
                <span className="text-xs sm:text-sm font-medium text-[#52647D] ml-1">
                  / {data.summary.avgTimeToFillMin}m
                </span>
              </p>
              <p className="mt-1.5 text-[11px] text-[#52647D] tabular-nums truncate">
                {data.summary.escalatedShifts} esc · {data.summary.lateCancellations} canc
              </p>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3.5 sm:p-4">
              <p className="text-[11px] sm:text-xs font-semibold text-[#52647D] truncate">Offer Accept</p>
              <p className="mt-1.5 text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-[#0E8BFF] leading-none">
                {data.summary.offerAcceptanceRatePct}%
              </p>
              <p className="mt-1.5 text-[11px] text-[#52647D] tabular-nums truncate">
                {data.summary.totalOffersSent} offers dispatched
              </p>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3.5 sm:p-4">
              <p className="text-[11px] sm:text-xs font-semibold text-[#52647D] truncate">Est. Savings*</p>
              <p className="mt-1.5 text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-[#16A879] leading-none">
                {formatMarketDollars(data.summary.estimatedAvoidedAgencyAud, market)}
              </p>
              <p className="mt-1.5 text-[11px] text-[#52647D] tabular-nums truncate">
                {data.summary.coveredHours}h × {market.currencySymbol}
                {convertAudRate(data.summary.costAssumptions.differentialPerHourAud, market)}/h
              </p>
            </div>
          </div>

          {/* Interactive Customer Cost Assumption Calculator + AI Brief */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
            <div className="lg:col-span-5 rounded-xl bg-white border border-slate-200 p-4 sm:p-5">
              <h2 className="text-sm font-bold text-[#0B1F44]">Cost Differential Assumptions</h2>
              <p className="text-xs text-[#52647D] mt-0.5">
                Adjust blended agency vs internal hourly rates (base AUD; displayed in {market.currencyCode}).
              </p>

              <div className="mt-3.5 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Agency (AUD/h)</label>
                  <input
                    type="number"
                    min={40}
                    max={250}
                    value={agencyRate}
                    onChange={(e) => setAgencyRate(Number(e.target.value))}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-base sm:text-sm font-mono tabular-nums text-[#0B1F44]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Internal (AUD/h)</label>
                  <input
                    type="number"
                    min={25}
                    max={180}
                    value={internalRate}
                    onChange={(e) => setInternalRate(Number(e.target.value))}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-base sm:text-sm font-mono tabular-nums text-[#0B1F44]"
                  />
                </div>
              </div>

              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-[#52647D] tabular-nums">
                  Diff:{' '}
                  <strong className="text-[#0B1F44]">
                    {market.currencySymbol}
                    {convertAudRate(Math.max(0, agencyRate - internalRate), market)}/h
                  </strong>
                </p>
                <button
                  type="button"
                  onClick={() => load(agencyRate, internalRate)}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B1F44] hover:bg-[#132f63] text-white text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#06B6D4]" />
                  Recalculate
                </button>
              </div>
              <p className="mt-2.5 text-[11px] text-[#52647D]">
                *Estimates reflect covered hours × configured differential and do not constitute audited savings.
              </p>
            </div>

            <div className="lg:col-span-7 rounded-xl bg-white border border-slate-200 p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div>
                    <h2 className="text-sm font-bold text-[#0B1F44] flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-[#0E8BFF]" />
                      Operational Brief (Decision Support)
                    </h2>
                    <p className="text-xs text-[#52647D] mt-0.5">
                      Server-generated executive summary from the exact database metrics above.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateBrief}
                    disabled={aiLoading}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer self-start sm:self-auto no-print"
                  >
                    {aiLoading ? 'Generating...' : aiBrief ? 'Regenerate Brief' : 'Generate Brief'}
                  </button>
                </div>

                {aiError && (
                  <p className="mt-3 text-xs text-[#DC4C64] bg-[#DC4C64]/5 border border-[#DC4C64]/20 rounded-lg p-3">
                    {aiError}
                  </p>
                )}

                {aiBrief ? (
                  <div className="mt-3.5 space-y-2">
                    <div className="text-xs text-[#0B1F44] leading-relaxed whitespace-pre-line bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                      {aiBrief.summary}
                    </div>
                    <p className="text-[11px] text-[#52647D]">{aiBrief.disclaimer}</p>
                  </div>
                ) : (
                  <p className="mt-3.5 text-xs text-[#52647D] leading-relaxed">
                    Click &ldquo;Generate Brief&rdquo; to produce a concise executive summary highlighting fill
                    bottlenecks, escalation pressure, and recommended policy adjustments.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Charts: By Facility & By Channel */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
            <div className="lg:col-span-7 rounded-xl bg-white border border-slate-200 p-4 sm:p-5">
              <h2 className="text-sm font-bold text-[#0B1F44]">Fill Rate by Facility (%)</h2>
              <p className="text-xs text-[#52647D] mt-0.5">Covered vs published shift positions per site</p>
              <div className="mt-4 h-56 sm:h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byFacility} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                      dataKey="facilityName"
                      tick={{ fontSize: 11, fill: '#52647D' }}
                      tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                    />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: '#52647D' }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }}
                    />
                    <Bar dataKey="fillRatePct" name="Fill Rate %" fill="#0E8BFF" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-5 rounded-xl bg-white border border-slate-200 p-4 sm:p-5">
              <h2 className="text-sm font-bold text-[#0B1F44]">Outreach Channel Performance</h2>
              <p className="text-xs text-[#52647D] mt-0.5">Acceptance rate &amp; average response latency</p>
              <div className="mt-3 divide-y divide-slate-100">
                {data.byChannel.map((ch) => (
                  <div key={ch.channel} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="font-semibold text-[#0B1F44] uppercase text-xs">
                        {ch.channel === 'in_app' ? 'In-App PWA' : ch.channel}
                      </p>
                      <p className="text-xs text-[#52647D] tabular-nums">
                        {ch.accepted} accepted of {ch.offersSent} sent
                      </p>
                    </div>
                    <div className="text-right font-mono text-xs tabular-nums">
                      <p className="font-bold text-[#0B1F44]">{ch.acceptanceRatePct}%</p>
                      <p className="text-[#52647D]">{ch.avgResponseMin}m avg</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Role Fill Breakdown: Native Mobile List + Desktop Table */}
          <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-bold text-[#0B1F44]">Coverage by Clinical &amp; Care Role</h2>
            </div>

            {/* Mobile List */}
            <div className="md:hidden divide-y divide-slate-100">
              {data.byRole.map((r) => (
                <div key={r.role} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#0B1F44] truncate">{r.role}</span>
                    <span className="font-mono font-bold tabular-nums text-[#0B1F44] shrink-0">
                      {r.fillRatePct}% ({r.coveredPositions}/{r.publishedPositions})
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#0E8BFF]"
                      style={{ width: `${Math.min(100, r.fillRatePct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-[#52647D]">
                    <th className="py-2.5 px-5">Role</th>
                    <th className="py-2.5 px-4 text-right">Published Positions</th>
                    <th className="py-2.5 px-4 text-right">Covered Positions</th>
                    <th className="py-2.5 px-5 text-right">Fill Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.byRole.map((r) => (
                    <tr key={r.role}>
                      <td className="py-2.5 px-5 font-semibold text-[#0B1F44]">{r.role}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-[#52647D]">
                        {r.publishedPositions}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-[#0B1F44]">
                        {r.coveredPositions}
                      </td>
                      <td className="py-2.5 px-5 text-right font-mono text-xs font-bold tabular-nums text-[#0B1F44]">
                        {r.fillRatePct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
