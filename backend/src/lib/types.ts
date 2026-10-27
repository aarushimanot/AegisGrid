// Domain model shared by every AegisGrid Lambda and by the web app's demo
// engine (this file has no runtime dependencies).

/** The eight emergency services. Each is an autonomous agent and a category stations register under. */
export const SERVICE_TYPES = [
  "AMBULANCE",
  "FIRE",
  "POLICE",
  "TRAFFIC_POLICE",
  "HOSPITAL",
  "DISASTER_RESPONSE",
  "WOMEN_CHILD_SAFETY",
  "UTILITY_EMERGENCY",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/** Kept as an alias: the AI assessment's `requiredAgents` are service types. */
export const AGENTS = SERVICE_TYPES;
export type AgentName = ServiceType;

export const INCIDENT_TYPES = [
  "ROAD_ACCIDENT",
  "MEDICAL",
  "FIRE",
  "NATURAL_DISASTER",
  "CRIME",
  "HARASSMENT",
  "HAZMAT",
  "UTILITY",
  "OTHER",
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export type IncidentStatus =
  | "AWAITING_MEDIA" // created, client still uploading media to S3
  | "ANALYZING" // AI perception + triage running
  | "ASSESSED" // assessment done; agents are finding the nearest stations
  | "DISPATCHED" // at least one station has accepted
  | "RESOLVED"
  | "FAILED";

export type MediaKind = "image" | "audio" | "video";

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface MediaMeta {
  /** How the file was captured: live camera, gallery upload, or in-app voice recording. */
  source?: "camera" | "gallery" | "recording";
  /** From the photo's EXIF data (read in the browser, and again on the server for images). */
  capturedAt?: string;
  location?: GeoPoint;
}

export interface MediaItem {
  key: string; // S3 object key in the media bucket
  kind: MediaKind;
  contentType: string;
  meta?: MediaMeta;
}

export interface Reporter {
  userId?: string; // Cognito sub of the citizen account
  name?: string;
  email?: string;
  phone?: string;
}

/** Severity 1 (minor) .. 5 (mass-casualty / life-threatening). */
export type Severity = 1 | 2 | 3 | 4 | 5;

export interface ImageFinding {
  key: string;
  labels: { name: string; confidence: number }[];
  /** Capture time / GPS read from the file's EXIF data on the server. */
  exif?: { capturedAt?: string; location?: GeoPoint };
}

export interface TextAnalysis {
  originalLanguage: string;
  translatedText: string; // English text used for downstream reasoning
  sentiment?: string;
  entities: { type: string; text: string }[];
  keyPhrases: string[];
}

export interface Assessment {
  incidentType: IncidentType;
  severity: Severity;
  /** 0-100: how sure the assessor is of type and severity. */
  confidence: number;
  summary: string;
  estimatedCasualties: number;
  hazards: string[];
  requiredAgents: ServiceType[];
  recommendations: string[];
  source: "BEDROCK+RULES" | "RULES_ONLY";
  modelId?: string;
}

// ── Service stations (registered help-service accounts) ────────────────────

export type StationStatus =
  | "DRAFT" // registration in progress
  | "PENDING_REVIEW" // all verification steps done, waiting for the admin
  | "APPROVED" // live: receives requests
  | "REJECTED"
  | "SUSPENDED";

export interface StationDocument {
  key: string; // S3 key in the media bucket (stations/<id>/...)
  name: string;
  kind: "REGISTRATION_CERTIFICATE" | "AUTHORITY_LETTER" | "OFFICER_ID" | "OTHER";
  uploadedAt: string;
}

export interface Station {
  stationId: string; // = owner's Cognito sub (one station per service account)
  ownerUserId: string;
  ownerEmail: string;
  serviceType: ServiceType;
  name: string;
  registrationNumber: string;
  issuingAuthority: string;
  contactPerson: { name: string; designation: string };
  phone: string;
  officialEmail: string;
  address: string;
  location: GeoPoint;
  /** Crews / vehicles / beds the station can commit at once. */
  unitsTotal: number;
  unitsAvailable: number;
  /** Maximum distance the station serves. */
  coverageKm: number;
  onDuty: boolean;
  status: StationStatus;
  verification: {
    phoneVerified: boolean;
    phoneOtp?: { hash: string; expiresAt: string; attempts: number };
    documents: StationDocument[];
    declarationAccepted: boolean;
    submittedAt?: string;
    reviewedAt?: string;
    reviewedBy?: string;
    reviewNote?: string;
  };
  stats: { offered: number; accepted: number; transferred: number; completed: number; totalResponseMinutes: number; falseAlarms?: number };
  createdAt: string;
  updatedAt: string;
}

// ── Assignment of one service to one incident ──────────────────────────────

export type AssignmentStatus =
  | "SEARCHING" // looking for the nearest available station
  | "OFFERED" // waiting for the station to accept
  | "ACCEPTED" // station committed a unit; en route
  | "ARRIVED" // arrival confirmed with the citizen's one-time code
  | "COMPLETED" // completion confirmed with a second one-time code
  | "UNAVAILABLE" // no station of this type could take it; escalated to admin
  | "FALSE_ALARM" // responder reached the location and found no emergency
  | "CANCELLED";

export interface AssignmentAttempt {
  stationId: string;
  stationName: string;
  outcome: "TRANSFERRED" | "EXPIRED" | "REASSIGNED";
  reason?: string;
  at: string;
}

export interface ServiceAssignment {
  serviceType: ServiceType;
  status: AssignmentStatus;
  offerId?: string;
  stationId?: string;
  stationName?: string;
  stationPhone?: string;
  stationAddress?: string;
  stationLocation?: GeoPoint;
  distanceKm?: number;
  etaMinutes?: number;
  offeredAt?: string;
  expiresAt?: string;
  acceptedAt?: string;
  arrivedAt?: string;
  completedAt?: string;
  /** One-time codes the citizen hands to the responder. Never shown to the station. */
  arrivalOtp?: string;
  completionOtp?: string;
  /** Wrong code entries for the current one-time code (rotated after too many). */
  otpAttempts?: number;
  /** Request created → responder's arrival confirmed by the citizen's code. */
  responseMinutes?: number;
  tried: AssignmentAttempt[];
  note?: string;
  updatedAt: string;
}

export interface Incident {
  incidentId: string;
  status: IncidentStatus;
  createdAt: string;
  updatedAt: string;
  reporter: Reporter;
  description: string;
  /** Emergency type the citizen selected, if any. A hint only; the AI decides. */
  reportedCategory?: IncidentType;
  language?: string;
  location: GeoPoint;
  address?: string;
  media: MediaItem[];
  analysis?: {
    text?: TextAnalysis;
    images?: ImageFinding[];
    transcripts?: { key: string; text: string; languageCode?: string }[];
  };
  assessment?: Assessment;
  assignments: Partial<Record<ServiceType, ServiceAssignment>>;
  /** Owner's account (Cognito sub); indexed for the citizen's request history. */
  reporterId?: string;
  /** "manual" when the citizen typed/picked the location, "gps" when taken from the device. */
  locationSource?: "manual" | "gps";
  /** Last live-location update from the citizen's device (gps mode). */
  locationUpdatedAt?: string;
  /** First responder arrival confirmed: incident response time = firstArrivalAt - createdAt. */
  firstArrivalAt?: string;
  resolvedAt?: string;
  /** The citizen accepted the legal declaration against false reporting. */
  declarationAccepted?: boolean;
  /** Where the citizen's device was when a manually typed location was submitted. */
  deviceLocation?: GeoPoint;
  /** How believable the report is, from evidence consistency and the citizen's history. */
  credibility?: Credibility;
  /** The reporter's account standing when the request was assessed (shown to stations). */
  reporterStanding?: CitizenStanding;
  /** Same emergency already reported nearby: this request is linked to that one. */
  duplicateOf?: string;
  /** How the request ended. */
  outcome?: "SERVED" | "FALSE_ALARM" | "CLOSED_BY_ADMIN" | "DUPLICATE";
}

export interface Credibility {
  score: number; // 0-100
  level: "HIGH" | "MEDIUM" | "LOW";
  flags: string[];
}

export type CitizenStanding = "GOOD" | "WARNING" | "RESTRICTED" | "SUSPENDED";

/** Trust and verification state of a citizen account. */
export interface CitizenProfile {
  userId: string;
  email?: string;
  name?: string;
  phone?: string;
  phoneVerified: boolean;
  phoneOtp?: { hash: string; phone: string; expiresAt: string; attempts: number };
  trustScore: number; // 0-100, starts at 50
  genuineRequests: number;
  falseAlarms: number;
  standing: CitizenStanding;
  /** Request timestamps in the last hour (rate limiting). */
  recentRequests: string[];
  history: { at: string; event: string }[];
  createdAt: string;
  updatedAt: string;
}

/** One request offered to one station: the station's inbox item. */
export type OfferStatus = "OFFERED" | "ACCEPTED" | "ARRIVED" | "COMPLETED" | "TRANSFERRED" | "EXPIRED" | "FALSE_ALARM" | "CANCELLED";

export interface Offer {
  offerId: string;
  stationId: string;
  incidentId: string;
  serviceType: ServiceType;
  status: OfferStatus;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  distanceKm: number;
  etaMinutes: number;
  /** Snapshot for the station's screen. */
  incident: {
    createdAt: string;
    incidentType?: IncidentType;
    severity?: Severity;
    summary: string;
    description: string;
    hazards: string[];
    location: GeoPoint;
    address?: string;
    locationSource: "manual" | "gps";
    citizenName?: string;
    citizenPhone?: string;
    otherServices: ServiceType[];
    credibility?: Credibility;
    citizenStanding?: CitizenStanding;
  };
  transferReason?: string;
  acceptedAt?: string;
  arrivedAt?: string;
  completedAt?: string;
  /** Request created → this station's verified arrival. */
  responseMinutes?: number;
}

/** Payload of the `Incident.Assessed` EventBridge event every agent consumes. */
export interface IncidentAssessedDetail {
  incidentId: string;
  incidentType: IncidentType;
  severity: Severity;
  location: GeoPoint;
  summary: string;
  estimatedCasualties: number;
  hazards: string[];
  requiredAgents: ServiceType[];
}
