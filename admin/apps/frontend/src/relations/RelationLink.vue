<script setup lang="ts">
// Read-only view of a `<fk>_label` calculated column (options.format "relation-link"):
// the related record's label as a link to its view, with an edit link next to it,
// so a related record is not mistaken for a text field of this record.
import { computed } from 'vue';
import { useControlBinding, type ControlElement, type JsonSchema } from '@ghentcdh/crouton-vue';
import { recordRoute } from './links';
const props = defineProps<{ uischema: ControlElement; schema: JsonSchema }>();
const { value, formValues, wrapper } = useControlBinding(props.uischema, props.schema);
const options = computed(() => (props.uischema.options ?? {}) as { linkResource: string; idKey: string });
const id = computed(() => (formValues as Record<string, any>)?.[options.value.idKey] ?? null);
</script>
<template>
  <!-- Same row layout as Crouton's read-only fields: label cell, then the value. -->
  <div class="flex flex-row h-full relation-link" :data-resource="options.linkResource">
    <div class="text-xs bg-base-200 p-2 h-full border-b border-gray-200 max-w-96 text-left font-semibold text-text-accent flex items-center" style="min-width: 150px;"><span>{{ wrapper.label }}</span></div>
    <div class="h-full p-1.5 min-w-0 text-sm flex items-center">
      <span v-if="id == null" class="opacity-60 px-0.5">—</span>
      <span v-else class="inline-flex items-center gap-1 max-w-full rounded-full border border-primary/40 bg-primary/5 pl-3 pr-1 py-0.5">
        <span aria-hidden="true" class="text-primary">↗</span>
        <router-link :to="recordRoute(options.linkResource, id, 'view')" class="link link-primary truncate" :title="`View ${wrapper.label}`">{{ value }}</router-link>
        <router-link :to="recordRoute(options.linkResource, id, 'update')" class="btn btn-ghost btn-xs" :aria-label="`Edit ${wrapper.label}`">Edit</router-link>
      </span>
    </div>
  </div>
</template>
