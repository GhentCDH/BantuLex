// State of the reconstruction form: one reconstruction (new or loaded), its
// sound structure and its linked reflexes, with loading, saving and the
// unsaved-changes check. No markup and no routing.
import { computed, ref } from 'vue';
import * as api from './api';
import { emptyReconstruction, emptyStructure, toDraft, type ReconstructionDraft, type ReflexRow, type SaveResult } from './types';

export function useReconstruction() {
  /** The id being edited; null for a new reconstruction. */
  const id = ref<number | null>(null);
  /** The BLR index of the loaded reconstruction, or the one a new reconstruction will get. */
  const blrIndex = ref<number | null>(null);
  const reconstruction = ref<ReconstructionDraft>(emptyReconstruction());
  const structure = ref<Record<string, string | null>>(emptyStructure());
  const reflexes = ref<ReflexRow[]>([]);
  /** The reflexes linked when loaded; those left out of `reflexes` are unlinked on save. */
  const original = ref<ReflexRow[]>([]);
  const loading = ref(false);
  const loadError = ref('');
  const saving = ref(false);
  const errors = ref<Record<string, string>>({});
  const formError = ref('');

  const isNew = computed(() => id.value == null);
  const state = () => JSON.stringify({
    r: reconstruction.value,
    s: structure.value,
    ids: reflexes.value.map(r => r.id).sort((a, b) => a - b),
  });
  const snapshot = ref(state());
  const dirty = computed(() => state() !== snapshot.value);
  /** Accept the current state as saved, e.g. after the user chose to discard it. */
  const markClean = () => { snapshot.value = state(); };

  /** Load a reconstruction, or reset to an empty new one (`target` null). */
  async function load(target: number | null) {
    loading.value = true;
    loadError.value = '';
    errors.value = {};
    formError.value = '';
    try {
      if (target == null) {
        id.value = null;
        reconstruction.value = emptyReconstruction();
        structure.value = emptyStructure();
        reflexes.value = [];
        original.value = [];
        blrIndex.value = await api.nextIndex();
      } else {
        const record = await api.getReconstruction(target);
        id.value = record.reconstruction.id;
        blrIndex.value = record.reconstruction.blr_index;
        reconstruction.value = toDraft(record.reconstruction);
        structure.value = { ...emptyStructure(), ...record.structure };
        reflexes.value = record.reflexes;
        original.value = record.reflexes;
      }
    } catch (e) {
      loadError.value = api.errorMessage(e);
    } finally {
      markClean();
      loading.value = false;
    }
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!reconstruction.value.word.trim()) next.word = 'Word is required.';
    errors.value = next;
    formError.value = isNew.value && !reflexes.value.length ? 'Select at least one reflex.' : '';
    return !Object.keys(next).length && !formError.value;
  }

  /** Save and reload; null when the input or the API refused it (see `errors` and `formError`). */
  async function save(): Promise<SaveResult | null> {
    if (!validate()) return null;
    saving.value = true;
    try {
      const result = await api.saveReconstruction(id.value, {
        reconstruction: reconstruction.value,
        structure: structure.value,
        reflex_ids: reflexes.value.map(r => r.id),
      });
      await load(result.id);
      return result;
    } catch (e) {
      const error = api.saveError(e);
      errors.value = error.fields;
      formError.value = error.message;
      return null;
    } finally {
      saving.value = false;
    }
  }

  return {
    id, blrIndex, reconstruction, structure, reflexes, original,
    loading, loadError, saving, errors, formError,
    isNew, dirty, markClean, load, save,
  };
}
