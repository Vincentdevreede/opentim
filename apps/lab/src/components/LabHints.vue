<script setup lang="ts">
import LabKbd from "./LabKbd.vue";

/** Keyboard hints in one line, like `← → step · Space play`. A hint without keys is plain text. */
defineProps<{ hints: readonly (readonly [keys: readonly string[], text: string])[] }>();
</script>

<template>
  <span class="inline-flex items-center gap-1 text-meta whitespace-nowrap text-muted">
    <template v-for="([keys, text], i) in hints" :key="i">
      <span v-if="i" aria-hidden="true">·</span>
      <LabKbd v-for="k in keys" :key="k">{{ k }}</LabKbd>
      <span>{{ text }}</span>
    </template>
  </span>
</template>
