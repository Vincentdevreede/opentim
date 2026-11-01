<script setup lang="ts">
import LabToolbar from "./LabToolbar.vue";
import PanelTitle from "./PanelTitle.vue";

/** The heading of a panel: its title, an optional count or name after it, and actions on the right in the slot. */
defineProps<{ title: string; meta?: string | number }>();
</script>

<template>
  <LabToolbar>
    <PanelTitle>{{ title }}</PanelTitle>
    <span v-if="meta !== undefined" class="min-w-0 truncate font-mono text-meta text-muted">{{ meta }}</span>
    <template v-if="$slots.default">
      <div class="flex-1"></div>
      <slot />
    </template>
  </LabToolbar>
</template>
