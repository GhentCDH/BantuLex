<script setup lang="ts">
// Bulk import of reflexes as a four-step wizard:
//   1. download the xlsx template, 2. set the shared links (label, source,
//   variety, location, fieldwork), 3. upload the filled-in file and check it,
//   4. process: everything is saved in one transaction.
// Every import is a batch that can be undone (list below the wizard).
import { computed, onMounted, reactive, ref, watch } from 'vue';
import axios from 'axios';
import { ModalService, NotificationService } from '@ghentcdh/crouton-vue';
import BulkGrid from './BulkGrid.vue';
import RecordPicker, { type PickedRecord } from './RecordPicker.vue';
import WizardStep, { type StepStatus } from './WizardStep.vue';
import { COLUMNS, DEFAULT_COLUMNS, MAX_ROWS, isEmptyRow, type BulkRow } from './columns';
import { TEMPLATE_NAME, downloadTemplate, readWorkbook } from './xlsx';

const DRAFT_KEY = 'bantulex-bulk-draft';
const pad = (n: number) => String(n).padStart(2, '0');
/** Name of an import: the local date and time it is processed, e.g. "2027 10 12 - 13h 14". */
function importName(d = new Date()) {
  return `${d.getFullYear()} ${pad(d.getMonth() + 1)} ${pad(d.getDate())} - ${pad(d.getHours())}h ${pad(d.getMinutes())}`;
}
interface Draft {
  step: number; templateDone: boolean;
  role: 'primary' | 'cited';
  sourceMode: 'pick' | 'new'; source: PickedRecord | null; newSource: { author_year: string; title: string; year_uncertain: boolean };
  varietyMode: 'pick' | 'new' | 'none'; variety: PickedRecord | null; newVariety: { name_english: string; name_french: string; guthrie_index: string; branch: string };
  location: PickedRecord | null; fieldwork: PickedRecord | null;
  file: string | null; warnings: string[]; columns: string[];
  /** Uploaded rows; `_row` holds the Excel row number. */
  rows: BulkRow[];
}
const blank = (): Draft => ({
  step: 1, templateDone: false,
  role: 'primary',
  sourceMode: 'pick', source: null, newSource: { author_year: '', title: '', year_uncertain: false },
  varietyMode: 'pick', variety: null, newVariety: { name_english: '', name_french: '', guthrie_index: '', branch: '' },
  location: null, fieldwork: null,
  file: null, warnings: [], columns: [...DEFAULT_COLUMNS], rows: [],
});
function loadDraft(): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    if (saved && typeof saved === 'object' && Array.isArray(saved.rows)) return { ...blank(), ...saved };
  } catch { /* no or broken draft */ }
  return blank();
}
const draft = reactive<Draft>(loadDraft());
let saveTimer: ReturnType<typeof setTimeout> | undefined;
watch(draft, () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota */ } }, 800);
}, { deep: true });

// ── Step 2: links ───────────────────────────────────────────────────────────
const sourceOk = computed(() => (draft.sourceMode === 'pick' ? !!draft.source : !!draft.newSource.author_year.trim()));
const varietyOk = computed(() => draft.varietyMode !== 'new' || !!draft.newVariety.name_english.trim());
const linksOk = computed(() => sourceOk.value && varietyOk.value);
const linksTouched = computed(() => !!(draft.source || draft.newSource.author_year || draft.variety || draft.location || draft.fieldwork));
const sourceName = computed(() => (draft.sourceMode === 'pick' ? draft.source?.label : draft.newSource.author_year && `${draft.newSource.author_year} (new)`));
const varietyName = computed(() => draft.varietyMode === 'none' ? 'no variety'
  : draft.varietyMode === 'pick' ? draft.variety?.label : draft.newVariety.name_english && `${draft.newVariety.name_english} (new)`);
const linksSummary = computed(() => [sourceName.value, varietyName.value, draft.location?.label, draft.fieldwork?.label].filter(Boolean).join(' · '));

// ── Step 3: upload and check ────────────────────────────────────────────────
const filled = computed(() => draft.rows.map((row, index) => ({ row, index })).filter(({ row }) => !isEmptyRow(row)));
const excelRow = (index: number) => Number(draft.rows[index]?._row) || index + 2;
const uploadError = ref('');
const reading = ref(false);
const dragging = ref(false);
const check = ref<any>(null);
const serverErrors = ref(new Map<number, Record<string, string>>());
const linkErrors = ref<string[]>([]);
const busy = ref<'' | 'check' | 'process'>('');

async function onFile(file: File | undefined) {
  if (!file) return;
  uploadError.value = '';
  reading.value = true;
  try {
    const parsed = await readWorkbook(file);
    if (parsed.rows.length > MAX_ROWS)
      throw new Error(`${file.name} has ${parsed.rows.length.toLocaleString()} rows; at most ${MAX_ROWS.toLocaleString()} can be imported at once. Split the file and import the parts one after another.`);
    draft.rows = parsed.rows.map((row, i) => ({ ...row, _row: String(parsed.excelRows[i]) }));
    draft.columns = parsed.columns;
    draft.warnings = parsed.warnings;
    draft.file = file.name;
    check.value = null; serverErrors.value = new Map(); linkErrors.value = [];
  } catch (e: any) {
    uploadError.value = e.message ?? String(e);
  } finally {
    reading.value = false;
  }
}

const BLR_OK = /^\s*\d+\s*$|^\s*\d+\s+ipv\b/i;
const blrNumber = (v: string) => /^\s*(\d+)/.exec(v ?? '')?.[1];
/** Per grid row: blocking errors (term) and warnings (BLR) by field. */
const rowIssues = computed(() => {
  const map = new Map<number, Record<string, string>>();
  const unknown = new Set((check.value?.blr_unknown ?? []).map(String));
  for (const { row, index } of filled.value) {
    const e: Record<string, string> = {};
    if (!row.term?.trim()) e.term = 'Term is empty';
    const blr = row.blr_index?.trim();
    if (blr && !BLR_OK.test(blr)) e.blr_index = 'Not a BLR number: kept as reconstruction note, not linked';
    else if (blr && unknown.has(blrNumber(blr)!)) e.blr_index = `No reconstruction with BLR index ${blrNumber(blr)}: kept as reconstruction note, not linked`;
    if (Object.keys(e).length) map.set(index, e);
  }
  for (const [i, e] of serverErrors.value) map.set(i, { ...map.get(i), ...e });
  return map;
});
const termErrors = computed(() => [...rowIssues.value.entries()].filter(([, e]) => e.term).map(([i]) => i));
const blrWarnings = computed(() => [...rowIssues.value.entries()].filter(([, e]) => e.blr_index && !e.term).map(([i]) => i));
const uploadOk = computed(() => !!draft.file && filled.value.length > 0 && !termErrors.value.length);
const uploadSummary = computed(() => draft.file ? `${draft.file} · ${filled.value.length.toLocaleString()} rows${termErrors.value.length ? ` · ${termErrors.value.length} without a term` : ''}` : '');
// Any change to the data or links invalidates the last database check and its errors.
watch(() => [draft.rows, draft.columns, draft.sourceMode, draft.source, draft.newSource, draft.varietyMode, draft.variety, draft.newVariety, draft.location, draft.fieldwork], () => {
  check.value = null; serverErrors.value = new Map(); linkErrors.value = [];
}, { deep: true });

function body() {
  return {
    label: importName(), note: null, role: draft.role,
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
    if (index != null) map.set(index, { ...map.get(index), [e.field]: e.message });
  }
  serverErrors.value = map;
}

async function send(dryRun: boolean) {
  busy.value = dryRun ? 'check' : 'process';
  serverErrors.value = new Map(); linkErrors.value = [];
  try {
    const { data } = await axios.post(`/api/bulk/reflex${dryRun ? '?dryRun=1' : ''}`, body());
    if (dryRun) { check.value = data; return; }
    await loadImports();
    NotificationService.success(`Imported ${data.rows.toLocaleString()} reflexes as bulk import #${data.bulkimport_id}.`);
    result.value = data;
    Object.assign(draft, blank());
    localStorage.removeItem(DRAFT_KEY);
  } catch (e: any) {
    const res = e.response?.data;
    showServerErrors(res?.errors ?? []);
    NotificationService.error(res?.message ?? e.message ?? 'The import failed; nothing was saved.');
    if (linkErrors.value.length) draft.step = 2;
  } finally {
    busy.value = '';
  }
}

// ── Step 4: process ─────────────────────────────────────────────────────────
const result = ref<any>(null);
const ready = computed(() => linksOk.value && uploadOk.value && !!check.value);
function processImport() {
  ModalService.showConfirm({
    title: 'Process bulk import',
    message: `Add ${filled.value.length.toLocaleString()} reflexes from ${draft.file}, linked to ${sourceName.value}? Everything is saved in one transaction and can be undone later.`,
    confirmLabel: 'Process import',
    onClose: ({ confirmed }) => { if (confirmed) void send(false); },
  });
}

// ── Wizard ──────────────────────────────────────────────────────────────────
// A step is complete when its own work is done; the next step opens only then.
// Step 3 needs a passed database check (any later change to rows or links undoes it).
const complete = computed<Record<number, boolean>>(() => ({
  1: draft.templateDone || !!draft.file,
  2: linksOk.value,
  3: uploadOk.value && !!check.value,
  4: !!result.value,
}));
/** Steps before n are all complete. */
const reachable = (n: number) => [1, 2, 3].filter(k => k < n).every(k => complete.value[k]);
const statuses = computed<Record<number, StepStatus>>(() => ({
  1: complete.value[1] ? 'done' : 'todo',
  2: linksOk.value ? 'done' : linksTouched.value ? 'attention' : 'todo',
  3: complete.value[3] ? 'done' : draft.file || uploadError.value ? 'attention' : 'todo',
  4: result.value ? 'done' : ready.value ? 'todo' : 'todo',
}));
const toggle = (n: number) => { if (reachable(n)) draft.step = draft.step === n ? 0 : n; };
const go = (n: number) => { if (reachable(n)) draft.step = n; };
// If a change makes the open step unreachable (e.g. new links undo the check), go back to the first open step.
watch(() => [1, 2, 3, 4].map(reachable), () => {
  if (draft.step && !reachable(draft.step)) draft.step = [1, 2, 3, 4].find(n => !complete.value[n]) ?? 1;
}, { immediate: true });

async function template() {
  try {
    await downloadTemplate();
    draft.templateDone = true;
  } catch (e: any) {
    NotificationService.error(`Could not create the template: ${e.message ?? e}`);
  }
}

// ── Previous imports ────────────────────────────────────────────────────────
const imports = ref<any[]>([]);
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
function startOver() {
  ModalService.showConfirm({
    title: 'Start over',
    message: 'Clear the uploaded rows and all choices of this import?',
    confirmLabel: 'Start over',
    onClose: ({ confirmed }) => {
      if (!confirmed) return;
      Object.assign(draft, blank()); check.value = null; serverErrors.value = new Map(); linkErrors.value = []; uploadError.value = ''; result.value = null;
      localStorage.removeItem(DRAFT_KEY);
    },
  });
}
onMounted(loadImports);
const field = 'w-full border rounded px-2 py-1 text-sm';
</script>

<template>
  <section class="max-w-screen-2xl mx-auto p-4 flex flex-col gap-3" aria-label="Reflexes import">
    <header class="flex items-start gap-4">
      <div>
        <h2 class="text-xl font-semibold">Reflexes import</h2>
        <p class="text-sm opacity-70">Import many words from one source at once, e.g. a digitised dictionary. Follow the four steps; the import is saved in one transaction and can be undone as a batch.</p>
      </div>
      <button class="btn btn-sm ml-auto" type="button" @click="startOver">Start over</button>
    </header>

    <div v-if="result" class="alert text-sm" role="status">
      Imported {{ result.rows.toLocaleString() }} reflexes as bulk import #{{ result.bulkimport_id }}
      ({{ result.blr_linked.toLocaleString() }} linked to a BLR reconstruction). It is listed under “Previous imports” below, where it can be undone.
    </div>

    <!-- 1. Template -->
    <WizardStep :n="1" title="Download the template" :status="statuses[1]" :summary="draft.templateDone ? TEMPLATE_NAME : ''" :open="draft.step === 1" @toggle="toggle(1)">
      <p class="text-sm mb-3">Download the Excel template and fill in one word per row on the “Reflexes” sheet. Only <strong>Term</strong> is required. Hover over a column header in Excel for its explanation; the “Instructions” sheet has an example. One import can hold up to {{ MAX_ROWS.toLocaleString() }} rows.</p>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-sm btn-primary" type="button" @click="template">Download template (.xlsx)</button>
        <button v-if="!complete[1]" class="btn btn-sm" type="button" @click="draft.templateDone = true">I already have a filled-in template</button>
      </div>
      <table class="table text-sm mt-3">
        <thead><tr><th>Column</th><th>Required</th><th>Description</th><th>Example</th></tr></thead>
        <tbody>
          <tr v-for="c in COLUMNS" :key="c.key"><td class="font-semibold">{{ c.label }}</td><td>{{ c.required ? 'yes' : 'no' }}</td><td>{{ c.help }}</td><td class="opacity-70">{{ c.example }}</td></tr>
        </tbody>
      </table>
      <div class="flex justify-end items-center gap-3 mt-3">
        <span v-if="!complete[1]" class="text-sm opacity-70">Download the template first.</span>
        <button class="btn btn-sm" type="button" :disabled="!complete[1]" @click="go(2)">Next: links ›</button>
      </div>
    </WizardStep>

    <!-- 2. Links -->
    <WizardStep :n="2" title="Link or create the related records" :status="statuses[2]" :summary="linksSummary" :open="draft.step === 2" :locked="!reachable(2)" @toggle="toggle(2)">
      <p class="text-sm mb-3">These links are the same for every row of the import.</p>
      <div v-if="linkErrors.length" class="alert alert-error text-sm mb-3" role="alert"><ul><li v-for="e in linkErrors" :key="e">{{ e }}</li></ul></div>
      <div class="grid gap-4 lg:grid-cols-3">
        <fieldset class="border rounded p-3 flex flex-col gap-2">
          <legend class="px-1 font-semibold">a. Source *</legend>
          <p class="text-xs opacity-70">The publication the words come from. Every reflex gets a link to it.</p>
          <div class="text-sm flex gap-4">
            <label><input v-model="draft.sourceMode" type="radio" value="pick" /> Existing source</label>
            <label><input v-model="draft.sourceMode" type="radio" value="new" /> New source</label>
          </div>
          <RecordPicker v-if="draft.sourceMode === 'pick'" v-model="draft.source" resource="source" label="Source" placeholder="Search author, year or title…"
                        :fields="['author_year', 'title']" :detail="(r: any) => r.title" />
          <template v-else>
            <input v-model="draft.newSource.author_year" :class="field" placeholder="Author year *, e.g. Delorme 1877" aria-label="New source author year" />
            <input v-model="draft.newSource.title" :class="field" placeholder="Title" aria-label="New source title" />
            <label class="text-sm"><input v-model="draft.newSource.year_uncertain" type="checkbox" /> Year uncertain</label>
          </template>
          <label class="text-sm font-semibold" for="bulk-role">Role of the source</label>
          <select id="bulk-role" v-model="draft.role" :class="field">
            <option value="primary">primary — the words are taken from this source</option>
            <option value="cited">cited — the source is cited for the words</option>
          </select>
        </fieldset>
        <fieldset class="border rounded p-3 flex flex-col gap-2">
          <legend class="px-1 font-semibold">b. Variety</legend>
          <p class="text-xs opacity-70">The language variety of all words in the file.</p>
          <div class="text-sm flex gap-4">
            <label><input v-model="draft.varietyMode" type="radio" value="pick" /> Existing</label>
            <label><input v-model="draft.varietyMode" type="radio" value="new" /> New</label>
            <label><input v-model="draft.varietyMode" type="radio" value="none" /> None</label>
          </div>
          <RecordPicker v-if="draft.varietyMode === 'pick'" v-model="draft.variety" resource="variety" label="Variety" placeholder="Search name or Guthrie code…"
                        :fields="['name_english', 'name_french', 'name_bantu', 'name_bastin', 'guthrie_index']"
                        :detail="(r: any) => [r.branch, r.guthrie_plus].filter(Boolean).join(' · ')" />
          <div v-else-if="draft.varietyMode === 'new'" class="grid gap-2 sm:grid-cols-2">
            <input v-model="draft.newVariety.name_english" :class="field" placeholder="Name (English) *" aria-label="New variety name" />
            <input v-model="draft.newVariety.name_french" :class="field" placeholder="Name (French)" aria-label="New variety French name" />
            <input v-model="draft.newVariety.guthrie_index" :class="field" placeholder="Guthrie index, e.g. H16" aria-label="New variety Guthrie index" />
            <input v-model="draft.newVariety.branch" :class="field" placeholder="Branch" aria-label="New variety branch" />
          </div>
        </fieldset>
        <fieldset class="border rounded p-3 flex flex-col gap-2">
          <legend class="px-1 font-semibold">c. Location and fieldwork</legend>
          <p class="text-xs opacity-70">Optional: where and during which fieldwork the words were recorded.</p>
          <RecordPicker v-model="draft.location" resource="location" label="Location" placeholder="Search place, region, country…"
                        :fields="['place.name', 'region.name', 'country.name']" />
          <RecordPicker v-model="draft.fieldwork" resource="fieldwork" label="Fieldwork" placeholder="Search project, year, archive…"
                        :fields="['project.name', 'collectionyear.value', 'archive']"
                        :detail="(r: any) => [r.archive, r.data_entered_by].filter(Boolean).join(' · ')" />
        </fieldset>
      </div>
      <div class="flex justify-between mt-3">
        <button class="btn btn-sm" type="button" @click="go(1)">‹ Back</button>
        <span v-if="!linksOk" class="text-sm text-amber-700 self-center">Choose or create the source{{ varietyOk ? '' : ', and give the new variety a name' }}.</span>
        <button class="btn btn-sm" type="button" :disabled="!complete[2]" @click="go(3)">Next: upload ›</button>
      </div>
    </WizardStep>

    <!-- 3. Upload and check -->
    <WizardStep :n="3" title="Upload and check the file" :status="statuses[3]" :summary="uploadSummary" :open="draft.step === 3" :locked="!reachable(3)" @toggle="toggle(3)">
      <label class="flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded p-6 cursor-pointer text-sm"
             :class="dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'"
             @dragover.prevent="dragging = true" @dragleave="dragging = false"
             @drop.prevent="dragging = false; onFile($event.dataTransfer?.files?.[0])">
        <span class="font-semibold">{{ draft.file ? 'Replace the file' : 'Choose the filled-in template' }}</span>
        <span class="opacity-70">Drop an .xlsx file here or click to choose one</span>
        <input type="file" class="sr-only" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
               aria-label="Upload filled-in template" @change="onFile(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''" />
      </label>
      <p v-if="reading" class="text-sm mt-2" role="status">Reading the file…</p>
      <div v-if="uploadError" class="alert alert-error text-sm mt-2" role="alert">{{ uploadError }}</div>

      <template v-if="draft.file">
        <div class="flex flex-wrap gap-2 items-center text-sm mt-3">
          <span class="badge">{{ draft.file }}</span>
          <span>{{ filled.length.toLocaleString() }} rows</span>
          <span v-if="termErrors.length" class="text-red-700">· {{ termErrors.length }} row(s) without a term (must be fixed)</span>
          <span v-if="blrWarnings.length" class="text-amber-700">· {{ blrWarnings.length }} BLR index(es) will not be linked</span>
        </div>
        <ul v-if="draft.warnings.length" class="text-sm text-amber-700 list-disc ml-5 mt-1"><li v-for="w in draft.warnings" :key="w">{{ w }}</li></ul>
        <details v-if="termErrors.length || blrWarnings.length" class="text-sm mt-2">
          <summary class="cursor-pointer">Rows to look at</summary>
          <ul class="list-disc ml-5 max-h-40 overflow-auto">
            <li v-for="i in [...termErrors, ...blrWarnings].slice(0, 200)" :key="i">
              Excel row {{ excelRow(i) }}: {{ Object.values(rowIssues.get(i) ?? {}).join('; ') }}
            </li>
          </ul>
        </details>
        <p class="text-xs opacity-70 mt-3">Review the data below. Fix larger problems in the Excel file and upload it again; small corrections can be made directly in the grid. Row numbers are grid rows; the list above gives Excel row numbers.</p>
        <BulkGrid v-model:rows="draft.rows" v-model:columns="draft.columns" :errors="rowIssues" />
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <button class="btn btn-sm" type="button" :disabled="!!busy || !filled.length || !linksOk || termErrors.length > 0" @click="send(true)">
            {{ busy === 'check' ? 'Checking…' : 'Check against the database' }}
          </button>
          <span v-if="!linksOk" class="text-sm opacity-70">Complete step 2 to check the links.</span>
          <span v-else-if="termErrors.length" class="text-sm opacity-70">Give every row a term first (in the file or in the grid).</span>
          <span v-if="check" class="text-sm text-green-800" role="status">
            Check passed: {{ check.rows.toLocaleString() }} rows; {{ check.blr_linked.toLocaleString() }} linked to BLR;
            {{ check.blr_text.toLocaleString() }} BLR texts kept as reconstruction notes<span v-if="check.blr_unknown.length">; {{ check.blr_unknown.length }} unknown BLR index(es)</span>.
          </span>
        </div>
      </template>
      <div class="flex justify-between mt-3">
        <button class="btn btn-sm" type="button" @click="go(2)">‹ Back</button>
        <span v-if="!complete[3]" class="text-sm opacity-70 self-center">{{ !draft.file ? 'Upload the filled-in template.' : termErrors.length ? 'Give every row a term.' : 'Run “Check against the database”.' }}</span>
        <button class="btn btn-sm" type="button" :disabled="!complete[3]" @click="go(4)">Next: process ›</button>
      </div>
    </WizardStep>

    <!-- 4. Process -->
    <WizardStep :n="4" title="Process the import" :status="statuses[4]" :open="draft.step === 4" :locked="!reachable(4)" @toggle="toggle(4)">
      <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm mb-3">
        <dt class="opacity-70">Import name</dt><dd>date and time of processing, e.g. {{ importName() }}</dd>
        <dt class="opacity-70">Source</dt><dd>{{ sourceName || '—' }} ({{ draft.role }})</dd>
        <dt class="opacity-70">Variety</dt><dd>{{ varietyName || '—' }}</dd>
        <dt class="opacity-70">Location</dt><dd>{{ draft.location?.label ?? '—' }}</dd>
        <dt class="opacity-70">Fieldwork</dt><dd>{{ draft.fieldwork?.label ?? '—' }}</dd>
        <dt class="opacity-70">Rows</dt><dd>{{ filled.length.toLocaleString() }} from {{ draft.file ?? 'no file yet' }}</dd>
        <dt class="opacity-70">BLR</dt>
        <dd>{{ check ? `${check.blr_linked.toLocaleString()} linked, ${check.blr_text.toLocaleString()} kept as reconstruction notes, ${check.blr_unknown.length} unknown` : 'not checked yet' }}</dd>
      </dl>
      <ul v-if="!ready" class="text-sm text-amber-700 list-disc ml-5 mb-3">
        <li v-if="!linksOk">Step 2: choose or create the source.</li>
        <li v-if="!draft.file">Step 3: upload the filled-in template.</li>
        <li v-else-if="termErrors.length">Step 3: {{ termErrors.length }} row(s) have no term.</li>
        <li v-else-if="!check">Step 3: run “Check against the database”.</li>
      </ul>
      <div class="flex justify-between">
        <button class="btn btn-sm" type="button" @click="go(3)">‹ Back</button>
        <button class="btn btn-sm btn-primary" type="button" :disabled="!!busy || !ready" @click="processImport">
          {{ busy === 'process' ? 'Processing…' : `Process import (${filled.length.toLocaleString()} reflexes)` }}
        </button>
      </div>
    </WizardStep>

    <div class="mt-4">
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
