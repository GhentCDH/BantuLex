// The sorted column of a table and its direction; clicking the active column
// toggles the direction, another column starts ascending.
import { ref } from 'vue';

export type SortDir = 'asc' | 'desc';

export function useSort(initial: string, initialDir: SortDir = 'asc') {
  const sort = ref(initial);
  const sortDir = ref<SortDir>(initialDir);
  function toggle(key: string) {
    if (sort.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    else { sort.value = key; sortDir.value = 'asc'; }
  }
  return { sort, sortDir, toggle };
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
/** Compare two cell values for a client-side sort; empty values go last in either direction. */
export function compareValues(a: unknown, b: unknown, dir: SortDir) {
  const empty = (v: unknown) => v == null || v === '';
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
  const order = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
  return dir === 'asc' ? order : -order;
}
