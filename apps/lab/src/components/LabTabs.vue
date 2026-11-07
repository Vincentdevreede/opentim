<script setup lang="ts" generic="T extends string">
/**
 * Tabs over a panel. The panel gets its role and ids from `tabPanel(id, value)` in `tabs.ts`. Left and Right move
 * between the tabs, Home and End go to the first and last, and these keys stop here so the page doesn't also step
 * through its items. The slot puts more on the right of the tab row, like keyboard hints.
 */
import { nextTick, useTemplateRef } from "vue";
import { panelIdOf, tabAfterKey, tabIdOf } from "./tabs.ts";

const props = defineProps<{ id: string; label: string; options: { value: T; label: string; disabled?: boolean }[] }>();
const model = defineModel<T>({ required: true });
const list = useTemplateRef<HTMLElement>("list");

function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const enabled = props.options.filter((o) => !o.disabled).map((o) => o.value);
  const next = tabAfterKey(e.key, enabled, model.value);
  if (next === undefined) return;
  e.preventDefault();
  e.stopPropagation();
  model.value = next;
  void nextTick(() => list.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-1 border-b border-line px-3">
    <div ref="list" class="flex items-center gap-1" role="tablist" :aria-label="label" @keydown="onKeydown">
      <button
        v-for="o in options"
        :id="tabIdOf(id, o.value)"
        :key="o.value"
        type="button"
        role="tab"
        :aria-selected="model === o.value"
        :aria-controls="panelIdOf(id)"
        :tabindex="model === o.value ? 0 : -1"
        :disabled="o.disabled"
        class="-mb-px h-10 cursor-pointer border-b-2 px-2 text-label font-semibold tracking-[.07em] uppercase disabled:cursor-default disabled:opacity-40"
        :class="model === o.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'"
        @click="model = o.value"
      >
        {{ o.label }}
      </button>
    </div>
    <template v-if="$slots.default">
      <div class="flex-1"></div>
      <slot />
    </template>
  </div>
</template>
