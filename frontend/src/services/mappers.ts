// Translate backend records into the UI's existing types, so the operations
// pages (dashboard, incidents, analytics) work in demo and live mode alike.

import { SERVICES } from '@core/catalog';
import type { AIAnalysis, EmergencyType, Incident, IncidentStatus, Priority, TimelineEvent } from '../types';
import type { ApiAdminIncident, ApiTimelineEntry, IncidentType, ServiceAssignment, ServiceType } from './apiTypes';

export const TYPE_FROM_API: Record<IncidentType, EmergencyType> = {
  ROAD_ACCIDENT: 'Accident',
  MEDICAL: 'Medical',
  FIRE: 'Fire',
  NATURAL_DISASTER: 'Natural Disaster',
  CRIME: 'Crime',
  HARASSMENT: 'Harassment',
  HAZMAT: 'Hazmat',
  UTILITY: 'Gas / Electrical',
  OTHER: 'Other',
};

export const AGENT_LABEL = Object.fromEntries(Object.values(SERVICES).map(s => [s.type, `${s.name} Agent`])) as Record<ServiceType, string>;
export const SERVICE_NAME = Object.fromEntries(Object.values(SERVICES).map(s => [s.type, s.name])) as Record<ServiceType, string>;

export const shortRef = (incidentId: string) => `INC-${incidentId.slice(0, 8).toUpperCase()}`;

export function priorityFromSeverity(severity?: number): Priority {
  if (!severity) return 'Medium';
  if (severity >= 4) return 'Critical';
  if (severity === 3) return 'High';
  if (severity === 2) return 'Medium';
  return 'Low';
}

function statusFromApi(inc: ApiAdminIncident): IncidentStatus {
  switch (inc.status) {
    case 'AWAITING_MEDIA':
    case 'ANALYZING':
      return 'Pending';
    case 'ASSESSED':
      return (inc.severity ?? 0) >= 4 ? 'Critical' : 'Active';
    case 'DISPATCHED':
      return 'Dispatched';
    case 'RESOLVED':
      return 'Resolved';
    case 'FAILED':
      return 'Critical';
  }
}

export function assignmentSummary(a: ServiceAssignment): string {
  const at = a.stationName ?? 'nearest station';
  switch (a.status) {
    case 'SEARCHING': return 'Finding the nearest station';
    case 'OFFERED': return `Waiting for ${at} to accept${a.tried.length ? ` (after ${a.tried.length} transfer${a.tried.length > 1 ? 's' : ''})` : ''}`;
    case 'ACCEPTED': return `${at} accepted, en route (${a.distanceKm} km, ETA ~${a.etaMinutes} min)`;
    case 'ARRIVED': return `${at} arrived, verified with the citizen's code (response ${a.responseMinutes} min)`;
    case 'COMPLETED': return `${at} completed the job (response ${a.responseMinutes} min)`;
    case 'UNAVAILABLE': return a.note ?? 'No station available; escalated to admin';
    case 'CANCELLED': return a.note ?? 'Cancelled';
    case 'FALSE_ALARM': return `${at} found no emergency at the scene${a.note ? `: ${a.note}` : ''}`;
  }
}

function agentFromSource(source: string): string {
  if (source.startsWith('aegisgrid.agent.')) {
    const key = source.slice('aegisgrid.agent.'.length).toUpperCase() as ServiceType;
    return AGENT_LABEL[key] ?? 'Agent';
  }
  return ({ 'aegisgrid.orchestrator': 'AI Analysis Agent', 'aegisgrid.station': 'Station', 'aegisgrid.admin': 'Admin', 'aegisgrid.api': 'Intake Agent' } as Record<string, string>)[source] ?? source;
}

function eventKind(detailType: string): TimelineEvent['type'] {
  if (['Service.Unavailable', 'Incident.AnalysisFailed'].includes(detailType)) return 'error';
  if (['Offer.Transferred', 'Offer.Expired'].includes(detailType)) return 'warning';
  if (['Offer.Accepted', 'Service.Arrived', 'Service.Completed', 'Incident.Resolved'].includes(detailType)) return 'success';
  return 'info';
}

function toAnalysis(inc: ApiAdminIncident): AIAnalysis | undefined {
  const a = inc.assessment;
  if (!a) return undefined;
  const etas = Object.values(inc.assignments ?? {}).map(x => x?.etaMinutes).filter((n): n is number => typeof n === 'number');
  const labels = [...new Set((inc.analysis?.images ?? []).flatMap(i => i.labels.map(l => l.name)))].slice(0, 6);
  return {
    severity: a.severity * 20,
    confidence: a.confidence ?? (a.source === 'RULES_ONLY' ? 55 : 80),
    detectedHazards: a.hazards.length ? a.hazards : labels,
    recommendedResponse: a.recommendations.length ? a.recommendations.join(' ') : `Dispatch: ${a.requiredAgents.map(t => SERVICE_NAME[t]).join(', ')}.`,
    estimatedResponseTime: etas.length ? `${Math.min(...etas)} minutes (nearest station)` : 'Awaiting acceptance',
    resourcesNeeded: a.requiredAgents.map(t => SERVICE_NAME[t]),
    summary: a.summary,
    generatedAt: inc.updatedAt,
    isSimulated: a.source === 'RULES_ONLY',
  };
}

export function toUiIncident(inc: ApiAdminIncident, timeline?: ApiTimelineEntry[]): Incident {
  const assignments = Object.values(inc.assignments ?? {}).filter(Boolean) as ServiceAssignment[];
  const events: TimelineEvent[] = [{ id: `${inc.incidentId}-reported`, timestamp: inc.createdAt, event: 'Request received', agent: 'Intake Agent', type: 'info' }];
  if (timeline?.length) {
    for (const t of timeline) if (t.detailType !== 'Incident.Reported') events.push({ id: t.sk, timestamp: t.at, event: t.summary, agent: agentFromSource(t.source), type: eventKind(t.detailType) });
  } else {
    for (const a of assignments) events.push({ id: `${inc.incidentId}-${a.serviceType}`, timestamp: a.updatedAt, event: assignmentSummary(a), agent: AGENT_LABEL[a.serviceType], type: a.status === 'UNAVAILABLE' ? 'error' : 'success' });
  }
  events.sort((x, y) => x.timestamp.localeCompare(y.timestamp));

  return {
    id: inc.incidentId,
    displayId: shortRef(inc.incidentId),
    type: TYPE_FROM_API[inc.incidentType ?? 'OTHER'],
    description: inc.description || inc.analysis?.transcripts?.map(t => t.text).join(' ') || '(media-only report)',
    location: { lat: inc.location.lat, lng: inc.location.lon, address: inc.address ?? (inc.locationSource === 'gps' ? 'Live location' : `${inc.location.lat.toFixed(4)}, ${inc.location.lon.toFixed(4)}`) },
    priority: priorityFromSeverity(inc.severity),
    status: statusFromApi(inc),
    createdAt: inc.createdAt,
    updatedAt: inc.updatedAt,
    reportedBy: inc.reporter?.name || 'Citizen',
    media: (inc.media ?? []).map((m, i) => ({ id: m.key, name: `Evidence ${i + 1} (${m.kind})`, type: m.kind, url: '', size: 0 })),
    assignedAgents: (inc.requiredServices ?? []).map(a => AGENT_LABEL[a]),
    aiAnalysis: toAnalysis(inc),
    timeline: events,
    dispatch: assignments
      .sort((x, y) => (x.acceptedAt ?? x.updatedAt).localeCompare(y.acceptedAt ?? y.updatedAt))
      .map(a => ({
        agent: AGENT_LABEL[a.serviceType], summary: assignmentSummary(a),
        resourceIds: a.stationId && ['OFFERED', 'ACCEPTED', 'ARRIVED'].includes(a.status) ? [a.stationId] : [],
        etaMinutes: a.etaMinutes, at: a.acceptedAt ?? a.offeredAt ?? a.updatedAt,
      })),
    responseMinutes: inc.responseMinutes,
  };
}

/** Minutes from request to the first station accepting, or null if none yet. */
export function timeToDispatchMinutes(inc: Incident): number | null {
  const first = inc.dispatch?.map(d => d.at).sort()[0];
  return first ? Math.max(0, (Date.parse(first) - Date.parse(inc.createdAt)) / 60_000) : null;
}
