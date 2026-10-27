// Admin: one request in full — AI analysis, every service's station and status,
// transfers, the audit timeline, and controls to reassign or close it. Also the
// misuse checks: credibility score with reasons, photo origin, duplicate link.

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, MapPin, Clock, FlaskConical, AlertOctagon, Activity, Cpu, FileText, CheckCircle, Loader2, TriangleAlert, ArrowRightLeft, Phone, KeyRound, ShieldCheck, Link2,
} from 'lucide-react';
import { SERVICES } from '@core/catalog';
import { rankStations } from '@core/core';
import { useApp } from '../context/AppContext';
import { useLive } from '../hooks/useLive';
import { adminApi } from '../services/api';
import type { ApiStation, ServiceAssignment, ServiceType, Station } from '../services/apiTypes';
import { assignmentSummary, toUiIncident } from '../services/mappers';
import { stationUnits } from '../services/fleet';
import { getStatusBadge, getPriorityColor, formatDateTime } from '../utils/helpers';
import LiveMap from '../components/LiveMap';

const A_BADGE: Record<ServiceAssignment['status'], string> = {
  SEARCHING: 'badge-pending', OFFERED: 'badge-pending', ACCEPTED: 'badge-dispatched', ARRIVED: 'badge-active',
  COMPLETED: 'badge-resolved', UNAVAILABLE: 'badge-critical', CANCELLED: 'badge-pending', FALSE_ALARM: 'badge-critical',
};

export default function IncidentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { addNotification, refreshIncidents } = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [assignTo, setAssignTo] = useState<Partial<Record<ServiceType, string>>>({});

  const { data, loading, reload } = useLive(() => adminApi.incident(id), [id]);
  const { data: stations = [] } = useLive(() => adminApi.stations(), [], 10_000);
  const incident = useMemo(() => (data ? toUiIncident(data.incident, data.timeline) : null), [data]);
  const raw = data?.incident;
  const isResolved = raw?.status === 'RESOLVED';

  const act = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      addNotification({ type: 'success', message: ok });
      await Promise.all([reload(), refreshIncidents()]);
    } catch (e) {
      addNotification({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!incident || !raw) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <AlertOctagon size={48} className="text-white/10 mb-4" />
        <h3 className="text-lg font-semibold text-white/40 mb-2">Request not found</h3>
        <button onClick={() => navigate('/admin/requests')} className="btn-secondary text-sm"><ArrowLeft size={15} /> Back to requests</button>
      </div>
    );
  }

  const ai = incident.aiAnalysis;
  const services = Object.values(raw.assignments ?? {}).filter(Boolean) as ServiceAssignment[];
  const candidates = (type: ServiceType) =>
    rankStations(stations as unknown as Station[], type, raw.location).map(r => r.station as unknown as ApiStation);

  return (
    <div className="space-y-5 animate-fade-in max-w-6xl">
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/admin/requests')} className="p-2 rounded-lg bg-black-200 border border-white/10 hover:border-white/20 text-white/50 hover:text-white transition-all mt-1">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-xl font-bold text-white">{incident.displayId}</span>
            <span className={`status-badge ${getStatusBadge(incident.status)}`}>{incident.status}</span>
            <span className={`text-sm font-semibold px-2 py-0.5 rounded ${getPriorityColor(incident.priority)}`}>{incident.priority}</span>
            {typeof raw.responseMinutes === 'number' && <span className="text-xs text-green-400 font-mono">Response {raw.responseMinutes} min</span>}
          </div>
          <h2 className="text-xl font-bold text-white mt-1">{incident.type} Emergency</h2>
          <div className="flex items-center gap-4 mt-2 text-xs text-white/40 flex-wrap">
            <div className="flex items-center gap-1.5"><Clock size={11} />{formatDateTime(incident.createdAt)}</div>
            <div className="flex items-center gap-1.5"><MapPin size={11} />{incident.location.address}</div>
            <div className="flex items-center gap-1.5"><Phone size={11} />{raw.reporter?.name ?? 'Citizen'}{raw.reporter?.phone ? ` · ${raw.reporter.phone}` : ''}</div>
          </div>
          {!isResolved && (
            <button
              onClick={() => window.confirm('Close this request? Open offers are cancelled and units released.') && act('resolve', () => adminApi.resolve(id, 'Closed by admin'), 'Request closed.')}
              disabled={!!busy} className="btn-secondary text-xs mt-3"
            >
              {busy === 'resolve' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} className="text-green-400" />} Close request
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3"><FileText size={15} className="text-white/40" /><h3 className="text-sm font-semibold text-white">Citizen's report</h3></div>
            <p className="text-sm text-white/70 leading-relaxed">{incident.description}</p>
            {(raw.analysis?.images?.length || raw.analysis?.transcripts?.length || raw.media?.length) ? (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {raw.media?.length ? <span className="px-2 py-1 rounded bg-white/5 border border-white/10 text-white/50">{raw.media.length} attachment(s)</span> : null}
                {raw.analysis?.images?.flatMap(i => i.labels).slice(0, 6).map(l => (
                  <span key={l.name} className="px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">Vision: {l.name}</span>
                ))}
                {raw.analysis?.transcripts?.map(t => <span key={t.key} className="px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300">Voice: "{t.text.slice(0, 80)}"</span>)}
              </div>
            ) : null}
          </div>

          {/* Misuse checks */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3"><ShieldCheck size={15} className="text-green-400" /><h3 className="text-sm font-semibold text-white">Credibility checks</h3>
              {raw.credibility && (
                <span className={`ml-auto text-xs font-semibold ${raw.credibility.level === 'HIGH' ? 'text-green-400' : raw.credibility.level === 'MEDIUM' ? 'text-yellow-300' : 'text-red-400'}`}>
                  {raw.credibility.score}/100 · {raw.credibility.level.toLowerCase()}
                </span>
              )}
            </div>
            {raw.duplicateOf && (
              <p className="text-xs text-blue-300 mb-2 flex items-center gap-1.5"><Link2 size={12} /> Duplicate of <Link className="underline" to={`/admin/requests/${raw.duplicateOf}`}>#{raw.duplicateOf.slice(0, 8).toUpperCase()}</Link>. No extra units were sent.</p>
            )}
            {raw.outcome === 'FALSE_ALARM' && <p className="text-xs text-red-300 mb-2">Closed as a false alarm by the responders. A strike was recorded against the reporter (reverse it on the Users page).</p>}
            {!raw.credibility ? <p className="text-xs text-white/40">Calculated after the AI analysis.</p> : raw.credibility.flags.length === 0 ? (
              <p className="text-xs text-white/50">No warning signs: evidence, location and the reporter's history are consistent.</p>
            ) : (
              <ul className="text-xs text-white/65 space-y-1 list-disc pl-4">{raw.credibility.flags.map(f => <li key={f}>{f}</li>)}</ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/45">
              <span className="px-2 py-1 rounded bg-white/5 border border-white/10">Declaration {raw.declarationAccepted ? 'accepted' : 'not recorded'}</span>
              <span className="px-2 py-1 rounded bg-white/5 border border-white/10">Reporter standing: {(raw.reporterStanding ?? 'GOOD').toLowerCase()}</span>
              {raw.media?.map((m, i) => (
                <span key={m.key} className="px-2 py-1 rounded bg-white/5 border border-white/10">
                  File {i + 1}: {m.meta?.source ?? 'unknown source'}{m.meta?.capturedAt ? `, taken ${formatDateTime(m.meta.capturedAt)}` : ''}{m.meta?.location ? ', has GPS' : ''}
                </span>
              ))}
            </div>
          </div>

          {/* Services and stations */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4"><Cpu size={15} className="text-blue-400" /><h3 className="text-sm font-semibold text-white">Services dispatched</h3></div>
            {services.length === 0 && <p className="text-xs text-white/40 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> AI is analysing the report…</p>}
            <div className="space-y-4">
              {services.map(a => {
                const options = candidates(a.serviceType).filter(s => s.stationId !== a.stationId);
                const open = !isResolved && ['OFFERED', 'ACCEPTED', 'UNAVAILABLE'].includes(a.status);
                return (
                  <div key={a.serviceType} className="p-3.5 rounded-lg bg-black-300 border border-white/5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{SERVICES[a.serviceType].name}</span>
                        <span className={`status-badge text-[10px] ${A_BADGE[a.status]}`}>{a.status}</span>
                      </div>
                      {a.responseMinutes !== undefined && <span className="text-xs font-mono text-green-400">response {a.responseMinutes} min</span>}
                    </div>
                    <p className="text-xs text-white/60 mt-1.5">{assignmentSummary(a)}</p>
                    {(a.arrivalOtp || a.completionOtp) && (
                      <p className="text-[11px] text-white/40 mt-1 flex items-center gap-1.5"><KeyRound size={11} /> Citizen's {a.arrivalOtp ? 'arrival' : 'completion'} code: <span className="font-mono text-white/70">{a.arrivalOtp ?? a.completionOtp}</span></p>
                    )}
                    {a.tried.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {a.tried.map((t, i) => (
                          <li key={i} className="text-[11px] text-yellow-400/80 flex items-center gap-1.5">
                            <ArrowRightLeft size={11} /> {t.stationName}: {t.outcome.toLowerCase()}{t.reason ? ` (${t.reason})` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    {open && options.length > 0 && (
                      <div className="flex items-center gap-2 mt-3">
                        <select className="select-field text-xs py-1.5 flex-1" value={assignTo[a.serviceType] ?? ''} onChange={e => setAssignTo(m => ({ ...m, [a.serviceType]: e.target.value }))}>
                          <option value="">Reassign to another station…</option>
                          {options.map(s => <option key={s.stationId} value={s.stationId}>{s.name} ({s.unitsAvailable} free)</option>)}
                        </select>
                        <button
                          disabled={!assignTo[a.serviceType] || !!busy}
                          onClick={() => act(`assign-${a.serviceType}`, () => adminApi.assign(id, a.serviceType, assignTo[a.serviceType]!), 'Request reassigned.')}
                          className="btn-secondary text-xs py-1.5"
                        >
                          {busy === `assign-${a.serviceType}` ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightLeft size={12} />} Assign
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {ai && (
            <div className="glass-card p-5 border border-purple-500/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><FlaskConical size={15} className="text-purple-400" /><h3 className="text-sm font-semibold text-white">AI Analysis</h3></div>
                <span className={`text-[10px] font-mono ${ai.isSimulated ? 'text-yellow-400' : 'text-purple-400'}`}>{ai.isSimulated ? 'RULE-BASED TRIAGE' : 'BEDROCK + RULES'}</span>
              </div>
              <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/10 mb-4"><p className="text-xs text-white/60 leading-relaxed">{ai.summary}</p></div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                {[{ label: 'Severity Score', v: ai.severity, c: ai.severity > 75 ? '#E50914' : ai.severity > 50 ? '#ffa500' : '#4caf50' }, { label: 'Confidence', v: ai.confidence, c: '#60a5fa' }].map(x => (
                  <div key={x.label}>
                    <p className="text-xs text-white/40 mb-2">{x.label}</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-white/10 rounded-full"><div className="h-full rounded-full" style={{ width: `${x.v}%`, background: x.c }} /></div>
                      <span className="text-sm font-bold text-white">{x.v}%</span>
                    </div>
                  </div>
                ))}
              </div>
              {ai.detectedHazards.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {ai.detectedHazards.map(h => <span key={h} className="px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/25 text-xs text-red-300"><TriangleAlert size={11} className="inline -mt-0.5 mr-1" />{h}</span>)}
                </div>
              )}
              <p className="text-xs text-white/40 mb-1.5">Services required</p>
              <div className="flex flex-wrap gap-2">{ai.resourcesNeeded.map(r => <span key={r} className="px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">{r}</span>)}</div>
            </div>
          )}

          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4"><Activity size={15} className="text-white/40" /><h3 className="text-sm font-semibold text-white">Audit timeline</h3></div>
            <div className="space-y-4">
              {incident.timeline.map((event, i) => (
                <div key={event.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5 ${event.type === 'success' ? 'bg-green-400' : event.type === 'warning' ? 'bg-yellow-400' : event.type === 'error' ? 'bg-red-400' : 'bg-blue-400'}`} />
                    {i < incident.timeline.length - 1 && <div className="w-px flex-1 bg-white/10 mt-1 mb-1 min-h-[20px]" />}
                  </div>
                  <div className="flex-1 pb-2">
                    <p className="text-sm text-white/80">{event.event}</p>
                    <div className="flex items-center gap-3 mt-1"><span className="text-xs text-white/40">{event.agent}</span><span className="text-xs text-white/30">{formatDateTime(event.timestamp)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass-card p-3">
            <div className="flex items-center gap-2 mb-2"><MapPin size={13} className="text-red-400" /><span className="text-xs font-semibold text-white">Location and responding stations</span></div>
            <LiveMap incidents={[incident]} units={stationUnits(stations)} height={300} focusIncidentId={incident.id} minimal />
            <p className="text-[10px] text-white/30 mt-2">{incident.location.address}{raw.locationSource === 'gps' ? ' · live GPS' : ''}</p>
          </div>
          <div className="glass-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white mb-3">Request details</h3>
            {[
              { label: 'Reference', value: incident.displayId ?? incident.id },
              { label: 'Type', value: incident.type },
              { label: 'Priority', value: incident.priority },
              { label: 'Status', value: incident.status },
              { label: 'Citizen', value: raw.reporter?.name ?? '—' },
              { label: 'Contact', value: raw.reporter?.phone ?? raw.reporter?.email ?? '—' },
              { label: 'Location source', value: raw.locationSource === 'gps' ? 'Live GPS' : 'Entered manually' },
              { label: 'Requested', value: formatDateTime(incident.createdAt) },
              { label: 'First arrival', value: raw.firstArrivalAt ? formatDateTime(raw.firstArrivalAt) : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-2 text-xs border-b border-white/5 pb-2 last:border-0 last:pb-0">
                <span className="text-white/40">{label}</span><span className="text-white/80 text-right font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
