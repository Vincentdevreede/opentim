import { describe, expect, it } from "vitest";
import { writeChunk } from "../src/chunk.ts";
import { readPalette } from "../src/palette.ts";

const palette = (vga: Uint8Array) => writeChunk("PAL:", [writeChunk("VGA:", vga)]);

describe("readPalette", () => {
  it("scales the 6-bit VGA channels to 8 bits", () => {
    const vga = new Uint8Array(768);
    vga.set([63, 0, 32], 3);
    const rgb = readPalette(palette(vga));
    expect(rgb).toHaveLength(768);
    expect([...rgb.subarray(0, 6)]).toEqual([0, 0, 0, 255, 0, 130]);
  });

  it("rejects a palette without 256 colours", () => {
    expect(() => readPalette(palette(new Uint8Array(48)))).toThrow(/48 bytes instead of 768/);
    const bright = new Uint8Array(768);
    bright[5] = 64;
    expect(() => readPalette(palette(bright))).toThrow(expect.objectContaining({ offset: 8 + 8 + 5 }));
    expect(() => readPalette(writeChunk("PAL:", [writeChunk("CGA:", new Uint8Array(4))]))).toThrow(/No VGA: chunk/);
  });
});
