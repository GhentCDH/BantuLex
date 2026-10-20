<script setup lang="ts">
// The viewer's sound-structure grid, editable: one dropdown per consonant or
// vowel slot (existing values only), a searchable field for CS, and the tones
// under the vowels. An empty slot is stored as NULL.
import { SEGMENTS, TONES, segmentLabel } from './types';

const props = defineProps<{
  options: Record<string, string[]>;
  loading?: boolean;
}>();
const model = defineModel<Record<string, string | null>>({ required: true });

const value = (field: string) => model.value[field] ?? '';
function set(field: string, value: string) {
  model.value = { ...model.value, [field]: value === '' ? null : value };
}
function clear() {
  model.value = Object.fromEntries(Object.keys(model.value).map(k => [k, null]));
}
</script>

<template>
  <section class="border rounded p-3" aria-label="Sound structure">
    <div class="flex items-center gap-3 mb-2">
      <h3 class="font-semibold text-sm">Sound structure</h3>
      <span class="text-xs opacity-60">Empty cells match anything.</span>
      <button type="button" class="btn btn-sm ml-auto" @click="clear">Clear</button>
    </div>

    <div class="structure-grid">
      <span v-for="field in SEGMENTS" :key="`h-${field}`" class="structure-head">{{ segmentLabel(field) }}</span>

      <template v-for="field in SEGMENTS" :key="field">
        <input v-if="field === 'cs'" :value="value('cs')" :list="'blr-cs-options'" class="structure-input"
               :aria-label="segmentLabel(field)" placeholder="—" @input="set('cs', ($event.target as HTMLInputElement).value)" />
        <select v-else :value="value(field)" class="structure-input" :aria-label="segmentLabel(field)"
                :disabled="loading" @change="set(field, ($event.target as HTMLSelectElement).value)">
          <option value="">—</option>
          <option v-for="option in options[field] ?? []" :key="option" :value="option">{{ option }}</option>
        </select>
      </template>

      <template v-for="field in SEGMENTS" :key="`t-${field}`">
        <select v-if="TONES[field]" :value="value(TONES[field])" class="structure-input structure-tone"
                :aria-label="segmentLabel(TONES[field])" :disabled="loading"
                @change="set(TONES[field], ($event.target as HTMLSelectElement).value)">
          <option value="">—</option>
          <option v-for="option in options[TONES[field]] ?? []" :key="option" :value="option">{{ option }}</option>
        </select>
        <span v-else class="structure-slot-empty" />
      </template>
    </div>

    <datalist id="blr-cs-options">
      <option v-for="option in options.cs ?? []" :key="option" :value="option" />
    </datalist>
  </section>
</template>

<style scoped>
.structure-grid { display: grid; grid-template-columns: repeat(11, minmax(0, 1fr)); gap: 4px; align-items: center; }
.structure-head { font-size: 11px; font-weight: 600; text-align: center; color: #6b7280; }
.structure-input { width: 100%; min-width: 0; border: 1px solid #d1d5db; border-radius: 4px; padding: 3px 4px; font-size: 13px; background: #fff; }
.structure-tone { background: #f9fafb; }
.structure-slot-empty { height: 26px; }
</style>
