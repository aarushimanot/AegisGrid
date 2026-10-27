// Admin: verify and control every service station. Pending registrations are
// reviewed here (details, map, documents, verification checks) and approved or
// rejected; approved stations can be suspended and reinstated.

import { useMemo, useState } from 'react';
import { BadgeCheck, Check, CircleAlert, ExternalLink, FileText, Loader2, MapPin, Phone, Search, ShieldOff, UserRound, X } from 'lucide-react';
import { SERVICES, SERVICE_LIST, isValidRegistration } from '@core/catalog';
import { useApp } from '../context/AppContext';
import { useLive } from '../hooks/useLive';
import { adminApi } from '../services/api';
import type { ApiStation, ServiceType, StationStatus } from '../services/apiTypes';
import { formatDateTime } from '../utils/helpers';
import { KIND } from '../components/LiveMap';
import PinMap from '../components/PinMap';

const TABS: { key: StationStatus | 'ALL'; label: string }[] = [
  { key: 'PENDING_REVIEW', label: 'Awaiting verification' },
  { key: 'APPROVED', label: 'Live' },
  { key: 'SUSPENDED', label: 'Suspended' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'DRAFT', label: 'Incomplete' },
  { key: 'ALL', label: 'All' },
];
const BADGE: Record<StationStatus, string> = { PENDING_REVIEW: 'badge-pending', APPROVED: 'badge-resolved', SUSPENDED: 'badge-critical', REJECTED: 'badge-critical', DRAFT: 'badge-pending' };

export default function AdminServicesPage() {
  const { data: stations, reload } = useLive(() => adminApi.stations(), [], 4000);
  const [tab, setTab] = useState<StationStatus | 'ALL'>('PENDING_REVIEW');
  const [type, setType] = useState<ServiceType | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, (stations ?? []).filter(s => t.key === 'ALL' || s.status === t.key).length])), [stations]);
  const list = (stations ?? []).filter(s => (tab === 'ALL' || s.status === tab) && (type === 'ALL' || s.serviceType === type) &&
    (!q || `${s.name} ${s.address} ${s.registrationNumber}`.toLowerCase().includes(q.toLowerCase())));
  const open = stations?.find(s => s.stationId === openId);

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Service stations</h2>
        <p className="text-sm text-white/40 mt-1">Verify registrations and control which stations receive emergency requests.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 rounded-md text-xs border ${tab === t.key ? 'border-red-500/40 bg-red-500/10 text-white' : 'border-white/10 text-white/50 hover:text-white/80'}`}>
            {t.label} <span className={`ml-1 ${t.key === 'PENDING_REVIEW' && counts[t.key] ? 'text-yellow-300' : 'text-white/35'}`}>{counts[t.key] ?? 0}</span>
          </button>
        ))}
        <select className="select-field text-xs py-1.5 w-48 ml-auto" value={type} onChange={e => setType(e.target.value as ServiceType | 'ALL')}>
          <option value="ALL">All services</option>
          {SERVICE_LIST.map(s => <option key={s.type} value={s.type}>{s.name}</option>)}
        </select>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input className="input-field text-xs py-1.5 pl-8 w-52" placeholder="Search name, address, reg. no." value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      {!stations ? <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-red-400" /></div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map(s => {
            const { Icon, color } = KIND[s.serviceType];
            return (
              <button key={s.stationId} onClick={() => setOpenId(s.stationId)} className="glass-card p-4 text-left hover:border-white/20 transition-all">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}1a` }}><Icon size={17} style={{ color }} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-white truncate">{s.name}</span>
                      <span className={`status-badge text-[9px] ${BADGE[s.status]}`}>{s.status.replace('_', ' ')}</span>
                    </div>
                    <div className="text-[11px] text-white/45 truncate">{SERVICES[s.serviceType].name} · {s.registrationNumber}</div>
                    <div className="text-[11px] text-white/35 truncate mt-0.5">{s.address}</div>
                    {s.status === 'APPROVED' && <div className="text-[11px] mt-1.5 text-white/55">{s.onDuty ? <span className="text-green-400">On duty</span> : 'Off duty'} · {s.unitsAvailable}/{s.unitsTotal} free · {s.stats.completed} completed</div>}
                    {s.status === 'PENDING_REVIEW' && s.verification.submittedAt && <div className="text-[11px] mt-1.5 text-yellow-300/80">Submitted {formatDateTime(s.verification.submittedAt)}</div>}
                  </div>
                </div>
              </button>
            );
          })}
          {list.length === 0 && <p className="text-sm text-white/35 col-span-full py-10 text-center">No stations here.</p>}
        </div>
      )}

      {open && <ReviewDrawer station={open} onClose={() => setOpenId(null)} onDone={reload} />}
    </div>
  );
}

function ReviewDrawer({ station: s, onClose, onDone }: { station: ApiStation; onClose: () => void; onDone: () => Promise<void> }) {
  const { addNotification, isLive } = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const { data: detail } = useLive(() => adminApi.station(s.stationId), [s.stationId], 30_000);
  const { Icon, color } = KIND[s.serviceType];
  const v = s.verification;
  const checks: [string, boolean][] = [
    [`Registration number matches the ${SERVICES[s.serviceType].registration.label} format`, isValidRegistration(s.serviceType, s.registrationNumber)],
    ['Station phone verified with a one-time code', v.phoneVerified],
    ['Registration certificate uploaded', v.documents.some(d => d.kind === 'REGISTRATION_CERTIFICATE')],
    ['Authority letter uploaded', v.documents.some(d => d.kind === 'AUTHORITY_LETTER')],
    ['Officer-in-charge ID uploaded', v.documents.some(d => d.kind === 'OFFICER_ID')],
    ['Legal declaration accepted', v.declarationAccepted],
  ];

  const review = async (action: 'approve' | 'reject' | 'suspend' | 'reinstate') => {
    if ((action === 'reject' || action === 'suspend') && !note.trim()) {
      addNotification({ type: 'warning', message: 'Add a note explaining the decision.' });
      return;
    }
    setBusy(action);
    try {
      await adminApi.review(s.stationId, action, note.trim() || undefined);
      addNotification({ type: 'success', message: `${s.name}: ${action === 'approve' ? 'approved and live' : action === 'reinstate' ? 'reinstated' : action === 'reject' ? 'rejected' : 'suspended'}.` });
      await onDone();
      onClose();
    } catch (e) {
      addNotification({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="w-full max-w-xl h-full overflow-y-auto bg-[#0f0f0f] border-l border-white/10 p-6 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${color}1f` }}><Icon size={20} style={{ color }} /></div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white">{s.name}</h3>
            <p className="text-xs text-white/45">{SERVICES[s.serviceType].name} · account {s.ownerEmail}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 text-sm">
          {[
            [BadgeCheck, `${s.registrationNumber}`, s.issuingAuthority],
            [UserRound, s.contactPerson.name, s.contactPerson.designation],
            [Phone, s.phone, s.officialEmail],
            [MapPin, s.address, `${s.location.lat.toFixed(5)}, ${s.location.lon.toFixed(5)} · ${s.unitsTotal} ${SERVICES[s.serviceType].unitLabel} · ${s.coverageKm} km radius`],
          ].map(([I, a, b], i) => {
            const C = I as typeof BadgeCheck;
            return <div key={i} className="flex gap-3"><C size={15} className="text-white/35 mt-0.5" /><div><div className="text-white/85">{a as string}</div><div className="text-[11px] text-white/40">{b as string}</div></div></div>;
          })}
        </div>

        <PinMap value={s.location} onChange={() => undefined} height={200} />

        <div>
          <h4 className="text-xs font-semibold text-white/70 uppercase tracking-wider mb-2">Verification checks</h4>
          <ul className="space-y-1.5">
            {checks.map(([label, ok]) => <li key={label} className={`flex items-center gap-2 text-xs ${ok ? 'text-green-400' : 'text-red-300'}`}>{ok ? <Check size={13} /> : <X size={13} />} {label}</li>)}
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-white/70 uppercase tracking-wider mb-2">Documents</h4>
          <div className="space-y-1.5">
            {(detail?.documents ?? v.documents).map(d => {
              const url = (d as { url?: string }).url;
              return (
                <div key={d.key} className="flex items-center gap-2 p-2.5 rounded-lg bg-black-300 border border-white/5 text-xs">
                  <FileText size={14} className="text-white/40" />
                  <span className="flex-1 text-white/80">{d.name}</span>
                  <span className="text-[10px] text-white/35">{d.kind.replace('_', ' ').toLowerCase()}</span>
                  {url ? <a href={url} target="_blank" rel="noreferrer" className="text-blue-300 flex items-center gap-1">Open <ExternalLink size={11} /></a> : !isLive && <span className="text-[10px] text-white/30">demo file</span>}
                </div>
              );
            })}
            {v.documents.length === 0 && <p className="text-xs text-white/35">No documents uploaded.</p>}
          </div>
        </div>

        {v.reviewNote && <p className="text-xs text-white/50 flex gap-2"><CircleAlert size={13} className="mt-0.5" /> Last decision: {v.reviewNote}{v.reviewedAt ? ` (${formatDateTime(v.reviewedAt)})` : ''}</p>}

        <div className="space-y-2 pt-3 border-t border-white/5">
          <textarea className="input-field h-20 resize-none text-sm" placeholder="Note to the station (required to reject or suspend)" value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {s.status === 'PENDING_REVIEW' && (
              <>
                <button className="btn-primary text-sm" disabled={!!busy || checks.some(([, ok]) => !ok)} onClick={() => review('approve')}>
                  {busy === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />} Approve and go live
                </button>
                <button className="btn-secondary text-sm" disabled={!!busy} onClick={() => review('reject')}><X size={14} /> Reject</button>
              </>
            )}
            {s.status === 'APPROVED' && <button className="btn-secondary text-sm" disabled={!!busy} onClick={() => review('suspend')}><ShieldOff size={14} /> Suspend station</button>}
            {(s.status === 'SUSPENDED' || s.status === 'REJECTED') && <button className="btn-primary text-sm" disabled={!!busy} onClick={() => review('reinstate')}><BadgeCheck size={14} /> Reinstate</button>}
          </div>
          {s.status === 'PENDING_REVIEW' && checks.some(([, ok]) => !ok) && <p className="text-[11px] text-red-300">All verification checks must pass before approval.</p>}
        </div>
      </div>
    </div>
  );
}
