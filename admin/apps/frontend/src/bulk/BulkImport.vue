<script setup lang="ts">
// Bulk import of reflexes: set the shared links once, paste rows from a
// spreadsheet, validate (dry run) and save everything in one transaction.
// Every save is a batch that can be undone as a whole.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import axios from 'axios';
import { ModalService, NotificationService } from '@ghentcdh/ui';
import BulkGrid from './BulkGrid.vue';
import RecordPicker, { type PickedRecord } from './RecordPicker.vue';
import { DEFAULT_COLUMNS, emptyRow, isEmptyRow, type BulkRow } from './columns';

const DRAFT_KEY = 'bantulex-bulk-draft';
interface Draft {
  label: string; note: string; role: 'primary' | 'cited';
  sourceMode: 'pick' | 'new'; source: PickedRecord | null; newSource: { author_year: string; title: string; year_uncertain: boolean };
  varietyMode: 'pick' | 'new' | 'none'; variety: PickedRecord | null; newVariety: { name_english: string; name_french: string; guthrie_index: string; branch: string };
  location: PickedRecord | null; fieldwork: PickedRecord | null;
  columns: string[]; rows: BulkRow[];
}
const blank = (): Draft => ({
  label: '', note: '', role: 'primary',
  sourceMode: 'pick', source: null, newSource: { author_year: '', title: '', year_uncertain: false },
  varietyMode: 'pick', variety: null, newVariety: { name_english: '', name_french: '', guthrie_index: '', branch: '' },
  location: null, fieldwork: null,
  columns: [...DEFAULT_COLUMNS], rows: Array.from({ length: 20 }, emptyRow),
});

function loadDraft(): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    if (saved?.rows?.length) return { ...blank(), ...saved };
  } catch { /* no or broken draft */ }
  return blank();
}
const draft = reactive<Draft>(loadDraft());
// The draft survives a reload: paste 5000 rows once, finish the links later.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
watch(draft, () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota */ } }, 800);
}, { deep: true });

// Grid rows that are sent (non-empty), with their grid index for error markers.
const filled = computed(() => draft.rows.map((row, index) => ({ row, index })).filter(({ row }) => !isEmptyRow(row)));
const errors = ref(new Map<number, Record<string, string>>());
const linkErrors = ref<string[]>([]);
const summary = ref<any>(null);
const busy = ref<'' | 'validate' | 'save'>('');
const imports = ref<any[]>([]);

const BLR_OK = /^\s*\d+\s*$|^\s*\d+\s+ipv\b/i;
const localErrors = computed(() => {
  const map = new Map<number, Record<string, string>>();
  for (const { row, index } of filled.value) {
    const e: Record<string, string> = {};
    if (!row.term?.trim()) e.term = 'Term is empty';
    if (row.blr_index?.trim() && !BLR_OK.test(row.blr_index)) e.blr_index = 'Not a BLR number: kept as a note, not linked';
    if (Object.keys(e).length) map.set(index, e);
  }
  return map;
});
const shownErrors = computed(() => {
  const merged = new Map(localErrors.value);
  for (const [i, e] of errors.value) merged.set(i, { ...merged.get(i), ...e });
  return merged;
});
const blocking = computed(() => [...shownErrors.value.values()].filter(e => e.term).length);

function body() {
  return {
    label: draft.label, note: draft.note || null, role: draft.role,
    source: draft.sourceMode === 'pick' ? { id: draft.source?.id } : { create: { ...draft.newSource, title: draft.newSource.title || null } },
    variety: draft.varietyMode === 'none' ? null : draft.varietyMode === 'pick' ? (draft.variety ? { id: draft.variety.id } : null)
      : { create: Object.fromEntries(Object.entries(draft.newVariety).map(([k, v]) => [k, v || null])) },
    location_id: draft.location?.id ?? null,
    fieldwork_id: draft.fieldwork?.id ?? null,
    rows: filled.value.map(({ row }) => Object.fromEntries(draft.columns.map(k => [k, row[k] ?? '']))),
  };
}

function showServerErrors(list: { row: number | null; field: string; message: string }[]) {
  const map = new Map<number, Record<string, string>>();
  linkErrors.value = [];
  for (const e of list ?? []) {
    if (e.row == null) { linkErrors.value.push(`${e.field}: ${e.message}`); continue; }
    const index = filled.value[e.row - 1]?.index;
    if (index == null) continue;
    map.set(index, { ...map.get(index), [e.field]: e.message });
  }
  errors.value = map;
}

async function send(dryRun: boolean) {
  busy.value = dryRun ? 'validate' : 'save';
  errors.value = new Map(); linkErrors.value = [];
  try {
    const { data } = await axios.post(`/api/bulk/reflex${dryRun ? '?dryRun=1' : ''}`, body());
    summary.value = data;
    if (!dryRun) {
      NotificationService.success(`Saved ${data.rows.toLocaleString()} reflexes as bulk import #${data.bulkimport_id}.`);
      Object.assign(draft, { ...blank(), columns: draft.columns });
      localStorage.removeItem(DRAFT_KEY);
      await loadImports();
    }
  } catch (e: any) {
    const res = e.response?.data;
    summary.value = null;
    showServerErrors(res?.errors ?? []);
    NotificationService.error(res?.message ?? e.message ?? 'The import failed; nothing was saved.');
  } finally {
    busy.value = '';
  }
}

function save() {
  ModalService.showConfirm({
    title: 'Save bulk import',
    message: `Save ${filled.value.length.toLocaleString()} reflexes in one transaction as “${draft.label}”? You can undo the whole import later.`,
    confirmLabel: 'Save',
    onClose: ({ confirmed }) => { if (confirmed) void send(false); },
  });
}

async function loadImports() {
  try { imports.value = (await axios.get('/api/bulk/imports')).data; } catch { imports.value = []; }
}
function undo(batch: any) {
  ModalService.showConfirm({
    title: `Undo bulk import #${batch.id}`,
    message: `Delete the ${batch.reflexes_now.toLocaleString()} reflexes of “${batch.label}” and their source links? Records the import created (source, variety) are removed if nothing else uses them.`,
    confirmLabel: 'Undo import',
    onClose: async ({ confirmed }) => {
      if (!confirmed) return;
      try {
        const { data } = await axios.post(`/api/bulk/imports/${batch.id}/undo`);
        NotificationService.success(`Undone: ${data.reflexes.toLocaleString()} reflexes removed${data.source_removed ? ', source removed' : ''}${data.variety_removed ? ', variety removed' : ''}.`);
      } catch (e: any) {
        NotificationService.error(e.response?.data?.message ?? 'Undo failed; nothing was changed.');
      }
      await loadImports();
    },
  });
}
function clearAll() {
  ModalService.showConfirm({
    title: 'Clear the grid',
    message: 'Remove all rows and links from this draft?',
    confirmLabel: 'Clear',
    onClose: ({ confirmed }) => {
      if (!confirmed) return;
      Object.assign(draft, blank()); errors.value = new Map(); summary.value = null; linkErrors.value = [];
      localStorage.removeItem(DRAFT_KEY);
    },
  });
}

const ready = computed(() => draft.label.trim() && filled.value.length && !blocking.value
  && (draft.sourceMode === 'pick' ? !!draft.source : !!draft.newSource.author_year.trim())
  && (draft.varietyMode !== 'new' || !!draft.newVariety.name_english.trim()));
onMounted(loadImports);
</script>

<template>
  <section class="max-w-screen-2xl mx-auto p-4 flex flex-col gap-4" aria-label="Bulk import">
    <header>
      <h2 class="text-xl font-semibold">Bulk import of reflexes</h2>
      <p class="text-sm opacity-70">Set the links that all rows share, paste the words from a spreadsheet, validate, then save. The whole import is one transaction and can be undone as a batch.</p>
    </header>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4 border rounded p-4">
      <div class="flex flex-col gap-2">
        <label class="text-sm font-semibold" for="bulk-label">Import label *</label>
        <input id="bulk-label" v-model="draft.label" class="w-full border rounded px-2 py-1 text-sm" placeholder="e.g. Delorme 1877, full dictionary" />
        <label class="text-sm font-semibold" for="bulk-note">Note</label>
        <textarea id="bulk-note" v-model="draft.note" class="w-full border rounded px-2 py-1 text-sm" rows="2" />
      </div>
      <div class="flex flex-col gap-2">
        <div class="join text-sm">
          <label class="mr-3"><input v-model="draft.sourceMode" type="radio" value="pick" /> Existing source</label>
          <label><input v-model="draft.sourceMode" type="radio" value="new" /> New source</label>
        </div>
        <RecordPicker v-if="draft.sourceMode === 'pick'" v-model="draft.source" resource="source" label="Source *" placeholder="Search author or title…" />
        <template v-else>
          <input v-model="draft.newSource.author_year" class="w-full border rounded px-2 py-1 text-sm" placeholder="Author year *" aria-label="New source author year" />
          <input v-model="draft.newSource.title" class="w-full border rounded px-2 py-1 text-sm" placeholder="Title" aria-label="New source title" />
          <label class="text-sm"><input v-model="draft.newSource.year_uncertain" type="checkbox" /> Year uncertain</label>
        </template>
        <label class="text-sm font-semibold" for="bulk-role">Source role</label>
        <select id="bulk-role" v-model="draft.role" class="w-full border rounded px-2 py-1 text-sm">
          <option value="primary">primary</option>
          <option value="cited">cited</option>
        </select>
      </div>
      <div class="flex flex-col gap-2">
        <div class="join text-sm">
          <label class="mr-3"><input v-model="draft.varietyMode" type="radio" value="pick" /> Existing variety</label>
          <label class="mr-3"><input v-model="draft.varietyMode" type="radio" value="new" /> New variety</label>
          <label><input v-model="draft.varietyMode" type="radio" value="none" /> None</label>
        </div>
        <RecordPicker v-if="draft.varietyMode === 'pick'" v-model="draft.variety" resource="variety" label="Variety" placeholder="Search name or Guthrie code…" />
        <template v-else-if="draft.varietyMode === 'new'">
          <input v-model="draft.newVariety.name_english" class="w-full border rounded px-2 py-1 text-sm" placeholder="Name (English) *" aria-label="New variety name" />
          <input v-model="draft.newVariety.name_french" class="w-full border rounded px-2 py-1 text-sm" placeholder="Name (French)" aria-label="New variety French name" />
          <input v-model="draft.newVariety.guthrie_index" class="w-full border rounded px-2 py-1 text-sm" placeholder="Guthrie index" aria-label="New variety Guthrie index" />
          <input v-model="draft.newVariety.branch" class="w-full border rounded px-2 py-1 text-sm" placeholder="Branch" aria-label="New variety branch" />
        </template>
      </div>
      <div class="flex flex-col gap-2">
        <RecordPicker v-model="draft.location" resource="location" label="Location" placeholder="Search place, region, country…" />
        <RecordPicker v-model="draft.fieldwork" resource="fieldwork" label="Fieldwork" placeholder="Search project, year, archive…" />
      </div>
    </div>

    <div v-if="linkErrors.length" class="alert alert-error text-sm" role="alert">
      <ul><li v-for="e in linkErrors" :key="e">{{ e }}</li></ul>
    </div>

    <BulkGrid v-model:rows="draft.rows" v-model:columns="draft.columns" :errors="shownErrors" />

    <div class="flex flex-wrap items-center gap-2">
      <button class="btn btn-sm" type="button" :disabled="!!busy || !filled.length" @click="send(true)">
        {{ busy === 'validate' ? 'Validating…' : 'Validate' }}
      </button>
      <button class="btn btn-sm btn-primary" type="button" :disabled="!!busy || !ready" @click="save">
        {{ busy === 'save' ? 'Saving…' : `Save ${filled.length.toLocaleString()} reflexes` }}
      </button>
      <button class="btn btn-sm" type="button" :disabled="!!busy" @click="clearAll">Clear draft</button>
      <span v-if="blocking" class="text-sm text-red-700">{{ blocking }} row(s) without a term</span>
      <span v-else-if="!ready && filled.length" class="text-sm opacity-70">Fill in the label and the source to save.</span>
    </div>

    <div v-if="summary" class="border rounded p-3 text-sm" role="status">
      <strong>{{ summary.dryRun ? 'Validation passed — nothing saved yet.' : `Saved as bulk import #${summary.bulkimport_id}.` }}</strong>
      {{ summary.rows.toLocaleString() }} reflexes;
      {{ summary.blr_linked.toLocaleString() }} linked to a BLR reconstruction;
      {{ summary.blr_text.toLocaleString() }} BLR texts kept as notes<span v-if="summary.blr_unknown.length">;
        unknown BLR indexes (not linked): {{ summary.blr_unknown.slice(0, 20).join(', ') }}{{ summary.blr_unknown.length > 20 ? '…' : '' }}</span>.
      <span v-if="summary.source.created">A new source is created.</span>
      <span v-if="summary.variety.created">A new variety is created.</span>
    </div>

    <div>
      <h3 class="text-lg font-semibold mb-2">Previous imports</h3>
      <p v-if="!imports.length" class="text-sm opacity-70">No bulk imports yet.</p>
      <table v-else class="table text-sm">
        <thead><tr><th>#</th><th>Date</th><th>Label</th><th>Source</th><th>Variety</th><th>Rows</th><th>Now</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="b in imports" :key="b.id">
            <td>{{ b.id }}</td><td>{{ b.created_at }}</td><td>{{ b.label }}</td><td>{{ b.source ?? '—' }}</td><td>{{ b.variety ?? '—' }}</td>
            <td>{{ b.rows.toLocaleString() }}</td><td>{{ b.reflexes_now.toLocaleString() }}</td>
            <td><span class="badge">{{ b.status }}</span><span v-if="b.undone_at" class="opacity-60"> {{ b.undone_at }}</span></td>
            <td><button v-if="b.status === 'saved'" class="btn btn-sm btn-error" type="button" @click="undo(b)">Undo</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
