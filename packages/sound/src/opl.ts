/**
 * An emulation of the Yamaha YM3812 (OPL2), the FM chip of the AdLib and Sound Blaster cards. It is driven by register
 * writes, like the real chip, and renders mono samples.
 *
 * It models the chip's behaviour rather than its exact arithmetic: phases, envelopes and levels are computed in floating
 * point from the timings in the YM3812 datasheet, so it sounds like the chip without being bit-exact. Rhythm mode and
 * CSM mode aren't emulated; the game's sound driver doesn't use them.
 */

/** The chip's own sample rate: its 3.58 MHz clock divided by 72. */
export const OPL_RATE = 49716;

const CHANNELS = 9;
const OPERATORS = 18;

const MULTIPLES = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];
/** Key scale attenuation in dB at block 7, by the top 4 bits of the frequency number. */
const KSL_DB = [0, 9, 12, 13.875, 15, 16.125, 16.875, 17.625, 18, 18.75, 19.125, 19.5, 19.875, 20.25, 20.625, 21];
/** Key scale levels 0–3 attenuate by 0, 3, 1.5 and 6 dB per octave. */
const KSL_SCALE = [0, 0.5, 0.25, 1];

/** Envelope times at the slowest usable rate, from the datasheet: attack to full level, decay over 96 dB. */
const ATTACK_SECONDS = 2.826;
const DECAY_SECONDS = 39.28;
const SILENT_DB = 96;

const TREMOLO_HZ = 3.7;
const VIBRATO_HZ = 6.07;

/** The stages of an operator's envelope. */
const Stage = { Off: 0, Attack: 1, Decay: 2, Sustain: 3, Release: 4 } as const;

const TABLE_SIZE = 1024;
/** The four waveforms: sine, half sine, absolute sine and quarter sine pulses. */
const WAVES = [0, 1, 2, 3].map((wave) =>
  Float32Array.from({ length: TABLE_SIZE }, (_, i) => {
    const s = Math.sin((2 * Math.PI * i) / TABLE_SIZE);
    if (wave === 0) return s;
    if (wave === 1) return s > 0 ? s : 0;
    if (wave === 2) return Math.abs(s);
    return i % (TABLE_SIZE / 2) < TABLE_SIZE / 4 ? Math.abs(s) : 0;
  }),
);
/** Amplitude by attenuation, in steps of 1/32 dB. */
const STEPS_PER_DB = 32;
const AMPLITUDE = Float32Array.from({ length: 128 * STEPS_PER_DB }, (_, i) => 10 ** (-i / STEPS_PER_DB / 20));

/** The operator at a register offset (0x00–0x15), or -1 for the gaps. */
const operatorAt = (offset: number) => (offset % 8 < 6 && offset < 0x16 ? (offset >> 3) * 6 + (offset % 8) : -1);
/** The modulator of a channel; its carrier is 3 operators later. */
const modulatorOf = (channel: number) => Math.floor(channel / 3) * 6 + (channel % 3);
const channelOf = (operator: number) => Math.floor(operator / 6) * 3 + (operator % 3);

/** Envelope time at an effective rate of 4–63: it halves every 4 steps, with quarter steps in between. */
const envelopeTime = (base: number, rate: number) => (base * 8) / ((4 + (rate & 3)) * 2 ** (rate >> 2));

export class Opl2 {
  readonly rate: number;
  /** Multiplies the chip's output; at 1, a single operator at full level reaches 1/8 of full scale, as on the card. */
  gain: number;

  // Operator registers.
  private readonly am = new Uint8Array(OPERATORS);
  private readonly vib = new Uint8Array(OPERATORS);
  private readonly sustaining = new Uint8Array(OPERATORS);
  private readonly ksr = new Uint8Array(OPERATORS);
  private readonly mult = new Uint8Array(OPERATORS);
  private readonly ksl = new Uint8Array(OPERATORS);
  private readonly level = new Uint8Array(OPERATORS);
  private readonly attack = new Uint8Array(OPERATORS);
  private readonly decay = new Uint8Array(OPERATORS);
  private readonly sustain = new Uint8Array(OPERATORS);
  private readonly release = new Uint8Array(OPERATORS);
  private readonly wave = new Uint8Array(OPERATORS);
  // Operator state, and values derived from the registers.
  private readonly stage = new Uint8Array(OPERATORS);
  private readonly phase = new Float64Array(OPERATORS);
  private readonly env = new Float64Array(OPERATORS).fill(SILENT_DB);
  private readonly out1 = new Float64Array(OPERATORS);
  private readonly out2 = new Float64Array(OPERATORS);
  private readonly step = new Float64Array(OPERATORS);
  private readonly attackFactor = new Float64Array(OPERATORS);
  private readonly decayStep = new Float64Array(OPERATORS);
  private readonly releaseStep = new Float64Array(OPERATORS);
  private readonly sustainDb = new Float64Array(OPERATORS);
  private readonly fixedDb = new Float64Array(OPERATORS);
  // Channel registers.
  private readonly fnum = new Uint16Array(CHANNELS);
  private readonly block = new Uint8Array(CHANNELS);
  private readonly key = new Uint8Array(CHANNELS);
  private readonly feedback = new Uint8Array(CHANNELS);
  private readonly additive = new Uint8Array(CHANNELS);
  // Chip registers.
  private waveSelect = false;
  private noteSelect = false;
  private deepTremolo = false;
  private deepVibrato = false;
  private lfo = 0;

  constructor(rate = OPL_RATE, gain = 1) {
    this.rate = rate;
    this.gain = gain;
    for (let o = 0; o < OPERATORS; o++) this.refresh(o);
  }

  /** Writes a register, like an `OUT` to the card's ports. */
  write(register: number, value: number): void {
    const group = register & 0xe0;
    const op = operatorAt(register & 0x1f);
    if (register === 0x01) this.waveSelect = (value & 0x20) !== 0;
    else if (register === 0x08) this.noteSelect = (value & 0x40) !== 0;
    else if (register === 0xbd) {
      this.deepTremolo = (value & 0x80) !== 0;
      this.deepVibrato = (value & 0x40) !== 0;
    } else if (group === 0x20 && op >= 0) {
      this.am[op] = value >> 7;
      this.vib[op] = (value >> 6) & 1;
      this.sustaining[op] = (value >> 5) & 1;
      this.ksr[op] = (value >> 4) & 1;
      this.mult[op] = value & 15;
      this.refresh(op);
    } else if (group === 0x40 && op >= 0) {
      this.ksl[op] = value >> 6;
      this.level[op] = value & 63;
      this.refresh(op);
    } else if (group === 0x60 && op >= 0) {
      this.attack[op] = value >> 4;
      this.decay[op] = value & 15;
      this.refresh(op);
    } else if (group === 0x80 && op >= 0) {
      this.sustain[op] = value >> 4;
      this.release[op] = value & 15;
      this.refresh(op);
    } else if (group === 0xe0 && op >= 0) this.wave[op] = value & 3;
    else if (register >= 0xa0 && register <= 0xa8) {
      const ch = register - 0xa0;
      this.fnum[ch] = (this.fnum[ch]! & 0x300) | value;
      this.refreshChannel(ch);
    } else if (register >= 0xb0 && register <= 0xb8) {
      const ch = register - 0xb0;
      this.fnum[ch] = (this.fnum[ch]! & 0xff) | ((value & 3) << 8);
      this.block[ch] = (value >> 2) & 7;
      const on = (value >> 5) & 1;
      if (on !== this.key[ch]) this.keyChange(ch, on === 1);
      this.key[ch] = on;
      this.refreshChannel(ch);
    } else if (register >= 0xc0 && register <= 0xc8) {
      this.feedback[register - 0xc0] = (value >> 1) & 7;
      this.additive[register - 0xc0] = value & 1;
    }
  }

  /** True while any operator still sounds. */
  get active(): boolean {
    return this.stage.some((s) => s !== Stage.Off);
  }

  /** Adds `count` samples of the chip's output to `out` from `start`. */
  render(out: Float32Array, start: number, count: number): void {
    const lfoStep = 1 / this.rate;
    const tremoloDepth = this.deepTremolo ? 4.8 : 1;
    const vibratoDepth = 2 ** ((this.deepVibrato ? 14 : 7) / 1200) - 1;
    const gain = this.gain / 8;
    for (let i = 0; i < count; i++) {
      this.lfo += lfoStep;
      const t = (this.lfo * TREMOLO_HZ) % 1;
      const tremolo = tremoloDepth * (t < 0.5 ? t * 2 : 2 - t * 2);
      const vibrato = 1 + vibratoDepth * Math.sin(2 * Math.PI * VIBRATO_HZ * this.lfo);
      let sum = 0;
      for (let ch = 0; ch < CHANNELS; ch++) {
        const mod = modulatorOf(ch);
        const car = mod + 3;
        if (this.stage[mod] === Stage.Off && this.stage[car] === Stage.Off) continue;
        const fb = this.feedback[ch]!;
        const self = fb ? (this.out1[mod]! + this.out2[mod]!) * 2 ** (fb - 7) : 0;
        const m = this.operator(mod, self, tremolo, vibrato);
        this.out2[mod] = this.out1[mod]!;
        this.out1[mod] = m;
        // A full-scale modulator moves the carrier's phase by 4 cycles.
        sum += this.additive[ch]
          ? m + this.operator(car, 0, tremolo, vibrato)
          : this.operator(car, m * 4, tremolo, vibrato);
      }
      out[start + i]! += sum * gain;
    }
  }

  /** Advances one operator by a sample and returns its output, -1 to 1. `pm` moves its phase, in cycles. */
  private operator(o: number, pm: number, tremolo: number, vibrato: number): number {
    let env = this.env[o]!;
    switch (this.stage[o]) {
      case Stage.Off:
        return 0;
      case Stage.Attack:
        env *= this.attackFactor[o]!;
        if (env < 0.05) {
          env = 0;
          this.stage[o] = Stage.Decay;
        }
        break;
      case Stage.Decay:
        env += this.decayStep[o]!;
        if (env >= this.sustainDb[o]!) {
          env = this.sustainDb[o]!;
          this.stage[o] = Stage.Sustain;
        }
        break;
      case Stage.Sustain:
        // Without the sustain flag, a sound fades at its release rate even while the key is held.
        if (!this.sustaining[o]) env += this.releaseStep[o]!;
        break;
      case Stage.Release:
        env += this.releaseStep[o]!;
        break;
    }
    if (env >= SILENT_DB) {
      env = SILENT_DB;
      if (this.stage[o] !== Stage.Attack) this.stage[o] = Stage.Off;
    }
    this.env[o] = env;
    const phase = this.phase[o]! + this.step[o]! * (this.vib[o] ? vibrato : 1);
    this.phase[o] = phase - Math.floor(phase);
    const db = env + this.fixedDb[o]! + (this.am[o] ? tremolo : 0);
    if (db >= SILENT_DB) return 0;
    const p = phase + pm;
    const index = ((p - Math.floor(p)) * TABLE_SIZE) | 0;
    return WAVES[this.waveSelect ? this.wave[o]! : 0]![index]! * AMPLITUDE[(db * STEPS_PER_DB) | 0]!;
  }

  private keyChange(ch: number, on: boolean) {
    for (const o of [modulatorOf(ch), modulatorOf(ch) + 3]) {
      if (on) {
        this.phase[o] = 0;
        this.stage[o] = Stage.Attack;
        if (this.attackFactor[o] === 0) {
          this.env[o] = 0;
          this.stage[o] = Stage.Decay;
        }
      } else if (this.stage[o] !== Stage.Off) this.stage[o] = Stage.Release;
    }
  }

  private refreshChannel(ch: number) {
    this.refresh(modulatorOf(ch));
    this.refresh(modulatorOf(ch) + 3);
  }

  /** Works out an operator's phase step, envelope speeds and fixed attenuation from its registers. */
  private refresh(o: number) {
    const ch = channelOf(o);
    const fnum = this.fnum[ch]!;
    const block = this.block[ch]!;
    this.step[o] = (fnum * 2 ** block * MULTIPLES[this.mult[o]!]! * OPL_RATE) / 2 ** 20 / this.rate;

    // Higher notes get faster envelopes: by the key code, or a quarter of it without KSR.
    const keyCode = block * 2 + ((this.noteSelect ? fnum >> 8 : fnum >> 9) & 1);
    const offset = this.ksr[o] ? keyCode : keyCode >> 2;
    const effective = (r: number) => (r === 0 ? 0 : Math.min(63, r * 4 + offset));

    const attack = effective(this.attack[o]!);
    // The factor the attenuation is multiplied by each sample; 0 means instant, 1 never.
    if (attack === 0) this.attackFactor[o] = 1;
    else if (attack >= 60) this.attackFactor[o] = 0;
    else this.attackFactor[o] = (1 / 2048) ** (1 / (envelopeTime(ATTACK_SECONDS, attack) * this.rate));
    const fall = (r: number) => (r === 0 ? 0 : SILENT_DB / (envelopeTime(DECAY_SECONDS, Math.min(r, 60)) * this.rate));
    this.decayStep[o] = fall(effective(this.decay[o]!));
    this.releaseStep[o] = fall(effective(this.release[o]!));
    this.sustainDb[o] = this.sustain[o] === 15 ? SILENT_DB : this.sustain[o]! * 3;

    const ksl = Math.max(0, KSL_DB[fnum >> 6]! - 6 * (7 - block)) * KSL_SCALE[this.ksl[o]!]!;
    this.fixedDb[o] = this.level[o]! * 0.75 + ksl;
  }
}
