import { computed, ref, watch, type Ref } from 'vue';

const STORAGE_KEY = 'bantulex-bulk-edit-order';

/**
 * User-defined column order for a bulk grid. New columns are appended in their
 * default order; unknown stored keys are ignored. The order is kept per browser.
 */
export function useColumnOrder(allKeys: Ref<string[]>, storageKey = STORAGE_KEY) {
  const order = ref<string[]>([]);

  function read(): string[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(order.value));
    } catch {
      // Storage unavailable: the order just isn't remembered.
    }
  }

  watch(allKeys, keys => {
    if (!keys.length) return;
    const known = new Set(keys);
    const next = [...new Set(read().filter(k => known.has(k)))];
    for (const key of keys) if (!next.includes(key)) next.push(key);
    order.value = next;
  }, { immediate: true });

  const orderedKeys = computed(() => order.value.filter(k => allKeys.value.includes(k)));

  /** Move `from` before `to`; drop positions are before the target column. */
  function move(from: string, to: string) {
    if (from === to) return;
    const next = order.value.filter(k => k !== from);
    const at = next.indexOf(to);
    if (at < 0) return;
    next.splice(at, 0, from);
    order.value = next;
    persist();
  }

  function reset() {
    order.value = [...allKeys.value];
    persist();
  }

  return { order, orderedKeys, move, reset };
}
