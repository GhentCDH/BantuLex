<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { loadMapEngine } from './engine';
import config from './config.json';
import { isMappable, type Coordinate } from './coordinates';
const props = defineProps<{ points: Coordinate[]; linkToDetail?: boolean }>();
const router = useRouter(), container = ref<HTMLDivElement>(), error = ref(''), ready = ref(false);
const valid = computed(() => props.points.filter(isMappable));
let map: any, engine: any, markers: any[] = [], observer: ResizeObserver | undefined, disposed = false;
function draw() {
  if (!map) return;
  markers.forEach(marker => marker.remove()); markers = [];
  const bounds = new engine.LngLatBounds();
  for (const point of valid.value) {
    const position = [point.longitude!, point.latitude!];
    const content = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `Coordinate #${point.id}`; content.append(title);
    const description = document.createElement('p'); description.textContent = point.description || ''; content.append(description);
    const coordinates = document.createElement('p'); coordinates.textContent = `${point.latitude}, ${point.longitude}`; content.append(coordinates);
    if (props.linkToDetail) {
      const link = document.createElement('a'); link.textContent = 'View coordinate';
      link.href = router.resolve({ path: `/crouton/${config.resource}`, query: { id: point.id, event: 'view' } }).href;
      // A full navigation also supports Crouton's initial-query modal handling.
      link.className = 'link'; content.append(link);
    }
    const marker = new engine.Marker({ color: '#b64532' }).setLngLat(position)
      .setPopup(new engine.Popup({ offset: 25 }).setDOMContent(content)).addTo(map);
    marker.getElement().setAttribute('aria-label', `Coordinate #${point.id}`);
    markers.push(marker); bounds.extend(position);
  }
  if (valid.value.length) map.fitBounds(bounds, { padding: 45, maxZoom: 5, duration: 0 });
}
watch(valid, draw);
onMounted(async () => {
  try {
    engine = await loadMapEngine();
    if (disposed || !container.value) return;
    map = new engine.Map({ container: container.value, style: engine.baseStyle, center: [22, -3], zoom: 2, maxZoom: config.maxZoom, attributionControl: { compact: true } });
    map.addControl(new engine.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => { ready.value = true; });
    map.on('error', (event: { error: Error }) => { error.value = event.error.message; });
    observer = new ResizeObserver(() => map?.resize()); observer.observe(container.value);
    draw();
  } catch (e) { error.value = (e as Error).message; }
});
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); markers.forEach(marker => marker.remove()); map?.remove(); });
</script>
<template>
  <div class="coordinate-map" :data-map-ready="ready" :data-marker-count="valid.length">
    <p class="text-sm mb-2">{{ valid.length }} {{ valid.length === 1 ? 'coordinate' : 'coordinates' }} on map<span v-if="points.length > valid.length"> · {{ points.length - valid.length }} without valid latitude/longitude</span></p>
    <p v-if="!valid.length" class="text-sm mb-2">No valid coordinates to display.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div ref="container" class="map-canvas" role="region" aria-label="Coordinate map" />
  </div>
</template>
<style scoped>
.coordinate-map { width: 100%; min-width: 0; }
.map-canvas { height: 420px; width: 100%; border-radius: 8px; overflow: hidden; border: 1px solid #d1d5db; }
</style>
