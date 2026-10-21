<script setup lang="ts">
// Navigation of the reconstruction form: open a reconstruction by BLR index,
// step to the previous or next one, start a new one, or open the current one
// in the public viewer.
import { ref, watch } from 'vue';
import { viewerUrl, type Neighbours } from './api';

const props = defineProps<{
  blrIndex: number | null;
  isNew: boolean;
  lookupError?: string;
  previous: Neighbours['previous'];
  next: Neighbours['next'];
}>();
const emit = defineEmits<{ open: [blrIndex: number]; new: []; go: [id: number] }>();

const index = ref('');
watch(() => [props.blrIndex, props.isNew], () => { index.value = props.isNew ? '' : String(props.blrIndex ?? ''); }, { immediate: true });

function open() {
  const n = Number(index.value.trim());
  if (Number.isSafeInteger(n) && n > 0) emit('open', n);
}
</script>

<template>
  <div class="flex flex-wrap items-end gap-3">
    <h2 class="text-xl font-semibold mr-2">Reconstruction editor</h2>
    <form class="flex items-end gap-2" @submit.prevent="open">
      <label class="text-sm">
        <span class="block font-semibold mb-1">BLR index</span>
        <input v-model="index" inputmode="numeric" class="w-28 border rounded px-2 py-1 text-sm" aria-label="BLR index" placeholder="e.g. 2881" />
      </label>
      <button class="btn btn-sm" type="submit">Open</button>
    </form>
    <div class="flex items-end gap-2" role="group" aria-label="Browse reconstructions">
      <button class="btn btn-sm" type="button" :disabled="!previous" @click="previous && emit('go', previous.id)"
              :title="previous ? `BLR ${previous.blr_index}` : 'No previous reconstruction'">← Previous</button>
      <button class="btn btn-sm" type="button" :disabled="!next" @click="next && emit('go', next.id)"
              :title="next ? `BLR ${next.blr_index}` : 'No next reconstruction'">Next →</button>
    </div>
    <button v-if="!isNew" class="btn btn-sm" type="button" @click="emit('new')">New reconstruction</button>
    <span v-if="lookupError" role="alert" class="text-sm text-red-700">{{ lookupError }}</span>
    <span class="ml-auto flex items-center gap-3 text-sm">
      <a v-if="!isNew && blrIndex != null" :href="viewerUrl(blrIndex)" target="_blank" rel="noopener"
         class="text-primary underline">View on public site ↗</a>
      <router-link class="text-primary underline" :to="{ path: '/crouton/blrcontributor' }">Manage contributors</router-link>
    </span>
  </div>
</template>
