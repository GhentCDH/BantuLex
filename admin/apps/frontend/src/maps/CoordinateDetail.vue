<script setup lang="ts">
import { computed } from 'vue';
import { useControlBinding, type ControlElement, type JsonSchema } from '@ghentcdh/crouton-vue';
import CoordinateMap from './CoordinateMap.vue';
import type { Coordinate } from './coordinates';
const props = defineProps<{ uischema: ControlElement; schema: JsonSchema }>();
const { value } = useControlBinding(props.uischema, props.schema);
const points = computed<Coordinate[]>(() => {
  try { return value.value ? [JSON.parse(value.value as string)] : []; } catch { return []; }
});
</script>
<template><section class="col-span-full min-w-0"><h3 class="font-semibold mb-2">Map</h3><CoordinateMap :points="points" /></section></template>
