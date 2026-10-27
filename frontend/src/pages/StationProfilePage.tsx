// Station: verified registration details (read-only; changes go through the admin).

import { BadgeCheck, Building2, FileCheck2, Loader2, MapPin, Phone, UserRound } from 'lucide-react';
import { SERVICES } from '@core/catalog';
import { useLive } from '../hooks/useLive';
import { stationApi } from '../services/api';
import { formatDateTime } from '../utils/helpers';
import { KIND } from '../components/LiveMap';
import PinMap from '../components/PinMap';
import ActivityLog from '../components/ActivityLog';
import { accountApi } from '../services/api';

export default function StationProfilePage() {
  const { data: s } = useLive(() => stationApi.me(), [], 10_000);
  if (!s) return <div className="flex justify-center py-20"><Loader2 size={26} className="animate-spin text-red-400" /></div>;
  const { Icon, color } = KIND[s.serviceType];
  const rows: [React.ComponentType<{ size?: number; className?: string }>, string, string][] = [
    [BadgeCheck, SERVICES[s.serviceType].registration.label, `${s.registrationNumber} · ${s.issuingAuthority}`],
    [UserRound, 'Officer in charge', `${s.contactPerson.name}, ${s.contactPerson.designation}`],
    [Phone, 'Station phone', `${s.phone}${s.verification.phoneVerified ? ' (verified)' : ''}`],
    [Building2, 'Official email', s.officialEmail],
    [MapPin, 'Address', s.address],
  ];
  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div className="glass-card p-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: `${color}1f` }}><Icon size={26} style={{ color }} /></div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-white">{s.name}</h2>
          <p className="text-sm text-white/50">{SERVICES[s.serviceType].name} · {s.unitsTotal} {SERVICES[s.serviceType].unitLabel} · serves within {s.coverageKm} km</p>
        </div>
        <span className="flex items-center gap-1.5 text-sm text-green-400"><BadgeCheck size={16} /> Verified</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-5 space-y-3">
          {rows.map(([I, label, value]) => (
            <div key={label} className="flex gap-3"><I size={15} className="text-white/35 mt-0.5" /><div><div className="text-[11px] text-white/40">{label}</div><div className="text-sm text-white/85">{value}</div></div></div>
          ))}
          <div className="pt-3 border-t border-white/5">
            <div className="text-[11px] text-white/40 mb-1.5">Verification documents</div>
            {s.verification.documents.map(d => <div key={d.key} className="text-xs text-white/70 flex items-center gap-1.5"><FileCheck2 size={12} className="text-green-400" /> {d.name}</div>)}
            {s.verification.reviewedAt && <p className="text-[11px] text-white/35 mt-2">Approved {formatDateTime(s.verification.reviewedAt)}{s.verification.reviewedBy ? ` by ${s.verification.reviewedBy}` : ''}</p>}
          </div>
          <p className="text-[11px] text-white/30">To change registered details, contact the AegisGrid administrator. Changes require re-verification.</p>
        </div>
        <div className="glass-card p-4"><PinMap value={s.location} onChange={() => undefined} height={340} /></div>
      </div>
      <ActivityLog load={accountApi.activity} title="Station activity log" />
    </div>
  );
}
