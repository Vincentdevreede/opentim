<script setup lang="ts">
/** A checkbox with its label. More content, like a count, can follow the label in the slot. */
const checked = defineModel<boolean>({ required: true });
</script>

<template>
  <label class="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap text-soft">
    <input v-model="checked" type="checkbox" class="accent-accent" />
    <slot />
  </label>
</template>
