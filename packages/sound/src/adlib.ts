/**
 * The AdLib MIDI driver of TIM's sound driver bundle `SX.OVL` ("AdLib Music Synthesizer Card", the `ADL` file), redone
 * from its code. It plays the instruments of patch `003` on an OPL2 and turns MIDI events into the same register
 * writes: the same voice allocation, the same volume tables, pitch in quarter semitones with a bend of up to an octave,
 * and drums on MIDI channel 10. The tables below are the driver's own, the same in every version of the games.
 */

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

/**
 * Where the driver sends its register writes: an {@link Opl2}, or something that times them. On the Sound Blaster Pro,
 * `chip` is 0 for the chip at port 220h, which gets louder as the pan goes up, and 1 for the one at 222h; writes
 * without it go to port 388h, which reaches both.
 */
export interface OplPort {
  write(register: number, value: number, chip?: number): void;
}

/**
 * The cards the game's FM driver comes in. `adlib` is the `ADL` driver, one chip in mono. `sbpro` is the `SBP` driver
 * for the first Sound Blaster Pro and its two chips, one per side: it plays the same notes on both and sets each voice's
 * level per side from the pan controller.
 */
export type FmCard = "adlib" | "sbpro";

const VOICES = 9;
const DRUM_CHANNEL = 9;
/** Drum key 27 uses instrument 128, up to key 88 with instrument 189. */
const DRUM_INSTRUMENT = 101;
/** Notes outside this range are ignored. */
const LOWEST_NOTE = 12;
const HIGHEST_NOTE = 107;
const FREE = 0xff;
const BEND_CENTRE = 0x2000;
/** A bend step is a quarter semitone: 8192 / 171 makes 47 steps, almost an octave. */
const BEND_STEP = 171;
const HIGHEST_PITCH = 0x1fc;

/** F-numbers for each quarter semitone of an octave, from C. */
const FREQUENCIES = [
  0x157, 0x15c, 0x161, 0x166, 0x16b, 0x171, 0x176, 0x17b, 0x181, 0x186, 0x18c, 0x192, 0x198, 0x19e, 0x1a4, 0x1aa, 0x1b0,
  0x1b6, 0x1bd, 0x1c3, 0x1ca, 0x1d0, 0x1d7, 0x1de, 0x1e5, 0x1ec, 0x1f3, 0x1fa, 0x202, 0x209, 0x211, 0x218, 0x220, 0x228,
  0x230, 0x238, 0x241, 0x249, 0x252, 0x25a, 0x263, 0x26c, 0x275, 0x27e, 0x287, 0x290, 0x29a, 0x2a4,
];
/** Note velocity (halved) to loudness, 0–63. */
const VELOCITIES = [
  0, 12, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 26, 27, 28, 29, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 45,
  45, 46, 47, 48, 49, 50, 50, 51, 52, 52, 53, 54, 54, 55, 56, 56, 57, 58, 59, 59, 59, 60, 60, 60, 61, 61, 61, 62, 62,
  62, 62, 63, 63, 63,
];
/** Loudness to the share of an operator's level that is heard, in 63rds. */
const LEVELS = [
  0, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
  47, 48, 49, 50, 50, 51, 52, 52, 53, 54, 54, 55, 56, 56, 57, 57, 58, 58, 59, 59, 59, 60, 60, 60, 61, 61, 61, 62, 62,
  62, 62, 63, 63, 63,
];

/** The operators of each voice, and their register offsets. */
const MODULATORS = [0, 1, 2, 6, 7, 8, 12, 13, 14];
const OFFSETS = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
];

interface Voice {
  /** The MIDI channel that last played on it. */
  channel: number;
  /** The note it plays, or {@link FREE}. */
  note: number;
  /** The note's velocity, halved. */
  velocity: number;
  /** Released while the sustain pedal is down. */
  held: boolean;
  /** The instrument it is set up for, or {@link FREE}. */
  instrument: number;
  /** The channel it is reserved for by controller 75, or {@link FREE}. */
  reservedFor: number;
}

interface Channel {
  program: number;
  /** Controller 7, halved. */
  volume: number;
  pan: number;
  pedal: number;
  /** The pitch wheel, 0–0x3FFF with the centre at 0x2000. */
  bend: number;
  /** Voices reserved for the channel, and those it asked for beyond the free ones. */
  reserved: number;
  wanted: number;
  /** Notes playing. */
  playing: number;
}

/**
 * Plays MIDI channel messages on an OPL2 as the game's AdLib driver does, or on two as its Sound Blaster Pro driver
 * does. Each of the chip's 9 voices plays one note.
 * A new note takes the free voice used longest ago; when none is free, it takes a voice from the channel that plays the
 * most notes beyond the voices it reserved with controller 75, or else from its own channel.
 */
export class AdlibDriver {
  private readonly voices: Voice[] = Array.from({ length: VOICES }, () => ({
    channel: FREE,
    note: FREE,
    velocity: 0,
    held: false,
    instrument: FREE,
    reservedFor: FREE,
  }));
  /** The voices in the order they were last used, the longest ago first. */
  private readonly order = Array.from({ length: VOICES }, (_, i) => i);
  private readonly channels: Channel[] = Array.from({ length: 16 }, () => ({
    program: 0,
    volume: 63,
    pan: 64,
    pedal: 0,
    bend: BEND_CENTRE,
    reserved: 0,
    wanted: 0,
    playing: 0,
  }));
  /** The driver's master volume, 0–15. */
  private readonly master = 15;
  private readonly opl: OplPort;
  private readonly bank: AdlibBank;
  private readonly card: FmCard;

  constructor(opl: OplPort, bank: AdlibBank, card: FmCard = "adlib") {
    this.opl = opl;
    this.bank = bank;
    this.card = card;
    // The driver's reset: clear every register and enable the waveforms.
    for (let r = 0; r < 0xf6; r++) opl.write(r, 0);
    opl.write(0x01, 0x20);
  }

  /** Handles one MIDI channel message: a status byte and up to two data bytes. */
  message(status: number, a: number, b: number): void {
    const channel = status & 15;
    switch (status & 0xf0) {
      case 0x80:
        return this.noteOff(channel, a);
      case 0x90:
        return b ? this.noteOn(channel, a, b) : this.noteOff(channel, a);
      case 0xb0:
        return this.control(channel, a, b);
      case 0xc0:
        // The new instrument is set up when the channel's next note starts.
        this.channels[channel]!.program = a;
        return;
      case 0xe0:
        this.channels[channel]!.bend = (b << 7) | a;
        this.voices.forEach((v, i) => v.channel === channel && v.note !== FREE && this.setNote(i, v.note, true));
        return;
    }
  }

  private control(channel: number, controller: number, value: number) {
    const state = this.channels[channel]!;
    const playing = (each: (voice: number) => void) =>
      this.voices.forEach((v, i) => v.channel === channel && v.note !== FREE && each(i));
    switch (controller) {
      case 7:
        state.volume = value >> 1;
        return playing((i) => this.setNote(i, this.voices[i]!.note, true));
      case 10:
        // Pan: the Sound Blaster Pro driver sets the levels of each side from it; the AdLib driver stores it.
        state.pan = value;
        return playing((i) => this.setNote(i, this.voices[i]!.note, true));
      case 64:
        state.pedal = value;
        if (!value) this.voices.forEach((v, i) => v.channel === channel && v.held && this.voiceOff(i));
        return;
      case 75:
        return this.reserve(channel, value);
      case 123:
        return playing((i) => this.voiceOff(i));
    }
  }

  private noteOff(channel: number, note: number) {
    this.voices.forEach((v, i) => {
      if (v.channel !== channel || v.note !== note) return;
      if (this.channels[channel]!.pedal) v.held = true;
      else this.voiceOff(i);
    });
  }

  private noteOn(channel: number, note: number, velocity: number) {
    if (note < LOWEST_NOTE || note > HIGHEST_NOTE) return;
    velocity >>= 1;
    const same = this.voices.findIndex((v) => v.channel === channel && v.note === note);
    if (same >= 0) {
      this.voiceOff(same);
      return this.start(same, note, velocity);
    }
    const voice = this.allocate(channel);
    if (voice >= 0) this.start(voice, note, velocity);
  }

  /** Finds a voice for a new note on a channel, or -1 when the note is dropped. */
  private allocate(channel: number): number {
    for (const i of this.order) {
      if (this.voices[i]!.note === FREE) {
        this.voices[i]!.channel = channel;
        return i;
      }
    }
    // Take a voice from the channel furthest over its reservation, or else from this channel.
    let over = 0;
    let from = channel;
    this.channels.forEach((c, i) => {
      const extra = c.playing - c.reserved;
      if (extra > over) {
        over = extra;
        from = i;
      }
    });
    for (const i of this.order) {
      if (this.voices[i]!.channel === from) {
        this.voiceOff(i);
        this.voices[i]!.channel = channel;
        return i;
      }
    }
    return -1;
  }

  private start(index: number, note: number, velocity: number) {
    const voice = this.voices[index]!;
    const channel = this.channels[voice.channel]!;
    channel.playing++;
    this.touch(index);
    const instrument =
      voice.channel === DRUM_CHANNEL
        ? Math.min(DRUM_LAST, Math.max(DRUM_FIRST, note)) + DRUM_INSTRUMENT
        : channel.program;
    if (instrument !== voice.instrument) {
      voice.instrument = instrument;
      this.program(index, instrument);
    }
    voice.velocity = velocity;
    this.setNote(index, note, true);
  }

  private voiceOff(index: number) {
    const voice = this.voices[index]!;
    voice.held = false;
    this.setNote(index, voice.note, false);
    voice.note = FREE;
    this.touch(index);
    this.channels[voice.channel]!.playing--;
  }

  /** Moves a voice to the end of the order, as the one used last. */
  private touch(index: number) {
    this.order.splice(this.order.indexOf(index), 1);
    this.order.push(index);
  }

  /** Controller 75: the number of voices a channel keeps for itself. */
  private reserve(channel: number, count: number) {
    const state = this.channels[channel]!;
    const has = this.voices.filter((v) => v.reservedFor === channel).length + state.wanted;
    if (has < count) this.reserveMore(channel, count - has);
    else if (has > count) {
      this.unreserve(channel, has - count);
      this.handOut();
    }
  }

  private reserveMore(channel: number, count: number) {
    this.voices.forEach((v, i) => {
      if (count <= 0 || v.reservedFor !== FREE) return;
      if (v.note !== FREE) this.voiceOff(i);
      v.reservedFor = channel;
      this.channels[channel]!.reserved++;
      count--;
    });
    this.channels[channel]!.wanted += count;
  }

  private unreserve(channel: number, count: number) {
    const state = this.channels[channel]!;
    if (state.wanted >= count) {
      state.wanted -= count;
      return;
    }
    count -= state.wanted;
    state.wanted = 0;
    // Idle voices go first, then playing ones.
    for (const idle of [true, false]) {
      this.voices.forEach((v, i) => {
        if (count <= 0 || v.reservedFor !== channel || (v.note === FREE) !== idle) return;
        if (!idle) this.voiceOff(i);
        v.reservedFor = FREE;
        state.reserved--;
        count--;
      });
    }
  }

  /** Gives voices that are no longer reserved to channels still waiting for some. */
  private handOut() {
    let free = this.voices.filter((v) => v.reservedFor === FREE).length;
    for (let ch = 0; ch < 16 && free > 0; ch++) {
      const wanted = this.channels[ch]!.wanted;
      if (!wanted) continue;
      if (wanted < free) {
        free -= wanted;
        this.channels[ch]!.wanted = 0;
        this.reserveMore(ch, wanted);
      } else {
        this.channels[ch]!.wanted = wanted - free;
        this.reserveMore(ch, free);
        return;
      }
    }
  }

  /** Writes an instrument to a voice's operators and its channel registers. */
  private program(index: number, instrument: number) {
    const ins = this.bank.instruments[instrument];
    if (!ins) return;
    ins.operators.forEach((op, i) => {
      const reg = OFFSETS[MODULATORS[index]! + i * 3]!;
      this.opl.write(0x40 + reg, (op.ksl << 6) | op.level);
      if (i === 0) this.opl.write(0xc0 + index, ((ins.feedback << 1) | (ins.additive ? 1 : 0)) & 15);
      this.opl.write(0x60 + reg, (op.attack << 4) | op.decay);
      this.opl.write(0x80 + reg, (op.sustain << 4) | op.release);
      this.opl.write(
        0x20 + reg,
        (+op.tremolo << 7) | (+op.vibrato << 6) | (+op.sustaining << 5) | (+op.ksr << 4) | op.mult,
      );
      this.opl.write(0xe0 + reg, op.wave);
    });
  }

  /**
   * Writes a voice's pitch, its loudness and its key. Pitch is counted in quarter semitones, with the pitch wheel
   * adding or taking away up to 47 of them.
   */
  private setNote(index: number, note: number, on: boolean) {
    const voice = this.voices[index]!;
    const channel = this.channels[voice.channel]!;
    voice.note = note;
    if (voice.instrument !== FREE && voice.instrument >= 0x80 && this.bank.drumNotes)
      note = this.bank.drumNotes[Math.min(DRUM_LAST, Math.max(DRUM_FIRST, note)) - DRUM_FIRST]!;
    let pitch = note << 2;
    const bend = Math.floor(Math.abs(channel.bend - BEND_CENTRE) / BEND_STEP);
    pitch += channel.bend >= BEND_CENTRE ? bend : -bend;
    // The driver compares unsigned, so a pitch below 0 ends up at the top too.
    if (pitch < 0 || pitch > HIGHEST_PITCH) pitch = HIGHEST_PITCH;
    const octave = Math.floor(pitch / 48);
    const fnum = FREQUENCIES[pitch % 48]!;
    const block = octave > 0 ? octave - 1 : 0;
    const key = (on ? 0x20 : 0) | (block << 2) | (fnum >> 8);
    this.opl.write(0xa0 + index, fnum & 0xff);

    const loudness = ((channel.volume + 1) * (VELOCITIES[voice.velocity]! + 1)) >> 6;
    if (this.card === "sbpro") {
      // The Sound Blaster Pro driver keys the note first, and leaves the master volume to the card's mixer.
      this.opl.write(0xb0 + index, key);
      const level = Math.min(63, loudness);
      this.loudness(index, panned(level, channel.pan >> 1), 0);
      this.loudness(index, panned(level, (127 - channel.pan) >> 1), 1);
    } else {
      let level = (loudness * (this.master + 1)) >> 4;
      if (level > 0) level--;
      this.loudness(index, level);
      this.opl.write(0xb0 + index, key);
    }
  }

  /**
   * Scales the level of the operators that are heard: the carrier, and the modulator too in additive instruments. On
   * the Sound Blaster Pro it is written to one chip.
   */
  private loudness(index: number, loudness: number, chip?: number) {
    const ins = this.bank.instruments[this.voices[index]!.instrument];
    if (!ins) return;
    const share = LEVELS[loudness]!;
    ins.operators.forEach((op, i) => {
      if (i === 0 && !ins.additive) return;
      const reg = OFFSETS[MODULATORS[index]! + i * 3]!;
      this.opl.write(0x40 + reg, (op.ksl << 6) | (63 - Math.floor((share * (63 - op.level)) / 63)), chip);
    });
  }
}

/**
 * The Sound Blaster Pro driver's loudness for one side: `toward` is how far the pan is toward that side, 0–63, and the
 * level table turns it into the share of the loudness kept. The pan's middle keeps about 49/63 on each side.
 */
function panned(loudness: number, toward: number): number {
  const cut = Math.floor((loudness * (63 - LEVELS[Math.min(63, toward)]!)) / 63);
  return loudness - cut;
}
