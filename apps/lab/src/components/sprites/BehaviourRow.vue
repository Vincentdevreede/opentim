<script setup lang="ts">
import type { Confidence } from "@opentim/content";
import { ref } from "vue";
import LabInfo from "../LabInfo.vue";
import ConfidenceMark from "./ConfidenceMark.vue";

/** One line of the behaviour tab, with a tip, that opens to show the paths it stands for. */
defineProps<{ confidence: Confidence; tip: string; highlight?: boolean }>();
const open = ref(false);
</script>

<template>
  <div class="flex flex-col border-t border-line-soft" :class="highlight && 'bg-accent/6'">
    <div
      class="flex min-h-7 cursor-pointer items-center gap-2 py-0.5 text-ui hover:bg-hover"
      role="button"
      tabindex="0"
      :aria-expanded="open"
      @click="open = !open"
      @keydown.enter.space.prevent="open = !open"
    >
      <ConfidenceMark :confidence="confidence" />
      <slot />
      <LabInfo :text="tip" @click.stop @keydown.stop />
    </div>
    <div v-if="$slots.below" class="-mt-1 cursor-pointer pr-5 pb-1 pl-3.5" @click="open = !open">
      <slot name="below" />
    </div>
    <div v-if="open" class="flex flex-col gap-1.5 pt-0.5 pb-2 pl-3.5 font-mono text-meta text-muted">
      <slot name="detail" />
    </div>
  </div>
</template>
