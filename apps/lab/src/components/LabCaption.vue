<script setup lang="ts">
/** The small caption under a card's picture, like a frame number or a size. */
withDefaults(defineProps<{ center?: boolean }>(), { center: false });
</script>

<template>
  <span class="truncate px-0.5 font-mono text-2xs text-muted" :class="center && 'text-center'"><slot /></span>
</template>
