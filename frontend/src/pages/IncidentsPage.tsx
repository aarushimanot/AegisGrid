import { useState, useMemo } from 'react';
import { Search, Download, FileText, ChevronDown, MapPin, Clock, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { exportToCSV } from '../services/mockApi';
import type { EmergencyType, Priority, IncidentStatus } from '../types';
import { getStatusBadge, getPriorityColor, formatDateTime } from '../utils/helpers';
import TypeIcon from '../components/TypeIcon';
import { useNavigate } from 'react-router-dom';

const STATUSES: IncidentStatus[] = ['Active', 'Critical', 'Resolved', 'Pending', 'Dispatched'];
const PRIORITIES: Priority[] = ['Critical', 'High', 'Medium', 'Low'];
const TYPES: EmergencyType[] = ['Accident', 'Medical', 'Fire', 'Natural Disaster', 'Crime', 'Harassment', 'Gas / Electrical', 'Hazmat', 'Other'];

function EmptyState() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <FileText size={48} className="text-white/10 mb-4" />
      <h3 className="text-lg font-semibold text-white/40 mb-2">No incidents found</h3>
      <p className="text-sm text-white/30 mb-6">Try adjusting your filters or report an incident</p>
      <button onClick={() => navigate('/admin')} className="btn-primary text-sm">
        <AlertTriangle size={15} />
        Report Emergency
      </button>
    </div>
  );
}

export default function IncidentsPage() {
  const { incidents } = useApp();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [filterType, setFilterType] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'createdAt' | 'priority'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const priorityOrder: Record<Priority, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

  const filtered = useMemo(() => {
    let result = incidents.filter(inc => {
      const q = search.toLowerCase();
      const matchSearch = !search ||
        inc.id.toLowerCase().includes(q) ||
        (inc.displayId ?? '').toLowerCase().includes(q) ||
        inc.type.toLowerCase().includes(q) ||
        inc.description.toLowerCase().includes(q) ||
        (inc.location.address ?? '').toLowerCase().includes(q);
      const matchStatus = filterStatus === 'All' || inc.status === filterStatus;
      const matchPriority = filterPriority === 'All' || inc.priority === filterPriority;
      const matchType = filterType === 'All' || inc.type === filterType;
      return matchSearch && matchStatus && matchPriority && matchType;
    });

    result.sort((a, b) => {
      if (sortBy === 'createdAt') {
        return sortDir === 'desc'
          ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else {
        return sortDir === 'desc'
          ? priorityOrder[b.priority] - priorityOrder[a.priority]
          : priorityOrder[a.priority] - priorityOrder[b.priority];
      }
    });

    return result;
  }, [incidents, search, filterStatus, filterPriority, filterType, sortBy, sortDir]);

  const toggleSort = (field: 'createdAt' | 'priority') => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('desc'); }
  };

  const handleExport = () => {
    exportToCSV(filtered);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Incident Management</h2>
          <p className="text-sm text-white/40 mt-1">
            {filtered.length} active records in view
          </p>
        </div>
        <button onClick={handleExport} className="btn-secondary text-sm">
          <Download size={15} />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              placeholder="Search incidents..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-field pl-9 text-sm py-2"
            />
          </div>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="select-field text-sm py-2 w-36"
          >
            <option value="All">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value)}
            className="select-field text-sm py-2 w-36"
          >
            <option value="All">All Priorities</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="select-field text-sm py-2 w-40"
          >
            <option value="All">All Types</option>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 bg-black-200">
                <th className="text-left text-xs text-white/40 font-medium px-4 py-3">ID</th>
                <th className="text-left text-xs text-white/40 font-medium px-4 py-3">Type</th>
                <th className="text-left text-xs text-white/40 font-medium px-4 py-3 cursor-pointer hover:text-white/70 select-none"
                  onClick={() => toggleSort('priority')}>
                  <div className="flex items-center gap-1">Priority <ChevronDown size={12} className={sortBy === 'priority' ? 'text-red-400' : ''} /></div>
                </th>
                <th className="text-left text-xs text-white/40 font-medium px-4 py-3">Status</th>
                <th className="text-left text-xs text-white/40 font-medium px-4 py-3">Location</th>
                <th className="text-left text-xs text-white/40 font-medium px-4 py-3 cursor-pointer hover:text-white/70 select-none"
                  onClick={() => toggleSort('createdAt')}>
                  <div className="flex items-center gap-1">Created <ChevronDown size={12} className={sortBy === 'createdAt' ? 'text-red-400' : ''} /></div>
                </th>
                <th className="text-left text-xs text-white/40 font-medium px-4 py-3">AI Severity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7}><EmptyState /></td>
                </tr>
              ) : (
                filtered.map(inc => (
                  <tr
                    key={inc.id}
                    className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors group"
                    onClick={() => navigate(`/admin/requests/${inc.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-white/60 group-hover:text-white/80 transition-colors">{inc.displayId ?? inc.id}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <TypeIcon type={inc.type} size={15} />
                        <span className="text-sm text-white/80">{inc.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-1 rounded ${getPriorityColor(inc.priority)}`}>
                        {inc.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`status-badge text-[10px] ${getStatusBadge(inc.status)}`}>{inc.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-white/50 max-w-[150px]">
                        <MapPin size={11} className="flex-shrink-0" />
                        <span className="truncate">{inc.location.address ?? 'Unknown'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50">
                      <div className="flex items-center gap-1.5">
                        <Clock size={11} />
                        {formatDateTime(inc.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {inc.aiAnalysis ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-white/10 rounded-full max-w-[60px]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${inc.aiAnalysis.severity}%`,
                                background: inc.aiAnalysis.severity > 75 ? '#E50914' : inc.aiAnalysis.severity > 50 ? '#ffa500' : '#4caf50',
                              }}
                            />
                          </div>
                          <span className="text-xs text-white/40">{inc.aiAnalysis.severity}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-white/20">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
