import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useToast } from '../components/Toast.tsx';

interface NotificationRow {
  id: string;
  category: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export const NotificationsView: React.FC<{ onCountChange?: (unread: number) => void }> = ({
  onCountChange,
}) => {
  const { pushToast } = useToast();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread' | 'escalation' | 'coverage' | 'credential'>('all');
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ notifications: NotificationRow[] }>('/api/notifications');
      setItems(res.notifications);
      onCountChange?.(res.notifications.filter((n) => !n.readAt).length);
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to load notifications.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleMarkAllRead = async () => {
    setMarking(true);
    try {
      await apiFetch('/api/notifications/mark-read', { method: 'POST' });
      pushToast({ type: 'success', title: 'All notifications marked as read.' });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to mark read.' });
    } finally {
      setMarking(false);
    }
  };

  const filtered = items.filter((n) => {
    if (filter === 'unread') return !n.readAt;
    if (filter === 'all') return true;
    return n.category.toLowerCase().includes(filter);
  });

  const unreadCount = items.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">Notification Centre</h1>
          <p className="text-xs text-[#52647D] mt-0.5 tabular-nums">
            {unreadCount} unread operational alert{unreadCount === 1 ? '' : 's'} · Escalations, acceptances, and compliance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            aria-label="Refresh notifications"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-[#52647D] hover:text-[#0B1F44] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={marking || unreadCount === 0}
            className="flex-1 sm:flex-none min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            <CheckCheck className="w-4 h-4 text-[#0E8BFF]" />
            Mark All Read
          </button>
        </div>
      </div>

      {/* Single-Row Scrollable Segmented Category Filter */}
      <div className="flex items-center p-0.5 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full w-fit">
        {(
          [
            { key: 'all', label: 'All' },
            { key: 'unread', label: `Unread (${unreadCount})` },
            { key: 'escalation', label: 'Escalations' },
            { key: 'coverage', label: 'Coverage' },
            { key: 'credential', label: 'Credentials' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer shrink-0 ${
              filter === tab.key
                ? 'bg-white text-[#0B1F44] shadow-2xs'
                : 'text-[#52647D] hover:text-[#0B1F44]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="p-5 space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Bell className="w-6 h-6 text-slate-400 mx-auto" />
            <p className="mt-2 text-sm font-semibold text-[#0B1F44]">No notifications in this view</p>
            <p className="mt-1 text-xs text-[#52647D]">
              New shift escalations, offer acceptances, and expiring compliance alerts will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((n) => (
              <div
                key={n.id}
                className={`p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-2 ${
                  !n.readAt ? 'bg-[#0E8BFF]/[0.04]' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span
                      className={`font-bold uppercase ${
                        n.category.includes('escalation')
                          ? 'text-[#DC4C64]'
                          : n.category.includes('credential')
                            ? 'text-[#F59E0B]'
                            : 'text-[#0E8BFF]'
                      }`}
                    >
                      {n.category.replace(/_/g, ' ')}
                    </span>
                    {!n.readAt && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="font-semibold text-[#0E8BFF]">Unread</span>
                      </>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm font-bold text-[#0B1F44]">{n.title}</p>
                  <p className="mt-0.5 text-xs text-[#52647D] leading-snug">{n.body}</p>
                </div>
                <span className="text-[11px] font-mono text-[#52647D] whitespace-nowrap tabular-nums shrink-0">
                  {new Date(n.createdAt).toLocaleString([], {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
