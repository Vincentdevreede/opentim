<script setup lang="ts">
import { useAttrs } from "vue";
import type { Confidence } from "../kinds.ts";
import LabDot from "./LabDot.vue";
import LabIcon from "./LabIcon.vue";

/**
 * A row of a list, like the levels, the resources or the parts of a level: a name, an optional text and meta, and an
 * optional status dot. A row with a click handler is a button; without one it is a plain row. With `expanded` it
 * opens to show more below it, with a chevron in front. `indent` moves a nested row in by levels. The `lead` slot puts
 * something in front, like an icon or a checkbox; the default slot replaces the text with richer content; the `end`
 * slot puts something on the right, like a badge.
 */
withDefaults(
  defineProps<{
    name?: string;
    /** A fixed width for the name, so the texts line up; without it the name takes the free space. */
    nameWidth?: string;
    text?: string;
    meta?: string;
    /** The state the dot shows; without it there is no dot. */
    status?: Confidence;
    selected?: boolean;
    /** Whether the row is open, for a row that opens; leave it out for a plain row. */
    expanded?: boolean;
    /** Keeps the line under the row off the sides, like the lines between facts in a details panel. */
    inset?: boolean;
    /** How many levels deep the row is nested. */
    indent?: number;
  }>(),
  {
    name: undefined,
    nameWidth: undefined,
    text: undefined,
    meta: undefined,
    status: undefined,
    selected: false,
    expanded: undefined,
    inset: false,
    indent: 0,
  },
);

const clickable = "onClick" in useAttrs();
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="relative flex w-full items-center gap-2 px-3 py-[5px] text-left focus-visible:-outline-offset-2"
    :class="[
      selected ? 'bg-accent/12 text-ink' : ['text-soft', clickable && 'hover:bg-hover'],
      clickable && 'cursor-pointer',
      inset
        ? 'after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-line-soft'
        : 'border-b border-line-soft',
    ]"
    :aria-current="selected || undefined"
    :aria-expanded="expanded"
    :style="indent ? { paddingLeft: `${12 + indent * 14}px` } : undefined"
  >
    <LabIcon
      v-if="expanded !== undefined"
      name="chevronRight"
      :size="12"
      class="-mx-0.5 text-muted transition-transform"
      :class="expanded && 'rotate-90'"
    />
    <slot name="lead" />
    <span
      v-if="name !== undefined"
      class="truncate font-mono text-meta"
      :class="[nameWidth ? 'shrink-0' : 'min-w-0 flex-1', text !== undefined && expanded !== undefined && 'text-muted']"
      :style="nameWidth ? { width: nameWidth } : undefined"
      >{{ name }}</span
    >
    <span v-if="$slots.default" class="flex min-w-0 flex-1 items-baseline gap-2"><slot /></span>
    <span v-else-if="text !== undefined" class="min-w-0 flex-1 truncate font-sans text-ui">{{ text }}</span>
    <span v-if="meta" class="shrink-0 text-muted">{{ meta }}</span>
    <slot name="end" />
    <LabDot v-if="status" :status="status" />
  </component>
</template>
