<script setup lang="ts">
import LabIcon from "../LabIcon.vue";
</script>

<template>
  <div role="note" class="flex gap-2 rounded-lg border border-partial/35 bg-partial/8 p-3 text-soft">
    <LabIcon name="warning" :size="15" :stroke="2" class="mt-px text-partial" />
    <p>
      <b class="font-semibold text-ink">Files won’t be kept.</b> This browser can’t store them, so you’ll need to load
      them again next time. This happens when the lab isn’t opened over https or
      <span class="font-mono">localhost</span>, or when site storage is blocked.
    </p>
  </div>
</template>
