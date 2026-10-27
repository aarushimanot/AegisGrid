import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2, Info, Loader2, LocateFixed, MailCheck, ShieldAlert, UserRound } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  completeNewPassword, confirmForgotPassword, confirmSignUp, forgotPassword, googleSignInAvailable, homeFor,
  resendCode, signIn, signUp, startGoogleSignIn,
} from '../services/auth';
import { ADMIN_LOGIN, APPLICANT_LOGIN, CITIZEN_LOGIN } from '../services/demoAuth';
import { SEED_PASSWORD, seedEmail } from '@core/vellore-stations';
import type { AccountType, Role } from '../services/auth';
import PasswordField from '../components/PasswordField';
import GoogleButton from '../components/GoogleButton';
import { isStrongPassword, isValidPhone } from '../utils/password';

type Mode = 'signin' | 'signup' | 'confirm' | 'forgot' | 'reset' | 'newPassword';

export default function AuthPage() {
  const { isLive, addNotification } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [mode, setMode] = useState<Mode>((location.state as { mode?: Mode } | null)?.mode ?? 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [liveLocation, setLiveLocation] = useState(true);
  const [accountType, setAccountType] = useState<AccountType>((location.state as { accountType?: AccountType } | null)?.accountType ?? 'citizen');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [demoCode, setDemoCode] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const go = (m: Mode) => { setMode(m); setError(''); setFieldErrors({}); setCode(''); };

  const finish = (role: Role) => {
    navigate(from && from !== '/login' ? from : homeFor(role), { replace: true });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doSignIn = () => run(async () => {
    const r = await signIn(email, password);
    if (r.status === 'CONFIRM_SIGN_UP') {
      const res = await resendCode(email);
      setDemoCode(res.demoCode);
      go('confirm');
      return;
    }
    if (r.status === 'NEW_PASSWORD_REQUIRED') {
      setChallenge(r.challengeSession);
      setPassword('');
      go('newPassword');
      return;
    }
    addNotification({ type: 'success', message: `Welcome back, ${r.session.name.split(' ')[0]}.` });
    finish(r.session.role);
  });

  const doSignUp = () => {
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Please enter your full name.';
    if (!/^\S+@\S+\.\S+$/.test(email)) errs.email = 'Enter a valid email address.';
    if (phone && !isValidPhone(phone)) errs.phone = 'Use international format, e.g. +919876543210';
    if (!isStrongPassword(password)) errs.password = 'Password does not meet all the requirements.';
    if (confirmPassword !== password) errs.confirm = 'Passwords do not match.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    return run(async () => {
      const r = await signUp({ email, password, name: name.trim(), phone: phone || undefined, liveLocation: accountType === 'citizen' && liveLocation, accountType });
      setDemoCode(r.demoCode);
      if (r.confirmationRequired) go('confirm');
      else await doSignInAfterConfirm();
    });
  };

  const doSignInAfterConfirm = async () => {
    const r = await signIn(email, password);
    if (r.status === 'SIGNED_IN') {
      addNotification({ type: 'success', message: 'Your AegisGrid account is ready.' });
      finish(r.session.role);
    } else {
      go('signin');
    }
  };

  const doConfirm = () => run(async () => {
    await confirmSignUp(email, code);
    if (password) await doSignInAfterConfirm();
    else {
      addNotification({ type: 'success', message: 'Email verified. Please sign in.' });
      go('signin');
    }
  });

  const doForgot = () => run(async () => {
    const r = await forgotPassword(email);
    setDemoCode(r.demoCode);
    setPassword('');
    go('reset');
  });

  const doReset = () => {
    if (!isStrongPassword(password)) { setFieldErrors({ password: 'Password does not meet all the requirements.' }); return; }
    return run(async () => {
      await confirmForgotPassword(email, code, password);
      addNotification({ type: 'success', message: 'Password updated. Signing you in…' });
      await doSignInAfterConfirm();
    });
  };

  const doNewPassword = () => {
    if (!isStrongPassword(password)) { setFieldErrors({ password: 'Password does not meet all the requirements.' }); return; }
    return run(async () => {
      const s = await completeNewPassword(email, password, challenge);
      finish(s.role);
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    ({ signin: doSignIn, signup: doSignUp, confirm: doConfirm, forgot: doForgot, reset: doReset, newPassword: doNewPassword })[mode]();
  };

  const title: Record<Mode, string> = {
    signin: 'Sign in to AegisGrid',
    signup: 'Create your account',
    confirm: 'Verify your email',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
    newPassword: 'Set your password',
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-[#090909]">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-10 h-10 bg-red-500 rounded-lg flex items-center justify-center">
            <ShieldAlert size={22} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-white text-xl leading-tight tracking-tight">AegisGrid</div>
            <div className="text-[10px] text-white/40 font-mono uppercase tracking-wider">AI Emergency Platform</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="glass-card p-6 space-y-5" noValidate>
          <div>
            <h1 className="text-lg font-bold text-white">{title[mode]}</h1>
            {mode === 'signin' && <p className="text-xs text-white/40 mt-1">Request emergency help and track the response in real time.</p>}
            {mode === 'signup' && <p className="text-xs text-white/40 mt-1">It takes a minute, and you'll be able to request help instantly when it matters.</p>}
          </div>

          {(mode === 'signin' || mode === 'signup') && (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-black-300 border border-white/5">
              {(['signin', 'signup'] as const).map(m => (
                <button key={m} type="button" onClick={() => go(m)}
                  className={`py-2 rounded-md text-sm font-medium transition-colors ${mode === m ? 'bg-red-500 text-white' : 'text-white/50 hover:text-white/80'}`}>
                  {m === 'signin' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
          )}

          {mode === 'signup' && (
            <div className="grid grid-cols-2 gap-2">
              {([
                { t: 'citizen' as const, label: 'Citizen', sub: 'Request emergency help', Icon: UserRound },
                { t: 'service' as const, label: 'Emergency service', sub: 'Register a station', Icon: Building2 },
              ]).map(({ t, label, sub, Icon }) => (
                <button key={t} type="button" onClick={() => setAccountType(t)}
                  className={`p-3 rounded-lg border text-left transition-colors ${accountType === t ? 'border-red-500/50 bg-red-500/10' : 'border-white/10 hover:border-white/20'}`}>
                  <Icon size={16} className={accountType === t ? 'text-red-400' : 'text-white/40'} />
                  <div className="text-sm font-semibold text-white mt-1.5">{label}</div>
                  <div className="text-[11px] text-white/40">{sub}</div>
                </button>
              ))}
            </div>
          )}
          {mode === 'signup' && accountType === 'service' && (
            <p className="text-[11px] text-white/45 leading-relaxed -mt-2">
              Service accounts go through verification: organisation and registration details, physical address, official documents, a phone code,
              and approval by the AegisGrid administrator before your station can receive requests.
            </p>
          )}

          {(mode === 'signin' || (mode === 'signup' && accountType === 'citizen')) && googleSignInAvailable() && (
            <>
              <GoogleButton onClick={() => run(startGoogleSignIn)} disabled={busy} label={mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'} />
              <div className="flex items-center gap-3 text-[11px] text-white/30">
                <div className="flex-1 h-px bg-white/10" /> or with email <div className="flex-1 h-px bg-white/10" />
              </div>
            </>
          )}

          {mode === 'signup' && (
            <div>
              <label className="label">{accountType === 'service' ? 'Your name (officer in charge)' : 'Full name'}</label>
              <input className={`input-field ${fieldErrors.name ? 'border-red-500/60' : ''}`} autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
              {fieldErrors.name && <p className="text-xs text-red-400 mt-1">{fieldErrors.name}</p>}
            </div>
          )}

          {mode !== 'newPassword' && (
            <div>
              <label className="label">Email</label>
              <input className={`input-field ${fieldErrors.email ? 'border-red-500/60' : ''}`} type="email" autoComplete="email" value={email}
                onChange={e => setEmail(e.target.value)} disabled={mode === 'confirm' || mode === 'reset'} />
              {fieldErrors.email && <p className="text-xs text-red-400 mt-1">{fieldErrors.email}</p>}
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="label">Mobile number <span className="normal-case text-white/30">(optional)</span></label>
              <input className={`input-field ${fieldErrors.phone ? 'border-red-500/60' : ''}`} type="tel" autoComplete="tel" placeholder="+919876543210" value={phone} onChange={e => setPhone(e.target.value.replace(/\s/g, ''))} />
              {fieldErrors.phone ? <p className="text-xs text-red-400 mt-1">{fieldErrors.phone}</p> : <p className="text-[11px] text-white/30 mt-1">Responders can call you back. Updates are sent here when help is dispatched.</p>}
            </div>
          )}

          {mode === 'signin' && (
            <div>
              <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
              <button type="button" onClick={() => go('forgot')} className="text-[11px] text-white/40 hover:text-red-400 mt-1.5">Forgot password?</button>
            </div>
          )}

          {(mode === 'signup' || mode === 'reset' || mode === 'newPassword') && (
            <PasswordField label={mode === 'signup' ? 'Create password' : 'New password'} value={password} onChange={setPassword}
              autoComplete="new-password" showRules error={fieldErrors.password} />
          )}

          {mode === 'signup' && (
            <PasswordField label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" error={fieldErrors.confirm} />
          )}

          {mode === 'signup' && accountType === 'citizen' && (
            <label className="flex gap-3 p-3 rounded-lg bg-black-300 border border-white/10 cursor-pointer hover:border-white/20">
              <input type="checkbox" className="mt-0.5 accent-red-500" checked={liveLocation} onChange={e => setLiveLocation(e.target.checked)} />
              <span>
                <span className="flex items-center gap-1.5 text-sm text-white font-medium"><LocateFixed size={14} className="text-red-400" /> Use my live location in an emergency</span>
                <span className="block text-[11px] text-white/45 mt-1 leading-relaxed">
                  If you don't type a location when requesting help, AegisGrid will use your device's current location and keep it updated
                  for responders until help reaches you. You can change this anytime in Account settings.
                </span>
              </span>
            </label>
          )}

          {(mode === 'confirm' || mode === 'reset') && (
            <div>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-black-300 border border-white/5 mb-3">
                <MailCheck size={16} className="text-green-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-white/60">We sent a 6-digit code to <span className="text-white">{email}</span>.</p>
              </div>
              <label className="label">Verification code</label>
              <input className="input-field tracking-[0.4em] font-mono" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
              {mode === 'confirm' && (
                <button type="button" onClick={() => run(async () => { const r = await resendCode(email); setDemoCode(r.demoCode); addNotification({ type: 'info', message: 'A new code was sent.' }); })}
                  className="text-[11px] text-white/40 hover:text-red-400 mt-1.5">Resend code</button>
              )}
            </div>
          )}

          {!isLive && demoCode && (mode === 'confirm' || mode === 'reset') && (
            <p className="text-[11px] text-yellow-400/90">Demo mode: no email is sent. Your code is <span className="font-mono font-bold">{demoCode}</span>.</p>
          )}

          {mode === 'forgot' && <p className="text-xs text-white/50">Enter your account email and we'll send you a code to reset your password.</p>}
          {mode === 'newPassword' && <p className="text-xs text-white/50">Your administrator created this account. Choose your own password to continue.</p>}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
            {busy && <Loader2 size={16} className="animate-spin" />}
            {{ signin: 'Sign in', signup: 'Create account', confirm: 'Verify email', forgot: 'Send code', reset: 'Update password', newPassword: 'Set password' }[mode]}
          </button>

          {(mode === 'confirm' || mode === 'forgot' || mode === 'reset') && (
            <button type="button" onClick={() => go('signin')} className="w-full text-xs text-white/40 hover:text-white/70">Back to sign in</button>
          )}
        </form>

        {!isLive && mode === 'signin' && (
          <div className="mt-4 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 text-[11px] text-white/50 leading-relaxed">
            <div className="flex items-center gap-1.5 text-yellow-400 font-medium mb-1"><Info size={12} /> Demo mode</div>
            Data is shared by every tab of this browser, and each tab keeps its own sign-in, so you can open the citizen, a station and the admin side by side. Click to fill in:
            {[
              { label: 'Admin (platform owner)', ...ADMIN_LOGIN },
              { label: 'Citizen', ...CITIZEN_LOGIN },
              { label: 'Katpadi Fire Station', email: seedEmail('katpadi-fire'), password: SEED_PASSWORD },
              { label: 'Vellore Fire Station', email: seedEmail('vellore-fire'), password: SEED_PASSWORD },
              { label: '108 Ambulance, Katpadi', email: seedEmail('katpadi-108'), password: SEED_PASSWORD },
              { label: 'CMC Emergency', email: seedEmail('cmc-er'), password: SEED_PASSWORD },
              { label: 'Station awaiting approval', ...APPLICANT_LOGIN },
            ].map(s => (
              <button key={s.email} type="button" onClick={() => { setEmail(s.email); setPassword(s.password); }}
                className="flex w-full justify-between gap-2 mt-1 font-mono text-white/70 hover:text-white">
                <span className="font-sans">{s.label}</span><span>{s.email}</span>
              </button>
            ))}
            <p className="mt-1.5">Every station login uses the password <span className="font-mono text-white/70">{SEED_PASSWORD}</span>.</p>
          </div>
        )}
      </div>
    </div>
  );
}
