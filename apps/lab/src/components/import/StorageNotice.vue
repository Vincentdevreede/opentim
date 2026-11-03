<script setup lang="ts">
import LabAlert from "../LabAlert.vue";
</script>

<template>
  <LabAlert tone="warning" title="Files won’t be kept.">
    <p class="text-soft">
      This browser can’t store them, so you’ll need to load them again next time. This happens when the lab isn’t opened
      over https or <span class="font-mono">localhost</span>, or when site storage is blocked.
    </p>
  </LabAlert>
</template>
