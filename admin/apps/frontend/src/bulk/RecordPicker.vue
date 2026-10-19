<script setup lang="ts">
// Search a Crouton resource by name and pick one record. With `fields`, each
// field is searched with Crouton's `filter=<field>:<text>:contains` (relation
// paths like place.name work), one request per field because filters are
// AND-ed; results are merged, ranked by how well the label matches, and shown
// with a detail line so records with the same label can be told apart.
import { ref, watch } from 'vue';
import axios from 'axios';

export interface PickedRecord { id: number; label: string }
interface Hit extends PickedRecord { detail: string; rank: number }

const props = defineProps<{
  resource: string;
  label: string;
  placeholder?: string;
  /** Columns or relation paths to search, e.g. ['place.name', 'region.name']. Without: Crouton's `q`. */
  fields?: string[];
  /** Extra text that tells records with the same label apart (the id is always added). */
  detail?: (row: any) => string | null | undefined;
}>();
const model = defineModel<PickedRecord | null>({ default: null });

const query = ref('');
const results = ref<Hit[]>([]);
const open = ref(false);
const loading = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let latest = 0;

// Lower is better: exact label, label starts with the text, a word starts with it, anywhere.
function rank(label: string, q: string) {
  const l = label.toLowerCase(), t = q.toLowerCase();
  if (!t) return 3;
  if (l === t || l.startsWith(`${t} (`) || l.startsWith(`${t},`)) return 0;
  if (l.startsWith(t)) return 1;
  if (new RegExp(`(^|[\\s,(·-])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(l)) return 2;
  return 3;
}

async function search(q: string) {
  const run = ++latest;
  loading.value = true;
  try {
    const requests = props.fields?.length && q
      ? props.fields.map(f => axios.get(`/api/${props.resource}`, { params: { filter: `${f}:${q}:contains`, pageSize: 20 } }))
      : [axios.get(`/api/${props.resource}`, { params: { q: q || undefined, pageSize: 20 } })];
    const settled = await Promise.allSettled(requests);
    if (run !== latest) return; // a newer search is under way
    const byId = new Map<number, Hit>();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const row of r.value.data.data ?? []) {
        if (byId.has(row.id)) continue;
        const label = row.display_label ?? `#${row.id}`;
        const extra = props.detail?.(row);
        byId.set(row.id, { id: row.id, label, detail: [extra, `#${row.id}`].filter(Boolean).join(' · '), rank: rank(label, q) });
      }
    }
    results.value = [...byId.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label) || a.id - b.id).slice(0, 30);
  } finally {
    if (run === latest) loading.value = false;
  }
}
watch(query, (q) => { clearTimeout(timer); timer = setTimeout(() => search(q.trim()), 250); });

function choose(r: Hit) { model.value = { id: r.id, label: r.label }; open.value = false; query.value = ''; }
// Delay so a click on a result still lands before the list closes.
function onBlur() { setTimeout(() => (open.value = false), 150); }
function onFocus() { open.value = true; if (!results.value.length) search(query.value.trim()); }
</script>

<template>
  <div class="relative">
    <label class="block text-sm font-semibold mb-1">{{ label }}</label>
    <div v-if="model" class="flex items-center gap-2">
      <span class="badge">{{ model.label }} <span class="opacity-60">#{{ model.id }}</span></span>
      <button type="button" class="btn btn-sm" @click="model = null">Change</button>
    </div>
    <template v-else>
      <input v-model="query" class="w-full border rounded px-2 py-1 text-sm" :placeholder="placeholder ?? 'Search…'"
             :aria-label="label" @focus="onFocus" @blur="onBlur" />
      <ul v-if="open" class="absolute z-20 mt-1 w-full max-h-72 overflow-auto bg-white border rounded shadow text-sm">
        <li v-if="loading && !results.length" class="px-2 py-1 opacity-60">Searching…</li>
        <li v-else-if="!results.length" class="px-2 py-1 opacity-60">No matches</li>
        <li v-for="r in results" :key="r.id">
          <button type="button" class="w-full text-left px-2 py-1 hover:bg-blue-50" @mousedown.prevent="choose(r)">
            <span class="block">{{ r.label }}</span>
            <span class="block text-xs opacity-60">{{ r.detail }}</span>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>
