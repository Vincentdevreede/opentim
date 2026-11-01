<script setup lang="ts">
/** The scrolling body of a details panel, with the standard padding and space between its sections. */
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto px-3 py-2.5">
    <div class="flex flex-col gap-3"><slot /></div>
  </div>
</template>
