<script setup lang="ts">
/**
 * A list of labels with their values: the one style for these lists in the lab. Its rows are `LabFact`s. The label
 * column has a fixed width, or `auto` to fit the labels.
 */
withDefaults(defineProps<{ labelWidth?: string }>(), { labelWidth: "88px" });
</script>

<template>
  <dl
    class="grid text-ui [&>*:nth-last-child(-n+2)]:border-b-0"
    :style="{ gridTemplateColumns: `${labelWidth} minmax(0, 1fr)` }"
  >
    <slot />
  </dl>
</template>
