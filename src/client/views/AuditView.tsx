import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../api.ts';
import { useToast } from '../components/Toast.tsx';

interface AuditRow {
  id: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  ipAddress: string | null;
  createdAt: string;
}

export const AuditView: React.FC = () => {
  const { pushToast } = useToast();
  const [events, setEvents] = useState<AuditRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async (q = query) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ events: AuditRow[] }>(
        `/api/audit${q.trim() ? `?action=${encodeURIComponent(q.trim())}` : ''}`,
      );
      setEvents(res.events);
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to load audit log.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load('');
  }, []);

  const handleExportClientCsv = () => {
    const header = 'Timestamp,Actor Email,Role,Action,Entity,Summary';
    const lines = events.map((e) =>
      [
        e.createdAt,
        e.actorEmail,
        e.actorRole,
        e.action,
        `${e.entityType}:${e.entityId}`,
        `"${e.summary.replace(/"/g, '""')}"`,
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coverpulse-audit-trail.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    pushToast({ type: 'success', title: 'Audit trail CSV downloaded.' });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">
            Audit &amp; Compliance Trail
          </h1>
          <p className="text-xs text-[#52647D] mt-0.5">
            Append-only log of shift offers, overrides, credential reviews, policy updates, and exports
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load(query)}
            aria-label="Refresh audit log"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-[#52647D] hover:text-[#0B1F44] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={handleExportClientCsv}
            disabled={events.length === 0}
            className="flex-1 sm:flex-none min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(query);
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by action, actor email, or summary..."
            className="w-full min-h-[38px] rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-base sm:text-xs text-[#0B1F44]"
          />
        </div>
        <button
          type="submit"
          className="min-h-[38px] px-4 py-1.5 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
        >
          Filter
        </button>
      </form>

      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        {loading && events.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#52647D]">
            Loading immutable audit events...
          </div>
        ) : events.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#52647D]">
            <ShieldCheck className="w-5 h-5 text-slate-400 mx-auto mb-1" />
            No audit events match your filter.
          </div>
        ) : (
          <>
            {/* Mobile Audit Feed */}
            <div className="md:hidden divide-y divide-slate-100">
              {events.map((ev) => (
                <div key={ev.id} className="px-4 py-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#0E8BFF] truncate">{ev.action}</span>
                    <span className="font-mono text-[11px] text-[#52647D] whitespace-nowrap tabular-nums shrink-0">
                      {new Date(ev.createdAt).toLocaleString([], {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-[#0B1F44] leading-snug">{ev.summary}</p>
                  <p className="text-[11px] text-[#52647D] truncate">
                    <span className="font-semibold text-[#0B1F44]">{ev.actorEmail}</span> · {ev.actorRole}
                  </p>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-[#52647D]">
                    <th className="py-2.5 px-5">Timestamp</th>
                    <th className="py-2.5 px-4">Actor</th>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-5">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-5 font-mono text-[#52647D] whitespace-nowrap tabular-nums">
                        {new Date(ev.createdAt).toLocaleString([], {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="py-2.5 px-4">
                        <p className="font-semibold text-[#0B1F44]">{ev.actorEmail}</p>
                        <p className="text-[11px] text-[#52647D]">{ev.actorRole}</p>
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-[#0E8BFF] whitespace-nowrap">
                        {ev.action}
                      </td>
                      <td className="py-2.5 px-5 text-[#0B1F44] leading-snug">{ev.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
