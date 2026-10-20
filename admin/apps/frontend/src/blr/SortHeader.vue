<script setup lang="ts">
// A table header cell that sorts its column when clicked, with the direction arrow
// and aria-sort; when not sortable it is a plain label.
import { computed } from 'vue';
import type { SortDir } from './useSort';

const props = withDefaults(defineProps<{
  label: string;
  column: string;
  sort: string;
  sortDir: SortDir;
  sortable?: boolean;
}>(), { sortable: true });
const emit = defineEmits<{ sort: [column: string] }>();

const active = computed(() => props.sort === props.column);
const ariaSort = computed(() => active.value ? (props.sortDir === 'asc' ? 'ascending' : 'descending') : props.sortable ? 'none' : undefined);
</script>

<template>
  <th class="p-2" :aria-sort="ariaSort">
    <button v-if="sortable" type="button" class="sort-button" :class="{ active }" @click="emit('sort', column)">
      {{ label }}<span class="arrow" aria-hidden="true">{{ active ? (sortDir === 'asc' ? '▲' : '▼') : '' }}</span>
    </button>
    <template v-else>{{ label }}</template>
  </th>
</template>

<style scoped>
.sort-button { display: inline-flex; align-items: center; gap: .25rem; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
.sort-button:hover, .sort-button.active { color: #1f6f6b; }
.arrow { display: inline-block; min-width: .7rem; font-size: .65rem; }
</style>
