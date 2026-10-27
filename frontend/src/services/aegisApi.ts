// Client for the AegisGrid REST API (API Gateway → Lambda).

import { config } from '../config';
import { getIdToken } from './auth';
import type {
  ApiActivityPage, ApiAdminIncident, ApiCitizenRequest, ApiOverview, ApiProfile, ApiServicesCatalog, ApiStation, ApiTimelineEntry, ApiUser, DocumentKind,
  GeoPoint, IncidentType, MediaMeta, Offer, OfferAction, ServiceAssignment, ServiceType, StandingAction, StationApplicationInput,
} from './apiTypes';

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.auth) {
    const token = await getIdToken();
    if (!token) throw new ApiError(401, 'Please sign in again.');
    headers.Authorization = token;
  }
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error?: string; message?: string; issues?: { path: string; message: string }[] };
    const message = d.issues?.map(i => `${i.path}: ${i.message}`).join('; ') ?? d.error ?? d.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

// ── Citizen (signed in) ──────────────────────────────────────────────────────

/** Content types the backend accepts for evidence uploads. */
export const SUPPORTED_UPLOAD_TYPES = [
  'image/jpeg', 'image/png',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/flac',
  'video/mp4', 'video/webm',
];

/** Strip codec parameters, e.g. "audio/webm;codecs=opus" → "audio/webm". */
export const baseContentType = (type: string) => type.split(';')[0]!.trim().toLowerCase();

export interface ReportInput {
  description: string;
  category?: IncidentType;
  location: { lat: number; lon: number };
  address?: string;
  /** "gps" = taken from the device; enables live location updates while help is on the way. */
  locationSource: 'manual' | 'gps';
  reporter?: { name?: string; phone?: string };
  files: Blob[];
  /** Per file: camera or gallery, and the capture time / GPS read from EXIF. */
  meta?: (MediaMeta | undefined)[];
  /** Device position when the location was typed in (consistency check). */
  deviceLocation?: GeoPoint;
  declarationAccepted: true;
}

/**
 * Report an emergency: create the incident, upload each file straight to S3
 * with its pre-signed URL, then tell the backend to start analysis.
 */
export async function reportIncident(input: ReportInput, onProgress?: (step: string) => void): Promise<{ incidentId: string }> {
  onProgress?.('Sending report…');
  const created = await request<{ incidentId: string; uploads: { url: string; contentType: string }[] }>('/incidents', {
    method: 'POST',
    auth: true,
    body: {
      description: input.description,
      category: input.category,
      location: input.location,
      address: input.address || undefined,
      locationSource: input.locationSource,
      reporter: input.reporter,
      media: input.files.map((f, i) => ({ contentType: baseContentType(f.type), meta: input.meta?.[i] })),
      deviceLocation: input.deviceLocation,
      declarationAccepted: input.declarationAccepted,
    },
  });

  if (created.uploads.length) {
    let done = 0;
    await Promise.all(
      created.uploads.map(async (u, i) => {
        const res = await fetch(u.url, { method: 'PUT', headers: { 'Content-Type': u.contentType }, body: input.files[i] });
        if (!res.ok) throw new ApiError(res.status, `Upload of file ${i + 1} failed`);
        onProgress?.(`Uploading evidence… ${++done}/${created.uploads.length}`);
      }),
    );
    onProgress?.('Starting AI analysis…');
    await request(`/incidents/${created.incidentId}/submit`, { method: 'POST', auth: true });
  }
  return { incidentId: created.incidentId };
}

export const getRequestStatus = (incidentId: string) => request<ApiCitizenRequest>(`/incidents/${incidentId}/status`, { auth: true });

export async function listMyRequests(): Promise<ApiCitizenRequest[]> {
  return (await request<{ items: ApiCitizenRequest[] }>('/me/incidents', { auth: true })).items;
}

export const updateMyLocation = (incidentId: string, lat: number, lon: number, accuracyMeters?: number) =>
  request(`/me/incidents/${incidentId}/location`, { method: 'PATCH', auth: true, body: { lat, lon, accuracyMeters } });

export const listServices = () => request<ApiServicesCatalog>('/services', { auth: true });

const cursorQs = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');
export const getMyActivity = (cursor?: string) => request<ApiActivityPage>(`/me/activity${cursorQs(cursor)}`, { auth: true });
export const adminActivity = (userId: string, cursor?: string) => request<ApiActivityPage>(`/admin/activity/${encodeURIComponent(userId)}${cursorQs(cursor)}`, { auth: true });
export const updateMyAccount = (body: { name?: string; phone?: string | null; liveLocation?: boolean }) =>
  request<{ changed: number; phoneVerificationRequired: boolean }>('/me/account', { method: 'PATCH', auth: true, body });
export const recordPasswordChanged = () => request('/me/activity', { method: 'POST', auth: true, body: { event: 'PASSWORD_CHANGED' } });
export const getMyProfile = async () => (await request<{ profile: ApiProfile }>('/me/profile', { auth: true })).profile;
export const sendMyPhoneCode = (phone: string) =>
  request<{ channel: 'sms' | 'email' | 'screen'; devCode?: string }>('/me/phone/send', { method: 'POST', auth: true, body: { phone } });
export const verifyMyPhone = async (code: string) => (await request<{ profile: ApiProfile }>('/me/phone/verify', { method: 'POST', auth: true, body: { code } })).profile;

// ── Service stations ────────────────────────────────────────────────────────

export const getMyStation = async () => (await request<{ station: ApiStation | null }>('/station/me', { auth: true })).station;
export const saveStationApplication = async (body: StationApplicationInput) =>
  (await request<{ station: ApiStation }>('/station/me', { method: 'PUT', auth: true, body })).station;

/** Upload verification documents straight to S3 with pre-signed URLs. */
export async function uploadStationDocuments(files: { file: File; kind: DocumentKind }[]): Promise<ApiStation> {
  const res = await request<{ uploads: { url: string; contentType: string }[]; station: ApiStation }>('/station/me/documents', {
    method: 'POST', auth: true, body: { files: files.map(f => ({ name: f.file.name, kind: f.kind, contentType: f.file.type })) },
  });
  await Promise.all(res.uploads.map((u, i) => fetch(u.url, { method: 'PUT', headers: { 'Content-Type': u.contentType }, body: files[i]!.file })));
  return res.station;
}
export const sendStationPhoneOtp = () => request<{ channel: 'sms' | 'email' | 'screen'; devCode?: string }>('/station/me/phone-otp', { method: 'POST', auth: true, body: {} });
export const verifyStationPhone = async (code: string) => (await request<{ station: ApiStation }>('/station/me/verify-phone', { method: 'POST', auth: true, body: { code } })).station;
export const submitStationApplication = async () => (await request<{ station: ApiStation }>('/station/me/submit', { method: 'POST', auth: true, body: { declarationAccepted: true } })).station;
export const updateStationOperations = async (body: { onDuty?: boolean; unitsAvailable?: number; unitsTotal?: number }) =>
  (await request<{ station: ApiStation }>('/station/me', { method: 'PATCH', auth: true, body })).station;
export const listStationOffers = async () => (await request<{ items: Offer[] }>('/station/offers', { auth: true })).items;
export const stationOfferAction = (offerId: string, action: OfferAction, body: { reason?: string; code?: string } = {}) =>
  request<{ assignment?: ServiceAssignment }>(`/station/offers/${offerId}/${action}`, { method: 'POST', auth: true, body });

// ── Admin ───────────────────────────────────────────────────────────────────

export const adminOverview = () => request<ApiOverview>('/admin/overview', { auth: true });
export const adminIncidents = async (status = 'ALL') => (await request<{ items: ApiAdminIncident[] }>(`/admin/incidents?status=${status}&limit=300`, { auth: true })).items;
export const adminIncident = (id: string) => request<{ incident: ApiAdminIncident; timeline: ApiTimelineEntry[] }>(`/admin/incidents/${id}`, { auth: true });
export const adminAssign = (id: string, serviceType: ServiceType, stationId: string) =>
  request(`/admin/incidents/${id}/assign`, { method: 'POST', auth: true, body: { serviceType, stationId } });
export const adminResolve = (id: string, note?: string) => request(`/admin/incidents/${id}/resolve`, { method: 'POST', auth: true, body: { note } });
export const adminStations = async () => (await request<{ items: ApiStation[] }>('/admin/stations', { auth: true })).items;
export const adminStation = async (id: string) =>
  (await request<{ station: ApiStation & { documents: (ApiStation['verification']['documents'][number] & { url: string })[] } }>(`/admin/stations/${id}`, { auth: true })).station;
export const adminReviewStation = (id: string, action: 'approve' | 'reject' | 'suspend' | 'reinstate', note?: string) =>
  request(`/admin/stations/${id}/review`, { method: 'POST', auth: true, body: { action, note } });
export const adminUsers = async () => (await request<{ items: ApiUser[] }>('/admin/users', { auth: true })).items;
export const adminUserAction = (username: string, action: 'disable' | 'enable' | 'delete') =>
  request(`/admin/users/${encodeURIComponent(username)}/action`, { method: 'POST', auth: true, body: { action } });
export const adminCitizenStanding = async (userId: string, action: StandingAction, note?: string) =>
  (await request<{ profile: ApiProfile }>(`/admin/citizens/${encodeURIComponent(userId)}/standing`, { method: 'POST', auth: true, body: { action, note } })).profile;
