import React, { useEffect, useState } from 'react';
import { Code, Download, KeyRound, Plus, RefreshCw, Send, ShieldCheck, Webhook, X } from 'lucide-react';
import { apiFetch, downloadAuthenticatedCsv } from '../api.ts';
import { useAuth } from '../AuthContext.tsx';
import { useToast } from '../components/Toast.tsx';

interface IntegrationRow {
  id: string;
  providerName: string;
  category: string;
  status: string;
  description: string;
  lastSyncAt: string | null;
}

interface WebhookEndpointRow {
  id: string;
  url: string;
  description: string;
  eventsJson: string[];
  signingSecretPreview: string;
  active: boolean;
  createdAt: string;
}

interface WebhookDeliveryRow {
  id: string;
  endpointId: string;
  eventType: string;
  idempotencyKey: string;
  signatureHeader: string;
  status: string;
  httpStatus: number | null;
  attempts: number;
  createdAt: string;
}

interface IntegrationsResponse {
  integrations: IntegrationRow[];
  webhookEndpoints: WebhookEndpointRow[];
  webhookDeliveries: WebhookDeliveryRow[];
  samplePayloads: Record<string, unknown>;
}

const EVENT_OPTIONS = ['shift.covered', 'shift.escalated', 'offer.accepted', 'qualification.expired'];

export const IntegrationsView: React.FC = () => {
  const { session } = useAuth();
  const { pushToast } = useToast();
  const canManage = Boolean(session?.permissions.includes('integrations:manage'));
  const canExport = Boolean(session?.permissions.includes('analytics:export'));

  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);

  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [selectedSample, setSelectedSample] = useState<string>('shift.covered');

  const [form, setForm] = useState({
    url: '',
    description: '',
    events: ['shift.covered', 'shift.escalated'],
  });

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<IntegrationsResponse>('/api/integrations');
      setData(res);
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to load integrations.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleExportTimesheet = async () => {
    setExportingCsv(true);
    try {
      await downloadAuthenticatedCsv(
        '/api/integrations/export-timesheet-csv',
        'coverpulse-payroll-timesheet.csv',
      );
      pushToast({ type: 'success', title: 'Payroll timesheet CSV exported.' });
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Timesheet export failed.' });
    } finally {
      setExportingCsv(false);
    }
  };

  const toggleEvent = (ev: string) => {
    setForm((prev) => {
      const has = prev.events.includes(ev);
      if (has && prev.events.length === 1) return prev;
      return { ...prev, events: has ? prev.events.filter((e) => e !== ev) : [...prev.events, ev] };
    });
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingWebhook(true);
    try {
      const res = await apiFetch<{ signingSecretOnce: string }>('/api/webhooks', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setCreatedSecret(res.signingSecretOnce);
      pushToast({ type: 'success', title: 'Signed webhook endpoint registered.' });
      setForm({ url: '', description: '', events: ['shift.covered', 'shift.escalated'] });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Unable to register webhook.' });
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleTestWebhook = async (endpointId: string) => {
    setTestingId(endpointId);
    try {
      const res = await apiFetch<{ note: string }>(`/api/webhooks/${endpointId}/test`, {
        method: 'POST',
      });
      pushToast({ type: 'success', title: res.note });
      await load();
    } catch (err) {
      pushToast({ type: 'error', title: err instanceof Error ? err.message : 'Webhook test failed.' });
    } finally {
      setTestingId(null);
    }
  };

  const statusTone = (status: string) => {
    if (status === 'connected' || status === 'active' || status === 'delivered') return 'text-[#16A879]';
    if (status === 'sandbox_disconnected' || status === 'sandbox') return 'text-[#F59E0B]';
    return 'text-[#52647D]';
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#0B1F44] tracking-tight">
            Integrations &amp; Signed Webhooks
          </h1>
          <p className="text-xs text-[#52647D] mt-0.5">
            Honest adapter status, payroll CSV exports, and HMAC-SHA256 signed event webhooks
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={load}
            aria-label="Refresh integrations"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 bg-white text-[#52647D] hover:text-[#0B1F44] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {canExport && (
            <button
              type="button"
              onClick={handleExportTimesheet}
              disabled={exportingCsv}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              {exportingCsv ? 'Exporting...' : 'Payroll CSV'}
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setCreatedSecret(null);
                setShowWebhookModal(true);
              }}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#0B1F44] hover:bg-[#132f63] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#06B6D4]" />
              Register Webhook
            </button>
          )}
        </div>
      </div>

      {/* Adapters Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
        {(data?.integrations ?? []).map((ad) => (
          <div key={ad.id} className="rounded-xl bg-white border border-slate-200 p-4 flex flex-col justify-between gap-2.5">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#52647D]">{ad.category}</p>
                  <h2 className="mt-0.5 text-sm font-bold text-[#0B1F44]">{ad.providerName}</h2>
                </div>
                <span className={`text-xs font-semibold shrink-0 ${statusTone(ad.status)}`}>
                  {ad.status.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-[#52647D] leading-relaxed">{ad.description}</p>
            </div>
            <p className="pt-2.5 border-t border-slate-100 text-[11px] text-[#52647D] font-mono">
              {ad.lastSyncAt
                ? `Synced ${new Date(ad.lastSyncAt).toLocaleString()}`
                : 'Server credentials not configured (sandbox)'}
            </p>
          </div>
        ))}
      </div>

      {/* Signed Webhook Endpoints */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-sm font-bold text-[#0B1F44] flex items-center gap-2">
            <Webhook className="w-4 h-4 text-[#0E8BFF]" />
            Signed Outbound Webhook Endpoints
          </h2>
          <p className="text-xs text-[#52647D] mt-0.5">
            HTTPS-only · Private/loopback IP ranges blocked (SSRF guard) · HMAC-SHA256 timestamped signatures
          </p>
        </div>

        {(data?.webhookEndpoints ?? []).length === 0 ? (
          <div className="p-8 text-center text-xs text-[#52647D]">
            No outbound webhook endpoints registered yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data!.webhookEndpoints.map((ep) => (
              <div key={ep.id} className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-[#0B1F44]">{ep.description}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="text-xs font-semibold text-[#16A879]">{ep.active ? 'Active' : 'Paused'}</span>
                  </div>
                  <p className="mt-1 text-xs font-mono text-[#0E8BFF] truncate">{ep.url}</p>
                  <p className="mt-0.5 text-xs text-[#52647D] font-mono break-all">
                    Secret: {ep.signingSecretPreview} · Events: {ep.eventsJson.join(', ')}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleTestWebhook(ep.id)}
                    disabled={testingId === ep.id}
                    className="w-full md:w-auto min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 whitespace-nowrap cursor-pointer shrink-0"
                  >
                    <Send className="w-3.5 h-3.5 text-[#0E8BFF]" />
                    {testingId === ep.id ? 'Dispatching...' : 'Send Signed Sandbox Test'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delivery Logs (Mobile Cards + Desktop Table) & Sample Payload */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        <div className="lg:col-span-7 rounded-xl bg-white border border-slate-200 overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-bold text-[#0B1F44]">Recent Webhook Deliveries</h2>
          </div>

          {(data?.webhookDeliveries ?? []).length === 0 ? (
            <p className="p-8 text-center text-xs text-[#52647D]">
              No webhook deliveries recorded yet. Send a sandbox test above.
            </p>
          ) : (
            <>
              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {data!.webhookDeliveries.map((del) => (
                  <div key={del.id} className="px-4 py-3 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-[#0B1F44]">{del.eventType}</span>
                      <span className="font-semibold text-[#16A879] tabular-nums">
                        {del.status} ({del.httpStatus ?? 200})
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#52647D]">
                      <span className="truncate">{del.idempotencyKey}</span>
                      <span className="shrink-0 tabular-nums">
                        {new Date(del.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-[#52647D]">
                      <th className="py-2.5 px-4">Event</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Idempotency Key</th>
                      <th className="py-2.5 px-4 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data!.webhookDeliveries.map((del) => (
                      <tr key={del.id}>
                        <td className="py-2.5 px-4 font-mono font-semibold text-[#0B1F44]">{del.eventType}</td>
                        <td className="py-2.5 px-4 font-semibold text-[#16A879] tabular-nums">
                          {del.status} ({del.httpStatus ?? 200})
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#52647D] truncate max-w-[180px]">
                          {del.idempotencyKey}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-[#52647D] tabular-nums">
                          {new Date(del.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="lg:col-span-5 rounded-xl bg-white border border-slate-200 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-[#0B1F44] flex items-center gap-1.5">
              <Code className="w-4 h-4 text-[#0E8BFF]" />
              Sample Payloads
            </h2>
            <select
              value={selectedSample}
              onChange={(e) => setSelectedSample(e.target.value)}
              aria-label="Select sample event"
              className="min-h-[34px] rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-mono text-[#0B1F44] bg-white"
            >
              {Object.keys(data?.samplePayloads ?? { 'shift.covered': {} }).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <pre className="mt-3 p-3.5 rounded-lg bg-[#0B1F44] text-slate-100 text-[11px] font-mono overflow-x-auto leading-relaxed">
            {JSON.stringify(data?.samplePayloads?.[selectedSample] ?? {}, null, 2)}
          </pre>
        </div>
      </div>

      {/* Register Webhook Modal */}
      {showWebhookModal && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1F44]/55 flex items-end sm:items-center justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="webhook-modal-title"
        >
          <div className="w-full max-w-lg rounded-t-2xl sm:rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h2 id="webhook-modal-title" className="text-base font-bold text-[#0B1F44]">
                Register Signed Webhook Endpoint
              </h2>
              <button
                type="button"
                onClick={() => setShowWebhookModal(false)}
                aria-label="Close modal"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#52647D] hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createdSecret ? (
              <div className="p-5 space-y-4 pb-safe">
                <div className="rounded-lg bg-[#16A879]/10 border border-[#16A879]/30 p-4">
                  <p className="text-xs font-bold text-[#0B1F44] flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-[#16A879]" />
                    Copy Your One-Time HMAC Signing Secret
                  </p>
                  <p className="mt-1 text-xs text-[#52647D]">
                    Only a SHA-256 hash is stored server-side. This plaintext secret will not be shown again.
                  </p>
                  <code className="mt-2.5 block p-2.5 rounded bg-white border border-slate-200 text-xs font-mono text-[#0B1F44] break-all">
                    {createdSecret}
                  </code>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowWebhookModal(false)}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-[#0B1F44] text-white text-xs font-semibold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateWebhook} className="p-5 space-y-3.5 overflow-y-auto pb-safe">
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">HTTPS Endpoint URL</label>
                  <input
                    type="url"
                    required
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="https://payroll.yourcareorg.com/webhooks/coverpulse"
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm font-mono text-[#0B1F44]"
                  />
                  <p className="mt-1 text-[11px] text-[#52647D] flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#16A879] shrink-0" />
                    Requires public HTTPS host; localhost and private RFC1918 networks are rejected.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0B1F44] mb-1">Description</label>
                  <input
                    required
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="e.g. HRIS / Payroll Sync"
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-[#0B1F44]"
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#0B1F44] mb-1.5">Subscribed Events</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {EVENT_OPTIONS.map((ev) => (
                      <label key={ev} className="inline-flex items-center gap-2 text-xs font-mono text-[#0B1F44] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.events.includes(ev)}
                          onChange={() => toggleEvent(ev)}
                          className="rounded border-slate-300 text-[#0E8BFF]"
                        />
                        {ev}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowWebhookModal(false)}
                    className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-[#52647D] hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingWebhook}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-[#0B1F44] hover:bg-[#132f63] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                  >
                    {savingWebhook ? 'Registering...' : 'Create Endpoint'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
