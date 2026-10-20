<script setup lang="ts">
// The viewer's sound-structure grid, editable: one dropdown per consonant or
// vowel slot (existing values only), a searchable field for CS, and the tones
// under the vowels. An empty slot (∅) is stored as NULL.
import { SEGMENTS, TONES, segmentLabel } from './types';

defineProps<{
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
  <div>
    <div class="structure-grid">
      <span v-for="field in SEGMENTS" :key="`h-${field}`" class="structure-head">{{ segmentLabel(field) }}</span>

      <template v-for="field in SEGMENTS" :key="field">
        <input v-if="field === 'cs'" :value="value('cs')" :list="'blr-cs-options'" class="structure-value"
               :class="{ 'is-set': value('cs') }" :aria-label="segmentLabel(field)" placeholder="∅"
               @input="set('cs', ($event.target as HTMLInputElement).value)" />
        <select v-else :value="value(field)" class="structure-value" :class="{ 'is-set': value(field) }"
                :aria-label="segmentLabel(field)" :disabled="loading" @change="set(field, ($event.target as HTMLSelectElement).value)">
          <option value="">∅</option>
          <option v-for="option in options[field] ?? []" :key="option" :value="option">{{ option }}</option>
        </select>
      </template>

      <template v-for="field in SEGMENTS" :key="`t-${field}`">
        <select v-if="TONES[field]" :value="value(TONES[field])" class="structure-value structure-tone"
                :class="{ 'is-set': value(TONES[field]) }" :aria-label="segmentLabel(TONES[field])" :disabled="loading"
                @change="set(TONES[field], ($event.target as HTMLSelectElement).value)">
          <option value="">∅</option>
          <option v-for="option in options[TONES[field]] ?? []" :key="option" :value="option">{{ option }}</option>
        </select>
        <span v-else />
      </template>
    </div>

    <div class="flex items-center gap-3 mt-2 text-xs">
      <span class="opacity-60">∅ = empty slot. An identical structure is reused.</span>
      <button type="button" class="btn btn-xs ml-auto" @click="clear">Clear</button>
    </div>

    <datalist id="blr-cs-options">
      <option v-for="option in options.cs ?? []" :key="option" :value="option" />
    </datalist>
  </div>
</template>

<style scoped>
/* As the viewer: ten slots, a narrow gap, then CS. */
.structure-grid { display: grid; grid-template-columns: repeat(10, minmax(1.6rem, 2.9rem)) .5rem minmax(2.4rem, 3.6rem); gap: 4px; }
.structure-grid > :nth-child(11n) { grid-column: 12; }
.structure-head { font-size: .72rem; text-align: center; color: #646a73; }
.structure-value {
  width: 100%; min-width: 0; height: 2.1rem; padding: 0 1px; text-align: center; text-align-last: center;
  font: 1rem var(--font-forms); color: #b9b2a2; background: #efece4;
  border: 1px solid #dcd7cb; border-radius: 5px; appearance: none; cursor: pointer;
}
.structure-value:hover { border-color: #b9b2a2; }
/* A filled slot reads like the viewer's value; an empty one shows a dimmed ∅. */
.structure-value.is-set { color: #1f2328; background: #efece4; }
.structure-value:focus { outline: 2px solid #1f6f6b; outline-offset: 1px; }
.structure-tone { height: 1.6rem; font-size: .85rem; }
input.structure-value { cursor: text; }
</style>
