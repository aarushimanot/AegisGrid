// Geospatial helpers. Pure functions, unit tested in tests/geo.test.ts.

import type { GeoPoint } from "./types";

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two points in kilometres. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Road-network ETA estimate. Straight-line distance is multiplied by a
 * detour factor (urban roads are ~1.4x longer than the crow flies) and divided
 * by an average emergency-vehicle speed.
 */
export function estimateEtaMinutes(distanceKm: number, avgSpeedKmh = 40, detourFactor = 1.4): number {
  return Math.max(1, Math.round(((distanceKm * detourFactor) / avgSpeedKmh) * 60));
}

/**
 * Shortest distance (km) from point p to the segment a→b, using an
 * equirectangular projection (accurate enough at city scale).
 */
export function distanceToSegmentKm(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const refLat = toRad((a.lat + b.lat) / 2);
  const project = (g: GeoPoint) => ({
    x: toRad(g.lon) * Math.cos(refLat) * EARTH_RADIUS_KM,
    y: toRad(g.lat) * EARTH_RADIUS_KM,
  });
  const P = project(p);
  const A = project(a);
  const B = project(b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq));
  const cx = A.x + t * dx;
  const cy = A.y + t * dy;
  return Math.hypot(P.x - cx, P.y - cy);
}

export function isValidPoint(p: GeoPoint): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}
