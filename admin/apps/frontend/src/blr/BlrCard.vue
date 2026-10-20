<script setup lang="ts">
// A card of the public BLR viewer: a small uppercase title over its content.
defineProps<{ title: string }>();
</script>

<template>
  <section class="blr-card" :aria-label="title">
    <div class="blr-card-head">
      <h3>{{ title }}</h3>
      <slot name="actions" />
    </div>
    <slot />
  </section>
</template>

<style scoped>
.blr-card { padding: 1rem 1.1rem; background: #fff; border: 1px solid #dcd7cb; border-radius: 8px; }
.blr-card-head { display: flex; align-items: center; gap: .75rem; margin-bottom: .6rem; }
.blr-card-head h3 { font-size: .8rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #646a73; }
.blr-card-head :slotted(*) { margin-left: auto; }
</style>
