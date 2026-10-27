// The dispatch engine: offers each required service to the nearest available
// station, and moves the request along as stations accept, transfer, let the
// offer expire, arrive (verified by the citizen's one-time code) and complete
// (verified by a second code). Every transition is a conditional write, so two
// stations, a retry and the sweeper can never corrupt an assignment.

import { randomUUID } from "node:crypto";
import { DETAIL_TYPE, EVENT_SOURCE } from "./config";
import {
  OTP_MAX_ATTEMPTS, firstArrival, isIncidentFinished, minutesBetween, newOtp, offerFor, offeredAssignment, outcomeOf, rankStations,
  triedStationIds, unavailableAssignment,
} from "./core";
import { publish } from "./events";
import { recordTrust } from "./citizens";
import { estimateEtaMinutes, haversineKm } from "./geo";
import { HttpError } from "./http";
import { getIncident, markResolved, mustGetIncident, setAssignment } from "./incidents";
import { log } from "./logger";
import { getOffer, putOffer, transitionOffer } from "./offers";
import { bumpStats, getStation, listApproved, releaseUnit, reserveUnit } from "./stations";
import type { AssignmentAttempt, Incident, Offer, ServiceAssignment, ServiceType } from "./types";

const now = () => new Date().toISOString();

/**
 * Offer the incident's `type` service to the nearest approved, on-duty station
 * with a free unit, skipping stations that already passed on it.
 */
export async function offerToNearest(incident: Incident, type: ServiceType, expectOfferId?: string): Promise<ServiceAssignment> {
  const prev = incident.assignments?.[type];
  const candidates = rankStations(await listApproved(type), type, incident.location, triedStationIds(prev));
  const t = now();

  if (!candidates.length) {
    const a = unavailableAssignment(prev, type, t);
    if (await setAssignment(incident.incidentId, type, a, { expectOfferId })) {
      await publish(EVENT_SOURCE.agent(type), DETAIL_TYPE.serviceUnavailable, { incidentId: incident.incidentId, serviceType: type, tried: a.tried.length });
    }
    return a;
  }

  const best = candidates[0]!;
  const offer = offerFor(incident, type, best, randomUUID(), t);
  const a = offeredAssignment(prev, type, offer, best, t);
  if (!(await setAssignment(incident.incidentId, type, a, { expectOfferId }))) {
    log.info("Assignment changed concurrently; not offering", { incidentId: incident.incidentId, type });
    return incident.assignments[type]!;
  }
  await putOffer(offer);
  await bumpStats(best.station.stationId, "offered");
  await publish(EVENT_SOURCE.agent(type), DETAIL_TYPE.offerCreated, {
    incidentId: incident.incidentId, serviceType: type, offerId: offer.offerId, stationId: best.station.stationId,
    stationName: best.station.name, distanceKm: best.distanceKm, expiresAt: offer.expiresAt,
  });
  log.info("Offered to nearest station", { incidentId: incident.incidentId, type, station: best.station.name, distanceKm: best.distanceKm, candidates: candidates.length });
  return a;
}

/** Load an offer and check it belongs to the calling station. */
async function ownOffer(stationId: string, offerId: string): Promise<{ offer: Offer; incident: Incident; assignment: ServiceAssignment }> {
  const offer = await getOffer(offerId);
  if (!offer || offer.stationId !== stationId) throw new HttpError(404, "Request not found");
  const incident = await mustGetIncident(offer.incidentId);
  const assignment = incident.assignments?.[offer.serviceType];
  if (!assignment || assignment.offerId !== offerId) throw new HttpError(409, "This request is no longer assigned to your station");
  return { offer, incident, assignment };
}

export async function acceptOffer(stationId: string, offerId: string): Promise<ServiceAssignment> {
  const { offer, incident, assignment } = await ownOffer(stationId, offerId);
  if (assignment.status !== "OFFERED") throw new HttpError(409, `Request is already ${assignment.status.toLowerCase()}`);
  if (Date.parse(offer.expiresAt) < Date.now()) throw new HttpError(409, "The acceptance window has passed; the request moved to another station");
  if (!(await reserveUnit(stationId))) throw new HttpError(409, "No free units. Update your availability or transfer the request.");
  if (!(await transitionOffer(offerId, ["OFFERED"], "ACCEPTED", { acceptedAt: now() }))) {
    await releaseUnit(stationId);
    throw new HttpError(409, "This request is no longer available");
  }
  const t = now();
  const next: ServiceAssignment = { ...assignment, status: "ACCEPTED", acceptedAt: t, arrivalOtp: newOtp(), otpAttempts: 0, updatedAt: t };
  if (!(await setAssignment(incident.incidentId, offer.serviceType, next, { expectOfferId: offerId, incidentStatus: "DISPATCHED" }))) {
    await releaseUnit(stationId);
    throw new HttpError(409, "This request changed while you were accepting it");
  }
  await bumpStats(stationId, "accepted");
  await publish(EVENT_SOURCE.station, DETAIL_TYPE.offerAccepted, {
    incidentId: incident.incidentId, serviceType: offer.serviceType, offerId, stationId, stationName: assignment.stationName, etaMinutes: assignment.etaMinutes,
  });
  return next;
}

/** "All our crews are busy": pass the request to the next nearest station of the same service. */
export async function transferOffer(stationId: string, offerId: string, reason: string): Promise<ServiceAssignment> {
  const { offer, incident, assignment } = await ownOffer(stationId, offerId);
  if (!["OFFERED", "ACCEPTED"].includes(assignment.status)) throw new HttpError(409, "Only open requests can be transferred");
  if (!(await transitionOffer(offerId, ["OFFERED", "ACCEPTED"], "TRANSFERRED", { transferReason: reason }))) throw new HttpError(409, "This request is no longer open");
  if (assignment.status === "ACCEPTED") await releaseUnit(stationId);
  await bumpStats(stationId, "transferred");
  const attempt: AssignmentAttempt = { stationId, stationName: assignment.stationName ?? stationId, outcome: "TRANSFERRED", reason, at: now() };
  const withAttempt: Incident = { ...incident, assignments: { ...incident.assignments, [offer.serviceType]: { ...assignment, tried: [...assignment.tried, attempt] } } };
  await publish(EVENT_SOURCE.station, DETAIL_TYPE.offerTransferred, { incidentId: incident.incidentId, serviceType: offer.serviceType, offerId, stationId, stationName: assignment.stationName, reason });
  return offerToNearest(withAttempt, offer.serviceType, offerId);
}

/** Sweeper: an offer nobody accepted in time goes to the next nearest station. */
export async function expireOffer(offer: Offer): Promise<void> {
  if (!(await transitionOffer(offer.offerId, ["OFFERED"], "EXPIRED"))) return;
  const incident = await getIncident(offer.incidentId);
  const assignment = incident?.assignments?.[offer.serviceType];
  if (!incident || !assignment || assignment.offerId !== offer.offerId || incident.status === "RESOLVED") return;
  const attempt: AssignmentAttempt = { stationId: offer.stationId, stationName: assignment.stationName ?? offer.stationId, outcome: "EXPIRED", reason: "Not accepted in time", at: now() };
  const withAttempt: Incident = { ...incident, assignments: { ...incident.assignments, [offer.serviceType]: { ...assignment, tried: [...assignment.tried, attempt] } } };
  await publish(EVENT_SOURCE.agent(offer.serviceType), DETAIL_TYPE.offerExpired, { incidentId: incident.incidentId, serviceType: offer.serviceType, offerId: offer.offerId, stationName: assignment.stationName });
  await offerToNearest(withAttempt, offer.serviceType, offer.offerId);
}

/** Wrong code: count it, and rotate the code after too many attempts. */
async function rejectCode(incident: Incident, type: ServiceType, assignment: ServiceAssignment, field: "arrivalOtp" | "completionOtp"): Promise<never> {
  const attempts = (assignment.otpAttempts ?? 0) + 1;
  const rotate = attempts >= OTP_MAX_ATTEMPTS;
  await setAssignment(incident.incidentId, type, { ...assignment, otpAttempts: rotate ? 0 : attempts, ...(rotate ? { [field]: newOtp() } : {}), updatedAt: now() }, { expectOfferId: assignment.offerId });
  throw new HttpError(400, rotate ? "Too many wrong codes. The citizen has been given a new code." : `Code does not match. ${OTP_MAX_ATTEMPTS - attempts} attempts left.`);
}

/** Responder reached the scene: verified with the citizen's arrival code. Response time is measured here. */
export async function confirmArrival(stationId: string, offerId: string, otp: string): Promise<ServiceAssignment> {
  const { offer, incident, assignment } = await ownOffer(stationId, offerId);
  if (assignment.status !== "ACCEPTED") throw new HttpError(409, "Arrival can only be confirmed for an accepted request");
  if (otp.trim() !== assignment.arrivalOtp) return rejectCode(incident, offer.serviceType, assignment, "arrivalOtp");
  const t = now();
  const next: ServiceAssignment = {
    ...assignment, status: "ARRIVED", arrivedAt: t, responseMinutes: minutesBetween(incident.createdAt, t),
    arrivalOtp: undefined, completionOtp: newOtp(), otpAttempts: 0, updatedAt: t,
  };
  if (!(await setAssignment(incident.incidentId, offer.serviceType, next, { expectOfferId: offerId, firstArrivalAt: t }))) throw new HttpError(409, "This request changed; please refresh");
  await transitionOffer(offerId, ["ACCEPTED"], "ARRIVED", { arrivedAt: t, responseMinutes: next.responseMinutes });
  await publish(EVENT_SOURCE.station, DETAIL_TYPE.serviceArrived, {
    incidentId: incident.incidentId, serviceType: offer.serviceType, offerId, stationId, stationName: assignment.stationName, responseMinutes: next.responseMinutes,
  });
  return next;
}

/** Job finished: verified with the citizen's completion code. Frees the unit. */
export async function completeService(stationId: string, offerId: string, otp: string): Promise<ServiceAssignment> {
  const { offer, incident, assignment } = await ownOffer(stationId, offerId);
  if (assignment.status !== "ARRIVED") throw new HttpError(409, "Only a service that has arrived can be completed");
  if (otp.trim() !== assignment.completionOtp) return rejectCode(incident, offer.serviceType, assignment, "completionOtp");
  const t = now();
  const next: ServiceAssignment = { ...assignment, status: "COMPLETED", completedAt: t, completionOtp: undefined, otpAttempts: 0, updatedAt: t };
  if (!(await setAssignment(incident.incidentId, offer.serviceType, next, { expectOfferId: offerId }))) throw new HttpError(409, "This request changed; please refresh");
  await transitionOffer(offerId, ["ARRIVED"], "COMPLETED", { completedAt: t });
  await releaseUnit(stationId);
  await bumpStats(stationId, "completed");
  if (next.responseMinutes !== undefined) await bumpStats(stationId, "totalResponseMinutes", next.responseMinutes);
  await publish(EVENT_SOURCE.station, DETAIL_TYPE.serviceCompleted, { incidentId: incident.incidentId, serviceType: offer.serviceType, offerId, stationId, stationName: assignment.stationName });

  await finishIfDone({ ...incident, assignments: { ...incident.assignments, [offer.serviceType]: next } });
  return next;
}

/** Resolve the incident once every service is done, and credit the reporter for a genuine request. */
async function finishIfDone(incident: Incident): Promise<void> {
  if (!isIncidentFinished(incident)) return;
  const outcome = outcomeOf(incident);
  if (!(await markResolved(incident.incidentId, outcome))) return; // someone else resolved it
  if (outcome === "SERVED" && incident.reporterId) await safeTrust(incident.reporterId, "GENUINE", `Request ${incident.incidentId.slice(0, 8)} served`);
}

/** Trust bookkeeping must never fail an emergency workflow. */
async function safeTrust(userId: string, event: Parameters<typeof recordTrust>[1], note: string): Promise<void> {
  try {
    await recordTrust(userId, event, note);
  } catch (error) {
    log.warn("Could not update citizen trust", { userId, event, error });
  }
}

/**
 * Responders found no emergency at the scene. Frees the unit, records a strike
 * against the reporter (once per request) and alerts the admin, who can reverse it.
 */
export async function reportFalseAlarm(stationId: string, offerId: string, reason: string): Promise<ServiceAssignment> {
  const { offer, incident, assignment } = await ownOffer(stationId, offerId);
  if (!["ACCEPTED", "ARRIVED"].includes(assignment.status)) throw new HttpError(409, "Only a request your team has accepted can be reported as a false alarm");
  const t = now();
  const next: ServiceAssignment = { ...assignment, status: "FALSE_ALARM", arrivalOtp: undefined, completionOtp: undefined, otpAttempts: 0, note: reason, updatedAt: t };
  if (!(await setAssignment(incident.incidentId, offer.serviceType, next, { expectOfferId: offerId }))) throw new HttpError(409, "This request changed; please refresh");
  await transitionOffer(offerId, ["ACCEPTED", "ARRIVED"], "FALSE_ALARM", { transferReason: reason, completedAt: t });
  await releaseUnit(stationId);
  await bumpStats(stationId, "falseAlarms");

  const alreadyFlagged = Object.values(incident.assignments ?? {}).some((a) => a!.status === "FALSE_ALARM");
  if (incident.reporterId && !alreadyFlagged) await safeTrust(incident.reporterId, "FALSE_ALARM", `Request ${incident.incidentId.slice(0, 8)}: ${reason}`);
  await publish(EVENT_SOURCE.station, DETAIL_TYPE.falseAlarm, {
    incidentId: incident.incidentId, serviceType: offer.serviceType, offerId, stationId, stationName: assignment.stationName, reason, reporterId: incident.reporterId,
  });
  await finishIfDone({ ...incident, assignments: { ...incident.assignments, [offer.serviceType]: next } });
  return next;
}

/** Close an open assignment (cancel the offer, return the unit). */
async function closeOpen(incident: Incident, type: ServiceType, assignment: ServiceAssignment, outcome: AssignmentAttempt["outcome"] | "CANCELLED", reason: string) {
  if (!assignment.offerId || !assignment.stationId) return assignment;
  const wasAccepted = assignment.status === "ACCEPTED" || assignment.status === "ARRIVED";
  if (await transitionOffer(assignment.offerId, ["OFFERED", "ACCEPTED", "ARRIVED"], "CANCELLED", { transferReason: reason })) {
    if (wasAccepted) await releaseUnit(assignment.stationId);
  }
  if (outcome === "CANCELLED") return assignment;
  return { ...assignment, tried: [...assignment.tried, { stationId: assignment.stationId, stationName: assignment.stationName ?? "", outcome, reason, at: now() }] };
}

/** Admin: send a service to a specific station (overrides the nearest-station choice). */
export async function adminAssign(incidentId: string, type: ServiceType, stationId: string, adminEmail?: string): Promise<ServiceAssignment> {
  const incident = await mustGetIncident(incidentId);
  if (incident.status === "RESOLVED") throw new HttpError(409, "Incident is resolved");
  const station = await getStation(stationId);
  if (!station || station.status !== "APPROVED" || station.serviceType !== type) throw new HttpError(400, "Choose an approved station of this service type");
  const current = incident.assignments?.[type];
  const base = current && ["OFFERED", "ACCEPTED"].includes(current.status) ? await closeOpen(incident, type, current, "REASSIGNED", `Reassigned by admin${adminEmail ? ` (${adminEmail})` : ""}`) : current;
  const d = Math.round(haversineKm(station.location, incident.location) * 100) / 100;
  const ranked = { station, distanceKm: d, etaMinutes: estimateEtaMinutes(d) };
  const t = now();
  const offer = offerFor(incident, type, ranked, randomUUID(), t);
  const a = offeredAssignment(base, type, offer, ranked, t);
  await setAssignment(incidentId, type, a);
  await putOffer(offer);
  await bumpStats(stationId, "offered");
  await publish(EVENT_SOURCE.admin, DETAIL_TYPE.offerCreated, { incidentId, serviceType: type, offerId: offer.offerId, stationId, stationName: station.name, byAdmin: true });
  return a;
}

/** Admin closes an incident: open offers are cancelled and units released. */
export async function cancelIncident(incidentId: string, note?: string): Promise<number> {
  const incident = await mustGetIncident(incidentId);
  let released = 0;
  for (const [type, a] of Object.entries(incident.assignments ?? {}) as [ServiceType, ServiceAssignment][]) {
    if (["OFFERED", "ACCEPTED", "ARRIVED"].includes(a.status)) {
      await closeOpen(incident, type, a, "CANCELLED", note ?? "Closed by admin");
      if (a.status !== "OFFERED") released++;
      await setAssignment(incidentId, type, { ...a, status: "CANCELLED", arrivalOtp: undefined, completionOtp: undefined, note: note ?? "Closed by admin", updatedAt: now() });
    }
  }
  return released;
}

export { firstArrival };
