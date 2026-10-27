// What a citizen sees about their own request: progress, each service with the
// station handling it, ETAs, the one-time codes to hand to responders, and the
// measured response time. No internal analysis.

import { SERVICES } from "./catalog";
import { minutesBetween } from "./core";
import type { Incident, ServiceAssignment } from "./types";

export function serviceView(a: ServiceAssignment) {
  return {
    service: a.serviceType,
    serviceName: SERVICES[a.serviceType].name,
    status: a.status,
    stationName: a.stationName,
    stationPhone: a.status === "ACCEPTED" || a.status === "ARRIVED" ? a.stationPhone : undefined,
    stationAddress: a.stationAddress,
    stationLocation: a.stationLocation,
    distanceKm: a.distanceKm,
    etaMinutes: a.etaMinutes,
    offeredAt: a.offeredAt,
    expiresAt: a.expiresAt,
    acceptedAt: a.acceptedAt,
    arrivedAt: a.arrivedAt,
    completedAt: a.completedAt,
    /** Shown to the citizen only, to hand to the responder on arrival / completion. */
    arrivalCode: a.status === "ACCEPTED" ? a.arrivalOtp : undefined,
    completionCode: a.status === "ARRIVED" ? a.completionOtp : undefined,
    responseMinutes: a.responseMinutes,
    transfers: a.tried.length,
    note: a.note,
  };
}

/**
 * @param original For a duplicate report, the earlier request it was linked to:
 *   its responders are shown (without the codes, which belong to that reporter).
 */
export function toCitizenView(incident: Incident, original?: Incident) {
  const services = original
    ? Object.values(original.assignments ?? {}).map((a) => ({ ...serviceView(a!), arrivalCode: undefined, completionCode: undefined }))
    : Object.values(incident.assignments ?? {}).map((a) => serviceView(a!));
  return {
    incidentId: incident.incidentId,
    status: original ? original.status : incident.status,
    outcome: incident.outcome,
    duplicateOf: incident.duplicateOf,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    description: incident.description,
    incidentType: incident.assessment?.incidentType,
    severity: incident.assessment?.severity,
    summary: incident.assessment?.summary,
    requiredServices: incident.assessment?.requiredAgents ?? [],
    location: incident.location,
    address: incident.address,
    locationSource: incident.locationSource ?? "manual",
    locationUpdatedAt: incident.locationUpdatedAt,
    mediaCount: incident.media?.length ?? 0,
    services,
    firstArrivalAt: incident.firstArrivalAt,
    /** Request sent → first responder's arrival confirmed with the citizen's code. */
    responseMinutes: incident.firstArrivalAt ? minutesBetween(incident.createdAt, incident.firstArrivalAt) : null,
    resolvedAt: original ? original.resolvedAt : incident.resolvedAt,
    resolutionMinutes: incident.resolvedAt && !original ? minutesBetween(incident.createdAt, incident.resolvedAt) : null,
  };
}

/** Admin's full view: everything, including the codes (for support calls). */
export function toAdminView(incident: Incident) {
  return {
    ...toCitizenView(incident),
    reporter: incident.reporter,
    assessment: incident.assessment,
    analysis: incident.analysis,
    media: incident.media,
    assignments: incident.assignments,
    credibility: incident.credibility,
    reporterStanding: incident.reporterStanding,
    declarationAccepted: incident.declarationAccepted,
    deviceLocation: incident.deviceLocation,
  };
}
