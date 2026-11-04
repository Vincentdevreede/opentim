<script setup lang="ts">
import LabTip from "../LabTip.vue";

/**
 * How sure a finding is: a round dot when checked, a diamond when inferred, a hollow circle when unresolved. Under the
 * pointer it lights up and explains itself, in `title` or else in the usual words.
 */
defineProps<{ confidence: "checked" | "inferred" | "unresolved"; title?: string }>();

const MARKS = {
  checked: { class: "rounded-full bg-decoded", title: "Checked: follows directly from the instructions" },
  inferred: {
    class: "rotate-45 rounded-[1px] border-[1.5px] border-hypothesis",
    title: "Inferred: follows from the analysis, with the assumptions it lists",
  },
  unresolved: { class: "rounded-full border-[1.5px] border-faint", title: "Unresolved: the analysis can’t tell" },
};
</script>

<template>
  <span class="inline-flex shrink-0">
    <LabTip :text="title ?? MARKS[confidence].title" :focusable="false">
      <!-- The hover area is larger than the mark, without taking more room. -->
      <span class="-m-[5px] grid size-4 cursor-help place-items-center rounded-full transition-colors hover:bg-ink/12">
        <span class="box-border inline-block size-1.5" :class="MARKS[confidence].class"></span>
      </span>
    </LabTip>
  </span>
</template>
