import { nextTick, ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import type { Pcm } from "@opentim/sound";
import { useSamplePlayer } from "../src/components/audio/player.ts";

afterEach(() => vi.unstubAllGlobals());

it("keeps the place in the sound when Loop is turned off after it went round", async () => {
  let clock = 0;
  let onFrame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => ((onFrame = callback), 1));
  vi.stubGlobal("cancelAnimationFrame", () => (onFrame = undefined));
  vi.stubGlobal(
    "AudioContext",
    class {
      destination = {};
      get currentTime() {
        return clock;
      }
      createGain = () => ({ gain: { value: 1 }, connect() {} });
      createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
      createBufferSource = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, loop: false });
      resume = () => Promise.resolve();
      close = () => Promise.resolve();
    },
  );
  // Two seconds at 100 samples a second, looping over all of it.
  const sample = ref<Pcm>({ rate: 100, samples: new Float32Array(200), loopStart: 0, loopEnd: 200 });
  const player = useSamplePlayer(sample);
  player.loop.value = true;
  await nextTick();
  player.play();
  clock = 5;
  onFrame?.(0);
  expect(player.position.value).toBe(1);

  player.loop.value = false;
  await nextTick();
  onFrame?.(0);
  expect(player.position.value).toBe(1);
  clock = 5.5;
  onFrame?.(0);
  expect(player.position.value).toBe(1.5);
});
