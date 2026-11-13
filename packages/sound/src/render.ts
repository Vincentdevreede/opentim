/** Rendering the sounds of the game to samples that can be played or saved. */

import { readSoundTracks, type Sample } from "@opentim/resources";
import { AdlibDriver, type AdlibBank, type FmCard } from "./adlib.ts";
import { OPL_RATE, Opl2 } from "./opl.ts";
import { TICKS_PER_SECOND, mergeTracks, readTrackEvents } from "./sequence.ts";

/** Audio as floats from -1 to 1: mono, or stereo when it has a right channel. */
export interface Pcm {
  rate: number;
  /** The samples, or the left channel's in stereo. */
  samples: Float32Array;
  right?: Float32Array;
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
/**
 * The chip samples that pass during one register write: the driver waits about 40 µs after each, reading the card's
 * status port. It matters when a voice is keyed off and on again, which the chip only sees if time passes in between.
 */
const WRITE_SAMPLES = 2;
/** Channel 16 carries the game's cues; the sound system handles it and the driver never sees it. */
const CONTROL_CHANNEL = 15;

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
  /** The card whose driver plays the tracks; the AdLib by default. */
  card?: FmCard;
  /** Give a new note a free voice with the channel's instrument first, as the longer `ADL` driver does. */
  sameInstrumentFirst?: boolean;
  /** Called while rendering, with the part done from 0 to 1. */
  onProgress?: (done: number) => void;
}

/** True when an unpacked sound has MIDI tracks for the AdLib. */
export const hasAdlibTracks = (sound: Uint8Array) =>
  readSoundTracks(sound).some((d) => d.id === ADLIB_DEVICE && d.tracks.some((t) => !t.sample));

/**
 * Plays the AdLib MIDI tracks of an unpacked SCI sound with the game's instruments and FM driver, at the chip's own
 * rate: on one emulated chip for the AdLib, or on two, left and right, for the Sound Blaster Pro. A digitized sample
 * among those tracks is left out; {@link samplePcm} converts it on its own.
 */
export function renderAdlib(sound: Uint8Array, bank: AdlibBank, options: RenderOptions = {}): Pcm {
  const rate = OPL_RATE;
  const device = readSoundTracks(sound).find((d) => d.id === ADLIB_DEVICE);
  if (!device) throw new Error("The sound has no tracks for the AdLib");
  const tracks = device.tracks.filter((t) => !t.sample).map((t) => readTrackEvents(t.data.subarray(2)));
  const events = mergeTracks(tracks.map((t) => t.events));
  const end = Math.max(0, ...tracks.map((t) => t.end));
  const sampleAt = (tick: number) => Math.round((tick / TICKS_PER_SECOND) * rate);

  const length = Math.min(sampleAt(end) + TAIL_SECONDS * rate, MAX_SECONDS * rate);
  const card = options.card ?? "adlib";
  // One chip, or the Sound Blaster Pro's two.
  const chips = card === "sbpro" ? [new Opl2(OPL_GAIN), new Opl2(OPL_GAIN)] : [new Opl2(OPL_GAIN)];
  const outs = chips.map(() => new Float32Array(length));
  const report = Math.max(1, Math.round(rate / 2));
  let position = 0;
  const renderTo = (target: number) => {
    while (position < target) {
      const count = Math.min(target - position, report);
      chips.forEach((chip, i) => chip.render(outs[i]!, position, count));
      position += count;
      options.onProgress?.(position / length);
    }
  };
  // The driver's reset happens before the sound starts; after that, each write takes time.
  let timed = false;
  const write = (register: number, value: number, chip?: number) => {
    if (chip === undefined) chips.forEach((c) => c.write(register, value));
    else chips[chip]!.write(register, value);
    if (timed) renderTo(Math.min(position + WRITE_SAMPLES, length));
  };
  const driver = new AdlibDriver({ write }, bank, card, { sameInstrumentFirst: options.sameInstrumentFirst });
  timed = true;
  for (const event of events) {
    if ((event.status & 15) === CONTROL_CHANNEL) continue;
    renderTo(Math.min(sampleAt(event.tick), length));
    driver.message(event.status, event.a, event.b);
  }
  renderTo(Math.min(sampleAt(end), length));
  // Let the last notes ring out, and stop once the chip is quiet.
  const step = Math.round(rate / 50);
  while (position < length && chips.some((c) => c.active)) renderTo(Math.min(length, position + step));

  // The driver means a high pan to play on the right: its OPL3 code, switched off in the game's copy, sends the chip
  // at 220h to the right speaker. The first Sound Blaster Pro had that chip on the left, so it played mirrored there.
  const clipped = outs.map((out) => out.slice(0, position).map((v) => Math.max(-1, Math.min(1, v))));
  const [samples, right] = clipped.length === 2 ? [clipped[1]!, clipped[0]!] : [clipped[0]!];
  return { rate, samples, ...(right && { right }), loopStart: 0, loopEnd: samples.length };
}
