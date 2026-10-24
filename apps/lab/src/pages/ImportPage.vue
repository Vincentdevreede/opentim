<script setup lang="ts">
import ImportEmpty from "../components/import/ImportEmpty.vue";
import ImportFailed from "../components/import/ImportFailed.vue";
import ImportOverview from "../components/import/ImportOverview.vue";
import ImportReading from "../components/import/ImportReading.vue";
import { phase } from "../library.ts";
</script>

<template>
  <ImportReading v-if="phase === 'reading'" />
  <ImportFailed v-else-if="phase === 'error'" />
  <ImportOverview v-else-if="phase === 'loaded'" />
  <ImportEmpty v-else />
</template>
