// Click-to-place map pin, used to fix a station's exact physical location.

import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

const PIN = L.divIcon({
  className: 'lm-leaflet-icon',
  html: '<span class="lm-incident" style="background:#E50914;width:22px;height:22px"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function ClickToSet({ onChange }: { onChange: (p: { lat: number; lon: number }) => void }) {
  useMapEvents({ click: e => onChange({ lat: Math.round(e.latlng.lat * 1e6) / 1e6, lon: Math.round(e.latlng.lng * 1e6) / 1e6 }) });
  return null;
}

function Recenter({ at }: { at?: { lat: number; lon: number } }) {
  const map = useMap();
  useEffect(() => {
    if (at) map.setView([at.lat, at.lon], Math.max(map.getZoom(), 15));
  }, [at?.lat, at?.lon, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function PinMap({ value, onChange, height = 260 }: { value?: { lat: number; lon: number }; onChange: (p: { lat: number; lon: number }) => void; height?: number }) {
  return (
    <div className="rounded-lg overflow-hidden border border-white/10" style={{ height }}>
      <MapContainer center={[value?.lat ?? 12.945, value?.lon ?? 79.145]} zoom={value ? 15 : 12} style={{ height: '100%', width: '100%' }} className="lm-dark">
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' maxZoom={19} />
        <ClickToSet onChange={onChange} />
        <Recenter at={value} />
        {value && <Marker position={[value.lat, value.lon]} icon={PIN} />}
      </MapContainer>
    </div>
  );
}
