<script setup lang="ts">
import type { IconName } from "../icons.ts";
import LabButton from "./LabButton.vue";
import LabIcon from "./LabIcon.vue";

export type OpenTarget = "files" | "sprites" | "levels" | "audio";

/**
 * The bar right under the header of a details panel that opens the same file on another page: Files for its bytes,
 * Sprites for its images, Levels for its drawing, Audio for its sounds. Every page shows it in the same place. The slot adds buttons that
 * open a related file, like the sprite sheet of a part.
 */
defineProps<{ targets: readonly OpenTarget[] }>();
const emit = defineEmits<{ open: [target: OpenTarget] }>();

const TARGETS: Record<OpenTarget, { label: string; icon: IconName }> = {
  files: { label: "Open in Files", icon: "files" },
  sprites: { label: "Open in Sprites", icon: "sprites" },
  levels: { label: "Open in Levels", icon: "levels" },
  audio: { label: "Open in Audio", icon: "audio" },
};
</script>

<template>
  <div v-if="targets.length || $slots.default" class="flex shrink-0 flex-wrap gap-2 border-b border-line px-3 py-2.5">
    <LabButton v-for="t in targets" :key="t" @click="emit('open', t)"
      ><LabIcon :name="TARGETS[t].icon" />{{ TARGETS[t].label }}</LabButton
    >
    <slot />
  </div>
</template>
