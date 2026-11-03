<script setup lang="ts">
/**
 * A panel beside a page's main area, on the darker background: a list on the left or details on the right. Every
 * details panel has the same width; lists default to their own.
 */
const props = withDefaults(defineProps<{ side?: "left" | "right"; width?: string }>(), {
  side: "right",
  width: undefined,
});
const width = () => props.width ?? (props.side === "right" ? "340px" : "300px");
</script>

<template>
  <aside
    class="flex shrink-0 flex-col border-line bg-sunken"
    :class="side === 'left' ? 'border-r' : 'border-l'"
    :style="{ width: width() }"
  >
    <slot />
  </aside>
</template>
