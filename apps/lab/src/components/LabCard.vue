<script setup lang="ts">
/** A card to pick, like a part, an image file, a frame or a palette: a picture with a caption below it. */
withDefaults(defineProps<{ selected?: boolean }>(), { selected: false });
</script>

<template>
  <button
    type="button"
    class="flex min-w-0 cursor-pointer flex-col gap-1 rounded-md border p-1 text-left"
    :class="
      selected ? 'border-accent bg-accent/12 ring-1 ring-accent' : 'border-line bg-surface hover:border-line-strong'
    "
    :aria-pressed="selected"
  >
    <slot />
  </button>
</template>
