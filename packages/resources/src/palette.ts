import { FormatError, findChunk, readChunks } from "./chunk.ts";

const COLORS = 256;

/**
 * Reads a `.PAL` resource into 256 colours as 8-bit RGB triples. The colours are in its `VGA:` chunk, with 6-bit
 * channels like the VGA hardware uses.
 */
export function readPalette(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const vga = findChunk(readChunks(data), "VGA:");
  if (!vga) throw new FormatError("No VGA: chunk with the colours");
  const { data: colors, offset } = vga;
  if (colors.length !== COLORS * 3)
    throw new FormatError(`The VGA: chunk has ${colors.length} bytes instead of ${COLORS * 3}`, offset);
  const high = colors.findIndex((v) => v > 63);
  if (high >= 0) throw new FormatError("The VGA: chunk has channels above 63", offset + 8 + high);
  return Uint8Array.from(colors, (v) => Math.round((v * 255) / 63));
}
