/**
 * An AdLib MIDI driver for the instruments of Sierra's SCI sound system, which TIM's sound driver bundle `SX.OVL` holds
 * as patch `003`. It turns MIDI events into register writes on an {@link Opl2}.
 *
 * The bank format and how drums use it follow ScummVM's SCI AdLib driver. Voice allocation, the volume curve and the
 * pitch bend range are this driver's own choices, not taken from the game's driver code.
 */

import type { Opl2 } from "./opl.ts";

export interface Operator {
  /** Key scale level, 0–3. */
  ksl: number;
  /** Frequency multiple, 0–15. */
  mult: number;
  attack: number;
  /** Sustain level, 0–15: 3 dB of attenuation per step. */
  sustain: number;
  /** True when the sound holds at its sustain level until the key is released. */
  sustaining: boolean;
  decay: number;
  release: number;
  /** Attenuation, 0–63: 0.75 dB per step. */
  level: number;
  tremolo: boolean;
  vibrato: boolean;
  /** True when higher notes get faster envelopes. */
  ksr: boolean;
  wave: number;
}

export interface Instrument {
  /** The modulator and the carrier. */
  operators: [Operator, Operator];
  feedback: number;
  /** True when both operators are heard, instead of the modulator bending the carrier. */
  additive: boolean;
}

export interface AdlibBank {
  instruments: Instrument[];
  /** The note each drum key (27–88) plays on MIDI channel 10, when the bank has drums. */
  drumNotes?: Uint8Array;
}

const INSTRUMENT_SIZE = 28;
const OPERATOR_SIZE = 13;
const DRUM_FIRST = 27;
const DRUM_LAST = 88;
/** Drum key 27 uses instrument 128, up to key 88 with instrument 189. */
const DRUM_INSTRUMENT = 101;
const DRUM_CHANNEL = 9;
/** Channel 16 carries the game's cues, not notes. */
const CONTROL_CHANNEL = 15;
const VOICES = 9;
const BEND_SEMITONES = 2;

function readInstrument(data: Uint8Array, at: number): Instrument {
  const operator = (i: number): Operator => {
    const op = data.subarray(at + i * OPERATOR_SIZE);
    return {
      ksl: op[0]! & 3,
      mult: op[1]! & 15,
      attack: op[3]! & 15,
      sustain: op[4]! & 15,
      sustaining: op[5] !== 0,
      decay: op[6]! & 15,
      release: op[7]! & 15,
      level: op[8]! & 63,
      tremolo: op[9] !== 0,
      vibrato: op[10] !== 0,
      ksr: op[11] !== 0,
      wave: data[at + 26 + i]! & 3,
    };
  };
  // The connection byte is 1 for FM.
  return { operators: [operator(0), operator(1)], feedback: data[at + 2]! & 7, additive: data[at + 12] === 0 };
}

/**
 * Reads an AdLib instrument bank (SCI patch 3): 28 bytes per instrument, two 13-byte operators and the waveforms. It
 * comes in three sizes: 48 instruments, 96 with two bytes between the halves, or 190 followed by 62 drum notes.
 */
export function readAdlibBank(data: Uint8Array): AdlibBank {
  const at = (i: number) => i * INSTRUMENT_SIZE;
  switch (data.length) {
    case 1344:
      return { instruments: Array.from({ length: 48 }, (_, i) => readInstrument(data, at(i))) };
    case 2690:
      return { instruments: Array.from({ length: 96 }, (_, i) => readInstrument(data, at(i) + (i < 48 ? 0 : 2))) };
    case 5382:
      return {
        instruments: Array.from({ length: 190 }, (_, i) => readInstrument(data, at(i))),
        drumNotes: data.slice(190 * INSTRUMENT_SIZE, 190 * INSTRUMENT_SIZE + DRUM_LAST - DRUM_FIRST + 1),
      };
    default:
      throw new Error(`An AdLib bank of ${data.length} bytes isn't a known size`);
  }
}

interface Voice {
  /** The MIDI channel and key that play it, or -1 when free. */
  channel: number;
  key: number;
  instrument: number;
  velocity: number;
  /** Released by the sustain pedal, not yet by a note off. */
  held: boolean;
  /** When the voice was started or released, to find the oldest. */
  since: number;
}

interface Channel {
  program: number;
  volume: number;
  /** -1 to 1. */
  bend: number;
  pedal: boolean;
}

const MODULATOR_OFFSETS = [0x00, 0x01, 0x02, 0x08, 0x09, 0x0a, 0x10, 0x11, 0x12];

export class AdlibDriver {
  private readonly voices: Voice[] = Array.from({ length: VOICES }, () => ({
    channel: -1,
    key: 0,
    instrument: -1,
    velocity: 0,
    held: false,
    since: 0,
  }));
  private readonly channels: Channel[] = Array.from({ length: 16 }, () => ({
    program: 0,
    volume: 127,
    bend: 0,
    pedal: false,
  }));
  private clock = 0;
  private readonly opl: Opl2;
  private readonly bank: AdlibBank;

  constructor(opl: Opl2, bank: AdlibBank) {
    this.opl = opl;
    this.bank = bank;
    opl.write(0x01, 0x20);
    opl.write(0x08, 0);
    opl.write(0xbd, 0);
  }

  /** Handles one MIDI channel message: a status byte and up to two data bytes. */
  message(status: number, a: number, b: number): void {
    const channel = status & 15;
    if (channel === CONTROL_CHANNEL) return;
    this.clock++;
    switch (status & 0xf0) {
      case 0x80:
        return this.noteOff(channel, a);
      case 0x90:
        return b ? this.noteOn(channel, a, b) : this.noteOff(channel, a);
      case 0xb0:
        return this.control(channel, a, b);
      case 0xc0:
        this.channels[channel]!.program = a;
        return;
      case 0xe0:
        this.channels[channel]!.bend = ((b << 7) | a) / 8192 - 1;
        this.voices.forEach((v, i) => v.channel === channel && this.frequency(i, true));
        return;
    }
  }

  private control(channel: number, controller: number, value: number) {
    const state = this.channels[channel]!;
    if (controller === 7) {
      state.volume = value;
      this.voices.forEach((v, i) => v.channel === channel && this.loudness(i));
    } else if (controller === 64) {
      state.pedal = value >= 64;
      if (!state.pedal) this.voices.forEach((v, i) => v.channel === channel && v.held && this.release(i));
    } else if (controller === 123) this.voices.forEach((v, i) => v.channel === channel && this.release(i));
  }

  private noteOn(channel: number, key: number, velocity: number) {
    const drum = channel === DRUM_CHANNEL && this.bank.drumNotes;
    if (channel === DRUM_CHANNEL && !drum) return;
    const instrument = drum
      ? Math.min(DRUM_LAST, Math.max(DRUM_FIRST, key)) + DRUM_INSTRUMENT
      : this.channels[channel]!.program;
    if (!this.bank.instruments[instrument]) return;
    const index = this.pick(channel, key, instrument);
    const voice = this.voices[index]!;
    if (voice.channel >= 0) this.opl.write(0xb0 + index, 0);
    if (voice.instrument !== instrument) this.program(index, instrument);
    Object.assign(voice, { channel, key, instrument, velocity, held: false, since: this.clock });
    this.loudness(index);
    this.frequency(index, true);
  }

  private noteOff(channel: number, key: number) {
    this.voices.forEach((v, i) => {
      if (v.channel !== channel || v.key !== key || v.held) return;
      if (this.channels[channel]!.pedal) v.held = true;
      else this.release(i);
    });
  }

  private release(index: number) {
    this.frequency(index, false);
    const voice = this.voices[index]!;
    voice.channel = -1;
    voice.held = false;
    voice.since = this.clock;
  }

  /**
   * Picks a voice for a note: the one already playing this key, a free one that last played this instrument, the free
   * one released longest ago, or else the oldest playing note.
   */
  private pick(channel: number, key: number, instrument: number): number {
    const same = this.voices.findIndex((v) => v.channel === channel && v.key === key);
    if (same >= 0) return same;
    const free = this.voices.map((v, i) => ({ v, i })).filter(({ v }) => v.channel < 0);
    const pool = free.length ? free : this.voices.map((v, i) => ({ v, i }));
    const reuse = free.find(({ v }) => v.instrument === instrument);
    if (reuse) return reuse.i;
    return pool.reduce((oldest, x) => (x.v.since < oldest.v.since ? x : oldest)).i;
  }

  private program(index: number, instrument: number) {
    const ins = this.bank.instruments[instrument]!;
    this.voices[index]!.instrument = instrument;
    ins.operators.forEach((op, i) => {
      const reg = MODULATOR_OFFSETS[index]! + i * 3;
      this.opl.write(
        0x20 + reg,
        (+op.tremolo << 7) | (+op.vibrato << 6) | (+op.sustaining << 5) | (+op.ksr << 4) | op.mult,
      );
      this.opl.write(0x40 + reg, (op.ksl << 6) | op.level);
      this.opl.write(0x60 + reg, (op.attack << 4) | op.decay);
      this.opl.write(0x80 + reg, (op.sustain << 4) | op.release);
      this.opl.write(0xe0 + reg, op.wave);
    });
    this.opl.write(0xc0 + index, (ins.feedback << 1) | (ins.additive ? 0 : 1));
  }

  /**
   * Sets the level of the operators that are heard: the carrier, and the modulator too in additive instruments. Note
   * velocity and channel volume each attenuate by up to 40 dB along a squared curve, as General MIDI does.
   */
  private loudness(index: number) {
    const voice = this.voices[index]!;
    const ins = this.bank.instruments[voice.instrument];
    if (!ins || voice.channel < 0) return;
    const scale = (voice.velocity / 127) * (this.channels[voice.channel]!.volume / 127);
    const extra = scale <= 0 ? 63 : Math.round((-40 * Math.log10(scale)) / 0.75);
    ins.operators.forEach((op, i) => {
      if (i === 0 && !ins.additive) return;
      const reg = MODULATOR_OFFSETS[index]! + i * 3;
      this.opl.write(0x40 + reg, (op.ksl << 6) | Math.min(63, op.level + extra));
    });
  }

  /** Writes a voice's frequency, with the key on or off. Drums play the note the bank gives their key. */
  private frequency(index: number, on: boolean) {
    const voice = this.voices[index]!;
    let note = voice.key;
    if (voice.channel === DRUM_CHANNEL && this.bank.drumNotes)
      note = this.bank.drumNotes[Math.min(DRUM_LAST, Math.max(DRUM_FIRST, note)) - DRUM_FIRST]!;
    const bend = voice.channel >= 0 ? this.channels[voice.channel]!.bend * BEND_SEMITONES : 0;
    const hz = 440 * 2 ** ((note + bend - 69) / 12);
    let block = 0;
    let fnum = (hz * 2 ** 20) / 49716;
    while (fnum >= 1024 && block < 7) {
      block++;
      fnum /= 2;
    }
    const f = Math.min(1023, Math.round(fnum));
    this.opl.write(0xa0 + index, f & 0xff);
    this.opl.write(0xb0 + index, (on ? 0x20 : 0) | (block << 2) | (f >> 8));
  }
}
