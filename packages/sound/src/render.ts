/** Rendering the sounds of the game to samples that can be played or saved. */

import { readSoundTracks, type Sample } from "@opentim/resources";
import { AdlibDriver, type AdlibBank } from "./adlib.ts";
import { OPL_RATE, Opl2 } from "./opl.ts";
import { TICKS_PER_SECOND, mergeTracks, readTrackEvents } from "./sequence.ts";

/** Mono audio as floats from -1 to 1. */
export interface Pcm {
  rate: number;
  samples: Float32Array;
  /** The loop points, in samples. */
  loopStart: number;
  loopEnd: number;
}

/** The device id a sound lists its AdLib tracks under. */
export const ADLIB_DEVICE = 0x00;

/** How long the last notes may ring after a sound ends. */
const TAIL_SECONDS = 2;
const MAX_SECONDS = 15 * 60;
/** The chip's output gain. At 1, as on the card, a voice at full level reaches 1/8 of full scale. */
const OPL_GAIN = 1;

/** Converts a sample of the game, unsigned 8-bit PCM, to floats. */
export function samplePcm(sample: Sample): Pcm {
  return {
    rate: sample.rate,
    samples: Float32Array.from(sample.data, (v) => (v - 128) / 128),
    loopStart: sample.loopStart,
    loopEnd: sample.loopEnd,
  };
}

export interface RenderOptions {
  /** The output rate; the chip's own rate by default. */
  rate?: number;
  /** Called while rendering, with the part done from 0 to 1. */
  onProgress?: (done: number) => void;
}

/** True when an unpacked sound has MIDI tracks for the AdLib. */
export const hasAdlibTracks = (sound: Uint8Array) =>
  readSoundTracks(sound).some((d) => d.id === ADLIB_DEVICE && d.tracks.some((t) => !t.sample));

/**
 * Plays the AdLib MIDI tracks of an unpacked SCI sound on an emulated AdLib with the game's instruments. A digitized
 * sample among those tracks is left out; {@link samplePcm} converts it on its own.
 */
export function renderAdlib(sound: Uint8Array, bank: AdlibBank, options: RenderOptions = {}): Pcm {
  const rate = options.rate ?? OPL_RATE;
  const device = readSoundTracks(sound).find((d) => d.id === ADLIB_DEVICE);
  if (!device) throw new Error("The sound has no tracks for the AdLib");
  const tracks = device.tracks.filter((t) => !t.sample).map((t) => readTrackEvents(t.data.subarray(2)));
  const events = mergeTracks(tracks.map((t) => t.events));
  const end = Math.max(0, ...tracks.map((t) => t.end));
  const sampleAt = (tick: number) => Math.round((tick / TICKS_PER_SECOND) * rate);

  const length = Math.min(sampleAt(end) + TAIL_SECONDS * rate, MAX_SECONDS * rate);
  const out = new Float32Array(length);
  const opl = new Opl2(rate, OPL_GAIN);
  const driver = new AdlibDriver(opl, bank);
  const report = Math.max(1, Math.round(rate / 2));
  let position = 0;
  const renderTo = (target: number) => {
    while (position < target) {
      const count = Math.min(target - position, report);
      opl.render(out, position, count);
      position += count;
      options.onProgress?.(position / length);
    }
  };
  for (const event of events) {
    renderTo(Math.min(sampleAt(event.tick), length));
    driver.message(event.status, event.a, event.b);
  }
  renderTo(Math.min(sampleAt(end), length));
  // Let the last notes ring out, and stop once the chip is quiet.
  const step = Math.round(rate / 50);
  while (position < length && opl.active) renderTo(Math.min(length, position + step));

  const samples = out.slice(0, position).map((v) => Math.max(-1, Math.min(1, v)));
  return { rate, samples, loopStart: 0, loopEnd: samples.length };
}
