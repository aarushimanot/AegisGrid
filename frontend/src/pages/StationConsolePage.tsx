// Station console: the live inbox of an approved emergency service station.
//   Incoming  → Accept (commits a unit) or Transfer to the next nearest station
//   Active    → navigate; on arrival enter the citizen's arrival code (this
//               records the response time); when done enter the completion code,
//               or report a false alarm if there was no emergency
// Requests not accepted within the window move on automatically.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, BadgeCheck, BellRing, Check, Clock, KeyRound, Loader2, MapPin, Minus, Navigation, Phone, Plus, Power, ShieldCheck, Timer } from 'lucide-react';
import { SERVICES } from '@core/catalog';
import { useApp } from '../context/AppContext';
import { useLive } from '../hooks/useLive';
import { stationApi } from '../services/api';
import type { ApiStation, Offer, OfferAction } from '../services/apiTypes';
import { SERVICE_NAME, TYPE_FROM_API, shortRef } from '../services/mappers';
import { secondsLeft } from '../utils/citizen';
import { formatDateTime } from '../utils/helpers';
import LiveMap, { KIND } from '../components/LiveMap';
import TypeIcon from '../components/TypeIcon';
import type { Incident } from '../types';

const TRANSFER_REASONS = ['All crews are on other calls', 'Vehicle / equipment unavailable', 'Outside our coverage area', 'Specialised unit required'];

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.25].forEach(t => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch {
    // audio not available
  }
}

export default function StationConsolePage() {
  const { addNotification } = useApp();
  const { data: station, reload: reloadStation } = useLive(() => stationApi.me(), [], 4000);
  const { data: offers = [], reload } = useLive(() => stationApi.offers(), [], 2000);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, []);

  const incoming = offers.filter(o => o.status === 'OFFERED' && secondsLeft(o.expiresAt) > 0);
  const active = offers.filter(o => o.status === 'ACCEPTED' || o.status === 'ARRIVED');

  // Alert on a new incoming request.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(incoming.map(o => o.offerId));
    if (seen.current) {
      const fresh = incoming.filter(o => !seen.current!.has(o.offerId));
      if (fresh.length) {
        beep();
        addNotification({ type: 'warning', message: `New emergency request: ${fresh[0]!.incident.summary.slice(0, 80)}` });
      }
    }
    seen.current = ids;
  }, [incoming, addNotification]);

  const act = async (offerId: string, action: OfferAction, payload: { reason?: string; code?: string }, ok: string) => {
    await stationApi.action(offerId, action, payload);
    addNotification({ type: 'success', message: ok });
    await Promise.all([reload(), reloadStation()]);
  };

  const mapIncidents = useMemo<Incident[]>(() => [...incoming, ...active].map(o => ({
    id: o.offerId, displayId: shortRef(o.incidentId), type: TYPE_FROM_API[o.incident.incidentType ?? 'OTHER'], description: o.incident.summary,
    location: { lat: o.incident.location.lat, lng: o.incident.location.lon, address: o.incident.address ?? 'Citizen live location' },
    priority: (o.incident.severity ?? 3) >= 4 ? 'Critical' : 'High', status: o.status === 'OFFERED' ? 'Pending' : 'Dispatched',
    createdAt: o.createdAt, updatedAt: o.updatedAt, reportedBy: o.incident.citizenName ?? 'Citizen', media: [], assignedAgents: [], timeline: [],
    dispatch: o.status === 'OFFERED' ? [] : [{ agent: '', summary: '', resourceIds: [o.stationId], at: o.updatedAt }],
  })), [incoming, active]);

  if (!station) return <div className="flex justify-center py-20"><Loader2 size={26} className="animate-spin text-red-400" /></div>;
  const { Icon, color } = KIND[station.serviceType];

  return (
    <div className="space-y-5 animate-fade-in max-w-6xl">
      <StationHeader station={station} onChange={reloadStation} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <section className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <BellRing size={15} className={incoming.length ? 'text-red-400 animate-pulse' : 'text-white/40'} />
              <h3 className="text-sm font-semibold text-white">Incoming requests</h3>
              {incoming.length > 0 && <span className="ml-auto text-[11px] text-red-300">{incoming.length} waiting</span>}
            </div>
            {incoming.length === 0 ? (
              <p className="text-xs text-white/35 py-4 text-center">{station.onDuty ? 'No new requests. New ones appear here instantly with an alert sound.' : 'You are off duty, so no requests are being routed to you.'}</p>
            ) : (
              <div className="space-y-3">{incoming.map(o => <IncomingCard key={o.offerId} offer={o} onAct={act} />)}</div>
            )}
          </section>

          <section className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3"><Icon size={15} style={{ color }} /><h3 className="text-sm font-semibold text-white">Active responses</h3></div>
            {active.length === 0 ? <p className="text-xs text-white/35 py-4 text-center">No active responses.</p> : (
              <div className="space-y-3">{active.map(o => <ActiveCard key={o.offerId} offer={o} onAct={act} />)}</div>
            )}
          </section>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2"><MapPin size={13} className="text-red-400" /><span className="text-xs font-semibold text-white">Your station and current requests</span></div>
            <LiveMap
              incidents={mapIncidents}
              units={[{ id: station.stationId, name: station.name, kind: station.serviceType, status: station.onDuty ? (station.unitsAvailable ? 'available' : 'busy') : 'offline', lat: station.location.lat, lng: station.location.lon, detail: station.address }]}
              height={320}
              minimal
            />
          </div>
          <div className="glass-card p-4 grid grid-cols-2 gap-3 text-center">
            {[
              ['Requests received', station.stats.offered],
              ['Accepted', station.stats.accepted],
              ['Transferred', station.stats.transferred],
              ['Completed', station.stats.completed],
            ].map(([l, v]) => (
              <div key={l as string} className="p-2.5 rounded-lg bg-black-300 border border-white/5">
                <div className="text-xl font-bold text-white">{v}</div>
                <div className="text-[10px] text-white/40 uppercase tracking-wider">{l}</div>
              </div>
            ))}
            <div className="col-span-2 p-2.5 rounded-lg bg-black-300 border border-white/5">
              <div className="text-xl font-bold text-green-400">{station.avgResponseMinutes ?? '—'}{station.avgResponseMinutes ? ' min' : ''}</div>
              <div className="text-[10px] text-white/40 uppercase tracking-wider">Average response time</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StationHeader({ station, onChange }: { station: ApiStation; onChange: () => Promise<void> }) {
  const { addNotification } = useApp();
  const [busy, setBusy] = useState(false);
  const { Icon, color } = KIND[station.serviceType];
  const update = async (ops: { onDuty?: boolean; unitsAvailable?: number }) => {
    setBusy(true);
    try {
      await stationApi.updateOperations(ops);
      await onChange();
    } catch (e) {
      addNotification({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="glass-card p-5 flex flex-wrap items-center gap-5">
      <div className="flex items-center gap-3 flex-1 min-w-[240px]">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${color}1f` }}><Icon size={22} style={{ color }} /></div>
        <div>
          <h2 className="text-lg font-bold text-white leading-tight">{station.name}</h2>
          <p className="text-xs text-white/45 flex items-center gap-1.5 mt-0.5"><ShieldCheck size={12} className="text-green-400" /> Verified {SERVICES[station.serviceType].name} · {station.registrationNumber}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-[10px] text-white/40 uppercase tracking-wider">{SERVICES[station.serviceType].unitLabel} free</div>
          <div className="flex items-center gap-2 mt-0.5">
            <button disabled={busy || station.unitsAvailable <= 0} onClick={() => update({ unitsAvailable: station.unitsAvailable - 1 })} className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center text-white/60 hover:text-white disabled:opacity-30"><Minus size={13} /></button>
            <span className="text-xl font-bold text-white w-14 text-center">{station.unitsAvailable}<span className="text-sm text-white/35">/{station.unitsTotal}</span></span>
            <button disabled={busy || station.unitsAvailable >= station.unitsTotal} onClick={() => update({ unitsAvailable: station.unitsAvailable + 1 })} className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center text-white/60 hover:text-white disabled:opacity-30"><Plus size={13} /></button>
          </div>
        </div>
        <button onClick={() => update({ onDuty: !station.onDuty })} disabled={busy}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${station.onDuty ? 'bg-green-500/15 border-green-500/40 text-green-300' : 'bg-white/5 border-white/15 text-white/50'}`}>
          <Power size={15} /> {station.onDuty ? 'On duty' : 'Off duty'}
        </button>
      </div>
    </div>
  );
}

const LEVEL = {
  HIGH: { text: 'High credibility', cls: 'border-green-500/30 bg-green-500/10 text-green-300' },
  MEDIUM: { text: 'Medium credibility', cls: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200' },
  LOW: { text: 'Low credibility', cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
} as const;

/** How believable the report is, and why. Informational only: always respond. */
function CredibilityNote({ offer: o }: { offer: Offer }) {
  const c = o.incident.credibility;
  const standing = o.incident.citizenStanding;
  if (!c && (!standing || standing === 'GOOD')) return null;
  return (
    <div className={`mt-2 p-2 rounded-lg border text-[11px] ${c ? LEVEL[c.level].cls : LEVEL.MEDIUM.cls}`}>
      <div className="flex items-center gap-1.5 font-medium">
        {c?.level === 'HIGH' ? <BadgeCheck size={12} /> : <AlertTriangle size={12} />}
        {c ? `${LEVEL[c.level].text} · ${c.score}/100` : 'Reporter history'}
        {standing && standing !== 'GOOD' && <span className="ml-auto font-normal opacity-80">Reporter: {standing === 'WARNING' ? 'earlier false alarms' : 'repeated false alarms'}</span>}
      </div>
      {c && c.flags.length > 0 && <ul className="mt-1 space-y-0.5 opacity-85 list-disc pl-4">{c.flags.map(f => <li key={f}>{f}</li>)}</ul>}
      {c && c.level !== 'HIGH' && <p className="mt-1 opacity-60">Respond as normal; report a false alarm only if the team finds no emergency on scene.</p>}
    </div>
  );
}

type Act = (offerId: string, action: OfferAction, payload: { reason?: string; code?: string }, ok: string) => Promise<void>;

function IncomingCard({ offer: o, onAct }: { offer: Offer; onAct: Act }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [transfer, setTransfer] = useState(false);
  const [reason, setReason] = useState(TRANSFER_REASONS[0]!);
  const left = secondsLeft(o.expiresAt);
  const type = TYPE_FROM_API[o.incident.incidentType ?? 'OTHER'];
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  return (
    <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <TypeIcon type={type} size={16} />
          <span className="text-sm font-semibold text-white">{type} · severity {o.incident.severity ?? '?'}/5</span>
          <span className="font-mono text-[11px] text-white/40">{shortRef(o.incidentId)}</span>
        </div>
        <span className={`flex items-center gap-1 text-xs font-mono ${left < 20 ? 'text-red-400' : 'text-yellow-300'}`}><Timer size={12} /> {left}s</span>
      </div>
      <p className="text-sm text-white/75 mt-2 leading-relaxed">{o.incident.summary}</p>
      {o.incident.hazards.length > 0 && <p className="text-[11px] text-red-300 mt-1 flex items-center gap-1"><AlertTriangle size={11} /> {o.incident.hazards.join(', ')}</p>}
      <CredibilityNote offer={o} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-white/50">
        <span className="flex items-center gap-1"><MapPin size={11} /> {o.incident.address ?? 'Citizen live location'} · {o.distanceKm} km</span>
        <span className="flex items-center gap-1"><Clock size={11} /> ETA ~{o.etaMinutes} min</span>
        {o.incident.otherServices.length > 0 && <span>Also responding: {o.incident.otherServices.map(t => SERVICE_NAME[t]).join(', ')}</span>}
      </div>
      {transfer ? (
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <select className="select-field text-xs py-1.5 flex-1 min-w-[200px]" value={reason} onChange={e => setReason(e.target.value)}>
            {TRANSFER_REASONS.map(r => <option key={r}>{r}</option>)}
          </select>
          <button className="btn-secondary text-xs" disabled={!!busy} onClick={() => run('transfer', () => onAct(o.offerId, 'transfer', { reason }, 'Transferred to the next nearest station.'))}>
            {busy === 'transfer' ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightLeft size={12} />} Confirm transfer
          </button>
          <button className="text-xs text-white/40 hover:text-white" onClick={() => setTransfer(false)}>Cancel</button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button className="btn-primary text-sm flex-1 justify-center" disabled={!!busy} onClick={() => run('accept', () => onAct(o.offerId, 'accept', {}, 'Accepted. A unit is committed; head to the location.'))}>
            {busy === 'accept' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Accept
          </button>
          <button className="btn-secondary text-sm" disabled={!!busy} onClick={() => setTransfer(true)}><ArrowRightLeft size={14} /> Transfer</button>
        </div>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}

function ActiveCard({ offer: o, onAct }: { offer: Offer; onAct: Act }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [transfer, setTransfer] = useState(false);
  const [falseAlarm, setFalseAlarm] = useState(false);
  const [faReason, setFaReason] = useState('');
  const arrived = o.status === 'ARRIVED';
  const reportFalseAlarm = async () => {
    setBusy(true); setError('');
    try {
      await onAct(o.offerId, 'false-alarm', { reason: faReason.trim() }, 'Closed as a false alarm. The unit is free again.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const type = TYPE_FROM_API[o.incident.incidentType ?? 'OTHER'];
  const loc = o.incident.location;
  const submit = async () => {
    setBusy(true); setError('');
    try {
      await onAct(o.offerId, arrived ? 'complete' : 'arrive', { code }, arrived ? 'Service completed and verified.' : 'Arrival verified. Response time recorded.');
      setCode('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="p-4 rounded-xl border border-white/10 bg-black-300">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><TypeIcon type={type} size={15} /><span className="text-sm font-semibold text-white">{type}</span><span className="font-mono text-[11px] text-white/40">{shortRef(o.incidentId)}</span></div>
        <span className={`text-[11px] font-medium ${arrived ? 'text-green-400' : 'text-blue-400'}`}>{arrived ? `On scene · response ${o.responseMinutes} min` : `En route · accepted ${o.acceptedAt ? formatDateTime(o.acceptedAt) : ''}`}</span>
      </div>
      <p className="text-xs text-white/65 mt-1.5">{o.incident.summary}</p>
      <CredibilityNote offer={o} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-white/55">
        <span>{o.incident.citizenName ?? 'Citizen'}</span>
        {o.incident.citizenPhone && <a href={`tel:${o.incident.citizenPhone}`} className="flex items-center gap-1 text-blue-300 hover:underline"><Phone size={11} /> {o.incident.citizenPhone}</a>}
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lon}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-300 hover:underline">
          <Navigation size={11} /> Navigate{o.incident.locationSource === 'gps' ? ' (live location)' : ''}
        </a>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-white/50"><KeyRound size={12} /> {arrived ? "Citizen's completion code" : "Citizen's arrival code"}</div>
        <input className="input-field font-mono tracking-[0.35em] w-36 py-2" inputMode="numeric" maxLength={6} placeholder="••••••" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
        <button className="btn-primary text-sm" disabled={code.length !== 6 || busy} onClick={submit}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} {arrived ? 'Complete' : 'Confirm arrival'}
        </button>
        {!arrived && !transfer && <button className="text-[11px] text-white/40 hover:text-white ml-auto" onClick={() => setTransfer(true)}>Can't attend? Transfer</button>}
        {!arrived && transfer && (
          <button className="btn-secondary text-xs ml-auto" onClick={() => onAct(o.offerId, 'transfer', { reason: 'Unit unable to attend after accepting' }, 'Transferred to the next nearest station.').catch(e => setError((e as Error).message))}>
            <ArrowRightLeft size={12} /> Confirm transfer
          </button>
        )}
      </div>
      <p className="text-[10px] text-white/30 mt-1.5">Ask the citizen for the code shown in their AegisGrid app. It proves you reached the right person and records the {arrived ? 'completion' : 'response time'}.</p>
      {falseAlarm ? (
        <div className="mt-3 p-3 rounded-lg border border-red-500/30 bg-red-500/5 space-y-2">
          <p className="text-[11px] text-red-200">Report only if your team found no emergency at the location. This closes your part of the request and records a strike against the reporter (the admin can reverse it).</p>
          <input className="input-field text-xs py-2" placeholder="What did the team find? e.g. No accident at the location, area checked" value={faReason} onChange={e => setFaReason(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-secondary text-xs hover:text-red-300" disabled={busy || faReason.trim().length < 5} onClick={reportFalseAlarm}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />} Confirm false alarm
            </button>
            <button className="text-xs text-white/40 hover:text-white" onClick={() => setFalseAlarm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="mt-2 text-[11px] text-white/35 hover:text-red-300" onClick={() => setFalseAlarm(true)}>No emergency found? Report false alarm</button>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}
