import config from './config.json';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre resolves its worker at runtime, so Vite must bundle it explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
// MapLibre reads the local PMTiles archive through the pmtiles protocol; no access token or hosted service is used.
export async function loadMapEngine() {
  const [maplibregl, { Protocol }] = await Promise.all([import('maplibre-gl'), import('pmtiles')]);
  maplibregl.setWorkerUrl(workerUrl);
  const protocol = new Protocol();
  maplibregl.removeProtocol('pmtiles');
  maplibregl.addProtocol('pmtiles', protocol.tile);
  const baseStyle: import('maplibre-gl').StyleSpecification = {
    version: 8,
    sources: { world: { type: 'vector', url: `pmtiles://${new URL(config.archive, window.location.origin + import.meta.env.BASE_URL).href}`, attribution: '© OpenStreetMap contributors · Protomaps' } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#aac7e8' } },
      { id: 'earth', type: 'fill', source: 'world', 'source-layer': 'earth', paint: { 'fill-color': '#f3eddc' } },
      { id: 'water', type: 'fill', source: 'world', 'source-layer': 'water', paint: { 'fill-color': '#aac7e8' } },
      { id: 'boundaries', type: 'line', source: 'world', 'source-layer': 'boundaries', paint: { 'line-color': '#888', 'line-width': 0.6, 'line-dasharray': [2, 2] } }
    ]
  };
  return { Map: maplibregl.Map, Marker: maplibregl.Marker, Popup: maplibregl.Popup, NavigationControl: maplibregl.NavigationControl, LngLatBounds: maplibregl.LngLatBounds, baseStyle };
}
