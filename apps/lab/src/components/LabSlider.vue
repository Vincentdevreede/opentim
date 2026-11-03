<script setup lang="ts">
/** A slider for a number. The label is shown before it, or only read out with `hideLabel`. */
withDefaults(
  defineProps<{ label: string; min?: number; max: number; step?: number; disabled?: boolean; hideLabel?: boolean }>(),
  {
    min: 0,
    step: 1,
    disabled: false,
    hideLabel: false,
  },
);
const value = defineModel<number>({ required: true });
</script>

<template>
  <label class="flex min-w-0 items-center gap-2 text-meta text-muted" :class="disabled && 'opacity-40'">
    <span :class="hideLabel && 'sr-only'">{{ label }}</span>
    <input
      v-model.number="value"
      class="min-w-0 flex-1 accent-accent"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
    />
  </label>
</template>
