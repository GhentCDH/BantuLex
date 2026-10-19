<script setup lang="ts">
// One step of the bulk import wizard: an accordion panel with a numbered
// header, a status chip and a one-line summary of what was chosen.
export type StepStatus = 'done' | 'attention' | 'todo';
// `locked`: an earlier step is not complete yet, so this step cannot be opened.
defineProps<{ n: number; title: string; status: StepStatus; summary?: string; open: boolean; locked?: boolean }>();
defineEmits<{ (e: 'toggle'): void }>();
const CHIP: Record<StepStatus, [string, string]> = {
  done: ['Done', 'bg-green-100 text-green-800'],
  attention: ['Needs attention', 'bg-amber-100 text-amber-800'],
  todo: ['Not started', 'bg-gray-100 text-gray-600'],
};
</script>

<template>
  <section class="border rounded" :class="open ? 'border-blue-400 shadow-sm' : locked ? 'opacity-60' : ''">
    <h3>
      <button type="button" class="w-full flex items-center gap-3 px-4 py-3 text-left disabled:cursor-not-allowed" :aria-expanded="open"
              :aria-controls="`bulk-step-${n}`" :disabled="locked" :title="locked ? `Complete step ${n - 1} first` : undefined" @click="$emit('toggle')">
        <span class="flex-none w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold"
              :class="status === 'done' ? 'bg-green-600 text-white' : open ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'">
          {{ status === 'done' ? '✓' : n }}
        </span>
        <span class="font-semibold">{{ title }}</span>
        <span class="text-xs px-2 py-0.5 rounded-full" :class="CHIP[status][1]">{{ CHIP[status][0] }}</span>
        <span v-if="summary && !open" class="text-sm opacity-70 truncate">{{ summary }}</span>
        <span class="ml-auto text-sm opacity-60">{{ locked ? '🔒' : open ? '▲' : '▼' }}</span>
      </button>
    </h3>
    <div v-show="open" :id="`bulk-step-${n}`" class="px-4 pb-4">
      <slot />
    </div>
  </section>
</template>
