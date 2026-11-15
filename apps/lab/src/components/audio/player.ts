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
    const out = ctx.createBuffer(s.right ? 2 : 1, Math.max(1, s.samples.length), s.rate);
    out.getChannelData(0).set(s.samples);
    if (s.right) out.getChannelData(1).set(s.right);
    return out;
  }

  /**
   * Where a looping sound is after playing for some seconds: it plays up to the loop's end once, then repeats the part
   * between the loop's start and end, as Web Audio does. A loop that isn't one (end not after start) is the whole sound.
   */
  function looped(t: number): number {
    const [start, end] = loopBounds();
    return t < end || end <= start ? t : start + ((t - start) % (end - start));
  }

  /**
   * The loop's start and end in seconds, with an end past the sound cut to the sound's end, as Web Audio does. A loop
   * that isn't one is the whole sound.
   */
  function loopBounds(): [number, number] {
    const s = sample.value;
    const start = s ? s.loopStart / s.rate : 0;
    const end = Math.min(s ? s.loopEnd / s.rate : 0, length.value);
    return start >= 0 && end > start ? [start, end] : [0, length.value];
  }

  /** Where playback is now, wrapping around while it loops. */
  function now(): number {
    if (!context || !playing.value) return position.value;
    const t = context.currentTime - startedAt;
    return loop.value && length.value ? looped(t) : Math.min(t, length.value);
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
    // Web Audio starts a looping sound that is asked to start past the loop's end at the loop's end.
    const end = loopBounds()[1];
    if (loop.value && from > end) from = end;
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
    if (!source || !context) return;
    source.loop = on;
    // Turning the loop off while past the loop's end would stop at once; restart from where playback is instead.
    // The loop is already off here, so work out that place as for a sound that loops.
    if (!on && length.value) startedAt = context.currentTime - looped(context.currentTime - startedAt);
  });

  onBeforeUnmount(() => {
    stopSource();
    void context?.close();
  });

  return { playing, position, length, loop, volume, play, pause, toggle, seek };
}
