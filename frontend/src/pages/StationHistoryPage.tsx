// Station: every request this station received and what happened to it.

import { useMemo, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { useLive } from '../hooks/useLive';
import { stationApi } from '../services/api';
import type { Offer } from '../services/apiTypes';
import { TYPE_FROM_API, shortRef } from '../services/mappers';
import { formatDateTime } from '../utils/helpers';
import TypeIcon from '../components/TypeIcon';

const OUTCOME: Record<Offer['status'], { text: string; cls: string }> = {
  OFFERED: { text: 'Waiting', cls: 'badge-pending' },
  ACCEPTED: { text: 'En route', cls: 'badge-dispatched' },
  ARRIVED: { text: 'On scene', cls: 'badge-active' },
  COMPLETED: { text: 'Completed', cls: 'badge-resolved' },
  TRANSFERRED: { text: 'Transferred', cls: 'badge-pending' },
  EXPIRED: { text: 'Missed', cls: 'badge-critical' },
  CANCELLED: { text: 'Cancelled', cls: 'badge-pending' },
  FALSE_ALARM: { text: 'False alarm', cls: 'badge-critical' },
};

export default function StationHistoryPage() {
  const { data: offers } = useLive(() => stationApi.offers(), [], 5000);
  const [filter, setFilter] = useState<'all' | Offer['status']>('all');
  const list = useMemo(() => (offers ?? []).filter(o => filter === 'all' || o.status === filter), [offers, filter]);
  const completed = (offers ?? []).filter(o => o.responseMinutes !== undefined);
  const avg = completed.length ? completed.reduce((n, o) => n + o.responseMinutes!, 0) / completed.length : null;

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Request history</h2>
        <p className="text-sm text-white/40 mt-1">Every request routed to your station. Response time runs from the citizen's request to your verified arrival.</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Requests', String(offers?.length ?? 0)],
          ['Completed', String((offers ?? []).filter(o => o.status === 'COMPLETED').length)],
          ['Average response', avg === null ? '—' : `${avg.toFixed(1)} min`],
        ].map(([l, v]) => (
          <div key={l} className="glass-card p-4"><div className="text-[11px] text-white/40 uppercase tracking-wider">{l}</div><div className="text-2xl font-bold text-white mt-1">{v}</div></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(['all', 'COMPLETED', 'TRANSFERRED', 'EXPIRED', 'ACCEPTED', 'ARRIVED'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-xs border ${filter === f ? 'border-red-500/40 bg-red-500/10 text-white' : 'border-white/10 text-white/50 hover:text-white/80'}`}>
            {f === 'all' ? 'All' : OUTCOME[f].text}
          </button>
        ))}
      </div>
      {!offers ? <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-red-400" /></div> : list.length === 0 ? (
        <div className="glass-card py-14 text-center"><History size={36} className="text-white/10 mx-auto mb-3" /><p className="text-sm text-white/40">No requests yet.</p></div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-white/40 border-b border-white/5">
              <th className="px-4 py-2.5 font-medium">Request</th><th className="px-4 py-2.5 font-medium">Received</th><th className="px-4 py-2.5 font-medium">Location</th>
              <th className="px-4 py-2.5 font-medium">Outcome</th><th className="px-4 py-2.5 font-medium text-right">Response</th>
            </tr></thead>
            <tbody>
              {list.map(o => {
                const type = TYPE_FROM_API[o.incident.incidentType ?? 'OTHER'];
                return (
                  <tr key={o.offerId} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><TypeIcon type={type} size={14} /><span className="text-white/85">{type}</span><span className="font-mono text-[10px] text-white/35">{shortRef(o.incidentId)}</span></div>
                      {o.transferReason && <div className="text-[10px] text-yellow-400/80 mt-0.5">{o.transferReason}</div>}</td>
                    <td className="px-4 py-3 text-xs text-white/55">{formatDateTime(o.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-white/55 max-w-[220px] truncate">{o.incident.address ?? 'Live location'} · {o.distanceKm} km</td>
                    <td className="px-4 py-3"><span className={`status-badge text-[10px] ${OUTCOME[o.status].cls}`}>{OUTCOME[o.status].text}</span></td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-white/80">{o.responseMinutes !== undefined ? `${o.responseMinutes} min` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
