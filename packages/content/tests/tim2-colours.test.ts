import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import { readTim2Driver, tim2FillColour, tim2SixteenColours } from "../src/read/tim2-colours.ts";

/** A `BIN:`-style packed block that isn't compressed: method 0, the size, the bytes. */
function unpacked(code: number[]): Uint8Array {
  const out = new Uint8Array(5 + code.length);
  out[0] = 0;
  new DataView(out.buffer).setUint32(1, code.length, true);
  out.set(code, 5);
  return out;
}

const REGISTERS = [0xb2, 0xc0, 0x8a, 0xc1, 0xee, 0xeb, 0x00, 0xee];
const PAGES = [0xb8, 0x13, 0x10, 0xbb, 0x00, 0x01, 0xcd, 0x10];
const SWAP = [0x8a, 0xd0, 0x8a, 0xe0, 0xd0, 0xcc, 0xd0, 0xcc, 0xd0, 0xcc, 0xd0, 0xcc];
// `mov cs:[0x0be6], ax`, then `and dl, 0xf0`.
const HIGH = [0x2e, 0xa3, 0xe6, 0x0b, 0x80, 0xe2, 0xf0];

/** A made-up VM.OVL: an `OVL:` chunk with a `VGA:` driver and a `HEG:` driver of these bytes. */
function vmOvl(heg: number[]): Uint8Array {
  return writeChunk("OVL:", [writeChunk("VGA:", unpacked([0x90, 0x90])), writeChunk("HEG:", unpacked(heg))]);
}

describe("TIM2.EXE's 16 colour driver", () => {
  it("finds where the driver sets the registers, the 16 pages and the pattern fill", () => {
    const code = [0x55, ...PAGES, 0x90, 0x90, ...REGISTERS, 0xc3, ...SWAP, ...HIGH, 0xcb];
    expect(readTim2Driver(vmOvl(code))).toEqual({ registers: 11, pages: 1, pattern: 36 });
  });

  it("refuses a VM.OVL without the HEG: driver", () => {
    const only = writeChunk("OVL:", [writeChunk("VGA:", unpacked([0x90]))]);
    expect(() => readTim2Driver(only)).toThrow("VM.OVL has no HEG: driver");
  });

  it("refuses a driver that doesn't do what TIM2.EXE's does", () => {
    expect(() => readTim2Driver(vmOvl([...PAGES, ...SWAP, ...HIGH]))).toThrow(/palette registers/);
    expect(() => readTim2Driver(vmOvl([...REGISTERS, ...SWAP, ...HIGH]))).toThrow(/16 pages/);
    expect(() => readTim2Driver(vmOvl([...REGISTERS, ...PAGES, ...SWAP]))).toThrow(/pattern/);
    // The test of the high 4 bits counts only a few bytes after the swap.
    const far = [...REGISTERS, ...PAGES, ...SWAP, ...Array<number>(12).fill(0x90), 0x80, 0xe2, 0xf0];
    expect(() => readTim2Driver(vmOvl(far))).toThrow(/pattern/);
  });
});

describe("TIM 2's colours in 16 colours", () => {
  it("shows colour c as the palette's colour c & 15", () => {
    const palette = Uint8Array.from({ length: 768 }, (_, i) => i % 251);
    const sixteen = tim2SixteenColours(palette);
    expect(sixteen).toHaveLength(768);
    expect([...sixteen.subarray(0, 48)]).toEqual([...palette.subarray(0, 48)]);
    expect([...sixteen.subarray(17 * 3, 18 * 3)]).toEqual([...palette.subarray(3, 6)]);
    expect([...sixteen.subarray(255 * 3)]).toEqual([...palette.subarray(15 * 3, 16 * 3)]);
  });

  it("fills a box in a colour below 16 with that colour", () => {
    expect([0, 1, 2, 3].map((c) => tim2FillColour(9, c, c))).toEqual([9, 9, 9, 9]);
  });

  it("fills a box in a colour of 16 or more with a pattern of its two halves, by column and screen row", () => {
    // 0xb3: 3 where column + row is odd, 11 where it is even.
    const rows = [10, 11].map((row) => [0, 1, 2, 3].map((column) => tim2FillColour(0xb3, column, row)));
    expect(rows).toEqual([
      [11, 3, 11, 3],
      [3, 11, 3, 11],
    ]);
    // A high half with a low half of 0 gives black and that colour.
    expect([0, 1].map((column) => tim2FillColour(0x90, column, 0))).toEqual([9, 0]);
  });
});
