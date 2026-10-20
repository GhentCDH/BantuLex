<script setup lang="ts">
// The reconstruction form (/admin/crouton/reconstruction-form): create a BLR
// reconstruction, or edit one (?id=<id> or ?blr=<BLR index>), laid out like the
// public BLR viewer. This page only connects the route, the composables and
// the components; every save is one transaction of the BLR API.
import { ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { NotificationService } from '@ghentcdh/ui';
import BlrCard from './BlrCard.vue';
import LinkedReflexes from './LinkedReflexes.vue';
import ReconstructionFields from './ReconstructionFields.vue';
import ReconstructionHeader from './ReconstructionHeader.vue';
import ReconstructionToolbar from './ReconstructionToolbar.vue';
import ReflexPicker from './ReflexPicker.vue';
import SaveBar from './SaveBar.vue';
import SoundStructureForm from './SoundStructureForm.vue';
import { errorMessage, findByIndex } from './api';
import { useBlrOptions } from './useBlrOptions';
import { useReconstruction } from './useReconstruction';

const route = useRoute();
const router = useRouter();
const options = useBlrOptions();
const form = useReconstruction();
const { id, blrIndex, reconstruction, structure, reflexes, original, isNew, dirty } = form;
const lookupError = ref('');

const queryId = () => {
  const n = Number(route.query.id);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Follow the query: ?blr= is resolved to ?id=, ?id= is loaded, neither is a new reconstruction. */
async function fromRoute() {
  if (route.query.blr != null) {
    const index = Number(route.query.blr);
    try {
      const target = await findByIndex(index);
      await router.replace({ query: { id: String(target) } });
    } catch (e) {
      lookupError.value = errorMessage(e);
      await router.replace({ query: {} });
    }
    return;
  }
  const target = queryId();
  if (target === id.value && target != null) return; // already loaded, e.g. right after a save
  await form.load(target);
}
watch(() => [route.query.id, route.query.blr], fromRoute, { immediate: true });

function open(index: number) {
  lookupError.value = '';
  router.push({ query: { blr: String(index) } });
}
function startNew() {
  lookupError.value = '';
  router.push({ query: {} });
}

async function save() {
  const wasNew = isNew.value;
  const result = await form.save();
  if (!result) {
    NotificationService.error(form.formError.value || 'The reconstruction was not saved.');
    return;
  }
  const reflexCount = (n: number) => `${n} reflex${n === 1 ? '' : 'es'}`;
  NotificationService.success(wasNew
    ? `Reconstruction ${result.blr_index} created with ${reflexCount(result.linked)}.`
    : `Reconstruction ${result.blr_index} saved: ${reflexCount(result.linked)} linked, ${result.unlinked} unlinked.`);
  if (queryId() !== result.id) await router.replace({ query: { id: String(result.id) } });
}

/** Ask once before unsaved changes are dropped, then let the navigation through. */
function confirmDiscard() {
  if (!dirty.value) return true;
  if (!confirm('Discard unsaved changes to this reconstruction?')) return false;
  form.markClean();
  return true;
}
onBeforeRouteLeave(confirmDiscard);
onBeforeRouteUpdate(confirmDiscard);
</script>

<template>
  <section class="reconstruction-page w-full px-4 py-3 flex flex-col gap-3" aria-label="Reconstruction form">
    <ReconstructionToolbar :blr-index="blrIndex" :is-new="isNew"
                           :lookup-error="lookupError" @open="open" @new="startNew" />

    <p v-if="form.loadError.value || options.error.value" role="alert" class="text-sm text-red-700">
      {{ form.loadError.value || options.error.value }}
    </p>

    <div class="blr-layout" :class="{ 'opacity-60 pointer-events-none': form.loading.value }">
      <div class="blr-side">
        <ReconstructionHeader :blr-index="blrIndex" :is-new="isNew" :word="reconstruction.word" :word-tone="reconstruction.word_tone"
                              :english="reconstruction.english" :french="reconstruction.french" />
        <BlrCard title="Sound structure">
          <SoundStructureForm v-model="structure" :options="options.structure.value" :loading="options.loading.value" />
        </BlrCard>
        <BlrCard title="Reconstruction">
          <ReconstructionFields v-model="reconstruction" :contributors="options.contributors.value" :reliability="options.reliability.value"
                                :is-new="isNew" :loading-options="options.loading.value" :errors="form.errors.value" />
        </BlrCard>
      </div>

      <section class="blr-results" aria-label="Reflexes">
        <h3 class="section-title">Reflexes <span class="text-sm font-normal opacity-70">{{ reflexes.length.toLocaleString() }} linked</span></h3>
        <LinkedReflexes v-model="reflexes" :original="original" />
        <ReflexPicker v-model="reflexes" :owner-id="id" />
      </section>
    </div>

    <SaveBar :is-new="isNew" :dirty="dirty" :saving="form.saving.value" :disabled="form.loading.value || options.loading.value"
             :count="reflexes.length" :error="form.formError.value" @save="save" />
  </section>
</template>

<style scoped>
.reconstruction-page { --font-forms: "Charis SIL", "Gentium Plus", "Noto Serif", "DejaVu Serif", Georgia, serif; }
/* The viewer's two columns: the reconstruction beside its reflexes. */
.blr-layout { display: grid; gap: 1.5rem; align-items: start; }
@media (min-width: 1280px) { .blr-layout { grid-template-columns: minmax(25rem, 32rem) minmax(0, 1fr); } }
.blr-side, .blr-results { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.section-title { font-size: 1.15rem; font-weight: 600; }
</style>
