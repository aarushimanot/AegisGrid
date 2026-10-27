// PATCH /me/incidents/{incidentId}/location — live GPS updates from the citizen's
// device while help is on the way (only for requests made with live location).

import { requireCaller } from "../../lib/auth";
import { apiHandler, HttpError, json, parseBody, pathParam } from "../../lib/http";
import { updateLiveLocation } from "../../lib/incidents";
import { UpdateLocationSchema } from "../../lib/validation";

export const handler = apiHandler(async (event) => {
  const caller = requireCaller(event);
  const incidentId = pathParam(event, "incidentId");
  const { lat, lon } = parseBody(event, UpdateLocationSchema);
  if (!(await updateLiveLocation(incidentId, caller.userId, lat, lon))) {
    throw new HttpError(409, "Live location is not active for this request");
  }
  return json(200, { incidentId, location: { lat, lon } });
});
