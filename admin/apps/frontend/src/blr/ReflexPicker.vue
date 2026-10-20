<script setup lang="ts">
// Pick the reflexes that will belong to the new reconstruction. Candidates come
// from the BLR API (unlinked by default) and the selection survives paging and
// filter changes.
import { computed, onMounted, ref, watch } from 'vue';
import axios from 'axios';
import RecordPicker, { type PickedRecord } from '../bulk/RecordPicker.vue';
import type { ReflexRow } from './types';

const model = defineModel<ReflexRow[]>({ required: true });

const q = ref('');
const variety = ref<PickedRecord | null>(null);
const onlyUnlinked = ref(true);
const page = ref(1);
const pageSize = 50;
const rows = ref<ReflexRow[]>([]);
const count = ref(0);
const totalPages = ref(1);
const loading = ref(false);
const error = ref('');
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const selectedIds = computed(() => new Set(model.value.map(r => r.id)));
const selectable = computed(() => rows.value.filter(r => r.blr_entry_id == null));
const allOnPage = computed(() => selectable.value.length > 0 && selectable.value.every(r => selectedIds.value.has(r.id)));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await axios.get('/api/blr/reflexes', {
      params: {
        q: q.value.trim() || undefined,
        variety_id: variety.value?.id,
        page: page.value,
        pageSize,
        unlinked: onlyUnlinked.value ? 1 : 0,
      },
    });
    rows.value = data.data ?? [];
    count.value = data.request?.count ?? 0;
    totalPages.value = data.request?.totalPages ?? 1;
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? e.message;
  } finally {
    loading.value = false;
  }
}

function goTo(p: number) {
  page.value = Math.max(1, Math.min(totalPages.value, p));
  load();
}
function toggle(row: ReflexRow) {
  if (row.blr_entry_id != null) return;
  const next = new Map(model.value.map(r => [r.id, r]));
  next.has(row.id) ? next.delete(row.id) : next.set(row.id, row);
  model.value = [...next.values()];
}
function togglePage() {
  const next = new Map(model.value.map(r => [r.id, r]));
  if (allOnPage.value) selectable.value.forEach(r => next.delete(r.id));
  else selectable.value.forEach(r => next.set(r.id, r));
  model.value = [...next.values()];
}
function clearSelection() { model.value = []; }

watch(q, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { page.value = 1; load(); }, 300);
});
watch([variety, onlyUnlinked], () => { page.value = 1; load(); });
onMounted(load);
</script>

<template>
  <section class="border rounded flex flex-col min-h-0" aria-label="Reflexes">
    <div class="p-3 flex flex-col gap-2 border-b">
      <div class="flex items-center gap-3">
        <h3 class="font-semibold text-sm">Reflexes</h3>
        <span class="text-xs opacity-60">{{ selectedIds.size.toLocaleString() }} selected</span>
        <button v-if="selectedIds.size" type="button" class="btn btn-sm ml-auto" @click="clearSelection">Clear</button>
      </div>
      <div class="grid gap-2 md:grid-cols-3 items-end">
        <label class="text-sm">
          <span class="block font-semibold mb-1">Search</span>
          <input v-model="q" type="search" class="w-full border rounded px-2 py-1 text-sm" aria-label="Search reflexes" placeholder="Term, translation, …" />
        </label>
        <RecordPicker v-model="variety" resource="variety" label="Variety" placeholder="Search name or Guthrie code…"
                      :fields="['name_english', 'name_french', 'name_bantu', 'name_bastin', 'guthrie_index']" />
        <label class="inline-flex items-center gap-2 text-sm pb-1">
          <input v-model="onlyUnlinked" type="checkbox" aria-label="Only unlinked reflexes" />
          Only reflexes without a reconstruction
        </label>
      </div>
      <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>
    </div>

    <div class="overflow-auto min-h-0" style="max-height: 60vh">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-gray-50">
          <tr class="text-left">
            <th class="p-2 w-8"><input type="checkbox" :checked="allOnPage" aria-label="Select all on this page" @change="togglePage" /></th>
            <th class="p-2">Id</th>
            <th class="p-2">Term</th>
            <th class="p-2">Translation</th>
            <th class="p-2">Meaning</th>
            <th class="p-2">Variety</th>
            <th class="p-2">Reconstruction</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id"
              :class="{ 'bg-blue-50': selectedIds.has(row.id), 'opacity-50': row.blr_entry_id != null }">
            <td class="p-2">
              <input type="checkbox" :checked="selectedIds.has(row.id)" :disabled="row.blr_entry_id != null"
                     :aria-label="`Select reflex ${row.id}`" @change="toggle(row)" />
            </td>
            <td class="p-2 tabular-nums">{{ row.id }}</td>
            <td class="p-2">{{ row.term ?? '—' }}</td>
            <td class="p-2">{{ row.translation ?? '—' }}</td>
            <td class="p-2">{{ row.meaning ?? '—' }}</td>
            <td class="p-2">{{ row.variety_label ?? '—' }}</td>
            <td class="p-2">{{ row.blr_index ?? '—' }}</td>
          </tr>
          <tr v-if="!rows.length && !loading">
            <td colspan="7" class="p-3 text-center opacity-60">No reflexes</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap items-center gap-3 p-3 border-t text-sm">
      <button class="btn btn-sm" type="button" :disabled="loading || page <= 1" @click="goTo(page - 1)">Previous</button>
      <span>{{ loading ? 'Loading…' : count ? `Rows ${((page - 1) * pageSize + 1).toLocaleString()}–${((page - 1) * pageSize + rows.length).toLocaleString()} of ${count.toLocaleString()}` : 'No reflexes' }}</span>
      <button class="btn btn-sm" type="button" :disabled="loading || page >= totalPages" @click="goTo(page + 1)">Next</button>
    </div>
  </section>
</template>
