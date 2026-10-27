import { Bell, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useLocation } from 'react-router-dom';

const PAGE_TITLES: Record<string, string> = {
  '/request': 'Request Emergency Help',
  '/requests': 'My Requests',
  '/services': 'Emergency Services',
  '/account': 'Account Settings',
  '/service/register': 'Service Registration',
  '/station': 'Station Console',
  '/station/history': 'Station History',
  '/station/profile': 'Station Profile',
  '/admin': 'Command Center',
  '/admin/requests': 'All Requests',
  '/admin/services': 'Service Stations',
  '/admin/users': 'Users',
  '/admin/agents': 'Multi-Agent Monitor',
  '/admin/analytics': 'Analytics & Insights',
};

export default function TopBar() {
  const { notifications, refreshIncidents, loading, isLive, session } = useApp();
  const location = useLocation();

  const title = PAGE_TITLES[location.pathname]
    ?? Object.entries(PAGE_TITLES).sort((a, b) => b[0].length - a[0].length).find(([path]) => location.pathname.startsWith(`${path}/`))?.[1]
    ?? 'AegisGrid';
  const isStaff = session?.role === 'admin';

  return (
    <header className="fixed top-0 left-64 right-0 z-40 bg-[#090909]/95 backdrop-blur-md border-b border-white/5 px-6 py-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">{title}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-white/40 font-mono">SYSTEM ACTIVE · LIVE MONITORING</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isStaff && <button
            onClick={refreshIncidents}
            className="p-2 rounded-lg bg-black-200 border border-white/10 hover:border-white/20 text-white/50 hover:text-white transition-all duration-200"
            title="Refresh data"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>}
          <div className="relative">
            <div className="p-2 rounded-lg bg-black-200 border border-white/10 text-white/50 cursor-pointer hover:border-white/20 hover:text-white transition-all">
              <Bell size={15} />
            </div>
            {notifications.length > 0 && (
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {notifications.length}
              </div>
            )}
          </div>
          {isLive ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20" title="Connected to the AegisGrid AWS backend">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-xs font-medium text-green-400">LIVE · AWS</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20" title="Set VITE_API_URL to connect to the backend">
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              <span className="text-xs font-medium text-yellow-400">DEMO DATA</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
