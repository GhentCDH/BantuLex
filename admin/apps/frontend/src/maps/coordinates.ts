import config from './config.json';
export interface Coordinate { id: number; latitude: number | null; longitude: number | null; description?: string | null }
export function isMappable(point: Coordinate): boolean {
  return typeof point.latitude === 'number' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && typeof point.longitude === 'number' && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}
export async function loadCoordinates(signal: AbortSignal): Promise<Coordinate[]> {
  const rows: Coordinate[] = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${config.endpoint}?page=${page}&pageSize=${config.pageSize}&sort=id&sortDir=asc`, { signal });
    if (!response.ok) throw new Error('Could not load coordinates. Try refreshing the map.');
    const result = await response.json();
    if (!Array.isArray(result.data)) throw new Error('Unexpected coordinates response.');
    rows.push(...result.data);
    if (result.data.length < config.pageSize) return rows;
  }
}
