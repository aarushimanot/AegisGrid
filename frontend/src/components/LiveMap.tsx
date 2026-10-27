// Live operations map: incidents and the registered stations of all eight
// services, with a line from each station handling a request to the incident.
//
// Uses Google Maps (with live traffic) when VITE_GOOGLE_MAPS_API_KEY is set,
// otherwise free OpenStreetMap tiles through Leaflet, restyled dark with CSS.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ambulance, Flame, HeartHandshake, Hospital, LifeBuoy, ShieldCheck, TrafficCone, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { APIProvider, AdvancedMarker, ColorScheme, InfoWindow, Map as GoogleMap, Polyline as GooglePolyline, useMap as useGoogleMap } from '@vis.gl/react-google-maps';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap as useLeafletMap } from 'react-leaflet';
import L from 'leaflet';
import { config } from '../config';
import type { Incident, Priority } from '../types';
import type { MapUnit, UnitKind } from '../services/fleet';
import { TYPE_ICON } from './TypeIcon';

const VELLORE = { lat: 12.9450, lng: 79.1450 };

const PRIORITY_COLOR: Record<Priority, string> = { Critical: '#E50914', High: '#ff6b35', Medium: '#ffa500', Low: '#4caf50' };

export const KIND: Record<UnitKind, { label: string; color: string; Icon: LucideIcon }> = {
  AMBULANCE: { label: 'Ambulance', color: '#f43f5e', Icon: Ambulance },
  FIRE: { label: 'Fire', color: '#f97316', Icon: Flame },
  POLICE: { label: 'Police', color: '#3b82f6', Icon: ShieldCheck },
  TRAFFIC_POLICE: { label: 'Traffic', color: '#eab308', Icon: TrafficCone },
  HOSPITAL: { label: 'Hospitals', color: '#22c55e', Icon: Hospital },
  DISASTER_RESPONSE: { label: 'Disaster', color: '#06b6d4', Icon: LifeBuoy },
  WOMEN_CHILD_SAFETY: { label: 'Women & Child', color: '#ec4899', Icon: HeartHandshake },
  UTILITY_EMERGENCY: { label: 'Gas & Power', color: '#a3e635', Icon: Zap },
};
const KINDS = Object.keys(KIND) as UnitKind[];

const STATUS_COLOR: Record<MapUnit['status'], string> = { available: '#22c55e', busy: '#f59e0b', offline: '#6b7280' };

type Layer = 'incidents' | UnitKind | 'traffic';
type Selection = { kind: 'incident'; id: string } | { kind: 'unit'; id: string } | null;
interface Point { lat: number; lng: number }
interface Line { id: string; path: [Point, Point]; color: string; dashed?: boolean }

// ── Marker visuals (shared by both map engines) ─────────────────────────────

function IncidentPin({ incident, selected }: { incident: Incident; selected?: boolean }) {
  const Icon = TYPE_ICON[incident.type];
  const color = PRIORITY_COLOR[incident.priority];
  const live = incident.status !== 'Resolved';
  return (
    <div className="lm-pin" style={{ opacity: live ? 1 : 0.45 }}>
      {live && incident.priority === 'Critical' && <span className="lm-pulse" style={{ background: color }} />}
      <span className="lm-incident" style={{ background: color, outline: selected ? '2px solid #fff' : undefined }}>
        <Icon size={15} color="#fff" strokeWidth={2.25} />
      </span>
    </div>
  );
}

function UnitPin({ unit, selected }: { unit: MapUnit; selected?: boolean }) {
  const { color, Icon } = KIND[unit.kind];
  return (
    <span className="lm-unit" style={{ borderColor: color, outline: selected ? '2px solid #fff' : undefined, opacity: unit.status === 'offline' ? 0.5 : 1 }}>
      <Icon size={13} color={color} strokeWidth={2.25} />
      <span className="lm-status" style={{ background: STATUS_COLOR[unit.status] }} />
    </span>
  );
}

function IncidentDetails({ incident, onOpen }: { incident: Incident; onOpen?: (id: string) => void }) {
  return (
    <div className="lm-card">
      <div className="lm-card-title">{incident.displayId ?? incident.id} · {incident.type}</div>
      <div className="lm-card-row"><b style={{ color: PRIORITY_COLOR[incident.priority] }}>{incident.priority}</b> · {incident.status}</div>
      <div className="lm-card-row">{incident.location.address}</div>
      {incident.dispatch?.map(d => <div key={d.agent} className="lm-card-row lm-muted">{d.summary}</div>)}
      {onOpen && <button className="lm-card-link" onClick={() => onOpen(incident.id)}>Open incident →</button>}
    </div>
  );
}

function UnitDetails({ unit }: { unit: MapUnit }) {
  const status = unit.status === 'busy' ? 'All units committed' : unit.status === 'available' ? 'Available' : 'Off duty';
  return (
    <div className="lm-card">
      <div className="lm-card-title">{unit.name}</div>
      <div className="lm-card-row">{KIND[unit.kind].label} · {status}</div>
      {unit.detail && <div className="lm-card-row lm-muted">{unit.detail}</div>}
    </div>
  );
}

// ── Google Maps engine ──────────────────────────────────────────────────────

function GoogleFit({ points, fitKey }: { points: Point[]; fitKey: string }) {
  const map = useGoogleMap();
  const done = useRef('');
  useEffect(() => {
    if (!map || !points.length || done.current === fitKey) return;
    done.current = fitKey;
    if (points.length === 1) {
      map.setCenter(points[0]!);
      map.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, 48);
  }, [map, points, fitKey]);
  return null;
}

function GoogleTraffic({ on }: { on: boolean }) {
  const map = useGoogleMap();
  useEffect(() => {
    if (!map || !on) return;
    const layer = new google.maps.TrafficLayer();
    layer.setMap(map);
    return () => layer.setMap(null);
  }, [map, on]);
  return null;
}

// ── Leaflet engine ──────────────────────────────────────────────────────────

function LeafletFit({ points, fitKey }: { points: Point[]; fitKey: string }) {
  const map = useLeafletMap();
  const done = useRef('');
  useEffect(() => {
    if (!points.length || done.current === fitKey) return;
    done.current = fitKey;
    if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lng], 15);
    else map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number])), { padding: [36, 36] });
  }, [map, points, fitKey]);
  return null;
}

const iconCache = new Map<string, L.DivIcon>();
function divIcon(key: string, node: ReactNode, size: number): L.DivIcon {
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({ html: renderToStaticMarkup(<>{node}</>), className: 'lm-leaflet-icon', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    iconCache.set(key, icon);
  }
  return icon;
}

// ── Component ───────────────────────────────────────────────────────────────

interface LiveMapProps {
  incidents: Incident[];
  units: MapUnit[];
  height: number;
  /** Detail view: show only this incident and the resources committed to it. */
  focusIncidentId?: string;
  onOpenIncident?: (id: string) => void;
  /** "Live" in live mode, "Demo" otherwise; shown in the toolbar. */
  sourceLabel?: string;
  /** Hide the layer toolbar (e.g. citizen-facing maps). */
  minimal?: boolean;
}

export default function LiveMap({ incidents, units, height, focusIncidentId, onOpenIncident, sourceLabel, minimal }: LiveMapProps) {
  const useGoogle = config.googleMapsApiKey.length > 0;
  const [layers, setLayers] = useState<Record<Layer, boolean>>(() => ({
    incidents: true, traffic: false, ...Object.fromEntries(KINDS.map(k => [k, true])),
  }) as Record<Layer, boolean>);
  const [selected, setSelected] = useState<Selection>(null);

  const focus = focusIncidentId ? incidents.find(i => i.id === focusIncidentId) : undefined;
  const shownIncidents = useMemo(() => (focus ? [focus] : incidents), [focus, incidents]);

  const shownUnits = useMemo(() => {
    const related = focus ? new Set(focus.dispatch?.flatMap(d => d.resourceIds ?? []) ?? []) : null;
    return units.filter(u => {
      if (!layers[u.kind]) return false;
      if (!focus) return true;
      return related!.has(u.id);
    });
  }, [units, layers, focus]);

  const byId = useMemo(() => new Map(shownIncidents.map(i => [i.id, i])), [shownIncidents]);

  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [];
    const committedTo = new Map<string, string>();
    for (const inc of shownIncidents) for (const d of inc.dispatch ?? []) for (const id of d.resourceIds ?? []) committedTo.set(id, inc.id);
    for (const u of shownUnits) {
      const incId = committedTo.get(u.id);
      const inc = incId ? byId.get(incId) : undefined;
      if (!inc || inc.status === 'Resolved') continue;
      out.push({ id: `${u.id}-${inc.id}`, path: [{ lat: u.lat, lng: u.lng }, { lat: inc.location.lat, lng: inc.location.lng }], color: KIND[u.kind].color });
    }
    return out;
  }, [shownUnits, shownIncidents, byId]);

  const fitPoints = useMemo<Point[]>(() => {
    if (focus) {
      const pts: Point[] = [{ lat: focus.location.lat, lng: focus.location.lng }];
      lines.forEach(l => pts.push(l.path[0], l.path[1]));
      return pts;
    }
    const pts = incidents.filter(i => i.status !== 'Resolved').map(i => ({ lat: i.location.lat, lng: i.location.lng }));
    return pts.length ? pts : units.map(u => ({ lat: u.lat, lng: u.lng }));
  }, [focus, lines, incidents, units]);
  // Re-fit only when the view changes or the first data arrives, not on every poll.
  const fitKey = `${focusIncidentId ?? 'all'}:${fitPoints.length > 0}:${focus ? lines.length : ''}`;

  const selectedIncident = selected?.kind === 'incident' ? shownIncidents.find(i => i.id === selected.id) : undefined;
  const selectedUnit = selected?.kind === 'unit' ? shownUnits.find(u => u.id === selected.id) : undefined;

  const toggles: { key: Layer; label: string; color: string }[] = [
    { key: 'incidents', label: 'Incidents', color: '#E50914' },
    ...KINDS.map(k => ({ key: k as Layer, label: KIND[k].label, color: KIND[k].color })),
    ...(useGoogle ? [{ key: 'traffic' as Layer, label: 'Live traffic', color: '#eab308' }] : []),
  ];

  const onDuty = units.filter(u => u.status !== 'offline').length;
  const committed = lines.length;

  return (
    <div>
      <div className={minimal ? 'hidden' : 'flex flex-wrap items-center gap-1.5 mb-2.5'}>
        {!focus && toggles.map(t => (
          <button
            key={t.key}
            onClick={() => setLayers(l => ({ ...l, [t.key]: !l[t.key] }))}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] transition-colors ${layers[t.key] ? 'border-white/20 text-white/80 bg-white/5' : 'border-white/5 text-white/30'}`}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: layers[t.key] ? t.color : 'transparent', border: `1px solid ${t.color}` }} />
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-white/40">
          {!focus && <span>{onDuty} stations on duty · {committed} responding</span>}
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {sourceLabel ?? 'Live'} · {useGoogle ? 'Google Maps' : 'OpenStreetMap'}
          </span>
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border border-white/5" style={{ height }}>
        {useGoogle ? (
          <APIProvider apiKey={config.googleMapsApiKey}>
            <GoogleMap
              mapId={config.googleMapId}
              colorScheme={ColorScheme.DARK}
              defaultCenter={VELLORE}
              defaultZoom={13}
              gestureHandling="greedy"
              mapTypeControl={false}
              streetViewControl={false}
              clickableIcons={false}
              style={{ width: '100%', height: '100%' }}
              onClick={() => setSelected(null)}
            >
              <GoogleFit points={fitPoints} fitKey={fitKey} />
              <GoogleTraffic on={layers.traffic} />
              {lines.map(l => (
                <GooglePolyline
                  key={l.id}
                  path={l.path}
                  strokeColor={l.color}
                  strokeOpacity={l.dashed ? 0 : 0.85}
                  strokeWeight={3}
                  icons={l.dashed ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: l.color, scale: 3 }, offset: '0', repeat: '12px' }] : undefined}
                />
              ))}
              {shownUnits.map(u => (
                <AdvancedMarker key={u.id} position={{ lat: u.lat, lng: u.lng }} zIndex={5} onClick={() => setSelected({ kind: 'unit', id: u.id })}>
                  <UnitPin unit={u} selected={selectedUnit?.id === u.id} />
                </AdvancedMarker>
              ))}
              {layers.incidents && shownIncidents.map(i => (
                <AdvancedMarker key={i.id} position={{ lat: i.location.lat, lng: i.location.lng }} zIndex={10} onClick={() => setSelected({ kind: 'incident', id: i.id })}>
                  <IncidentPin incident={i} selected={selectedIncident?.id === i.id} />
                </AdvancedMarker>
              ))}
              {selectedIncident && (
                <InfoWindow position={{ lat: selectedIncident.location.lat, lng: selectedIncident.location.lng }} pixelOffset={[0, -16]} headerDisabled onCloseClick={() => setSelected(null)}>
                  <IncidentDetails incident={selectedIncident} onOpen={onOpenIncident} />
                </InfoWindow>
              )}
              {selectedUnit && (
                <InfoWindow position={{ lat: selectedUnit.lat, lng: selectedUnit.lng }} pixelOffset={[0, -12]} headerDisabled onCloseClick={() => setSelected(null)}>
                  <UnitDetails unit={selectedUnit} />
                </InfoWindow>
              )}
            </GoogleMap>
          </APIProvider>
        ) : (
          <MapContainer center={[VELLORE.lat, VELLORE.lng]} zoom={13} style={{ height: '100%', width: '100%' }} className="lm-dark">
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
            />
            <LeafletFit points={fitPoints} fitKey={fitKey} />
            {lines.map(l => (
              <Polyline key={l.id} positions={l.path.map(p => [p.lat, p.lng] as [number, number])} pathOptions={{ color: l.color, weight: 3, opacity: 0.85, dashArray: l.dashed ? '6 8' : undefined }} />
            ))}
            {shownUnits.map(u => (
              <Marker key={u.id} position={[u.lat, u.lng]} zIndexOffset={500}
                icon={divIcon(`u-${u.kind}-${u.status}`, <UnitPin unit={u} />, 26)}>
                <Popup><UnitDetails unit={u} /></Popup>
              </Marker>
            ))}
            {layers.incidents && shownIncidents.map(i => (
              <Marker key={i.id} position={[i.location.lat, i.location.lng]} zIndexOffset={1000}
                icon={divIcon(`i-${i.type}-${i.priority}-${i.status === 'Resolved'}`, <IncidentPin incident={i} />, 30)}>
                <Popup><IncidentDetails incident={i} onOpen={onOpenIncident} /></Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>
    </div>
  );
}
