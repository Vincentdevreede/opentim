<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";

/**
 * A tip that shows next to its trigger as soon as the pointer is on it or it has keyboard focus. It is drawn on the
 * page itself, so a scrolling panel doesn't cut it off. With `focusable` off, only the pointer shows it, for small marks
 * that repeat down long lists; screen readers then read the text as the trigger's description. While it shows, the
 * browser's own tooltip of a surrounding element, like a row's `title`, is held back, so the two don't show at once.
 * The pointer can move onto the tip, to read it under a magnifier or select its text: the gap between the two belongs
 * to the tip, so a slow pointer doesn't lose it on the way. It closes a moment after the pointer has left both the
 * trigger and the tip, and Escape closes it at once.
 */
const props = withDefaults(defineProps<{ text: string; focusable?: boolean }>(), { focusable: true });

const trigger = useTemplateRef<HTMLElement>("trigger");
const tip = useTemplateRef<HTMLElement>("tip");
const shown = ref(false);
const at = ref({ left: 0, top: 0, above: false });
/** The gap between the trigger and the tip as a part of the tip, on the side that faces the trigger. */
const BRIDGE = {
  above: "after:absolute after:inset-x-0 after:top-full after:h-2 after:content-['']",
  below: "before:absolute before:inset-x-0 before:bottom-full before:h-2 before:content-['']",
};
/** The surrounding element whose `title` is held back while the tip shows, with that title. */
let heldBack: { element: Element; title: string } | undefined;
/** The pending close after the pointer left, long enough to cross the gap between the trigger and the tip. */
let closing: ReturnType<typeof setTimeout> | undefined;

function stay() {
  clearTimeout(closing);
  closing = undefined;
}

/** The pointer left: the tip closes after a moment, unless the keyboard's focus is on the trigger and keeps it open. */
function leave() {
  stay();
  closing = setTimeout(() => {
    if (!trigger.value?.matches(":focus-visible")) hide();
  }, 150);
}

/** Losing focus closes the tip, unless the pointer is on it, as when its text is being selected. */
function onBlur() {
  if (!tip.value?.matches(":hover")) hide();
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") hide();
}

function hide() {
  stay();
  removeEventListener("keydown", onKey);
  removeEventListener("scroll", follow, true);
  removeEventListener("resize", follow);
  shown.value = false;
  // Vue sets the title again itself when it changes in the meantime; then that newer one stays.
  if (heldBack && !heldBack.element.hasAttribute("title")) heldBack.element.setAttribute("title", heldBack.title);
  heldBack = undefined;
}
onBeforeUnmount(hide);

async function show() {
  stay();
  addEventListener("keydown", onKey);
  // A tip that the keyboard keeps open stays next to its trigger while the page scrolls or the window changes size.
  addEventListener("scroll", follow, true);
  addEventListener("resize", follow);
  const owner = trigger.value?.parentElement?.closest("[title]");
  if (owner && !heldBack) {
    heldBack = { element: owner, title: owner.getAttribute("title")! };
    owner.removeAttribute("title");
  }
  shown.value = true;
  await place();
}

/** Puts the tip below its trigger, or above it when there is no room below. */
async function place() {
  await nextTick();
  const t = trigger.value?.getBoundingClientRect();
  const box = tip.value?.getBoundingClientRect();
  if (!t || !box) return;
  const left = Math.max(8, Math.min(t.left + t.width / 2 - box.width / 2, innerWidth - box.width - 8));
  const below = t.bottom + 6;
  const above = below + box.height > innerHeight - 8;
  at.value = { left, top: above ? t.top - box.height - 6 : below, above };
}
const follow = () => void place();
// A tip whose text changes while it shows, like the read's progress, is placed again, so a longer text still fits.
watch(
  () => props.text,
  () => shown.value && place(),
);
</script>

<template>
  <span
    ref="trigger"
    class="inline-flex"
    :tabindex="focusable ? 0 : undefined"
    :aria-label="focusable ? text : undefined"
    :aria-description="focusable ? undefined : text"
    @mouseenter="show"
    @mouseleave="leave"
    @focus="show"
    @blur="onBlur"
    ><slot
  /></span>
  <Teleport to="body">
    <span
      v-if="shown"
      ref="tip"
      role="tooltip"
      class="fixed z-50 max-w-[260px] rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-meta leading-snug whitespace-pre-line text-ink shadow-lg"
      :class="at.above ? BRIDGE.above : BRIDGE.below"
      :style="{ left: `${at.left}px`, top: `${at.top}px` }"
      @mouseenter="stay"
      @mouseleave="leave"
      >{{ text }}</span
    >
  </Teleport>
</template>
