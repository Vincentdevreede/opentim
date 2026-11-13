import { describe, expect, it } from "vitest";
import { readToonsMemory } from "../src/read/toons-drawing.ts";

/**
 * A made-up program with one overlay: the segment table in the load image names a code segment, the data segment and
 * an overlay stub, and the overlay's code loads a segment that a fixup gives as the stub's entry (2) times 8.
 */
function program() {
  const image = new Uint8Array(0x200);
  const put = (at: number, bytes: number[]) => image.set(bytes, at);
  const word = (at: number, value: number) => put(at, [value & 0xff, value >> 8]);
  put(0x00, [0xba, 0x10, 0x00]);
  const header = 32;
  // The segment table at 0x100: segment, a word, flags, a word.
  [
    [0x00, 1],
    [0x10, 4],
    [0x18, 3],
  ].forEach(([segment, flags], i) => (word(0x100 + 8 * i, segment!), word(0x104 + 8 * i, flags!)));
  // The stub at 0x180: int 3Fh, the overlay at 0 of the overlay data, 6 bytes, one fixup, one routine at offset 2.
  put(0x180, [0xcd, 0x3f, 0, 0, 0, 0, 0, 0, 6, 0, 2, 0, 1, 0]);
  put(0x1a0, [0xcd, 0x3f, 2, 0, 0]);
  const overlay = [0x90, 0x90, 0xb8, 0x10, 0x00, 0xcb, 3, 0];
  const fbov = [
    0x46,
    0x42,
    0x4f,
    0x56,
    overlay.length,
    0,
    0,
    0,
    (header + 0x100) & 0xff,
    (header + 0x100) >> 8,
    0,
    0,
    3,
    0,
    0,
    0,
  ];
  const exeHeader = new Uint8Array(header);
  const size = header + image.length;
  exeHeader.set([0x4d, 0x5a, size % 512, 0, Math.ceil(size / 512), 0, 0, 0, 2, 0]);
  return Uint8Array.from([...exeHeader, ...image, ...fbov, ...overlay]);
}

describe("readToonsMemory", () => {
  it("lays each overlay after the load image with its fixups applied, and leads a stub's routine there", () => {
    const toons = readToonsMemory(program());
    expect(toons.dataSegment).toBe(0x10);
    expect(toons.codeSegments).toEqual([0]);
    expect(toons.memory.length).toBe(0x206);
    // The fixup turned the 0x10 the code keeps (entry 2 times 8) into the stub's segment, 0x18.
    expect([...toons.memory.subarray(0x200, 0x206)]).toEqual([0x90, 0x90, 0xb8, 0x18, 0x00, 0xcb]);
    expect(toons.resolve(0x18, 0x20)).toEqual({ segment: 0x20, offset: 2 });
    expect(toons.resolve(0x00, 0x20)).toEqual({ segment: 0, offset: 0x20 });
    expect(toons.fileOffset(0x202)).toBe(32 + 0x200 + 16 + 2);
    expect(toons.fileOffset(0x10)).toBe(32 + 0x10);
  });

  it("rejects an overlay segment table that runs past the end of the file", () => {
    const exe = program();
    // The count of the table's entries, after `FBOV`, its size and where the table is: 0x1000 entries of 8 bytes.
    const count = 32 + 0x200 + 12;
    exe.set([0x00, 0x10, 0, 0], count);
    expect(() => readToonsMemory(exe)).toThrow("runs past the end of the file");
  });
});
