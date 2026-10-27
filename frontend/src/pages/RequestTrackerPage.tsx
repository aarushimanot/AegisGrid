// Citizen: live view of one request. For every service the AI decided to send:
// which station has it, whether it accepted, transfers to the next nearest
// station, ETA, and the one-time codes the citizen gives the responder on
// arrival and on completion. Response time = request sent → verified arrival.

import { useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRightLeft, CheckCircle2, Clock, KeyRound, Link2, Loader2, LocateFixed, MapPin, Phone, ShieldCheck, Timer } from 'lucide-react';
import { citizenApi } from '../services/api';
import type { ApiServiceView } from '../services/apiTypes';
import { shortRef } from '../services/mappers';
import { SERVICE_STATUS, STATUS_BADGE, STATUS_TEXT, firstEta, formatMinutes, requestType, secondsLeft } from '../utils/citizen';
import { formatDateTime } from '../utils/helpers';
import { useLive } from '../hooks/useLive';
import TypeIcon from '../components/TypeIcon';
import LiveMap, { KIND } from '../components/LiveMap';
import type { MapUnit } from '../services/fleet';
import type { Incident } from '../types';

function CodeBox({ label, code, hint }: { label: string; code: string; hint: string }) {
  return (
    <div className="mt-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
      <div className="flex items-center gap-1.5 text-[11px] text-green-300 uppercase tracking-wider"><KeyRound size={12} /> {label}</div>
      <div className="font-mono text-3xl font-bold text-white tracking-[0.3em] mt-1">{code}</div>
      <p className="text-[11px] text-white/55 mt-1">{hint}</p>
    </div>
  );
}

function ServiceCard({ s }: { s: ApiServiceView }) {
  const { Icon, color } = KIND[s.service];
  const st = SERVICE_STATUS[s.status];
  return (
    <div className="p-4 rounded-xl bg-black-300 border border-white/5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f` }}><Icon size={17} style={{ color }} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-white">{s.serviceName}</span>
            <span className={`text-[11px] font-medium ${st.cls}`}>{st.text}</span>
          </div>
          {s.stationName && <p className="text-xs text-white/70 mt-0.5">{s.stationName}</p>}
          {s.status === 'OFFERED' && (
            <p className="text-[11px] text-white/45 mt-1 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Nearest available station ({s.distanceKm} km) is reviewing your request · {secondsLeft(s.expiresAt)}s
            </p>
          )}
          {s.status === 'ACCEPTED' && (
            <p className="text-[11px] text-white/55 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1"><Timer size={11} /> ETA ~{s.etaMinutes} min ({s.distanceKm} km)</span>
              {s.stationPhone && <a href={`tel:${s.stationPhone}`} className="flex items-center gap-1 text-blue-300 hover:underline"><Phone size={11} /> {s.stationPhone}</a>}
            </p>
          )}
          {s.arrivedAt && <p className="text-[11px] text-green-400/90 mt-1 flex items-center gap-1"><ShieldCheck size={11} /> Arrival verified {formatDateTime(s.arrivedAt)} · response {formatMinutes(s.responseMinutes)}</p>}
          {s.transfers > 0 && <p className="text-[11px] text-yellow-400/80 mt-1 flex items-center gap-1"><ArrowRightLeft size={11} /> Passed on {s.transfers} time{s.transfers > 1 ? 's' : ''} to reach an available station</p>}
          {s.status === 'UNAVAILABLE' && <p className="text-[11px] text-red-300/90 mt-1">{s.note}</p>}
          {s.arrivalCode && <CodeBox label="Arrival code" code={s.arrivalCode} hint={`Give this code to the ${s.serviceName.toLowerCase()} responder when they reach you. It confirms the right team reached the right person.`} />}
          {s.completionCode && <CodeBox label="Completion code" code={s.completionCode} hint="Give this new code to the responder only when the service is finished." />}
        </div>
      </div>
    </div>
  );
}

export default function RequestTrackerPage() {
  const { id = '' } = useParams();
  const justRequested = !!(useLocation().state as { justRequested?: boolean } | null)?.justRequested;
  const { data: req, loading } = useLive(() => citizenApi.requestStatus(id), [id], 2000);

  const mapIncident = useMemo<Incident | null>(() => req ? {
    id: req.incidentId, displayId: shortRef(req.incidentId), type: requestType(req) ?? 'Other', description: req.description,
    location: { lat: req.location.lat, lng: req.location.lon, address: req.address ?? 'Your live location' },
    priority: (req.severity ?? 3) >= 4 ? 'Critical' : (req.severity ?? 3) === 3 ? 'High' : 'Medium',
    status: req.status === 'RESOLVED' ? 'Resolved' : 'Active', createdAt: req.createdAt, updatedAt: req.updatedAt,
    reportedBy: 'You', media: [], assignedAgents: [], timeline: [],
    dispatch: req.services.filter(s => ['ACCEPTED', 'ARRIVED'].includes(s.status)).map(s => ({ agent: s.serviceName, summary: s.status, resourceIds: [`st-${s.service}`], at: s.acceptedAt ?? '' })),
  } : null, [req]);
  const stationsOnMap = useMemo<MapUnit[]>(() => (req?.services ?? [])
    .filter(s => s.stationLocation && ['ACCEPTED', 'ARRIVED'].includes(s.status))
    .map(s => ({ id: `st-${s.service}`, name: s.stationName ?? s.serviceName, kind: s.service, status: 'busy', lat: s.stationLocation!.lat, lng: s.stationLocation!.lon, detail: `ETA ~${s.etaMinutes} min` })), [req]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 size={28} className="animate-spin text-red-400" /></div>;
  if (!req) {
    return (
      <div className="max-w-xl mx-auto glass-card p-8 text-center">
        <p className="text-white/60 mb-4">Request not found.</p>
        <Link to="/requests" className="btn-secondary text-sm inline-flex"><ArrowLeft size={14} /> My requests</Link>
      </div>
    );
  }

  const type = requestType(req);
  const eta = firstEta(req);
  const steps = [
    { label: 'Request received', done: true },
    { label: 'AI identified the emergency', done: !!req.incidentType },
    { label: 'Station accepted', done: req.services.some(s => s.acceptedAt) },
    { label: 'Responder arrived', done: !!req.firstArrivalAt },
    { label: 'Resolved', done: req.status === 'RESOLVED' },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-4 animate-fade-in">
      <Link to="/requests" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70"><ArrowLeft size={13} /> My requests</Link>

      {justRequested && req.status !== 'RESOLVED' && (
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 flex items-start gap-3">
          <CheckCircle2 size={18} className="text-green-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-white/80">Your request has been received. Stay where you are if it is safe. This page updates automatically.</div>
        </div>
      )}

      {req.duplicateOf && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-start gap-3">
          <Link2 size={18} className="text-blue-300 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-white/80">
            Someone nearby already reported this emergency (request #{shortRef(req.duplicateOf)}), so your report was linked to it instead of sending more units.
            The responders below are already handling it. Thank you for reporting.
          </div>
        </div>
      )}
      {req.outcome === 'FALSE_ALARM' && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-white/80">
            The responders found no emergency at this location and closed the request as a false alarm. This has been recorded on your account.
            If you believe this is a mistake, contact the AegisGrid administrator.
          </div>
        </div>
      )}

      <div className="glass-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-lg font-bold text-white">{shortRef(req.incidentId)}</span>
              <span className={`status-badge ${STATUS_BADGE[req.status]}`}>{STATUS_TEXT[req.status]}</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-sm text-white/70">
              {type ? <><TypeIcon type={type} size={15} /> {type} emergency</> : <><Loader2 size={14} className="animate-spin" /> Identifying the emergency…</>}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-white/35"><Clock size={11} /> Requested {formatDateTime(req.createdAt)}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="px-4 py-2.5 rounded-lg bg-black-300 border border-white/5">
              <div className="text-[10px] text-white/40 uppercase tracking-wider">Response time</div>
              <div className="text-lg font-bold text-white">{formatMinutes(req.responseMinutes)}</div>
            </div>
            <div className="px-4 py-2.5 rounded-lg bg-black-300 border border-white/5">
              <div className="text-[10px] text-white/40 uppercase tracking-wider">{req.status === 'RESOLVED' ? 'Resolved in' : 'Next arrival'}</div>
              <div className="text-lg font-bold text-green-400">{req.status === 'RESOLVED' ? formatMinutes(req.resolutionMinutes) : eta ? `~${eta} min` : '—'}</div>
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-5 gap-2">
          {steps.map(s => (
            <div key={s.label}>
              <div className={`h-1.5 rounded-full ${s.done ? 'bg-green-500' : 'bg-white/10'}`} />
              <div className={`text-[11px] mt-1.5 ${s.done ? 'text-white/80' : 'text-white/30'}`}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Services responding</h3>
            {req.services.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-white/40"><Loader2 size={13} className="animate-spin" /> Our AI is working out which services you need…</div>
            ) : (
              <div className="space-y-3">{req.services.map(s => <ServiceCard key={s.service} s={s} />)}</div>
            )}
          </div>
          {req.summary && (
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-white mb-2">What our AI understood</h3>
              <p className="text-xs text-white/60 leading-relaxed">{req.summary}</p>
            </div>
          )}
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-white mb-2">Your request</h3>
            <p className="text-sm text-white/70 leading-relaxed">{req.description || 'Media-only request'}</p>
            {req.mediaCount > 0 && <p className="text-xs text-white/40 mt-2">{req.mediaCount} attachment{req.mediaCount > 1 ? 's' : ''} sent</p>}
          </div>
        </div>

        <div className="lg:col-span-2 glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-white"><MapPin size={14} className="text-red-400" /> Location</span>
            {req.locationSource === 'gps' && req.status !== 'RESOLVED' && <span className="flex items-center gap-1.5 text-[11px] text-green-400"><LocateFixed size={12} /> Live</span>}
          </div>
          {mapIncident && <LiveMap incidents={[mapIncident]} units={stationsOnMap} height={300} focusIncidentId={mapIncident.id} minimal />}
          <p className="text-xs text-white/50 mt-2">{req.address ?? 'Your live location'}</p>
          {req.locationUpdatedAt && <p className="text-[11px] text-white/30 mt-0.5 flex items-center gap-1"><Timer size={11} /> Updated {formatDateTime(req.locationUpdatedAt)}</p>}
        </div>
      </div>
    </div>
  );
}
