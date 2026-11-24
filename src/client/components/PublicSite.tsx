import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Globe,
  Lock,
  Menu,
  ShieldCheck,
  Smartphone,
  Webhook,
  X,
} from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useToast } from './Toast.tsx';
import { useMarket } from '../MarketContext.tsx';
import {
  MARKET_LIST,
  formatMarketCents,
  type MarketCode,
  type MarketConfig,
} from '../../shared/markets.ts';

interface PlanConfig {
  id: string;
  tierKey: string;
  displayName: string;
  targetAudience: string;
  monthlyPriceAudCents: number;
  annualDiscountPct: number;
  onboardingFeeAudCents: number;
  maxFacilities: number;
  maxWorkers: number;
  includedSmsPerMonth: number;
  smsOverageCents: number;
  featuresJson: string[];
}

interface PublicSiteProps {
  onOpenSignIn: () => void;
  onQuickDemoLaunch: (uid?: string) => void;
}

function getSolutionsForMarket(market: MarketConfig) {
  return {
    residential: {
      label: market.sectors[0],
      headline: 'Keep 24/7 clinical nursing coverage intact across every wing and overnight roster.',
      summary: `When an unexpected sick call hits a memory-care or high-acuity wing, CoverPulse filters immediately for active ${market.clinicalCheckExample}, verified First Aid/CPR, rest-period rules, and site induction before sending a single offer.`,
      points: [
        'Enforces overnight shift boundaries and minimum rest hours across multi-site facilities',
        `Blocks expired ${market.clinicalCheckExample} or ${market.clearanceCheckExample} automatically — never overridden by AI`,
        'Escalates unaccepted clinical shifts to the Site or Operations Manager within minutes',
      ],
      sampleShift:
        market.code === 'AU'
          ? 'Urgent RN Night Duty · Bayside Gardens Aged Care · 22:00–06:30 AEST'
          : market.code === 'US'
            ? 'Urgent RN Night Duty · Oakridge Skilled Nursing · 22:00–06:30 EST'
            : market.code === 'UK'
              ? 'Urgent RGN Night Duty · Meadowbrook Care Home · 22:00–06:30 GMT'
              : 'Urgent RN Night Duty · Harbourview Long-Term Care · 22:00–06:30 EST',
    },
    complex_care: {
      label: market.sectors[1],
      headline: 'Protect participant & resident continuity with verified clearance and skill matching.',
      summary: `Supported living, assisted living, and specialist care houses depend on familiar, inducted workers with the right clinical competencies. CoverPulse ranks inducted workers first and verifies ${market.clearanceCheckExample} deterministically.`,
      points: [
        'Matches high-acuity skills such as Medication Admin, Epilepsy Management, and Dementia Care',
        'Honours worker travel radius and preferred site assignments transparently',
        'Produces immutable audit trails showing who was offered, accepted, or excluded and why',
      ],
      sampleShift:
        market.code === 'AU'
          ? 'SIL Complex Support Evening · Parramatta House 2 · 15:00–22:00 AEST'
          : market.code === 'US'
            ? 'Memory Care Evening Lead · Cedar Creek Assisted Living · 15:00–23:00 CST'
            : market.code === 'UK'
              ? 'Supported Living Evening · Trafford Complex Care · 15:00–22:00 GMT'
              : 'Assisted Living Evening · Lakeshore Residence · 15:00–22:00 EST',
    },
    home_care: {
      label: market.sectors[2],
      headline: 'Fill home-care gaps quickly without burning out coordinators on phone trees.',
      summary: `Coordinate dispersed in-home visits across metro and regional ${market.postalLabel.toLowerCase()}s using quiet-hour-aware SMS, email, and mobile PWA offers — without replacing your existing rostering or payroll platform.`,
      points: [
        'Prioritises nearby community care workers within their stated travel radius',
        'Mobile-first Worker PWA handles low-bandwidth regions with safe read-only offline visibility',
        'Exports confirmed shift timesheets cleanly to existing HRIS and payroll systems via CSV/webhooks',
      ],
      sampleShift:
        market.code === 'AU'
          ? 'Home Care Morning Route · North Shore Community Care · 07:30–13:30 AEST'
          : market.code === 'US'
            ? 'Home Health Morning Route · Metro Visiting Care · 07:30–13:30 EST'
            : market.code === 'UK'
              ? 'Domiciliary Morning Round · Cheshire Home Care · 07:30–13:30 GMT'
              : 'Community Care Morning Route · York Region Home Care · 07:30–13:30 EST',
    },
  };
}

const GUIDES = [
  {
    id: 'deterministic-eligibility',
    title: 'Why shift eligibility must stay deterministic in clinical care',
    readTime: '4 min read',
    category: 'Clinical Governance',
    excerpt:
      'Separating hard regulatory & safety gates from transparent ranking factors so coordinators stay in control.',
    body: [
      'In aged care, skilled nursing, disability support, and home care, staffing decisions carry direct clinical and safety consequences. Treating eligibility as a black-box AI score creates unacceptable risk when an expired nursing license or an overlapping overnight shift slips through.',
      'CoverPulse applies deterministic hard filters first: active employment status, exact role match, verified non-expired credentials, site induction, availability windows, overlap checks, and minimum rest intervals.',
      'Only workers who clear every hard filter are ranked using transparent, configurable weights — proximity, skills match, historical response reliability, and fair shift rotation. AI is strictly confined to summarising trade-offs for coordinators, never overriding safety rules.',
    ],
  },
  {
    id: 'wave-escalation',
    title: 'Designing tiered shift offer waves that respect quiet hours',
    readTime: '5 min read',
    category: 'Operations Playbook',
    excerpt:
      'Moving from chaotic group SMS blasts to controlled sequential and tiered waves with automatic escalation.',
    body: [
      'Blasting every casual worker at once creates alert fatigue, double-booking disputes, and resentment among permanent staff. Yet calling workers one by one leaves urgent night shifts uncovered for hours.',
      'Tiered wave policies strike a practical balance: Wave 1 reaches your top 3 ranked primary-site workers with a 15-minute window. If no one accepts, Wave 2 automatically expands to secondary inducted workers.',
      'When a worker accepts, atomic database row locking confirms the shift once, withdraws all outstanding offers immediately, and halts further messages. If all waves exhaust, CoverPulse escalates directly to the on-call Operations Manager with a complete audit trail.',
    ],
  },
  {
    id: 'side-by-side-integration',
    title: 'Adding a specialist coverage layer without ripping out your roster',
    readTime: '4 min read',
    category: 'Architecture',
    excerpt:
      'Start in week one with CSV worker sync and payroll export, then graduate to HMAC-signed webhooks.',
    body: [
      'Most care providers already run an established HRIS, payroll, or rostering system and cannot absorb a disruptive 12-month platform replacement.',
      'CoverPulse is built as an integration-first specialist coverage layer. Start immediately by importing active workers and credential expiry dates via CSV, running shift coverage autopilot, and exporting confirmed shift timesheets.',
      'When your IT team is ready, connect signed HMAC-SHA256 webhooks with idempotency keys and replay protection to write confirmed assignments straight back to your system of record.',
    ],
  },
];

export const PublicSite: React.FC<PublicSiteProps> = ({ onOpenSignIn, onQuickDemoLaunch }) => {
  const { pushToast } = useToast();
  const { market, marketCode, setMarketCode } = useMarket();

  const [plans, setPlans] = useState<PlanConfig[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [activeSolution, setActiveSolution] = useState<'residential' | 'complex_care' | 'home_care'>('residential');
  const [heroFilter, setHeroFilter] = useState<'all' | 'eligible' | 'excluded'>('all');
  const [activeGuide, setActiveGuide] = useState<(typeof GUIDES)[number] | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    organisationName: '',
    sector: 'Residential Aged Care',
    facilityCount: '3–10 facilities',
    phone: '',
    notes: '',
    consentGranted: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submittedMsg, setSubmittedMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setPlansLoading(true);
    apiFetch<{ plans: PlanConfig[] }>('/api/public/plans')
      .then((res) => setPlans(res.plans))
      .catch(() => {})
      .finally(() => setPlansLoading(false));
  }, []);

  useEffect(() => {
    setForm((prev) => ({ ...prev, sector: market.sectors[0] }));
  }, [market.code]);

  const handleSubmitDemo = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.consentGranted) {
      setFormError('Please confirm privacy consent before submitting your request.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/public/demo-request', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          notes: `[Market: ${market.name} (${market.currencyCode})] ${form.notes}`.trim(),
        }),
      });
      setSubmittedMsg(res.message);
      pushToast({ type: 'success', title: 'Demo request recorded', detail: 'Privacy consent logged.' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to submit request.');
    } finally {
      setSubmitting(false);
    }
  };

  const solutions = getSolutionsForMarket(market);
  const solution = solutions[activeSolution];

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0B1F44]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-6">
          {/* Zone 1: Brand wordmark only */}
          <a href="#top" className="shrink-0 focus-visible:outline-2" aria-label="CoverPulse Home">
            <img
              src="/assets/aistudio/coverpulse-logo-light_442458be.svg"
              alt="CoverPulse"
              className="h-7 sm:h-8 w-auto block"
              referrerPolicy="no-referrer"
            />
          </a>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 lg:gap-7 text-sm font-medium text-[#52647D]"
          >
            <a href="#how-it-works" className="hover:text-[#0B1F44] transition-colors whitespace-nowrap shrink-0">
              How it works
            </a>
            <a href="#solutions" className="hover:text-[#0B1F44] transition-colors whitespace-nowrap shrink-0">
              Solutions
            </a>
            <a href="#security" className="hover:text-[#0B1F44] transition-colors whitespace-nowrap shrink-0">
              Security
            </a>
            <a href="#pricing" className="hover:text-[#0B1F44] transition-colors whitespace-nowrap shrink-0">
              Pricing
            </a>
            <button
              type="button"
              onClick={onOpenSignIn}
              className="hover:text-[#0B1F44] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign in
            </button>
          </nav>

          {/* Zone 3: 1 primary CTA */}
          <div className="hidden md:flex items-center shrink-0">
            <a
              href="#book-demo"
              className="px-4 py-2 rounded-lg bg-[#0B1F44] text-white text-sm font-semibold hover:bg-[#132f63] transition-colors whitespace-nowrap shrink-0"
            >
              Book a demo
            </a>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
            className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#0B1F44] hover:bg-slate-100 cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-0.5 shadow-lg">
            {[
              { href: '#how-it-works', label: 'How it works' },
              { href: '#solutions', label: 'Solutions' },
              { href: '#security', label: 'Security' },
              { href: '#pricing', label: 'Pricing' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center min-h-[44px] px-2 rounded-lg text-sm font-medium text-[#0B1F44] hover:bg-slate-50"
              >
                {link.label}
              </a>
            ))}
            <div className="pt-2.5 mt-1 border-t border-slate-100 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenSignIn();
                }}
                className="min-h-[44px] rounded-lg border border-slate-300 text-sm font-semibold text-[#0B1F44] hover:bg-slate-50 cursor-pointer"
              >
                Sign in
              </button>
              <a
                href="#book-demo"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[44px] rounded-lg bg-[#0B1F44] text-white text-sm font-semibold flex items-center justify-center"
              >
                Book a demo
              </a>
            </div>
          </div>
        )}
      </header>

      <main id="top">
        {/* Hero Section */}
        <section className="cp-hero-grid border-b border-slate-200/70">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-7 pb-10 sm:pt-12 sm:pb-16 lg:pt-16 lg:pb-20">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 lg:gap-10 items-stretch">
              <div className="lg:col-span-6 flex flex-col justify-center">
                <p className="text-xs sm:text-sm font-semibold text-[#06B6D4] tracking-tight">
                  Coverage, without the chaos.
                </p>
                <h1
                  className="mt-2 font-bold tracking-tight text-[#0B1F44] leading-[1.08]"
                  style={{ fontSize: 'clamp(1.85rem, 3.6vw, 3.25rem)', textWrap: 'balance' }}
                >
                  Never let a staffing gap become a care disruption.
                </h1>
                <p className="mt-3.5 sm:mt-4 text-sm sm:text-base lg:text-lg text-[#52647D] leading-relaxed max-w-xl">
                  CoverPulse helps care teams find eligible cover, automate shift offers and see workforce
                  coverage clearly—without replacing the systems they already rely on.
                </p>

                <div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3">
                  <a
                    href="#book-demo"
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#0B1F44] text-white text-sm font-semibold hover:bg-[#132f63] transition-colors whitespace-nowrap shadow-xs"
                  >
                    Book a demo
                    <ArrowRight className="w-4 h-4 text-[#06B6D4]" />
                  </a>
                  <button
                    type="button"
                    onClick={() => onQuickDemoLaunch('demo-ops-manager')}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-slate-300 bg-white text-[#0B1F44] text-sm font-semibold hover:bg-slate-50 hover:border-slate-400 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Explore live console
                  </button>
                </div>

                {/* Compact Multi-Market Switcher + Worker PWA Shortcut */}
                <div className="mt-6 pt-4 border-t border-slate-200/80 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-[#52647D]">
                      <Globe className="w-3.5 h-3.5 text-[#0E8BFF] shrink-0" />
                      <span>Market profile:</span>
                    </div>
                    <div className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-lg">
                      {MARKET_LIST.map((m) => (
                        <button
                          key={m.code}
                          type="button"
                          onClick={() => setMarketCode(m.code)}
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            marketCode === m.code
                              ? 'bg-white text-[#0B1F44] shadow-2xs'
                              : 'text-[#52647D] hover:text-[#0B1F44]'
                          }`}
                        >
                          {m.shortName}
                          {m.code === 'AU' ? ' · Launch' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#52647D]">
                    <span className="truncate">
                      {market.name}: {market.sectors.join(' · ')}
                    </span>
                    <button
                      type="button"
                      onClick={() => onQuickDemoLaunch('demo-worker-chloe')}
                      className="font-semibold text-[#0E8BFF] hover:text-[#0B1F44] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Open Worker PWA →
                    </button>
                  </div>
                </div>
              </div>

              {/* Real Product UI Frame (Interactive Illustrative Demo Preview) */}
              <div className="lg:col-span-6 flex">
                <div className="w-full rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
                  <div className="bg-[#0B1F44] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-white">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-[#06B6D4]">
                        Live Shift Eligibility &amp; Wave Preview
                      </p>
                      <p className="text-sm font-semibold mt-0.5 leading-snug truncate">
                        {solution.sampleShift.split(' · ').slice(0, 2).join(' · ')}
                      </p>
                    </div>
                    <span className="text-xs text-slate-300 font-mono tabular-nums whitespace-nowrap">
                      22:00–06:30
                    </span>
                  </div>

                  <div className="p-4 flex-1 flex flex-col justify-between gap-3.5">
                    <div className="grid grid-cols-3 gap-2 sm:gap-3 pb-3 border-b border-slate-100">
                      <div>
                        <p className="text-[11px] text-[#52647D]">Hard Filters</p>
                        <p className="text-base sm:text-lg font-bold text-[#0B1F44] font-mono tabular-nums mt-0.5">
                          4 / 10 RNs
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-[#52647D]">Clinical Gate</p>
                        <p className="text-xs font-semibold text-[#16A879] mt-1 leading-tight truncate">
                          {market.clinicalCheckExample.split(' ')[0]} · CPR
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-[#52647D]">Autopilot</p>
                        <p className="text-xs font-semibold text-[#0B1F44] mt-1 leading-tight">
                          Tiered Wave (3)
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <p className="text-xs font-semibold text-[#52647D]">Deterministic Ranking</p>
                        <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-md text-[11px] font-semibold">
                          {(
                            [
                              { key: 'all', label: 'All (4)' },
                              { key: 'eligible', label: 'Eligible (2)' },
                              { key: 'excluded', label: 'Blocked (2)' },
                            ] as const
                          ).map((tab) => (
                            <button
                              key={tab.key}
                              type="button"
                              onClick={() => setHeroFilter(tab.key)}
                              className={`px-2 py-1 rounded transition-colors cursor-pointer whitespace-nowrap ${
                                heroFilter === tab.key
                                  ? 'bg-white text-[#0B1F44] shadow-2xs'
                                  : 'text-[#52647D] hover:text-[#0B1F44]'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {[
                        {
                          rank: '#1',
                          name: 'Chloe Nguyen',
                          meta: `Primary site · 4 km · Verified ${market.clinicalCheckExample.split(' ')[0]} · 2 shifts`,
                          score: '93/100',
                          status: 'Eligible · Wave 1',
                          ok: true,
                        },
                        {
                          rank: '#2',
                          name: 'Lachlan Reid',
                          meta: `Primary site · 6 km · Verified ${market.clinicalCheckExample.split(' ')[0]} · 1 shift`,
                          score: '90/100',
                          status: 'Eligible · Wave 1',
                          ok: true,
                        },
                        {
                          rank: '—',
                          name: 'Sienna Patel',
                          meta: `Excluded: ${market.clinicalCheckExample.split(' ')[0]} expired 18d ago (safety-locked)`,
                          score: 'Blocked',
                          status: 'Ineligible',
                          ok: false,
                        },
                        {
                          rank: '—',
                          name: 'Benjamin Kowalski',
                          meta: 'Excluded: Work restriction (No overnight shifts)',
                          score: 'Blocked',
                          status: 'Ineligible',
                          ok: false,
                        },
                      ]
                        .filter((r) =>
                          heroFilter === 'all' ? true : heroFilter === 'eligible' ? r.ok : !r.ok,
                        )
                        .map((row) => (
                          <div
                            key={row.name}
                            className="flex items-start sm:items-center justify-between gap-2.5 py-2 border-b border-slate-100 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-sm">
                                <span className="font-mono text-xs text-[#52647D] w-5 shrink-0">
                                  {row.rank}
                                </span>
                                <span className="font-semibold text-[#0B1F44] truncate">{row.name}</span>
                              </div>
                              <p className="text-xs text-[#52647D] pl-6 leading-snug mt-0.5">{row.meta}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p
                                className={`text-xs font-semibold font-mono tabular-nums ${
                                  row.ok ? 'text-[#16A879]' : 'text-[#DC4C64]'
                                }`}
                              >
                                {row.score}
                              </p>
                              <p className="text-[11px] text-[#52647D] whitespace-nowrap">{row.status}</p>
                            </div>
                          </div>
                        ))}
                    </div>

                    <div className="pt-2.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#52647D]">
                      <span>Illustrative synthetic demo — Harbourview Care Group</span>
                      <button
                        type="button"
                        onClick={() => onQuickDemoLaunch('demo-facility-manager')}
                        className="font-semibold text-[#0E8BFF] hover:text-[#0B1F44] whitespace-nowrap cursor-pointer self-start sm:self-auto"
                      >
                        Run this shift live →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works — Compact 3-step editorial workflow */}
        <section id="how-it-works" className="bg-white border-b border-slate-200 py-12 sm:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-xs sm:text-sm font-semibold text-[#06B6D4]">How CoverPulse works</p>
              <h2 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-[#0B1F44]">
                Identify the gap. Reach eligible workers. Confirm coverage.
              </h2>
              <p className="mt-2.5 text-sm sm:text-base text-[#52647D] leading-relaxed">
                Replace manual spreadsheets, group texts, and compliance guesswork with a single auditable
                coverage workflow engineered around clinical safety rules.
              </p>
            </div>

            <div className="mt-8 sm:mt-10 grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
              {[
                {
                  step: '01. Identify the gap',
                  desc: 'Publish an open or urgent shift with role, overnight timing, headcount, and mandatory credentials. Deterministic hard filters run immediately — never guessing eligibility.',
                  detail: 'Role match · Verified credentials · Rest breaks · Overlap guard',
                },
                {
                  step: '02. Reach eligible workers',
                  desc: 'Launch sequential, tiered, or parallel Coverage Autopilot waves across PWA, local SMS, and email while honouring quiet hours, response windows, and fair rotation.',
                  detail: 'Idempotent waves · Quiet-hour rules · Delivery timeline',
                },
                {
                  step: '03. Confirm coverage',
                  desc: 'The first eligible worker to accept is locked atomically in PostgreSQL to eliminate double booking. Remaining offers withdraw automatically, or escalate cleanly.',
                  detail: 'Atomic row locking · Auto-withdrawal · Full audit trail',
                },
              ].map((item) => (
                <div key={item.step} className="pt-4 sm:pt-5 border-t border-slate-200">
                  <h3 className="text-base sm:text-lg font-bold text-[#0B1F44]">{item.step}</h3>
                  <p className="mt-2 text-sm text-[#52647D] leading-relaxed">{item.desc}</p>
                  <p className="mt-3 text-xs font-medium text-[#0B1F44]">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Solutions by Care Sector */}
        <section id="solutions" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6">
            <div className="max-w-2xl">
              <p className="text-xs sm:text-sm font-semibold text-[#06B6D4]">
                Solutions · {market.name}
              </p>
              <h2 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-[#0B1F44]">
                Built for frontline care providers — starting in Australia, ready worldwide.
              </h2>
              <p className="mt-1.5 text-xs sm:text-sm text-[#52647D]">{market.providerDensityNote}</p>
            </div>

            <div className="flex sm:inline-flex items-center p-1 bg-slate-200/70 rounded-lg w-full sm:w-auto overflow-x-auto">
              {(
                [
                  { key: 'residential', label: market.sectors[0] },
                  { key: 'complex_care', label: market.sectors[1] },
                  { key: 'home_care', label: market.sectors[2] },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSolution(item.key)}
                  className={`flex-1 sm:flex-none min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    activeSolution === item.key
                      ? 'bg-white text-[#0B1F44] shadow-xs'
                      : 'text-[#52647D] hover:text-[#0B1F44]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 sm:mt-8 rounded-xl border border-slate-200 bg-white p-5 sm:p-7 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            <div className="lg:col-span-7">
              <h3 className="text-xl sm:text-2xl font-bold text-[#0B1F44] leading-snug">
                {solution.headline}
              </h3>
              <p className="mt-2.5 text-sm sm:text-base text-[#52647D] leading-relaxed">
                {solution.summary}
              </p>
              <ul className="mt-5 space-y-2.5">
                {solution.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2.5 text-sm text-[#0B1F44]">
                    <Check className="w-4 h-4 text-[#16A879] shrink-0 mt-0.5" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-5 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-200 pt-5 lg:pt-0 lg:pl-7">
              <div>
                <p className="text-xs font-semibold text-[#52647D]">Example Operational Workflow</p>
                <p className="mt-1.5 text-sm font-semibold text-[#0B1F44]">{solution.sampleShift}</p>
                <div className="mt-4 space-y-2.5 text-xs text-[#52647D]">
                  <div className="flex items-center gap-2.5">
                    <Building2 className="w-4 h-4 text-[#0E8BFF] shrink-0" />
                    <span>Facility-scoped RBAC ensures site managers only view authorised sites</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Smartphone className="w-4 h-4 text-[#0E8BFF] shrink-0" />
                    <span>Workers respond in seconds via mobile PWA with optional pay visibility</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-[#0E8BFF] shrink-0" />
                    <span>Every timestamp feeds time-to-first-response &amp; fill analytics</span>
                  </div>
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onOpenSignIn}
                  className="text-sm font-semibold text-[#0E8BFF] hover:text-[#0B1F44] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  Explore in interactive demo sandbox
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Integrations & Security/Privacy */}
        <section id="security" className="bg-white border-y border-slate-200 py-12 sm:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
            <div>
              <p className="text-xs sm:text-sm font-semibold text-[#06B6D4]">
                Integrations &amp; Implementation
              </p>
              <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-[#0B1F44]">
                Works alongside your existing rostering, HRIS, and payroll stack.
              </h2>
              <p className="mt-2.5 text-sm text-[#52647D] leading-relaxed">
                Start in days with CSV worker import and payroll timesheet exports. Connect automated
                write-back using HMAC-SHA256 signed webhooks with replay protection and idempotency keys.
              </p>

              <div className="mt-5 divide-y divide-slate-100 border-y border-slate-200 text-sm">
                {[
                  { name: 'CSV Worker & Shift Sync', status: 'Built-in & Active' },
                  { name: 'Signed Outbound Webhooks (HMAC-SHA256)', status: 'Active + Sandbox' },
                  { name: 'Rostering / HRIS / Payroll Adapters', status: 'Adapter interface & CSV export' },
                  { name: `Local SMS & Email Dispatch (${market.phoneCountryCode})`, status: 'Provider adapter ready' },
                ].map((row) => (
                  <div
                    key={row.name}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4"
                  >
                    <span className="font-medium text-[#0B1F44] flex items-center gap-2 text-sm">
                      <Webhook className="w-4 h-4 text-[#0E8BFF] shrink-0" />
                      {row.name}
                    </span>
                    <span className="text-xs text-[#52647D] pl-6 sm:pl-0 sm:whitespace-nowrap">
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs sm:text-sm font-semibold text-[#06B6D4]">
                Security &amp; Privacy Governance
              </p>
              <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-[#0B1F44]">
                Multi-tenant isolation and auditable controls from day one.
              </h2>
              <p className="mt-2.5 text-sm text-[#52647D] leading-relaxed">
                CoverPulse enforces tenant and facility boundaries on the server across every query,
                mutation, and export — never relying solely on hidden buttons.
              </p>

              <div className="mt-5 space-y-3.5 text-sm text-[#52647D]">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-[#16A879] shrink-0 mt-1" />
                  <p>
                    <strong className="text-[#0B1F44]">Strict Tenant &amp; Role Enforcement:</strong> Seven
                    least-privilege roles with server-side RBAC, immutable audit events, and time-limited
                    support elevation grants.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <Lock className="w-4 h-4 text-[#16A879] shrink-0 mt-1" />
                  <p>
                    <strong className="text-[#0B1F44]">{market.privacyFramework} Readiness:</strong> Data
                    minimisation, consent logging, retention policies, and self-service privacy export
                    workflows tailored for {market.regulatoryBody}. Qualified legal review is recommended
                    prior to production rollout.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Configurable Pricing Section */}
        <section id="pricing" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 sm:gap-6">
            <div className="max-w-2xl">
              <p className="text-xs sm:text-sm font-semibold text-[#06B6D4]">
                Commercial Model · {market.currencyCode}
              </p>
              <h2 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-[#0B1F44]">
                Transparent subscription tiers with clear SMS usage separation.
              </h2>
              <p className="mt-1.5 text-xs sm:text-sm text-[#52647D]">
                {market.code === 'AU'
                  ? 'Launch AUD tiers (configurable per organisation agreement). Subscription fees are itemised separately from usage-based SMS overages.'
                  : `Indicative ${market.currencyCode} equivalent of AUD launch tiers for ${market.name} care providers. Subscription fees are itemised separately from SMS usage.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-lg">
                {MARKET_LIST.map((m) => (
                  <button
                    key={m.code}
                    type="button"
                    onClick={() => setMarketCode(m.code)}
                    className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      marketCode === m.code
                        ? 'bg-white text-[#0B1F44] shadow-2xs'
                        : 'text-[#52647D] hover:text-[#0B1F44]'
                    }`}
                  >
                    {m.currencyCode}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-lg">
                <button
                  type="button"
                  onClick={() => setBillingCycle('monthly')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    billingCycle === 'monthly'
                      ? 'bg-white text-[#0B1F44] shadow-2xs'
                      : 'text-[#52647D] hover:text-[#0B1F44]'
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycle('annual')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    billingCycle === 'annual'
                      ? 'bg-white text-[#0B1F44] shadow-2xs'
                      : 'text-[#52647D] hover:text-[#0B1F44]'
                  }`}
                >
                  Annual (Save 18%)
                </button>
              </div>
            </div>
          </div>

          <div className="mt-7 sm:mt-8 grid grid-cols-1 md:grid-cols-3 gap-5">
            {plansLoading && plans.length === 0
              ? [1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-[380px] rounded-xl bg-white border border-slate-200 p-6 animate-pulse"
                  />
                ))
              : plans.map((plan) => {
                  const baseMonthlyCents =
                    billingCycle === 'annual'
                      ? Math.round(plan.monthlyPriceAudCents * (1 - plan.annualDiscountPct / 100))
                      : plan.monthlyPriceAudCents;
                  const isGrowth = plan.tierKey === 'growth';
                  return (
                    <div
                      key={plan.tierKey}
                      className={`rounded-xl bg-white p-5 sm:p-6 flex flex-col justify-between border ${
                        isGrowth ? 'border-[#0E8BFF] shadow-xs' : 'border-slate-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="text-base sm:text-lg font-bold text-[#0B1F44]">{plan.displayName}</h3>
                          {isGrowth && (
                            <span className="text-xs font-semibold text-[#0E8BFF]">Most common</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-[#52647D]">{plan.targetAudience}</p>

                        <div className="mt-4 pb-4 border-b border-slate-100">
                          <div className="flex items-baseline gap-1">
                            <span className="text-2xl sm:text-3xl font-bold text-[#0B1F44] font-mono tabular-nums">
                              {formatMarketCents(baseMonthlyCents, market)}
                            </span>
                            <span className="text-xs text-[#52647D]">/mo {market.taxLabel}</span>
                          </div>
                          <p className="mt-1 text-xs text-[#52647D] font-mono tabular-nums">
                            Onboarding: {formatMarketCents(plan.onboardingFeeAudCents, market)} · SMS{' '}
                            {formatMarketCents(plan.smsOverageCents, market, { decimals: 2 })}/msg
                          </p>
                        </div>

                        <div className="mt-3.5 grid grid-cols-3 gap-2 text-xs pb-3.5 border-b border-slate-100">
                          <div>
                            <p className="text-[#52647D]">Facilities</p>
                            <p className="font-semibold text-[#0B1F44] font-mono tabular-nums">
                              {plan.maxFacilities}
                            </p>
                          </div>
                          <div>
                            <p className="text-[#52647D]">Workers</p>
                            <p className="font-semibold text-[#0B1F44] font-mono tabular-nums">
                              {plan.maxWorkers}
                            </p>
                          </div>
                          <div>
                            <p className="text-[#52647D]">Incl. SMS</p>
                            <p className="font-semibold text-[#0B1F44] font-mono tabular-nums">
                              {plan.includedSmsPerMonth.toLocaleString()}
                            </p>
                          </div>
                        </div>

                        <ul className="mt-4 space-y-2 text-xs sm:text-sm text-[#52647D]">
                          {plan.featuresJson.map((f) => (
                            <li key={f} className="flex items-start gap-2">
                              <Check className="w-4 h-4 text-[#16A879] shrink-0 mt-0.5" />
                              <span>{f}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <a
                        href="#book-demo"
                        className={`mt-6 min-h-[44px] flex items-center justify-center px-4 rounded-lg text-sm font-semibold transition-colors ${
                          isGrowth
                            ? 'bg-[#0B1F44] text-white hover:bg-[#132f63]'
                            : 'border border-slate-300 text-[#0B1F44] hover:bg-slate-50'
                        }`}
                      >
                        Request {plan.displayName} pilot
                      </a>
                    </div>
                  );
                })}
          </div>
        </section>

        {/* Resources / Guides */}
        <section className="bg-white border-t border-slate-200 py-12 sm:py-14">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-xs sm:text-sm font-semibold text-[#06B6D4]">Resources &amp; Guides</p>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-[#0B1F44]">
              Operational notes for workforce and clinical leads
            </h2>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-5">
              {GUIDES.map((g) => (
                <article
                  key={g.id}
                  className="rounded-xl border border-slate-200 p-5 flex flex-col justify-between bg-[#F8FAFC]"
                >
                  <div>
                    <div className="flex items-center gap-2 text-xs text-[#52647D]">
                      <span>{g.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{g.readTime}</span>
                    </div>
                    <h3 className="mt-1.5 text-base font-bold text-[#0B1F44] leading-snug">{g.title}</h3>
                    <p className="mt-2 text-xs sm:text-sm text-[#52647D] leading-relaxed">{g.excerpt}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveGuide(g)}
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0E8BFF] hover:text-[#0B1F44] cursor-pointer self-start"
                  >
                    <BookOpen className="w-4 h-4" />
                    Read guide
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Book a Demo Form */}
        <section id="book-demo" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-7 lg:gap-10">
            <div className="lg:col-span-5">
              <p className="text-xs sm:text-sm font-semibold text-[#06B6D4]">Book a demo</p>
              <h2 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-[#0B1F44]">
                See CoverPulse configured for your care facilities.
              </h2>
              <p className="mt-2.5 text-sm text-[#52647D] leading-relaxed">
                Walk through deterministic qualification checks, Coverage Autopilot waves, Worker PWA
                acceptance, and CSV/webhook integration with an implementation specialist.
              </p>
              <div className="mt-5 pt-5 border-t border-slate-100 space-y-1.5 text-xs text-[#52647D]">
                <p className="font-semibold text-[#0B1F44]">Available deployment pathways:</p>
                <p>14-day guided sandbox · 60-day paid single-site pilot · Multi-site rollout</p>
              </div>
            </div>

            <div className="lg:col-span-7">
              {submittedMsg ? (
                <div className="rounded-xl border border-[#16A879]/30 bg-[#16A879]/5 p-5">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-[#16A879] shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-base font-bold text-[#0B1F44]">Demo request confirmed</h3>
                      <p className="mt-1 text-sm text-[#52647D]">{submittedMsg}</p>
                      <button
                        type="button"
                        onClick={() => setSubmittedMsg(null)}
                        className="mt-3 text-xs font-semibold text-[#0E8BFF] hover:underline cursor-pointer"
                      >
                        Submit another enquiry
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmitDemo} className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label htmlFor="demo-name" className="block text-xs font-semibold text-[#0B1F44] mb-1">
                        Full name *
                      </label>
                      <input
                        id="demo-name"
                        type="text"
                        required
                        value={form.fullName}
                        onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                        placeholder="Alex Morgan"
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] focus:border-[#0E8BFF] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="demo-email" className="block text-xs font-semibold text-[#0B1F44] mb-1">
                        Work email *
                      </label>
                      <input
                        id="demo-email"
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        placeholder="alex@careprovider.org"
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] focus:border-[#0E8BFF] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label htmlFor="demo-org" className="block text-xs font-semibold text-[#0B1F44] mb-1">
                        Organisation *
                      </label>
                      <input
                        id="demo-org"
                        type="text"
                        required
                        value={form.organisationName}
                        onChange={(e) => setForm({ ...form, organisationName: e.target.value })}
                        placeholder="Bayside Care Services"
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] focus:border-[#0E8BFF] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="demo-market" className="block text-xs font-semibold text-[#0B1F44] mb-1">
                        Country / Market
                      </label>
                      <select
                        id="demo-market"
                        value={marketCode}
                        onChange={(e) => setMarketCode(e.target.value as MarketCode)}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] bg-white"
                      >
                        {MARKET_LIST.map((m) => (
                          <option key={m.code} value={m.code}>
                            {m.name} ({m.currencyCode}){m.code === 'AU' ? ' — Launch Market' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div>
                      <label htmlFor="demo-sector" className="block text-xs font-semibold text-[#0B1F44] mb-1">
                        Primary care sector
                      </label>
                      <select
                        id="demo-sector"
                        value={form.sector}
                        onChange={(e) => setForm({ ...form, sector: e.target.value })}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] bg-white"
                      >
                        {market.sectors.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                        <option value="Multi-Service Provider">Multi-Service Provider</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="demo-facs" className="block text-xs font-semibold text-[#0B1F44] mb-1">
                        Sites / hubs
                      </label>
                      <select
                        id="demo-facs"
                        value={form.facilityCount}
                        onChange={(e) => setForm({ ...form, facilityCount: e.target.value })}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44] bg-white"
                      >
                        <option value="1–2 facilities">1–2 facilities</option>
                        <option value="3–10 facilities">3–10 facilities</option>
                        <option value="11–30 facilities">11–30 facilities</option>
                        <option value="30+ facilities">30+ facilities</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="demo-phone" className="block text-xs font-semibold text-[#0B1F44] mb-1">
                        Phone (optional)
                      </label>
                      <input
                        id="demo-phone"
                        type="tel"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        placeholder={market.phonePlaceholder}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44]"
                      />
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 text-xs text-[#52647D] pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.consentGranted}
                      onChange={(e) => setForm({ ...form, consentGranted: e.target.checked })}
                      className="mt-0.5 rounded border-slate-300"
                    />
                    <span>
                      I consent to CoverPulse storing my contact details solely to arrange a product
                      demonstration in line with {market.privacyFramework}. You may request export or
                      deletion at any time.
                    </span>
                  </label>

                  {formError && (
                    <p role="alert" className="text-xs font-semibold text-[#DC4C64]">
                      {formError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-lg bg-[#0B1F44] text-white text-sm font-semibold hover:bg-[#132f63] disabled:opacity-60 transition-colors cursor-pointer"
                  >
                    {submitting ? 'Submitting request...' : 'Request tailored demo'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="bg-[#0B1F44] text-slate-300 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <img
              src="/assets/aistudio/coverpulse-logo-dark_2b9d897e.svg"
              alt="CoverPulse"
              className="h-7 w-auto"
              referrerPolicy="no-referrer"
            />
            <p className="mt-2.5 text-sm text-slate-300">
              Smarter Workforce Coverage. A Healthier Tomorrow.
            </p>
            <p className="mt-1.5 text-xs text-slate-400 max-w-md">
              Launching in Australia · Built for US, UK &amp; Canadian care providers. Preview
              environments use synthetic data; AI acts strictly as decision support.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-xs text-slate-300">
            <a href="#how-it-works" className="hover:text-white">How it works</a>
            <a href="#solutions" className="hover:text-white">Solutions</a>
            <a href="#security" className="hover:text-white">Security &amp; Privacy</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <button type="button" onClick={onOpenSignIn} className="hover:text-white cursor-pointer">
              Sign in
            </button>
          </div>
        </div>
      </footer>

      {/* Guide Reader Modal */}
      {activeGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="guide-modal-title"
          className="fixed inset-0 z-50 bg-[#0B1F44]/60 flex items-end sm:items-center justify-center sm:p-4"
        >
          <div className="bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-w-xl w-full max-h-[85vh] overflow-y-auto p-5 sm:p-7 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-[#52647D]">
                  {activeGuide.category} · {activeGuide.readTime}
                </p>
                <h3 id="guide-modal-title" className="mt-1 text-lg sm:text-xl font-bold text-[#0B1F44]">
                  {activeGuide.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveGuide(null)}
                aria-label="Close guide"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-[#0B1F44] hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3.5 text-sm text-[#52647D] leading-relaxed">
              {activeGuide.body.map((para, idx) => (
                <p key={idx}>{para}</p>
              ))}
            </div>
            <div className="mt-5 pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveGuide(null)}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold hover:bg-[#132f63] cursor-pointer"
              >
                Close guide
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
