// Address → coordinates via OpenStreetMap Nominatim (free, ~1 request/s).
// Used only when the reporter types an address instead of sharing GPS.

export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(address)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const results = (await res.json()) as { lat: string; lon: string }[];
    const first = results[0];
    return first ? { lat: Number(first.lat), lon: Number(first.lon) } : null;
  } catch {
    return null;
  }
}

export function formatCoords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
}
