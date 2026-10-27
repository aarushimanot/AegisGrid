// Agent Monitor: the AI pipeline agents plus the eight service agents, with
// figures computed from real requests and the registered stations.

import { SERVICES } from '@core/catalog';
import type { Agent, AgentType, Incident } from '../types';
import type { ApiStation, ServiceType } from './apiTypes';
import { AGENT_LABEL } from './mappers';

const SERVICE_AGENT_TYPE: Record<ServiceType, AgentType> = {
  AMBULANCE: 'ambulance', FIRE: 'fire', POLICE: 'police', TRAFFIC_POLICE: 'traffic', HOSPITAL: 'hospital',
  DISASTER_RESPONSE: 'disaster', WOMEN_CHILD_SAFETY: 'safety', UTILITY_EMERGENCY: 'utility',
};

export function buildAgents(incidents: Incident[], stations: ApiStation[]): Agent[] {
  const active = incidents.filter(i => i.status !== 'Resolved');
  const now = new Date().toISOString();
  const latest = incidents[0]?.updatedAt ?? now;
  const analysing = incidents.filter(i => i.status === 'Pending').length;
  const assessed = incidents.filter(i => i.aiAnalysis);

  const pipeline: Agent[] = [
    { id: 'agent-intake', name: 'Intake Agent', type: 'intake', status: active.length ? 'Active' : 'Standby', description: 'Authenticates the citizen, accepts text, photos, video and voice, stores evidence in S3 and starts the analysis workflow.', processedCount: incidents.length, lastActive: latest, successRate: 100, awsService: 'API Gateway + Lambda + S3' },
    { id: 'agent-ai-analysis', name: 'AI Analysis Agent', type: 'ai-analysis', status: analysing ? 'Processing' : active.length ? 'Active' : 'Standby', currentTask: analysing ? `Analysing ${analysing} new report${analysing > 1 ? 's' : ''}` : undefined, description: 'Vision, speech, translation and language understanding, then hybrid triage (Bedrock LLM plus rule-based safety floor) that decides which services must respond.', processedCount: assessed.length, lastActive: latest, successRate: assessed.length ? Math.round((assessed.filter(i => !i.aiAnalysis!.isSimulated).length / assessed.length) * 1000) / 10 : 100, awsService: 'Rekognition · Transcribe · Translate · Comprehend · Bedrock' },
    { id: 'agent-decision', name: 'Decision Engine', type: 'decision-engine', status: active.length ? 'Active' : 'Standby', description: 'Orchestrates the analysis workflow, publishes the assessment to the service agents, and moves unaccepted requests to the next nearest station.', processedCount: assessed.length, lastActive: latest, successRate: 100, awsService: 'Step Functions + EventBridge + Scheduler' },
  ];

  const service: Agent[] = (Object.keys(SERVICES) as ServiceType[]).map(type => {
    const label = AGENT_LABEL[type];
    const mine = incidents.filter(i => i.assignedAgents.includes(label));
    const handled = mine.filter(i => i.dispatch?.some(d => d.agent === label && /accepted|arrived|completed/.test(d.summary)));
    const current = active.flatMap(i => (i.dispatch ?? []).filter(d => d.agent === label).map(d => ({ i, d }))).sort((a, b) => b.d.at.localeCompare(a.d.at))[0];
    const st = stations.filter(s => s.serviceType === type && s.status === 'APPROVED');
    const units = st.reduce((n, s) => n + (s.onDuty ? s.unitsAvailable : 0), 0);
    return {
      id: `agent-${type.toLowerCase()}`, name: label, type: SERVICE_AGENT_TYPE[type],
      status: current ? 'Active' : st.some(s => s.onDuty) ? 'Standby' : 'Idle',
      description: `${SERVICES[type].description} Finds the nearest of ${st.length} verified station${st.length === 1 ? '' : 's'} (${units} ${SERVICES[type].unitLabel} free now), waits for acceptance and transfers onward if needed.`,
      processedCount: mine.length, lastActive: current?.d.at ?? latest,
      successRate: mine.length ? Math.round((handled.length / mine.length) * 1000) / 10 : 100,
      currentTask: current ? `${current.i.displayId}: ${current.d.summary}` : undefined,
      awsService: 'Lambda + DynamoDB + EventBridge',
    };
  });

  const notify: Agent = { id: 'agent-notification', name: 'Notification Agent', type: 'notification', status: active.length ? 'Active' : 'Standby', description: 'Alerts stations and the control room through SNS and SES; texts the citizen when help is accepted.', processedCount: incidents.length, lastActive: latest, successRate: 100, awsService: 'SNS + SES + Parameter Store' };
  return [...pipeline, ...service, notify];
}
