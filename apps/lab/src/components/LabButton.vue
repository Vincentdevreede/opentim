<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";

/**
 * A button. `link` is a text action without a frame, like Expand all, in the text size around it. `tone` colours a
 * link: `accent` for an action that helps on, `danger` for one that removes something; a `ghost` button takes the
 * `danger` tone too. The `danger` variant is the framed button that confirms a removal. With `to` it is a link to
 * another page that looks like a button.
 */
const props = withDefaults(
  defineProps<{
    variant?: "default" | "primary" | "danger" | "ghost" | "link";
    size?: "md" | "lg";
    icon?: boolean;
    tone?: "default" | "accent" | "danger";
    to?: RouteLocationRaw;
  }>(),
  { variant: "default", size: "md", icon: false, tone: "default", to: undefined },
);

const LINK_TONES = {
  default: "text-soft hover:text-ink",
  accent: "text-accent hover:text-accent-hover",
  danger: "text-muted hover:text-error",
};

const classes = computed(() =>
  props.variant === "link"
    ? [
        "inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap disabled:cursor-default disabled:opacity-40",
        LINK_TONES[props.tone],
      ]
    : [
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border disabled:cursor-default disabled:opacity-40",
        props.size === "lg" ? "h-[34px] px-3.5 text-lead" : "h-[26px] text-ui",
        props.icon ? "w-[26px] px-0" : props.size === "md" && "px-[9px]",
        {
          default: "border-line-strong bg-raised text-ink hover:bg-raised-hover",
          primary: "border-accent bg-accent font-semibold text-accent-ink hover:bg-accent-hover",
          danger: "border-error bg-error font-semibold text-accent-ink hover:bg-error/85",
          ghost:
            props.tone === "danger"
              ? "border-transparent bg-transparent text-error hover:bg-error/10"
              : "border-transparent bg-transparent text-soft hover:bg-hover hover:text-ink",
        }[props.variant],
      ],
);
</script>

<template>
  <RouterLink v-if="to" :to="to" :class="classes"><slot /></RouterLink>
  <button v-else type="button" :class="classes"><slot /></button>
</template>
