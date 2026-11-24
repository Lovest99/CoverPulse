import React, { useEffect, useState } from 'react';
import { Check, CreditCard, Receipt, RefreshCw } from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useMarket } from '../MarketContext.tsx';
import { formatMarketCents } from '../../shared/markets.ts';
import { useToast } from '../components/Toast.tsx';

interface PlanConfig {
  tierKey: 'essential' | 'growth' | 'enterprise';
  displayName: string;
  targetAudience: string;
  monthlyPriceAudCents: number;
  annualDiscountPct: number;
  maxFacilities: number;
  maxWorkers: number;
  includedSmsPerMonth: number;
  featuresJson: string[];
}

interface BillingResponse {
  subscription: {
    id: string;
    planTier: 'essential' | 'growth' | 'enterprise';
    billingCycle: 'monthly' | 'annual';
    status: string;
    monthlyPriceCents: number;
    includedFacilities: number;
    includedWorkers: number;
    includedSms: number;
    smsUsedThisPeriod: number;
    currentPeriodEnd: string;
  } | null;
  usage: {
    facilitiesUsed: number;
    workersUsed: number;
    smsUsed: number;
  };
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    periodLabel: string;
    subscriptionCents: number;
    smsUsageCents: number;
    integrationCents: number;
    totalCents: number;
    status: string;
    issuedAt: string;
  }>;
  plans: PlanConfig[];
}

export const BillingView: React.FC = () => {
  const { session } = useAuth();
  const { market } = useMarket();
  const { pushToast } = useToast();
  const canManage = Boolean(session?.permissions.includes('billing:manage'));

  const [data, setData] = useState<BillingResponse | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(true);
  const [switchingTier, setSwitchingTier] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<BillingResponse>('/api/billing');
      setData(res);
      if (res.subscription) setBillingCycle(res.subscription.billingCycle);
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to load billing.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleChangePlan = async (planTier: 'essential' | 'growth' | 'enterprise') => {
    setSwitchingTier(planTier);
    try {
      await apiFetch('/api/billing/change-plan', {
        method: 'POST',
        body: JSON.stringify({ planTier, billingCycle }),
      });
      pushToast({ type: 'success', title: `Subscription updated to ${planTier.toUpperCase()} (${billingCycle}).` });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to change plan.' });
    } finally {
      setSwitchingTier(null);
    }
  };

  const fmtMoney = (cents: number) => formatMarketCents(cents, market, { decimals: cents % 100 === 0 ? 0 : 2 });

  const order = ['essential', 'growth', 'enterprise'];
  const sortedPlans = [...(data?.plans ?? [])].sort(
    (a, b) => order.indexOf(a.tierKey) - order.indexOf(b.tierKey),
  );

  const usagePct = (used: number, max: number) => Math.min(100, Math.round((used / Math.max(1, max)) * 100));

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">
            Subscription &amp; Billing
          </h1>
          <p className="text-xs text-[#52647D] mt-0.5">
            Transparent {market.currencyCode} display separating platform subscription, SMS pass-through usage, and integrations
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          aria-label="Refresh billing"
          className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-[#52647D] hover:text-[#0B1F44] cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Current Subscription & Usage Bars */}
      {data?.subscription && (
        <div className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3.5">
            <div>
              <div className="flex items-center gap-1.5 text-xs">
                <CreditCard className="w-4 h-4 text-[#0E8BFF]" />
                <span className="font-semibold uppercase text-[#16A879]">
                  {data.subscription.status.replace('_', ' ')}
                </span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="text-[#52647D] capitalize">{data.subscription.billingCycle} billing</span>
              </div>
              <h2 className="mt-1 text-base sm:text-lg font-bold text-[#0B1F44] capitalize">
                CoverPulse {data.subscription.planTier} Plan — {fmtMoney(data.subscription.monthlyPriceCents)}/mo
              </h2>
            </div>
            <p className="text-xs text-[#52647D] font-mono tabular-nums">
              Renews {new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                label: 'Active Facilities',
                used: data.usage.facilitiesUsed,
                max: data.subscription.includedFacilities,
              },
              {
                label: 'Active Workers',
                used: data.usage.workersUsed,
                max: data.subscription.includedWorkers,
              },
              {
                label: 'Included SMS Outbound',
                used: data.usage.smsUsed,
                max: data.subscription.includedSms,
              },
            ].map((u) => {
              const pct = usagePct(u.used, u.max);
              return (
                <div key={u.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-[#0B1F44]">{u.label}</span>
                    <span className="font-mono tabular-nums text-[#52647D]">
                      {u.used.toLocaleString()} / {u.max.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pct > 85 ? 'bg-[#F59E0B]' : 'bg-[#0E8BFF]'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Plan Switcher */}
      <div className="space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <h2 className="text-sm font-bold text-[#0B1F44]">Available Commercial Tiers</h2>
          <div className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-lg text-xs self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`min-h-[32px] px-3 py-1 rounded-md font-semibold cursor-pointer ${
                billingCycle === 'monthly' ? 'bg-white text-[#0B1F44] shadow-2xs' : 'text-[#52647D]'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('annual')}
              className={`min-h-[32px] px-3 py-1 rounded-md font-semibold cursor-pointer ${
                billingCycle === 'annual' ? 'bg-white text-[#0B1F44] shadow-2xs' : 'text-[#52647D]'
              }`}
            >
              Annual (Save 15%)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {sortedPlans.map((plan) => {
            const isCurrent =
              data?.subscription?.planTier === plan.tierKey &&
              data?.subscription?.billingCycle === billingCycle;
            const effectiveCents =
              billingCycle === 'annual'
                ? Math.round(plan.monthlyPriceAudCents * (1 - plan.annualDiscountPct / 100))
                : plan.monthlyPriceAudCents;

            return (
              <div
                key={plan.tierKey}
                className={`rounded-xl bg-white border p-4 sm:p-5 flex flex-col justify-between gap-4 ${
                  data?.subscription?.planTier === plan.tierKey
                    ? 'border-[#0E8BFF]'
                    : 'border-slate-200'
                }`}
              >
                <div>
                  <p className="text-sm font-bold text-[#0B1F44]">{plan.displayName}</p>
                  <p className="text-xs text-[#52647D] mt-0.5">{plan.targetAudience}</p>
                  <p className="mt-2.5 text-2xl font-bold font-mono tabular-nums text-[#0B1F44]">
                    {fmtMoney(effectiveCents)}
                    <span className="text-xs font-sans font-normal text-[#52647D]">
                      {' '}/ mo {market.taxLabel}
                    </span>
                  </p>
                  <ul className="mt-3.5 space-y-1.5 text-xs text-[#52647D]">
                    {plan.featuresJson.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 text-[#16A879] shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {canManage && (
                  <button
                    type="button"
                    disabled={isCurrent || switchingTier !== null}
                    onClick={() => handleChangePlan(plan.tierKey)}
                    className={`w-full min-h-[40px] py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                      isCurrent
                        ? 'bg-slate-100 text-[#52647D] cursor-default'
                        : 'bg-[#0B1F44] hover:bg-[#132E63] text-white'
                    }`}
                  >
                    {isCurrent
                      ? 'Current Plan'
                      : switchingTier === plan.tierKey
                        ? 'Updating...'
                        : `Switch to ${plan.displayName}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Itemised Invoices: Mobile Statement Cards + Desktop Table */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[#0B1F44] flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[#0E8BFF]" />
            Itemised Billing Statements
          </h2>
          {market.code !== 'AU' && (
            <span className="text-[11px] text-[#52647D]">Indicative {market.currencyCode}</span>
          )}
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {(data?.invoices ?? []).map((inv) => (
            <div key={inv.id} className="px-4 py-3 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-mono font-bold text-[#0B1F44]">{inv.invoiceNumber}</p>
                  <p className="text-[#52647D]">{inv.periodLabel}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-sm text-[#0B1F44] tabular-nums">
                    {fmtMoney(inv.totalCents)}
                  </p>
                  <p className="font-semibold text-[#16A879] uppercase text-[11px]">{inv.status}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-slate-100 text-[11px] font-mono tabular-nums text-[#52647D]">
                <div>
                  <span className="block font-sans text-[10px]">Platform</span>
                  {fmtMoney(inv.subscriptionCents)}
                </div>
                <div>
                  <span className="block font-sans text-[10px]">SMS</span>
                  {fmtMoney(inv.smsUsageCents)}
                </div>
                <div>
                  <span className="block font-sans text-[10px]">Integrations</span>
                  {fmtMoney(inv.integrationCents)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-[#52647D]">
                <th className="py-2.5 px-5">Invoice #</th>
                <th className="py-2.5 px-4">Period</th>
                <th className="py-2.5 px-4 text-right">Platform</th>
                <th className="py-2.5 px-4 text-right">SMS Usage</th>
                <th className="py-2.5 px-4 text-right">Integrations</th>
                <th className="py-2.5 px-4 text-right">Total</th>
                <th className="py-2.5 px-5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.invoices ?? []).map((inv) => (
                <tr key={inv.id}>
                  <td className="py-2.5 px-5 font-mono text-xs font-semibold text-[#0B1F44]">
                    {inv.invoiceNumber}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-[#52647D]">{inv.periodLabel}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">
                    {fmtMoney(inv.subscriptionCents)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">
                    {fmtMoney(inv.smsUsageCents)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">
                    {fmtMoney(inv.integrationCents)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs font-bold tabular-nums text-[#0B1F44]">
                    {fmtMoney(inv.totalCents)}
                  </td>
                  <td className="py-2.5 px-5 text-right text-xs font-semibold text-[#16A879] uppercase">
                    {inv.status}
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
