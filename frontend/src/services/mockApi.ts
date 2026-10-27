// CSV export of incidents (used by the Incidents and Analytics pages).

import type { Incident } from '../types';

export function exportToCSV(incidents: Incident[]): void {
  const headers = ['ID', 'Type', 'Priority', 'Status', 'Location', 'Created At', 'Response (min)', 'Description'];
  const rows = incidents.map(i => [
    i.displayId ?? i.id,
    i.type,
    i.priority,
    i.status,
    `"${(i.location.address ?? `${i.location.lat},${i.location.lng}`).replace(/"/g, '""')}"`,
    new Date(i.createdAt).toLocaleString(),
    i.responseMinutes ?? '',
    `"${i.description.replace(/"/g, '""')}"`,
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aegisgrid_incidents_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
