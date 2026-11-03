import { describe, expect, it } from "vitest";
import { AdlibDriver, readAdlibBank } from "../src/adlib.ts";
import { OPL_RATE, Opl2 } from "../src/opl.ts";
import { hasAdlibTracks, renderAdlib } from "../src/render.ts";
import { mergeTracks, readTrackEvents } from "../src/sequence.ts";

const u16 = (n: number) => [n & 255, n >> 8];

/** Counts the upward zero crossings, to measure a tone's frequency. */
function crossings(samples: Float32Array): number {
  let n = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1]! <= 0 && samples[i]! > 0) n++;
  return n;
}

const peak = (samples: Float32Array) => samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);

/** A plain sine on channel 0: the carrier at full level, the modulator silent since its attack never starts. */
function sine(opl: Opl2, release = 0) {
  opl.write(0x01, 0x20);
  opl.write(0x20, 0x21);
  opl.write(0x23, 0x21);
  opl.write(0x40, 63);
  opl.write(0x43, 0);
  opl.write(0x60, 0x00);
  opl.write(0x63, 0xf0);
  opl.write(0x80, release);
  opl.write(0x83, release);
  opl.write(0xc0, 0);
}

describe("Opl2", () => {
  it("plays a note at the frequency of its F-number and block", () => {
    const opl = new Opl2();
    sine(opl);
    // F-number 577 in block 4 is 440 Hz: 577 * 49716 / 2^(20 - 4).
    opl.write(0xa0, 577 & 255);
    opl.write(0xb0, 0x20 | (4 << 2) | (577 >> 8));
    const out = new Float32Array(OPL_RATE);
    opl.render(out, 0, out.length);
    expect(crossings(out)).toBeGreaterThanOrEqual(436);
    expect(crossings(out)).toBeLessThanOrEqual(441);
    // The exponent table's largest value doubled, 4084, and its ones' complement in the negative half.
    expect(peak(out)).toBe(Math.fround(4085 / 32768));
  });

  it("is silent until a key is on, and fades out after it is released", () => {
    const opl = new Opl2();
    sine(opl, 0x0f);
    const silent = new Float32Array(1000);
    opl.render(silent, 0, silent.length);
    expect(peak(silent)).toBe(0);
    expect(opl.active).toBe(false);

    opl.write(0xa0, 0x41);
    opl.write(0xb0, 0x32);
    opl.render(new Float32Array(2000), 0, 2000);
    opl.write(0xb0, 0x12);
    expect(opl.active).toBe(true);
    // Release rate 15 takes a few milliseconds to fall 96 dB.
    opl.render(new Float32Array(2000), 0, 2000);
    expect(opl.active).toBe(false);
  });
});

/** An instrument: two 13-byte operators and the waveforms. */
function instrument(level: number, fm: boolean): number[] {
  const op = (lvl: number) => [0, 1, 0, 15, 0, 1, 0, 15, lvl, 0, 0, 0, fm ? 1 : 0];
  return [...op(63), ...op(level), 0, 0];
}

describe("readAdlibBank", () => {
  it("reads the operators, the connection and the drum notes", () => {
    const data = new Uint8Array(5382);
    data.set(instrument(5, true), 0);
    data.set(instrument(9, false), 28);
    data[5320] = 60;
    const bank = readAdlibBank(data);
    expect(bank.instruments).toHaveLength(190);
    expect(bank.instruments[0]).toMatchObject({
      additive: false,
      operators: [{ level: 63 }, { level: 5, attack: 15 }],
    });
    expect(bank.instruments[1]!.additive).toBe(true);
    expect(bank.drumNotes?.[0]).toBe(60);
    expect(readAdlibBank(new Uint8Array(1344)).instruments).toHaveLength(48);
    expect(() => readAdlibBank(new Uint8Array(100))).toThrow(/100 bytes/);
  });
});

/** A driver on a fake chip that keeps the last value written to each register. */
function driver() {
  const data = new Uint8Array(5382);
  data.set(instrument(10, true), 0);
  data.set(instrument(20, false), 28);
  // Drum key 35 plays instrument 136 at note 48.
  data.set(instrument(0, true), 136 * 28);
  data[5320 + 35 - 27] = 48;
  const regs = new Uint8Array(256);
  const d = new AdlibDriver({ write: (r, v) => (regs[r] = v) }, readAdlibBank(data));
  /** The pitch of a voice: its block and F-number. */
  const pitch = (voice: number) => ({
    block: (regs[0xb0 + voice]! >> 2) & 7,
    fnum: ((regs[0xb0 + voice]! & 3) << 8) | regs[0xa0 + voice]!,
  });
  const keyOn = (voice: number) => (regs[0xb0 + voice]! & 0x20) !== 0;
  return { d, regs, pitch, keyOn };
}

describe("AdlibDriver", () => {
  it("plays notes in quarter semitones from the driver's table, with a bend of up to an octave", () => {
    const { d, pitch, keyOn } = driver();
    d.message(0x90, 60, 127);
    expect(keyOn(0)).toBe(true);
    expect(pitch(0)).toEqual({ block: 4, fnum: 0x157 });
    // Full bend up: 8191 - 8192 / 171 is 47 quarter semitones, so B in the next octave.
    d.message(0xe0, 0x7f, 0x7f);
    expect(pitch(0)).toEqual({ block: 4, fnum: 0x2a4 });
    d.message(0xe0, 0, 0x40);
    expect(pitch(0)).toEqual({ block: 4, fnum: 0x157 });
    d.message(0x80, 60, 0);
    expect(keyOn(0)).toBe(false);
    // The driver ignores notes below 12 and above 107.
    d.message(0x90, 11, 127);
    d.message(0x90, 108, 127);
    expect([...Array(9).keys()].some(keyOn)).toBe(false);
  });

  it("keeps the highest pitches in block 7 with a higher F-number, so releasing them turns the key off", () => {
    const { d, pitch, keyOn } = driver();
    // A bend of 8 quarter semitones takes note 107 into octave 9: twice the table's F-number in block 7.
    d.message(0xe0, 9560 & 0x7f, 9560 >> 7);
    d.message(0x90, 107, 127);
    expect(pitch(0)).toEqual({ block: 7, fnum: 0x16b * 2 });
    // Further up, the F-number stops at the chip's highest.
    d.message(0xe0, 0x7f, 0x7f);
    expect(pitch(0)).toEqual({ block: 7, fnum: 0x3ff });
    d.message(0x80, 107, 0);
    expect(keyOn(0)).toBe(false);
  });

  it("scales the heard levels with the driver's velocity and volume tables", () => {
    const { d, regs } = driver();
    // FM: only the carrier (register 0x43 for voice 0) is scaled; at full velocity it keeps the instrument's level.
    d.message(0x90, 60, 127);
    expect(regs[0x43]! & 63).toBe(10);
    d.message(0xb0, 7, 64);
    // Volume 64 is 32 of 63: (33 * 64) >> 6 = 33, less 1, and table entry 32 is a share of 49/63 of the level's range.
    expect(regs[0x43]! & 63).toBe(63 - Math.floor((49 * 53) / 63));
    // Additive: both operators are scaled. Velocity 2 is 1 of 63, which the table makes 12: (64 * 13) >> 6 = 13, less 1,
    // and table entry 12 is a share of 31/63.
    d.message(0xc1, 1, 0);
    d.message(0x91, 60, 2);
    expect(regs[0x41]! & 63).toBe(63);
    expect(regs[0x44]! & 63).toBe(63 - Math.floor((31 * 43) / 63));
  });

  it("plays drums on channel 10 with the bank's drum notes", () => {
    const { d, pitch } = driver();
    d.message(0x99, 35, 127);
    expect(pitch(0)).toEqual({ block: 3, fnum: 0x157 });
  });

  it("gives a new note the free voice used longest ago, and takes the oldest voice when none is free", () => {
    const { d, keyOn, pitch } = driver();
    for (let i = 0; i < 9; i++) d.message(0x90, 60 + i, 127);
    d.message(0x80, 60, 0);
    d.message(0x80, 62, 0);
    // Voice 0 was released first, so it is used first.
    d.message(0x90, 72, 127);
    expect(pitch(0).block).toBe(5);
    expect(keyOn(2)).toBe(false);
    d.message(0x90, 73, 127);
    d.message(0x90, 74, 127);
    // All voices play; the next note takes voice 1, the one used longest ago. Note 74 is D, 8 quarter semitones up.
    expect(pitch(1)).toEqual({ block: 5, fnum: 0x181 });
  });
});

describe("AdlibDriver on the Sound Blaster Pro", () => {
  it("writes each side's level to its own chip, from the pan controller", () => {
    const data = new Uint8Array(5382);
    data.set(instrument(0, true), 0);
    const chips = [new Uint8Array(256), new Uint8Array(256)];
    const d = new AdlibDriver(
      { write: (r, v, chip) => (chip === undefined ? chips : [chips[chip]!]).forEach((regs) => (regs[r] = v)) },
      readAdlibBank(data),
      "sbpro",
    );
    // Pan 127 keeps the chip at 220h at full level and silences the other one.
    d.message(0xb0, 10, 127);
    d.message(0x90, 60, 127);
    expect(chips.map((regs) => regs[0x43]! & 63)).toEqual([0, 63]);
    expect(chips.map((regs) => regs[0xb0]! & 0x20)).toEqual([0x20, 0x20]);
    // The middle keeps about 49/63 of the loudness on each side.
    d.message(0xb0, 10, 64);
    expect(chips.map((regs) => regs[0x43]! & 63)).toEqual([63 - 59, 63 - 59]);
  });
});

describe("readTrackEvents", () => {
  it("reads delays, running status and the end", () => {
    const track = Uint8Array.of(0, 0xc2, 5, 0, 0x92, 60, 100, 0xf8, 10, 60, 0, 2, 0xfc);
    expect(readTrackEvents(track)).toEqual({
      events: [
        { tick: 0, status: 0xc2, a: 5, b: 0 },
        { tick: 0, status: 0x92, a: 60, b: 100 },
        { tick: 250, status: 0x92, a: 60, b: 0 },
      ],
      end: 252,
    });
    expect(() => readTrackEvents(Uint8Array.of(0, 0x90, 60))).toThrow(/without 0xFC/);
  });

  it("merges tracks in time order", () => {
    const a = [{ tick: 5, status: 0x90, a: 1, b: 1 }];
    const b = [
      { tick: 0, status: 0x91, a: 2, b: 1 },
      { tick: 5, status: 0x91, a: 3, b: 1 },
    ];
    expect(mergeTracks([a, b]).map((e) => e.a)).toEqual([2, 1, 3]);
  });
});

describe("renderAdlib", () => {
  it("plays the AdLib tracks of a sound with the bank's instruments", () => {
    const data = new Uint8Array(5382);
    data.set(instrument(0, true), 0);
    const bank = readAdlibBank(data);
    // One second of A4 on channel 1 with instrument 0, as a SCI sound patch with one AdLib track.
    const track = [0x01, 0x01, 0, 0xc1, 0, 0, 0x91, 69, 127, 60, 69, 0, 0, 0xfc];
    const sound = Uint8Array.from([0x84, 0, 0, 0, 0, ...u16(9), ...u16(track.length), 0xff, 0xff, ...track]);
    expect(hasAdlibTracks(sound)).toBe(true);
    const pcm = renderAdlib(sound, bank);
    expect(pcm.rate).toBe(OPL_RATE);
    // The note lasts a second, then rings out briefly.
    expect(pcm.samples.length).toBeGreaterThanOrEqual(OPL_RATE);
    expect(pcm.samples.length).toBeLessThan(OPL_RATE * 1.2);
    const second = pcm.samples.subarray(0, OPL_RATE);
    expect(crossings(second)).toBeGreaterThanOrEqual(436);
    expect(crossings(second)).toBeLessThanOrEqual(442);
  });

  it("renders the Sound Blaster Pro in stereo, with a panned note on one side", () => {
    const data = new Uint8Array(5382);
    data.set(instrument(0, true), 0);
    const track = [0x01, 0x01, 0, 0xb1, 10, 0, 0, 0xc1, 0, 0, 0x91, 69, 127, 60, 69, 0, 0, 0xfc];
    const sound = Uint8Array.from([0x84, 0, 0, 0, 0, ...u16(9), ...u16(track.length), 0xff, 0xff, ...track]);
    const pcm = renderAdlib(sound, readAdlibBank(data), { card: "sbpro" });
    expect(pcm.right).toHaveLength(pcm.samples.length);
    // Pan 0 plays on the left and leaves the right at its quietest, about -47 dB. The driver keys the note before it
    // writes the levels, so for a moment it sounds at the instrument's own level.
    expect(peak(pcm.right!.subarray(0, 40))).toBeGreaterThan(0.005);
    expect(peak(pcm.right!.subarray(40))).toBeLessThan(0.001);
    expect(peak(pcm.samples)).toBeGreaterThan(0.1);
    expect(renderAdlib(sound, readAdlibBank(data)).right).toBeUndefined();
  });

  it("rejects a sound without AdLib tracks", () => {
    const sound = Uint8Array.of(0x84, 0, 7, 0, 0, 9, 0, 3, 0, 0xff, 0xff, 1, 1, 0xfc);
    expect(hasAdlibTracks(sound)).toBe(false);
    expect(() => renderAdlib(sound, readAdlibBank(new Uint8Array(1344)))).toThrow(/no tracks for the AdLib/);
  });
});
