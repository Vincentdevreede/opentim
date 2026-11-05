<script setup lang="ts">
import LabEmpty from "../components/LabEmpty.vue";

/** What an address the lab has no page for shows, like a page from another branch. The menu leads on from here. */
</script>

<template>
  <LabEmpty icon="search" title="Page not found" :text="`The lab has no page at ${$route.path}.`" />
</template>
