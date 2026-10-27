// GET /incidents/{incidentId}/status — for the citizen who made the request
// (or staff). Returns progress, services responding and ETAs; no internal analysis.

import { isAdmin, requireCaller } from "../../lib/auth";
import { toCitizenView } from "../../lib/citizen-view";
import { apiHandler, HttpError, json, pathParam } from "../../lib/http";
import { getIncident } from "../../lib/incidents";

export const handler = apiHandler(async (event) => {
  const caller = requireCaller(event);
  const incident = await getIncident(pathParam(event, "incidentId"));
  if (!incident || (incident.reporterId !== caller.userId && !isAdmin(caller))) throw new HttpError(404, "Incident not found");
  const original = incident.duplicateOf ? await getIncident(incident.duplicateOf) : undefined;
  return json(200, toCitizenView(incident, original));
});
