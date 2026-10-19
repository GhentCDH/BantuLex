<script setup lang="ts">
// Bulk edit of the text columns of existing reflexes, 100 rows per page in the bulk grid.
// Rows come from Crouton's list API; a row is saved when the focus leaves it (or with Save
// all): its changed fields are checked with Crouton's form schema of the reflex resource and
// sent as one PATCH. Relations are shown, not edited (use the reflex form for those).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { croutonApiCall, useCrouton } from '@ghentcdh/crouton-vue';
import BulkGrid from './BulkGrid.vue';
import RecordPicker, { type PickedRecord } from './RecordPicker.vue';
import { COLUMNS, type BulkRow } from './columns';

const TEXT = ['term', 'translation', 'meaning', 'part_of_speech', 'term_morph_analysis', 'semantic_field',
  'scientific_name', 'ipa', 'notes_on_ipa', 'blr_index', 'blr_note', 'notes'];
const READONLY = ['id', 'variety_label'];
const PAGE_SIZE = 100; // the API returns at most 100 rows per page
type Status = 'saving' | 'saved' | 'error';

const crouton = useCrouton();
let formDef: any = null;
const defs = ref<{ key: string; label: string; width: number }[]>([]);
const rows = ref<BulkRow[]>([]);
/** Stored values per row (null stays null), to find the edited cells. */
const originals = ref<Record<string, string | null>[]>([]);
const errors = ref(new Map<number, Record<string, string>>());
const status = ref(new Map<number, Status>());

const q = ref('');
const variety = ref<PickedRecord | null>(null);
const batch = ref<PickedRecord | null>(null);
const sort = ref<'id' | 'term'>('id');
const page = ref(1);
const count = ref(0);
const totalPages = ref(0);
const loading = ref(false);
const loadError = ref('');

const value = (i: number, key: string) => rows.value[i]?.[key] ?? '';
const isChanged = (i: number, key: string) => value(i, key) !== (originals.value[i]?.[key] ?? '');
const changed = computed(() => {
  const s = new Set<string>();
  rows.value.forEach((_, i) => TEXT.forEach(k => { if (isChanged(i, k)) s.add(`${i}:${k}`); }));
  return s;
});
const dirtyRows = computed(() => [...new Set([...changed.value].map(c => Number(c.split(':')[0])))]);
// A saved row that is edited again is no longer "saved".
const shownStatus = computed(() => new Map([...status.value].filter(([i, s]) => !(s === 'saved' && dirtyRows.value.includes(i)))));
const errorCount = computed(() => [...status.value.values()].filter(s => s === 'error').length);

function labelsFromUi(el: any, out: Record<string, string> = {}) {
  if (el?.scope) out[el.scope.split('/').pop()] = el.options?.label;
  (el?.elements ?? []).forEach((e: any) => labelsFromUi(e, out));
  return out;
}

async function load() {
  loading.value = true; loadError.value = '';
  const params: Record<string, string | string[]> = { page: String(page.value), pageSize: String(PAGE_SIZE), sort: sort.value, sortDir: 'asc' };
  if (q.value.trim()) params.q = q.value.trim();
  // Exact match on an integer foreign key: Crouton's `equals` is not cast to a number, gt/lt are.
  const filter = ([['variety_id', variety.value], ['bulkimport_id', batch.value]] as const)
    .filter(([, picked]) => picked).flatMap(([fk, picked]) => [`${fk}:${picked!.id - 1}:gt`, `${fk}:${picked!.id + 1}:lt`]);
  if (filter.length) params.filter = filter;
  try {
    const { data } = await croutonApiCall(formDef, 'findAll', {}, { params });
    originals.value = data.data.map((r: any) => Object.fromEntries(TEXT.map(k => [k, r[k] ?? null])));
    rows.value = data.data.map((r: any) => ({ id: String(r.id), variety_label: r.variety_label ?? '', ...Object.fromEntries(TEXT.map(k => [k, r[k] ?? ''])) }));
    count.value = data.request?.count ?? 0;
    totalPages.value = data.request?.totalPages ?? 0;
    errors.value = new Map(); status.value = new Map();
  } catch (e: any) {
    loadError.value = e?.response?.data?.message ?? e.message;
  } finally {
    loading.value = false;
  }
}

function setRowError(i: number, issues: Record<string, string> | null, s?: Status) {
  const next = new Map(errors.value);
  if (issues) next.set(i, issues); else next.delete(i);
  errors.value = next;
  if (s) status.value = new Map(status.value).set(i, s);
}

/** One PATCH with the changed fields of row i; empty cells are stored as NULL. */
async function saveRow(i: number) {
  const keys = TEXT.filter(k => isChanged(i, k));
  if (!keys.length) return;
  const body = Object.fromEntries(keys.map(k => [k, value(i, k) === '' ? null : value(i, k)]));
  const schema = formDef.schemas.form.zodSchema;
  const check = typeof schema?.pick === 'function' ? schema.pick(Object.fromEntries(keys.map(k => [k, true]))).safeParse(body) : { success: true };
  if (!check.success) {
    setRowError(i, Object.fromEntries(check.error.issues.map((x: any) => [String(x.path[0]), x.message])), 'error');
    return;
  }
  const rowsAtStart = rows.value;
  setRowError(i, null, 'saving');
  try {
    const { data } = await croutonApiCall(formDef, 'patch', { id: rowsAtStart[i].id }, body);
    if (rows.value !== rowsAtStart) return; // another page was loaded meanwhile
    keys.forEach(k => { originals.value[i][k] = data?.[k] ?? body[k]; });
    setRowError(i, null, 'saved');
  } catch (e: any) {
    if (rows.value !== rowsAtStart) return;
    const message = e?.response?.data?.message;
    const issues = Array.isArray(message)
      ? Object.fromEntries(message.map((m: any) => [TEXT.includes(m.field) ? m.field : '_', m.message]))
      : { _: typeof message === 'string' ? message : e.message };
    setRowError(i, issues, 'error');
  }
}

// Saves run one after the other, in the order the rows were left.
let queue: Promise<void> = Promise.resolve();
const queued = new Set<number>();
function enqueue(i: number) {
  if (queued.has(i)) return queue;
  queued.add(i);
  queue = queue.then(() => { queued.delete(i); return saveRow(i); });
  return queue;
}
function onRowLeave(_left: number, current: number | null) {
  // Every edited row except the focused one: a paste can change several rows at once.
  dirtyRows.value.filter(i => i !== current).forEach(enqueue);
}
async function saveAll() {
  dirtyRows.value.forEach(enqueue);
  await queue;
}
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveAll(); }
}

/** Save what is edited; with rows that could not be saved, ask before dropping them. */
async function settle() {
  await saveAll();
  return !errorCount.value || confirm(`${errorCount.value} row(s) could not be saved. Discard these changes?`);
}
async function goTo(p: number) {
  if (!(await settle())) return;
  page.value = p;
  await load();
}
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => goTo(1), 300); });
watch([variety, batch, sort], () => goTo(1));

onBeforeRouteLeave(settle);
onBeforeRouteUpdate((to) => (to.params.formId === 'bulk-edit' ? true : settle()));
const beforeUnload = (e: BeforeUnloadEvent) => { if (dirtyRows.value.length) e.preventDefault(); };
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload);
  formDef = await crouton.getFormDefById('reflex');
  const labels = labelsFromUi(formDef.schemas.form.ui);
  defs.value = [
    { key: 'id', label: 'Id', width: 70 },
    { key: 'variety_label', label: 'Variety', width: 170 },
    ...TEXT.map(k => ({ key: k, label: labels[k] ?? k, width: COLUMNS.find(c => c.key === k)?.width ?? 150 })),
  ];
  await load();
});
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));

const field = 'w-full border rounded px-2 py-1 text-sm';
const firstRow = computed(() => (page.value - 1) * PAGE_SIZE + 1);
</script>

<template>
  <section class="max-w-screen-2xl mx-auto p-4 flex flex-col gap-3" aria-label="Bulk edit" @keydown="onKey">
    <header>
      <h2 class="text-xl font-semibold">Bulk edit of reflexes</h2>
      <p class="text-sm opacity-70">Edit the text fields of existing reflexes, 100 rows at a time. A row is saved when you leave it (or with Save all, Ctrl/Cmd+S); edited cells are yellow until saved. Clearing a cell removes the value. Relations are changed in the reflex form.</p>
    </header>
    <div class="grid gap-3 md:grid-cols-4 items-end">
      <label class="text-sm">
        <span class="block font-semibold mb-1">Search</span>
        <input v-model="q" :class="field" type="search" placeholder="Term, translation, …" aria-label="Search reflexes" />
      </label>
      <RecordPicker v-model="variety" resource="variety" label="Variety" placeholder="Search name or Guthrie code…"
                    :fields="['name_english', 'name_french', 'name_bantu', 'name_bastin', 'guthrie_index']" />
      <RecordPicker v-model="batch" resource="bulkimport" label="Bulk import" placeholder="Search import…" />
      <label class="text-sm">
        <span class="block font-semibold mb-1">Sort by</span>
        <select v-model="sort" :class="field" aria-label="Sort by"><option value="id">Id</option><option value="term">Term</option></select>
      </label>
    </div>
    <p v-if="loadError" role="alert" class="text-sm text-red-700">{{ loadError }}</p>
    <div class="flex flex-wrap items-center gap-3 text-sm">
      <button class="btn btn-sm" type="button" :disabled="loading || page <= 1" @click="goTo(page - 1)">Previous</button>
      <span>{{ loading ? 'Loading…' : count ? `Rows ${firstRow.toLocaleString()}–${(firstRow + rows.length - 1).toLocaleString()} of ${count.toLocaleString()}` : 'No reflexes' }}</span>
      <button class="btn btn-sm" type="button" :disabled="loading || page >= totalPages" @click="goTo(page + 1)">Next</button>
      <span class="ml-auto" role="status">
        <span v-if="dirtyRows.length">{{ dirtyRows.length }} unsaved</span>
        <span v-if="errorCount" class="text-red-700"> · {{ errorCount }} not saved (hover the row number)</span>
      </span>
      <button class="btn btn-sm btn-primary" type="button" :disabled="!dirtyRows.length" @click="saveAll">Save all</button>
    </div>
    <BulkGrid v-if="defs.length" v-model:rows="rows" :columns="defs.map(d => d.key)" :defs="defs" :errors="errors"
              :growable="false" :readonly="READONLY" :changed="changed" :row-status="shownStatus" @row-leave="onRowLeave" />
  </section>
</template>
