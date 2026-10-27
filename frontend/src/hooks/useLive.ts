// Keep a piece of server state fresh: polls on an interval and, in demo mode,
// refreshes instantly when any tab changes the shared demo data.

import { useCallback, useEffect, useRef, useState } from 'react';
import { isLiveMode } from '../config';
import { DB_EVENT } from '../services/demoBackend';

export function useLive<T>(fetcher: () => Promise<T>, deps: unknown[] = [], intervalMs = isLiveMode ? 5000 : 2000) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState('');
  const ref = useRef(fetcher);
  ref.current = fetcher;

  const reload = useCallback(async () => {
    try {
      setData(await ref.current());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, intervalMs);
    const onChange = () => reload();
    window.addEventListener(DB_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener(DB_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, intervalMs, ...deps]);

  return { data, error, reload, loading: data === undefined && !error };
}
