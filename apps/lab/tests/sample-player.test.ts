import { nextTick, ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import type { Pcm } from "@opentim/sound";
import { useSamplePlayer } from "../src/components/audio/player.ts";

afterEach(() => vi.unstubAllGlobals());

/** A fake audio context with a clock the test moves, and the frame callback the player asks for. */
function fakeAudio() {
  const audio = { clock: 0, frame: undefined as FrameRequestCallback | undefined };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => ((audio.frame = callback), 1));
  vi.stubGlobal("cancelAnimationFrame", () => (audio.frame = undefined));
  vi.stubGlobal(
    "AudioContext",
    class {
      destination = {};
      get currentTime() {
        return audio.clock;
      }
      createGain = () => ({ gain: { value: 1 }, connect() {} });
      createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
      createBufferSource = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, loop: false });
      resume = () => Promise.resolve();
      close = () => Promise.resolve();
    },
  );
  return audio;
}

it("keeps the place in the sound when Loop is turned off after it went round", async () => {
  const audio = fakeAudio();
  // Two seconds at 100 samples a second, looping over all of it.
  const sample = ref<Pcm>({ rate: 100, samples: new Float32Array(200), loopStart: 0, loopEnd: 200 });
  const player = useSamplePlayer(sample);
  player.loop.value = true;
  await nextTick();
  player.play();
  audio.clock = 5;
  audio.frame?.(0);
  expect(player.position.value).toBe(1);

  player.loop.value = false;
  await nextTick();
  audio.frame?.(0);
  expect(player.position.value).toBe(1);
  audio.clock = 5.5;
  audio.frame?.(0);
  expect(player.position.value).toBe(1.5);
});

it("wraps within the sample's own loop, after playing up to its end once", async () => {
  const audio = fakeAudio();
  // Ten seconds that loop from 2 to 4 seconds.
  const sample = ref<Pcm>({ rate: 100, samples: new Float32Array(1000), loopStart: 200, loopEnd: 400 });
  const player = useSamplePlayer(sample);
  player.loop.value = true;
  await nextTick();
  player.play();
  audio.clock = 3;
  audio.frame?.(0);
  expect(player.position.value).toBe(3);
  audio.clock = 11;
  audio.frame?.(0);
  expect(player.position.value).toBe(3);

  player.loop.value = false;
  await nextTick();
  audio.frame?.(0);
  expect(player.position.value).toBe(3);
});

it("starts a looping sample asked to start past its loop at the loop's end, as Web Audio does", async () => {
  const audio = fakeAudio();
  // Ten seconds that loop from 2 to 4 seconds.
  const sample = ref<Pcm>({ rate: 100, samples: new Float32Array(1000), loopStart: 200, loopEnd: 400 });
  const player = useSamplePlayer(sample);
  player.loop.value = true;
  await nextTick();
  player.play();
  player.seek(7);
  audio.clock = 0.25;
  audio.frame?.(0);
  // It starts at 4, the loop's end, which wraps to 2 at once.
  expect(player.position.value).toBeCloseTo(2.25);
});

it("keeps the loop's start when its end lies past the sound, and cuts the end to the sound's end", async () => {
  const audio = fakeAudio();
  // Ten seconds that loop from 2 to 12 seconds, so really from 2 to 10.
  const sample = ref<Pcm>({ rate: 100, samples: new Float32Array(1000), loopStart: 200, loopEnd: 1200 });
  const player = useSamplePlayer(sample);
  player.loop.value = true;
  await nextTick();
  player.play();
  audio.clock = 11;
  audio.frame?.(0);
  expect(player.position.value).toBe(3);
});
