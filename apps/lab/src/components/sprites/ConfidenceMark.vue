<script setup lang="ts">
import { FINDING_TIPS } from "../../kinds.ts";
import LabTip from "../LabTip.vue";

/**
 * How sure a finding is: a round dot when checked, a diamond when inferred, a hollow circle when unresolved. Under the
 * pointer it lights up and explains itself, in `title` or else in the usual words. With `focusable` the keyboard reaches
 * it too; leave it off for a mark inside a button, and give the button the words instead.
 */
withDefaults(
  defineProps<{ confidence: "checked" | "inferred" | "unresolved"; title?: string; focusable?: boolean }>(),
  {
    title: undefined,
    focusable: false,
  },
);

const MARKS = {
  checked: "rounded-full bg-decoded",
  inferred: "rotate-45 rounded-[1px] border-[1.5px] border-hypothesis",
  unresolved: "rounded-full border-[1.5px] border-faint",
};
</script>

<template>
  <span class="inline-flex shrink-0">
    <LabTip :text="title ?? FINDING_TIPS[confidence]" :focusable="focusable">
      <!-- The hover area is larger than the mark, without taking more room. -->
      <span class="-m-[5px] grid size-4 cursor-help place-items-center rounded-full transition-colors hover:bg-ink/12">
        <span class="box-border inline-block size-1.5" :class="MARKS[confidence]"></span>
      </span>
    </LabTip>
  </span>
</template>
