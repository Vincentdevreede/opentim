<script setup lang="ts">
import PanelTitle from "./PanelTitle.vue";

/**
 * The heading of a section in a list, which stays in view while the list scrolls, with a count on the right. `hint`
 * explains the section on hover.
 */
defineProps<{ title: string; meta?: string; hint?: string }>();
</script>

<template>
  <div
    :title="hint"
    class="sticky top-0 z-10 flex h-10 items-center gap-1.5 border-b border-line bg-sunken/95 px-3 backdrop-blur"
  >
    <PanelTitle>{{ title }}</PanelTitle>
    <div class="flex-1"></div>
    <span v-if="meta" class="font-mono text-meta text-muted">{{ meta }}</span>
  </div>
</template>
