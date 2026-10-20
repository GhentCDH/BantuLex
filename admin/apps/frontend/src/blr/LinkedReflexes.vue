<script setup lang="ts">
// The reflexes of the reconstruction, as in the viewer's reflex table: the
// current selection with a remove action, and the reflexes that will be
// unlinked on save (they can be restored until then).
import { computed } from 'vue';
import { recordRoute } from '../relations/links';
import type { ReflexRow } from './types';

const props = defineProps<{ original: ReflexRow[] }>();
const model = defineModel<ReflexRow[]>({ required: true });

const originalIds = computed(() => new Set(props.original.map(r => r.id)));
const currentIds = computed(() => new Set(model.value.map(r => r.id)));
const removed = computed(() => props.original.filter(r => !currentIds.value.has(r.id)));

const remove = (row: ReflexRow) => { model.value = model.value.filter(r => r.id !== row.id); };
const restore = (row: ReflexRow) => { model.value = [...model.value, row]; };
</script>

<template>
  <section class="border rounded" aria-label="Linked reflexes">
    <div class="overflow-auto" style="max-height: 40vh">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-gray-50">
          <tr class="text-left">
            <th class="p-2">Term</th>
            <th class="p-2">Meaning</th>
            <th class="p-2">Translation</th>
            <th class="p-2">Variety</th>
            <th class="p-2 w-24" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in model" :key="row.id" :class="{ 'bg-blue-50': !originalIds.has(row.id) }">
            <td class="p-2 forms">
              <router-link :to="recordRoute('reflex', row.id, 'view')" class="term no-underline hover:underline">{{ row.term ?? `#${row.id}` }}</router-link>
              <span v-if="!originalIds.has(row.id)" class="ml-1 text-xs text-blue-700">new</span>
            </td>
            <td class="p-2">{{ row.meaning ?? '—' }}</td>
            <td class="p-2">{{ row.translation ?? '—' }}</td>
            <td class="p-2">{{ row.variety_label ?? '—' }}</td>
            <td class="p-2 text-right">
              <button type="button" class="btn btn-xs" :aria-label="`Remove reflex ${row.id}`" @click="remove(row)">Remove</button>
            </td>
          </tr>
          <tr v-for="row in removed" :key="`removed-${row.id}`" class="opacity-60">
            <td class="p-2 forms line-through">{{ row.term ?? `#${row.id}` }}</td>
            <td class="p-2 line-through">{{ row.meaning ?? '—' }}</td>
            <td class="p-2 line-through">{{ row.translation ?? '—' }}</td>
            <td class="p-2">{{ row.variety_label ?? '—' }} <span class="text-xs text-red-700">unlinked on save</span></td>
            <td class="p-2 text-right">
              <button type="button" class="btn btn-xs" :aria-label="`Restore reflex ${row.id}`" @click="restore(row)">Restore</button>
            </td>
          </tr>
          <tr v-if="!model.length && !removed.length">
            <td colspan="5" class="p-3 text-center opacity-60">No reflexes; add them below.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.forms { font-family: var(--font-forms); }
.term { font-weight: 600; color: #1f6f6b; }
</style>
