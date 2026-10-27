// While a citizen has an active request made with live location, keep sending
// the device's position so responders follow them. Shows a small indicator.

import { useEffect, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { citizenApi } from '../services/api';
import type { ApiCitizenRequest } from '../services/apiTypes';

const SEND_EVERY_MS = 15_000;
const CHECK_EVERY_MS = 20_000;

export default function LiveLocationSharer() {
  const [tracked, setTracked] = useState<ApiCitizenRequest[]>([]);
  const [error, setError] = useState('');
  const lastSent = useRef(0);

  // Which requests need live location right now?
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const list = await citizenApi.myRequests();
        if (!stopped) setTracked(list.filter(r => r.status !== 'RESOLVED' && r.locationSource === 'gps'));
      } catch {
        // keep the previous list
      }
    };
    check();
    const t = setInterval(check, CHECK_EVERY_MS);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  const ids = tracked.map(r => r.incidentId).join(',');
  useEffect(() => {
    if (!ids || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      pos => {
        setError('');
        if (Date.now() - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = Date.now();
        for (const id of ids.split(',')) {
          citizenApi.shareLocation(id, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy).catch(() => undefined);
        }
      },
      () => setError('Location access is off'),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [ids]);

  if (!tracked.length) return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 md:left-[calc(50%+8rem)] z-50 flex items-center gap-2 px-3.5 py-2 rounded-full bg-black-200 border border-green-500/30 shadow-lg text-xs">
      <LocateFixed size={14} className={error ? 'text-yellow-400' : 'text-green-400'} />
      <span className={error ? 'text-yellow-400' : 'text-green-400'}>
        {error ? `${error}. Responders have your last known location.` : 'Sharing your live location with responders'}
      </span>
      <span className={`w-1.5 h-1.5 rounded-full ${error ? 'bg-yellow-400' : 'bg-green-400 animate-pulse'}`} />
    </div>
  );
}
