<script setup lang="ts">
/** How sure a finding is: a round dot when checked, a diamond when inferred, a hollow circle when unresolved. */
defineProps<{ confidence: "checked" | "inferred" | "unresolved" }>();

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
  <span
    class="box-border inline-block size-1.5 shrink-0"
    :class="MARKS[confidence].class"
    :title="MARKS[confidence].title"
  ></span>
</template>
