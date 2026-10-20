<script setup lang="ts">
// The viewer's "Reconstruction" facts as an editable form, in the viewer's
// order: forms and glosses, noun class, distribution (Guthrie zones), Proto-KK,
// reliability, contributor and note. The date of entry is fixed once saved.
import { computed } from 'vue';
import LookupSelect from './LookupSelect.vue';
import { GUTHRIE_ZONES, type Option, type ReconstructionDraft } from './types';

const props = defineProps<{
  contributors: Option[];
  reliability: Option[];
  isNew: boolean;
  loadingOptions?: boolean;
  errors?: Record<string, string>;
}>();
const model = defineModel<ReconstructionDraft>({ required: true });

const input = 'w-full border rounded px-2 py-1 text-sm';
const zones = computed(() => new Set(model.value.distribution.split(/\s+/).filter(Boolean)));
function set<K extends keyof ReconstructionDraft>(key: K, value: ReconstructionDraft[K]) {
  model.value = { ...model.value, [key]: value };
}
const text = (key: keyof ReconstructionDraft) => (event: Event) => set(key, (event.target as HTMLInputElement).value);
function toggleZone(zone: string) {
  const next = new Set(zones.value);
  next.has(zone) ? next.delete(zone) : next.add(zone);
  set('distribution', GUTHRIE_ZONES.filter(z => next.has(z)).join(' '));
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="grid gap-3 grid-cols-2">
      <label class="text-sm">
        <span class="block font-semibold mb-1">Word <span class="text-red-600">*</span></span>
        <input :value="model.word" :class="[input, 'forms']" aria-label="Word" placeholder="mbúla" @input="text('word')($event)" />
        <span v-if="errors?.word" class="text-xs text-red-700">{{ errors.word }}</span>
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">Word (tone)</span>
        <input :value="model.word_tone" :class="[input, 'forms']" aria-label="Word (tone)" placeholder="mbúlà" @input="text('word_tone')($event)" />
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">English</span>
        <input :value="model.english" :class="input" aria-label="English" @input="text('english')($event)" />
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">French</span>
        <input :value="model.french" :class="input" aria-label="French" @input="text('french')($event)" />
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">Noun class</span>
        <input :value="model.noun_class" :class="input" aria-label="Noun class" placeholder="3/4, 7/8" @input="text('noun_class')($event)" />
      </label>
      <label class="text-sm">
        <span class="block font-semibold mb-1">Proto-KK</span>
        <input :value="model.proto_kk" :class="[input, 'forms']" aria-label="Proto KK" @input="text('proto_kk')($event)" />
      </label>
    </div>

    <fieldset class="border rounded p-2">
      <legend class="text-sm font-semibold px-1">Distribution (Guthrie zones)</legend>
      <div class="flex flex-wrap gap-x-3 gap-y-1">
        <label v-for="zone in GUTHRIE_ZONES" :key="zone" class="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" :checked="zones.has(zone)" :aria-label="`Zone ${zone}`" @change="toggleZone(zone)" />
          {{ zone }}
        </label>
      </div>
      <div class="flex items-center gap-2 mt-2 text-xs">
        <button type="button" class="btn btn-xs" @click="set('distribution', GUTHRIE_ZONES.join(' '))">All</button>
        <button type="button" class="btn btn-xs" @click="set('distribution', '')">None</button>
        <span class="opacity-60">{{ model.distribution || '—' }}</span>
      </div>
    </fieldset>

    <div class="grid gap-3 grid-cols-2">
      <LookupSelect label="Reliability" :options="reliability" :loading="loadingOptions"
                    placeholder="— none —" :model-value="model.reliability_id" @update:model-value="set('reliability_id', $event)" />
      <LookupSelect label="Contributor" :options="contributors" :loading="loadingOptions"
                    placeholder="— none —" :model-value="model.contributor_id" @update:model-value="set('contributor_id', $event)" />
      <label class="text-sm col-span-2">
        <span class="block font-semibold mb-1">Note</span>
        <textarea :value="model.note" :class="input" rows="3" aria-label="Note" @input="text('note')($event)" />
      </label>
      <label v-if="isNew" class="text-sm col-span-2">
        <span class="block font-semibold mb-1">Date of entry</span>
        <input :value="model.date_of_entry" :class="input" aria-label="Date of entry" placeholder="2026-10-20 12:00:00" @input="text('date_of_entry')($event)" />
      </label>
      <p v-else class="text-xs opacity-70 col-span-2">Date of entry: {{ model.date_of_entry || '—' }}</p>
      <p v-for="key in ['contributor_id', 'reliability_id'].filter(k => errors?.[k])" :key="key" class="text-xs text-red-700 col-span-2">{{ errors?.[key] }}</p>
    </div>
  </div>
</template>

<style scoped>
.forms { font-family: var(--font-forms); }
</style>
