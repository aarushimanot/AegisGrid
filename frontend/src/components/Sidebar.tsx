import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, LayoutDashboard, FileText, BarChart3, ShieldAlert, Activity, Cpu, LogOut, History, LayoutGrid, UserCog,
  Inbox, Building2, BadgeCheck, Users, ClipboardCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { Role } from '../services/auth';

interface NavItem { to: string; label: string; icon: LucideIcon; exact?: boolean }

const NAV: Record<Role, NavItem[]> = {
  citizen: [
    { to: '/request', label: 'Request Help', icon: AlertTriangle, exact: true },
    { to: '/requests', label: 'My Requests', icon: History },
    { to: '/services', label: 'Services', icon: LayoutGrid },
    { to: '/account', label: 'Account', icon: UserCog },
  ],
  applicant: [
    { to: '/service/register', label: 'Station Registration', icon: ClipboardCheck },
  ],
  service: [
    { to: '/station', label: 'Requests', icon: Inbox, exact: true },
    { to: '/station/history', label: 'History', icon: History },
    { to: '/station/profile', label: 'Station Profile', icon: Building2 },
  ],
  admin: [
    { to: '/admin', label: 'Command Center', icon: LayoutDashboard, exact: true },
    { to: '/admin/requests', label: 'All Requests', icon: FileText },
    { to: '/admin/services', label: 'Service Stations', icon: BadgeCheck },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/agents', label: 'Agent Monitor', icon: Cpu },
    { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  ],
};

const ROLE_LABEL: Record<Role, string> = { citizen: 'Citizen', applicant: 'Service (pending)', service: 'Help service', admin: 'Administrator' };

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signOut } = useApp();
  const items = session ? NAV[session.role] : [];

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-[#090909] border-r border-white/5 flex flex-col z-40">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/5">
        <div className="relative">
          <div className="w-9 h-9 bg-red-500 rounded-lg flex items-center justify-center">
            <ShieldAlert size={20} className="text-white" />
          </div>
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-400 rounded-full animate-pulse" />
        </div>
        <div>
          <div className="font-bold text-white text-lg leading-tight tracking-tight">AegisGrid</div>
          <div className="text-[10px] text-white/40 font-mono uppercase tracking-wider">AI Emergency Platform</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.map(({ to, label, icon: Icon, exact }) => {
          const isActive = exact ? location.pathname === to : location.pathname === to || location.pathname.startsWith(`${to}/`);
          return (
            <NavLink key={to} to={to} className={isActive ? 'nav-link-active' : 'nav-link'}>
              <Icon size={18} className={isActive ? 'text-red-400' : 'text-white/50'} />
              <span className="text-sm">{label}</span>
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500" />}
            </NavLink>
          );
        })}
      </nav>

      {session && (
        <div className="px-3 pb-3">
          <div className="px-3 py-2.5 rounded-lg bg-black-200 border border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/40">Signed in as</span>
              <span className="text-[9px] uppercase tracking-wider text-red-400/80 font-semibold">{ROLE_LABEL[session.role]}</span>
            </div>
            <div className="text-xs text-white/85 truncate mt-0.5" title={session.name}>{session.name}</div>
            <div className="text-[10px] text-white/40 truncate" title={session.email}>{session.email}</div>
            <button
              onClick={() => { signOut(); navigate('/login'); }}
              className="mt-2 flex items-center gap-1.5 text-[11px] text-white/50 hover:text-red-400 transition-colors"
            >
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/5">
        <div className="flex items-center gap-2 mb-2">
          <Activity size={12} className="text-green-400" />
          <span className="text-[10px] text-white/40">System Status</span>
          <span className="text-[10px] text-green-400 ml-auto font-medium">Operational</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className="text-[10px] text-white/40 font-mono">ENCRYPTED GRID ACTIVE</span>
        </div>
        <div className="mt-2 text-[9px] text-white/20 leading-relaxed">
          AegisGrid Enterprise v1.0 · Multi-Agent Command Core
        </div>
      </div>
    </aside>
  );
}
