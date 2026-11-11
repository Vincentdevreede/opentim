/**
 * How far the read of the loaded program's behaviour in the background has come, for every page to show the same:
 * the step, what the step has done, the share of the whole, and about how long is left. Imported by the app itself, so
 * it hears a read from its start.
 */
import { computed, ref, shallowRef, watch } from "vue";
import { READ_STEPS, onReadProgress } from "./behaviour.ts";
import { program } from "./library.ts";

interface Reading {
  program: Uint8Array;
  step: number;
  done: number;
  total: number;
  /** When the first word of this read came, in the page's clock. */
  started: number;
}

const reading = shallowRef<Reading>();
onReadProgress((e) => {
  if ("finished" in e) {
    if (reading.value?.program === e.program) reading.value = undefined;
    return;
  }
  const started = reading.value?.program === e.program ? reading.value.started : performance.now();
  reading.value = { program: e.program, step: e.step, done: e.done, total: e.total, started };
});

/** The clock, once a second while a read goes on, so the time left counts down between words from the read. */
const now = ref(performance.now());
let ticking: ReturnType<typeof setInterval> | undefined;
watch(
  () => !!reading.value,
  (on) => {
    if (on && !ticking) ticking = setInterval(() => (now.value = performance.now()), 1000);
    if (!on && ticking) {
      clearInterval(ticking);
      ticking = undefined;
    }
  },
);

const ALL = READ_STEPS.reduce((n, s) => n + s.share, 0);

/** What a step has done, in words: the part or the loop it is at. */
export function detailOf(step: number, done: number, total: number): string {
  // The first step goes through the program's type records, which are a few more than the parts.
  if (step === 0) return done ? `type ${done} of ${total}` : "starting";
  // Most programs have one loop to read per type, which says nothing as "loop 1 of 1".
  if (step === 3) return total > 1 ? `loop ${done} of ${total}` : "";
  if (step === 2 || step === 4) {
    // The walks count the pass over the sources of hits, then each part.
    const parts = (total - 1) / 2;
    if (done <= 1) return "starting";
    return done <= 1 + parts ? `first pass, part ${done - 1} of ${parts}` : `part ${done - 1 - parts} of ${parts}`;
  }
  return "";
}

/** A time left in words, rounded so it doesn't jump about. */
export function timeLeft(seconds: number | undefined): string {
  if (seconds === undefined) return "Working out the time left…";
  if (seconds < 50) return `About ${Math.max(10, Math.round(seconds / 10) * 10)} s left`;
  return `About ${Math.max(1, Math.round(seconds / 60))} min left`;
}

export interface ReadProgress {
  /** The step, counting from 1, and how many there are. */
  step: number;
  steps: number;
  name: string;
  /** What the step has done, like "part 23 of 63". */
  detail: string;
  /** The share of the whole read done, from 0 to 1. */
  fraction: number;
  /** About how long is left, in words. */
  left: string;
}

/** Where the read of the loaded program is, or undefined when none goes on. */
export const readProgress = computed<ReadProgress | undefined>(() => {
  const r = reading.value;
  if (!r || r.program !== program.value?.data) return undefined;
  const step = READ_STEPS[r.step];
  if (!step) return undefined;
  const before = READ_STEPS.slice(0, r.step).reduce((n, s) => n + s.share, 0);
  const fraction = Math.min(1, (before + step.share * (r.total ? r.done / r.total : 0)) / ALL);
  const elapsed = (now.value - r.started) / 1000;
  // The time so far over the share done gives the time left, once there is enough of both to go by.
  const seconds = fraction > 0.03 && elapsed > 5 ? (elapsed * (1 - fraction)) / fraction : undefined;
  return {
    step: r.step + 1,
    steps: READ_STEPS.length,
    name: step.name,
    detail: detailOf(r.step, r.done, r.total),
    fraction,
    left: timeLeft(seconds),
  };
});
