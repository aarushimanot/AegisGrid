// Request schemas for the public and responder APIs.

import { z } from "zod";
import { INCIDENT_TYPES } from "./types";

const SUPPORTED_MEDIA: Record<string, "image" | "audio" | "video"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/webm": "audio",
  "audio/ogg": "audio",
  "audio/flac": "audio",
  "video/mp4": "video",
  "video/webm": "video",
};

export const mediaKindFor = (contentType: string) => SUPPORTED_MEDIA[contentType];

/** File extension used for the S3 key; Transcribe infers format from it. */
export function extensionFor(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  return map[contentType] ?? "bin";
}

export const CreateIncidentSchema = z.object({
  description: z.string().trim().max(4000).default(""),
  category: z.enum(INCIDENT_TYPES).optional(), // citizen's own pick; a hint for triage
  language: z.string().trim().min(2).max(10).optional(), // BCP-47 hint, e.g. "hi", "ta"; auto-detected if omitted
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  address: z.string().trim().max(300).optional(),
  locationSource: z.enum(["manual", "gps"]).default("manual"),
  reporter: z
    .object({
      name: z.string().trim().max(100).optional(),
      phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164, e.g. +919876543210").optional(),
    })
    .default({}),
  media: z
    .array(
      z.object({
        contentType: z.string().refine((t) => t in SUPPORTED_MEDIA, { message: `contentType must be one of ${Object.keys(SUPPORTED_MEDIA).join(", ")}` }),
        meta: z
          .object({
            source: z.enum(["camera", "gallery", "recording"]).optional(),
            capturedAt: z.string().datetime().optional(),
            location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
          })
          .optional(),
      }),
    )
    .max(5)
    .default([]),
  /** Device position at submission, when the location was typed (consistency check). */
  deviceLocation: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
  /** "False reports are a punishable offence" — must be accepted. */
  declarationAccepted: z.literal(true, { message: "You must confirm the declaration against false reporting" }),
});
export type CreateIncidentRequest = z.infer<typeof CreateIncidentSchema>;

export const UpdateResourceSchema = z
  .object({
    status: z.enum(["AVAILABLE", "BUSY", "OFFLINE"]).optional(),
    location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
    capacity: z.object({ beds: z.number().int().min(0), icuBeds: z.number().int().min(0) }).optional(),
  })
  .refine((v) => v.status || v.location || v.capacity, { message: "Provide at least one of status, location, capacity" });

export const UpdateLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100_000).optional(),
});

export const ResolveIncidentSchema = z.object({ note: z.string().max(1000).optional() }).default({});

// ── Service station registration ────────────────────────────────────────────
import { SERVICE_TYPES } from "./types";

export const StationApplicationSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES),
  name: z.string().trim().min(3).max(120),
  registrationNumber: z.string().trim().toUpperCase().min(4).max(40),
  issuingAuthority: z.string().trim().min(3).max(120),
  contactPerson: z.object({ name: z.string().trim().min(2).max(80), designation: z.string().trim().min(2).max(80) }),
  phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164, e.g. +919876543210"),
  officialEmail: z.string().trim().email(),
  address: z.string().trim().min(10).max(300),
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  unitsTotal: z.number().int().min(1).max(500),
  coverageKm: z.number().min(1).max(200).default(25),
});

export const StationDocumentsSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        kind: z.enum(["REGISTRATION_CERTIFICATE", "AUTHORITY_LETTER", "OFFICER_ID", "OTHER"]),
        contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
      }),
    )
    .min(1)
    .max(6),
});

export const CodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") });
export const SubmitApplicationSchema = z.object({ declarationAccepted: z.literal(true) });
export const StationOperationsSchema = z
  .object({ onDuty: z.boolean().optional(), unitsAvailable: z.number().int().min(0).max(500).optional(), unitsTotal: z.number().int().min(1).max(500).optional() })
  .refine((v) => v.onDuty !== undefined || v.unitsAvailable !== undefined || v.unitsTotal !== undefined, { message: "Nothing to update" });
export const TransferSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const ReviewSchema = z.object({ action: z.enum(["approve", "reject", "suspend", "reinstate"]), note: z.string().trim().max(500).optional() });
export const UserActionSchema = z.object({ action: z.enum(["disable", "enable", "delete"]) });
export const AssignSchema = z.object({ serviceType: z.enum(SERVICE_TYPES), stationId: z.string().min(1) });

export const PhoneSendSchema = z.object({ phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164, e.g. +919876543210") });
const E164 = /^\+[1-9]\d{6,14}$/;
export const AccountUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().regex(E164, "phone must be E.164, e.g. +919876543210").nullable().optional(),
    liveLocation: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.phone !== undefined || v.liveLocation !== undefined, { message: "Nothing to change" });
/** Only events the browser alone can know about (the password itself never reaches the backend). */
export const ClientActivitySchema = z.object({ event: z.literal("PASSWORD_CHANGED") });
export const FalseAlarmSchema = z.object({ reason: z.string().trim().min(5).max(300) });
export const StandingSchema = z.object({ action: z.enum(["reset", "suspend", "reinstate", "reverse_false_alarm"]), note: z.string().trim().max(300).optional() });
