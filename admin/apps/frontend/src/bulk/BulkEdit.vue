<script setup lang="ts">
// Bulk edit of the text columns of existing reflexes, 100 rows per page in the bulk grid.
// Rows come from Crouton's list API; a row is saved when the focus leaves it (or with Save
// all): its changed fields are checked with Crouton's form schema of the reflex resource and
// sent as one PATCH. The variety is edited through its label and must match an
// existing variety; other relations stay in the reflex form.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { croutonApiCall, useCrouton } from '@ghentcdh/crouton-vue';
import BulkGrid from './BulkGrid.vue';
import RecordPicker, { type PickedRecord } from './RecordPicker.vue';
import { COLUMNS, DEFAULT_PAGE_SIZE, PAGE_SIZES, type BulkRow } from './columns';
import { useColumnVisibility } from './useColumnVisibility';

const TEXT = ['term', 'translation', 'meaning', 'part_of_speech', 'term_morph_analysis', 'semantic_field',
  'scientific_name', 'ipa', 'notes_on_ipa', 'blr_index', 'blr_note', 'notes'];
/** Relation columns, edited through their label and resolved to an id on save. */
const RELATIONS = ['variety_label'];
const EDITABLE = [...TEXT, ...RELATIONS];
const READONLY = ['id'];
type Status = 'saving' | 'saved' | 'error';

const crouton = useCrouton();
let formDef: any = null;
const defs = ref<{ key: string; label: string; width: number }[]>([]);
const allKeys = computed(() => defs.value.map(d => d.key));
const { hidden, visibleKeys, toggle: toggleHidden, showAll } = useColumnVisibility(allKeys);
/** Columns the API can sort on: physical reflex fields (calculated labels cannot). */
const SORTABLE = ['id', ...TEXT];
const rows = ref<BulkRow[]>([]);
/** Stored values per row (null stays null), to find the edited cells. */
const originals = ref<Record<string, string | null>[]>([]);
const errors = ref(new Map<number, Record<string, string>>());
const status = ref(new Map<number, Status>());

const q = ref('');
const variety = ref<PickedRecord | null>(null);
const batch = ref<PickedRecord | null>(null);
const sort = ref('id');
const sortDir = ref<'asc' | 'desc'>('asc');
const page = ref(1);
const pageSize = ref<number>(DEFAULT_PAGE_SIZE);
const count = ref(0);
const totalPages = ref(0);
const loading = ref(false);
const loadError = ref('');

// Relation labels offered in the grid's datalists, and the exact-match lookup.
interface VarietyOption { id: number; label: string; option: string }
const varieties = ref<VarietyOption[]>([]);
/** Labels are compared without repeated or edge whitespace. */
const normLabel = (s: string) => s.replace(/\s+/g, ' ').trim();

// Some varieties share a display label ("Tetela (C71)" is two rows). Those get a
// stable "[#id]" suffix in the autocomplete so a picked option is unambiguous.
const varietyByLabel = computed(() => {
  const map = new Map<string, number[]>();
  for (const v of varieties.value) map.set(v.label, [...(map.get(v.label) ?? []), v.id]);
  return map;
});
const varietyByOption = computed(() => new Map(varieties.value.map(v => [v.option, v])));
const datalists = computed(() => ({ variety_label: varieties.value.map(v => v.option) }));

type ResolvedVariety = { id: number; label: string } | { error: string };
function resolveVariety(raw: string): ResolvedVariety {
  const text = normLabel(raw);
  const picked = varietyByOption.value.get(text);
  if (picked) return { id: picked.id, label: picked.label };
  const ids = varietyByLabel.value.get(text) ?? [];
  if (ids.length === 1) return { id: ids[0], label: text };
  if (ids.length > 1) {
    return { error: `“${text}” matches ${ids.length} varieties (${ids.map(id => `#${id}`).join(', ')}). Pick a suggestion from the list.` };
  }
  return { error: `No variety with label “${text}”. Pick an existing one.` };
}

async function loadVarieties() {
  const varietyForm = await crouton.getFormDefById('variety');
  const options: VarietyOption[] = [];
  let pageNo = 1, pages = 1;
  do {
    const { data } = await croutonApiCall(varietyForm, 'findAll', {}, { params: { page: String(pageNo), pageSize: '500' } });
    options.push(...data.data.map((r: any) => ({ id: r.id, label: normLabel(r.display_label ?? ''), option: '' })));
    pages = data.request?.totalPages ?? 1;
    pageNo++;
  } while (pageNo <= pages);
  const counts = new Map<string, number>();
  for (const o of options) if (o.label) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
  varieties.value = options
    .filter(o => o.label)
    .map(o => ({ ...o, option: (counts.get(o.label) ?? 0) > 1 ? `${o.label} [#${o.id}]` : o.label }));
}

const value = (i: number, key: string) => rows.value[i]?.[key] ?? '';
const isChanged = (i: number, key: string) => value(i, key) !== (originals.value[i]?.[key] ?? '');
const changed = computed(() => {
  const s = new Set<string>();
  rows.value.forEach((_, i) => EDITABLE.forEach(k => { if (isChanged(i, k)) s.add(`${i}:${k}`); }));
  return s;
});
const dirtyRows = computed(() => [...new Set([...changed.value].map(c => Number(c.split(':')[0])))]);
// A saved row that is edited again is no longer "saved".
const shownStatus = computed(() => new Map([...status.value].filter(([i, s]) => !(s === 'saved' && dirtyRows.value.includes(i)))));
const errorCount = computed(() => [...status.value.values()].filter(s => s === 'error').length);
/** One-based grid row numbers that could not be saved. */
const failedRows = computed(() => [...status.value].filter(([, s]) => s === 'error').map(([i]) => i + 1));

function labelsFromUi(el: any, out: Record<string, string> = {}) {
  if (el?.scope) out[el.scope.split('/').pop()] = el.options?.label;
  (el?.elements ?? []).forEach((e: any) => labelsFromUi(e, out));
  return out;
}

async function load() {
  loading.value = true; loadError.value = '';
  const params: Record<string, string | string[]> = {
    page: String(page.value), pageSize: String(pageSize.value), sort: sort.value, sortDir: sortDir.value,
  };
  if (q.value.trim()) params.q = q.value.trim();
  // Exact match on an integer foreign key: Crouton's `equals` is not cast to a number, gt/lt are.
  const filter = ([['variety_id', variety.value], ['bulkimport_id', batch.value]] as const)
    .filter(([, picked]) => picked).flatMap(([fk, picked]) => [`${fk}:${picked!.id - 1}:gt`, `${fk}:${picked!.id + 1}:lt`]);
  if (filter.length) params.filter = filter;
  try {
    const { data } = await croutonApiCall(formDef, 'findAll', {}, { params });
    originals.value = data.data.map((r: any) => Object.fromEntries(EDITABLE.map(k => [k, r[k] ?? null])));
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

/**
 * One PATCH with the changed fields of row i. Text cells are stored as NULL when
 * empty; relation labels are resolved to an existing id and never create records.
 */
async function saveRow(i: number) {
  const keys = EDITABLE.filter(k => isChanged(i, k));
  if (!keys.length) return;

  const body: Record<string, unknown> = {};
  const schemaKeys: Record<string, true> = {};
  const issues: Record<string, string> = {};
  const canonicalLabels: Record<string, string> = {};
  for (const key of keys) {
    if (key === 'variety_label') {
      if (!normLabel(value(i, key))) { body.variety_id = null; schemaKeys.variety_id = true; continue; }
      const resolved = resolveVariety(value(i, key));
      if ('error' in resolved) issues.variety_label = resolved.error;
      else {
        body.variety_id = resolved.id;
        schemaKeys.variety_id = true;
        canonicalLabels.variety_label = resolved.label;
      }
    } else {
      body[key] = value(i, key) === '' ? null : value(i, key);
      schemaKeys[key] = true;
    }
  }
  if (Object.keys(issues).length) { setRowError(i, issues, 'error'); return; }

  const schema = formDef.schemas.form.zodSchema;
  const check = typeof schema?.pick === 'function' ? schema.pick(schemaKeys).safeParse(body) : { success: true };
  if (!check.success) {
    setRowError(i, Object.fromEntries(check.error.issues.map((x: any) => [String(x.path[0]), x.message])), 'error');
    return;
  }
  const rowsAtStart = rows.value;
  setRowError(i, null, 'saving');
  try {
    const { data } = await croutonApiCall(formDef, 'patch', { id: rowsAtStart[i].id }, body);
    if (rows.value !== rowsAtStart) return; // another page was loaded meanwhile
    keys.forEach(k => {
      if (k === 'variety_label') {
        const label = data?.variety_label ?? canonicalLabels.variety_label ?? normLabel(value(i, k));
        originals.value[i].variety_label = label;
        rows.value[i].variety_label = label;
      } else {
        originals.value[i][k] = data?.[k] ?? body[k];
      }
    });
    setRowError(i, null, 'saved');
  } catch (e: any) {
    if (rows.value !== rowsAtStart) return;
    const message = e?.response?.data?.message;
    const issues = Array.isArray(message)
      ? Object.fromEntries(message.map((m: any) => [m.field === 'variety_id' || EDITABLE.includes(m.field) ? (m.field === 'variety_id' ? 'variety_label' : m.field) : '_', m.message]))
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

/** Header click: sort on that column, toggling direction when it is already active. */
async function onSort(key: string) {
  if (!SORTABLE.includes(key)) return;
  if (!(await settle())) return;
  if (sort.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else { sort.value = key; sortDir.value = 'asc'; }
  page.value = 1;
  await load();
}

async function changePageSize(event: Event) {
  const select = event.target as HTMLSelectElement;
  const next = Number(select.value);
  if (next === pageSize.value) return;
  if (!(await settle())) { select.value = String(pageSize.value); return; }
  pageSize.value = next;
  page.value = 1;
  await load();
}

/** Hide/show a column; hiding the sorted column falls back to the default id order. */
async function toggleColumn(key: string) {
  const hiding = visibleKeys.value.includes(key);
  if (hiding && sort.value === key && !(await settle())) return;
  toggleHidden(key);
  if (hiding && !visibleKeys.value.includes(key) && sort.value === key) {
    sort.value = 'id';
    sortDir.value = 'asc';
    page.value = 1;
    await load();
  }
}
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => goTo(1), 300); });
watch([variety, batch], () => goTo(1));

onBeforeRouteLeave(settle);
onBeforeRouteUpdate((to) => (to.params.formId === 'bulk-edit' ? true : settle()));
const beforeUnload = (e: BeforeUnloadEvent) => { if (dirtyRows.value.length) e.preventDefault(); };
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('resize', fitGrid);
  chromeObserver = new ResizeObserver(fitGrid);
  if (chrome.value) chromeObserver.observe(chrome.value);
  await nextTick();
  fitGrid();

  formDef = await crouton.getFormDefById('reflex');
  const labels = labelsFromUi(formDef.schemas.form.ui);
  defs.value = [
    { key: 'id', label: 'Id', width: 70 },
    { key: 'variety_label', label: 'Variety', width: 170 },
    ...TEXT.map(k => ({ key: k, label: labels[k] ?? k, width: COLUMNS.find(c => c.key === k)?.width ?? 150 })),
  ];
  await load();
  try {
    await loadVarieties();
  } catch (e: any) {
    loadError.value = `Could not load varieties: ${e?.message ?? e}`;
  }
  fitGrid();
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('resize', fitGrid);
  chromeObserver?.disconnect();
  cancelAnimationFrame(fitFrame);
});

const field = 'w-full border rounded px-2 py-1 text-sm';
const firstRow = computed(() => (page.value - 1) * pageSize.value + 1);

// The grid fills everything below the header and toolbar, down to the bottom of
// the window. Measuring the grid area keeps this correct whatever padding or
// header height Crouton's layout adds.
const chrome = ref<HTMLElement>();
const gridArea = ref<HTMLElement>();
const gridH = ref(480);
let chromeObserver: ResizeObserver | undefined;
let fitFrame = 0;
function fitGrid() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const el = gridArea.value;
    if (!el) return;
    const top = Math.max(0, el.getBoundingClientRect().top);
    gridH.value = Math.max(240, Math.floor(window.innerHeight - top - 16));
  });
}
</script>

<template>
  <section class="w-full px-3 py-2 flex flex-col gap-2" aria-label="Bulk edit" @keydown="onKey">
    <div ref="chrome" class="flex flex-col gap-2">
      <header class="flex flex-wrap items-baseline gap-x-3">
        <h2 class="text-xl font-semibold">Bulk edit of reflexes</h2>
        <p class="text-sm opacity-70" title="Edit the text fields of existing reflexes. A row is saved when you leave it (or with Save all, Ctrl/Cmd+S); edited cells are yellow until saved. Clearing a cell removes the value. Variety is edited by its exact label; other relations are changed in the reflex form.">
          Save on leaving a row, or Ctrl/Cmd+S. Edited cells are yellow until saved.
        </p>
      </header>
      <div class="grid gap-2 md:grid-cols-3 items-end">
        <label class="text-sm">
          <span class="block font-semibold mb-1">Search</span>
          <input v-model="q" :class="field" type="search" placeholder="Term, translation, …" aria-label="Search reflexes" />
        </label>
        <RecordPicker v-model="variety" resource="variety" label="Variety" placeholder="Search name or Guthrie code…"
                      :fields="['name_english', 'name_french', 'name_bantu', 'name_bastin', 'guthrie_index']" />
        <RecordPicker v-model="batch" resource="bulkimport" label="Bulk import" placeholder="Search import…" />
      </div>
      <p v-if="loadError" role="alert" class="text-sm text-red-700">{{ loadError }}</p>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <button class="btn btn-sm" type="button" :disabled="loading || page <= 1" @click="goTo(page - 1)">Previous</button>
        <span>{{ loading ? 'Loading…' : count ? `Rows ${firstRow.toLocaleString()}–${(firstRow + rows.length - 1).toLocaleString()} of ${count.toLocaleString()}` : 'No reflexes' }}</span>
        <button class="btn btn-sm" type="button" :disabled="loading || page >= totalPages" @click="goTo(page + 1)">Next</button>
        <label class="flex items-center gap-1">
          Rows
          <select :value="pageSize" class="border rounded px-1 py-0.5" aria-label="Rows per page" @change="changePageSize">
            <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <details class="relative">
          <summary class="btn btn-sm cursor-pointer list-none">Columns</summary>
          <div class="absolute left-0 z-30 mt-1 max-h-80 w-64 overflow-auto rounded border bg-white p-2 shadow-lg">
            <label v-for="d in defs" :key="d.key" class="flex items-center gap-2 py-0.5">
              <input type="checkbox" :checked="!hidden.has(d.key)" @change="toggleColumn(d.key)" />
              <span>{{ d.label }}</span>
            </label>
            <div class="mt-1 border-t pt-1"><button class="btn btn-sm" type="button" @click="showAll">Show all</button></div>
          </div>
        </details>
        <span class="ml-auto" role="status">
          <span v-if="dirtyRows.length">{{ dirtyRows.length }} unsaved</span>
          <span v-if="errorCount" class="text-red-700">
            · {{ errorCount }} not saved{{ failedRows.length ? ` (row ${failedRows.slice(0, 5).join(', ')}${failedRows.length > 5 ? '…' : ''})` : '' }}
          </span>
        </span>
        <button class="btn btn-sm btn-primary" type="button" :disabled="!dirtyRows.length" @click="saveAll">Save all</button>
      </div>
    </div>
    <div ref="gridArea" class="min-h-0" :style="{ height: gridH + 'px' }">
      <BulkGrid v-if="defs.length" v-model:rows="rows" :columns="visibleKeys" :defs="defs" :errors="errors" fill
                :show-row-numbers="false" fill-handle resizable widths-key="bantulex-bulk-edit-widths" :datalists="datalists"
                :sort="sort" :sort-dir="sortDir" :sortable="SORTABLE"
                :growable="false" :readonly="READONLY" :changed="changed" :row-status="shownStatus"
                @sort-change="onSort" @row-leave="onRowLeave" />
    </div>
  </section>
</template>
