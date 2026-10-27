// Human-readable rendering of bus events, shared by the notifier (SNS/SES)
// and the timeline recorder.

import { SERVICES } from "./catalog";
import type { IncidentAssessedDetail, ServiceType } from "./types";

export type Department = ServiceType | "CONTROL_ROOM";

export interface RenderedEvent {
  departments: Department[];
  severity: number;
  subject: string;
  body: string;
}

const SEVERITY = ["", "Minor", "Moderate", "Serious", "Critical", "Mass casualty"];
const short = (id: unknown) => String(id ?? "").slice(0, 8).toUpperCase();
const mapLink = (p?: { lat: number; lon: number }) => (p ? `https://maps.google.com/?q=${p.lat},${p.lon}` : "");
const svc = (t: unknown) => SERVICES[t as ServiceType]?.name ?? String(t);

export function renderEvent(detailType: string, d: Record<string, unknown>): RenderedEvent | undefined {
  const type = d.serviceType as ServiceType;
  switch (detailType) {
    case "Incident.Assessed": {
      const a = d as unknown as IncidentAssessedDetail;
      return {
        departments: ["CONTROL_ROOM"],
        severity: a.severity,
        subject: `[AegisGrid] ${SEVERITY[a.severity]} ${a.incidentType.replace("_", " ")} #${short(a.incidentId)}`,
        body: [a.summary, `Severity ${a.severity}/5 · services: ${a.requiredAgents.map(svc).join(", ")}`, `Location: ${mapLink(a.location)}`].join("\n"),
      };
    }
    case "Offer.Created":
      return {
        departments: [type],
        severity: 4,
        subject: `[AegisGrid] New ${svc(type)} request for ${d.stationName} #${short(d.incidentId)}`,
        body: `${d.byAdmin ? "Assigned by the admin. " : ""}Open the AegisGrid station console to accept or transfer it.${d.distanceKm ? ` Distance ${d.distanceKm} km.` : ""}`,
      };
    case "Offer.Accepted":
      return { departments: ["CONTROL_ROOM"], severity: 3, subject: `[AegisGrid] ${d.stationName} accepted #${short(d.incidentId)}`, body: `${svc(type)} en route, ETA ~${d.etaMinutes ?? "?"} min.` };
    case "Offer.Transferred":
      return { departments: ["CONTROL_ROOM"], severity: 3, subject: `[AegisGrid] ${d.stationName} transferred #${short(d.incidentId)}`, body: `Reason: ${d.reason}. Offered to the next nearest ${svc(type)} station.` };
    case "Offer.Expired":
      return { departments: ["CONTROL_ROOM"], severity: 3, subject: `[AegisGrid] ${d.stationName} did not respond #${short(d.incidentId)}`, body: `Moved to the next nearest ${svc(type)} station.` };
    case "Service.Arrived":
      return { departments: ["CONTROL_ROOM"], severity: 2, subject: `[AegisGrid] ${d.stationName} arrived #${short(d.incidentId)}`, body: `Arrival verified with the citizen's code. Response time ${d.responseMinutes} min.` };
    case "Service.Completed":
      return { departments: ["CONTROL_ROOM"], severity: 1, subject: `[AegisGrid] ${d.stationName} completed #${short(d.incidentId)}`, body: `Completion verified with the citizen's code.` };
    case "Service.Unavailable":
      return { departments: ["CONTROL_ROOM", type], severity: 5, subject: `[AegisGrid] ESCALATION: no ${svc(type)} station available #${short(d.incidentId)}`, body: `Tried ${d.tried} station(s). Assign one manually in the admin console.` };
    case "Service.FalseAlarm":
      return { departments: ["CONTROL_ROOM"], severity: 2, subject: `[AegisGrid] False alarm reported by ${d.stationName} #${short(d.incidentId)}`, body: `Reason: ${d.reason}. A strike was recorded against the reporter; reverse it in the admin console if this was a genuine call.` };
    case "Incident.DuplicateLinked":
      return { departments: ["CONTROL_ROOM"], severity: 1, subject: `[AegisGrid] Duplicate report #${short(d.incidentId)} linked to #${short(d.originalIncidentId)}`, body: "Same emergency already reported nearby; no extra units dispatched." };
    case "Station.Submitted":
      return { departments: ["CONTROL_ROOM"], severity: 1, subject: `[AegisGrid] New ${svc(type)} station awaiting verification`, body: `${d.name} submitted its registration. Review it in the admin console.` };
    case "Station.Reviewed":
      return { departments: ["CONTROL_ROOM"], severity: 1, subject: `[AegisGrid] Station ${d.name}: ${d.action}`, body: d.note ? `Note: ${String(d.note)}` : "" };
    case "Incident.AnalysisFailed":
      return { departments: ["CONTROL_ROOM"], severity: 5, subject: `[AegisGrid] ESCALATION: automatic analysis failed #${short(d.incidentId)}`, body: `Triage manually. Report: ${String(d.description ?? "(none)")}\nLocation: ${mapLink(d.location as { lat: number; lon: number } | undefined)}` };
    case "Incident.Resolved":
      return { departments: ["CONTROL_ROOM"], severity: 1, subject: `[AegisGrid] Incident #${short(d.incidentId)} resolved`, body: d.note ? `Note: ${String(d.note)}` : "Closed." };
    default:
      return undefined;
  }
}
