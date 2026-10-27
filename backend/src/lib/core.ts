// The dispatch rules of AegisGrid as pure functions, used by the Lambdas and by
// the web app's demo engine so both behave identically.

import { SERVICES } from "./catalog";
import { estimateEtaMinutes, haversineKm } from "./geo";
import type { GeoPoint, Incident, Offer, ServiceAssignment, ServiceType, Station } from "./types";

/** How long a station has to accept before the request moves to the next nearest station. */
export const OFFER_TIMEOUT_SECONDS = 90;
/** Wrong one-time-code attempts allowed before the code is rotated. */
export const OTP_MAX_ATTEMPTS = 5;

export interface RankedStation {
  station: Station;
  distanceKm: number;
  etaMinutes: number;
}

/**
 * Approved, on-duty stations of `type` with a free unit, nearest first,
 * excluding stations that already transferred or let the request expire.
 */
export function rankStations(stations: Station[], type: ServiceType, at: GeoPoint, exclude: string[] = []): RankedStation[] {
  const skip = new Set(exclude);
  return stations
    .filter((s) => s.serviceType === type && s.status === "APPROVED" && s.onDuty && s.unitsAvailable > 0 && !skip.has(s.stationId))
    .map((station) => {
      const d = haversineKm(station.location, at);
      return { station, distanceKm: Math.round(d * 100) / 100, etaMinutes: estimateEtaMinutes(d) };
    })
    .filter((r) => r.distanceKm <= r.station.coverageKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** A fresh 6-digit one-time code. Uses the Web Crypto API (Node 20+ and browsers). */
export function newOtp(): string {
  const n = new Uint32Array(1);
  globalThis.crypto.getRandomValues(n);
  return String(100000 + (n[0]! % 900000));
}

export const minutesBetween = (from: string, to: string) => Math.round(((Date.parse(to) - Date.parse(from)) / 60_000) * 10) / 10;

export function offerFor(incident: Incident, type: ServiceType, ranked: RankedStation, offerId: string, now: string): Offer {
  const a = incident.assessment;
  return {
    offerId,
    stationId: ranked.station.stationId,
    incidentId: incident.incidentId,
    serviceType: type,
    status: "OFFERED",
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + OFFER_TIMEOUT_SECONDS * 1000).toISOString(),
    updatedAt: now,
    distanceKm: ranked.distanceKm,
    etaMinutes: ranked.etaMinutes,
    incident: {
      createdAt: incident.createdAt,
      incidentType: a?.incidentType,
      severity: a?.severity,
      summary: a?.summary ?? incident.description.slice(0, 280),
      description: incident.description,
      hazards: a?.hazards ?? [],
      location: incident.location,
      address: incident.address,
      locationSource: incident.locationSource ?? "manual",
      citizenName: incident.reporter?.name,
      citizenPhone: incident.reporter?.phone,
      otherServices: (a?.requiredAgents ?? []).filter((t) => t !== type),
      credibility: incident.credibility,
      citizenStanding: incident.reporterStanding,
    },
  };
}

/** Assignment state while a station is being asked. */
export function offeredAssignment(prev: ServiceAssignment | undefined, type: ServiceType, offer: Offer, ranked: RankedStation, now: string): ServiceAssignment {
  return {
    serviceType: type,
    status: "OFFERED",
    offerId: offer.offerId,
    stationId: ranked.station.stationId,
    stationName: ranked.station.name,
    stationPhone: ranked.station.phone,
    stationAddress: ranked.station.address,
    stationLocation: ranked.station.location,
    distanceKm: ranked.distanceKm,
    etaMinutes: ranked.etaMinutes,
    offeredAt: now,
    expiresAt: offer.expiresAt,
    tried: prev?.tried ?? [],
    updatedAt: now,
  };
}

export function unavailableAssignment(prev: ServiceAssignment | undefined, type: ServiceType, now: string): ServiceAssignment {
  return {
    serviceType: type,
    status: "UNAVAILABLE",
    tried: prev?.tried ?? [],
    note: `No ${SERVICES[type].name} station is available nearby. The admin has been alerted to assign one manually.`,
    updatedAt: now,
  };
}

/** Stations that should not be offered this request again. */
export const triedStationIds = (a?: ServiceAssignment) => [...(a?.tried ?? []).map((t) => t.stationId), ...(a?.stationId ? [a.stationId] : [])];

const TERMINAL = ["COMPLETED", "UNAVAILABLE", "CANCELLED", "FALSE_ALARM"];

/** An incident is finished once every service has completed, been found a false alarm, or could not be provided. */
export function isIncidentFinished(incident: Incident): boolean {
  const list = Object.values(incident.assignments ?? {});
  return list.length > 0 && list.every((a) => TERMINAL.includes(a!.status)) && list.some((a) => a!.status === "COMPLETED" || a!.status === "FALSE_ALARM");
}

/** How a finished incident ended: false alarm if responders found nothing and nobody completed a service. */
export function outcomeOf(incident: Incident): "SERVED" | "FALSE_ALARM" {
  const list = Object.values(incident.assignments ?? {});
  return list.some((a) => a!.status === "FALSE_ALARM") && !list.some((a) => a!.status === "COMPLETED") ? "FALSE_ALARM" : "SERVED";
}

/** First responder arrival across services (the incident's response time). */
export function firstArrival(incident: Incident): string | undefined {
  return Object.values(incident.assignments ?? {}).map((a) => a!.arrivedAt).filter((x): x is string => !!x).sort()[0];
}
