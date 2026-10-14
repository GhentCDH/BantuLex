<script setup lang="ts">
// Spreadsheet-like grid for thousands of rows: only the visible rows are
// rendered (fixed row height). Paste TSV from Excel/Sheets at any cell to fill
// right and down (a header row maps columns); copy a selected block as TSV;
// arrows/Enter move between cells; Delete clears the selection.
import { computed, nextTick, ref, watch } from 'vue';
import { COLUMNS, columnForHeader, emptyRow, isEmptyRow, type BulkRow } from './columns';
import { parseTsv, toTsv } from './tsv';

const props = defineProps<{ columns: string[]; errors: Map<number, Record<string, string>> }>();
const rows = defineModel<BulkRow[]>('rows', { required: true });
const emit = defineEmits<{ (e: 'update:columns', value: string[]): void }>();

const ROW_H = 30, VIEW_H = 480, OVERSCAN = 8;
const scrollTop = ref(0);
const viewport = ref<HTMLElement>();
const cols = computed(() => props.columns.map(k => COLUMNS.find(c => c.key === k)!).filter(Boolean));
const first = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN));
const last = computed(() => Math.min(rows.value.length, Math.ceil((scrollTop.value + VIEW_H) / ROW_H) + OVERSCAN));
const visible = computed(() => rows.value.slice(first.value, last.value).map((row, i) => ({ row, index: first.value + i })));

// Selection: anchor and focus cell (row index, column index).
const anchor = ref<[number, number]>([0, 0]);
const focus = ref<[number, number]>([0, 0]);
const range = computed(() => {
  const [r1, c1] = anchor.value, [r2, c2] = focus.value;
  return { top: Math.min(r1, r2), bottom: Math.max(r1, r2), left: Math.min(c1, c2), right: Math.max(c1, c2) };
});
const inRange = (r: number, c: number) => {
  const g = range.value;
  return r >= g.top && r <= g.bottom && c >= g.left && c <= g.right && (g.top !== g.bottom || g.left !== g.right);
};
const selectedRows = ref(new Set<number>());
// A new row array (after save or clear) starts without a selection.
watch(() => rows.value, () => { anchor.value = [0, 0]; focus.value = [0, 0]; selectedRows.value = new Set(); });

function cellId(r: number, c: number) { return `bulk-cell-${r}-${c}`; }
// Set while focusCell() moves focus to extend a selection, so onFocus keeps the anchor.
let extending = false;
function onFocus(r: number, c: number) {
  focus.value = [r, c];
  if (!extending) anchor.value = [r, c];
  extending = false;
}
async function focusCell(r: number, c: number, extend = false) {
  r = Math.max(0, Math.min(rows.value.length - 1, r));
  c = Math.max(0, Math.min(cols.value.length - 1, c));
  focus.value = [r, c];
  if (!extend) anchor.value = [r, c];
  const el = viewport.value!;
  if (r * ROW_H < el.scrollTop) el.scrollTop = r * ROW_H;
  else if ((r + 1) * ROW_H > el.scrollTop + VIEW_H - ROW_H) el.scrollTop = (r + 2) * ROW_H - VIEW_H;
  await nextTick();
  extending = extend;
  (document.getElementById(cellId(r, c)) as HTMLInputElement | null)?.focus({ preventScroll: true });
}

function ensureRows(n: number) {
  while (rows.value.length < n) rows.value.push(emptyRow());
}

function onKey(e: KeyboardEvent, r: number, c: number) {
  const input = e.target as HTMLInputElement;
  const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
  const atEnd = input.selectionStart === input.value.length;
  if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
    e.preventDefault();
    if (r === rows.value.length - 1) ensureRows(rows.value.length + 1);
    focusCell(r + 1, c, e.shiftKey && e.key === 'ArrowDown');
  } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
    e.preventDefault(); focusCell(r - 1, c, e.shiftKey && e.key === 'ArrowUp');
  } else if (e.key === 'ArrowLeft' && (atStart || e.shiftKey)) {
    e.preventDefault(); focusCell(r, c - 1, e.shiftKey);
  } else if (e.key === 'ArrowRight' && (atEnd || e.shiftKey)) {
    e.preventDefault(); focusCell(r, c + 1, e.shiftKey);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && inRange(r, c)) {
    e.preventDefault();
    const g = range.value;
    for (let i = g.top; i <= g.bottom; i++) for (let j = g.left; j <= g.right; j++) rows.value[i][cols.value[j].key] = '';
  }
}

function onPaste(e: ClipboardEvent, r: number, c: number) {
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (!/[\t\n]/.test(text)) return; // a single value: let the input handle it
  e.preventDefault();
  let data = parseTsv(text.replace(/\r?\n$/, ''));
  // A header row ("Term  Translation …") selects and orders the columns.
  const header = data[0]?.map(columnForHeader);
  if (header && header.length && header.every(Boolean)) {
    emit('update:columns', [...new Set([...(header as string[]), ...props.columns.filter(k => !header.includes(k))])]);
    data = data.slice(1);
    c = 0;
    nextTick(() => fill(data, r, 0));
    return;
  }
  fill(data, r, c);
}

function fill(data: string[][], r: number, c: number) {
  ensureRows(r + data.length);
  data.forEach((cells, i) => cells.forEach((v, j) => {
    const col = cols.value[c + j];
    if (col) rows.value[r + i][col.key] = v.trim();
  }));
  anchor.value = [r, c];
  focus.value = [r + data.length - 1, Math.min(cols.value.length - 1, c + (data[0]?.length ?? 1) - 1)];
}

function onCopy(e: ClipboardEvent, r: number, c: number) {
  if (!inRange(r, c)) return;
  e.preventDefault();
  const g = range.value, out: string[][] = [];
  for (let i = g.top; i <= g.bottom; i++) out.push(cols.value.slice(g.left, g.right + 1).map(col => rows.value[i][col.key] ?? ''));
  e.clipboardData?.setData('text/plain', toTsv(out));
}

function toggleRow(i: number, e: MouseEvent) {
  const s = new Set(selectedRows.value);
  if (e.shiftKey && s.size) {
    const from = Math.max(...s);
    for (let j = Math.min(from, i); j <= Math.max(from, i); j++) s.add(j);
  } else if (s.has(i)) s.delete(i);
  else s.add(i);
  selectedRows.value = s;
}
function deleteSelected() {
  rows.value = rows.value.filter((_, i) => !selectedRows.value.has(i));
  selectedRows.value = new Set();
  if (!rows.value.length) rows.value = [emptyRow()];
}
function insertAbove() {
  const at = selectedRows.value.size ? Math.min(...selectedRows.value) : focus.value[0];
  rows.value.splice(at, 0, emptyRow());
}
function addRows(n: number) { ensureRows(rows.value.length + n); }

const filled = computed(() => rows.value.filter(r => !isEmptyRow(r)).length);
const width = computed(() => 56 + cols.value.reduce((n, c) => n + c.width, 0));
const rowError = (i: number) => props.errors.get(i);
defineExpose({ focusCell });
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <button class="btn btn-sm" type="button" @click="addRows(1)">Add row</button>
      <button class="btn btn-sm" type="button" @click="addRows(100)">Add 100 rows</button>
      <button class="btn btn-sm" type="button" @click="insertAbove">Insert row above</button>
      <button class="btn btn-sm btn-error" type="button" :disabled="!selectedRows.size" @click="deleteSelected">
        Delete {{ selectedRows.size || '' }} selected row{{ selectedRows.size === 1 ? '' : 's' }}
      </button>
      <span class="text-sm opacity-70 ml-auto">{{ filled.toLocaleString() }} filled of {{ rows.length.toLocaleString() }} rows · paste from a spreadsheet into any cell</span>
    </div>
    <div ref="viewport" class="bulk-viewport border rounded" :style="{ height: VIEW_H + 'px' }" @scroll="scrollTop = ($event.target as HTMLElement).scrollTop">
      <div :style="{ width: width + 'px' }">
        <div class="bulk-row bulk-head" :style="{ height: ROW_H + 'px' }">
          <div class="bulk-num">#</div>
          <div v-for="col in cols" :key="col.key" class="bulk-cell bulk-th" :style="{ width: col.width + 'px' }">
            {{ col.label }}<span v-if="col.required" class="text-red-600"> *</span>
          </div>
        </div>
        <div :style="{ height: rows.length * ROW_H + 'px', position: 'relative' }">
          <div v-for="{ row, index } in visible" :key="index" class="bulk-row"
               :class="{ 'bulk-selected': selectedRows.has(index), 'bulk-invalid': rowError(index) }"
               :style="{ position: 'absolute', top: index * ROW_H + 'px', height: ROW_H + 'px' }">
            <button type="button" class="bulk-num" :title="rowError(index) ? Object.values(rowError(index)!).join('; ') : 'Select row (shift: range)'"
                    @click="toggleRow(index, $event)">{{ index + 1 }}</button>
            <div v-for="(col, c) in cols" :key="col.key" class="bulk-cell" :style="{ width: col.width + 'px' }"
                 :class="{ 'bulk-in-range': inRange(index, c), 'bulk-cell-error': rowError(index)?.[col.key] }"
                 :title="rowError(index)?.[col.key]">
              <input :id="cellId(index, c)" v-model="row[col.key]" class="bulk-input" spellcheck="false"
                     :aria-label="`${col.label} row ${index + 1}`"
                     @focus="onFocus(index, c)"
                     @mousedown.shift.prevent="focusCell(index, c, true)"
                     @keydown="onKey($event, index, c)" @paste="onPaste($event, index, c)" @copy="onCopy($event, index, c)" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bulk-viewport { overflow: auto; position: relative; background: white; }
.bulk-row { display: flex; width: 100%; }
.bulk-head { position: sticky; top: 0; z-index: 2; background: #f3f4f6; }
.bulk-num { width: 56px; flex: none; text-align: right; padding: 0 6px; font-size: 12px; color: #6b7280; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; background: #f9fafb; line-height: 30px; }
.bulk-cell { flex: none; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
.bulk-th { font-size: 12px; font-weight: 600; padding: 0 6px; line-height: 30px; white-space: nowrap; overflow: hidden; }
.bulk-input { width: 100%; height: 100%; border: 0; padding: 0 6px; font-size: 14px; background: transparent; outline: none; }
.bulk-input:focus { box-shadow: inset 0 0 0 2px #2563eb; background: #fff; }
.bulk-in-range { background: #dbeafe; }
.bulk-selected .bulk-num { background: #bfdbfe; color: #1e3a8a; }
.bulk-invalid .bulk-num { background: #fee2e2; color: #991b1b; font-weight: 600; }
.bulk-cell-error { box-shadow: inset 0 0 0 2px #dc2626; }
</style>
