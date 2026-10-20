<script setup lang="ts">
// The reconstruction facts from the public BLR detail view, as an editable form:
// text fields, the contributor/reliability dropdowns and Guthrie zone checkboxes.
import { computed } from 'vue';
import LookupSelect from './LookupSelect.vue';
import { GUTHRIE_ZONES, type Option, type ReconstructionDraft } from './types';

const props = defineProps<{
  contributors: Option[];
  reliability: Option[];
  loadingOptions?: boolean;
  errors?: Record<string, string>;
}>();
const model = defineModel<ReconstructionDraft>({ required: true });

const input = 'w-full border rounded px-2 py-1 text-sm';
const zones = computed(() => new Set(model.value.distribution.split(/\s+/).filter(Boolean)));
function set<K extends keyof ReconstructionDraft>(key: K, value: ReconstructionDraft[K]) {
  model.value = { ...model.value, [key]: value };
}
function setText(key: keyof ReconstructionDraft, value: string) {
  model.value = { ...model.value, [key]: value };
}
function toggleZone(zone: string) {
  const next = new Set(zones.value);
  next.has(zone) ? next.delete(zone) : next.add(zone);
  setText('distribution', GUTHRIE_ZONES.filter(z => next.has(z)).join(' '));
}
function allZones() { setText('distribution', GUTHRIE_ZONES.join(' ')); }
function noZones() { setText('distribution', ''); }
function setContributor(id: number | null) { set('contributor_id', id); }
function setReliability(id: number | null) { set('reliability_id', id); }
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="grid gap-3 md:grid-cols-2">
      <label class="text-sm">
        <span class="block font-semibold mb-1">Word <span class="text-red-600">*</span></span>
        <input :value="model.word" :class="input" aria-label="Word" placeholder="*mbúla" @input="setText('word', ($event.target as HTMLInputElement).value)" />
        <span v-if="errors?.word" class="text-xs text-red-700">{{ errors.word }}</span>
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">Word (tone)</span>
        <input :value="model.word_tone" :class="input" aria-label="Word (tone)" placeholder="*mbúla" @input="setText('word_tone', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">English</span>
        <input :value="model.english" :class="input" aria-label="English" @input="setText('english', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">French</span>
        <input :value="model.french" :class="input" aria-label="French" @input="setText('french', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">Noun class</span>
        <input :value="model.noun_class" :class="input" aria-label="Noun class" placeholder="3/4, 7/8" @input="setText('noun_class', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">Proto KK</span>
        <input :value="model.proto_kk" :class="input" aria-label="Proto KK" @input="setText('proto_kk', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">Date of entry</span>
        <input :value="model.date_of_entry" :class="input" aria-label="Date of entry" placeholder="2026-10-20 12:00:00" @input="setText('date_of_entry', ($event.target as HTMLInputElement).value)" />
      </label>
      <LookupSelect label="Contributor" :options="contributors" :loading="loadingOptions"
                    placeholder="— none —" :model-value="model.contributor_id" @update:model-value="setContributor" />
      <LookupSelect label="Reliability" :options="reliability" :loading="loadingOptions"
                    placeholder="— none —" :model-value="model.reliability_id" @update:model-value="setReliability" />
      <label class="text-sm md:col-span-2">
        <span class="block font-semibold mb-1">Note</span>
        <textarea :value="model.note" :class="input" rows="3" aria-label="Note" @input="setText('note', ($event.target as HTMLTextAreaElement).value)" />
      </label>
    </div>

    <fieldset class="border rounded p-3">
      <legend class="text-sm font-semibold px-1">Distribution (Guthrie zones)</legend>
      <div class="flex flex-wrap gap-x-3 gap-y-1">
        <label v-for="zone in GUTHRIE_ZONES" :key="zone" class="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" :checked="zones.has(zone)" :aria-label="`Zone ${zone}`" @change="toggleZone(zone)" />
          {{ zone }}
        </label>
      </div>
      <div class="flex items-center gap-2 mt-2 text-xs">
        <button type="button" class="btn btn-sm" @click="allZones">All</button>
        <button type="button" class="btn btn-sm" @click="noZones">None</button>
        <span class="opacity-60">{{ model.distribution || '—' }}</span>
      </div>
    </fieldset>
  </div>
</template>
