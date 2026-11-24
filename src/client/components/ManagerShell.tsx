import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ChevronDown,
  CreditCard,
  FileCheck2,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  Radio,
  Search,
  Settings,
  Sliders,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useMarket } from '../MarketContext.tsx';
import { MARKET_LIST, type MarketCode } from '../../shared/markets.ts';
import { PWAInstallButton } from './PWAControls.tsx';
import { ROLE_LABELS } from '../../shared/types.ts';
import { OverviewView } from '../views/OverviewView.tsx';
import { ShiftsView } from '../views/ShiftsView.tsx';
import { ShiftDetailView } from '../views/ShiftDetailView.tsx';
import { WorkforceView } from '../views/WorkforceView.tsx';
import { FacilitiesView } from '../views/FacilitiesView.tsx';
import { PoliciesView } from '../views/PoliciesView.tsx';
import { AnalyticsView } from '../views/AnalyticsView.tsx';
import { IntegrationsView } from '../views/IntegrationsView.tsx';
import { NotificationsView } from '../views/NotificationsView.tsx';
import { SettingsView } from '../views/SettingsView.tsx';
import { BillingView } from '../views/BillingView.tsx';
import { AuditView } from '../views/AuditView.tsx';

interface FacilityLite {
  id: string;
  name: string;
  code: string;
}

interface NavItem {
  key: string;
  label: string;
  shortLabel: string;
  group: 'Operations' | 'Automation & Insights' | 'Administration';
  permission?: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'overview', label: 'Overview', shortLabel: 'Overview', group: 'Operations', permission: 'dashboard:view', icon: LayoutDashboard },
  { key: 'queue', label: 'Coverage Queue', shortLabel: 'Queue', group: 'Operations', permission: 'shifts:view', icon: Radio },
  { key: 'shifts', label: 'Shifts', shortLabel: 'Shifts', group: 'Operations', permission: 'shifts:view', icon: CalendarClock },
  { key: 'workforce', label: 'Workforce', shortLabel: 'Staff', group: 'Operations', permission: 'workers:view', icon: Users },
  { key: 'facilities', label: 'Facilities', shortLabel: 'Sites', group: 'Operations', permission: 'facilities:view', icon: Building2 },
  { key: 'policies', label: 'Coverage Policies', shortLabel: 'Policies', group: 'Automation & Insights', permission: 'policies:view', icon: Sliders },
  { key: 'analytics', label: 'Analytics', shortLabel: 'Analytics', group: 'Automation & Insights', permission: 'analytics:view', icon: BarChart3 },
  { key: 'integrations', label: 'Integrations', shortLabel: 'Webhooks', group: 'Automation & Insights', permission: 'integrations:view', icon: Plug },
  { key: 'notifications', label: 'Notifications', shortLabel: 'Alerts', group: 'Administration', icon: Bell },
  { key: 'settings', label: 'Settings', shortLabel: 'Settings', group: 'Administration', permission: 'settings:view', icon: Settings },
  { key: 'billing', label: 'Billing', shortLabel: 'Billing', group: 'Administration', permission: 'billing:view', icon: CreditCard },
  { key: 'audit', label: 'Audit & Compliance', shortLabel: 'Audit', group: 'Administration', permission: 'audit:view', icon: FileCheck2 },
];

const NAV_GROUPS: Array<NavItem['group']> = ['Operations', 'Automation & Insights', 'Administration'];

interface ManagerShellProps {
  onGoPublic: () => void;
}

export const ManagerShell: React.FC<ManagerShellProps> = ({ onGoPublic }) => {
  const { session, personas, signInDemoPersona, signOut } = useAuth();
  const { market, marketCode, setMarketCode } = useMarket();
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string>('all');
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [facilities, setFacilities] = useState<FacilityLite[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false);
  const [switchingPersona, setSwitchingPersona] = useState<string | null>(null);

  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.permission || session?.permissions.includes(item.permission),
  );

  // Up to 4 primary quick-tabs for the mobile bottom bar
  const mobileQuickTabs = ['overview', 'queue', 'shifts', 'workforce']
    .map((key) => visibleNav.find((item) => item.key === key))
    .filter((item): item is NavItem => Boolean(item));

  useEffect(() => {
    let active = true;
    const loadMeta = async () => {
      try {
        const [facRes, notifRes] = await Promise.all([
          apiFetch<{ facilities: FacilityLite[] }>('/api/facilities').catch(() => ({ facilities: [] })),
          apiFetch<{ notifications: Array<{ readAt: string | null }> }>('/api/notifications').catch(() => ({
            notifications: [],
          })),
        ]);
        if (!active) return;
        setFacilities(facRes.facilities);
        setUnreadCount(notifRes.notifications.filter((n) => !n.readAt).length);
      } catch {
        // non-blocking
      }
    };
    loadMeta();
    return () => {
      active = false;
    };
  }, [session?.userId]);

  const navigate = (tab: string) => {
    setSelectedShiftId(null);
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  const handleOpenShift = (shiftId: string) => {
    setSelectedShiftId(shiftId);
  };

  const handleSwitchPersona = async (uid: string) => {
    setSwitchingPersona(uid);
    setPersonaMenuOpen(false);
    await signInDemoPersona(uid);
    setSelectedShiftId(null);
    setSelectedFacilityId('all');
    setActiveTab('overview');
    setSwitchingPersona(null);
  };

  const activeNavMeta = NAV_ITEMS.find((n) => n.key === activeTab);

  const renderSidebarNav = () => (
    <div className="flex flex-col h-full bg-[#0B1F44] text-slate-200 select-none">
      {/* Brand Header */}
      <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('overview')}
          className="focus:outline-none cursor-pointer"
          aria-label="CoverPulse Overview"
        >
          <img
            src="/assets/aistudio/coverpulse-logo-dark_2b9d897e.svg"
            alt="CoverPulse"
            className="h-6 w-auto"
          />
        </button>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tenant Context */}
      <div className="px-4 py-2.5 border-b border-white/10">
        <p className="text-[11px] font-semibold text-[#06B6D4] truncate">{session?.tenantName}</p>
        <p className="text-[11px] text-slate-400 mt-0.5 truncate">
          {session ? ROLE_LABELS[session.roleKey] : ''} · {market.code} ({market.currencyCode})
        </p>
      </div>

      {/* Grouped Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-4" aria-label="Primary workspace navigation">
        {NAV_GROUPS.map((group) => {
          const items = visibleNav.filter((i) => i.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {group}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const isActive = !selectedShiftId && activeTab === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => navigate(item.key)}
                      className={`w-full min-h-[36px] flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-[#0E8BFF] text-white'
                          : 'text-slate-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.key === 'notifications' && unreadCount > 0 && (
                        <span className="font-mono text-[11px] font-bold text-[#06B6D4] tabular-nums">
                          {unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom Footer */}
      <div className="p-2.5 border-t border-white/10 space-y-1">
        <div className="px-2.5 py-1 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-[#06B6D4]" />
            Market
          </span>
          <select
            aria-label="Workspace market profile"
            value={marketCode}
            onChange={(e) => setMarketCode(e.target.value as MarketCode)}
            className="rounded bg-white/10 text-white text-[11px] font-semibold px-1.5 py-0.5 border border-white/15 focus:outline-none cursor-pointer"
          >
            {MARKET_LIST.map((m) => (
              <option key={m.code} value={m.code} className="text-[#0B1F44]">
                {m.code} ({m.currencyCode})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={onGoPublic}
          className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
        >
          Public Website
        </button>
        <button
          type="button"
          onClick={signOut}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Compact Desktop Sidebar */}
      <aside className="hidden lg:block w-56 shrink-0 sticky top-0 h-screen no-print">
        {renderSidebarNav()}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full shadow-2xl">{renderSidebarNav()}</div>
          <button
            type="button"
            aria-label="Close backdrop"
            onClick={() => setMobileNavOpen(false)}
            className="flex-1 bg-[#0B1F44]/50"
          />
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Compact h-14 Top Command Bar */}
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-3 sm:px-5 flex items-center justify-between gap-2 no-print">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-[#0B1F44] hover:bg-slate-50 cursor-pointer shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>

            <span className="hidden xl:inline text-xs font-bold text-[#0B1F44] whitespace-nowrap shrink-0">
              {selectedShiftId ? 'Shift Detail' : activeNavMeta?.label ?? 'Overview'}
            </span>

            {/* Facility Scope Selector */}
            {facilities.length > 0 && (
              <select
                aria-label="Filter by facility"
                value={selectedFacilityId}
                onChange={(e) => setSelectedFacilityId(e.target.value)}
                className="min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-[#0B1F44] flex-1 sm:flex-none min-w-0 max-w-[175px] sm:max-w-[225px] truncate"
              >
                <option value="all">All Sites ({facilities.length})</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} — {f.name}
                  </option>
                ))}
              </select>
            )}

            {/* Global Search */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (globalSearch.trim() && !['queue', 'shifts', 'workforce'].includes(activeTab)) {
                  navigate('shifts');
                }
              }}
              className="relative hidden md:block flex-1 max-w-xs"
            >
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search shifts, roles, workers..."
                aria-label="Global workspace search"
                className="w-full min-h-[36px] rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1 text-xs text-[#0B1F44] focus:bg-white focus:border-[#0E8BFF] focus:outline-none"
              />
            </form>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton compact />
            </div>

            <button
              type="button"
              onClick={() => navigate('notifications')}
              aria-label="Open notifications"
              className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-[#52647D] hover:text-[#0B1F44] hover:bg-slate-50 cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1 min-w-[16px] h-4 rounded-full bg-[#DC4C64] text-white font-mono text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Persona / Account Switcher */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPersonaMenuOpen((o) => !o)}
                aria-label="Switch account or sign out"
                className="min-h-[40px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0B1F44] cursor-pointer"
              >
                <UserCog className="w-4 h-4 text-[#0E8BFF]" />
                <span className="hidden sm:inline max-w-[125px] truncate">{session?.fullName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#52647D]" />
              </button>

              {personaMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setPersonaMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl bg-white border border-slate-200 shadow-xl z-50 py-2">
                    <div className="px-4 py-2 border-b border-slate-100">
                      <p className="text-xs font-bold text-[#0B1F44]">{session?.fullName}</p>
                      <p className="text-[11px] font-mono text-[#52647D] truncate">{session?.email}</p>
                    </div>
                    {personas.length > 0 && (
                      <div className="py-1.5 max-h-72 overflow-y-auto">
                        <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-[#52647D]">
                          Switch Synthetic Demo Persona
                        </p>
                        {personas.map((p) => (
                          <button
                            key={p.uid}
                            type="button"
                            disabled={switchingPersona !== null}
                            onClick={() => handleSwitchPersona(p.uid)}
                            className={`w-full text-left px-4 py-2 text-xs hover:bg-slate-50 cursor-pointer flex items-center justify-between gap-2 ${
                              p.uid === session?.uid ? 'bg-[#0E8BFF]/5 font-semibold' : ''
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-[#0B1F44] truncate">{p.fullName}</p>
                              <p className="text-[11px] text-[#52647D] truncate">
                                {ROLE_LABELS[p.roleKey as keyof typeof ROLE_LABELS] ?? p.roleKey} ·{' '}
                                {p.tenantName.split(' (')[0]}
                              </p>
                            </div>
                            {p.uid === session?.uid && (
                              <span className="text-[10px] font-bold text-[#0E8BFF] shrink-0">Active</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="border-t border-slate-100 pt-1.5 px-2">
                      <button
                        type="button"
                        onClick={signOut}
                        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#DC4C64] hover:bg-[#DC4C64]/5 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Active Module Workspace */}
        <main className="flex-1 p-3.5 sm:p-5 lg:p-6 pb-20 lg:pb-6 max-w-7xl w-full mx-auto">
          {selectedShiftId ? (
            <ShiftDetailView shiftId={selectedShiftId} onBack={() => setSelectedShiftId(null)} />
          ) : activeTab === 'overview' ? (
            <OverviewView
              selectedFacilityId={selectedFacilityId}
              onNavigate={navigate}
              onOpenShift={handleOpenShift}
            />
          ) : activeTab === 'queue' ? (
            <ShiftsView
              mode="queue"
              selectedFacilityId={selectedFacilityId}
              globalSearch={globalSearch}
              onOpenShift={handleOpenShift}
            />
          ) : activeTab === 'shifts' ? (
            <ShiftsView
              mode="all"
              selectedFacilityId={selectedFacilityId}
              globalSearch={globalSearch}
              onOpenShift={handleOpenShift}
            />
          ) : activeTab === 'workforce' ? (
            <WorkforceView selectedFacilityId={selectedFacilityId} globalSearch={globalSearch} />
          ) : activeTab === 'facilities' ? (
            <FacilitiesView
              onSelectFacilityFilter={(facId) => {
                setSelectedFacilityId(facId);
                navigate('queue');
              }}
            />
          ) : activeTab === 'policies' ? (
            <PoliciesView />
          ) : activeTab === 'analytics' ? (
            <AnalyticsView selectedFacilityId={selectedFacilityId} />
          ) : activeTab === 'integrations' ? (
            <IntegrationsView />
          ) : activeTab === 'notifications' ? (
            <NotificationsView onCountChange={setUnreadCount} />
          ) : activeTab === 'settings' ? (
            <SettingsView />
          ) : activeTab === 'billing' ? (
            <BillingView />
          ) : activeTab === 'audit' ? (
            <AuditView />
          ) : (
            <OverviewView
              selectedFacilityId={selectedFacilityId}
              onNavigate={navigate}
              onOpenShift={handleOpenShift}
            />
          )}
        </main>

        {/* Compact Mobile Bottom Quick-Nav (lg:hidden) */}
        <nav
          aria-label="Quick workspace navigation"
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-200 pb-safe no-print"
        >
          <div className="grid grid-cols-5 h-14">
            {mobileQuickTabs.map((item) => {
              const Icon = item.icon;
              const isActive = !selectedShiftId && activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(item.key)}
                  className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold cursor-pointer transition-colors ${
                    isActive ? 'text-[#0E8BFF]' : 'text-[#52647D]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="truncate max-w-[64px]">{item.shortLabel}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold cursor-pointer transition-colors ${
                !mobileQuickTabs.some((t) => t.key === activeTab) && !selectedShiftId
                  ? 'text-[#0E8BFF]'
                  : 'text-[#52647D]'
              }`}
            >
              <Menu className="w-4 h-4" />
              <span>More</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
};
