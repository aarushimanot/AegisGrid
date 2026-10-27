// Misuse protection, as pure functions shared by the Lambdas and the web app's
// demo engine. None of these ever stop help from being sent; they rate, flag and
// limit, and they make every request accountable to a verified person.

import { haversineKm } from "./geo";
import { classifyType } from "./rules";
import type { CitizenProfile, CitizenStanding, Credibility, GeoPoint, Incident, IncidentType, MediaItem } from "./types";

// ── trust score ─────────────────────────────────────────────────────────────

export const TRUST_START = 50;
export const TRUST_GENUINE = 5;
export const TRUST_FALSE_ALARM = -25;

export function newProfile(userId: string, now: string, extra: Partial<CitizenProfile> = {}): CitizenProfile {
  return {
    userId, phoneVerified: false, trustScore: TRUST_START, genuineRequests: 0, falseAlarms: 0, standing: "GOOD",
    recentRequests: [], history: [], createdAt: now, updatedAt: now, ...extra,
  };
}

/** Standing from false alarms (an admin suspension always wins). */
export function standingFor(falseAlarms: number, current: CitizenStanding): CitizenStanding {
  if (current === "SUSPENDED") return "SUSPENDED";
  if (falseAlarms >= 3) return "RESTRICTED";
  if (falseAlarms >= 2) return "WARNING";
  return "GOOD";
}

export type TrustEvent = "GENUINE" | "FALSE_ALARM" | "FALSE_ALARM_REVERSED" | "RESET" | "SUSPEND" | "REINSTATE";

export function applyTrust(p: CitizenProfile, event: TrustEvent, now: string, note?: string): CitizenProfile {
  const next = { ...p, history: [...p.history], updatedAt: now };
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  switch (event) {
    case "GENUINE":
      next.genuineRequests++;
      next.trustScore = clamp(next.trustScore + TRUST_GENUINE);
      break;
    case "FALSE_ALARM":
      next.falseAlarms++;
      next.trustScore = clamp(next.trustScore + TRUST_FALSE_ALARM);
      break;
    case "FALSE_ALARM_REVERSED":
      next.falseAlarms = Math.max(0, next.falseAlarms - 1);
      next.trustScore = clamp(next.trustScore - TRUST_FALSE_ALARM);
      break;
    case "RESET":
      next.falseAlarms = 0;
      next.trustScore = TRUST_START;
      next.standing = "GOOD";
      break;
    case "SUSPEND":
      next.standing = "SUSPENDED";
      break;
    case "REINSTATE":
      next.standing = "GOOD";
      break;
  }
  if (event !== "SUSPEND") next.standing = standingFor(next.falseAlarms, event === "REINSTATE" || event === "RESET" ? "GOOD" : next.standing);
  next.history.push({ at: now, event: note ? `${event}: ${note}` : event });
  next.history = next.history.slice(-50);
  return next;
}

// ── rate limiting ───────────────────────────────────────────────────────────

export const REQUESTS_PER_HOUR: Record<CitizenStanding, number> = { GOOD: 3, WARNING: 2, RESTRICTED: 1, SUSPENDED: 0 };

export function checkRateLimit(p: CitizenProfile, now: string): { allowed: boolean; recent: string[]; retryAfterMinutes?: number; limit: number } {
  const hourAgo = Date.parse(now) - 3_600_000;
  const recent = p.recentRequests.filter((t) => Date.parse(t) > hourAgo).sort();
  const limit = REQUESTS_PER_HOUR[p.standing];
  if (recent.length < limit) return { allowed: true, recent, limit };
  const retry = Math.ceil((Date.parse(recent[0]!) + 3_600_000 - Date.parse(now)) / 60_000);
  return { allowed: false, recent, retryAfterMinutes: Math.max(1, retry), limit };
}

// ── duplicate reports ───────────────────────────────────────────────────────

export const DUPLICATE_RADIUS_KM = 0.3;
export const DUPLICATE_WINDOW_MINUTES = 20;

/** An open incident of the same type reported within 300 m in the last 20 minutes. */
export function findDuplicate(incident: Incident, type: IncidentType, candidates: Incident[]): Incident | undefined {
  const created = Date.parse(incident.createdAt);
  return candidates
    .filter((c) =>
      c.incidentId !== incident.incidentId && !c.duplicateOf && c.status !== "RESOLVED" && c.assessment?.incidentType === type &&
      Math.abs(created - Date.parse(c.createdAt)) <= DUPLICATE_WINDOW_MINUTES * 60_000 &&
      haversineKm(c.location, incident.location) <= DUPLICATE_RADIUS_KM)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

// ── credibility ─────────────────────────────────────────────────────────────

export interface CredibilityInput {
  text: string; // English description + transcripts
  imageLabels: string[];
  media: MediaItem[];
  incidentType: IncidentType;
  aiConfidence: number;
  location: GeoPoint;
  locationSource: "manual" | "gps";
  deviceLocation?: GeoPoint;
  createdAt: string;
  profile?: CitizenProfile;
  recentRequestCount: number;
}

const PHOTO_MAX_AGE_HOURS = 24;
const LOCATION_MISMATCH_KM = 5;

/**
 * 0-100 credibility with the reasons behind it. HIGH ≥ 70, MEDIUM 40-69, LOW < 40.
 * It informs responders and the admin; it never blocks dispatch.
 */
export function assessCredibility(i: CredibilityInput): Credibility {
  const flags: string[] = [];
  let score = 100;
  const hit = (points: number, flag: string) => { score -= points; flags.push(flag); };

  // Evidence consistency: does the photo show what the text says?
  const images = i.media.filter((m) => m.kind === "image");
  if (images.length && i.imageLabels.length && i.text.trim()) {
    const fromText = classifyType({ text: i.text.toLowerCase(), imageLabels: [] });
    const fromImage = classifyType({ text: "", imageLabels: i.imageLabels });
    if (fromText !== "OTHER" && fromImage !== "OTHER" && fromText !== fromImage) {
      hit(30, `Photo appears to show a ${fromImage.toLowerCase().replace("_", " ")}, but the report describes a ${fromText.toLowerCase().replace("_", " ")}`);
    }
  }
  if (images.length && !i.imageLabels.length) hit(10, "AI could not recognise anything relevant in the photo");
  if (i.aiConfidence < 40) hit(15, `Low AI confidence in the assessment (${i.aiConfidence}%)`);
  if (!i.media.length && i.text.trim().split(/\s+/).length < 6) hit(10, "Very short report with no photo, video or voice evidence");

  // Photo freshness and origin
  for (const m of i.media.filter((x) => x.kind === "image" || x.kind === "video")) {
    if (m.meta?.source === "gallery" && !m.meta.capturedAt) {
      hit(15, "Uploaded from the gallery with no capture data (may be downloaded or old)");
      continue;
    }
    if (m.meta?.capturedAt) {
      const ageH = (Date.parse(i.createdAt) - Date.parse(m.meta.capturedAt)) / 3_600_000;
      if (ageH > PHOTO_MAX_AGE_HOURS) hit(25, `Photo was taken ${ageH > 48 ? `${Math.round(ageH / 24)} days` : `${Math.round(ageH)} hours`} before the report`);
    }
    if (m.meta?.location && haversineKm(m.meta.location, i.location) > LOCATION_MISMATCH_KM) {
      hit(20, `Photo was taken ${Math.round(haversineKm(m.meta.location, i.location))} km from the reported location`);
    }
  }

  // Location consistency
  if (i.locationSource === "manual" && i.deviceLocation) {
    const d = haversineKm(i.deviceLocation, i.location);
    if (d > LOCATION_MISMATCH_KM) hit(15, `Reported from a device ${Math.round(d)} km away from the stated location`);
  }

  // Citizen history and behaviour
  const p = i.profile;
  if (p) {
    if (p.falseAlarms >= 2) hit(p.falseAlarms >= 3 ? 30 : 20, `Account has ${p.falseAlarms} previous false alarms`);
    else if (p.falseAlarms === 1) hit(10, "Account has 1 previous false alarm");
    if (p.genuineRequests >= 2 && p.falseAlarms === 0) score = Math.min(100, score + 5);
  }
  if (i.recentRequestCount >= 2) hit(10, `${i.recentRequestCount + 1} requests from this account within an hour`);

  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW", flags };
}
