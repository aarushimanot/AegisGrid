// Citizen account settings: profile, live-location preference, trust standing, password, history.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, History, KeyRound, Loader2, LocateFixed, LogOut, Save, UserRound } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useLive } from '../hooks/useLive';
import { accountApi, citizenApi } from '../services/api';
import ActivityLog from '../components/ActivityLog';
import { changePassword, updateProfile } from '../services/auth';
import PasswordField from '../components/PasswordField';
import { isStrongPassword, isValidPhone } from '../utils/password';

export default function AccountPage() {
  const { session, signOut, addNotification } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState(session?.name ?? '');
  const { data: trust } = useLive(() => (session?.role === 'citizen' ? citizenApi.profile() : Promise.resolve(null)), [session?.role], 15_000);
  const [phone, setPhone] = useState(session?.phone ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');

  if (!session) return null;

  const saveProfile = async () => {
    if (name.trim().length < 2) return addNotification({ type: 'warning', message: 'Please enter your name.' });
    if (phone && !isValidPhone(phone)) return addNotification({ type: 'warning', message: 'Use international format, e.g. +919876543210' });
    setSavingProfile(true);
    try {
      const phoneChanged = (phone || undefined) !== (session.phone || undefined);
      await updateProfile({ name: name.trim(), phone: phone || null });
      addNotification({
        type: 'success',
        message: phoneChanged && session.role === 'citizen' && trust?.phoneVerified
          ? 'Profile updated. Verify your new number before your next request.'
          : 'Profile updated.',
      });
    } catch (e) {
      addNotification({ type: 'error', message: (e as Error).message });
    } finally {
      setSavingProfile(false);
    }
  };

  const toggleLive = async () => {
    setSavingLocation(true);
    try {
      const s = await updateProfile({ liveLocation: !session.liveLocation });
      addNotification({ type: 'success', message: s.liveLocation ? 'Live location enabled for emergencies.' : 'Live location turned off. You will need to enter a location.' });
    } catch (e) {
      addNotification({ type: 'error', message: (e as Error).message });
    } finally {
      setSavingLocation(false);
    }
  };

  const savePassword = async () => {
    setPwError('');
    if (!isStrongPassword(newPw)) return setPwError('New password does not meet all the requirements.');
    if (newPw !== confirmPw) return setPwError('New passwords do not match.');
    setPwBusy(true);
    try {
      await changePassword(currentPw, newPw);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      addNotification({ type: 'success', message: 'Password changed.' });
    } catch (e) {
      setPwError((e as Error).message);
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Account Settings</h2>
        <p className="text-sm text-white/40 mt-1">Manage your profile, location preference and sign-in.</p>
      </div>

      <section className="glass-card p-5 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><UserRound size={15} className="text-red-400" /> Profile</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Full name</label>
            <input className="input-field" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Mobile number</label>
            <input className="input-field" type="tel" placeholder="+919876543210" value={phone} onChange={e => setPhone(e.target.value.replace(/\s/g, ''))} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input-field opacity-60" value={session.email} disabled />
          </div>
          <div>
            <label className="label">Signed in with</label>
            <input className="input-field opacity-60" value={session.provider === 'google' ? 'Google account' : 'Email and password'} disabled />
          </div>
        </div>
        <button onClick={saveProfile} disabled={savingProfile} className="btn-primary text-sm">
          {savingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save profile
        </button>
      </section>

      <section className="glass-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><LocateFixed size={15} className="text-red-400" /> Live location in emergencies</h3>
            <p className="text-xs text-white/50 mt-1.5 leading-relaxed max-w-xl">
              When on, you can leave the location empty while requesting help. AegisGrid uses your device's current location and keeps it
              updated for responders until help reaches you. When off, you enter or pin a location every time.
            </p>
          </div>
          <button
            onClick={toggleLive}
            disabled={savingLocation}
            role="switch"
            aria-checked={session.liveLocation}
            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors ${session.liveLocation ? 'bg-green-500' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${session.liveLocation ? 'left-6' : 'left-0.5'}`} />
          </button>
        </div>
      </section>

      {trust && (
        <section className="glass-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><BadgeCheck size={15} className="text-green-400" /> Account standing</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            {[
              ['Trust score', `${trust.trustScore}/100`],
              ['Standing', { GOOD: 'Good', WARNING: 'Warning', RESTRICTED: 'Restricted', SUSPENDED: 'Suspended' }[trust.standing]],
              ['Genuine requests', String(trust.genuineRequests)],
              ['False alarms', String(trust.falseAlarms)],
            ].map(([k, v]) => (
              <div key={k} className="p-3 rounded-lg bg-black-300 border border-white/5">
                <div className="text-[10px] uppercase tracking-wider text-white/35">{k}</div>
                <div className="text-base font-semibold text-white mt-0.5">{v}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-white/45 mt-3 leading-relaxed">
            Verified mobile: {trust.phoneVerified ? <span className="text-white/75">{trust.phone}</span> : 'not yet (asked before your first request)'}.
            Requests that responders complete raise your score. A request they find to be a false alarm lowers it; after repeated false alarms,
            fewer requests per hour are allowed. Help is never delayed because of your score.
          </p>
        </section>
      )}

      <section className="glass-card p-5 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><KeyRound size={15} className="text-red-400" /> Password</h3>
        {session.provider === 'google' ? (
          <p className="text-xs text-white/50">You sign in with Google, so your password is managed by your Google account.</p>
        ) : (
          <>
            <PasswordField label="Current password" value={currentPw} onChange={setCurrentPw} autoComplete="current-password" />
            <PasswordField label="New password" value={newPw} onChange={setNewPw} autoComplete="new-password" showRules />
            <PasswordField label="Confirm new password" value={confirmPw} onChange={setConfirmPw} autoComplete="new-password" />
            {pwError && <p className="text-xs text-red-400">{pwError}</p>}
            <button onClick={savePassword} disabled={pwBusy || !currentPw} className="btn-secondary text-sm">
              {pwBusy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Change password
            </button>
          </>
        )}
      </section>

      <ActivityLog load={accountApi.activity} requestLink={id => `/requests/${id}`} />

      <section className="glass-card p-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/requests" className="flex items-center gap-2 text-sm text-white/70 hover:text-white">
          <History size={15} className="text-red-400" /> View my request history
        </Link>
        <button onClick={() => { signOut(); navigate('/login'); }} className="btn-secondary text-sm">
          <LogOut size={14} /> Sign out
        </button>
      </section>
    </div>
  );
}
