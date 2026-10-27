// A station's request inbox and actions.
//
//   GET  /station/offers                         incoming, active and past requests
//   POST /station/offers/{offerId}/accept         commit a unit
//   POST /station/offers/{offerId}/transfer       {reason}: all crews busy, send to next nearest
//   POST /station/offers/{offerId}/arrive         {code}: citizen's arrival code (response time)
//   POST /station/offers/{offerId}/complete       {code}: citizen's completion code
//   POST /station/offers/{offerId}/false-alarm    {reason}: no emergency at the scene

import { requireCaller } from "../../lib/auth";
import { acceptOffer, completeService, confirmArrival, reportFalseAlarm, transferOffer } from "../../lib/dispatch";
import { apiHandler, HttpError, json, parseBody } from "../../lib/http";
import { listByStation } from "../../lib/offers";
import { getStation } from "../../lib/stations";
import { CodeSchema, FalseAlarmSchema, TransferSchema } from "../../lib/validation";

export const handler = apiHandler(async (event) => {
  const caller = requireCaller(event, ["service"]);
  const station = await getStation(caller.userId);
  if (!station || station.status !== "APPROVED") throw new HttpError(403, "Your station is not active");

  if (event.httpMethod === "GET") {
    return json(200, { items: await listByStation(station.stationId) });
  }

  const offerId = event.pathParameters?.offerId ?? "";
  switch (event.pathParameters?.action) {
    case "accept":
      return json(200, { assignment: redact(await acceptOffer(station.stationId, offerId)) });
    case "transfer":
      await transferOffer(station.stationId, offerId, parseBody(event, TransferSchema).reason);
      return json(200, { transferred: true });
    case "arrive":
      return json(200, { assignment: redact(await confirmArrival(station.stationId, offerId, parseBody(event, CodeSchema).code)) });
    case "complete":
      return json(200, { assignment: redact(await completeService(station.stationId, offerId, parseBody(event, CodeSchema).code)) });
    case "false-alarm":
      return json(200, { assignment: redact(await reportFalseAlarm(station.stationId, offerId, parseBody(event, FalseAlarmSchema).reason)) });
    default:
      throw new HttpError(404, "Unknown action");
  }
});

/** Stations must never see the citizen's one-time codes. */
const redact = <T extends { arrivalOtp?: string; completionOtp?: string }>(a: T) => ({ ...a, arrivalOtp: undefined, completionOtp: undefined });
