// POST /incidents — a signed-in citizen requests emergency help.
//
// Text-only reports start analysis immediately. Reports with media get one
// pre-signed S3 PUT URL per file; the client uploads directly to S3 and then
// calls POST /incidents/{id}/submit.

import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../../lib/aws";
import { config } from "../../lib/config";
import { requireCaller } from "../../lib/auth";
import { apiHandler, HttpError, json, parseBody } from "../../lib/http";
import { createIncident } from "../../lib/incidents";
import { logActivity } from "../../lib/activity";
import { ensureProfile, putProfile } from "../../lib/citizens";
import { checkRateLimit } from "../../lib/integrity";
import { log } from "../../lib/logger";
import type { Incident, MediaItem } from "../../lib/types";
import { CreateIncidentSchema, extensionFor, mediaKindFor } from "../../lib/validation";
import { startAnalysis } from "../../lib/workflow";

export const handler = apiHandler(async (event) => {
  const caller = requireCaller(event, ["citizen"]);
  const req = parseBody(event, CreateIncidentSchema);

  // Accountability checks. None of them inspect the emergency itself: a verified,
  // non-suspended citizen within the rate limit is always dispatched.
  const nowIso = new Date().toISOString();
  const profile = await ensureProfile(caller.userId, { email: caller.email, name: caller.name });
  const refused = (reason: string) => logActivity(caller.userId, { category: "REQUEST", action: "REQUEST_REFUSED", summary: `Request refused: ${reason}` });
  if (profile.standing === "SUSPENDED") {
    await refused("account suspended");
    throw new HttpError(403, "This account is suspended for repeated false reports. In an emergency call 112.", { code: "SUSPENDED" });
  }
  if (!profile.phoneVerified) {
    await refused("mobile number not verified");
    throw new HttpError(403, "Verify your mobile number before your first request.", { code: "PHONE_NOT_VERIFIED" });
  }
  const rate = checkRateLimit(profile, nowIso);
  if (!rate.allowed) {
    await refused(`hourly limit of ${rate.limit} reached`);
    throw new HttpError(429, `Request limit reached (${rate.limit} per hour for this account). Try again in ${rate.retryAfterMinutes} min, or call 112 in an emergency.`, { code: "RATE_LIMITED" });
  }
  await putProfile({ ...profile, recentRequests: [...rate.recent, nowIso], updatedAt: nowIso });
  if (!req.description && req.media.length === 0) {
    throw new HttpError(400, "Provide a description or at least one photo, video or voice recording");
  }

  const incidentId = randomUUID();
  const now = new Date().toISOString();
  const media: MediaItem[] = req.media.map((m, i) => ({
    key: `incidents/${incidentId}/media-${i}.${extensionFor(m.contentType)}`,
    kind: mediaKindFor(m.contentType)!,
    contentType: m.contentType,
    meta: m.meta,
  }));

  const incident: Incident = {
    incidentId,
    status: media.length ? "AWAITING_MEDIA" : "ANALYZING",
    createdAt: now,
    updatedAt: now,
    reporter: {
      userId: caller.userId,
      name: req.reporter.name || caller.name,
      email: caller.email,
      phone: profile.phone || req.reporter.phone || caller.phone,
    },
    reporterId: caller.userId,
    locationSource: req.locationSource,
    declarationAccepted: true,
    deviceLocation: req.deviceLocation,
    description: req.description,
    reportedCategory: req.category,
    language: req.language,
    location: req.location,
    address: req.address,
    media,
    assignments: {},
  };
  await createIncident(incident);
  log.info("Incident reported", { incidentId, mediaCount: media.length });
  await logActivity(caller.userId, {
    category: "REQUEST", action: "REQUEST_SENT", incidentId,
    summary: `Requested help${req.address ? ` at ${req.address}` : req.locationSource === "gps" ? " (live location)" : ""} with ${media.length ? `${media.length} file(s)` : "a written report"}`,
    detail: { locationSource: req.locationSource, media: media.map((m) => ({ kind: m.kind, source: m.meta?.source })) },
  });

  const uploads = await Promise.all(
    media.map(async (m) => ({
      key: m.key,
      contentType: m.contentType,
      method: "PUT",
      url: await getSignedUrl(s3, new PutObjectCommand({ Bucket: config.mediaBucket, Key: m.key, ContentType: m.contentType }), {
        expiresIn: config.uploadUrlTtlSeconds,
      }),
    })),
  );

  if (!media.length) await startAnalysis(incidentId);

  return json(201, {
    incidentId,
    status: incident.status,
    uploads,
    next: media.length
      ? `Upload each file with HTTP PUT (Content-Type header must match), then POST /incidents/${incidentId}/submit`
      : `Track progress at GET /incidents/${incidentId}/status`,
  });
});
