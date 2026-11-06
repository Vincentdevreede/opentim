<script setup lang="ts">
import LabIcon from "./LabIcon.vue";
import LabTip from "./LabTip.vue";

/**
 * An info icon that explains something in a tip. It lights up on its own under the pointer or keyboard focus, so it
 * is clear the tip belongs to the icon and not to the row it is in.
 */
defineProps<{ text: string }>();
</script>

<template>
  <span class="inline-flex shrink-0">
    <LabTip :text="text">
      <span
        class="grid size-5 cursor-help place-items-center rounded-full text-faint transition-colors hover:bg-ink/12 hover:text-ink in-focus-visible:bg-ink/12 in-focus-visible:text-ink"
      >
        <LabIcon name="info" :size="14" :stroke="2" />
      </span>
    </LabTip>
  </span>
</template>
