// GET /me/incidents — the signed-in citizen's request history with response times.

import { requireCaller } from "../../lib/auth";
import { toCitizenView } from "../../lib/citizen-view";
import { apiHandler, json } from "../../lib/http";
import { getIncident, listByReporter } from "../../lib/incidents";

export const handler = apiHandler(async (event) => {
  const caller = requireCaller(event);
  const items = await listByReporter(caller.userId);
  const originals = new Map(
    await Promise.all([...new Set(items.map((i) => i.duplicateOf).filter((x): x is string => !!x))].map(async (id) => [id, await getIncident(id)] as const)),
  );
  return json(200, { items: items.map((i) => toCitizenView(i, i.duplicateOf ? originals.get(i.duplicateOf) : undefined)) });
});
