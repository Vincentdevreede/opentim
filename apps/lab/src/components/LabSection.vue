<script setup lang="ts">
import PanelTitle from "./PanelTitle.vue";

/** A section inside a panel: a small title, an optional action on the right of it, and the content below. */
defineProps<{ title: string }>();
</script>

<template>
  <section class="flex flex-col gap-1.5">
    <div class="flex min-h-5 items-center gap-2">
      <PanelTitle>{{ title }}</PanelTitle>
      <template v-if="$slots.action">
        <div class="flex-1"></div>
        <slot name="action" />
      </template>
    </div>
    <slot />
  </section>
</template>
