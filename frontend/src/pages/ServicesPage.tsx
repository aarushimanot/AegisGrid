// Citizen: browse the eight emergency services and the verified stations
// registered under each. Informational only — to get help, citizens describe
// the emergency and the AI sends the nearest station of each service needed.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, Loader2, MapPin, Phone } from 'lucide-react';
import { citizenApi } from '../services/api';
import type { ServiceType } from '../services/apiTypes';
import { useLive } from '../hooks/useLive';
import LiveMap, { KIND } from '../components/LiveMap';
import type { MapUnit } from '../services/fleet';

export default function ServicesPage() {
  const { data: catalog, error } = useLive(() => citizenApi.services(), [], 15_000);
  const [selected, setSelected] = useState<ServiceType | 'ALL'>('ALL');

  const units = useMemo<MapUnit[]>(() => (catalog?.services ?? [])
    .filter(s => selected === 'ALL' || s.id === selected)
    .flatMap(s => s.stations.map(st => ({ id: st.id, name: st.name, kind: s.id, status: st.onDuty ? 'available' : 'offline', lat: st.location.lat, lng: st.location.lon, detail: st.address }) as MapUnit)), [catalog, selected]);

  const shown = (catalog?.services ?? []).filter(s => selected === 'ALL' || s.id === selected);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">Emergency Services</h2>
          <p className="text-sm text-white/40 mt-1">Eight services and their verified stations. You don't choose one; describe your emergency and the nearest station of each service you need is alerted.</p>
        </div>
        <Link to="/request" className="btn-primary text-sm"><AlertTriangle size={15} /> Request help</Link>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!catalog && !error && <div className="flex justify-center py-16"><Loader2 size={26} className="animate-spin text-red-400" /></div>}

      {catalog && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {catalog.services.map(s => {
              const { Icon, color } = KIND[s.id];
              const active = selected === s.id;
              return (
                <button key={s.id} onClick={() => setSelected(active ? 'ALL' : s.id)}
                  className={`glass-card p-4 text-left transition-all ${active ? 'border-white/30' : 'hover:border-white/15'}`}>
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}1a` }}><Icon size={17} style={{ color }} /></div>
                    <div>
                      <div className="text-sm font-bold text-white leading-tight">{s.name}</div>
                      {s.helpline && <div className="text-[10px] text-white/40 flex items-center gap-1"><Phone size={9} /> {s.helpline}</div>}
                    </div>
                  </div>
                  <p className="text-[11px] text-white/50 leading-relaxed min-h-[44px]">{s.description}</p>
                  <div className="text-[11px] text-white/70 mt-2 flex items-center gap-1"><BadgeCheck size={11} className="text-green-400" /> {s.stations.length} verified station{s.stations.length === 1 ? '' : 's'}</div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 glass-card overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white">{selected === 'ALL' ? 'All stations' : `${KIND[selected].label} stations`}</h3>
                {selected !== 'ALL' && <button onClick={() => setSelected('ALL')} className="text-[11px] text-white/40 hover:text-white">Show all</button>}
              </div>
              <div className="divide-y divide-white/5 max-h-[420px] overflow-y-auto">
                {shown.flatMap(s => s.stations.map(st => {
                  const { Icon, color } = KIND[s.id];
                  return (
                    <div key={st.id} className="flex items-start gap-3 px-4 py-3">
                      <Icon size={15} style={{ color }} className="mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white/85">{st.name}</div>
                        <div className="text-[11px] text-white/40 flex items-center gap-1"><MapPin size={10} /> {st.address}</div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.onDuty ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-white/40'}`}>{st.onDuty ? 'On duty' : 'Off duty'}</span>
                    </div>
                  );
                }))}
                {shown.every(s => s.stations.length === 0) && <p className="px-4 py-6 text-xs text-white/40">No verified stations registered yet.</p>}
              </div>
            </div>
            <div className="lg:col-span-2 glass-card p-4">
              <h3 className="text-sm font-semibold text-white mb-2">Map</h3>
              <LiveMap key={selected} incidents={[]} units={units} height={380} minimal />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
