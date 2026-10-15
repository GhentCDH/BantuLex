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
    <h3 class="font-semibold mb-2">
      {{ wrapper.label }}
      <span v-if="result" class="opacity-60 font-normal related-count">({{ result.count.toLocaleString() }})</span>
    </h3>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p v-else-if="!result" class="text-sm opacity-60">Loading…</p>
    <p v-else-if="!result.count" class="text-sm opacity-60">None</p>
    <template v-else>
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead><tr><th v-for="c in columns" :key="c.key">{{ c.label }}</th><th class="w-0"></th></tr></thead>
          <tbody>
            <tr v-for="row in result.rows" :key="row.id">
              <td v-for="c in columns" :key="c.key">
                <router-link v-if="c.key === 'display_label'" :to="recordRoute(options.childResource, row.id, 'view')" class="link link-primary">{{ row.display_label ?? `#${row.id}` }}</router-link>
                <template v-else>{{ row[c.key] }}</template>
              </td>
              <td><router-link :to="recordRoute(options.childResource, row.id, 'update')" class="btn btn-ghost btn-xs">Edit</router-link></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="result.totalPages > 1" class="flex items-center gap-2 mt-2 text-sm">
        <button type="button" class="btn btn-sm" :disabled="page <= 1" @click="page--">Previous</button>
        <span>Page {{ page }} of {{ result.totalPages.toLocaleString() }}</span>
        <button type="button" class="btn btn-sm" :disabled="page >= result.totalPages" @click="page++">Next</button>
      </div>
    </template>
  </section>
</template>
