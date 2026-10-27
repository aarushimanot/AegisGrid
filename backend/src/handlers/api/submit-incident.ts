// POST /incidents/{incidentId}/submit — called after media uploads finish.

import { HeadObjectCommand, NotFound } from "@aws-sdk/client-s3";
import { s3 } from "../../lib/aws";
import { config } from "../../lib/config";
import { isAdmin, requireCaller } from "../../lib/auth";
import { apiHandler, HttpError, json, pathParam } from "../../lib/http";
import { getIncident, setStatus } from "../../lib/incidents";
import { startAnalysis } from "../../lib/workflow";

export const handler = apiHandler(async (event) => {
  const caller = requireCaller(event);
  const incidentId = pathParam(event, "incidentId");
  const incident = await getIncident(incidentId);
  if (!incident || (incident.reporterId !== caller.userId && !isAdmin(caller))) throw new HttpError(404, "Incident not found");
  if (incident.status !== "AWAITING_MEDIA") {
    return json(200, { incidentId, status: incident.status, message: "Already submitted" });
  }

  const missing: string[] = [];
  await Promise.all(
    incident.media.map(async (m) => {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: config.mediaBucket, Key: m.key }));
      } catch (err) {
        if (err instanceof NotFound || (err as { name?: string }).name === "NotFound") missing.push(m.key);
        else throw err;
      }
    }),
  );
  if (missing.length) throw new HttpError(409, "Some media files have not been uploaded yet", { missing });

  if (await setStatus(incidentId, "ANALYZING", ["AWAITING_MEDIA"])) await startAnalysis(incidentId);
  return json(202, { incidentId, status: "ANALYZING" });
});
