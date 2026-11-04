<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useTemplateRef } from "vue";

/**
 * A tip that shows next to its trigger as soon as the pointer is on it or it has keyboard focus. It is drawn on the
 * page itself, so a scrolling panel doesn't cut it off. With `focusable` off, only the pointer shows it, for small marks
 * that repeat down long lists; screen readers then read the text as the trigger's description. While it shows, the
 * browser's own tooltip of a surrounding element, like a row's `title`, is held back, so the two don't show at once.
 */
withDefaults(defineProps<{ text: string; focusable?: boolean }>(), { focusable: true });

const trigger = useTemplateRef<HTMLElement>("trigger");
const tip = useTemplateRef<HTMLElement>("tip");
const shown = ref(false);
const at = ref({ left: 0, top: 0 });
/** The surrounding element whose `title` is held back while the tip shows, with that title. */
let heldBack: { element: Element; title: string } | undefined;

function hide() {
  shown.value = false;
  // Vue sets the title again itself when it changes in the meantime; then that newer one stays.
  if (heldBack && !heldBack.element.hasAttribute("title")) heldBack.element.setAttribute("title", heldBack.title);
  heldBack = undefined;
}
onBeforeUnmount(hide);

async function show() {
  const owner = trigger.value?.parentElement?.closest("[title]");
  if (owner && !heldBack) {
    heldBack = { element: owner, title: owner.getAttribute("title")! };
    owner.removeAttribute("title");
  }
  shown.value = true;
  await nextTick();
  const t = trigger.value?.getBoundingClientRect();
  const box = tip.value?.getBoundingClientRect();
  if (!t || !box) return;
  const left = Math.max(8, Math.min(t.left + t.width / 2 - box.width / 2, innerWidth - box.width - 8));
  const below = t.bottom + 6;
  at.value = { left, top: below + box.height > innerHeight - 8 ? t.top - box.height - 6 : below };
}
</script>

<template>
  <span
    ref="trigger"
    class="inline-flex"
    :tabindex="focusable ? 0 : undefined"
    :aria-label="focusable ? text : undefined"
    :aria-description="focusable ? undefined : text"
    @mouseenter="show"
    @mouseleave="hide"
    @focus="show"
    @blur="hide"
    ><slot
  /></span>
  <Teleport to="body">
    <span
      v-if="shown"
      ref="tip"
      role="tooltip"
      class="pointer-events-none fixed z-50 max-w-[260px] rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-meta leading-snug whitespace-pre-line text-ink shadow-lg"
      :style="{ left: `${at.left}px`, top: `${at.top}px` }"
      >{{ text }}</span
    >
  </Teleport>
</template>
