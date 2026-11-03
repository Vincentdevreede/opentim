<script setup lang="ts">
import { BACKGROUND_CLASSES, type Background } from "../backgrounds.ts";
import LabTag from "../LabTag.vue";

/** The large view of a sprite, centred on a background, with tags in its corners. */
defineProps<{ background: Background }>();
</script>

<template>
  <div class="relative flex min-h-0 flex-1 overflow-auto" :class="BACKGROUND_CLASSES[background]">
    <div class="m-auto p-10"><slot /></div>
    <LabTag v-if="$slots.topLeft" class="absolute top-2 left-2"><slot name="topLeft" /></LabTag>
    <LabTag v-if="$slots.topRight" class="absolute top-2 right-2"><slot name="topRight" /></LabTag>
    <LabTag v-if="$slots.bottomLeft" class="absolute bottom-2 left-2 flex items-center gap-1.5">
      <slot name="bottomLeft" />
    </LabTag>
  </div>
</template>
