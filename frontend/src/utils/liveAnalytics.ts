// Dashboard and analytics series computed from real incidents (live mode).
// Each function returns the same shape as the matching mock in data/mockData.ts.

import { format, startOfDay, subDays } from 'date-fns';
import type { ActivityFeedItem, EmergencyType, Incident, KPIStats, Priority, TrendDataPoint } from '../types';
import { timeToDispatchMinutes } from '../services/mappers';
import { getTypeColor } from './helpers';

const TYPES: EmergencyType[] = ['Medical', 'Accident', 'Fire', 'Crime', 'Harassment', 'Natural Disaster', 'Gas / Electrical', 'Hazmat', 'Other'];
const PRIORITY_COLORS: Record<Priority, string> = { Critical: '#E50914', High: '#ff6b35', Medium: '#ffa500', Low: '#4caf50' };
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** Request → first verified arrival; for open incidents, time to accept plus the ETA. */
function responseMinutes(inc: Incident): number | null {
  if (typeof inc.responseMinutes === 'number') return inc.responseMinutes;
  const dispatch = timeToDispatchMinutes(inc);
  if (dispatch === null) return null;
  const etas = (inc.dispatch ?? []).map(d => d.etaMinutes).filter((n): n is number => typeof n === 'number');
  return dispatch + (etas.length ? Math.min(...etas) : 0);
}

export function computeKpis(incidents: Incident[]): KPIStats {
  const responses = incidents.map(responseMinutes).filter((n): n is number => n !== null);
  const avg = responses.length ? responses.reduce((a, b) => a + b, 0) / responses.length : null;
  const activeAgents = new Set(incidents.filter(i => i.status !== 'Resolved').flatMap(i => i.assignedAgents)).size;
  return {
    total: incidents.length,
    active: incidents.filter(i => i.status !== 'Resolved').length,
    critical: incidents.filter(i => i.priority === 'Critical' && i.status !== 'Resolved').length,
    resolved: incidents.filter(i => i.status === 'Resolved').length,
    activeAgents,
    avgResponseTime: avg === null ? '—' : `${round1(avg)} min`,
  };
}

export function trendData(incidents: Incident[], days = 7): TrendDataPoint[] {
  const today = startOfDay(new Date());
  return Array.from({ length: days }, (_, i) => {
    const day = subDays(today, days - 1 - i);
    const next = subDays(day, -1);
    const onDay = incidents.filter(inc => {
      const t = new Date(inc.createdAt);
      return t >= day && t < next;
    });
    const count = (p: Priority) => onDay.filter(x => x.priority === p).length;
    return { date: format(day, 'MMM d'), critical: count('Critical'), high: count('High'), medium: count('Medium'), low: count('Low') };
  });
}

export function typeDistribution(incidents: Incident[]) {
  return TYPES.map(name => ({ name, value: pct(incidents.filter(i => i.type === name).length, incidents.length), color: getTypeColor(name) }))
    .filter(d => d.value > 0);
}

export function priorityDistribution(incidents: Incident[]) {
  return (Object.keys(PRIORITY_COLORS) as Priority[]).map(name => ({
    name,
    value: pct(incidents.filter(i => i.priority === name).length, incidents.length),
    color: PRIORITY_COLORS[name],
  }));
}

export function responseTimeByType(incidents: Incident[]) {
  return TYPES.flatMap(name => {
    const times = incidents.filter(i => i.type === name).map(responseMinutes).filter((n): n is number => n !== null);
    return times.length ? [{ name, avgTime: round1(times.reduce((a, b) => a + b, 0) / times.length) }] : [];
  });
}

export function hourlyDistribution(incidents: Incident[]) {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: `${h.toString().padStart(2, '0')}:00`,
    count: incidents.filter(i => new Date(i.createdAt).getHours() === h).length,
  }));
}

export function activityFeed(incidents: Incident[], limit = 12): ActivityFeedItem[] {
  return incidents
    .flatMap(inc =>
      inc.timeline.map((t): ActivityFeedItem => ({
        id: `${inc.id}-${t.id}`,
        message: `${inc.displayId ?? inc.id}: ${t.event}`,
        timestamp: t.timestamp,
        type: t.type === 'error' || t.type === 'warning' ? 'alert' : t.event.toLowerCase().includes('resolved') ? 'resolution' : t.agent === 'Intake Agent' ? 'incident' : 'agent',
        incidentId: inc.id,
      })),
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

/** Real platform metrics for the analytics radar and progress bars. */
export function performanceMetrics(incidents: Incident[]) {
  const assessed = incidents.filter(i => i.aiAnalysis);
  const critical = incidents.filter(i => i.priority === 'Critical');
  const required = incidents.reduce((n, i) => n + i.assignedAgents.length, 0);
  const fulfilled = incidents.reduce((n, i) => n + (i.dispatch?.length ?? 0), 0);
  const fastDispatch = incidents.filter(i => {
    const t = timeToDispatchMinutes(i);
    return t !== null && t <= 2;
  }).length;
  const dispatched = incidents.filter(i => (i.dispatch?.length ?? 0) > 0).length;
  return {
    criticalResolution: pct(critical.filter(i => i.status === 'Resolved').length, critical.length),
    avgConfidence: assessed.length ? Math.round(assessed.reduce((n, i) => n + i.aiAnalysis!.confidence, 0) / assessed.length) : 0,
    multiAgency: pct(incidents.filter(i => (i.dispatch?.length ?? 0) >= 2).length, incidents.length),
    dispatchCoverage: pct(fulfilled, required),
    fastDispatch: pct(fastDispatch, dispatched),
    bedrockAssessed: pct(assessed.filter(i => !i.aiAnalysis!.isSimulated).length, assessed.length),
    mediaReports: pct(incidents.filter(i => i.media.length > 0).length, incidents.length),
    resolutionRate: pct(incidents.filter(i => i.status === 'Resolved').length, incidents.length),
    avgSeverity: assessed.length ? Math.round(assessed.reduce((n, i) => n + i.aiAnalysis!.severity, 0) / assessed.length) : 0,
  };
}
