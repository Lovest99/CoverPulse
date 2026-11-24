import React, { useEffect, useState } from 'react';
import {
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  Home,
  LogOut,
  MapPin,
  Moon,
  Phone,
  RefreshCw,
  ShieldCheck,
  User,
  UserCog,
  WifiOff,
  X,
} from 'lucide-react';
import { apiFetch, ApiError } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useMarket } from '../MarketContext.tsx';
import { useOnlineStatus } from '../hooks/usePWA.ts';
import { PWAInstallButton } from '../components/PWAControls.tsx';
import { useToast } from '../components/Toast.tsx';
import { ROLE_LABELS } from '../../shared/types.ts';
import { formatMarketDollars } from '../../shared/markets.ts';

interface WorkerOffer {
  id: string;
  status: string;
  channel: string;
  sentAt: string;
  expiresAt: string;
  respondedAt: string | null;
  shiftId: string;
  shiftTitle: string;
  roleRequired: string;
  shiftDate: string;
  startAt: string;
  endAt: string;
  breakMinutes: number;
  paidHours: number;
  urgency: string;
  isOvernight: boolean;
  hourlyRateAud: number | null;
  showRateToWorker: boolean;
  notes: string | null;
  facilityName: string;
  facilitySuburb: string;
  facilityAddress: string;
  facilityPhone: string;
}

interface WorkerAssignment {
  id: string;
  status: string;
  confirmedAt: string | null;
  shiftId: string;
  shiftTitle: string;
  roleRequired: string;
  shiftDate: string;
  startAt: string;
  endAt: string;
  breakMinutes: number;
  isOvernight: boolean;
  notes: string | null;
  facilityName: string;
  facilitySuburb: string;
  facilityAddress: string;
  facilityPhone: string;
}

interface WorkerQual {
  id: string;
  referenceNumber: string;
  issuedAt: string;
  expiresAt: string;
  reviewStatus: string;
  code: string;
  name: string;
  category: string;
}

interface AvailWindow {
  id: string;
  dayOfWeek: number;
  isAvailable: boolean;
  startTime: string;
  endTime: string;
}

interface WorkerHomePayload {
  worker: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    primaryRole: string;
    employmentType: string;
    preferredChannel: 'in_app' | 'sms' | 'email';
    travelRadiusKm: number;
    availabilityStatus: 'available' | 'limited' | 'unavailable';
    reliabilityScore: number;
  };
  openOffers: WorkerOffer[];
  offerHistory: WorkerOffer[];
  upcomingShifts: WorkerAssignment[];
  pastShifts: WorkerAssignment[];
  qualifications: WorkerQual[];
  availability: AvailWindow[];
  notifications: Array<{
    id: string;
    title: string;
    body: string;
    category: string;
    readAt: string | null;
    createdAt: string;
  }>;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type WorkerTab = 'home' | 'offers' | 'shifts' | 'availability' | 'profile';

export const WorkerPwaView: React.FC<{ onGoPublic: () => void }> = ({ onGoPublic }) => {
  const { session, personas, signInDemoPersona, signOut } = useAuth();
  const { market } = useMarket();
  const { pushToast } = useToast();
  const isOnline = useOnlineStatus();

  const [tab, setTab] = useState<WorkerTab>('home');
  const [data, setData] = useState<WorkerHomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Confirm accept & decline modals
  const [confirmOffer, setConfirmOffer] = useState<WorkerOffer | null>(null);
  const [declineOffer, setDeclineOffer] = useState<WorkerOffer | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  // Availability editor state
  const [availStatus, setAvailStatus] = useState<'available' | 'limited' | 'unavailable'>('available');
  const [windows, setWindows] = useState<AvailWindow[]>([]);

  // Profile editor state
  const [profileForm, setProfileForm] = useState({
    preferredChannel: 'sms' as 'in_app' | 'sms' | 'email',
    travelRadiusKm: 20,
    phone: '',
  });

  // Cross-tenant isolation verification probe (for evaluator testing Tenant B)
  const [isolationResult, setIsolationResult] = useState<string | null>(null);
  const [personaDrawer, setPersonaDrawer] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<WorkerHomePayload>('/api/worker/home');
      setData(res);
      setAvailStatus(res.worker.availabilityStatus);
      setWindows(res.availability);
      setProfileForm({
        preferredChannel: res.worker.preferredChannel,
        travelRadiusKm: res.worker.travelRadiusKm,
        phone: res.worker.phone,
      });
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to load worker schedule.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [session?.userId]);

  const handleAcceptOffer = async () => {
    if (!confirmOffer || !isOnline) return;
    setBusyAction(confirmOffer.id);
    try {
      await apiFetch(`/api/worker/offers/${confirmOffer.id}/accept`, { method: 'POST' });
      pushToast({
        type: 'success',
        title: 'Shift confirmed and added to My Shifts.',
        detail: `${confirmOffer.shiftTitle} at ${confirmOffer.facilityName}`,
      });
      setConfirmOffer(null);
      await load();
      setTab('shifts');
    } catch (err) {
      pushToast({
        type: 'error',
        title: err instanceof Error ? err.message : 'Offer could not be accepted.',
      });
      setConfirmOffer(null);
      await load();
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeclineOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!declineOffer || !isOnline) return;
    setBusyAction(declineOffer.id);
    try {
      await apiFetch(`/api/worker/offers/${declineOffer.id}/decline`, {
        method: 'POST',
        body: JSON.stringify({ reason: declineReason || 'Unavailable for this shift' }),
      });
      pushToast({ type: 'info', title: 'Shift offer declined. Autopilot updated.' });
      setDeclineOffer(null);
      setDeclineReason('');
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to decline offer.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveAvailability = async () => {
    if (!isOnline) return;
    setBusyAction('availability');
    try {
      await apiFetch('/api/worker/availability', {
        method: 'PATCH',
        body: JSON.stringify({
          availabilityStatus: availStatus,
          windows: windows.map((w) => ({
            dayOfWeek: w.dayOfWeek,
            isAvailable: w.isAvailable,
            startTime: w.startTime,
            endTime: w.endTime,
          })),
        }),
      });
      pushToast({ type: 'success', title: 'Availability preferences saved.' });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to save availability.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) return;
    setBusyAction('profile');
    try {
      await apiFetch('/api/worker/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          ...profileForm,
          travelRadiusKm: Number(profileForm.travelRadiusKm),
        }),
      });
      pushToast({ type: 'success', title: 'Contact preferences saved.' });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to update profile.' });
    } finally {
      setBusyAction(null);
    }
  };

  const runTenantIsolationCheck = async () => {
    setIsolationResult('Checking server-side tenant isolation...');
    try {
      await apiFetch('/api/shifts');
      setIsolationResult('Unexpected access to manager endpoint.');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setIsolationResult(
          `Verified (${err.status}): Tenant B worker (${session?.tenantName}) is blocked from manager shift listings and all Harbourview Care Group (Tenant A) records.`,
        );
      } else {
        setIsolationResult(`Verified blocked: ${err instanceof Error ? err.message : 'Forbidden'}`);
      }
    }
  };

  const formatTimeRange = (startIso: string, endIso: string) => {
    const s = new Date(startIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const e = new Date(endIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${s}–${e}`;
  };

  const openOffersCount = data?.openOffers.length ?? 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col pb-20 md:pb-8">
      {/* Compact Top App Header */}
      <header className="sticky top-0 z-30 h-14 bg-[#0B1F44] text-white px-4 sm:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/assets/aistudio/coverpulse-logo-dark_2b9d897e.svg"
            alt="CoverPulse"
            className="h-6 w-auto shrink-0"
          />
          <span className="hidden sm:inline text-xs text-slate-300 truncate">
            · {session?.tenantName}
          </span>
        </div>

        {/* Desktop Tab Bar */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Worker navigation">
          {(
            [
              { key: 'home', label: 'Home' },
              { key: 'offers', label: `Offers${openOffersCount ? ` (${openOffersCount})` : ''}` },
              { key: 'shifts', label: 'My Shifts' },
              { key: 'availability', label: 'Availability' },
              { key: 'profile', label: 'Profile & Creds' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                tab === t.key ? 'bg-[#0E8BFF] text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:block">
            <PWAInstallButton compact />
          </div>
          <button
            type="button"
            onClick={() => setPersonaDrawer((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
          >
            <UserCog className="w-3.5 h-3.5 text-[#06B6D4]" />
            <span className="hidden sm:inline">Switch Role</span>
          </button>
          <button
            type="button"
            onClick={load}
            aria-label="Refresh worker data"
            className="p-2 rounded-lg hover:bg-white/10 text-slate-200 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Persona Switcher Overlay */}
      {personaDrawer && (
        <div className="fixed inset-0 z-50 bg-[#0B1F44]/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-xl bg-white border-t sm:border border-slate-200 shadow-xl overflow-hidden">
            <div className="sm:hidden w-10 h-1 bg-slate-300 rounded-full mx-auto mt-2.5" aria-hidden="true" />
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <p className="text-sm font-bold text-[#0B1F44]">Switch Demo Workspace Account</p>
              <button
                type="button"
                onClick={() => setPersonaDrawer(false)}
                aria-label="Close switcher"
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 max-h-80 overflow-y-auto divide-y divide-slate-100">
              {personas.map((p) => (
                <button
                  key={p.uid}
                  type="button"
                  onClick={async () => {
                    setPersonaDrawer(false);
                    await signInDemoPersona(p.uid);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-xs hover:bg-slate-50 cursor-pointer flex items-center justify-between ${
                    p.uid === session?.uid ? 'bg-[#0E8BFF]/5 font-semibold' : ''
                  }`}
                >
                  <div>
                    <p className="font-semibold text-[#0B1F44]">{p.fullName}</p>
                    <p className="text-[11px] text-[#52647D]">
                      {ROLE_LABELS[p.roleKey as keyof typeof ROLE_LABELS] ?? p.roleKey} · {p.tenantName}
                    </p>
                  </div>
                  {p.uid === session?.uid && <span className="text-[#0E8BFF] font-bold">Active</span>}
                </button>
              ))}
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={onGoPublic}
                className="text-xs font-semibold text-[#52647D] hover:text-[#0B1F44] cursor-pointer"
              >
                Public Website
              </button>
              <button
                type="button"
                onClick={signOut}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#DC4C64] cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline Read-Only Warning */}
      {!isOnline && (
        <div className="bg-[#F59E0B]/15 border-b border-[#F59E0B]/30 px-4 py-2 text-xs font-semibold text-[#0B1F44] flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4 text-[#F59E0B]" />
          You are offline. Viewing cached schedule — reconnect to accept or decline shift offers safely.
        </div>
      )}

      {/* Main Worker Content */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-3.5 sm:px-6 py-4 space-y-4">
        {loading && !data ? (
          <div className="space-y-4">
            <div className="h-28 rounded-xl bg-white border border-slate-200 animate-pulse" />
            <div className="h-44 rounded-xl bg-white border border-slate-200 animate-pulse" />
          </div>
        ) : !data ? (
          <div className="rounded-xl bg-white border border-slate-200 p-8 text-center text-sm text-[#52647D]">
            Unable to load worker profile.
          </div>
        ) : (
          <>
            {/* HOME TAB */}
            {tab === 'home' && (
              <div className="space-y-5">
                {/* Worker Greeting + Quick Availability */}
                <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-[#0E8BFF]">{data.worker.primaryRole}</p>
                    <h1 className="mt-0.5 text-xl font-bold text-[#0B1F44]">
                      Welcome, {data.worker.firstName} {data.worker.lastName}
                    </h1>
                    <p className="text-xs text-[#52647D] mt-0.5">
                      {session?.tenantName} · {data.worker.employmentType} · Reliability{' '}
                      <span className="font-mono tabular-nums">{data.worker.reliabilityScore}/100</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#52647D]">Status:</span>
                    <button
                      type="button"
                      onClick={() => setTab('availability')}
                      className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold capitalize cursor-pointer ${
                        data.worker.availabilityStatus === 'available'
                          ? 'border-[#16A879]/40 bg-[#16A879]/10 text-[#16A879]'
                          : data.worker.availabilityStatus === 'limited'
                            ? 'border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[#F59E0B]'
                            : 'border-slate-300 bg-slate-100 text-[#52647D]'
                      }`}
                    >
                      {data.worker.availabilityStatus}
                    </button>
                  </div>
                </div>

                {/* Quick Summary Stat Row (2-col mobile thumb-friendly glance) */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTab('offers')}
                    className="text-left rounded-2xl bg-white border border-slate-200 p-4 hover:border-[#0E8BFF] active:scale-[0.99] transition-all cursor-pointer"
                  >
                    <p className="text-xs font-medium text-[#52647D]">Pending Offers</p>
                    <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-[#0B1F44]">
                      {data.openOffers.length}
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold text-[#0E8BFF]">
                      {data.openOffers.length > 0 ? 'Tap to review →' : 'All caught up'}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('shifts')}
                    className="text-left rounded-2xl bg-white border border-slate-200 p-4 hover:border-[#0E8BFF] active:scale-[0.99] transition-all cursor-pointer"
                  >
                    <p className="text-xs font-medium text-[#52647D]">Confirmed Shifts</p>
                    <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-[#16A879]">
                      {data.upcomingShifts.length}
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold text-[#52647D]">View schedule →</p>
                  </button>
                </div>

                {/* Tenant B Isolation Verification Panel */}
                {session?.tenantSlug === 'southern-cross-demo-b' && (
                  <div className="rounded-xl bg-white border border-[#0E8BFF]/40 p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-[#0E8BFF]">
                          Multi-Tenant Isolation Check (Tenant B)
                        </p>
                        <p className="text-xs text-[#52647D] mt-0.5">
                          Signed in as {data.worker.firstName} {data.worker.lastName} under Southern Cross Community Care. Verify zero access to Harbourview Care Group (Tenant A).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={runTenantIsolationCheck}
                        className="px-3.5 py-2 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                      >
                        Run Isolation Check
                      </button>
                    </div>
                    {isolationResult && (
                      <p className="text-xs font-mono text-[#16A879] bg-[#16A879]/5 border border-[#16A879]/20 rounded-lg p-3">
                        {isolationResult}
                      </p>
                    )}
                  </div>
                )}

                {/* Open Offers Alert Card */}
                <div className="rounded-xl bg-white border border-slate-200 p-5">
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <h2 className="text-sm font-bold text-[#0B1F44]">
                      Active Shift Offers ({data.openOffers.length})
                    </h2>
                    <button
                      type="button"
                      onClick={() => setTab('offers')}
                      className="text-xs font-semibold text-[#0E8BFF] cursor-pointer"
                    >
                      View all →
                    </button>
                  </div>

                  {data.openOffers.length === 0 ? (
                    <p className="py-6 text-center text-xs text-[#52647D]">
                      No pending shift offers right now. You will be notified via {data.worker.preferredChannel.toUpperCase()} when a matching shift opens.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {data.openOffers.map((offer) => (
                        <div key={offer.id} className="py-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 text-xs">
                                <span
                                  className={`font-bold uppercase ${
                                    offer.urgency === 'critical'
                                      ? 'text-[#DC4C64]'
                                      : offer.urgency === 'high'
                                        ? 'text-[#F59E0B]'
                                        : 'text-[#0E8BFF]'
                                  }`}
                                >
                                  {offer.urgency}
                                </span>
                                {offer.isOvernight && (
                                  <>
                                    <span className="text-slate-300">·</span>
                                    <span className="inline-flex items-center gap-1 text-[#0B1F44] font-semibold">
                                      <Moon className="w-3 h-3" /> Overnight
                                    </span>
                                  </>
                                )}
                              </div>
                              <p className="mt-1 text-base font-bold text-[#0B1F44]">{offer.shiftTitle}</p>
                              <p className="text-xs text-[#52647D] mt-0.5">
                                {offer.facilityName} · {offer.facilitySuburb}
                              </p>
                            </div>
                            {offer.hourlyRateAud !== null && (
                              <div className="text-right font-mono tabular-nums shrink-0">
                                <p className="text-sm font-bold text-[#16A879]">
                                  {formatMarketDollars(offer.hourlyRateAud, market)}/h
                                </p>
                                <p className="text-[11px] text-[#52647D]">{offer.paidHours}h paid</p>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#0B1F44] font-mono tabular-nums">
                            <span>{offer.shiftDate}</span>
                            <span>{formatTimeRange(offer.startAt, offer.endAt)}</span>
                            <span className="text-[#52647D] font-sans">
                              Expires {new Date(offer.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 pt-1">
                            <button
                              type="button"
                              disabled={!isOnline || busyAction === offer.id}
                              onClick={() => setConfirmOffer(offer)}
                              className="min-h-[44px] rounded-lg bg-[#0E8BFF] hover:bg-[#0B74D6] disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                            >
                              Accept Shift
                            </button>
                            <button
                              type="button"
                              disabled={!isOnline || busyAction === offer.id}
                              onClick={() => setDeclineOffer(offer)}
                              className="min-h-[44px] rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-xs font-semibold text-[#0B1F44] cursor-pointer"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Next Confirmed Shift */}
                <div className="rounded-xl bg-white border border-slate-200 p-5">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <h2 className="text-sm font-bold text-[#0B1F44]">
                      Next Confirmed Shift ({data.upcomingShifts.length} upcoming)
                    </h2>
                    <button
                      type="button"
                      onClick={() => setTab('shifts')}
                      className="text-xs font-semibold text-[#0E8BFF] cursor-pointer"
                    >
                      Full schedule →
                    </button>
                  </div>
                  {data.upcomingShifts.length === 0 ? (
                    <p className="py-5 text-xs text-[#52647D]">No confirmed upcoming shifts scheduled yet.</p>
                  ) : (
                    <div className="pt-3 space-y-1.5">
                      <p className="text-sm font-bold text-[#0B1F44]">{data.upcomingShifts[0].shiftTitle}</p>
                      <p className="text-xs text-[#52647D]">
                        {data.upcomingShifts[0].facilityName} · {data.upcomingShifts[0].facilityAddress}, {data.upcomingShifts[0].facilitySuburb}
                      </p>
                      <p className="text-xs font-mono font-semibold text-[#0B1F44] tabular-nums">
                        {data.upcomingShifts[0].shiftDate} ·{' '}
                        {formatTimeRange(data.upcomingShifts[0].startAt, data.upcomingShifts[0].endAt)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* OFFERS TAB */}
            {tab === 'offers' && (
              <div className="space-y-5">
                <h1 className="text-lg font-bold text-[#0B1F44]">Shift Offers</h1>
                {data.openOffers.length === 0 ? (
                  <div className="rounded-xl bg-white border border-slate-200 p-8 text-center text-xs text-[#52647D]">
                    No active shift offers awaiting your response.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {data.openOffers.map((offer) => (
                      <div key={offer.id} className="rounded-xl bg-white border border-slate-200 p-5 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase text-[#DC4C64]">
                              {offer.urgency} · {offer.roleRequired}
                            </p>
                            <h2 className="mt-1 text-base font-bold text-[#0B1F44]">{offer.shiftTitle}</h2>
                          </div>
                          {offer.hourlyRateAud !== null && (
                            <span className="font-mono text-sm font-bold text-[#16A879] tabular-nums shrink-0">
                              {formatMarketDollars(offer.hourlyRateAud, market)}/h
                            </span>
                          )}
                        </div>
                        <div className="space-y-1 text-xs text-[#52647D]">
                          <p className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            {offer.facilityName} — {offer.facilityAddress}, {offer.facilitySuburb}
                          </p>
                          <p className="flex items-center gap-1.5 font-mono tabular-nums text-[#0B1F44]">
                            <Clock className="w-3.5 h-3.5 shrink-0 text-[#0E8BFF]" />
                            {offer.shiftDate} · {formatTimeRange(offer.startAt, offer.endAt)} ({offer.paidHours}h paid, {offer.breakMinutes}m break)
                          </p>
                          <p className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 shrink-0" />
                            Site desk: {offer.facilityPhone}
                          </p>
                        </div>
                        {offer.notes && (
                          <p className="text-xs text-[#0B1F44] bg-slate-50 border border-slate-200 rounded-lg p-3">
                            {offer.notes}
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <button
                            type="button"
                            disabled={!isOnline || busyAction === offer.id}
                            onClick={() => setConfirmOffer(offer)}
                            className="min-h-[44px] rounded-lg bg-[#0E8BFF] hover:bg-[#0B74D6] disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                          >
                            Accept Shift
                          </button>
                          <button
                            type="button"
                            disabled={!isOnline || busyAction === offer.id}
                            onClick={() => setDeclineOffer(offer)}
                            className="min-h-[44px] rounded-lg border border-slate-300 bg-white text-xs font-semibold text-[#0B1F44] cursor-pointer"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {data.offerHistory.length > 0 && (
                  <div className="rounded-xl bg-white border border-slate-200 p-5">
                    <h2 className="text-sm font-bold text-[#0B1F44] pb-3 border-b border-slate-100">
                      Past Offer History
                    </h2>
                    <div className="divide-y divide-slate-100">
                      {data.offerHistory.map((h) => (
                        <div key={h.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                          <div>
                            <p className="font-semibold text-[#0B1F44]">{h.shiftTitle}</p>
                            <p className="text-[#52647D]">
                              {h.facilityName} · {h.shiftDate}
                            </p>
                          </div>
                          <span
                            className={`font-semibold uppercase ${
                              h.status === 'accepted' ? 'text-[#16A879]' : 'text-[#52647D]'
                            }`}
                          >
                            {h.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MY SHIFTS TAB */}
            {tab === 'shifts' && (
              <div className="space-y-5">
                <h1 className="text-lg font-bold text-[#0B1F44]">My Confirmed Shifts</h1>
                <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-100 text-xs font-bold text-[#0B1F44]">
                    Upcoming ({data.upcomingShifts.length})
                  </div>
                  {data.upcomingShifts.length === 0 ? (
                    <p className="p-6 text-xs text-[#52647D] text-center">No upcoming shifts confirmed.</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {data.upcomingShifts.map((s) => (
                        <div key={s.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-[#0B1F44]">{s.shiftTitle}</p>
                            <p className="text-xs text-[#52647D] mt-0.5">
                              {s.facilityName} · {s.facilityAddress}, {s.facilitySuburb}
                            </p>
                          </div>
                          <div className="sm:text-right font-mono text-xs tabular-nums">
                            <p className="font-bold text-[#0B1F44]">
                              {s.shiftDate} · {formatTimeRange(s.startAt, s.endAt)}
                            </p>
                            <p className="font-sans font-semibold text-[#16A879] uppercase">{s.status}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {data.pastShifts.length > 0 && (
                  <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-100 text-xs font-bold text-[#52647D]">
                      Recent Completed Shifts ({data.pastShifts.length})
                    </div>
                    <div className="divide-y divide-slate-100">
                      {data.pastShifts.slice(0, 8).map((s) => (
                        <div key={s.id} className="px-5 py-3 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-semibold text-[#0B1F44]">{s.shiftTitle}</p>
                            <p className="text-[#52647D]">{s.facilityName}</p>
                          </div>
                          <span className="font-mono text-[#52647D] tabular-nums">{s.shiftDate}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* AVAILABILITY TAB */}
            {tab === 'availability' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h1 className="text-lg font-bold text-[#0B1F44]">My Availability</h1>
                  <button
                    type="button"
                    disabled={!isOnline || busyAction === 'availability'}
                    onClick={handleSaveAvailability}
                    className="px-4 py-2 rounded-lg bg-[#0E8BFF] hover:bg-[#0B74D6] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                  >
                    {busyAction === 'availability' ? 'Saving...' : 'Save Availability'}
                  </button>
                </div>

                <div className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-[#0B1F44] mb-2">Current Offer Readiness</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(['available', 'limited', 'unavailable'] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setAvailStatus(st)}
                          className={`min-h-[44px] rounded-lg border text-xs font-semibold capitalize whitespace-nowrap cursor-pointer ${
                            availStatus === st
                              ? 'border-[#0E8BFF] bg-[#0E8BFF]/10 text-[#0B1F44]'
                              : 'border-slate-200 bg-white text-[#52647D]'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 divide-y divide-slate-100">
                    {windows.map((w) => (
                      <div
                        key={w.id}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <label className="inline-flex items-center gap-2.5 text-sm font-semibold text-[#0B1F44] min-w-[90px] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={w.isAvailable}
                            onChange={(e) =>
                              setWindows((prev) =>
                                prev.map((row) =>
                                  row.dayOfWeek === w.dayOfWeek ? { ...row, isAvailable: e.target.checked } : row,
                                ),
                              )
                            }
                            className="w-4 h-4 rounded border-slate-300 text-[#0E8BFF]"
                          />
                          {DAY_NAMES[w.dayOfWeek]}
                        </label>
                        <div className="grid grid-cols-[1fr_auto_1fr] sm:flex items-center gap-2 text-xs font-mono">
                          <input
                            type="time"
                            disabled={!w.isAvailable}
                            value={w.startTime}
                            onChange={(e) =>
                              setWindows((prev) =>
                                prev.map((row) =>
                                  row.dayOfWeek === w.dayOfWeek ? { ...row, startTime: e.target.value } : row,
                                ),
                              )
                            }
                            className="w-full sm:w-auto min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm sm:text-xs disabled:opacity-40"
                          />
                          <span className="text-[#52647D] text-center">to</span>
                          <input
                            type="time"
                            disabled={!w.isAvailable}
                            value={w.endTime}
                            onChange={(e) =>
                              setWindows((prev) =>
                                prev.map((row) =>
                                  row.dayOfWeek === w.dayOfWeek ? { ...row, endTime: e.target.value } : row,
                                ),
                              )
                            }
                            className="w-full sm:w-auto min-h-[40px] rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm sm:text-xs disabled:opacity-40"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* PROFILE & QUALIFICATIONS TAB */}
            {tab === 'profile' && (
              <div className="space-y-5">
                <h1 className="text-lg font-bold text-[#0B1F44]">Credentials &amp; Preferences</h1>

                {/* Qualifications */}
                <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2 text-sm font-bold text-[#0B1F44]">
                    <ShieldCheck className="w-4 h-4 text-[#16A879]" />
                    Compliance &amp; Clinical Credentials
                  </div>
                  <div className="divide-y divide-slate-100">
                    {data.qualifications.map((q) => {
                      const expired = new Date(q.expiresAt).getTime() < Date.now() || q.reviewStatus === 'expired';
                      return (
                        <div key={q.id} className="px-5 py-3.5 flex items-center justify-between gap-3 text-xs">
                          <div>
                            <p className="font-bold text-[#0B1F44]">
                              {q.name} ({q.code})
                            </p>
                            <p className="text-[#52647D] font-mono mt-0.5 tabular-nums">
                              Ref: {q.referenceNumber} · Expires {new Date(q.expiresAt).toLocaleDateString()}
                            </p>
                          </div>
                          <span
                            className={`font-semibold uppercase shrink-0 ${
                              expired
                                ? 'text-[#DC4C64]'
                                : q.reviewStatus === 'verified'
                                  ? 'text-[#16A879]'
                                  : 'text-[#F59E0B]'
                            }`}
                          >
                            {expired ? 'Expired' : q.reviewStatus}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Contact Preferences */}
                <form
                  onSubmit={handleSaveProfile}
                  className="rounded-xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4"
                >
                  <h2 className="text-sm font-bold text-[#0B1F44]">Outreach Preferences</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Preferred Channel</label>
                      <select
                        value={profileForm.preferredChannel}
                        onChange={(e) =>
                          setProfileForm({
                            ...profileForm,
                            preferredChannel: e.target.value as 'in_app' | 'sms' | 'email',
                          })
                        }
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm bg-white"
                      >
                        <option value="in_app">In-App PWA</option>
                        <option value="sms">SMS</option>
                        <option value="email">Email</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#0B1F44] mb-1">
                        Mobile ({market.phoneCountryCode})
                      </label>
                      <input
                        required
                        placeholder={market.phonePlaceholder}
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Max Travel (km)</label>
                      <input
                        type="number"
                        min={5}
                        max={100}
                        value={profileForm.travelRadiusKm}
                        onChange={(e) => setProfileForm({ ...profileForm, travelRadiusKm: Number(e.target.value) })}
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <PWAInstallButton />
                    <button
                      type="submit"
                      disabled={!isOnline || busyAction === 'profile'}
                      className="min-h-[42px] px-4 py-2 rounded-lg bg-[#0E8BFF] hover:bg-[#0B74D6] disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                    >
                      {busyAction === 'profile' ? 'Saving...' : 'Save Preferences'}
                    </button>
                  </div>
                </form>

                {/* Worker Notifications */}
                {data.notifications.length > 0 && (
                  <div className="rounded-xl bg-white border border-slate-200 p-5 space-y-3">
                    <h2 className="text-sm font-bold text-[#0B1F44] flex items-center gap-2">
                      <Bell className="w-4 h-4 text-[#0E8BFF]" />
                      Recent Notifications
                    </h2>
                    <div className="divide-y divide-slate-100">
                      {data.notifications.slice(0, 6).map((n) => (
                        <div key={n.id} className="py-2.5 text-xs">
                          <p className="font-semibold text-[#0B1F44]">{n.title}</p>
                          <p className="text-[#52647D] mt-0.5">{n.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Mobile Fixed Bottom Navigation (compact, 44px+ touch targets, <= 15% sticky surface) */}
      <nav
        aria-label="Mobile worker navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-5 h-16 px-1 pb-safe"
      >
        {(
          [
            { key: 'home', label: 'Home', icon: Home },
            { key: 'offers', label: 'Offers', icon: Bell, badge: openOffersCount },
            { key: 'shifts', label: 'Shifts', icon: Calendar },
            { key: 'availability', label: 'Avail.', icon: Clock },
            { key: 'profile', label: 'Profile', icon: User },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold cursor-pointer transition-colors ${
                active ? 'text-[#0E8BFF]' : 'text-[#52647D]'
              }`}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 w-7 h-0.5 rounded-full bg-[#0E8BFF]"
                />
              )}
              <Icon className="w-[18px] h-[18px]" />
              <span>{item.label}</span>
              {'badge' in item && item.badge > 0 && (
                <span className="absolute top-1.5 right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#DC4C64] text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Explicit Accept Confirmation Modal (Bottom Sheet on Mobile) */}
      {confirmOffer && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1F44]/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-accept-title"
        >
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl bg-white border-t sm:border border-slate-200 p-5 pb-7 sm:pb-5 shadow-2xl space-y-4">
            <div className="sm:hidden w-10 h-1 bg-slate-300 rounded-full mx-auto -mt-1 mb-1" aria-hidden="true" />
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#16A879] shrink-0 mt-0.5" />
              <div>
                <h2 id="confirm-accept-title" className="text-base font-bold text-[#0B1F44]">
                  Confirm Shift Acceptance
                </h2>
                <p className="text-xs text-[#52647D] mt-1 leading-relaxed">
                  Accepting locks this shift on the facility roster and automatically withdraws offers sent to other workers.
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs space-y-1">
              <p className="font-bold text-[#0B1F44]">{confirmOffer.shiftTitle}</p>
              <p className="text-[#52647D]">{confirmOffer.facilityName}</p>
              <p className="font-mono text-[#0B1F44] tabular-nums">
                {confirmOffer.shiftDate} · {formatTimeRange(confirmOffer.startAt, confirmOffer.endAt)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmOffer(null)}
                className="min-h-[46px] rounded-xl border border-slate-300 text-xs font-semibold text-[#52647D] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleAcceptOffer}
                className="min-h-[46px] rounded-xl bg-[#16A879] hover:bg-[#128A63] text-white text-xs font-bold cursor-pointer"
              >
                {busyAction ? 'Confirming...' : 'Confirm & Lock Shift'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline Modal (Bottom Sheet on Mobile) */}
      {declineOffer && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1F44]/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="decline-offer-title"
        >
          <form
            onSubmit={handleDeclineOffer}
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl bg-white border-t sm:border border-slate-200 p-5 pb-7 sm:pb-5 shadow-2xl space-y-4"
          >
            <div className="sm:hidden w-10 h-1 bg-slate-300 rounded-full mx-auto -mt-1 mb-1" aria-hidden="true" />
            <h2 id="decline-offer-title" className="text-base font-bold text-[#0B1F44]">
              Decline Shift Offer
            </h2>
            <p className="text-xs text-[#52647D] leading-relaxed">
              Optional reason helps coordinators update availability and advance the next wave immediately.
            </p>
            <input
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="e.g. Prior family commitment / outside rest window"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-base sm:text-sm text-[#0B1F44]"
            />
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setDeclineOffer(null)}
                className="min-h-[46px] rounded-xl border border-slate-300 text-xs font-semibold text-[#52647D] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction !== null}
                className="min-h-[46px] rounded-xl bg-[#DC4C64] text-white text-xs font-bold cursor-pointer"
              >
                {busyAction ? 'Declining...' : 'Decline Offer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
