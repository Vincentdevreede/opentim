<script setup lang="ts">
import type { IconName } from "../icons.ts";
import LabIcon from "./LabIcon.vue";
import LabButton from "./LabButton.vue";

/** What a page shows when it has nothing to show, with a link to Import when no files are loaded yet. */
defineProps<{ icon: IconName; title: string; text: string; importLink?: boolean }>();
</script>

<template>
  <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
    <LabIcon :name="icon" :size="28" :stroke="1.75" class="text-faint" />
    <p class="text-title font-semibold">{{ title }}</p>
    <p class="text-muted">{{ text }}</p>
    <LabButton v-if="importLink" to="/" variant="primary" class="mt-1">Go to Import</LabButton>
  </div>
</template>
