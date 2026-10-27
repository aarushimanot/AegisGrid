// Citizen: request emergency help.
//
// The citizen never picks a service. They describe what is happening (text,
// photos, video, voice note); AegisGrid's AI works out the emergency type and
// activates the right agents. Location is typed, or, if left blank and the
// citizen allowed it, taken from the device and kept updated live.
//
// Misuse protection: a verified mobile number is required once, the citizen
// confirms a legal declaration, and each photo records whether it was taken
// live or picked from the gallery, plus its EXIF capture time and GPS.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import exifr from 'exifr';
import { AlertTriangle, Ban, Camera, FlaskConical, Image as ImageIcon, Loader2, LocateFixed, MapPin, Mic, MicOff, Pause, Play, Shield, Upload, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import PhoneVerifyCard from '../components/PhoneVerifyCard';
import { citizenApi, errorCode } from '../services/api';
import type { ApiProfile, MediaMeta } from '../services/apiTypes';
import { SCENARIOS, type Scenario } from '../data/scenarios';
import { SUPPORTED_UPLOAD_TYPES, baseContentType } from '../services/aegisApi';
import { formatCoords, geocodeAddress } from '../utils/geocode';
import { generateId } from '../utils/helpers';

interface Evidence {
  id: string;
  file: File;
  url: string;
  kind: 'image' | 'video' | 'audio';
  meta: MediaMeta;
}

/** Camera or gallery, plus the capture time and GPS from the photo's EXIF data (if present). */
async function readMeta(file: File, source: 'camera' | 'gallery'): Promise<MediaMeta> {
  const meta: MediaMeta = { source };
  if (file.type.startsWith('image')) {
    try {
      const tags = await exifr.parse(file, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'] }) as
        { DateTimeOriginal?: Date; CreateDate?: Date; latitude?: number; longitude?: number } | undefined;
      const taken = tags?.DateTimeOriginal ?? tags?.CreateDate;
      if (taken instanceof Date && !Number.isNaN(taken.getTime())) meta.capturedAt = taken.toISOString();
      if (typeof tags?.latitude === 'number' && typeof tags?.longitude === 'number') meta.location = { lat: tags.latitude, lon: tags.longitude };
    } catch {
      // no EXIF: the credibility check notes it for gallery uploads
    }
  }
  // A live capture is new by definition, even when the browser strips EXIF.
  if (source === 'camera' && !meta.capturedAt) meta.capturedAt = new Date(file.lastModified || Date.now()).toISOString();
  return meta;
}

/** Device position, only if the citizen already allowed location (never prompts). */
async function silentDevicePosition(): Promise<{ lat: number; lon: number } | undefined> {
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (perm?.state !== 'granted') return undefined;
    const pos = await currentPosition(5_000);
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch {
    return undefined;
  }
}

function currentPosition(timeoutMs = 12_000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device.'));
    navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Could not get your location. Please allow location access or type where you need help.')), {
      enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000,
    });
  });
}

export default function ReportPage() {
  const { session, addNotification, isLive } = useApp();
  const navigate = useNavigate();
  const liveConsent = !!session?.liveLocation;

  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [pinned, setPinned] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [recording, setRecording] = useState(false);
  const [voice, setVoice] = useState<{ blob: Blob; url: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [declared, setDeclared] = useState(false);
  const [profile, setProfile] = useState<ApiProfile | null>(null);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    citizenApi.profile().then(setProfile).catch(e => setProfileError((e as Error).message));
  }, []);

  const applyScenario = (sc: Scenario) => {
    setScenario(sc);
    setDescription(sc.description);
    setAddress(sc.address);
    setPinned(sc.location);
    setErrors({});
  };

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const maxFiles = voice ? 4 : 5;

  const onFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>, source: 'camera' | 'gallery') => {
    const all = Array.from(e.target.files ?? []);
    e.target.value = '';
    const ok = all.filter(f => SUPPORTED_UPLOAD_TYPES.includes(baseContentType(f.type)));
    if (ok.length < all.length) addNotification({ type: 'warning', message: 'Some files were skipped. Supported: JPG, PNG, MP4 and WebM.' });
    const items = await Promise.all(ok.map(async f => ({
      id: generateId(), file: f, url: URL.createObjectURL(f), meta: await readMeta(f, source),
      kind: (f.type.startsWith('image') ? 'image' : f.type.startsWith('video') ? 'video' : 'audio') as Evidence['kind'],
    })));
    setEvidence(prev => [...prev, ...items].slice(0, maxFiles));
    setErrors(er => ({ ...er, evidence: '' }));
  }, [addNotification, maxFiles]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = e => chunksRef.current.push(e.data);
      mr.onstop = () => {
        // Safari records audio/mp4, Chrome/Firefox audio/webm; keep the real type for transcription.
        const blob = new Blob(chunksRef.current, { type: baseContentType(mr.mimeType || 'audio/webm') });
        setVoice({ blob, url: URL.createObjectURL(blob) });
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setRecording(true);
    } catch {
      addNotification({ type: 'error', message: 'Microphone access denied. Please allow microphone access.' });
    }
  }, [addNotification]);

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); } else { audioRef.current.play(); setPlaying(true); }
  };

  const pinCurrentLocation = async () => {
    setLocating(true);
    try {
      const pos = await currentPosition();
      setPinned({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      if (!address) setAddress(`${formatCoords(pos.coords.latitude, pos.coords.longitude)} (pinned)`);
      setErrors(e => ({ ...e, location: '' }));
    } catch (err) {
      addNotification({ type: 'warning', message: (err as Error).message });
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    const hasMedia = evidence.length > 0 || !!voice || !!scenario?.simulated;
    if (!hasMedia && description.trim().length < 10) errs.evidence = 'Provide at least one: a written description (10+ characters), a photo, a video or a voice note.';
    if (!address.trim() && !pinned && !liveConsent) errs.location = 'Enter where you need help, or pin your current location.';
    if (!declared) errs.declaration = 'Please confirm the declaration to send your request.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      let location = pinned;
      let locationSource: 'manual' | 'gps' = 'manual';
      if (!location && address.trim()) {
        setProgress('Finding the address…');
        location = await geocodeAddress(address.trim());
        if (!location) {
          setErrors({ location: 'We could not find that address. Add more detail or pin your current location.' });
          return;
        }
      }
      if (!location) {
        // Nothing typed and live location allowed: use the device and keep it updated.
        setProgress('Getting your live location…');
        const pos = await currentPosition();
        location = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        locationSource = 'gps';
      }
      // A typed location is compared with where the device actually is (never prompts for permission).
      const deviceLocation = locationSource === 'gps' ? undefined : pinned ?? await silentDevicePosition();
      const files: Blob[] = [...evidence.map(e => e.file), ...(voice ? [voice.blob] : [])];
      const meta: MediaMeta[] = [...evidence.map(e => e.meta), ...(voice ? [{ source: 'recording' as const, capturedAt: new Date().toISOString() }] : [])];
      const id = await citizenApi.requestHelp({
        description: description.trim(), location, address: address.trim() || undefined, locationSource, files, meta, deviceLocation,
        declarationAccepted: true,
        simulated: scenario && description === scenario.description ? scenario.simulated : undefined,
      }, setProgress);
      addNotification({ type: 'success', message: 'Help requested. Our agents are on it.' });
      navigate(`/requests/${id}`, { state: { justRequested: true } });
    } catch (err) {
      const code = errorCode(err);
      if (code === 'PHONE_NOT_VERIFIED') setProfile(p => (p ? { ...p, phoneVerified: false } : p));
      if (code === 'SUSPENDED') setProfile(p => (p ? { ...p, standing: 'SUSPENDED' } : p));
      if (code === 'RATE_LIMITED') setErrors({ submit: (err as Error).message });
      else addNotification({ type: 'error', message: (err as Error).message || 'Request failed. Please try again.' });
    } finally {
      setSubmitting(false);
      setProgress('');
    }
  };

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto glass-card p-10 flex flex-col items-center gap-3 text-sm text-white/50">
        {profileError ? <><AlertTriangle size={22} className="text-red-400" />{profileError}<span className="text-xs text-white/35">In an emergency call 112.</span></> : <Loader2 size={22} className="animate-spin text-red-400" />}
      </div>
    );
  }
  if (profile.standing === 'SUSPENDED') {
    return (
      <div className="max-w-3xl mx-auto glass-card p-8 text-center space-y-3">
        <Ban size={30} className="text-red-400 mx-auto" />
        <h2 className="text-lg font-bold text-white">Requests are suspended on this account</h2>
        <p className="text-sm text-white/50 max-w-md mx-auto">Several requests from this account were reported by responders as false alarms. If this is a mistake, contact the AegisGrid administrator.</p>
        <p className="text-sm text-white/80">In an emergency, call <span className="font-bold text-red-400">112</span> directly.</p>
      </div>
    );
  }
  if (!profile.phoneVerified) {
    return <div className="max-w-3xl mx-auto"><PhoneVerifyCard onVerified={setProfile} /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      {profile.standing !== 'GOOD' && (
        <div className="mb-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-xs text-yellow-200 flex items-start gap-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            {profile.falseAlarms} earlier request{profile.falseAlarms === 1 ? ' was' : 's were'} reported as false alarm{profile.falseAlarms === 1 ? '' : 's'}.
            {profile.standing === 'RESTRICTED' ? ' This account is limited to 1 request per hour, and' : ' Requests are still sent at once, but'} responders are told about earlier false alarms.
          </span>
        </div>
      )}
      <div className="glass-card p-6 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-white/5">
          <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center">
            <AlertTriangle size={20} className="text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Request Emergency Help</h2>
            <p className="text-xs text-white/40">Tell us what's happening. AegisGrid identifies the emergency and sends the right services automatically.</p>
          </div>
        </div>

        {/* Presentation scenarios */}
        <div className="p-3.5 rounded-xl border border-purple-500/20 bg-purple-500/5">
          <div className="flex items-center gap-2 text-xs font-semibold text-purple-300 mb-2"><FlaskConical size={13} /> Demonstration scenarios</div>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIOS.map(sc => (
              <button key={sc.id} type="button" onClick={() => applyScenario(sc)}
                className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${scenario?.id === sc.id ? 'border-purple-400/60 bg-purple-500/20 text-white' : 'border-white/10 text-white/60 hover:text-white hover:border-white/25'}`}>
                {sc.title}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-white/35 mt-2 leading-relaxed">
            {scenario
              ? `Simulated evidence: ${scenario.evidence}.${!isLive && scenario.simulated?.labels ? ` The AI vision step will detect: ${scenario.simulated.labels.join(', ')}.` : ''}${!isLive && scenario.simulated?.transcript ? ' The voice note is transcribed and translated by the AI.' : ''}`
              : 'Fills in a realistic report so the full workflow can be shown without real emergency photos.'}
          </p>
        </div>

        {/* What is happening */}
        <div>
          <div className={`mb-4 p-3 rounded-lg border text-xs flex items-start gap-2 ${errors.evidence ? 'border-red-500/50 bg-red-500/10 text-red-300' : 'border-white/10 bg-black-300 text-white/55'}`}>
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{errors.evidence ?? 'Provide at least one of the four: a written description, a photo, a video or a voice note. More evidence helps the AI send the right help faster.'}</span>
          </div>
          <label className="label">Describe what's happening</label>
          <textarea
            className={`input-field resize-none h-32 ${errors.description ? 'border-red-500/60' : ''}`}
            placeholder="For example: a car hit a bike near the bus stand, one person is bleeding and not responding."
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          {errors.description && <span className="text-xs text-red-400">{errors.description}</span>}
          <p className="text-[11px] text-white/30 mt-1">You can write in any language. Short on time? Just record a voice note below.</p>
        </div>

        {/* Evidence */}
        <div>
          <label className="label">Photos or videos</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={evidence.length >= maxFiles} onClick={() => cameraInputRef.current?.click()}
              className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center hover:border-red-500/30 transition-all disabled:opacity-40">
              <Camera size={22} className="text-red-400/80 mx-auto mb-1.5" />
              <p className="text-sm text-white/70">Take photo or video</p>
              <p className="text-[11px] text-white/35 mt-0.5">Live from the camera (most trusted)</p>
            </button>
            <button type="button" disabled={evidence.length >= maxFiles} onClick={() => galleryInputRef.current?.click()}
              className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center hover:border-white/25 transition-all disabled:opacity-40">
              <ImageIcon size={22} className="text-white/30 mx-auto mb-1.5" />
              <p className="text-sm text-white/70">Upload from gallery</p>
              <p className="text-[11px] text-white/35 mt-0.5">Recent photos only</p>
            </button>
          </div>
          <p className="text-xs text-white/30 mt-1.5">Up to {maxFiles} files · JPG, PNG, MP4. The capture time and place of each photo are checked against your report.</p>
          <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,video/mp4,video/webm" capture="environment" className="hidden" onChange={e => onFiles(e, 'camera')} />
          <input ref={galleryInputRef} type="file" multiple accept="image/jpeg,image/png,video/mp4,video/webm" className="hidden" onChange={e => onFiles(e, 'gallery')} />
          {evidence.length > 0 && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {evidence.map(f => (
                <div key={f.id} className="relative rounded-lg overflow-hidden bg-black-300 border border-white/10">
                  {f.kind === 'image'
                    ? <img src={f.url} alt={f.file.name} className="w-full h-24 object-cover" />
                    : <div className="w-full h-24 flex items-center justify-center gap-2 px-2"><Upload size={18} className="text-white/40" /><span className="text-xs text-white/40 truncate">{f.file.name}</span></div>}
                  <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/75 text-[9px] text-white/75">
                    {f.meta.source === 'camera' ? 'Camera' : 'Gallery'}{f.meta.capturedAt ? ` · ${new Date(f.meta.capturedAt).toLocaleDateString()}` : ' · no capture date'}
                  </span>
                  <button onClick={() => setEvidence(prev => prev.filter(x => x.id !== f.id))}
                    className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/80 rounded-full flex items-center justify-center hover:bg-red-500 transition-colors" aria-label="Remove">
                    <X size={12} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Voice */}
        <div>
          <label className="label">Voice note</label>
          <div className="flex items-center gap-3">
            <button
              onClick={recording ? stopRecording : startRecording}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all ${recording ? 'bg-red-500 text-white animate-pulse' : 'bg-black-300 border border-white/10 text-white/70 hover:border-white/20'}`}
            >
              {recording ? <MicOff size={15} /> : <Mic size={15} className="text-red-400" />}
              {recording ? 'Stop recording' : voice ? 'Record again' : 'Record voice note'}
            </button>
            {recording && <span className="flex items-center gap-2 text-sm text-red-400"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Recording…</span>}
            {voice && !recording && (
              <div className="flex items-center gap-2 flex-1">
                <button onClick={togglePlayback} className="w-8 h-8 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center" aria-label="Play voice note">
                  {playing ? <Pause size={13} className="text-green-400" /> : <Play size={13} className="text-green-400" />}
                </button>
                <span className="text-xs text-green-400">Voice note attached</span>
                <button onClick={() => setVoice(null)} className="text-xs text-white/40 hover:text-red-400 ml-2">Remove</button>
                <audio ref={audioRef} src={voice.url} onEnded={() => setPlaying(false)} />
              </div>
            )}
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="label">Where do you need help?</label>
          <div className="relative">
            <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              className={`input-field pl-9 ${errors.location ? 'border-red-500/60' : ''}`}
              placeholder={liveConsent ? 'Address or landmark (leave empty to use your live location)' : 'Address or landmark'}
              value={address}
              onChange={e => { setAddress(e.target.value); setPinned(null); }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <button onClick={pinCurrentLocation} disabled={locating} className="btn-secondary text-xs">
              {locating ? <Loader2 size={13} className="animate-spin" /> : <LocateFixed size={13} className="text-red-400" />}
              {pinned ? 'Location pinned' : 'Pin my current location'}
            </button>
            {liveConsent && !address && !pinned && (
              <span className="text-[11px] text-green-400/90 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Your live location will be used and kept updated until help reaches you.
              </span>
            )}
          </div>
          {errors.location && <p className="text-xs text-red-400 mt-1.5">{errors.location}</p>}
          {!liveConsent && !errors.location && (
            <p className="text-[11px] text-white/30 mt-1.5">Tip: allow live location in Account settings, so in a hurry you can leave this empty.</p>
          )}
        </div>

        <div className="p-4 rounded-lg bg-black-300 border border-white/5 flex items-start gap-2">
          <Shield size={15} className="text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-white/50 leading-relaxed">
            Your request goes straight to AegisGrid's emergency agents. Only the services handling it can see your details and location.
            For immediate danger to life you can also call <span className="text-white/80 font-medium">112</span>.
          </p>
        </div>

        <label className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer ${errors.declaration ? 'border-red-500/50 bg-red-500/10' : 'border-white/10 bg-black-300'}`}>
          <input type="checkbox" checked={declared} onChange={e => { setDeclared(e.target.checked); setErrors(er => ({ ...er, declaration: '' })); }} className="mt-0.5 accent-red-500" />
          <span className="text-xs text-white/65 leading-relaxed">
            I confirm this is a genuine emergency and the information is true to the best of my knowledge. I understand that knowingly
            giving false information to public servants is an offence under Section 217 of the Bharatiya Nyaya Sanhita (formerly IPC 182),
            and that false alarms are recorded against my verified number.
          </span>
        </label>
        {errors.declaration && <p className="text-xs text-red-400 -mt-4">{errors.declaration}</p>}
        {errors.submit && <p className="text-xs text-red-300 p-3 rounded-lg border border-red-500/40 bg-red-500/10">{errors.submit}</p>}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full py-4 bg-red-500 hover:bg-red-600 text-white font-bold text-base rounded-xl transition-all duration-200 flex items-center justify-center gap-3 disabled:opacity-60 active:scale-[0.99] shadow-[0_0_20px_rgba(229,9,20,0.3)] hover:shadow-[0_0_30px_rgba(229,9,20,0.5)]"
        >
          {submitting ? <><Loader2 size={20} className="animate-spin" />{progress || 'Sending request…'}</> : <><AlertTriangle size={20} />REQUEST HELP NOW</>}
        </button>
      </div>
    </div>
  );
}
