// GET /services — the eight emergency services and the approved stations
// registered under each, for citizens to browse. Contact numbers and live
// capacity are not exposed.

import { requireCaller } from "../../lib/auth";
import { SERVICE_LIST } from "../../lib/catalog";
import { apiHandler, json } from "../../lib/http";
import { listApproved } from "../../lib/stations";

export const handler = apiHandler(async (event) => {
  requireCaller(event);
  const services = await Promise.all(SERVICE_LIST.map(async (s) => {
    const stations = await listApproved(s.type);
    return {
      id: s.type,
      name: s.name,
      helpline: s.helpline,
      description: s.description,
      stations: stations.map((st) => ({ id: st.stationId, name: st.name, address: st.address, location: st.location, onDuty: st.onDuty })),
    };
  }));
  return json(200, { services });
});
