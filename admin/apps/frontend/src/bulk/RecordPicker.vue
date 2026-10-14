<script setup lang="ts">
// Search a Crouton resource the way its relation pickers do (GET /api/<resource>?q=)
// and pick one record by its display_label.
import { ref, watch } from 'vue';
import axios from 'axios';

export interface PickedRecord { id: number; label: string }
const props = defineProps<{ resource: string; label: string; placeholder?: string }>();
const model = defineModel<PickedRecord | null>({ default: null });

const query = ref('');
const results = ref<PickedRecord[]>([]);
const open = ref(false);
const loading = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;

async function search(q: string) {
  controller?.abort();
  const current = controller = new AbortController();
  loading.value = true;
  try {
    const { data } = await axios.get(`/api/${props.resource}`, { params: { q: q || undefined, pageSize: 20 }, signal: current.signal });
    results.value = data.data.map((r: any) => ({ id: r.id, label: r.display_label ?? `#${r.id}` }));
  } catch (e) {
    if (!current.signal.aborted) results.value = [];
  } finally {
    if (!current.signal.aborted) loading.value = false;
  }
}
watch(query, (q) => { clearTimeout(timer); timer = setTimeout(() => search(q.trim()), 250); });

function choose(r: PickedRecord) { model.value = r; open.value = false; query.value = ''; }
// Delay so a click on a result still lands before the list closes.
function onBlur() { setTimeout(() => (open.value = false), 150); }
function onFocus() { open.value = true; if (!results.value.length) search(query.value.trim()); }
</script>

<template>
  <div class="relative">
    <label class="block text-sm font-semibold mb-1">{{ label }}</label>
    <div v-if="model" class="flex items-center gap-2">
      <span class="badge">{{ model.label }}</span>
      <button type="button" class="btn btn-sm" @click="model = null">Change</button>
    </div>
    <template v-else>
      <input v-model="query" class="w-full border rounded px-2 py-1 text-sm" :placeholder="placeholder ?? 'Search…'"
             :aria-label="label" @focus="onFocus" @blur="onBlur" />
      <ul v-if="open" class="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-white border rounded shadow text-sm">
        <li v-if="loading" class="px-2 py-1 opacity-60">Searching…</li>
        <li v-else-if="!results.length" class="px-2 py-1 opacity-60">No matches</li>
        <li v-for="r in results" :key="r.id">
          <button type="button" class="w-full text-left px-2 py-1 hover:bg-blue-50" @mousedown.prevent="choose(r)">{{ r.label }}</button>
        </li>
      </ul>
    </template>
  </div>
</template>
