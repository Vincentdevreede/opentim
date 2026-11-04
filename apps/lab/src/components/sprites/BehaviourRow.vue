<script setup lang="ts">
import type { Confidence } from "@opentim/content";
import { ref } from "vue";
import LabInfo from "../LabInfo.vue";
import ConfidenceMark from "./ConfidenceMark.vue";

/**
 * One line of the behaviour tab, with a tip, that opens to show the paths it stands for. It spans the whole panel, so
 * its hover does too; `indent` moves its content in under a routine or state. Its slots get `open`, so text that is cut
 * short on the closed row can continue in full when it opens.
 */
defineProps<{ confidence: Confidence; tip: string; highlight?: boolean; indent?: boolean }>();
const open = ref(false);
/** Opens or closes the row, unless the click ends a text selection, like copying an instruction. */
function toggle() {
  if (getSelection()?.toString()) return;
  open.value = !open.value;
}
</script>

<template>
  <!-- The line, the condition under it and the opened details all open or close the row, so they light up together. -->
  <div class="flex flex-col border-t border-line-soft hover:bg-hover" :class="highlight && 'bg-accent/6'">
    <div
      class="cursor-pointer"
      role="button"
      tabindex="0"
      :aria-expanded="open"
      @click="toggle"
      @keydown.enter.space.prevent="open = !open"
    >
      <!--
        One line height, open or closed, with the mark and the tip on the first line: opening only adds lines below it,
        so the text continues where it was.
      -->
      <div class="flex items-start gap-2 py-[5px] text-ui leading-[18px]" :class="indent ? 'pr-3 pl-[30px]' : 'px-3'">
        <span class="flex h-[18px] shrink-0 items-center"><ConfidenceMark :confidence="confidence" /></span>
        <slot :open="open" />
        <span class="flex h-[18px] shrink-0 items-center">
          <LabInfo :text="tip" @click.stop @keydown.stop />
        </span>
      </div>
      <div v-if="$slots.below" class="-mt-1 pr-8 pb-1 leading-[18px]" :class="indent ? 'pl-[44px]' : 'pl-[26px]'">
        <slot name="below" :open="open" />
      </div>
    </div>
    <div
      v-if="open && $slots.detail"
      class="flex cursor-pointer flex-col gap-1.5 pt-0.5 pr-3 pb-2 font-mono text-meta text-muted"
      :class="indent ? 'pl-[44px]' : 'pl-[26px]'"
      @click="toggle"
    >
      <slot name="detail" />
    </div>
  </div>
</template>
