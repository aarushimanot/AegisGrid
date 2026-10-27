// Citizen: history of every request with status and measured response times.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Clock, History, Loader2, LocateFixed, MapPin, Timer } from 'lucide-react';
import { citizenApi } from '../services/api';
import { shortRef } from '../services/mappers';
import { STATUS_BADGE, STATUS_TEXT, formatMinutes, isActive, requestType } from '../utils/citizen';
import { useLive } from '../hooks/useLive';
import { formatDateTime } from '../utils/helpers';
import TypeIcon from '../components/TypeIcon';

type Filter = 'all' | 'active' | 'resolved';

export default function MyRequestsPage() {
  const { data } = useLive(() => citizenApi.myRequests(), []);
  const items = data ?? null;
  const [filter, setFilter] = useState<Filter>('all');

  const stats = useMemo(() => {
    const list = items ?? [];
    const times = list.map(r => r.responseMinutes).filter((n): n is number => n !== null);
    return {
      total: list.length,
      active: list.filter(isActive).length,
      avgResponse: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    };
  }, [items]);

  const shown = (items ?? []).filter(r => filter === 'all' || (filter === 'active' ? isActive(r) : !isActive(r)));

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">My Requests</h2>
          <p className="text-sm text-white/40 mt-1">Every emergency request you've made, with how fast help responded.</p>
        </div>
        <Link to="/request" className="btn-primary text-sm"><AlertTriangle size={15} /> Request help</Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total requests', value: String(stats.total) },
          { label: 'Active now', value: String(stats.active), color: stats.active ? 'text-orange-400' : 'text-white' },
          { label: 'Average response time', value: formatMinutes(stats.avgResponse), color: 'text-green-400' },
        ].map(s => (
          <div key={s.label} className="glass-card p-4">
            <div className="text-[11px] text-white/40 uppercase tracking-wider">{s.label}</div>
            <div className={`text-2xl font-bold mt-1 ${s.color ?? 'text-white'}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5">
        {(['all', 'active', 'resolved'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs capitalize border ${filter === f ? 'border-red-500/40 bg-red-500/10 text-white' : 'border-white/10 text-white/50 hover:text-white/80'}`}>
            {f}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="flex justify-center py-16"><Loader2 size={26} className="animate-spin text-red-400" /></div>
      ) : shown.length === 0 ? (
        <div className="glass-card py-16 text-center">
          <History size={40} className="text-white/10 mx-auto mb-3" />
          <p className="text-sm text-white/40">{items.length ? 'No requests match this filter.' : "You haven't requested help yet."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map(r => {
            const type = requestType(r);
            return (
              <Link key={r.incidentId} to={`/requests/${r.incidentId}`} className="glass-card p-4 flex items-center gap-4 hover:border-white/20 transition-all group">
                <div className="w-10 h-10 rounded-lg bg-black-300 border border-white/5 flex items-center justify-center flex-shrink-0">
                  {type ? <TypeIcon type={type} size={18} /> : <Loader2 size={16} className="animate-spin text-white/40" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-white/50">{shortRef(r.incidentId)}</span>
                    <span className="text-sm text-white font-medium">{type ? `${type} emergency` : 'Analysing…'}</span>
                    <span className={`status-badge text-[10px] ${STATUS_BADGE[r.status]}`}>{STATUS_TEXT[r.status]}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-white/40 flex-wrap">
                    <span className="flex items-center gap-1"><Clock size={11} /> {formatDateTime(r.createdAt)}</span>
                    <span className="flex items-center gap-1 truncate max-w-[220px]">
                      {r.locationSource === 'gps' ? <LocateFixed size={11} /> : <MapPin size={11} />}
                      {r.address ?? 'Live location'}
                    </span>
                    {r.services.length > 0 && <span>{r.services.map(x => x.stationName ?? x.serviceName).join(' · ')}</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[10px] text-white/35 uppercase tracking-wider flex items-center justify-end gap-1"><Timer size={10} /> Response</div>
                  <div className="text-sm font-bold text-white">{formatMinutes(r.responseMinutes)}</div>
                  {r.resolutionMinutes !== null && <div className="text-[10px] text-white/35">resolved in {formatMinutes(r.resolutionMinutes)}</div>}
                </div>
                <ChevronRight size={16} className="text-white/20 group-hover:text-white/50" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
