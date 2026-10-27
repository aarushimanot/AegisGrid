import React, { useState } from 'react';
import {
  Cpu, Activity, ShieldOff, CheckCircle, AlertTriangle, Loader2,
  RefreshCw, Zap, Database, Cloud, Server, BarChart3
} from 'lucide-react';
import type { Agent, AgentType } from '../types';
import { buildAgents } from '../services/liveAgents';
import { useApp } from '../context/AppContext';
import { useLive } from '../hooks/useLive';
import { adminApi } from '../services/api';
import { HeartHandshake, LifeBuoy } from 'lucide-react';
import { getAgentStatusColor, getAgentStatusDot, formatDateTime } from '../utils/helpers';

const AGENT_ICONS: Record<AgentType, React.ComponentType<{ size?: number; className?: string }>> = {
  'intake': Server,
  'ai-analysis': Cpu,
  'ambulance': Activity,
  'police': ShieldOff,
  'hospital': CheckCircle,
  'traffic': Zap,
  'fire': AlertTriangle,
  'disaster': LifeBuoy,
  'safety': HeartHandshake,
  'utility': Zap,
  'decision-engine': Database,
  'notification': Cloud,
};

const AGENT_COLORS: Record<AgentType, string> = {
  'intake': '#3498db',
  'ai-analysis': '#9b59b6',
  'ambulance': '#E50914',
  'police': '#2980b9',
  'hospital': '#27ae60',
  'traffic': '#f39c12',
  'fire': '#e74c3c',
  'disaster': '#06b6d4',
  'safety': '#ec4899',
  'utility': '#a3e635',
  'decision-engine': '#1abc9c',
  'notification': '#fd79a8',
};

function AgentCard({ agent }: { agent: Agent }) {
  const Icon = AGENT_ICONS[agent.type];
  const color = AGENT_COLORS[agent.type];

  return (
    <div
      className="glass-card p-5 hover:border-white/20 transition-all duration-300 group"
      style={{ borderColor: `${color}20` }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${color}20` }}
          >
            <Icon size={18} className="opacity-90" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">{agent.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${getAgentStatusDot(agent.status)}`} />
              <span className={`text-xs ${getAgentStatusColor(agent.status)}`}>{agent.status}</span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-white/50 leading-relaxed mb-4">{agent.description}</p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-black-300 rounded-lg p-2.5">
          <p className="text-[10px] text-white/40 mb-0.5">Processed</p>
          <p className="text-lg font-bold text-white">{agent.processedCount.toLocaleString()}</p>
          <p className="text-[10px] text-white/30">Total Tasks</p>
        </div>
        <div className="bg-black-300 rounded-lg p-2.5">
          <p className="text-[10px] text-white/40 mb-0.5">Success Rate</p>
          <p className="text-lg font-bold text-green-400">{agent.successRate}%</p>
          <p className="text-[10px] text-white/30">Efficiency</p>
        </div>
      </div>

      {agent.currentTask && (
        <div className="p-2.5 rounded-lg bg-black-300 border border-white/5 mb-3">
          <p className="text-[10px] text-white/40 mb-0.5">Current Task</p>
          <p className="text-xs text-white/70 leading-relaxed">{agent.currentTask}</p>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-white/30">
        <div className="flex items-center gap-1">
          <Cloud size={10} />
          <span className="font-mono">{agent.awsService}</span>
        </div>
        <span>Last: {formatDateTime(agent.lastActive)}</span>
      </div>
    </div>
  );
}

const ARCH_NODES = [
  { id: 'portal', label: 'Emergency\nPortal', x: 50, y: 20, color: '#E50914' },
  { id: 'api', label: 'API\nGateway', x: 50, y: 35, color: '#3498db' },
  { id: 'lambda', label: 'Lambda\n(Intake)', x: 50, y: 50, color: '#f39c12' },
  { id: 's3', label: 'S3\n(Media)', x: 20, y: 60, color: '#27ae60' },
  { id: 'rekognition', label: 'Rekognition\n(Images)', x: 20, y: 75, color: '#9b59b6' },
  { id: 'transcribe', label: 'Transcribe\n(Voice)', x: 50, y: 65, color: '#1abc9c' },
  { id: 'bedrock', label: 'Bedrock\n(LLM)', x: 80, y: 60, color: '#e74c3c' },
  { id: 'dynamo', label: 'DynamoDB\n(Store)', x: 80, y: 75, color: '#fd79a8' },
  { id: 'eventbridge', label: 'EventBridge\n(Events)', x: 50, y: 80, color: '#ffa500' },
  { id: 'stepfn', label: 'Step Functions\n(Orchestrate)', x: 50, y: 92, color: '#00b894' },
  { id: 'sns', label: 'SNS/SES\n(Notify)', x: 20, y: 92, color: '#74b9ff' },
  { id: 'quicksight', label: 'QuickSight\n(Analytics)', x: 80, y: 92, color: '#a29bfe' },
];

function ArchDiagram() {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={15} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-white">AWS Architecture Workflow</h3>
        </div>
        <span className="text-xs text-blue-400 font-mono">PIPELINE TOPOLOGY</span>
      </div>

      <div className="relative" style={{ height: 460 }}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* Connections */}
          {[
            ['portal', 'api'], ['api', 'lambda'], ['lambda', 's3'],
            ['lambda', 'transcribe'], ['lambda', 'bedrock'],
            ['s3', 'rekognition'], ['bedrock', 'dynamo'],
            ['transcribe', 'eventbridge'], ['rekognition', 'eventbridge'],
            ['dynamo', 'eventbridge'], ['eventbridge', 'stepfn'],
            ['stepfn', 'sns'], ['stepfn', 'quicksight'],
          ].map(([from, to], i) => {
            const f = ARCH_NODES.find(n => n.id === from)!;
            const t = ARCH_NODES.find(n => n.id === to)!;
            return (
              <line key={i} x1={f.x} y1={f.y + 4} x2={t.x} y2={t.y - 4}
                stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
            );
          })}
        </svg>

        {ARCH_NODES.map(node => (
          <div
            key={node.id}
            className="absolute flex flex-col items-center"
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shadow-lg border border-white/10"
              style={{ background: `${node.color}20`, borderColor: `${node.color}30` }}
              title={node.label}
            >
              <Server size={14} className="opacity-80" />
            </div>
            <div className="text-center mt-1">
              {node.label.split('\n').map((line, i) => (
                <div key={i} className="text-[9px] text-white/50 leading-tight">{line}</div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 p-3 rounded-lg bg-black-300 border border-white/5">
        <p className="text-[10px] text-white/40 text-center leading-relaxed">
          Distributed agent orchestration topology with event-driven pipeline integration.
        </p>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const { incidents } = useApp();
  const { data: stations, reload } = useLive(() => adminApi.stations(), [], 5000);
  const agents: Agent[] = stations ? buildAgents(incidents, stations) : [];
  const loading = !stations;
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const activeCount = agents.filter(a => a.status === 'Active' || a.status === 'Processing').length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Multi-Agent Monitor</h2>
          <p className="text-sm text-white/40 mt-1">
            {activeCount}/{agents.length} autonomous agents active in cluster
          </p>
        </div>
        <button onClick={handleRefresh} className="btn-secondary text-sm" disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          Refresh Agents
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={32} className="animate-spin text-red-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map(agent => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {/* Architecture Diagram */}
      <ArchDiagram />
    </div>
  );
}
