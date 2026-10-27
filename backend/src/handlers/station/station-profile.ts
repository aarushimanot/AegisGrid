// Service station registration and profile.
//
//   GET   /station/me                    own station (null before registering)
//   PUT   /station/me                    save application details (draft / rejected)
//   POST  /station/me/documents          pre-signed uploads for verification documents
//   POST  /station/me/phone-otp          send a code to the station's contact phone
//   POST  /station/me/verify-phone       confirm that code
//   POST  /station/me/submit             submit for admin review (all checks must pass)
//   PATCH /station/me                    approved stations: on-duty, units available/total

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { logActivity } from "../../lib/activity";
import { requireCaller } from "../../lib/auth";
import { s3 } from "../../lib/aws";
import { isValidRegistration, SERVICES } from "../../lib/catalog";
import { config, DETAIL_TYPE, EVENT_SOURCE } from "../../lib/config";
import { newOtp } from "../../lib/core";
import { publish } from "../../lib/events";
import { apiHandler, HttpError, json, parseBody } from "../../lib/http";
import { deliverCode, hashCode } from "../../lib/otp-delivery";
import { toStationView } from "../../lib/station-view";
import { getStation, putStation } from "../../lib/stations";
import type { Station } from "../../lib/types";
import { CodeSchema, StationApplicationSchema, StationDocumentsSchema, StationOperationsSchema, SubmitApplicationSchema } from "../../lib/validation";

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const editable = (s?: Station) => !s || s.status === "DRAFT" || s.status === "REJECTED";

export const handler = apiHandler(async (event: APIGatewayProxyEvent) => {
  const caller = requireCaller(event, ["applicant", "service"]);
  const action = event.pathParameters?.action;
  const method = event.httpMethod;
  const station = await getStation(caller.userId);
  const now = new Date().toISOString();

  if (method === "GET") return json(200, { station: station ? toStationView(station) : null });

  if (method === "PUT") {
    if (!editable(station)) throw new HttpError(409, "Your application is under review or already approved");
    const req = parseBody(event, StationApplicationSchema);
    if (!isValidRegistration(req.serviceType, req.registrationNumber)) {
      throw new HttpError(400, `Registration number format is not valid for ${SERVICES[req.serviceType].name}. Example: ${SERVICES[req.serviceType].registration.example}`);
    }
    const phoneChanged = station && station.phone !== req.phone;
    const next: Station = {
      stationId: caller.userId,
      ownerUserId: caller.userId,
      ownerEmail: caller.email ?? "",
      ...req,
      unitsAvailable: req.unitsTotal,
      onDuty: false,
      status: "DRAFT",
      verification: {
        phoneVerified: phoneChanged ? false : (station?.verification.phoneVerified ?? false),
        documents: station?.verification.documents ?? [],
        declarationAccepted: false,
        reviewNote: station?.verification.reviewNote,
      },
      stats: station?.stats ?? { offered: 0, accepted: 0, transferred: 0, completed: 0, totalResponseMinutes: 0 },
      createdAt: station?.createdAt ?? now,
      updatedAt: now,
    };
    await putStation(next);
    await logActivity(caller.userId, {
      category: "VERIFICATION", action: station ? "APPLICATION_UPDATED" : "APPLICATION_STARTED",
      summary: `${station ? "Updated" : "Started"} registration of ${next.name} (${SERVICES[next.serviceType].name}, ${next.registrationNumber})`,
    });
    return json(200, { station: toStationView(next) });
  }

  if (method === "PATCH") {
    if (!station || station.status !== "APPROVED") throw new HttpError(403, "Only approved stations can change operations");
    const req = parseBody(event, StationOperationsSchema);
    const unitsTotal = req.unitsTotal ?? station.unitsTotal;
    const next: Station = {
      ...station,
      onDuty: req.onDuty ?? station.onDuty,
      unitsTotal,
      unitsAvailable: Math.min(unitsTotal, req.unitsAvailable ?? station.unitsAvailable),
      updatedAt: now,
    };
    await putStation(next);
    const changes = [
      next.onDuty !== station.onDuty && (next.onDuty ? "went on duty" : "went off duty"),
      next.unitsTotal !== station.unitsTotal && `total units ${station.unitsTotal} → ${next.unitsTotal}`,
      next.unitsAvailable !== station.unitsAvailable && `free units ${station.unitsAvailable} → ${next.unitsAvailable}`,
    ].filter(Boolean);
    if (changes.length) await logActivity(caller.userId, { category: "OPERATIONS", action: "OPERATIONS_CHANGED", summary: `Station ${changes.join(", ")}` });
    return json(200, { station: toStationView(next) });
  }

  if (!station) throw new HttpError(400, "Save your service details first");
  if (!editable(station)) throw new HttpError(409, "Your application is under review or already approved");

  if (action === "documents") {
    const { files } = parseBody(event, StationDocumentsSchema);
    const uploads = await Promise.all(files.map(async (f) => {
      const key = `stations/${station.stationId}/${f.kind.toLowerCase()}-${randomUUID().slice(0, 8)}.${EXT[f.contentType]}`;
      const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: config.mediaBucket, Key: key, ContentType: f.contentType }), { expiresIn: 900 });
      return { key, url, name: f.name, kind: f.kind, contentType: f.contentType };
    }));
    station.verification.documents = [
      ...station.verification.documents,
      ...uploads.map((u) => ({ key: u.key, name: u.name, kind: u.kind, uploadedAt: now })),
    ];
    station.updatedAt = now;
    await putStation(station);
    await logActivity(caller.userId, { category: "VERIFICATION", action: "DOCUMENTS_UPLOADED", summary: `Uploaded ${uploads.map((u) => `${u.name} (${u.kind.toLowerCase().replace(/_/g, " ")})`).join(", ")}` });
    return json(200, { uploads: uploads.map(({ key, url, contentType }) => ({ key, url, contentType })), station: toStationView(station) });
  }

  if (action === "phone-otp") {
    const code = newOtp();
    station.verification.phoneOtp = { hash: hashCode(code, station.stationId), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), attempts: 0 };
    await putStation(station);
    const delivery = await deliverCode(station.phone, station.officialEmail, code);
    await logActivity(caller.userId, { category: "VERIFICATION", action: "PHONE_CODE_SENT", summary: `Verification code sent to ${station.phone} (${delivery.channel})` });
    return json(200, delivery);
  }

  if (action === "verify-phone") {
    const { code } = parseBody(event, CodeSchema);
    const otp = station.verification.phoneOtp;
    if (!otp || Date.parse(otp.expiresAt) < Date.now()) throw new HttpError(400, "Code expired. Request a new one.");
    if (otp.attempts >= 5) throw new HttpError(429, "Too many attempts. Request a new code.");
    if (hashCode(code, station.stationId) !== otp.hash) {
      station.verification.phoneOtp = { ...otp, attempts: otp.attempts + 1 };
      await putStation(station);
      throw new HttpError(400, "Code does not match");
    }
    station.verification.phoneVerified = true;
    delete station.verification.phoneOtp;
    await putStation(station);
    await logActivity(caller.userId, { category: "VERIFICATION", action: "PHONE_VERIFIED", summary: `Station phone ${station.phone} verified` });
    return json(200, { station: toStationView(station) });
  }

  if (action === "submit") {
    parseBody(event, SubmitApplicationSchema);
    const docs = station.verification.documents;
    const missing: string[] = [];
    if (!station.verification.phoneVerified) missing.push("verified contact phone");
    if (!docs.some((d) => d.kind === "REGISTRATION_CERTIFICATE")) missing.push("registration certificate");
    if (!docs.some((d) => d.kind === "AUTHORITY_LETTER")) missing.push("authority letter");
    if (!docs.some((d) => d.kind === "OFFICER_ID")) missing.push("officer-in-charge ID");
    if (missing.length) throw new HttpError(400, `Complete these steps first: ${missing.join(", ")}`);
    station.status = "PENDING_REVIEW";
    station.verification.declarationAccepted = true;
    station.verification.submittedAt = now;
    station.updatedAt = now;
    await putStation(station);
    await publish(EVENT_SOURCE.station, DETAIL_TYPE.stationSubmitted, { stationId: station.stationId, name: station.name, serviceType: station.serviceType });
    return json(200, { station: toStationView(station) });
  }

  throw new HttpError(404, "Unknown action");
});
