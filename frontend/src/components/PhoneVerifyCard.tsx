// One-time phone verification for citizens. Every request is tied to a verified
// mobile number, so responders can call back and misuse is accountable.

import { useState } from 'react';
import { Loader2, Phone, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { citizenApi } from '../services/api';
import type { ApiProfile } from '../services/apiTypes';

export default function PhoneVerifyCard({ onVerified }: { onVerified: (p: ApiProfile) => void }) {
  const { session, addNotification } = useApp();
  const [phone, setPhone] = useState(session?.phone ?? '+91');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ channel: string; devCode?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const send = () => run(async () => {
    const p = phone.replace(/[\s-]/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(p)) throw new Error('Enter the number with country code, e.g. +919876543210');
    setSent(await citizenApi.sendPhoneCode(p));
    setCode('');
  });

  const verify = () => run(async () => {
    const profile = await citizenApi.verifyPhone(code);
    addNotification({ type: 'success', message: 'Mobile number verified.' });
    onVerified(profile);
  });

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center gap-3 pb-4 border-b border-white/5">
        <div className="w-10 h-10 bg-blue-500/15 rounded-lg flex items-center justify-center"><ShieldCheck size={20} className="text-blue-300" /></div>
        <div>
          <h2 className="text-lg font-bold text-white">Verify your mobile number</h2>
          <p className="text-xs text-white/40">Needed once, before your first request. Responders use it to reach you, and it keeps every request accountable.</p>
        </div>
      </div>
      <div>
        <label className="label">Mobile number</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input className="input-field pl-9" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+919876543210" inputMode="tel" />
          </div>
          <button onClick={send} disabled={busy} className="btn-secondary text-sm whitespace-nowrap">
            {busy && !sent ? <Loader2 size={14} className="animate-spin" /> : null}{sent ? 'Resend code' : 'Send code'}
          </button>
        </div>
      </div>
      {sent && (
        <div className="space-y-2">
          <p className="text-xs text-white/50">
            {sent.channel === 'sms' ? `Code sent by SMS to ${phone}.` : sent.channel === 'email' ? 'Code sent to your email address.' : 'SMS is not enabled on this deployment, so the code is shown here:'}
            {sent.devCode && <span className="ml-2 font-mono text-base text-white tracking-widest">{sent.devCode}</span>}
          </p>
          <div className="flex gap-2">
            <input className="input-field font-mono tracking-widest flex-1" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" inputMode="numeric" />
            <button onClick={verify} disabled={busy || code.length !== 6} className="btn-primary text-sm">
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}Verify
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-[11px] text-white/35">In immediate danger, don't wait: call <span className="text-white/70 font-medium">112</span>.</p>
    </div>
  );
}
