<script setup lang="ts">
// Create a BLR reconstruction with its sound structures and the reflexes that
// belong to it. Everything is saved by POST /api/blr in one transaction.
import { computed, onMounted, ref } from 'vue';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import axios from 'axios';
import { NotificationService } from '@ghentcdh/ui';
import ReconstructionForm from './ReconstructionForm.vue';
import ReflexPicker from './ReflexPicker.vue';
import SoundStructureForm from './SoundStructureForm.vue';
import { emptyReconstruction, emptyStructure, type Option, type ReconstructionDraft, type ReflexRow } from './types';

const router = useRouter();
const reconstruction = ref<ReconstructionDraft>(emptyReconstruction());
const structure = ref<Record<string, string | null>>(emptyStructure());
const selected = ref<ReflexRow[]>([]);
const nextIndex = ref<number | null>(null);
const contributors = ref<Option[]>([]);
const reliability = ref<Option[]>([]);
const structureOptions = ref<Record<string, string[]>>({});
const loadingOptions = ref(true);
const loadError = ref('');
const saving = ref(false);
const errors = ref<Record<string, string>>({});
const formError = ref('');
let saved = false;

const selectedCount = computed(() => selected.value.length);

onMounted(async () => {
  try {
    const [index, options, contrib, reliab] = await Promise.all([
      axios.get('/api/blr/next-index'),
      axios.get('/api/blr/options'),
      axios.get('/api/blrcontributor', { params: { pageSize: 500, sort: 'name' } }),
      axios.get('/api/blrreliability', { params: { pageSize: 500, sort: 'value' } }),
    ]);
    nextIndex.value = index.data.blr_index ?? null;
    structureOptions.value = options.data ?? {};
    contributors.value = (contrib.data.data ?? []).map((r: any) => ({ value: r.id, label: r.name?.trim() || `#${r.id}` }));
    reliability.value = (reliab.data.data ?? []).map((r: any) => ({ value: r.id, label: r.value?.trim() || `#${r.id}` }));
  } catch (e: any) {
    loadError.value = e?.response?.data?.message ?? e.message;
  } finally {
    loadingOptions.value = false;
  }
});

function validate() {
  const next: Record<string, string> = {};
  if (!reconstruction.value.word.trim()) next.word = 'Word is required.';
  if (!selected.value.length) next.reflex_ids = 'Select at least one reflex.';
  errors.value = next;
  return Object.keys(next).length === 0;
}

async function save() {
  formError.value = '';
  if (!validate()) return;
  saving.value = true;
  try {
    const { data } = await axios.post('/api/blr', {
      reconstruction: reconstruction.value,
      structure: structure.value,
      reflex_ids: selected.value.map(r => r.id),
    });
    saved = true;
    NotificationService.success(`Reconstruction ${data.blr_index} created with ${data.linked} reflex${data.linked === 1 ? '' : 'es'}.`);
    await router.push({ path: '/crouton/reconstruction', query: { id: String(data.id), event: 'view' } });
  } catch (e: any) {
    const body = e?.response?.data;
    const fields: Record<string, string> = {};
    for (const error of body?.errors ?? []) {
      const field = String(error.field ?? '').split('.').pop() || 'form';
      if (field === 'reflex_ids' || field === 'form') formError.value = error.message;
      else fields[field] = error.message;
    }
    errors.value = fields;
    if (!formError.value) formError.value = body?.message ?? e.message ?? 'The reconstruction was not saved.';
    NotificationService.error(formError.value);
  } finally {
    saving.value = false;
  }
}

onBeforeRouteLeave(() => {
  if (saved) return true;
  const dirty = selected.value.length > 0
    || reconstruction.value.word !== ''
    || Object.values(structure.value).some(v => v != null);
  return dirty ? confirm('Discard this new reconstruction?') : true;
});
</script>

<template>
  <section class="w-full px-4 py-3 flex flex-col gap-3" aria-label="New reconstruction">
    <header class="flex flex-wrap items-baseline gap-x-3">
      <h2 class="text-xl font-semibold">New reconstruction</h2>
      <span class="text-sm opacity-70">
        BLR index <strong>{{ nextIndex ?? '…' }}</strong> — assigned on save
      </span>
      <router-link class="text-sm text-primary underline ml-auto" :to="{ path: '/crouton/blrcontributor' }">Manage contributors</router-link>
    </header>

    <p v-if="loadError" role="alert" class="text-sm text-red-700">{{ loadError }}</p>

    <div class="grid gap-3 xl:grid-cols-2 items-start">
      <div class="flex flex-col gap-3">
        <section class="border rounded p-3" aria-label="Reconstruction">
          <h3 class="font-semibold text-sm mb-2">Reconstruction</h3>
          <ReconstructionForm v-model="reconstruction" :contributors="contributors" :reliability="reliability"
                              :loading-options="loadingOptions" :errors="errors" />
        </section>
        <SoundStructureForm v-model="structure" :options="structureOptions" :loading="loadingOptions" />
      </div>

      <ReflexPicker v-model="selected" />
    </div>

    <div class="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-white/95 py-2">
      <span class="text-sm">{{ selectedCount.toLocaleString() }} reflex{{ selectedCount === 1 ? '' : 'es' }} selected</span>
      <span v-if="errors.reflex_ids" role="alert" class="text-sm text-red-700">{{ errors.reflex_ids }}</span>
      <span v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</span>
      <button class="btn btn-primary ml-auto" type="button" :disabled="saving || loadingOptions" @click="save">
        {{ saving ? 'Saving…' : 'Create reconstruction' }}
      </button>
    </div>
  </section>
</template>
