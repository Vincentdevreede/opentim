/**
 * Dynamix fonts (`.FNT`), as Toons draws its texts with them, like the letter of the message machine. A font is one
 * `FNT:` chunk: a byte 0xff, the widest glyph's width, the height, a byte that may be the baseline, the first
 * character and the number of characters, the unpacked size (u16), then the glyphs packed like a `BIN:` chunk. Unpacked,
 * they are an offset (u16) per character into the bitmaps, a width (byte) per character, and the bitmaps: one bit a
 * pixel, the high bit first, each row rounded up to whole bytes.
 */
import { FormatError, readChunks } from "./chunk.ts";
import { decodeBin } from "./image.ts";

export interface Font {
  /** The height of every glyph. */
  height: number;
  /** The first character the font has. */
  first: number;
  /** A glyph per character from `first`. */
  glyphs: Glyph[];
}

export interface Glyph {
  width: number;
  /** One row after another, `ceil(width / 8)` bytes each, the leftmost pixel in the high bit. */
  bits: Uint8Array;
}

const HEADER = 8;

export function readFont(data: Uint8Array): Font {
  const chunk = readChunks(data).find((c) => c.tag === "FNT:");
  if (!chunk) throw new FormatError("No FNT: chunk", 0);
  const d = chunk.data;
  if (d.length < HEADER) throw new FormatError("Truncated font header", 8);
  const height = d[2]!;
  const first = d[4]!;
  const count = d[5]!;
  const packed = decodeBin(d.subarray(HEADER));
  if (packed.length < 3 * count) throw new FormatError("The font's tables are cut short", 8);
  const bitmaps = packed.subarray(3 * count);
  const glyphs = Array.from({ length: count }, (_, i) => {
    const width = packed[2 * count + i]!;
    const offset = packed[2 * i]! | (packed[2 * i + 1]! << 8);
    const size = Math.ceil(width / 8) * height;
    if (offset + size > bitmaps.length) throw new FormatError(`Glyph ${first + i} runs past the bitmaps`, 8);
    return { width, bits: bitmaps.slice(offset, offset + size) };
  });
  return { height, first, glyphs };
}

/** The glyph of a character, or undefined when the font doesn't have it. */
export const glyphOf = (font: Font, char: number): Glyph | undefined => font.glyphs[char - font.first];

/** Whether a glyph's pixel at x, y is set. */
export const glyphPixel = (glyph: Glyph, x: number, y: number) =>
  ((glyph.bits[y * Math.ceil(glyph.width / 8) + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0;
