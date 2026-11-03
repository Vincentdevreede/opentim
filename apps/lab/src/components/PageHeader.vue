<script setup lang="ts">
import LabDivider from "./LabDivider.vue";

/** The header of a page: its title, a subtitle, controls next to them in `controls`, and actions on the right. */
defineProps<{ title: string }>();
</script>

<template>
  <header class="flex h-11 shrink-0 items-center gap-3 border-b border-line pr-3 pl-4">
    <h1 class="text-title font-semibold">{{ title }}</h1>
    <span v-if="$slots.subtitle" class="text-muted"><slot name="subtitle" /></span>
    <template v-if="$slots.controls">
      <LabDivider />
      <div class="flex items-center gap-2"><slot name="controls" /></div>
    </template>
    <div class="flex-1"></div>
    <slot />
  </header>
</template>
