import { describe, expect, it } from "vitest";
import { readAdlibBank } from "../src/adlib.ts";
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

/** A plain sine on channel 0: the carrier at full level, the modulator silent. */
function sine(opl: Opl2, release = 0) {
  opl.write(0x01, 0x20);
  opl.write(0x20, 0x21);
  opl.write(0x23, 0x21);
  opl.write(0x40, 63);
  opl.write(0x43, 0);
  opl.write(0x60, 0xf0);
  opl.write(0x63, 0xf0);
  opl.write(0x80, release);
  opl.write(0x83, release);
  opl.write(0xc0, 1);
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
    expect(peak(out)).toBeCloseTo(1 / 8, 2);
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

  it("rejects a sound without AdLib tracks", () => {
    const sound = Uint8Array.of(0x84, 0, 7, 0, 0, 9, 0, 3, 0, 0xff, 0xff, 1, 1, 0xfc);
    expect(hasAdlibTracks(sound)).toBe(false);
    expect(() => renderAdlib(sound, readAdlibBank(new Uint8Array(1344)))).toThrow(/no tracks for the AdLib/);
  });
});
