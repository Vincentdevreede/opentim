/** Stepping and playing through the frames of a part or the sprites of a sheet, with the keyboard too. */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/** Speed of the preview. The game's own timing isn't known yet. */
export const FPS = 8;
export const ZOOMS = [1, 2, 3, 4, 6];

export function usePlayer(count: Ref<number>, start = 0) {
  const index = ref(start);
  const playing = ref(false);
  /** The index, kept within the items there are. */
  const position = computed({
    get: () => Math.min(index.value, Math.max(0, count.value - 1)),
    set: (value: number) => (index.value = value),
  });

  function move(by: number) {
    const n = count.value;
    if (n) index.value = (position.value + by + n) % n;
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  watch(playing, (on) => {
    clearInterval(timer);
    if (on) timer = setInterval(() => move(1), 1000 / FPS);
  });
  watch(count, (n) => {
    if (n < 2) playing.value = false;
  });
  onBeforeUnmount(() => clearInterval(timer));

  return { position, playing, move };
}

/**
 * The keys of a sprite view: arrows step, Space plays, digits zoom. `other` gets the remaining keys, in lower case.
 * Keys typed into a field are left alone.
 */
export function useSpriteKeys(
  player: ReturnType<typeof usePlayer>,
  count: Ref<number>,
  zoom: Ref<number>,
  other: (key: string) => void = () => {},
) {
  function onKeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof HTMLElement)) return;
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      player.move(e.key === "ArrowLeft" ? -1 : 1);
      // Keep the focus ring on the selected item, not on the one that was clicked.
      if (e.target.closest("[data-item]"))
        void nextTick(() => document.querySelector<HTMLElement>('[data-item="selected"]')?.focus());
    } else if (e.key === " ") {
      // A focused button already presses itself on Space.
      if (e.target.closest("button")) return;
      e.preventDefault();
      if (!e.repeat && count.value > 1) player.playing.value = !player.playing.value;
    } else if (ZOOMS.includes(Number(e.key))) zoom.value = Number(e.key);
    else other(e.key.toLowerCase());
  }
  onMounted(() => window.addEventListener("keydown", onKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
}

/** Classes of a toggle button that is on. */
export const toggle = (on: boolean) => on && "border-accent! bg-accent/12! text-accent!";

/** A pixel grid over a picture at this zoom. */
export const gridStyle = (zoom: number) => ({
  backgroundImage:
    "linear-gradient(to right, rgb(128 128 128 / 0.45) 1px, transparent 1px), linear-gradient(to bottom, rgb(128 128 128 / 0.45) 1px, transparent 1px)",
  backgroundSize: `${zoom}px ${zoom}px`,
});

/** Scales a picture to fit a box: whole steps up to `max` for small pictures, smaller for large ones. */
export function fitScale(width: number, height: number, boxWidth: number, boxHeight: number, max = 2) {
  if (!width || !height) return 1;
  const fit = Math.min(boxWidth / width, boxHeight / height);
  return fit >= 1 ? Math.min(max, Math.floor(fit)) : fit;
}
