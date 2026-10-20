<script setup lang="ts">
// A labelled dropdown whose options come from a Crouton resource; an empty
// option clears the link.
import type { Option } from './types';

withDefaults(defineProps<{
  label: string;
  options: Option[];
  loading?: boolean;
  placeholder?: string;
}>(), { loading: false, placeholder: '—' });

const model = defineModel<number | null>({ default: null });
</script>

<template>
  <label class="text-sm">
    <span class="block font-semibold mb-1">{{ label }}</span>
    <select :value="model ?? ''" class="w-full border rounded px-2 py-1 text-sm" :disabled="loading"
            :aria-label="label" @change="model = ($event.target as HTMLSelectElement).value === '' ? null : Number(($event.target as HTMLSelectElement).value)">
      <option value="">{{ loading ? 'Loading…' : placeholder }}</option>
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
  </label>
</template>
