<script setup lang="ts">
// Read-only view of a "related-table" calculated column: a paged table of the records of
// another resource that point to this record (one-to-many), with links to view and edit them.
import { computed, ref, watch } from 'vue';
import { useControlBinding, type ControlElement, type JsonSchema } from '@ghentcdh/crouton-vue';
import { childPage, recordRoute, type ChildPage } from './links';
interface Options { childResource: string; foreignKey: string; columns?: { key: string; label: string }[]; pageSize?: number; sort?: string }
const props = defineProps<{ uischema: ControlElement; schema: JsonSchema }>();
const { formValues, wrapper } = useControlBinding(props.uischema, props.schema);
const options = computed(() => (props.uischema.options ?? {}) as Options);
const columns = computed(() => [{ key: 'display_label', label: 'Record' }, ...(options.value.columns ?? [])]);
const parentId = computed(() => Number((formValues as Record<string, any>)?.id));
const page = ref(1);
const result = ref<ChildPage | null>(null);
const error = ref('');
let latest = 0;
async function load() {
  if (!Number.isInteger(parentId.value)) return;
  const run = ++latest;
  try {
    const r = await childPage(options.value.childResource, options.value.foreignKey, parentId.value, page.value, options.value.pageSize ?? 10, options.value.sort);
    if (run === latest) { result.value = r; error.value = ''; }
  } catch (e) {
    if (run === latest) error.value = (e as Error).message;
  }
}
watch([parentId, page], load, { immediate: true });
watch(parentId, () => { page.value = 1; });
</script>
<template>
  <section class="col-span-full min-w-0 mt-4 related-table" :data-resource="options.childResource">
    <h3 class="text-sm font-semibold mb-1">
      {{ wrapper.label }}
      <span v-if="result" class="opacity-60 font-normal related-count">({{ result.count.toLocaleString() }})</span>
    </h3>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p v-else-if="!result" class="text-sm opacity-60">Loading…</p>
    <p v-else-if="!result.count" class="text-sm opacity-60">None</p>
    <template v-else>
      <!-- Same classes as Crouton's list tables. -->
      <div class="border border-gray-200">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs text-text-muted font-medium border-b border-gray-200">
              <tr class="border-b border-gray-200">
                <th v-for="c in columns" :key="c.key" class="px-3 py-1 text-left font-semibold text-text-accent border-r border-gray-200">{{ c.label }}</th>
                <th class="w-0"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in result.rows" :key="row.id" class="hover:bg-gray-100 border-b border-gray-200 last:border-b-0">
                <td v-for="c in columns" :key="c.key" class="py-1 px-3">
                  <router-link v-if="c.key === 'display_label'" :to="recordRoute(options.childResource, row.id, 'view')" class="text-primary no-underline hover:underline">{{ row.display_label ?? `#${row.id}` }}</router-link>
                  <template v-else>{{ row[c.key] }}</template>
                </td>
                <td class="py-1 px-3 text-right"><router-link :to="recordRoute(options.childResource, row.id, 'update')" class="text-xs opacity-70 no-underline hover:underline">Edit</router-link></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="result.totalPages > 1" class="flex items-center gap-3 mt-1 text-xs">
        <button type="button" class="text-primary no-underline hover:underline disabled:opacity-40 disabled:no-underline" :disabled="page <= 1" @click="page--">Previous</button>
        <span class="opacity-70">Page {{ page }} of {{ result.totalPages.toLocaleString() }}</span>
        <button type="button" class="text-primary no-underline hover:underline disabled:opacity-40 disabled:no-underline" :disabled="page >= result.totalPages" @click="page++">Next</button>
      </div>
    </template>
  </section>
</template>
