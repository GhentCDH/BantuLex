<script setup lang="ts">
// Read-only view of a reconstruction's "reconstruction-links" calculated column:
// links to the reconstruction form and to the public BLR viewer on the same host.
import { computed } from 'vue';
import { useControlBinding, type ControlElement, type JsonSchema } from '@ghentcdh/crouton-vue';
import { viewerUrl } from '../blr/api';
const props = defineProps<{ uischema: ControlElement; schema: JsonSchema }>();
const { formValues, wrapper } = useControlBinding(props.uischema, props.schema);
const values = computed(() => (formValues as Record<string, any>) ?? {});
</script>
<template>
  <!-- Same row layout as Crouton's read-only fields: label cell, then the value. -->
  <div class="flex flex-row h-full reconstruction-links">
    <div class="text-xs bg-base-200 p-2 h-full border-b border-gray-200 max-w-96 text-left font-semibold text-text-accent flex items-center" style="min-width: 150px;"><span>{{ wrapper.label }}</span></div>
    <div class="h-full p-2 min-w-0 text-sm flex items-center gap-4">
      <router-link v-if="values.id != null" :to="{ path: '/crouton/reconstruction-form', query: { id: String(values.id) } }"
                   class="text-primary no-underline hover:underline">Reconstruction editor</router-link>
      <a v-if="values.blr_index != null" :href="viewerUrl(values.blr_index)" target="_blank" rel="noopener"
         class="text-primary no-underline hover:underline">Public site ↗</a>
    </div>
  </div>
</template>
