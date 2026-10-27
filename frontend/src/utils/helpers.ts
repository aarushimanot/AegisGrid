import type { Priority, IncidentStatus, EmergencyType } from '../types';

export function getStatusBadge(status: IncidentStatus): string {
  switch (status) {
    case 'Critical': return 'badge-critical';
    case 'Active': return 'badge-active';
    case 'Resolved': return 'badge-resolved';
    case 'Pending': return 'badge-pending';
    case 'Dispatched': return 'badge-dispatched';
    default: return 'badge-pending';
  }
}

export function getPriorityColor(priority: Priority): string {
  switch (priority) {
    case 'Critical': return 'bg-red-500/20 text-red-400';
    case 'High': return 'bg-orange-500/20 text-orange-400';
    case 'Medium': return 'bg-yellow-500/20 text-yellow-400';
    case 'Low': return 'bg-green-500/20 text-green-400';
    default: return 'bg-white/10 text-white/60';
  }
}

export function getPriorityDot(priority: Priority): string {
  switch (priority) {
    case 'Critical': return 'bg-red-500';
    case 'High': return 'bg-orange-500';
    case 'Medium': return 'bg-yellow-500';
    case 'Low': return 'bg-green-500';
    default: return 'bg-white/30';
  }
}

export function getTypeColor(type: EmergencyType): string {
  switch (type) {
    case 'Medical': return '#E50914';
    case 'Fire': return '#ff6b35';
    case 'Accident': return '#ffa500';
    case 'Crime': return '#9b59b6';
    case 'Natural Disaster': return '#3498db';
    case 'Harassment': return '#ec4899';
    case 'Hazmat': return '#84cc16';
    case 'Gas / Electrical': return '#eab308';
    case 'Other': return '#95a5a6';
    default: return '#ffffff';
  }
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function getAgentStatusColor(status: string): string {
  switch (status) {
    case 'Active': return 'text-green-400';
    case 'Processing': return 'text-blue-400';
    case 'Idle': return 'text-white/40';
    case 'Standby': return 'text-yellow-400';
    case 'Error': return 'text-red-400';
    default: return 'text-white/40';
  }
}

export function getAgentStatusDot(status: string): string {
  switch (status) {
    case 'Active': return 'bg-green-400';
    case 'Processing': return 'bg-blue-400 animate-pulse';
    case 'Idle': return 'bg-white/20';
    case 'Standby': return 'bg-yellow-400';
    case 'Error': return 'bg-red-400';
    default: return 'bg-white/20';
  }
}
