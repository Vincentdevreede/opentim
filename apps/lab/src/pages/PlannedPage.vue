<script setup lang="ts">
defineProps<{ title: string; description: string }>();
</script>

<template>
  <div class="p-6">
    <h1 class="text-xl font-semibold">{{ title }}</h1>
    <p class="mt-2 text-slate-300">{{ description }}</p>
    <p class="mt-4 max-w-xl text-sm text-slate-500">
      This view needs a parser for the original file format, which hasn't been written yet. Use the Files view to
      inspect the raw data in the meantime.
    </p>
  </div>
</template>
