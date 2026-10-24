<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{ variant?: "default" | "primary" | "ghost"; size?: "md" | "lg"; icon?: boolean }>(),
  { variant: "default", size: "md", icon: false },
);

const classes = computed(() => [
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border disabled:cursor-default disabled:opacity-40",
  props.size === "lg" ? "h-[34px] px-3.5 text-lead" : "h-[26px] text-ui",
  props.icon ? "w-[26px] px-0" : props.size === "md" && "px-[9px]",
  {
    default: "border-line-strong bg-raised text-ink hover:bg-raised-hover",
    primary: "border-accent bg-accent font-semibold text-accent-ink hover:bg-accent-hover",
    ghost: "border-transparent bg-transparent text-soft hover:bg-hover hover:text-ink",
  }[props.variant],
]);
</script>

<template>
  <button type="button" :class="classes"><slot /></button>
</template>
