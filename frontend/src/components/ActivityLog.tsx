// An account's activity history, newest first: sign-ins, requests, responses,
// verification steps, duty changes, trust changes and admin decisions.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BadgeCheck, ClipboardCheck, Gavel, Loader2, Radio, Settings2, Siren, UserRound } from 'lucide-react';
import { useLive } from '../hooks/useLive';
import type { ActivityCategory, ApiActivity, ApiActivityPage } from '../services/apiTypes';
import { formatDateTime } from '../utils/helpers';

const CATEGORY: Record<ActivityCategory, { label: string; icon: typeof Activity; cls: string }> = {
  ACCOUNT: { label: 'Account', icon: UserRound, cls: 'text-white/60' },
  REQUEST: { label: 'Request', icon: Siren, cls: 'text-red-400' },
  RESPONSE: { label: 'Response', icon: Radio, cls: 'text-blue-300' },
  VERIFICATION: { label: 'Verification', icon: ClipboardCheck, cls: 'text-purple-300' },
  OPERATIONS: { label: 'Operations', icon: Settings2, cls: 'text-yellow-300' },
  TRUST: { label: 'Trust', icon: BadgeCheck, cls: 'text-green-400' },
  ADMIN: { label: 'Admin action', icon: Gavel, cls: 'text-orange-300' },
};

interface Props {
  load: (cursor?: string) => Promise<ApiActivityPage>;
  /** Where a request id links to (citizen tracker or admin detail); omit for no links. */
  requestLink?: (incidentId: string) => string;
  title?: string;
}

export default function ActivityLog({ load, requestLink, title = 'Activity history' }: Props) {
  const { data: first, loading } = useLive(() => load(), [], 10_000);
  const [older, setOlder] = useState<ApiActivity[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<ActivityCategory | 'ALL'>('ALL');

  const next = cursor ?? (older.length ? undefined : first?.nextCursor);
  const items = [...(first?.items ?? []), ...older].filter(a => filter === 'ALL' || a.category === filter);
  const present = new Set([...(first?.items ?? []), ...older].map(a => a.category));

  const more = async () => {
    if (!next) return;
    setBusy(true);
    try {
      const page = await load(next);
      setOlder(o => [...o, ...page.items]);
      setCursor(page.nextCursor ?? '');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass-card p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Activity size={15} className="text-red-400" /> {title}</h3>
        <div className="flex flex-wrap gap-1 ml-auto">
          {(['ALL', ...Object.keys(CATEGORY)] as (ActivityCategory | 'ALL')[]).filter(c => c === 'ALL' || present.has(c)).map(c => (
            <button key={c} onClick={() => setFilter(c)}
              className={`px-2 py-0.5 rounded text-[11px] border ${filter === c ? 'border-red-500/40 bg-red-500/10 text-white' : 'border-white/10 text-white/45 hover:text-white/75'}`}>
              {c === 'ALL' ? 'All' : CATEGORY[c].label}
            </button>
          ))}
        </div>
      </div>
      {loading ? <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-red-400" /></div>
        : items.length === 0 ? <p className="text-xs text-white/40 py-4 text-center">No activity recorded yet.</p> : (
          <ol className="relative border-l border-white/10 ml-2 space-y-3">
            {items.map((a, i) => {
              const c = CATEGORY[a.category] ?? CATEGORY.ACCOUNT;
              const Icon = c.icon;
              return (
                <li key={`${a.at}-${i}`} className="ml-4">
                  <span className="absolute -left-[9px] mt-0.5 w-[18px] h-[18px] rounded-full bg-[#141414] border border-white/10 flex items-center justify-center"><Icon size={10} className={c.cls} /></span>
                  <div className="text-xs text-white/80 leading-relaxed">{a.summary}</div>
                  <div className="text-[10px] text-white/35 mt-0.5 flex flex-wrap gap-x-2">
                    <span>{formatDateTime(a.at)}</span>
                    <span className={c.cls}>{c.label}</span>
                    {a.by && <span>by {a.by}</span>}
                    {a.incidentId && requestLink && <Link to={requestLink(a.incidentId)} className="text-blue-300 hover:underline">View request</Link>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      {next && (
        <button onClick={more} disabled={busy} className="btn-secondary text-xs mt-4 w-full justify-center">
          {busy ? <Loader2 size={12} className="animate-spin" /> : null} Load older activity
        </button>
      )}
    </section>
  );
}
