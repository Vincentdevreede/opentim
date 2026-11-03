<script setup lang="ts">
/** A small square of one colour. Without a colour it shows the transparency checks. */
withDefaults(defineProps<{ color?: string; small?: boolean }>(), { color: undefined, small: false });
</script>

<template>
  <span
    class="inline-block shrink-0 rounded-[3px] border border-line-strong"
    :class="[small ? 'size-3' : 'size-4', !color && 'checker']"
    :style="color ? { background: color } : undefined"
  ></span>
</template>
