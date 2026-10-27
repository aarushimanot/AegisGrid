import { useState, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, RadarChart,
  Radar, PolarGrid, PolarAngleAxis
} from 'recharts';
import {
  TrendingUp, Download, Calendar, FlaskConical, BarChart3, PieChart as PieIcon
} from 'lucide-react';
import {
  TREND_DATA, TYPE_DISTRIBUTION, PRIORITY_DISTRIBUTION, RESPONSE_TIME_DATA
} from '../data/mockData';
import { useApp } from '../context/AppContext';
import { exportToCSV } from '../services/mockApi';
import type { EmergencyType } from '../types';
import { getTypeColor } from '../utils/helpers';
import {
  hourlyDistribution, performanceMetrics, priorityDistribution, responseTimeByType, trendData, typeDistribution,
} from '../utils/liveAnalytics';

const RANGE_DAYS: Record<string, number | null> = { 'Last 7 Days': 7, 'Last 30 Days': 30, 'Last 90 Days': 90, 'All Time': null };

const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#1a1a1a',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 12,
  }
};

const EMERGENCY_TYPES: EmergencyType[] = ['Accident', 'Medical', 'Fire', 'Natural Disaster', 'Crime', 'Harassment', 'Gas / Electrical', 'Hazmat', 'Other'];
const DATE_RANGES = ['Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'All Time'];

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="glass-card p-4 text-center hover:border-white/20 transition-all">
      <div className={`text-2xl font-bold mb-1 ${color ?? 'text-white'}`}>{value}</div>
      <div className="text-xs text-white/50 mb-1">{label}</div>
      {sub && <div className="text-[10px] text-purple-400">{sub}</div>}
    </div>
  );
}

export default function AnalyticsPage() {
  const { incidents } = useApp();
  const [dateRange, setDateRange] = useState('Last 7 Days');
  const [typeFilter, setTypeFilter] = useState<string>('All');

  const filteredIncidents = useMemo(() => {
    const byType = typeFilter === 'All' ? incidents : incidents.filter(i => i.type === typeFilter);
    const days = RANGE_DAYS[dateRange];
    if (!days) return byType;
    const since = Date.now() - days * 86_400_000;
    return byType.filter(i => Date.parse(i.createdAt) >= since);
  }, [incidents, typeFilter, dateRange]);

  const demoHourly = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, h) => ({
      hour: `${h.toString().padStart(2, '0')}:00`,
      count: Math.floor(Math.random() * 8) + 1,
    }));
    return hours;
  }, []);

  const live = useMemo(() => {
    return {
      trend: trendData(filteredIncidents),
      types: typeDistribution(filteredIncidents),
      priorities: priorityDistribution(filteredIncidents),
      responseTimes: responseTimeByType(filteredIncidents),
      hourly: hourlyDistribution(filteredIncidents),
      metrics: performanceMetrics(filteredIncidents),
    };
  }, [filteredIncidents]);

  const TREND = live?.trend ?? TREND_DATA;
  const TYPES = live?.types ?? TYPE_DISTRIBUTION;
  const PRIORITIES = live?.priorities ?? PRIORITY_DISTRIBUTION;
  const RESPONSE_TIMES = live?.responseTimes ?? RESPONSE_TIME_DATA;
  const hourlyData = live?.hourly ?? demoHourly;

  const radarData = live ? [
    { subject: 'Dispatch Coverage', A: live.metrics.dispatchCoverage },
    { subject: 'AI Confidence', A: live.metrics.avgConfidence },
    { subject: 'Bedrock Assessed', A: live.metrics.bedrockAssessed },
    { subject: 'Multi-Agency', A: live.metrics.multiAgency },
    { subject: 'Fast Dispatch (≤2m)', A: live.metrics.fastDispatch },
    { subject: 'Media Reports', A: live.metrics.mediaReports },
  ] : [
    { subject: 'Response Speed', A: 85 },
    { subject: 'Accuracy', A: 92 },
    { subject: 'Coverage', A: 78 },
    { subject: 'Agent Uptime', A: 96 },
    { subject: 'Data Quality', A: 88 },
    { subject: 'User Reports', A: 74 },
  ];

  const handleExport = () => {
    exportToCSV(filteredIncidents);
  };

  const criticalCount = filteredIncidents.filter(i => i.priority === 'Critical').length;
  const resolvedCount = filteredIncidents.filter(i => i.status === 'Resolved').length;
  const resolutionRate = filteredIncidents.length > 0
    ? ((resolvedCount / filteredIncidents.length) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Analytics & Insights</h2>
          <p className="text-sm text-white/40 mt-1">Operational metrics and fleet response intelligence</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value)}
            className="select-field text-sm py-2 w-40"
          >
            {DATE_RANGES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="select-field text-sm py-2 w-40"
          >
            <option value="All">All Types</option>
            {EMERGENCY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={handleExport} className="btn-secondary text-sm">
            <Download size={15} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Incidents" value={filteredIncidents.length} sub="All recorded" />
        <StatCard label="Critical Cases" value={criticalCount} color="text-red-400" sub="Priority triage" />
        <StatCard label="Resolution Rate" value={`${resolutionRate}%`} color="text-green-400" sub="Optimal target" />
        <StatCard label="Avg Severity" value={live ? `${live.metrics.avgSeverity}%` : '68%'} color="text-orange-400" sub="Grid average" />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 7-Day Trend */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-white">7-Day Priority Trend</h3>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={TREND}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }} />
              <Line type="monotone" dataKey="critical" stroke="#E50914" strokeWidth={2} dot={{ fill: '#E50914', r: 3 }} name="Critical" />
              <Line type="monotone" dataKey="high" stroke="#ff6b35" strokeWidth={2} dot={{ fill: '#ff6b35', r: 3 }} name="High" />
              <Line type="monotone" dataKey="medium" stroke="#ffa500" strokeWidth={1.5} dot={{ fill: '#ffa500', r: 2 }} name="Medium" />
              <Line type="monotone" dataKey="low" stroke="#4caf50" strokeWidth={1.5} dot={{ fill: '#4caf50', r: 2 }} name="Low" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Emergency Types */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <PieIcon size={14} className="text-red-400" />
              <h3 className="text-sm font-semibold text-white">Emergency Type Distribution</h3>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="60%" height={220}>
              <PieChart>
                <Pie data={TYPES} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                  dataKey="value" paddingAngle={3}>
                  {TYPES.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Share']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {TYPES.map(d => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
                  <span className="text-xs text-white/60 flex-1 truncate">{d.name}</span>
                  <span className="text-xs font-bold text-white">{d.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Response Times */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={14} className="text-green-400" />
              <h3 className="text-sm font-semibold text-white">Avg Response Time by Type</h3>
            </div>
            <span className="text-xs text-white/40">Minutes</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={RESPONSE_TIMES} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} width={95} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v} min`, 'Avg Response']} />
              <Bar dataKey="avgTime" radius={[0, 4, 4, 0]}>
                {RESPONSE_TIMES.map((entry, i) => (
                  <Cell key={i} fill={getTypeColor(entry.name as EmergencyType)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Priority Distribution Bar */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={14} className="text-orange-400" />
              <h3 className="text-sm font-semibold text-white">Priority Distribution</h3>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={PRIORITIES}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Share']} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {PRIORITIES.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Hourly Distribution */}
        <div className="glass-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-white">24-Hour Incident Distribution</h3>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={hourlyData}>
              <defs>
                <linearGradient id="hourGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#E50914" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#E50914" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="hour" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false}
                interval={3} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="count" stroke="#E50914" fill="url(#hourGrad)" strokeWidth={2} name="Incidents" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* System Performance Radar */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FlaskConical size={14} className="text-purple-400" />
              <h3 className="text-sm font-semibold text-white">System Performance</h3>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.08)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} />
              <Radar name="Performance" dataKey="A" stroke="#E50914" fill="#E50914" fillOpacity={0.15} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Performance Score']} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Resolution Stats */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-green-400" />
              <h3 className="text-sm font-semibold text-white">Incident Statistics</h3>
            </div>
          </div>
          <div className="space-y-4">
            {(live ? [
              { label: 'Critical Resolution Rate', value: live.metrics.criticalResolution, color: '#E50914' },
              { label: 'Avg AI Confidence Score', value: live.metrics.avgConfidence, color: '#9b59b6' },
              { label: 'Multi-Agency Coordination', value: live.metrics.multiAgency, color: '#3498db' },
              { label: 'Agent Dispatch Coverage', value: live.metrics.dispatchCoverage, color: '#27ae60' },
              { label: 'Overall Resolution Rate', value: live.metrics.resolutionRate, color: '#fd79a8' },
            ] : [
              { label: 'Critical Resolution Rate', value: 78, color: '#E50914' },
              { label: 'Avg AI Confidence Score', value: 84, color: '#9b59b6' },
              { label: 'Multi-Agency Coordination', value: 62, color: '#3498db' },
              { label: 'First Responder Efficiency', value: 91, color: '#27ae60' },
              { label: 'Notification Delivery Rate', value: 99, color: '#fd79a8' },
            ]).map(({ label, value, color }) => (
              <div key={label}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs text-white/60">{label}</span>
                  <span className="text-xs font-bold text-white">{value}%</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${value}%`, background: color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
