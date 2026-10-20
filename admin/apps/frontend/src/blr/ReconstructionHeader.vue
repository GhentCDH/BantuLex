<script setup lang="ts">
// The heading of the public BLR viewer, live while editing: "BLR n", the
// starred form (tone form preferred) and the glosses in curly quotes.
import { computed } from 'vue';

const props = defineProps<{
  blrIndex: number | null;
  isNew: boolean;
  word: string;
  wordTone: string;
  english: string;
  french: string;
}>();

const form = computed(() => (props.wordTone || props.word).trim());
</script>

<template>
  <header class="detail-head">
    <p class="eyebrow">
      BLR {{ blrIndex ?? '…' }}<span v-if="isNew"> — new, the index is assigned on save</span>
    </p>
    <h2 class="reconstruction" :class="{ placeholder: !form }">*{{ form || '…' }}</h2>
    <p v-if="english || french" class="glosses">
      <span v-if="english" lang="en">‘{{ english }}’</span>
      <span v-if="french" lang="fr" class="muted">‘{{ french }}’</span>
    </p>
  </header>
</template>

<style scoped>
.detail-head { padding: .25rem 0 .5rem; }
.eyebrow { margin: 0 0 .25rem; font-size: .85rem; font-weight: 600; color: #646a73; }
.reconstruction { font: 600 clamp(1.8rem, 3vw, 2.6rem) var(--font-forms); overflow-wrap: anywhere; }
.placeholder { opacity: .35; }
.glosses { display: flex; flex-wrap: wrap; gap: .25rem 1rem; margin: .5rem 0 0; font-size: 1.1rem; }
.muted { color: #646a73; }
</style>
