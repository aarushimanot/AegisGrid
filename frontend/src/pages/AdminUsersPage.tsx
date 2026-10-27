// Admin: every account on the platform (citizens, applicants, stations) with
// controls to disable, re-enable or delete them. The admin account itself is protected.
// Citizens also show their trust score and false-alarm strikes, with controls to
// reverse a strike, reset, suspend requests or reinstate. "History" opens any
// account's full activity log.

import { useMemo, useState } from 'react';
import { Ban, CheckCircle2, History, Loader2, RotateCcw, Search, ShieldOff, Trash2, Undo2, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useLive } from '../hooks/useLive';
import { adminApi } from '../services/api';
import type { ApiUser, CitizenStanding, StandingAction } from '../services/apiTypes';
import { formatDate } from '../utils/helpers';
import ActivityLog from '../components/ActivityLog';

const ROLE: Record<ApiUser['role'], { label: string; cls: string }> = {
  admin: { label: 'Admin', cls: 'bg-red-500/15 text-red-300' },
  service: { label: 'Service station', cls: 'bg-blue-500/15 text-blue-300' },
  applicant: { label: 'Service (pending)', cls: 'bg-yellow-500/15 text-yellow-300' },
  citizen: { label: 'Citizen', cls: 'bg-white/10 text-white/70' },
};

const STANDING: Record<CitizenStanding, { label: string; cls: string }> = {
  GOOD: { label: 'Good', cls: 'text-green-400' },
  WARNING: { label: 'Warning', cls: 'text-yellow-300' },
  RESTRICTED: { label: 'Restricted', cls: 'text-orange-400' },
  SUSPENDED: { label: 'Requests suspended', cls: 'text-red-400' },
};

const STANDING_DONE: Record<StandingAction, string> = {
  reset: 'trust reset', suspend: 'requests suspended', reinstate: 'reinstated', reverse_false_alarm: 'one false alarm reversed',
};

export default function AdminUsersPage() {
  const { addNotification } = useApp();
  const { data: users, reload } = useLive(() => adminApi.users(), [], 6000);
  const [role, setRole] = useState<ApiUser['role'] | 'all'>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [viewing, setViewing] = useState<ApiUser | null>(null);

  const list = useMemo(() => (users ?? [])
    .filter(u => (role === 'all' || u.role === role) && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')), [users, role, q]);

  const act = async (u: ApiUser, action: 'disable' | 'enable' | 'delete') => {
    if (action === 'delete' && !window.confirm(`Delete ${u.email}? This cannot be undone.`)) return;
    setBusy(`${u.username}-${action}`);
    try {
      await adminApi.userAction(u, action);
      addNotification({ type: 'success', message: `${u.email}: ${action}d.` });
      await reload();
    } catch (e) {
      addNotification({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const standing = async (u: ApiUser, action: StandingAction) => {
    const note = action === 'suspend' ? window.prompt(`Suspend requests from ${u.email}? Reason (optional):`) : '';
    if (note === null) return;
    setBusy(`${u.username}-${action}`);
    try {
      await adminApi.standing(u.userId!, action, note || undefined);
      addNotification({ type: 'success', message: `${u.email}: ${STANDING_DONE[action]}.` });
      await reload();
    } catch (e) {
      addNotification({ type: 'error', message: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const count = (r: ApiUser['role']) => (users ?? []).filter(u => u.role === r).length;

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Users</h2>
        <p className="text-sm text-white/40 mt-1">All accounts on AegisGrid. Disabled accounts cannot sign in.</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'citizen', 'service', 'applicant', 'admin'] as const).map(r => (
          <button key={r} onClick={() => setRole(r)} className={`px-3 py-1.5 rounded-md text-xs border ${role === r ? 'border-red-500/40 bg-red-500/10 text-white' : 'border-white/10 text-white/50 hover:text-white/80'}`}>
            {r === 'all' ? `All ${users?.length ?? 0}` : `${ROLE[r].label} ${count(r)}`}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input className="input-field text-xs py-1.5 pl-8 w-56" placeholder="Search name or email" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      {!users ? <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-red-400" /></div> : list.length === 0 ? (
        <div className="glass-card py-14 text-center"><Users size={36} className="text-white/10 mx-auto mb-3" /><p className="text-sm text-white/40">No users match.</p></div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-white/40 border-b border-white/5">
              <th className="px-4 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">Role</th><th className="px-4 py-2.5 font-medium">Sign-in</th>
              <th className="px-4 py-2.5 font-medium">Joined</th><th className="px-4 py-2.5 font-medium">Trust</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium text-right">Actions</th>
            </tr></thead>
            <tbody>
              {list.map(u => (
                <tr key={u.username} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3"><div className="text-white/85">{u.name ?? '—'}</div><div className="text-[11px] text-white/40">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[11px] ${ROLE[u.role].cls}`}>{ROLE[u.role].label}</span></td>
                  <td className="px-4 py-3 text-xs text-white/55">{u.provider === 'google' ? 'Google' : 'Email + password'}</td>
                  <td className="px-4 py-3 text-xs text-white/55">{u.createdAt ? formatDate(u.createdAt) : '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    {u.role !== 'citizen' ? <span className="text-white/25">—</span> : !u.profile ? <span className="text-white/35">No requests yet</span> : (
                      <div className="space-y-0.5">
                        <div><span className="text-white/85 font-medium">{u.profile.trustScore}</span><span className="text-white/35">/100</span> · <span className={STANDING[u.profile.standing].cls}>{STANDING[u.profile.standing].label}</span></div>
                        <div className="text-[11px] text-white/40">{u.profile.genuineRequests} genuine · {u.profile.falseAlarms} false alarm{u.profile.falseAlarms === 1 ? '' : 's'}{u.profile.phoneVerified ? ' · phone verified' : ''}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{u.enabled ? <span className="text-green-400">Active</span> : <span className="text-red-300">Disabled</span>}{u.status === 'UNCONFIRMED' && <span className="text-white/35"> · unverified</span>}</td>
                  <td className="px-4 py-3 text-right">
                    {u.role === 'admin' ? (
                      <div className="flex justify-end items-center gap-2">
                        {u.userId && <button onClick={() => setViewing(u)} className="btn-secondary text-[11px] py-1 px-2"><History size={11} /> History</button>}
                        <span className="text-[11px] text-white/30">Protected</span>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        {u.userId && <button onClick={() => setViewing(u)} title="Full activity history" className="btn-secondary text-[11px] py-1 px-2"><History size={11} /> History</button>}
                        {u.role === 'citizen' && u.profile && u.userId && <>
                          {u.profile.falseAlarms > 0 && <button disabled={!!busy} onClick={() => standing(u, 'reverse_false_alarm')} title="Reverse one false alarm (it was genuine)" className="btn-secondary text-[11px] py-1 px-2"><Undo2 size={11} /> Reverse strike</button>}
                          {(u.profile.falseAlarms > 0 || u.profile.trustScore !== 50) && u.profile.standing !== 'SUSPENDED' && <button disabled={!!busy} onClick={() => standing(u, 'reset')} title="Clear strikes and reset trust" className="btn-secondary text-[11px] py-1 px-2"><RotateCcw size={11} /></button>}
                          {u.profile.standing === 'SUSPENDED'
                            ? <button disabled={!!busy} onClick={() => standing(u, 'reinstate')} className="btn-secondary text-[11px] py-1 px-2"><CheckCircle2 size={11} /> Reinstate</button>
                            : <button disabled={!!busy} onClick={() => standing(u, 'suspend')} title="Stop this account from sending requests" className="btn-secondary text-[11px] py-1 px-2 hover:text-red-400"><ShieldOff size={11} /> Suspend requests</button>}
                        </>}
                        {u.enabled
                          ? <button disabled={!!busy} onClick={() => act(u, 'disable')} className="btn-secondary text-[11px] py-1 px-2">{busy === `${u.username}-disable` ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />} Disable</button>
                          : <button disabled={!!busy} onClick={() => act(u, 'enable')} className="btn-secondary text-[11px] py-1 px-2">{busy === `${u.username}-enable` ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Enable</button>}
                        <button disabled={!!busy} onClick={() => act(u, 'delete')} className="btn-secondary text-[11px] py-1 px-2 hover:text-red-400"><Trash2 size={11} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setViewing(null)}>
          <div className="w-full max-w-xl h-full overflow-y-auto bg-[#0d0d0d] border-l border-white/10 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">{viewing.name ?? viewing.email}</h3>
                <p className="text-xs text-white/45">{viewing.email} · {ROLE[viewing.role].label}{viewing.createdAt ? ` · joined ${formatDate(viewing.createdAt)}` : ''}</p>
                {viewing.profile && (
                  <p className="text-xs text-white/55 mt-1">Trust {viewing.profile.trustScore}/100 · {STANDING[viewing.profile.standing].label} · {viewing.profile.genuineRequests} genuine, {viewing.profile.falseAlarms} false alarm(s)</p>
                )}
              </div>
              <button onClick={() => setViewing(null)} className="btn-secondary text-xs">Close</button>
            </div>
            <ActivityLog key={viewing.userId} load={c => adminApi.activity(viewing.userId!, c)} requestLink={id => `/admin/requests/${id}`} />
          </div>
        </div>
      )}
    </div>
  );
}
