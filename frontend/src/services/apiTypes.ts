// Shapes exchanged with the AegisGrid backend. The domain types come straight
// from the backend (via the @core alias) so both sides always agree.

import type { toAdminView, toCitizenView } from '@core/citizen-view';
import type { toStationView } from '@core/station-view';
import type { CitizenProfile, GeoPoint, IncidentStatus, IncidentType, Offer, ServiceType, StationStatus } from '@core/types';

export type { GeoPoint, IncidentStatus, IncidentType, Offer, ServiceType, StationStatus };
export type { CitizenStanding, Credibility, MediaMeta } from '@core/types';

/** A citizen's trust record (never includes the phone code). */
export type ApiProfile = Omit<CitizenProfile, 'phoneOtp'>;
export type StandingAction = 'reset' | 'suspend' | 'reinstate' | 'reverse_false_alarm';
export type OfferAction = 'accept' | 'transfer' | 'arrive' | 'complete' | 'false-alarm';
export type { AssignmentStatus, ServiceAssignment, Station, StationDocument } from '@core/types';

export type ApiCitizenRequest = ReturnType<typeof toCitizenView>;
export type ApiServiceView = ApiCitizenRequest['services'][number];
export type ApiAdminIncident = ReturnType<typeof toAdminView>;
export type ApiStation = ReturnType<typeof toStationView>;

export interface ApiTimelineEntry {
  incidentId: string;
  sk: string;
  at: string;
  source: string;
  detailType: string;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface ApiServicesCatalog {
  services: {
    id: ServiceType;
    name: string;
    helpline?: string;
    description: string;
    stations: { id: string; name: string; address: string; location: GeoPoint; onDuty: boolean }[];
  }[];
}

export interface ApiUser {
  username: string;
  userId?: string;
  email?: string;
  name?: string;
  phone?: string;
  role: 'citizen' | 'applicant' | 'service' | 'admin';
  enabled: boolean;
  status?: string;
  createdAt?: string;
  provider: 'password' | 'google';
  /** Citizens only: trust score and standing. */
  profile?: ApiProfile;
}

export interface ApiOverview {
  incidents: { total: number; active: number; resolved: number; unassigned: number };
  avgResponseMinutes: number | null;
  stations: { total: number; approved: number; pending: number; onDuty: number };
}

export interface StationApplicationInput {
  serviceType: ServiceType;
  name: string;
  registrationNumber: string;
  issuingAuthority: string;
  contactPerson: { name: string; designation: string };
  phone: string;
  officialEmail: string;
  address: string;
  location: GeoPoint;
  unitsTotal: number;
  coverageKm: number;
}

export type ActivityCategory = 'ACCOUNT' | 'REQUEST' | 'RESPONSE' | 'VERIFICATION' | 'OPERATIONS' | 'TRUST' | 'ADMIN';

/** One entry of an account's activity history (backend/src/lib/activity.ts). */
export interface ApiActivity {
  at: string;
  category: ActivityCategory;
  action: string;
  summary: string;
  incidentId?: string;
  by?: string;
  detail?: Record<string, unknown>;
}
export interface ApiActivityPage { items: ApiActivity[]; nextCursor?: string }

export type DocumentKind = 'REGISTRATION_CERTIFICATE' | 'AUTHORITY_LETTER' | 'OFFICER_ID' | 'OTHER';
