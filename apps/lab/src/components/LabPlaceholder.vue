<script setup lang="ts">
/** A dashed box that stands in for something not built yet: a title, a line of text, and an optional link below. */
withDefaults(defineProps<{ title: string; large?: boolean }>(), { large: false });
</script>

<template>
  <div
    class="flex flex-col items-center gap-1 rounded-md border border-dashed border-line-strong bg-sunken text-center"
    :class="large ? 'max-w-md gap-3 px-8 py-10' : 'px-3 py-4 text-meta'"
  >
    <p class="font-semibold" :class="large ? 'text-heading-sm' : 'text-soft'">{{ title }}</p>
    <p :class="large ? 'text-soft' : 'text-muted'"><slot /></p>
    <slot name="action" />
  </div>
</template>
