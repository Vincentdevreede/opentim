<script setup lang="ts">
/** The line under a search that found nothing. The slot can add an action, like clearing the filters. */
withDefaults(defineProps<{ what: string; query?: string }>(), { query: "" });
</script>

<template>
  <p class="px-3 py-4 text-center text-muted">
    No {{ what }} match<template v-if="query.trim()">
      “<span class="font-mono text-ink">{{ query.trim() }}</span
      >”</template
    >.
    <slot />
  </p>
</template>
