// Demo-mode backend: the complete AegisGrid workflow running in the browser on
// the backend's own domain logic (@core: triage rules, nearest-station ranking,
// offers, one-time codes, citizen view). State lives in localStorage, so every
// tab sees the same data and changes appear in other tabs instantly — a citizen,
// a fire station and the admin can be operated side by side in one presentation.

import { SERVICES, isValidRegistration } from '@core/catalog';
import { toAdminView, toCitizenView } from '@core/citizen-view';
import {
  OTP_MAX_ATTEMPTS, isIncidentFinished, minutesBetween, newOtp, offerFor, offeredAssignment, outcomeOf, rankStations, triedStationIds, unavailableAssignment,
} from '@core/core';
import { estimateEtaMinutes, haversineKm } from '@core/geo';
import { applyTrust, assessCredibility, checkRateLimit, findDuplicate, newProfile, type TrustEvent } from '@core/integrity';
import { ruleBasedAssessment } from '@core/rules';
import { toStationView } from '@core/station-view';
import type { AssignmentAttempt, CitizenProfile, GeoPoint, Incident, MediaMeta, Offer, ServiceAssignment, ServiceType, Station } from '@core/types';
import { VELLORE_STATIONS, seedEmail } from '@core/vellore-stations';
import type { Session } from './auth';
import * as demoAuth from './demoAuth';
import type { ActivityCategory, ApiActivity, ApiOverview, ApiProfile, ApiServicesCatalog, ApiTimelineEntry, ApiUser, DocumentKind, OfferAction, StandingAction, StationApplicationInput } from './apiTypes';

interface Db {
  version: 2;
  incidents: Incident[];
  stations: Station[];
  offers: Offer[];
  timeline: ApiTimelineEntry[];
  citizens: CitizenProfile[];
  /** Per-account activity history (mirrors backend/src/lib/activity.ts). */
  activity: (ApiActivity & { accountId: string })[];
}

const KEY = 'aegisgrid_demo_db_v2';
export const DB_EVENT = 'aegisgrid-demo-db';
const ANALYSIS_SECONDS = 3;

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const fail = (message: string, code?: string): never => { throw Object.assign(new Error(message), { code }); };

// ── storage ─────────────────────────────────────────────────────────────────

function read(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const db = JSON.parse(raw) as Db;
      db.citizens ??= [];
      db.activity ??= [];
      return db;
    }
  } catch {
    // fall through to seed
  }
  const db = seed();
  write(db);
  return db;
}

function write(db: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // storage full: keep running in memory
  }
  window.dispatchEvent(new Event(DB_EVENT)); // same tab; other tabs get the native "storage" event
}

/** Run a change against the latest state (also advances the simulation first). */
function mutate<T>(fn: (db: Db) => T): T {
  const db = read();
  advance(db);
  const out = fn(db);
  write(db);
  return out;
}

/** Read the latest state. Only writes (and notifies other screens) if the simulation moved on. */
function query<T>(fn: (db: Db) => T): T {
  const db = read();
  if (advance(db)) write(db);
  return fn(db);
}

/** Append to an account's activity history. */
function act(db: Db, accountId: string | undefined, category: ActivityCategory, action: string, summary: string, extra: Partial<ApiActivity> = {}) {
  if (!accountId) return;
  db.activity.push({ accountId, at: now(), category, action, summary, ...extra });
}

/** Incident timeline entry, also copied to the reporter's and the station's activity (like event-recorder.ts). */
function log(db: Db, incidentId: string, source: string, detailType: string, summary: string, detail?: Record<string, unknown>) {
  const at = now();
  db.timeline.push({ incidentId, sk: `EVENT#${at}#${uuid().slice(0, 6)}`, at, source, detailType, summary, detail });
  const reporterId = db.incidents.find(i => i.incidentId === incidentId)?.reporterId;
  const ref = ` (#${incidentId.slice(0, 8).toUpperCase()})`;
  act(db, reporterId, 'REQUEST', detailType, summary + ref, { incidentId });
  if (typeof detail?.stationId === 'string') act(db, detail.stationId, 'RESPONSE', detailType, summary + ref, { incidentId });
}

/** Profile edit (mirrors PATCH /me/account): records old → new; a new phone must be verified again. */
export function recordProfileUpdate(before: Session, after: Session) {
  const changes = [
    before.name !== after.name && `name "${before.name}" → "${after.name}"`,
    before.phone !== after.phone && (after.phone ? `phone ${before.phone ?? 'none'} → ${after.phone}` : `phone ${before.phone} removed`),
    before.liveLocation !== after.liveLocation && `live location ${after.liveLocation ? 'turned on' : 'turned off'}`,
  ].filter(Boolean);
  if (!changes.length) return;
  mutate(db => {
    const p = db.citizens.find(c => c.userId === after.userId);
    const reverify = before.phone !== after.phone && after.role === 'citizen' && !!p?.phoneVerified && p.phone !== after.phone;
    if (reverify) Object.assign(p!, { phoneVerified: false, phone: undefined, updatedAt: now() });
    act(db, after.userId, 'ACCOUNT', 'PROFILE_UPDATED', `Profile updated: ${changes.join(', ')}${reverify ? '. The new number must be verified before the next request' : ''}`);
  });
}

/** Record activity from outside the engine (demo sign-ins and sign-ups). */
export function recordDemoActivity(accountId: string, category: ActivityCategory, action: string, summary: string) {
  mutate(db => act(db, accountId, category, action, summary));
}

// ── seed data ───────────────────────────────────────────────────────────────

function seedStation(s: (typeof VELLORE_STATIONS)[number], createdAt: string): Station {
  return {
    stationId: demoAuth.stationUserId(s.key), ownerUserId: demoAuth.stationUserId(s.key), ownerEmail: seedEmail(s.key),
    serviceType: s.serviceType, name: s.name, registrationNumber: s.registrationNumber, issuingAuthority: s.issuingAuthority,
    contactPerson: s.contactPerson, phone: s.phone, officialEmail: seedEmail(s.key), address: s.address, location: s.location,
    unitsTotal: s.unitsTotal, unitsAvailable: s.unitsTotal, coverageKm: s.serviceType === 'DISASTER_RESPONSE' ? 80 : 30, onDuty: true,
    status: 'APPROVED',
    verification: {
      phoneVerified: true, declarationAccepted: true, submittedAt: createdAt, reviewedAt: createdAt, reviewedBy: demoAuth.ADMIN_LOGIN.email, reviewNote: 'Verified reference station',
      documents: [
        { key: `demo/${s.key}/registration.pdf`, name: 'Registration certificate.pdf', kind: 'REGISTRATION_CERTIFICATE', uploadedAt: createdAt },
        { key: `demo/${s.key}/authority.pdf`, name: 'Authority letter.pdf', kind: 'AUTHORITY_LETTER', uploadedAt: createdAt },
        { key: `demo/${s.key}/officer-id.jpg`, name: 'Officer ID.jpg', kind: 'OFFICER_ID', uploadedAt: createdAt },
      ],
    },
    stats: { offered: 0, accepted: 0, transferred: 0, completed: 0, totalResponseMinutes: 0 },
    createdAt, updatedAt: createdAt,
  };
}

/** Past, completed requests so dashboards and analytics have history to show. */
function seedHistory(stations: Station[]): Incident[] {
  const past: { daysAgo: number; text: string; lat: number; lon: number; address: string; response: number }[] = [
    { daysAgo: 6, text: 'Bus and bike collision near Green Circle, rider injured and bleeding.', lat: 12.9345, lon: 79.1405, address: 'Green Circle, Vellore', response: 7.4 },
    { daysAgo: 5, text: 'My father collapsed with severe chest pain and is sweating a lot.', lat: 12.9468, lon: 79.1582, address: 'Sathuvachari, Vellore', response: 6.1 },
    { daysAgo: 4, text: 'Fire in a garment shop in Long Bazaar, thick smoke, people inside.', lat: 12.9165, lon: 79.1325, address: 'Long Bazaar, Vellore', response: 8.9 },
    { daysAgo: 3, text: 'A man is stalking and harassing a girl near the college bus stop.', lat: 12.9700, lon: 79.1560, address: 'VIT Main Gate, Katpadi', response: 9.6 },
    { daysAgo: 2, text: 'Strong smell of gas, LPG cylinder leaking in a hostel kitchen.', lat: 12.9730, lon: 79.1500, address: 'Katpadi, Vellore', response: 11.2 },
    { daysAgo: 1, text: 'Car crashed into a divider on Katpadi road, driver unconscious.', lat: 12.9600, lon: 79.1450, address: 'Katpadi Road, Vellore', response: 5.8 },
  ];
  return past.map((p, i) => {
    const created = new Date(Date.now() - p.daysAgo * 86_400_000 - (i + 2) * 3_600_000);
    const createdAt = created.toISOString();
    const assessment = ruleBasedAssessment({ text: p.text, imageLabels: [] });
    const location = { lat: p.lat, lon: p.lon };
    const assignments: Incident['assignments'] = {};
    assessment.requiredAgents.forEach((type, k) => {
      const best = rankStations(stations, type, location)[0];
      if (!best) return;
      const at = (min: number) => new Date(created.getTime() + min * 60_000).toISOString();
      const response = Math.round((p.response + k * 1.3) * 10) / 10;
      assignments[type] = {
        serviceType: type, status: 'COMPLETED', offerId: uuid(), stationId: best.station.stationId, stationName: best.station.name,
        stationPhone: best.station.phone, stationAddress: best.station.address, stationLocation: best.station.location,
        distanceKm: best.distanceKm, etaMinutes: best.etaMinutes, offeredAt: at(0.2), acceptedAt: at(0.9), arrivedAt: at(response),
        completedAt: at(response + 25), responseMinutes: response, tried: k === 0 && i % 2 ? [{ stationId: 'x', stationName: 'Nearest station (all crews busy)', outcome: 'TRANSFERRED', reason: 'All crews on another call', at: at(0.5) }] : [],
        updatedAt: at(response + 25),
      };
      const st = stations.find(s => s.stationId === best.station.stationId)!;
      st.stats.offered++; st.stats.accepted++; st.stats.completed++; st.stats.totalResponseMinutes += response;
    });
    const arrivals = Object.values(assignments).map(a => a!.arrivedAt!).sort();
    const resolvedAt = Object.values(assignments).map(a => a!.completedAt!).sort().pop();
    return {
      incidentId: uuid(), status: 'RESOLVED', createdAt, updatedAt: resolvedAt ?? createdAt,
      reporter: { userId: 'demo-history', name: 'Citizen' }, reporterId: 'demo-history', description: p.text, location, address: p.address,
      locationSource: 'manual', media: [], assessment, assignments, firstArrivalAt: arrivals[0], resolvedAt,
    } satisfies Incident;
  });
}

function seed(): Db {
  const createdAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const stations = VELLORE_STATIONS.map(s => seedStation(s, createdAt));
  const t = now();
  stations.push({
    ...seedStation({ key: 'newfire', serviceType: 'FIRE', name: 'Gandhi Nagar Fire Post', registrationNumber: 'TNFRS-VLR-007', issuingAuthority: 'Tamil Nadu Fire & Rescue Services', contactPerson: { name: 'P. Venkatesh', designation: 'Leading Fireman' }, phone: '+919840000209', address: 'Gandhi Nagar Main Road, Vellore 632006', location: { lat: 12.9575, lon: 79.1360 }, unitsTotal: 1 }, t),
    stationId: 'demo-applicant', ownerUserId: 'demo-applicant', ownerEmail: demoAuth.APPLICANT_LOGIN.email, officialEmail: demoAuth.APPLICANT_LOGIN.email,
    status: 'PENDING_REVIEW', onDuty: false,
    verification: {
      phoneVerified: true, declarationAccepted: true, submittedAt: t,
      documents: [
        { key: 'demo/newfire/registration.pdf', name: 'TNFRS registration certificate.pdf', kind: 'REGISTRATION_CERTIFICATE', uploadedAt: t },
        { key: 'demo/newfire/authority.pdf', name: 'Divisional Officer authority letter.pdf', kind: 'AUTHORITY_LETTER', uploadedAt: t },
        { key: 'demo/newfire/officer-id.jpg', name: 'Leading Fireman ID card.jpg', kind: 'OFFICER_ID', uploadedAt: t },
      ],
    },
  });
  return { version: 2, incidents: seedHistory(stations), stations, offers: [], timeline: [], citizens: [], activity: [] };
}

// ── citizen trust (mirrors backend/src/lib/citizens.ts) ─────────────────────

/** The citizen's trust record, created on first use. The seeded demo citizen has a verified phone. */
function profileOf(db: Db, userId: string, session?: Session): CitizenProfile {
  let p = db.citizens.find(c => c.userId === userId);
  if (!p) {
    const demo = session?.email === demoAuth.CITIZEN_LOGIN.email;
    p = newProfile(userId, now(), { email: session?.email, name: session?.name, ...(demo ? { phone: session?.phone, phoneVerified: true } : {}) });
    db.citizens.push(p);
  }
  return p;
}

const TRUST_TEXT: Record<TrustEvent, string> = {
  GENUINE: 'Genuine request: trust increased', FALSE_ALARM: 'False alarm recorded: trust decreased',
  FALSE_ALARM_REVERSED: 'False alarm reversed', RESET: 'Trust record reset', SUSPEND: 'Requests suspended', REINSTATE: 'Requests reinstated',
};

function trust(db: Db, userId: string | undefined, event: TrustEvent, note: string, by?: string) {
  if (!userId) return;
  const prev = profileOf(db, userId);
  const next = applyTrust(prev, event, now(), note);
  db.citizens = db.citizens.map(c => (c.userId === userId ? next : c));
  act(db, userId, 'TRUST', `TRUST_${event}`, `${TRUST_TEXT[event]} (score ${prev.trustScore} → ${next.trustScore}, standing ${next.standing.toLowerCase()}). ${note}`, { by });
}

const profileView = ({ phoneOtp: _otp, ...rest }: CitizenProfile): ApiProfile => rest;

/** Resolve once every service is done; a served request earns the reporter trust. */
function finishIfDone(db: Db, incident: Incident, src: string) {
  if (!isIncidentFinished(incident) || incident.status === 'RESOLVED') return;
  const outcome = outcomeOf(incident);
  incident.status = 'RESOLVED';
  incident.resolvedAt = now();
  incident.outcome = outcome;
  log(db, incident.incidentId, src, 'Incident.Resolved', outcome === 'FALSE_ALARM' ? 'Closed as a false alarm' : 'All services completed. Incident resolved');
  if (outcome === 'SERVED') trust(db, incident.reporterId, 'GENUINE', `Request ${incident.incidentId.slice(0, 8)} served`);
}

// ── dispatch engine (mirrors backend/src/lib/dispatch.ts) ───────────────────

function offerToNearest(db: Db, incident: Incident, type: ServiceType) {
  const prev = incident.assignments[type];
  const ranked = rankStations(db.stations, type, incident.location, triedStationIds(prev));
  const t = now();
  if (!ranked.length) {
    incident.assignments[type] = unavailableAssignment(prev, type, t);
    log(db, incident.incidentId, `aegisgrid.agent.${type.toLowerCase()}`, 'Service.Unavailable', `ESCALATION: no ${SERVICES[type].name} station available, admin alerted`, { serviceType: type });
    return;
  }
  const best = ranked[0]!;
  const offer = offerFor(incident, type, best, uuid(), t);
  incident.assignments[type] = offeredAssignment(prev, type, offer, best, t);
  db.offers.push(offer);
  best.station.stats.offered++;
  log(db, incident.incidentId, `aegisgrid.agent.${type.toLowerCase()}`, 'Offer.Created', `${SERVICES[type].name} Agent offered the request to ${best.station.name} (${best.distanceKm} km)`, { serviceType: type, stationId: best.station.stationId });
}

function passOn(db: Db, incident: Incident, type: ServiceType, outcome: AssignmentAttempt['outcome'], reason: string) {
  const a = incident.assignments[type]!;
  a.tried = [...a.tried, { stationId: a.stationId!, stationName: a.stationName ?? '', outcome, reason, at: now() }];
  offerToNearest(db, incident, type);
}

/** Move the simulation forward: finish AI analysis, expire unanswered offers. Returns true if anything changed. */
function advance(db: Db): boolean {
  const t = Date.now();
  let changed = false;
  for (const inc of db.incidents) {
    if (inc.status === 'ANALYZING' && t - Date.parse(inc.createdAt) >= ANALYSIS_SECONDS * 1000) {
      const labels = (inc.analysis?.images ?? []).flatMap(i => i.labels.map(l => l.name));
      const text = [inc.description, ...(inc.analysis?.transcripts ?? []).map(x => x.text)].join(' ');
      changed = true;
      inc.assessment = ruleBasedAssessment({ text, imageLabels: labels });
      inc.status = 'ASSESSED';
      inc.updatedAt = now();
      log(db, inc.incidentId, 'aegisgrid.orchestrator', 'Incident.Assessed',
        `AI triage: ${inc.assessment.incidentType.replace('_', ' ').toLowerCase()}, severity ${inc.assessment.severity}/5 → ${inc.assessment.requiredAgents.map(a => SERVICES[a].name).join(', ')}`);

      // Misuse checks (mirrors assess-incident.ts): credibility score, then duplicates.
      const profile = inc.reporterId ? db.citizens.find(c => c.userId === inc.reporterId) : undefined;
      const hourAgo = Date.parse(inc.createdAt) - 3_600_000;
      inc.credibility = assessCredibility({
        text, imageLabels: labels, media: inc.media, incidentType: inc.assessment.incidentType, aiConfidence: inc.assessment.confidence,
        location: inc.location, locationSource: inc.locationSource ?? 'manual', deviceLocation: inc.deviceLocation, createdAt: inc.createdAt, profile,
        recentRequestCount: Math.max(0, (profile?.recentRequests ?? []).filter(r => Date.parse(r) > hourAgo).length - 1),
      });
      inc.reporterStanding = profile?.standing ?? 'GOOD';
      log(db, inc.incidentId, 'aegisgrid.orchestrator', 'Incident.Credibility',
        `Credibility ${inc.credibility.score}/100 (${inc.credibility.level.toLowerCase()})${inc.credibility.flags.length ? `: ${inc.credibility.flags.join('; ')}` : ''}`);
      const original = findDuplicate(inc, inc.assessment.incidentType, db.incidents.filter(i => i.status === 'ASSESSED' || i.status === 'DISPATCHED'));
      if (original) {
        Object.assign(inc, { duplicateOf: original.incidentId, status: 'RESOLVED', resolvedAt: now(), outcome: 'DUPLICATE' });
        log(db, inc.incidentId, 'aegisgrid.orchestrator', 'Incident.DuplicateLinked', `Same emergency already reported nearby (#${original.incidentId.slice(0, 8).toUpperCase()}); linked instead of sending more units`);
        log(db, original.incidentId, 'aegisgrid.orchestrator', 'Incident.DuplicateLinked', `Another citizen reported the same emergency (#${inc.incidentId.slice(0, 8).toUpperCase()})`);
        continue;
      }
      for (const type of inc.assessment.requiredAgents) offerToNearest(db, inc, type);
    }
  }
  for (const o of db.offers) {
    if (o.status === 'OFFERED' && Date.parse(o.expiresAt) < t) {
      changed = true;
      o.status = 'EXPIRED';
      o.updatedAt = now();
      const inc = db.incidents.find(i => i.incidentId === o.incidentId);
      const a = inc?.assignments[o.serviceType];
      if (inc && a?.offerId === o.offerId && inc.status !== 'RESOLVED') {
        log(db, inc.incidentId, `aegisgrid.agent.${o.serviceType.toLowerCase()}`, 'Offer.Expired', `${a.stationName} did not respond in time; moving to the next nearest station`, { stationId: o.stationId });
        passOn(db, inc, o.serviceType, 'EXPIRED', 'Not accepted in time');
      }
    }
  }
  return changed;
}

const station = (db: Db, id: string) => db.stations.find(s => s.stationId === id);
const originalOf = (db: Db, i: Incident) => (i.duplicateOf ? db.incidents.find(x => x.incidentId === i.duplicateOf) : undefined);
const incidentOf = (db: Db, id: string) => db.incidents.find(i => i.incidentId === id) ?? fail('Request not found');

function ownOffer(db: Db, stationId: string, offerId: string) {
  const offer = db.offers.find(o => o.offerId === offerId && o.stationId === stationId) ?? fail('Request not found');
  const incident = incidentOf(db, offer.incidentId);
  const a = incident.assignments[offer.serviceType];
  if (!a || a.offerId !== offerId) fail('This request is no longer assigned to your station');
  return { offer, incident, a: a as ServiceAssignment, st: station(db, stationId)! };
}

function checkCode(a: ServiceAssignment, code: string, field: 'arrivalOtp' | 'completionOtp') {
  if (code.trim() === a[field]) return;
  a.otpAttempts = (a.otpAttempts ?? 0) + 1;
  if (a.otpAttempts >= OTP_MAX_ATTEMPTS) {
    a[field] = newOtp();
    a.otpAttempts = 0;
    throw new Error('Too many wrong codes. The citizen has been given a new code.');
  }
  throw new Error(`Code does not match. ${OTP_MAX_ATTEMPTS - a.otpAttempts} attempts left.`);
}

// ── public demo API ─────────────────────────────────────────────────────────

// Same gate as create-incident.ts
function createRequest(session: Session, input: {
  description: string; location: GeoPoint; address?: string; locationSource: 'manual' | 'gps'; mediaKinds: ('image' | 'video' | 'audio')[];
  meta?: (MediaMeta | undefined)[]; deviceLocation?: GeoPoint; declarationAccepted: boolean; simulatedLabels?: string[]; simulatedTranscript?: string;
}) {
  return mutate(db => {
    // Same gate as create-incident.ts
    if (!input.declarationAccepted) fail('You must confirm the declaration against false reporting');
    const profile = profileOf(db, session.userId, session);
    if (profile.standing === 'SUSPENDED') fail('This account is suspended for repeated false reports. In an emergency call 112.', 'SUSPENDED');
    if (!profile.phoneVerified) fail('Verify your mobile number before your first request.', 'PHONE_NOT_VERIFIED');
    const t = now();
    const rate = checkRateLimit(profile, t);
    if (!rate.allowed) fail(`Request limit reached (${rate.limit} per hour for this account). Try again in ${rate.retryAfterMinutes} min, or call 112 in an emergency.`, 'RATE_LIMITED');
    profile.recentRequests = [...rate.recent, t];

    const incidentId = uuid();
    db.incidents.unshift({
      incidentId, status: 'ANALYZING', createdAt: t, updatedAt: t,
      reporter: { userId: session.userId, name: session.name, email: session.email, phone: profile.phone ?? session.phone }, reporterId: session.userId,
      description: input.description, location: input.location, address: input.address, locationSource: input.locationSource,
      declarationAccepted: true, deviceLocation: input.deviceLocation,
      media: input.mediaKinds.map((kind, i) => ({ key: `demo/${incidentId}/${i}`, kind, contentType: kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/webm', meta: input.meta?.[i] })),
      analysis: {
        images: input.simulatedLabels?.length ? [{ key: 'scenario', labels: input.simulatedLabels.map(name => ({ name, confidence: 92 })) }] : [],
        transcripts: input.simulatedTranscript ? [{ key: 'scenario', text: input.simulatedTranscript }] : [],
      },
      assignments: {},
    });
    log(db, incidentId, 'aegisgrid.api', 'Incident.Reported', `Request received from ${session.name}${input.locationSource === 'gps' ? ' (live location)' : ''}`);
    return incidentId;
  });
}

export const demoCitizen = {
  createRequest(session: Session, input: Parameters<typeof createRequest>[1]) {
    try {
      return createRequest(session, input);
    } catch (e) {
      const code = (e as { code?: string }).code;
      const reason = { SUSPENDED: 'account suspended', PHONE_NOT_VERIFIED: 'mobile number not verified', RATE_LIMITED: 'hourly limit reached' }[code ?? ''];
      if (reason) mutate(db => act(db, session.userId, 'REQUEST', 'REQUEST_REFUSED', `Request refused: ${reason}`));
      throw e;
    }
  },
  myRequests: (userId: string) => query(db => db.incidents.filter(i => i.reporterId === userId).map(i => toCitizenView(i, originalOf(db, i)))),
  requestStatus: (id: string) => query(db => {
    const i = db.incidents.find(x => x.incidentId === id);
    return i ? toCitizenView(i, originalOf(db, i)) : undefined;
  }),
  profile(session: Session) {
    // Write only when the profile is first created, so polling never loops on storage events.
    const existing = query(db => db.citizens.find(c => c.userId === session.userId));
    return existing ? profileView(existing) : mutate(db => profileView(profileOf(db, session.userId, session)));
  },
  sendPhoneCode(session: Session, phone: string) {
    return mutate(db => {
      if (!/^\+[1-9]\d{6,14}$/.test(phone)) fail('Enter the number with country code, e.g. +919876543210');
      const p = profileOf(db, session.userId, session);
      const code = newOtp();
      p.phoneOtp = { hash: code, phone, expiresAt: new Date(Date.now() + 600_000).toISOString(), attempts: 0 };
      act(db, session.userId, 'VERIFICATION', 'PHONE_CODE_SENT', `Verification code sent to ${phone} (screen)`);
      return { channel: 'screen' as const, devCode: code };
    });
  },
  verifyPhone(session: Session, code: string) {
    return mutate(db => {
      const p = profileOf(db, session.userId, session);
      const otp = p.phoneOtp;
      if (!otp || Date.parse(otp.expiresAt) < Date.now()) fail('Code expired. Request a new one.');
      if (otp!.attempts >= 5) fail('Too many attempts. Request a new code.');
      if (otp!.hash !== code.trim()) {
        otp!.attempts++;
        fail('Code does not match');
      }
      Object.assign(p, { phone: otp!.phone, phoneVerified: true, phoneOtp: undefined, updatedAt: now() });
      p.history = [...p.history, { at: now(), event: 'PHONE_VERIFIED' }];
      act(db, session.userId, 'VERIFICATION', 'PHONE_VERIFIED', `Mobile number ${otp!.phone} verified`);
      return profileView(p);
    });
  },
  updateLocation(id: string, userId: string, lat: number, lon: number) {
    mutate(db => {
      const i = db.incidents.find(x => x.incidentId === id && x.reporterId === userId);
      if (i && i.status !== 'RESOLVED' && i.locationSource === 'gps') {
        i.location = { lat, lon };
        i.locationUpdatedAt = now();
      }
    });
  },
  catalog: (): ApiServicesCatalog => query(db => ({
    services: Object.values(SERVICES).map(s => ({
      id: s.type, name: s.name, helpline: s.helpline, description: s.description,
      stations: db.stations.filter(st => st.serviceType === s.type && st.status === 'APPROVED')
        .map(st => ({ id: st.stationId, name: st.name, address: st.address, location: st.location, onDuty: st.onDuty })),
    })),
  })),
};

export const demoStation = {
  me: (userId: string) => query(db => {
    const s = station(db, userId);
    return s ? toStationView(s) : null;
  }),
  saveApplication(session: Session, req: StationApplicationInput) {
    return mutate(db => {
      const prev = station(db, session.userId);
      if (prev && !['DRAFT', 'REJECTED'].includes(prev.status)) fail('Your application is under review or already approved');
      if (!isValidRegistration(req.serviceType, req.registrationNumber)) {
        fail(`Registration number format is not valid for ${SERVICES[req.serviceType].name}. Example: ${SERVICES[req.serviceType].registration.example}`);
      }
      const t = now();
      const next: Station = {
        stationId: session.userId, ownerUserId: session.userId, ownerEmail: session.email, ...req,
        registrationNumber: req.registrationNumber.trim().toUpperCase(),
        unitsAvailable: req.unitsTotal, onDuty: false, status: 'DRAFT',
        verification: {
          phoneVerified: prev && prev.phone === req.phone ? prev.verification.phoneVerified : false,
          documents: prev?.verification.documents ?? [], declarationAccepted: false, reviewNote: prev?.verification.reviewNote,
        },
        stats: prev?.stats ?? { offered: 0, accepted: 0, transferred: 0, completed: 0, totalResponseMinutes: 0 },
        createdAt: prev?.createdAt ?? t, updatedAt: t,
      };
      db.stations = [...db.stations.filter(s => s.stationId !== session.userId), next];
      act(db, session.userId, 'VERIFICATION', prev ? 'APPLICATION_UPDATED' : 'APPLICATION_STARTED', `${prev ? 'Updated' : 'Started'} registration of ${next.name} (${SERVICES[next.serviceType].name}, ${next.registrationNumber})`);
      return toStationView(next);
    });
  },
  addDocuments(userId: string, files: { name: string; kind: DocumentKind }[]) {
    return mutate(db => {
      const s = station(db, userId) ?? fail('Save your service details first');
      s.verification.documents.push(...files.map(f => ({ key: `demo/${userId}/${uuid().slice(0, 8)}`, name: f.name, kind: f.kind, uploadedAt: now() })));
      act(db, userId, 'VERIFICATION', 'DOCUMENTS_UPLOADED', `Uploaded ${files.map(f => `${f.name} (${f.kind.toLowerCase().replace(/_/g, ' ')})`).join(', ')}`);
      return toStationView(s);
    });
  },
  removeDocument(userId: string, key: string) {
    return mutate(db => {
      const s = station(db, userId) ?? fail('Not found');
      const removed = s.verification.documents.find(d => d.key === key);
      s.verification.documents = s.verification.documents.filter(d => d.key !== key);
      if (removed) act(db, userId, 'VERIFICATION', 'DOCUMENT_REMOVED', `Removed ${removed.name}`);
      return toStationView(s);
    });
  },
  sendPhoneOtp(userId: string) {
    return mutate(db => {
      const s = station(db, userId) ?? fail('Save your service details first');
      const code = newOtp();
      s.verification.phoneOtp = { hash: code, expiresAt: new Date(Date.now() + 600_000).toISOString(), attempts: 0 };
      act(db, userId, 'VERIFICATION', 'PHONE_CODE_SENT', `Verification code sent to ${s.phone} (screen)`);
      return { channel: 'screen' as const, devCode: code };
    });
  },
  verifyPhone(userId: string, code: string) {
    return mutate(db => {
      const s = station(db, userId) ?? fail('Not found');
      const otp = s.verification.phoneOtp;
      if (!otp || Date.parse(otp.expiresAt) < Date.now()) fail('Code expired. Request a new one.');
      if (otp!.hash !== code.trim()) {
        otp!.attempts++;
        fail('Code does not match');
      }
      s.verification.phoneVerified = true;
      delete s.verification.phoneOtp;
      act(db, userId, 'VERIFICATION', 'PHONE_VERIFIED', `Station phone ${s.phone} verified`);
      return toStationView(s);
    });
  },
  submit(userId: string) {
    return mutate(db => {
      const s = station(db, userId) ?? fail('Not found');
      const docs = s.verification.documents;
      const missing: string[] = [];
      if (!s.verification.phoneVerified) missing.push('verified contact phone');
      if (!docs.some(d => d.kind === 'REGISTRATION_CERTIFICATE')) missing.push('registration certificate');
      if (!docs.some(d => d.kind === 'AUTHORITY_LETTER')) missing.push('authority letter');
      if (!docs.some(d => d.kind === 'OFFICER_ID')) missing.push('officer-in-charge ID');
      if (missing.length) fail(`Complete these steps first: ${missing.join(', ')}`);
      s.status = 'PENDING_REVIEW';
      s.verification.declarationAccepted = true;
      s.verification.submittedAt = now();
      act(db, userId, 'VERIFICATION', 'APPLICATION_SUBMITTED', `Submitted ${s.name} for admin verification`);
      return toStationView(s);
    });
  },
  updateOperations(userId: string, ops: { onDuty?: boolean; unitsAvailable?: number; unitsTotal?: number }) {
    return mutate(db => {
      const s = station(db, userId) ?? fail('Not found');
      if (s.status !== 'APPROVED') fail('Only approved stations can change operations');
      const before = { onDuty: s.onDuty, unitsTotal: s.unitsTotal, unitsAvailable: s.unitsAvailable };
      if (ops.onDuty !== undefined) s.onDuty = ops.onDuty;
      if (ops.unitsTotal !== undefined) s.unitsTotal = Math.max(1, ops.unitsTotal);
      if (ops.unitsAvailable !== undefined) s.unitsAvailable = ops.unitsAvailable;
      s.unitsAvailable = Math.max(0, Math.min(s.unitsTotal, s.unitsAvailable));
      s.updatedAt = now();
      const changes = [
        s.onDuty !== before.onDuty && (s.onDuty ? 'went on duty' : 'went off duty'),
        s.unitsTotal !== before.unitsTotal && `total units ${before.unitsTotal} → ${s.unitsTotal}`,
        s.unitsAvailable !== before.unitsAvailable && `free units ${before.unitsAvailable} → ${s.unitsAvailable}`,
      ].filter(Boolean);
      if (changes.length) act(db, userId, 'OPERATIONS', 'OPERATIONS_CHANGED', `Station ${changes.join(', ')}`);
      return toStationView(s);
    });
  },
  offers: (userId: string) => query(db => db.offers.filter(o => o.stationId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  action(userId: string, offerId: string, action: OfferAction, payload: { reason?: string; code?: string } = {}) {
    return mutate(db => {
      const { offer, incident, a, st } = ownOffer(db, userId, offerId);
      const t = now();
      const src = 'aegisgrid.station';
      if (action === 'accept') {
        if (a.status !== 'OFFERED') fail(`Request is already ${a.status.toLowerCase()}`);
        if (Date.parse(offer.expiresAt) < Date.now()) fail('The acceptance window has passed; the request moved to another station');
        if (st.unitsAvailable <= 0) fail('No free units. Update your availability or transfer the request.');
        st.unitsAvailable--; st.stats.accepted++;
        offer.status = 'ACCEPTED'; offer.updatedAt = t; offer.acceptedAt = t;
        Object.assign(a, { status: 'ACCEPTED', acceptedAt: t, arrivalOtp: newOtp(), otpAttempts: 0, updatedAt: t });
        if (incident.status === 'ASSESSED') incident.status = 'DISPATCHED';
        log(db, incident.incidentId, src, 'Offer.Accepted', `${st.name} accepted, en route (ETA ~${a.etaMinutes} min)`, { stationId: st.stationId });
      } else if (action === 'transfer') {
        if (!['OFFERED', 'ACCEPTED'].includes(a.status)) fail('Only open requests can be transferred');
        if (a.status === 'ACCEPTED') st.unitsAvailable = Math.min(st.unitsTotal, st.unitsAvailable + 1);
        offer.status = 'TRANSFERRED'; offer.transferReason = payload.reason; offer.updatedAt = t;
        st.stats.transferred++;
        log(db, incident.incidentId, src, 'Offer.Transferred', `${st.name} transferred the request: ${payload.reason}`, { stationId: st.stationId });
        passOn(db, incident, offer.serviceType, 'TRANSFERRED', payload.reason ?? '');
      } else if (action === 'arrive') {
        if (a.status !== 'ACCEPTED') fail('Arrival can only be confirmed for an accepted request');
        checkCode(a, payload.code ?? '', 'arrivalOtp');
        Object.assign(a, { status: 'ARRIVED', arrivedAt: t, responseMinutes: minutesBetween(incident.createdAt, t), arrivalOtp: undefined, completionOtp: newOtp(), otpAttempts: 0, updatedAt: t });
        incident.firstArrivalAt ??= t;
        offer.status = 'ARRIVED'; offer.updatedAt = t; offer.arrivedAt = t; offer.responseMinutes = a.responseMinutes;
        log(db, incident.incidentId, src, 'Service.Arrived', `${st.name} arrived, verified with the citizen's code. Response time ${a.responseMinutes} min`, { stationId: st.stationId });
      } else if (action === 'false-alarm') {
        if (!['ACCEPTED', 'ARRIVED'].includes(a.status)) fail('Only a request your team has accepted can be reported as a false alarm');
        const reason = (payload.reason ?? '').trim();
        if (reason.length < 5) fail('Describe what the team found (at least 5 characters)');
        const alreadyFlagged = Object.values(incident.assignments).some(x => x!.status === 'FALSE_ALARM');
        Object.assign(a, { status: 'FALSE_ALARM', arrivalOtp: undefined, completionOtp: undefined, otpAttempts: 0, note: reason, updatedAt: t });
        offer.status = 'FALSE_ALARM'; offer.transferReason = reason; offer.updatedAt = t; offer.completedAt = t;
        st.unitsAvailable = Math.min(st.unitsTotal, st.unitsAvailable + 1);
        st.stats.falseAlarms = (st.stats.falseAlarms ?? 0) + 1;
        if (!alreadyFlagged) trust(db, incident.reporterId, 'FALSE_ALARM', `Request ${incident.incidentId.slice(0, 8)}: ${reason}`);
        log(db, incident.incidentId, src, 'Service.FalseAlarm', `${st.name} reported a false alarm: ${reason}. Strike recorded against the reporter`, { stationId: st.stationId });
        finishIfDone(db, incident, src);
      } else {
        if (a.status !== 'ARRIVED') fail('Only a service that has arrived can be completed');
        checkCode(a, payload.code ?? '', 'completionOtp');
        Object.assign(a, { status: 'COMPLETED', completedAt: t, completionOtp: undefined, otpAttempts: 0, updatedAt: t });
        offer.status = 'COMPLETED'; offer.updatedAt = t; offer.completedAt = t;
        st.unitsAvailable = Math.min(st.unitsTotal, st.unitsAvailable + 1);
        st.stats.completed++; st.stats.totalResponseMinutes += a.responseMinutes ?? 0;
        log(db, incident.incidentId, src, 'Service.Completed', `${st.name} completed, verified with the citizen's completion code`, { stationId: st.stationId });
        finishIfDone(db, incident, src);
      }
      incident.updatedAt = t;
      return { ...a, arrivalOtp: undefined, completionOtp: undefined };
    });
  },
};

/** Newest first, paged by offset (the cursor). */
function activityPage(db: Db, accountId: string, cursor?: string) {
  const all = db.activity.filter(a => a.accountId === accountId).sort((a, b) => b.at.localeCompare(a.at));
  const start = Number(cursor ?? 0);
  const items = all.slice(start, start + 50).map(({ accountId: _id, ...e }) => e);
  return { items, nextCursor: start + 50 < all.length ? String(start + 50) : undefined };
}
export const demoActivity = {
  mine: (userId: string, cursor?: string) => query(db => activityPage(db, userId, cursor)),
  of: (userId: string, cursor?: string) => query(db => activityPage(db, userId, cursor)),
};

export const demoAdmin = {
  overview: (): ApiOverview => query(db => {
    const active = db.incidents.filter(i => i.status !== 'RESOLVED');
    const times = db.incidents.filter(i => i.firstArrivalAt).map(i => minutesBetween(i.createdAt, i.firstArrivalAt!));
    return {
      incidents: { total: db.incidents.length, active: active.length, resolved: db.incidents.length - active.length, unassigned: active.filter(i => Object.values(i.assignments).some(a => a!.status === 'UNAVAILABLE')).length },
      avgResponseMinutes: times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : null,
      stations: { total: db.stations.length, approved: db.stations.filter(s => s.status === 'APPROVED').length, pending: db.stations.filter(s => s.status === 'PENDING_REVIEW').length, onDuty: db.stations.filter(s => s.status === 'APPROVED' && s.onDuty).length },
    };
  }),
  incidents: () => query(db => db.incidents.map(toAdminView)),
  incident: (id: string) => query(db => {
    const i = db.incidents.find(x => x.incidentId === id);
    return i ? { incident: toAdminView(i), timeline: db.timeline.filter(t => t.incidentId === id) } : null;
  }),
  assign(incidentId: string, type: ServiceType, stationId: string) {
    return mutate(db => {
      const inc = incidentOf(db, incidentId);
      if (inc.status === 'RESOLVED') fail('Incident is resolved');
      const st = station(db, stationId);
      if (!st || st.status !== 'APPROVED' || st.serviceType !== type) fail('Choose an approved station of this service type');
      const a = inc.assignments[type];
      if (a && ['OFFERED', 'ACCEPTED'].includes(a.status) && a.offerId) {
        const o = db.offers.find(x => x.offerId === a.offerId);
        if (o) { o.status = 'CANCELLED'; o.transferReason = 'Reassigned by admin'; }
        if (a.status === 'ACCEPTED') { const prevSt = station(db, a.stationId!); if (prevSt) prevSt.unitsAvailable = Math.min(prevSt.unitsTotal, prevSt.unitsAvailable + 1); }
        a.tried = [...a.tried, { stationId: a.stationId!, stationName: a.stationName ?? '', outcome: 'REASSIGNED', reason: 'Reassigned by admin', at: now() }];
      }
      const d = Math.round(haversineKm(st!.location, inc.location) * 100) / 100;
      const ranked = { station: st!, distanceKm: d, etaMinutes: estimateEtaMinutes(d) };
      const offer = offerFor(inc, type, ranked, uuid(), now());
      inc.assignments[type] = offeredAssignment(a, type, offer, ranked, now());
      db.offers.push(offer);
      st!.stats.offered++;
      log(db, incidentId, 'aegisgrid.admin', 'Offer.Created', `Admin assigned ${SERVICES[type].name} to ${st!.name}`, { stationId: st!.stationId });
      act(db, demoAuth.ADMIN_USER_ID, 'ADMIN', 'ASSIGN', `Assigned ${SERVICES[type].name} for request #${incidentId.slice(0, 8).toUpperCase()} to ${st!.name}`, { incidentId });
    });
  },
  resolve(incidentId: string, note?: string) {
    mutate(db => {
      const inc = incidentOf(db, incidentId);
      for (const a of Object.values(inc.assignments)) {
        if (a && ['OFFERED', 'ACCEPTED', 'ARRIVED'].includes(a.status)) {
          const o = db.offers.find(x => x.offerId === a.offerId);
          if (o) o.status = 'CANCELLED';
          if (a.status !== 'OFFERED') { const st = station(db, a.stationId!); if (st) st.unitsAvailable = Math.min(st.unitsTotal, st.unitsAvailable + 1); }
          Object.assign(a, { status: 'CANCELLED', arrivalOtp: undefined, completionOtp: undefined, note: note ?? 'Closed by admin', updatedAt: now() });
        }
      }
      inc.status = 'RESOLVED';
      inc.resolvedAt = now();
      inc.outcome = 'CLOSED_BY_ADMIN';
      log(db, incidentId, 'aegisgrid.admin', 'Incident.Resolved', `Closed by admin${note ? `: ${note}` : ''}`);
      act(db, demoAuth.ADMIN_USER_ID, 'ADMIN', 'RESOLVE', `Closed request #${incidentId.slice(0, 8).toUpperCase()}${note ? `: ${note}` : ''}`, { incidentId });
    });
  },
  stations: () => query(db => db.stations.map(toStationView).sort((a, b) => a.name.localeCompare(b.name))),
  station: (id: string) => query(db => {
    const s = station(db, id);
    return s ? { ...toStationView(s), documents: s.verification.documents.map(d => ({ ...d, url: '' })) } : null;
  }),
  review(id: string, action: 'approve' | 'reject' | 'suspend' | 'reinstate', note?: string) {
    return mutate(db => {
      const s = station(db, id) ?? fail('Station not found');
      const allowed: Record<string, string[]> = { approve: ['PENDING_REVIEW'], reject: ['PENDING_REVIEW'], suspend: ['APPROVED'], reinstate: ['SUSPENDED', 'REJECTED'] };
      if (!allowed[action]!.includes(s.status)) fail(`Cannot ${action} a station that is ${s.status.toLowerCase().replace('_', ' ')}`);
      if (action === 'approve' || action === 'reinstate') { s.status = 'APPROVED'; s.onDuty = true; demoAuth.setRole(s.ownerUserId, 'service'); }
      else if (action === 'suspend') { s.status = 'SUSPENDED'; s.onDuty = false; demoAuth.setRole(s.ownerUserId, 'applicant'); }
      else s.status = 'REJECTED';
      Object.assign(s.verification, { reviewedAt: now(), reviewedBy: demoAuth.ADMIN_LOGIN.email, reviewNote: note });
      act(db, s.ownerUserId, 'VERIFICATION', 'APPLICATION_REVIEWED', `Station ${s.name}: ${action} by the admin${note ? ` (${note})` : ''}`, { by: demoAuth.ADMIN_LOGIN.email });
      act(db, demoAuth.ADMIN_USER_ID, 'ADMIN', 'REVIEW', `Station ${s.name}: ${action}${note ? ` (${note})` : ''}`);
      s.updatedAt = now();
      return toStationView(s);
    });
  },
  users: (): ApiUser[] => query(db => demoAuth.listUsers().map(u => {
    const p = db.citizens.find(c => c.userId === u.userId);
    return {
      username: u.email, userId: u.userId, email: u.email, name: u.name, phone: u.phone, role: u.role, enabled: u.enabled,
      status: u.confirmed ? 'CONFIRMED' : 'UNCONFIRMED', createdAt: u.createdAt, provider: u.provider, profile: p ? profileView(p) : undefined,
    };
  })),
  standing(userId: string, action: StandingAction, note?: string) {
    return mutate(db => {
      const EVENT = { reset: 'RESET', suspend: 'SUSPEND', reinstate: 'REINSTATE', reverse_false_alarm: 'FALSE_ALARM_REVERSED' } as const;
      trust(db, userId, EVENT[action], note ? `Admin note: ${note}` : '', demoAuth.ADMIN_LOGIN.email);
      act(db, demoAuth.ADMIN_USER_ID, 'ADMIN', 'STANDING', `Citizen ${profileOf(db, userId).email ?? userId}: ${action.replace(/_/g, ' ')}${note ? ` (${note})` : ''}`);
      return profileView(profileOf(db, userId));
    });
  },
  userAction(userId: string, action: 'disable' | 'enable' | 'delete') {
    const u = demoAuth.listUsers().find(x => x.userId === userId) ?? fail('User not found');
    if (u.role === 'admin') fail('The admin account cannot be changed here');
    const DONE = { disable: 'disabled', enable: 're-enabled', delete: 'deleted' } as const;
    // Logged before a delete: the account's history is kept after the account is gone.
    mutate(db => {
      act(db, userId, 'ACCOUNT', `ACCOUNT_${action.toUpperCase()}D`, `Account ${DONE[action]} by the admin`, { by: demoAuth.ADMIN_LOGIN.email });
      act(db, demoAuth.ADMIN_USER_ID, 'ADMIN', 'USER_ACTION', `Account ${u.email} ${DONE[action]}`);
    });
    if (action === 'delete') {
      demoAuth.deleteUser(userId);
      mutate(db => { db.stations = db.stations.filter(s => s.ownerUserId !== userId); });
    } else demoAuth.setEnabled(userId, action === 'enable');
    window.dispatchEvent(new Event(DB_EVENT));
  },
  reset() {
    localStorage.removeItem(KEY);
    write(read());
  },
};
