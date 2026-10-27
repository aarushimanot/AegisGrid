// Step Functions catch-all: the workflow could not finish. Flag the incident and
// escalate to the human control room so a report is never silently dropped.

import { DETAIL_TYPE, EVENT_SOURCE } from "../../lib/config";
import { publish } from "../../lib/events";
import { getIncident, setStatus } from "../../lib/incidents";
import { log } from "../../lib/logger";

export const handler = async (input: { incidentId: string; error?: { Error?: string; Cause?: string } }) => {
  log.with({ incidentId: input.incidentId });
  log.error("Incident analysis failed", { cause: input.error });
  await setStatus(input.incidentId, "FAILED", ["ANALYZING", "ASSESSED"]);
  const incident = await getIncident(input.incidentId);
  await publish(EVENT_SOURCE.orchestrator, DETAIL_TYPE.incidentAnalysisFailed, {
    incidentId: input.incidentId,
    location: incident?.location,
    description: incident?.description?.slice(0, 500),
    error: input.error?.Error ?? "Unknown",
  });
  return { incidentId: input.incidentId, status: "FAILED" };
};
