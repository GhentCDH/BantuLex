<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import CoordinateMap from './CoordinateMap.vue';
import { loadCoordinates, type Coordinate } from './coordinates';
const route = useRoute();
const points = ref<Coordinate[]>([]), loading = ref(false), error = ref('');
let controller: AbortController | undefined;
async function refresh() {
  controller?.abort(); const current = controller = new AbortController();
  loading.value = true; error.value = '';
  try { points.value = await loadCoordinates(current.signal); }
  catch (e) { if (!current.signal.aborted) error.value = (e as Error).message; }
  finally { if (!current.signal.aborted) loading.value = false; }
}
// Closing Crouton's edit/create/delete overlay refreshes the map from SQLite.
watch(() => route.query.event, (event) => { if (!event) void refresh(); }, { immediate: true });
onBeforeUnmount(() => controller?.abort());
</script>
<template>
  <section class="max-w-screen-xl mx-auto p-4" aria-label="All coordinates">
    <div class="flex items-center justify-between mb-3"><h2 class="text-xl font-semibold">All coordinates</h2><button class="btn btn-sm" :disabled="loading" @click="refresh">Refresh map</button></div>
    <p v-if="loading" role="status">Loading coordinates…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <CoordinateMap :points="points" :link-to-detail="true" />
  </section>
</template>
