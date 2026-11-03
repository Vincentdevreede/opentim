/**
 * An emulation of the Yamaha YM3812 (OPL2), the FM chip of the AdLib and Sound Blaster cards. It is driven by register
 * writes, like the real chip, and renders mono samples at the chip's own rate.
 *
 * It works the way the chip does, in integers: a 10-bit phase per operator, the chip's log-sine and exponent tables,
 * its envelope counters, and the tremolo and vibrato steps. This is a port of the 2-operator part of Nuked OPL3 by
 * Nuke.YKT (LGPL 2.1 or later), which was worked out from decapped chips, and it gives the same samples. Rhythm mode
 * and CSM mode are left out, since the game's sound driver uses neither.
 */

/** The chip's own sample rate: its 3.58 MHz clock divided by 72. */
export const OPL_RATE = 49716;

const CHANNELS = 9;
const OPERATORS = 18;

/** The chip's ROMs, which follow these formulas exactly: -log2(sin) and 2^x, both in 1/256 steps. */
const LOG_SIN = Uint16Array.from({ length: 256 }, (_, i) =>
  Math.round(-Math.log2(Math.sin(((i + 0.5) * Math.PI) / 512)) * 256),
);
const EXP = Uint16Array.from({ length: 256 }, (_, i) => Math.round(2 ** ((255 - i) / 256) * 1024));

/** Frequency multiples, doubled: 1/2, 1, 2, 3 … 15. */
const MULTIPLES = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];
const KSL_ROM = [0, 32, 40, 45, 48, 51, 53, 55, 56, 58, 59, 60, 61, 62, 63, 64];
/** Key scale levels 0–3 attenuate by 0, 3, 1.5 and 6 dB per octave. */
const KSL_SHIFT = [8, 1, 2, 0];
const EG_STEPS = [
  [0, 0, 0, 0],
  [1, 0, 0, 0],
  [1, 0, 1, 0],
  [1, 1, 1, 0],
];

/** The stages of an operator's envelope. */
const Stage = { Attack: 0, Decay: 1, Sustain: 2, Release: 3 } as const;
/** An envelope's attenuation, 9 bits of 0.1875 dB, when silent. */
const SILENT = 0x1ff;
/** The envelope counter wraps after 36 bits. */
const EG_TIMER_WRAP = 2 ** 36 - 1;

/** The operator at a register offset (0x00–0x15), or -1 for the gaps. */
const operatorAt = (offset: number) => (offset % 8 < 6 && offset < 0x16 ? (offset >> 3) * 6 + (offset % 8) : -1);
const CHANNEL_OF = Uint8Array.from({ length: OPERATORS }, (_, o) => Math.floor(o / 6) * 3 + (o % 3));
/** 1 for the second operator of a channel, the carrier. */
const CARRIER = Uint8Array.from({ length: OPERATORS }, (_, o) => (o % 6 >= 3 ? 1 : 0));
const MODULATOR_OF = Uint8Array.from({ length: CHANNELS }, (_, ch) => Math.floor(ch / 3) * 6 + (ch % 3));

/** 2^-level, from the exponent ROM: 4084 at level 0, down to 0 from level 0x1000 or so. */
function exp(level: number): number {
  if (level > 0x1fff) level = 0x1fff;
  return (EXP[level & 0xff]! << 1) >> (level >> 8);
}

/** An operator's output for a 10-bit phase and an attenuation, with one of the four OPL2 waveforms. */
function wave(waveform: number, phase: number, attenuation: number): number {
  phase &= 0x3ff;
  const quarter = phase & 0x100 ? LOG_SIN[(phase & 0xff) ^ 0xff]! : LOG_SIN[phase & 0xff]!;
  const level = attenuation << 3;
  switch (waveform) {
    case 0: {
      // A sine; the negative half is the ones' complement, as on the chip.
      const out = exp(quarter + level);
      return phase & 0x200 ? ~out : out;
    }
    case 1:
      // The positive half of a sine.
      return phase & 0x200 ? 0 : exp(quarter + level);
    case 2:
      // Both halves positive.
      return exp(quarter + level);
    default:
      // The rising quarter of each half.
      return phase & 0x100 ? 0 : exp(LOG_SIN[phase & 0xff]! + level);
  }
}

export class Opl2 {
  readonly rate = OPL_RATE;
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
  private readonly waveform = new Uint8Array(OPERATORS);
  // Operator state.
  private readonly key = new Uint8Array(OPERATORS);
  private readonly stage = new Uint8Array(OPERATORS).fill(Stage.Release);
  private readonly env = new Uint16Array(OPERATORS).fill(SILENT);
  private readonly envOut = new Uint16Array(OPERATORS).fill(SILENT);
  private readonly kslLevel = new Uint8Array(OPERATORS);
  private readonly phase = new Uint32Array(OPERATORS);
  private readonly phaseReset = new Uint8Array(OPERATORS);
  private readonly out = new Int16Array(OPERATORS);
  private readonly previous = new Int16Array(OPERATORS);
  // Channel registers.
  private readonly fnum = new Uint16Array(CHANNELS);
  private readonly block = new Uint8Array(CHANNELS);
  private readonly keyScale = new Uint8Array(CHANNELS);
  private readonly feedback = new Uint8Array(CHANNELS);
  private readonly additive = new Uint8Array(CHANNELS);
  // Chip state.
  private waveSelect = false;
  private noteSelect = 0;
  private timer = 0;
  private tremoloPos = 0;
  private tremolo = 0;
  private tremoloShift = 4;
  private vibratoPos = 0;
  private vibratoShift = 1;
  private egTimer = 0;
  private egCarry = 0;
  private egState = 0;
  private egAdd = 0;
  private egTimerLow = 0;

  constructor(gain = 1) {
    this.gain = gain;
  }

  /** Writes a register, like an `OUT` to the card's ports. */
  write(register: number, value: number): void {
    const group = register & 0xe0;
    const op = operatorAt(register & 0x1f);
    if (register === 0x01) this.waveSelect = (value & 0x20) !== 0;
    else if (register === 0x08) this.noteSelect = (value >> 6) & 1;
    else if (register === 0xbd) {
      this.tremoloShift = (((value >> 7) ^ 1) << 1) + 2;
      this.vibratoShift = ((value >> 6) & 1) ^ 1;
    } else if (group === 0x20 && op >= 0) {
      this.am[op] = value >> 7;
      this.vib[op] = (value >> 6) & 1;
      this.sustaining[op] = (value >> 5) & 1;
      this.ksr[op] = (value >> 4) & 1;
      this.mult[op] = value & 15;
    } else if (group === 0x40 && op >= 0) {
      this.ksl[op] = value >> 6;
      this.level[op] = value & 63;
      this.updateKsl(op);
    } else if (group === 0x60 && op >= 0) {
      this.attack[op] = value >> 4;
      this.decay[op] = value & 15;
    } else if (group === 0x80 && op >= 0) {
      this.sustain[op] = value >> 4 === 15 ? 0x1f : value >> 4;
      this.release[op] = value & 15;
    } else if (group === 0xe0 && op >= 0) this.waveform[op] = value & 3;
    else if (register >= 0xa0 && register <= 0xa8) {
      const ch = register - 0xa0;
      this.fnum[ch] = (this.fnum[ch]! & 0x300) | value;
      this.updateFrequency(ch);
    } else if (register >= 0xb0 && register <= 0xb8) {
      const ch = register - 0xb0;
      this.fnum[ch] = (this.fnum[ch]! & 0xff) | ((value & 3) << 8);
      this.block[ch] = (value >> 2) & 7;
      this.updateFrequency(ch);
      const mod = MODULATOR_OF[ch]!;
      this.key[mod] = this.key[mod + 3] = (value >> 5) & 1;
    } else if (register >= 0xc0 && register <= 0xc8) {
      this.feedback[register - 0xc0] = (value >> 1) & 7;
      this.additive[register - 0xc0] = value & 1;
    }
  }

  /** True while any operator still sounds. */
  get active(): boolean {
    for (let o = 0; o < OPERATORS; o++) if (this.key[o] || (this.env[o]! & 0x1f8) !== 0x1f8) return true;
    return false;
  }

  /** Adds `count` samples of the chip's output to `out` from `start`. */
  render(out: Float32Array, start: number, count: number): void {
    const gain = this.gain / 32768;
    for (let i = 0; i < count; i++) out[start + i]! += this.sample() * gain;
  }

  /** Runs the chip for one sample and returns its output as a 16-bit value. */
  private sample(): number {
    for (let o = 0; o < OPERATORS; o++) {
      const ch = CHANNEL_OF[o]!;
      const carrier = CARRIER[o]!;
      // Feedback is the mean of the modulator's last two outputs, scaled.
      const fb = this.feedback[ch]!;
      const feedback = fb && !carrier ? (this.previous[o]! + this.out[o]!) >> (9 - fb) : 0;
      this.previous[o] = this.out[o]!;
      this.envelope(o, ch);
      const phase = this.advance(o, ch);
      const mod = carrier ? (this.additive[ch] ? 0 : this.out[o - 3]!) : feedback;
      this.out[o] = wave(this.waveSelect ? this.waveform[o]! : 0, phase + mod, this.envOut[o]!);
    }
    let mix = 0;
    for (let ch = 0; ch < CHANNELS; ch++) {
      const mod = MODULATOR_OF[ch]!;
      mix += this.out[mod + 3]! + (this.additive[ch] ? this.out[mod]! : 0);
    }
    this.tick();
    return Math.max(-32768, Math.min(32767, mix));
  }

  /** Steps the chip's counters: tremolo, vibrato and the envelope clock. */
  private tick() {
    if ((this.timer & 0x3f) === 0x3f) this.tremoloPos = (this.tremoloPos + 1) % 210;
    this.tremolo = (this.tremoloPos < 105 ? this.tremoloPos : 210 - this.tremoloPos) >> this.tremoloShift;
    if ((this.timer & 0x3ff) === 0x3ff) this.vibratoPos = (this.vibratoPos + 1) & 7;
    this.timer = (this.timer + 1) & 0xffff;
    if (this.egState) {
      // One more than the number of trailing zero bits, or 0 when the low 13 bits are all zero.
      const low = this.egTimer % 0x2000;
      this.egAdd = low ? 32 - Math.clz32(low & -low) : 0;
      this.egTimerLow = this.egTimer % 4;
    }
    if (this.egCarry || this.egState) {
      if (this.egTimer === EG_TIMER_WRAP) {
        this.egTimer = 0;
        this.egCarry = 1;
      } else {
        this.egTimer++;
        this.egCarry = 0;
      }
    }
    this.egState ^= 1;
  }

  /** Moves an operator's envelope on by a sample. */
  private envelope(o: number, ch: number) {
    const tremolo = this.am[o] ? this.tremolo : 0;
    this.envOut[o] = this.env[o]! + (this.level[o]! << 2) + (this.kslLevel[o]! >> KSL_SHIFT[this.ksl[o]!]!) + tremolo;
    const stage = this.stage[o]!;
    const key = this.key[o]!;
    // A key pressed while releasing starts the attack again, from where the envelope is.
    const reset = key && stage === Stage.Release;
    let rate: number;
    if (reset || stage === Stage.Attack) rate = this.attack[o]!;
    else if (stage === Stage.Decay) rate = this.decay[o]!;
    else if (stage === Stage.Sustain) rate = this.sustaining[o] ? 0 : this.release[o]!;
    else rate = this.release[o]!;
    this.phaseReset[o] = reset ? 1 : 0;

    const ks = this.keyScale[ch]! >> ((this.ksr[o]! ^ 1) << 1);
    const effective = ks + (rate << 2);
    let rateHigh = effective >> 2;
    const rateLow = effective & 3;
    if (rateHigh & 0x10) rateHigh = 0x0f;
    let shift = 0;
    if (rate !== 0) {
      if (rateHigh < 12) {
        if (this.egState) {
          const egShift = rateHigh + this.egAdd;
          if (egShift === 12) shift = 1;
          else if (egShift === 13) shift = (rateLow >> 1) & 1;
          else if (egShift === 14) shift = rateLow & 1;
        }
      } else {
        shift = (rateHigh & 3) + EG_STEPS[rateLow]![this.egTimerLow]!;
        if (shift & 4) shift = 3;
        if (!shift) shift = this.egState;
      }
    }

    const current = this.env[o]!;
    let env = current;
    let inc = 0;
    if (reset && rateHigh === 0x0f) env = 0;
    const off = (current & 0x1f8) === 0x1f8;
    if (stage !== Stage.Attack && !reset && off) env = SILENT;
    if (stage === Stage.Attack) {
      if (current === 0) this.stage[o] = Stage.Decay;
      else if (key && shift > 0 && rateHigh !== 0x0f) inc = ~current >> (4 - shift);
    } else if (stage === Stage.Decay) {
      if (current >> 4 === this.sustain[o]) this.stage[o] = Stage.Sustain;
      else if (!off && !reset && shift > 0) inc = 1 << (shift - 1);
    } else if (!off && !reset && shift > 0) inc = 1 << (shift - 1);
    this.env[o] = (env + inc) & 0x1ff;
    if (reset) this.stage[o] = Stage.Attack;
    if (!key) this.stage[o] = Stage.Release;
  }

  /** Moves an operator's phase on by a sample, and returns the 10-bit phase it had. */
  private advance(o: number, ch: number): number {
    let fnum = this.fnum[ch]!;
    if (this.vib[o]) {
      let range = (fnum >> 7) & 7;
      const pos = this.vibratoPos;
      if (!(pos & 3)) range = 0;
      else if (pos & 1) range >>= 1;
      range >>= this.vibratoShift;
      if (pos & 4) range = -range;
      fnum += range;
    }
    const base = (fnum << this.block[ch]!) >> 1;
    const phase = (this.phase[o]! >>> 9) & 0x3ff;
    if (this.phaseReset[o]) this.phase[o] = 0;
    this.phase[o] = this.phase[o]! + ((base * MULTIPLES[this.mult[o]!]!) >> 1);
    return phase;
  }

  private updateFrequency(ch: number) {
    this.keyScale[ch] = (this.block[ch]! << 1) | ((this.fnum[ch]! >> (9 - this.noteSelect)) & 1);
    const mod = MODULATOR_OF[ch]!;
    this.updateKsl(mod);
    this.updateKsl(mod + 3);
  }

  private updateKsl(o: number) {
    const ch = CHANNEL_OF[o]!;
    this.kslLevel[o] = Math.max(0, (KSL_ROM[this.fnum[ch]! >> 6]! << 2) - ((8 - this.block[ch]!) << 5));
  }
}
