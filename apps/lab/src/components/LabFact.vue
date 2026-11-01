<script setup lang="ts">
/**
 * A row of `LabFacts`: a muted label and its value. Values are monospace, unless `prose` says the value is a sentence.
 * The `label` slot replaces the label text, like with a badge; the `note` slot puts a note after the value.
 */
withDefaults(defineProps<{ label?: string; title?: string; align?: "left" | "right"; prose?: boolean }>(), {
  label: "",
  title: undefined,
  align: "left",
  prose: false,
});
</script>

<template>
  <dt class="flex items-baseline gap-1 border-b border-line-soft py-[3px] pr-3 font-sans text-muted" :title="title">
    <slot name="label">{{ label }}</slot>
  </dt>
  <dd
    class="flex min-w-0 items-baseline gap-2 border-b border-line-soft py-[3px]"
    :class="[prose ? 'text-soft' : 'font-mono text-ink', align === 'right' && 'justify-end text-right']"
  >
    <span class="min-w-0 break-words" :class="align === 'left' && 'flex-1'"><slot /></span>
    <slot name="note" />
  </dd>
</template>
