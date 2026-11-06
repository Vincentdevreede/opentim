<script setup lang="ts">
import type { Confidence } from "@opentim/content";
import { onBeforeUnmount, onMounted, onUpdated, ref, useId, useSlots, useTemplateRef } from "vue";
import { FINDING_TIPS } from "../../kinds.ts";
import LabInfo from "../LabInfo.vue";
import ConfidenceMark from "./ConfidenceMark.vue";

/**
 * One line of the behaviour tab, with a tip, that opens to show the paths it stands for. It spans the whole panel, so
 * its hover does too; `indent` moves its content in under a routine or state. Its slots get `open`, so text that is cut
 * short on the closed row can continue in full when it opens.
 *
 * Like the routine rows, the toggle holds no other controls: it is a button laid under the line, named by the line's
 * text, while the line's own controls (like a frame to show) sit above it and the tip sits beside it. A row only opens
 * when that shows more: details, or text the closed line cuts short.
 */
defineProps<{ confidence: Confidence; tip: string; highlight?: boolean; indent?: boolean }>();
const open = ref(false);
const lineId = useId();
const slots = useSlots();
const line = useTemplateRef<HTMLElement>("line");
/** True when the closed line cuts text short, in the slots' `truncate` or `line-clamp` text. */
const cut = ref(false);
function measure() {
  const el = line.value;
  cut.value =
    !!el &&
    [...el.querySelectorAll<HTMLElement>(".truncate, [class*='line-clamp']")].some(
      (t) => t.scrollWidth > t.clientWidth || t.scrollHeight > t.clientHeight,
    );
}
// Opening and closing and a resize of the panel change the line's size, so it is measured again then. New text in a
// reused row can keep the size, so it is measured again after every update too.
const observer = new ResizeObserver(measure);
onMounted(() => line.value && observer.observe(line.value));
onUpdated(measure);
onBeforeUnmount(() => observer.disconnect());
/**
 * Whether opening the row shows more. An open row can always close. A function rather than a computed, because the
 * slots aren't reactive: a reused row can gain or lose its details, and the render asks again each time.
 */
const expandable = () => open.value || cut.value || !!slots.detail;
/** Opens or closes the row, unless the click ends a text selection, like copying an instruction. */
function toggle() {
  if (!expandable() || getSelection()?.toString()) return;
  open.value = !open.value;
}
</script>

<template>
  <!-- The line, the condition under it and the opened details all open or close the row, so they light up together. -->
  <div class="relative flex flex-col border-t border-line-soft hover:bg-hover" :class="highlight && 'bg-accent/6'">
    <div class="relative" :class="expandable() && 'cursor-pointer'" @click="toggle">
      <button
        v-if="expandable()"
        type="button"
        class="absolute inset-0 cursor-pointer focus-visible:-outline-offset-2"
        :aria-expanded="open"
        :aria-labelledby="lineId"
        :aria-description="FINDING_TIPS[confidence]"
        @click.stop="open = !open"
      ></button>
      <div :id="lineId" ref="line" class="relative">
        <!--
          One line height, open or closed, with the mark and the tip on the first line: opening only adds lines below
          it, so the text continues where it was.
        -->
        <div class="flex items-start gap-2 py-[5px] text-ui leading-[18px]" :class="indent ? 'pr-3 pl-[30px]' : 'px-3'">
          <span class="flex h-[18px] shrink-0 items-center"
            ><ConfidenceMark :confidence="confidence" :focusable="!expandable()"
          /></span>
          <slot :open="open" />
          <!-- Keeps room for the tip, which sits beside the toggle rather than in it. -->
          <span class="w-5 shrink-0" aria-hidden="true"></span>
        </div>
        <div v-if="$slots.below" class="-mt-1 pr-8 pb-1 leading-[18px]" :class="indent ? 'pl-[44px]' : 'pl-[26px]'">
          <slot name="below" :open="open" />
        </div>
      </div>
    </div>
    <span class="absolute top-[5px] right-3 flex h-[18px] items-center">
      <LabInfo :text="tip" />
    </span>
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
