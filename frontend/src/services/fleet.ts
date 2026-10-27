// Stations shown on the live map. Each registered station is a marker coloured
// by service, with availability from its own console.

import { SERVICES } from '@core/catalog';
import type { ApiStation, ServiceType } from './apiTypes';

export type UnitKind = ServiceType;
export type UnitStatus = 'available' | 'busy' | 'offline';

export interface MapUnit {
  id: string;
  name: string;
  kind: UnitKind;
  status: UnitStatus;
  lat: number;
  lng: number;
  detail?: string;
}

export function stationUnits(stations: ApiStation[]): MapUnit[] {
  return stations
    .filter(s => s.status === 'APPROVED')
    .map(s => ({
      id: s.stationId,
      name: s.name,
      kind: s.serviceType,
      status: !s.onDuty ? 'offline' : s.unitsAvailable === 0 ? 'busy' : 'available',
      lat: s.location.lat,
      lng: s.location.lon,
      detail: `${s.onDuty ? 'On duty' : 'Off duty'} · ${s.unitsAvailable} of ${s.unitsTotal} ${SERVICES[s.serviceType].unitLabel} free`,
    }));
}
