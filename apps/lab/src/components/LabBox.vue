<script setup lang="ts">
import LabPanelHeader from "./LabPanelHeader.vue";

/**
 * A framed box on a page, with an optional heading. `well` gives it the darkest background, for lists inside it. The
 * `actions` slot puts actions in the heading.
 */
withDefaults(defineProps<{ title?: string; meta?: string | number; well?: boolean }>(), {
  title: undefined,
  meta: undefined,
  well: false,
});
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-line" :class="well ? 'bg-well' : 'bg-sunken'">
    <LabPanelHeader v-if="title" :title="title" :meta="meta"><slot name="actions" /></LabPanelHeader>
    <slot />
  </section>
</template>
