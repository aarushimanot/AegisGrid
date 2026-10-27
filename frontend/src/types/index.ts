// AegisGrid Types

export type EmergencyType = 'Accident' | 'Medical' | 'Fire' | 'Natural Disaster' | 'Crime' | 'Harassment' | 'Hazmat' | 'Gas / Electrical' | 'Other';
export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';
export type IncidentStatus = 'Active' | 'Critical' | 'Resolved' | 'Pending' | 'Dispatched';
export type AgentStatus = 'Active' | 'Idle' | 'Processing' | 'Standby' | 'Error';

export interface GeoLocation {
  lat: number;
  lng: number;
  address?: string;
}

export interface MediaFile {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  size: number;
}

export interface Incident {
  id: string;
  type: EmergencyType;
  description: string;
  location: GeoLocation;
  priority: Priority;
  status: IncidentStatus;
  createdAt: string;
  updatedAt: string;
  reportedBy: string;
  media: MediaFile[];
  assignedAgents: string[];
  aiAnalysis?: AIAnalysis;
  timeline: TimelineEvent[];
  isDemo?: boolean;
  /** Short human-friendly reference shown in the UI (live mode); `id` stays the routing key. */
  displayId?: string;
  /** What each service/station committed. */
  dispatch?: DispatchInfo[];
  /** Request → first verified arrival, in minutes. */
  responseMinutes?: number | null;
}

export interface DispatchInfo {
  agent: string;
  summary: string;
  /** Units/hospital the agent committed (live mode). */
  resourceIds?: string[];
  etaMinutes?: number;
  briefing?: string;
  at: string;
}

export interface AIAnalysis {
  severity: number; // 0-100
  confidence: number; // 0-100
  detectedHazards: string[];
  recommendedResponse: string;
  estimatedResponseTime: string;
  resourcesNeeded: string[];
  summary: string;
  generatedAt: string;
  isSimulated?: boolean;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  event: string;
  agent: string;
  type: 'info' | 'warning' | 'success' | 'error';
}

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  description: string;
  processedCount: number;
  lastActive: string;
  successRate: number;
  currentTask?: string;
  awsService?: string;
  isSimulated?: boolean;
}

export type AgentType =
  | 'intake'
  | 'ai-analysis'
  | 'ambulance'
  | 'police'
  | 'hospital'
  | 'traffic'
  | 'fire'
  | 'disaster'
  | 'safety'
  | 'utility'
  | 'decision-engine'
  | 'notification';

export interface KPIStats {
  total: number;
  active: number;
  critical: number;
  resolved: number;
  activeAgents: number;
  avgResponseTime: string;
  isDemo?: boolean;
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  timestamp: number;
}

export interface ActivityFeedItem {
  id: string;
  message: string;
  timestamp: string;
  type: 'incident' | 'agent' | 'resolution' | 'alert';
  incidentId?: string;
}

export interface ChartDataPoint {
  name: string;
  value: number;
  color?: string;
}

export interface TrendDataPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}
