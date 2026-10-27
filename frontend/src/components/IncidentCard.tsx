import { useNavigate } from 'react-router-dom';
import type { Incident } from '../types';
import { getStatusBadge, getPriorityColor } from '../utils/helpers';
import TypeIcon from './TypeIcon';
import { formatDistanceToNow } from 'date-fns';
import { MapPin, Clock, FlaskConical } from 'lucide-react';

interface Props {
  incident: Incident;
  compact?: boolean;
}

export default function IncidentCard({ incident, compact = false }: Props) {
  const navigate = useNavigate();

  return (
    <div
      className={`glass-card p-4 hover:border-white/20 transition-all duration-200 cursor-pointer hover:translate-y-[-2px] ${
        incident.priority === 'Critical' ? 'border-red-500/20' : ''
      }`}
      onClick={() => navigate(`/incidents/${incident.id}`)}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${getPriorityColor(incident.priority)}`}>
            <TypeIcon type={incident.type} size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-white/40">{incident.id}</span>
            </div>
            <div className="text-sm font-semibold text-white">{incident.type}</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`status-badge text-xs ${getStatusBadge(incident.status)}`}>
            {incident.status}
          </span>
          <span className={`text-xs font-semibold ${
            incident.priority === 'Critical' ? 'text-red-400' :
            incident.priority === 'High' ? 'text-orange-400' :
            incident.priority === 'Medium' ? 'text-yellow-400' : 'text-green-400'
          }`}>
            {incident.priority}
          </span>
        </div>
      </div>

      {!compact && (
        <p className="text-sm text-white/60 mb-3 line-clamp-2 leading-relaxed">
          {incident.description}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-white/40">
        <div className="flex items-center gap-1.5">
          <MapPin size={11} />
          <span className="truncate max-w-[140px]">{incident.location.address ?? 'Unknown location'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock size={11} />
          <span>{formatDistanceToNow(new Date(incident.createdAt), { addSuffix: true })}</span>
        </div>
      </div>

      {incident.aiAnalysis && !compact && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2">
          <FlaskConical size={12} className="text-purple-400" />
          <span className="text-[11px] text-purple-400">AI Severity: {incident.aiAnalysis.severity}%</span>
        </div>
      )}
    </div>
  );
}
