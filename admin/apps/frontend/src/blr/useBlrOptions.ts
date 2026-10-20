// The choices of the reconstruction form: contributors, reliability values and
// the existing values per sound-structure slot, loaded once per page.
import { onMounted, ref } from 'vue';
import * as api from './api';
import type { Option } from './types';

export function useBlrOptions() {
  const contributors = ref<Option[]>([]);
  const reliability = ref<Option[]>([]);
  const structure = ref<Record<string, string[]>>({});
  const siteUrl = ref<string | null>(null);
  const loading = ref(true);
  const error = ref('');

  onMounted(async () => {
    try {
      [structure.value, contributors.value, reliability.value, siteUrl.value] = await Promise.all([
        api.structureOptions(), api.contributors(), api.reliability(), api.publicSiteUrl(),
      ]);
    } catch (e) {
      error.value = api.errorMessage(e);
    } finally {
      loading.value = false;
    }
  });

  return { contributors, reliability, structure, siteUrl, loading, error };
}
