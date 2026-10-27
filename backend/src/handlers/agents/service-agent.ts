// Service Agent — one deployed function per emergency service (SERVICE_TYPE).
//
// On Incident.Assessed where requiredAgents contains this service, the agent
// finds the nearest approved, on-duty station with a free unit, measured from
// the station's registered address to the citizen's location, and offers it the
// request. Acceptance, transfer and expiry are handled by the station API and
// the offer sweeper, which hand the request to the next nearest station.

import type { EventBridgeEvent } from "aws-lambda";
import { offerToNearest } from "../../lib/dispatch";
import { mustGetIncident } from "../../lib/incidents";
import { log } from "../../lib/logger";
import { claimTask, releaseTask } from "../../lib/timeline";
import type { IncidentAssessedDetail, ServiceType } from "../../lib/types";

const SERVICE = process.env.SERVICE_TYPE as ServiceType;

export const handler = async (event: EventBridgeEvent<"Incident.Assessed", IncidentAssessedDetail>) => {
  const { incidentId } = event.detail;
  log.with({ incidentId, agent: SERVICE });
  if (!(await claimTask(incidentId, SERVICE))) {
    log.info("Duplicate event: already handled");
    return;
  }
  try {
    const incident = await mustGetIncident(incidentId);
    if (incident.status === "RESOLVED") return;
    const a = await offerToNearest(incident, SERVICE);
    log.info("Agent decision", { status: a.status, station: a.stationName, distanceKm: a.distanceKm });
  } catch (err) {
    await releaseTask(incidentId, SERVICE);
    throw err;
  }
};
