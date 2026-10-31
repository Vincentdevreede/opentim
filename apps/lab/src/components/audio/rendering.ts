/** Rendering sounds on the emulated AdLib in a worker, for the Audio page. */

import type { Pcm } from "@opentim/sound";
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";

export interface RenderRequest {
  /** The unpacked sound. */
  sound: Uint8Array;
  /** The AdLib instruments, SCI patch 3. */
  patch: Uint8Array;
}

export type RenderResponse =
  { type: "progress"; done: number } | { type: "done"; pcm: Pcm } | { type: "error"; message: string };

export interface RenderJob extends RenderRequest {
  /** Identifies the sound, for the cache. */
  key: string;
}

/** Rendered songs are large, about 12 MB a minute, so only the last few are kept. */
const CACHE_SIZE = 4;
const cache = new Map<string, Pcm>();
/** Waits before rendering, so moving through the list doesn't start a render for every sound passed. */
const DELAY_MS = 120;

function remember(key: string, pcm: Pcm) {
  cache.delete(key);
  cache.set(key, pcm);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Renders the job's sound whenever the job changes, cancelling a render that is still running. */
export function useRendered(job: Ref<RenderJob | undefined>) {
  const pcm = shallowRef<Pcm>();
  const progress = ref(0);
  const error = ref<string>();
  const rendering = ref(false);
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop() {
    clearTimeout(timer);
    worker?.terminate();
    worker = undefined;
    rendering.value = false;
  }

  function start({ key, sound, patch }: RenderJob) {
    const w = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
    worker = w;
    w.onmessage = (e: MessageEvent<RenderResponse>) => {
      if (worker !== w) return;
      const message = e.data;
      if (message.type === "progress") progress.value = message.done;
      else {
        if (message.type === "done") {
          remember(key, message.pcm);
          pcm.value = message.pcm;
        } else error.value = message.message;
        stop();
      }
    };
    w.onerror = (e) => {
      if (worker !== w) return;
      error.value = e.message || "The renderer stopped";
      stop();
    };
    w.postMessage({ sound, patch } satisfies RenderRequest);
  }

  watch(
    job,
    (next) => {
      stop();
      pcm.value = undefined;
      error.value = undefined;
      progress.value = 0;
      if (!next) return;
      const cached = cache.get(next.key);
      if (cached) {
        remember(next.key, cached);
        pcm.value = cached;
        return;
      }
      rendering.value = true;
      timer = setTimeout(() => start(next), DELAY_MS);
    },
    { immediate: true },
  );
  onBeforeUnmount(stop);

  return { pcm, progress, error, rendering };
}
