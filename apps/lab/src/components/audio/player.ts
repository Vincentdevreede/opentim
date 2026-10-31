/** Plays audio with the Web Audio API. */

import type { Pcm } from "@opentim/sound";
import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";

export function useSamplePlayer(sample: Ref<Pcm | undefined>) {
  const playing = ref(false);
  /** Where playback is, in seconds. */
  const position = ref(0);
  const loop = ref(false);
  const volume = ref(0.7);
  const length = computed(() => (sample.value ? sample.value.samples.length / sample.value.rate : 0));

  let context: AudioContext | undefined;
  let gain: GainNode | undefined;
  let buffer: AudioBuffer | undefined;
  let source: AudioBufferSourceNode | undefined;
  /** The context time at which playback would have been at 0 seconds. */
  let startedAt = 0;
  let frame = 0;

  function audioBuffer(ctx: AudioContext, s: Pcm): AudioBuffer {
    const out = ctx.createBuffer(1, Math.max(1, s.samples.length), s.rate);
    out.getChannelData(0).set(s.samples);
    return out;
  }

  /** Where playback is now, wrapping around while it loops. */
  function now(): number {
    if (!context || !playing.value) return position.value;
    const t = context.currentTime - startedAt;
    return loop.value && length.value ? t % length.value : Math.min(t, length.value);
  }

  function tick() {
    position.value = now();
    frame = requestAnimationFrame(tick);
  }

  function stopSource() {
    cancelAnimationFrame(frame);
    if (!source) return;
    source.onended = null;
    source.stop();
    source.disconnect();
    source = undefined;
  }

  function play(from = position.value) {
    const s = sample.value;
    if (!s || !s.samples.length) return;
    context ??= new AudioContext();
    if (!gain) {
      gain = context.createGain();
      gain.connect(context.destination);
    }
    gain.gain.value = volume.value;
    buffer ??= audioBuffer(context, s);
    stopSource();
    if (from >= length.value) from = 0;
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.loop = loop.value;
    node.loopStart = s.loopStart / s.rate;
    node.loopEnd = s.loopEnd / s.rate;
    node.connect(gain);
    node.onended = () => {
      if (source !== node) return;
      stopSource();
      playing.value = false;
      position.value = 0;
    };
    node.start(0, from);
    source = node;
    startedAt = context.currentTime - from;
    playing.value = true;
    void context.resume();
    frame = requestAnimationFrame(tick);
  }

  function pause() {
    position.value = now();
    stopSource();
    playing.value = false;
  }

  const toggle = () => (playing.value ? pause() : play());

  /** Moves playback to a time, and keeps playing when it was. */
  function seek(seconds: number) {
    position.value = Math.max(0, Math.min(seconds, length.value));
    if (playing.value) play(position.value);
  }

  watch(sample, () => {
    stopSource();
    buffer = undefined;
    playing.value = false;
    position.value = 0;
  });
  watch(volume, (v) => gain && (gain.gain.value = v));
  watch(loop, (on) => {
    if (!source) return;
    // Turning the loop off while past the loop's end would stop at once; restart from where playback is instead.
    const at = now();
    source.loop = on;
    if (!on) startedAt = (context?.currentTime ?? 0) - at;
  });

  onBeforeUnmount(() => {
    stopSource();
    void context?.close();
  });

  return { playing, position, length, loop, volume, play, pause, toggle, seek };
}
