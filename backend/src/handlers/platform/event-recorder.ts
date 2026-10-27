// Records every AegisGrid bus event:
//   - on the incident's timeline (the audit trail shown to the admin), and
//   - on the activity log of each account involved: the citizen who made the
//     request and the station the event concerns.

import type { EventBridgeEvent } from "aws-lambda";
import { logActivity } from "../../lib/activity";
import { getIncident } from "../../lib/incidents";
import { log } from "../../lib/logger";
import { renderEvent } from "../../lib/messages";
import { appendTimeline } from "../../lib/timeline";

const ACTION: Record<string, string> = {
  "Incident.Assessed": "REQUEST_ASSESSED", "Incident.AnalysisFailed": "ANALYSIS_FAILED", "Incident.Resolved": "REQUEST_RESOLVED",
  "Incident.DuplicateLinked": "DUPLICATE_LINKED", "Offer.Created": "OFFER_RECEIVED", "Offer.Accepted": "OFFER_ACCEPTED",
  "Offer.Transferred": "OFFER_TRANSFERRED", "Offer.Expired": "OFFER_MISSED", "Service.Arrived": "ARRIVAL_VERIFIED",
  "Service.Completed": "SERVICE_COMPLETED", "Service.Unavailable": "NO_STATION_AVAILABLE", "Service.FalseAlarm": "FALSE_ALARM",
  "Station.Submitted": "APPLICATION_SUBMITTED", "Station.Reviewed": "APPLICATION_REVIEWED",
};

export const handler = async (event: EventBridgeEvent<string, Record<string, unknown>>) => {
  const type = event["detail-type"];
  const d = event.detail;
  const incidentId = typeof d.incidentId === "string" ? d.incidentId : undefined;
  const summary = renderEvent(type, d)?.subject.replace("[AegisGrid] ", "") ?? type;

  if (incidentId) {
    await appendTimeline({ incidentId, at: event.time, eventId: event.id, source: event.source, detailType: type, summary, detail: d });
  }

  const action = ACTION[type];
  if (!action) {
    if (!incidentId) log.warn("Event without incidentId or account ignored", { detailType: type });
    return;
  }
  const reporterId = typeof d.reporterId === "string" ? d.reporterId : incidentId ? (await getIncident(incidentId))?.reporterId : undefined;
  const stationId = typeof d.stationId === "string" ? d.stationId : undefined; // a station's id is its owner's account id
  const entry = { at: event.time, eventId: event.id, action, summary, incidentId, detail: d };
  await Promise.all([
    reporterId && logActivity(reporterId, { ...entry, category: "REQUEST" }),
    stationId && logActivity(stationId, { ...entry, category: type.startsWith("Station.") ? "VERIFICATION" : "RESPONSE" }),
  ]);
};
