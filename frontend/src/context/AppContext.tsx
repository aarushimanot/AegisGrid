import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Incident, Notification, KPIStats } from '../types';
import { config, isLiveMode } from '../config';
import { adminApi } from '../services/api';
import { DB_EVENT } from '../services/demoBackend';
import { ensureSeeded } from '../services/demoAuth';
import { getSession, onSessionChange, signOut as authSignOut, type Session } from '../services/auth';
import { toUiIncident } from '../services/mappers';
import { computeKpis } from '../utils/liveAnalytics';

interface AppContextType {
  /** All incidents (admin only). */
  incidents: Incident[];
  kpiStats: KPIStats | null;
  notifications: Notification[];
  loading: boolean;
  /** true when talking to the AWS backend, false on the in-browser demo engine */
  isLive: boolean;
  session: Session | null;
  signOut: () => void;
  refreshIncidents: () => Promise<void>;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [kpiStats, setKpiStats] = useState<KPIStats | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<Session | null>(() => getSession());
  useEffect(() => onSessionChange(setSession), []);
  useEffect(() => { if (!isLiveMode) void ensureSeeded(); }, []);
  const isAdmin = session?.role === 'admin';

  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp'>) => {
    const n: Notification = { ...notification, id: `notif-${Date.now()}-${Math.random()}`, timestamp: Date.now() };
    setNotifications(prev => [n, ...prev.slice(0, 4)]);
    setTimeout(() => setNotifications(prev => prev.filter(x => x.id !== n.id)), 5000);
  }, []);

  const refreshIncidents = useCallback(async () => {
    if (!isAdmin) return; // the full incident feed is the admin's
    setLoading(true);
    try {
      const data = (await adminApi.incidents()).map(i => toUiIncident(i)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setIncidents(data);
      setKpiStats(computeKpis(data));
    } catch (e) {
      console.error('[AegisGrid] Error refreshing incidents:', e);
      if ((e as { status?: number }).status === 401) {
        authSignOut();
        addNotification({ type: 'warning', message: 'Session expired. Please sign in again.' });
      }
    } finally {
      setLoading(false);
    }
  }, [isAdmin, addNotification]);

  const removeNotification = useCallback((id: string) => setNotifications(prev => prev.filter(n => n.id !== id)), []);

  const signOut = useCallback(() => {
    authSignOut();
    setIncidents([]);
    setKpiStats(null);
  }, []);

  useEffect(() => {
    refreshIncidents();
    if (!isAdmin) return;
    const timer = setInterval(refreshIncidents, isLiveMode ? config.pollIntervalMs : 3000);
    window.addEventListener(DB_EVENT, refreshIncidents);
    window.addEventListener('storage', refreshIncidents);
    return () => {
      clearInterval(timer);
      window.removeEventListener(DB_EVENT, refreshIncidents);
      window.removeEventListener('storage', refreshIncidents);
    };
  }, [refreshIncidents, isAdmin]);

  return (
    <AppContext.Provider value={{
      incidents, kpiStats, notifications, loading, isLive: isLiveMode, session, signOut,
      refreshIncidents, addNotification, removeNotification,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
