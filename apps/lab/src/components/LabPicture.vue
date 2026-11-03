<script setup lang="ts">
/** A box that shows a picture centred on the checker, as in cards and previews. Tags can go in its corners. */
withDefaults(defineProps<{ height?: string }>(), { height: undefined });
</script>

<template>
  <span
    class="relative flex items-center justify-center overflow-hidden rounded-[3px] checker"
    :style="height ? { height } : undefined"
  >
    <slot />
  </span>
</template>
