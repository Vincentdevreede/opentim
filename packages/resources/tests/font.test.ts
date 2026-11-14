import { describe, expect, it } from "vitest";
import { writeChunk } from "../src/chunk.ts";
import { glyphOf, glyphPixel, readFont } from "../src/font.ts";

const u16 = (...values: number[]) => [...new Uint8Array(new Uint16Array(values).buffer)];
const u32 = (value: number) => [...new Uint8Array(new Uint32Array([value]).buffer)];

/** A font of two characters from "A", 3 high: an A 3 wide and a B 9 wide, unpacked. */
function font() {
  const a = [0b01000000, 0b10100000, 0b11100000];
  const b = [0xff, 0x80, 0x80, 0x00, 0xff, 0x80];
  const tables = [...u16(0, a.length), 3, 9];
  const glyphs = [...tables, ...a, ...b];
  const body = [0xff, 9, 3, 2, 0x41, 2, ...u16(glyphs.length), 0, ...u32(glyphs.length), ...glyphs];
  return Uint8Array.from(writeChunk("FNT:", Uint8Array.from(body)));
}

describe("readFont", () => {
  it("reads each glyph's width and bits from the first character on", () => {
    const f = readFont(font());
    expect(f).toMatchObject({ height: 3, first: 0x41 });
    const a = glyphOf(f, 0x41)!;
    expect(a.width).toBe(3);
    const rows = [0, 1, 2].map((y) => [0, 1, 2].map((x) => (glyphPixel(a, x, y) ? "#" : ".")).join(""));
    expect(rows).toEqual([".#.", "#.#", "###"]);
    const b = glyphOf(f, 0x42)!;
    expect([glyphPixel(b, 8, 0), glyphPixel(b, 8, 1), glyphPixel(b, 7, 1)]).toEqual([true, false, false]);
    expect(glyphOf(f, 0x43)).toBeUndefined();
  });

  it("refuses a resource without a font", () => {
    expect(() => readFont(Uint8Array.from(writeChunk("BMP:", new Uint8Array(4))))).toThrow(/FNT/);
  });
});
