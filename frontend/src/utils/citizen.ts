// Display helpers for a citizen's requests.

import type { ApiCitizenRequest, ApiServiceView } from '../services/apiTypes';
import { TYPE_FROM_API } from '../services/mappers';
import type { EmergencyType } from '../types';

export const STATUS_TEXT: Record<ApiCitizenRequest['status'], string> = {
  AWAITING_MEDIA: 'Uploading',
  ANALYZING: 'AI analysing your request',
  ASSESSED: 'Finding the nearest stations',
  DISPATCHED: 'Help is on the way',
  RESOLVED: 'Resolved',
  FAILED: 'Escalated to the control room',
};

export const STATUS_BADGE: Record<ApiCitizenRequest['status'], string> = {
  AWAITING_MEDIA: 'badge-pending',
  ANALYZING: 'badge-pending',
  ASSESSED: 'badge-active',
  DISPATCHED: 'badge-dispatched',
  RESOLVED: 'badge-resolved',
  FAILED: 'badge-critical',
};

export const SERVICE_STATUS: Record<ApiServiceView['status'], { text: string; cls: string }> = {
  SEARCHING: { text: 'Finding station', cls: 'text-white/50' },
  OFFERED: { text: 'Waiting for acceptance', cls: 'text-yellow-400' },
  ACCEPTED: { text: 'On the way', cls: 'text-blue-400' },
  ARRIVED: { text: 'Arrived', cls: 'text-green-400' },
  COMPLETED: { text: 'Completed', cls: 'text-green-400' },
  UNAVAILABLE: { text: 'Escalated to admin', cls: 'text-red-400' },
  CANCELLED: { text: 'Cancelled', cls: 'text-white/40' },
  FALSE_ALARM: { text: 'False alarm', cls: 'text-red-400' },
};

export const isActive = (r: ApiCitizenRequest) => r.status !== 'RESOLVED';

export const requestType = (r: ApiCitizenRequest): EmergencyType | undefined =>
  r.incidentType ? TYPE_FROM_API[r.incidentType] : undefined;

export function formatMinutes(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  if (m < 1) return `${Math.max(1, Math.round(m * 60))} sec`;
  if (m < 60) return `${m.toFixed(m < 10 ? 1 : 0)} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${Math.round(m - h * 60)} min`;
}

export const firstEta = (r: ApiCitizenRequest) => {
  const etas = r.services.filter(s => s.status === 'ACCEPTED').map(x => x.etaMinutes).filter((n): n is number => typeof n === 'number');
  return etas.length ? Math.min(...etas) : undefined;
};

/** Seconds left on an offer's acceptance window. */
export const secondsLeft = (iso?: string) => (iso ? Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000)) : 0);
