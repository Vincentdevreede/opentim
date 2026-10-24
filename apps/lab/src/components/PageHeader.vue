<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <header class="flex h-11 shrink-0 items-center gap-3 border-b border-line pr-3 pl-4">
    <h1 class="text-title font-semibold">{{ title }}</h1>
    <span class="text-muted"><slot name="subtitle" /></span>
    <div class="flex-1"></div>
    <slot />
  </header>
</template>
