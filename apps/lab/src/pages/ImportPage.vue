<script setup lang="ts">
import ImportFailed from "../components/import/ImportFailed.vue";
import ImportOverview from "../components/import/ImportOverview.vue";
import ImportStart from "../components/import/ImportStart.vue";
import { phase } from "../library.ts";
</script>

<template>
  <ImportFailed v-if="phase === 'error'" />
  <ImportOverview v-else-if="phase === 'loaded'" />
  <ImportStart v-else />
</template>
