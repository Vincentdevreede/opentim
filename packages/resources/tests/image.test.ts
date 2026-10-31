import { describe, expect, it } from "vitest";
import { FormatError, writeChunk } from "../src/chunk.ts";
import { decodeBin, decodeImage, decodeScn, frameToRgba, readScnCommands } from "../src/image.ts";

const u16 = (...values: number[]) => new Uint8Array(new Uint16Array(values).buffer);
const u32 = (...values: number[]) => new Uint8Array(new Uint32Array(values).buffer);

function bin(type: number, size: number, payload: number[]) {
  return Uint8Array.from([type, ...u32(size), ...payload]);
}

/** Packs LZW codes of a fixed width, least significant bit first. */
function lzw(codes: number[], bits = 9) {
  const out: number[] = [];
  let acc = 0;
  let filled = 0;
  for (const code of codes) {
    acc |= code << filled;
    filled += bits;
    while (filled >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      filled -= 8;
    }
  }
  if (filled) out.push(acc & 255);
  return out;
}

describe("decodeScn", () => {
  it("copies, repeats and skips pixels, and keeps colour 0 apart from transparency", () => {
    // Copy 3, skip 1, next line 3 back, repeat colour 3 twice, end.
    const frame = decodeScn(Uint8Array.of(0, 0xc3, 0x01, 0x20, 0x41, 0x03, 0x82, 3, 0x40), 4, 2);
    expect([...frame.pixels]).toEqual([0, 1, 2, 0, 0, 3, 3, 0]);
    expect([...frame.mask]).toEqual([1, 1, 1, 0, 0, 1, 1, 0]);
  });

  it("adds the first byte to every colour", () => {
    expect([...decodeScn(Uint8Array.of(16, 0x82, 2, 0x40), 2, 1).pixels]).toEqual([18, 18]);
  });

  it("reads the high bits of a long line move from the next byte", () => {
    // Skip 64 and draw a pixel, then move down a line and 1 + (1 << 6) = 65 pixels left: the start of line 2.
    const frame = decodeScn(Uint8Array.of(1, 0x7f, 0x41, 0x81, 2, 0x01, 0x01, 0x81, 3, 0x40), 100, 2);
    expect(frame.pixels[64]).toBe(3);
    expect(frame.pixels[100]).toBe(4);
    expect(frame.mask.reduce((a, b) => a + b)).toBe(2);
  });

  it("rejects damaged frames", () => {
    expect(() => decodeScn(Uint8Array.of(0, 0x82, 1), 1, 1)).toThrow(/past the frame/);
    expect(() => decodeScn(Uint8Array.of(0, 0xc2), 2, 1)).toThrow(/Truncated/);
    expect(() => decodeScn(Uint8Array.of(0, 0x81, 1), 1, 1)).toThrow(/doesn't end/);
  });
});

describe("readScnCommands", () => {
  it("lists each command with its bytes, colours and position", () => {
    const commands = readScnCommands(Uint8Array.of(0, 0xc3, 0x01, 0x20, 0x41, 0x03, 0x82, 3, 0x40), 4);
    expect(commands.map((c) => [c.type, c.offset, c.length, c.count, c.colors, c.x, c.y])).toEqual([
      ["base", 0, 1, 0, [], 0, 0],
      ["copy", 1, 3, 3, [0, 1, 2], 0, 0],
      ["skip", 4, 1, 1, [], 3, 0],
      ["line", 5, 1, 3, [], 0, 1],
      ["repeat", 6, 2, 2, [3], 1, 1],
      ["end", 8, 1, 0, [], 3, 1],
    ]);
  });

  it("reads a long line move as one command of two bytes", () => {
    const commands = readScnCommands(Uint8Array.of(1, 0x01, 0x01, 0x40), 100);
    expect(commands[1]).toMatchObject({ type: "line", offset: 1, length: 2, count: 65 });
  });
});

describe("decodeBin", () => {
  it("unpacks uncompressed and run-length data", () => {
    expect([...decodeBin(bin(0, 3, [1, 2, 3]))]).toEqual([1, 2, 3]);
    expect([...decodeBin(bin(1, 5, [0x83, 7, 2, 8, 9]))]).toEqual([7, 7, 7, 8, 9]);
    expect(() => decodeBin(bin(1, 3, [0x84, 7]))).toThrow(/Invalid RLE count 4/);
  });

  it("unpacks LZW, including a code that is being defined", () => {
    // 65, 66, then 257 ("AB") and 259, the code this step defines: "AB" + "A".
    expect([...decodeBin(bin(2, 7, lzw([65, 66, 257, 259])))]).toEqual([65, 66, 65, 66, 65, 66, 65]);
    expect(() => decodeBin(bin(2, 100, []))).toThrow(/Truncated LZW/);
    expect(() => decodeBin(bin(2, 4, lzw([65, 300])))).toThrow(/Invalid LZW code 300/);
  });

  it("skips to the next group of 8 codes after a reset", () => {
    // After 65 and the reset (2 codes), 6 padding codes complete the group.
    const codes = [65, 256, 0, 0, 0, 0, 0, 0, 66];
    expect([...decodeBin(bin(2, 2, lzw(codes)))]).toEqual([65, 66]);
  });

  it("rejects an unknown compression type", () => {
    expect(() => decodeBin(bin(3, 0, []))).toThrow(/Unknown BIN compression type 3/);
  });
});

describe("decodeImage", () => {
  it("decodes the frames of a SCN sprite sheet", () => {
    const frames = [Uint8Array.of(0, 0x81, 5, 0x40), Uint8Array.of(0, 0x82, 6, 0x40)];
    const data = writeChunk("BMP:", [
      writeChunk("INF:", u16(2, 1, 2, 1, 1)),
      writeChunk("OFF:", u32(0, frames[0]!.length)),
      writeChunk("SCN:", Uint8Array.from([...frames[0]!, ...frames[1]!])),
    ]);
    const image = decodeImage(data);
    expect(image.encoding).toBe("SCN");
    expect(image.frames.map((f) => [f.width, f.height, [...f.pixels]])).toEqual([
      [1, 1, [5]],
      [2, 1, [6, 6]],
    ]);
  });

  it("combines BIN and VGA into 8-bit pixels, with colour 0 transparent in sprites", () => {
    const data = writeChunk("BMP:", [
      writeChunk("INF:", u16(1, 2, 1)),
      writeChunk("BIN:", bin(0, 1, [0x05])),
      writeChunk("VGA:", bin(0, 1, [0x01])),
    ]);
    const [frame] = decodeImage(data).frames;
    expect([...frame!.pixels]).toEqual([0, 0x15]);
    expect([...frame!.mask]).toEqual([0, 1]);
    expect(decodeImage(data).encoding).toBe("BIN · none + VGA");
  });

  it("keeps colour 0 in screens", () => {
    const data = writeChunk("SCR:", [writeChunk("DIM:", u16(2, 1)), writeChunk("BIN:", bin(1, 1, [0x81, 0x07]))]);
    const image = decodeImage(data);
    expect([...image.frames[0]!.pixels]).toEqual([0, 7]);
    expect([...image.frames[0]!.mask]).toEqual([1, 1]);
    expect(image.encoding).toBe("BIN · RLE");
  });

  it("tells where in the resource decoding stopped", () => {
    const where = (data: Uint8Array) => {
      try {
        decodeImage(data);
      } catch (error) {
        return (error as FormatError).offset;
      }
    };
    // The second command of the SCN frame repeats colour 99: header 8, INF: 18, OFF: 12, SCN: header 8, then 3 bytes.
    const scn = writeChunk("BMP:", [
      writeChunk("INF:", u16(1, 4, 1)),
      writeChunk("OFF:", u32(0)),
      writeChunk("SCN:", Uint8Array.of(0, 0x81, 1, 0x81, 99, 0x40)),
    ]);
    expect(where(scn)).toBe(8 + 14 + 12 + 8 + 3);
    // The RLE count of 0 comes after the BIN: header and the 5-byte BIN header.
    const rle = writeChunk("BMP:", [writeChunk("INF:", u16(1, 2, 1)), writeChunk("BIN:", bin(1, 1, [0x00]))]);
    expect(where(rle)).toBe(8 + 14 + 8 + 5);
  });

  it("rejects an image without frame sizes or pixels", () => {
    expect(() => decodeImage(writeChunk("BMP:", [writeChunk("BIN:", bin(0, 0, []))]))).toThrow(/frame sizes/);
    expect(() => decodeImage(writeChunk("BMP:", [writeChunk("INF:", u16(1, 1, 1))]))).toThrow(/No SCN: or BIN:/);
  });
});

describe("frameToRgba", () => {
  it("colours drawn pixels and leaves transparent ones clear", () => {
    const frame = { width: 2, height: 1, pixels: Uint8Array.of(1, 1), mask: Uint8Array.of(1, 0) };
    expect([...frameToRgba(frame, Uint8Array.of(0, 0, 0, 10, 20, 30))]).toEqual([10, 20, 30, 255, 0, 0, 0, 0]);
  });
});
