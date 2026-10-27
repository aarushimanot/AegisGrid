// Emergency service station registration: a strict, multi-step verification
// before a station can receive requests.
//   1 Service type → 2 Organisation & registration → 3 Physical address & capacity
//   → 4 Official documents → 5 Phone verification code → 6 Declaration & submit
//   → admin review (approve / reject). Only approved stations go live.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, BadgeCheck, Building2, Check, CircleAlert, Clock, FileCheck2, FileUp, Loader2, MapPin, Phone, Search, ShieldCheck, X,
} from 'lucide-react';
import { SERVICES, SERVICE_LIST, isValidRegistration } from '@core/catalog';
import { useApp } from '../context/AppContext';
import { useLive } from '../hooks/useLive';
import { stationApi } from '../services/api';
import { refreshSession } from '../services/auth';
import type { ApiStation, DocumentKind, ServiceType, StationApplicationInput } from '../services/apiTypes';
import { KIND } from '../components/LiveMap';
import PinMap from '../components/PinMap';
import { geocodeAddress } from '../utils/geocode';
import { isValidPhone } from '../utils/password';
import { formatDateTime } from '../utils/helpers';

const STEPS = ['Service type', 'Organisation', 'Address & capacity', 'Documents', 'Phone verification', 'Declaration'];
const DOCS: { kind: DocumentKind; label: string; hint: string }[] = [
  { kind: 'REGISTRATION_CERTIFICATE', label: 'Registration certificate', hint: 'Issued by the authority named in step 2' },
  { kind: 'AUTHORITY_LETTER', label: 'Authority letter', hint: 'On official letterhead, authorising this account to operate the station' },
  { kind: 'OFFICER_ID', label: 'Officer-in-charge ID', hint: 'Government or departmental photo ID of the contact person' },
];

const empty = (email: string): StationApplicationInput => ({
  serviceType: 'AMBULANCE', name: '', registrationNumber: '', issuingAuthority: SERVICES.AMBULANCE.registration.authority,
  contactPerson: { name: '', designation: '' }, phone: '', officialEmail: email, address: '', location: { lat: 0, lon: 0 }, unitsTotal: 1, coverageKm: 25,
});

export default function ServiceRegisterPage() {
  const { session, addNotification, isLive } = useApp();
  const navigate = useNavigate();
  const { data: station, reload } = useLive(() => stationApi.me(), [], 4000);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<StationApplicationInput>(() => empty(session?.email ?? ''));
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [declared, setDeclared] = useState(false);
  const [locating, setLocating] = useState(false);

  // Load an existing draft / rejected application into the form once.
  useEffect(() => {
    if (loaded || station === undefined) return;
    if (station) {
      setForm({
        serviceType: station.serviceType, name: station.name, registrationNumber: station.registrationNumber, issuingAuthority: station.issuingAuthority,
        contactPerson: station.contactPerson, phone: station.phone, officialEmail: station.officialEmail, address: station.address,
        location: station.location, unitsTotal: station.unitsTotal, coverageKm: station.coverageKm,
      });
      const v = station.verification;
      setStep(!v.documents.length ? 3 : !v.phoneVerified ? 4 : 5);
    }
    setLoaded(true);
  }, [station, loaded]);

  // Approved by the admin: pick up the new role and open the station console.
  useEffect(() => {
    if (station?.status === 'APPROVED') {
      refreshSession().then(s => {
        if (s?.role === 'service') {
          addNotification({ type: 'success', message: 'Your station has been verified and is now live.' });
          navigate('/station', { replace: true });
        }
      });
    }
  }, [station?.status, navigate, addNotification]);

  const set = <K extends keyof StationApplicationInput>(k: K, v: StationApplicationInput[K]) => setForm(f => ({ ...f, [k]: v }));
  const regOk = form.registrationNumber ? isValidRegistration(form.serviceType, form.registrationNumber) : false;
  const info = SERVICES[form.serviceType];

  const stepValid = useMemo(() => [
    true,
    form.name.trim().length >= 3 && regOk && form.issuingAuthority.trim().length >= 3 && form.contactPerson.name.trim().length >= 2 &&
      form.contactPerson.designation.trim().length >= 2 && isValidPhone(form.phone) && /^\S+@\S+\.\S+$/.test(form.officialEmail),
    form.address.trim().length >= 10 && form.location.lat !== 0 && form.unitsTotal >= 1,
  ], [form, regOk]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const saveDetails = () => run('save', async () => {
    await stationApi.saveApplication(form);
    await reload();
    setStep(3);
  });

  const findAddress = async () => {
    setLocating(true);
    const p = await geocodeAddress(form.address);
    setLocating(false);
    if (p) set('location', p);
    else addNotification({ type: 'warning', message: 'Address not found. Click the map to place the pin.' });
  };

  const upload = (kind: DocumentKind, file: File) => run(`doc-${kind}`, async () => {
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) throw new Error('Upload a PDF, JPG or PNG file.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Files must be under 10 MB.');
    await stationApi.uploadDocuments([{ file, kind }]);
    await reload();
  });

  // ── status screens ────────────────────────────────────────────────────────
  if (station === undefined) return <div className="flex justify-center py-20"><Loader2 size={26} className="animate-spin text-red-400" /></div>;

  if (station && (station.status === 'PENDING_REVIEW' || station.status === 'APPROVED' || station.status === 'SUSPENDED')) {
    return <StatusScreen station={station} />;
  }

  const docs = station?.verification.documents ?? [];
  const phoneVerified = !!station?.verification.phoneVerified;

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Register your emergency service</h2>
        <p className="text-sm text-white/40 mt-1">Every station is verified before it receives requests, to make sure only legitimate services respond to citizens.</p>
      </div>

      {station?.status === 'REJECTED' && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3">
          <CircleAlert size={18} className="text-red-400 mt-0.5" />
          <div className="text-sm text-white/80">
            Your previous application was not approved{station.verification.reviewNote ? `: ${station.verification.reviewNote}` : '.'} Correct the details and submit again.
          </div>
        </div>
      )}

      {/* stepper */}
      <div className="grid grid-cols-6 gap-2">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <button key={label} disabled={i > step || (i >= 3 && !station)} onClick={() => setStep(i)} className="text-left disabled:cursor-not-allowed">
              <div className={`h-1.5 rounded-full ${done ? 'bg-green-500' : current ? 'bg-red-500' : 'bg-white/10'}`} />
              <div className={`text-[11px] mt-1.5 ${current ? 'text-white' : done ? 'text-white/60' : 'text-white/30'}`}>{i + 1}. {label}</div>
            </button>
          );
        })}
      </div>

      <div className="glass-card p-6 space-y-5">
        {step === 0 && (
          <>
            <h3 className="text-base font-semibold text-white">Which emergency service are you?</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {SERVICE_LIST.map(s => {
                const { Icon, color } = KIND[s.type];
                const active = form.serviceType === s.type;
                return (
                  <button key={s.type} onClick={() => setForm(f => ({ ...f, serviceType: s.type as ServiceType, issuingAuthority: s.registration.authority }))}
                    className={`p-3.5 rounded-xl border text-left transition-all ${active ? 'border-red-500/50 bg-red-500/10' : 'border-white/10 hover:border-white/20'}`}>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-2" style={{ background: `${color}1a` }}><Icon size={17} style={{ color }} /></div>
                    <div className="text-sm font-semibold text-white">{s.name}</div>
                    <div className="text-[11px] text-white/45 mt-1 leading-relaxed">{s.description}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-white/40">For example, both Vellore and Katpadi fire stations register under Fire &amp; Rescue. Citizens are automatically routed to the nearest one.</p>
          </>
        )}

        {step === 1 && (
          <>
            <h3 className="text-base font-semibold text-white">Organisation and registration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Station / unit name"><input className="input-field" value={form.name} onChange={e => set('name', e.target.value)} placeholder={`e.g. Katpadi ${info.name} Station`} /></Field>
              <Field label={info.registration.label} error={form.registrationNumber && !regOk ? `Format: ${info.registration.example}` : undefined}>
                <input className="input-field font-mono uppercase" value={form.registrationNumber} onChange={e => set('registrationNumber', e.target.value.toUpperCase())} placeholder={info.registration.example} />
              </Field>
              <Field label="Issuing authority"><input className="input-field" value={form.issuingAuthority} onChange={e => set('issuingAuthority', e.target.value)} /></Field>
              <Field label="Official email"><input className="input-field" type="email" value={form.officialEmail} onChange={e => set('officialEmail', e.target.value)} /></Field>
              <Field label="Officer in charge"><input className="input-field" value={form.contactPerson.name} onChange={e => set('contactPerson', { ...form.contactPerson, name: e.target.value })} /></Field>
              <Field label="Designation"><input className="input-field" value={form.contactPerson.designation} onChange={e => set('contactPerson', { ...form.contactPerson, designation: e.target.value })} placeholder="e.g. Station Officer" /></Field>
              <Field label="Station phone (24×7)" error={form.phone && !isValidPhone(form.phone) ? 'International format, e.g. +919840000201' : undefined}>
                <input className="input-field" type="tel" value={form.phone} onChange={e => set('phone', e.target.value.replace(/\s/g, ''))} placeholder="+919840000201" />
              </Field>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h3 className="text-base font-semibold text-white">Physical address and capacity</h3>
            <p className="text-xs text-white/45 -mt-3">Requests are routed by distance from this exact location, so place the pin on your station's gate.</p>
            <Field label="Full address">
              <div className="flex gap-2">
                <input className="input-field" value={form.address} onChange={e => set('address', e.target.value)} placeholder="Building, street, area, city, PIN" />
                <button onClick={findAddress} disabled={locating || form.address.length < 5} className="btn-secondary text-sm whitespace-nowrap">
                  {locating ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find
                </button>
              </div>
            </Field>
            <PinMap value={form.location.lat ? form.location : undefined} onChange={p => set('location', p)} />
            <p className="text-[11px] text-white/40 flex items-center gap-1.5"><MapPin size={11} /> {form.location.lat ? `${form.location.lat.toFixed(5)}, ${form.location.lon.toFixed(5)}` : 'Click the map to place your station'}</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label={`Number of ${info.unitLabel}`}><input className="input-field" type="number" min={1} max={500} value={form.unitsTotal} onChange={e => set('unitsTotal', Math.max(1, Number(e.target.value) || 1))} /></Field>
              <Field label="Service radius (km)"><input className="input-field" type="number" min={1} max={200} value={form.coverageKm} onChange={e => set('coverageKm', Math.max(1, Number(e.target.value) || 1))} /></Field>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h3 className="text-base font-semibold text-white">Official documents</h3>
            <p className="text-xs text-white/45 -mt-3">All three are required. The administrator checks them against the registration number before approving.</p>
            <div className="space-y-3">
              {DOCS.map(d => {
                const have = docs.filter(x => x.kind === d.kind);
                return (
                  <div key={d.kind} className="p-3.5 rounded-lg bg-black-300 border border-white/5 flex items-center gap-3">
                    {have.length ? <FileCheck2 size={18} className="text-green-400" /> : <FileUp size={18} className="text-white/30" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white">{d.label}</div>
                      <div className="text-[11px] text-white/40">{have.length ? have.map(h => h.name).join(', ') : d.hint}</div>
                    </div>
                    <label className="btn-secondary text-xs cursor-pointer">
                      {busy === `doc-${d.kind}` ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />} {have.length ? 'Replace' : 'Upload'}
                      <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(d.kind, f); e.target.value = ''; }} />
                    </label>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-white/30">PDF, JPG or PNG, up to 10 MB each. Documents are stored privately and only the administrator can view them.</p>
          </>
        )}

        {step === 4 && (
          <>
            <h3 className="text-base font-semibold text-white">Verify the station phone</h3>
            {phoneVerified ? (
              <p className="text-sm text-green-400 flex items-center gap-2"><ShieldCheck size={16} /> {form.phone} verified</p>
            ) : (
              <>
                <p className="text-xs text-white/50 -mt-3">We send a one-time code to {form.phone}. Citizens and the control room will reach your station on this number.</p>
                <div className="flex gap-2 items-end">
                  <button className="btn-secondary text-sm" disabled={busy === 'otp'} onClick={() => run('otp', async () => {
                    const r = await stationApi.sendPhoneOtp();
                    setDevCode(r.devCode);
                    addNotification({ type: 'info', message: r.channel === 'sms' ? 'Code sent by SMS.' : r.channel === 'email' ? `Code sent to ${form.officialEmail}.` : 'Code generated.' });
                  })}>
                    {busy === 'otp' ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />} Send code
                  </button>
                  <input className="input-field font-mono tracking-[0.4em] w-40" inputMode="numeric" maxLength={6} placeholder="••••••" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
                  <button className="btn-primary text-sm" disabled={code.length !== 6 || busy === 'verify'} onClick={() => run('verify', async () => {
                    await stationApi.verifyPhone(code);
                    await reload();
                    setCode('');
                  })}>
                    {busy === 'verify' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Verify
                  </button>
                </div>
                {devCode && <p className="text-[11px] text-yellow-400/90">{isLive ? 'No SMS/email channel is configured on this deployment, so the code is shown here' : 'Demo mode: no SMS is sent'}. Your code is <span className="font-mono font-bold">{devCode}</span>.</p>}
              </>
            )}
          </>
        )}

        {step === 5 && (
          <>
            <h3 className="text-base font-semibold text-white">Declaration</h3>
            <ul className="space-y-1.5 text-xs">
              {[
                ['Service type and organisation details', !!station],
                ['Physical address pinned on the map', !!station?.location.lat],
                ['Registration certificate', docs.some(d => d.kind === 'REGISTRATION_CERTIFICATE')],
                ['Authority letter', docs.some(d => d.kind === 'AUTHORITY_LETTER')],
                ['Officer-in-charge ID', docs.some(d => d.kind === 'OFFICER_ID')],
                ['Station phone verified', phoneVerified],
              ].map(([label, ok]) => (
                <li key={label as string} className={`flex items-center gap-2 ${ok ? 'text-green-400' : 'text-red-300'}`}>{ok ? <Check size={13} /> : <X size={13} />} {label}</li>
              ))}
            </ul>
            <label className="flex gap-3 p-3.5 rounded-lg bg-black-300 border border-white/10 cursor-pointer">
              <input type="checkbox" className="mt-0.5 accent-red-500" checked={declared} onChange={e => setDeclared(e.target.checked)} />
              <span className="text-xs text-white/65 leading-relaxed">
                I declare that I am authorised to register <b className="text-white">{form.name || 'this station'}</b> as a {info.name} service, that the information
                and documents provided are genuine, and that this station will respond to emergency requests it accepts. I understand that false information
                leads to rejection or suspension and may be reported to the authorities.
              </span>
            </label>
          </>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-between pt-2 border-t border-white/5">
          <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} className="btn-secondary text-sm"><ArrowLeft size={14} /> Back</button>
          {step < 2 && <button onClick={() => setStep(s => s + 1)} disabled={!stepValid[step]} className="btn-primary text-sm">Continue <ArrowRight size={14} /></button>}
          {step === 2 && (
            <button onClick={saveDetails} disabled={!stepValid[2] || busy === 'save'} className="btn-primary text-sm">
              {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : null} Save and continue <ArrowRight size={14} />
            </button>
          )}
          {(step === 3 || step === 4) && (
            <button onClick={() => setStep(s => s + 1)} disabled={step === 3 ? DOCS.some(d => !docs.some(x => x.kind === d.kind)) : !phoneVerified} className="btn-primary text-sm">Continue <ArrowRight size={14} /></button>
          )}
          {step === 5 && (
            <button disabled={!declared || busy === 'submit'} className="btn-primary text-sm" onClick={() => run('submit', async () => {
              await stationApi.submit();
              await reload();
              addNotification({ type: 'success', message: 'Application submitted for verification.' });
            })}>
              {busy === 'submit' ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />} Submit for verification
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function StatusScreen({ station }: { station: ApiStation }) {
  const { Icon, color } = KIND[station.serviceType];
  const pending = station.status === 'PENDING_REVIEW';
  return (
    <div className="max-w-2xl mx-auto glass-card p-8 text-center animate-fade-in">
      <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center" style={{ background: `${color}1f` }}><Icon size={28} style={{ color }} /></div>
      <h2 className="text-xl font-bold text-white">{station.name}</h2>
      <p className="text-sm text-white/50 mt-1">{SERVICES[station.serviceType].name} · {station.registrationNumber}</p>
      {pending && (
        <>
          <div className="inline-flex items-center gap-2 mt-5 px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 text-sm"><Clock size={14} /> Under verification</div>
          <p className="text-sm text-white/60 mt-4 leading-relaxed">
            Your registration was submitted {station.verification.submittedAt ? formatDateTime(station.verification.submittedAt) : ''}. The AegisGrid administrator
            is checking your documents and registration number. This page updates by itself as soon as a decision is made.
          </p>
        </>
      )}
      {station.status === 'APPROVED' && <div className="inline-flex items-center gap-2 mt-5 text-green-400 text-sm"><Loader2 size={14} className="animate-spin" /> Approved. Opening your station console…</div>}
      {station.status === 'SUSPENDED' && (
        <p className="text-sm text-red-300 mt-5">This station has been suspended by the administrator{station.verification.reviewNote ? `: ${station.verification.reviewNote}` : '.'} Contact AegisGrid support.</p>
      )}
      <div className="mt-6 grid grid-cols-3 gap-3 text-left text-xs">
        <div className="p-3 rounded-lg bg-black-300 border border-white/5"><Building2 size={13} className="text-white/40 mb-1" />{station.address}</div>
        <div className="p-3 rounded-lg bg-black-300 border border-white/5"><Phone size={13} className="text-white/40 mb-1" />{station.phone} {station.verification.phoneVerified && <span className="text-green-400">· verified</span>}</div>
        <div className="p-3 rounded-lg bg-black-300 border border-white/5"><FileCheck2 size={13} className="text-white/40 mb-1" />{station.verification.documents.length} documents</div>
      </div>
    </div>
  );
}
