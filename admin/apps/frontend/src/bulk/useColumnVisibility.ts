import { computed, ref, watch, type Ref } from 'vue';

const STORAGE_KEY = 'bantulex-bulk-edit-hidden';

/**
 * Which columns of a bulk grid the user hid. The selection is kept per browser
 * so it survives navigation and reloads; unknown keys (removed columns, other
 * pages) are ignored. At least one column always stays visible.
 */
export function useColumnVisibility(allKeys: Ref<string[]>, storageKey = STORAGE_KEY) {
  const hidden = ref(new Set<string>());

  const visibleKeys = computed(() => {
    const visible = allKeys.value.filter(k => !hidden.value.has(k));
    return visible.length ? visible : allKeys.value.slice(0, 1);
  });

  function read() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        hidden.value = new Set(parsed.filter((k): k is string => typeof k === 'string' && allKeys.value.includes(k)));
      }
    } catch {
      // Corrupt or unavailable storage: start with everything visible.
    }
  }

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...hidden.value]));
    } catch {
      // Storage unavailable (private mode): visibility just isn't remembered.
    }
  }

  function toggle(key: string) {
    const next = new Set(hidden.value);
    if (next.has(key)) next.delete(key);
    else {
      if (visibleKeys.value.length <= 1) return;
      next.add(key);
    }
    hidden.value = next;
    persist();
  }

  function showAll() {
    hidden.value = new Set();
    persist();
  }

  // The column keys depend on the resource definition, so re-read when they arrive.
  watch(allKeys, read, { immediate: true });

  return { hidden, visibleKeys, toggle, showAll };
}
