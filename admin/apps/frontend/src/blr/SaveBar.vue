<script setup lang="ts">
// The sticky footer of the reconstruction form: what will be saved, the
// general error and the save button.
defineProps<{
  isNew: boolean;
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  count: number;
  error?: string;
}>();
const emit = defineEmits<{ save: [] }>();
</script>

<template>
  <div class="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-white/95 py-2">
    <span class="text-sm">{{ count.toLocaleString() }} reflex{{ count === 1 ? '' : 'es' }} {{ isNew ? 'selected' : 'linked' }}</span>
    <span v-if="!isNew && dirty" class="text-sm text-amber-700">Unsaved changes</span>
    <span v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</span>
    <button class="btn btn-primary ml-auto" type="button" :disabled="saving || disabled || (!isNew && !dirty)" @click="emit('save')">
      {{ saving ? 'Saving…' : isNew ? 'Create reconstruction' : 'Save changes' }}
    </button>
  </div>
</template>
