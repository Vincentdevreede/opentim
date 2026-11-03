<script setup lang="ts">
/**
 * The strip under a stage with a row of cards to pick from, like frames or sprites. The `header` slot holds its
 * heading (a panel header or tabs); the default slot holds the cards.
 */
</script>

<template>
  <div class="flex h-[150px] shrink-0 flex-col border-t border-line bg-sunken">
    <slot name="header" />
    <div class="flex min-h-0 flex-1 gap-2 overflow-x-auto px-3 py-2"><slot /></div>
  </div>
</template>
