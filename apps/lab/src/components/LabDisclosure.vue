<script setup lang="ts">
import LabIcon from "./LabIcon.vue";

/** A framed box that opens and closes, like technical details. `well` gives it the darkest background. */
withDefaults(defineProps<{ title: string; open?: boolean; well?: boolean }>(), { open: false, well: false });
</script>

<template>
  <details :open="open" class="group rounded-lg border border-line" :class="well ? 'bg-well' : 'bg-sunken'">
    <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-soft select-none hover:text-ink">
      <LabIcon name="chevronRight" :size="12" class="shrink-0 transition-transform group-open:rotate-90" />
      {{ title }}
    </summary>
    <div class="border-t border-line"><slot /></div>
  </details>
</template>
