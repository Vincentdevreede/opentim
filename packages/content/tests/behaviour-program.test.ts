import { describe, expect, it } from "vitest";
import {
  behaviourProfile,
  BEHAVIOUR_PROFILES,
  loadOverlaidProgram,
  TIM_PROFILE,
} from "../src/read/behaviour-program.ts";

/**
 * A made-up program with one overlay. The load image has a code segment at 0 with a far call to the stub's second
 * routine (its segment word in the relocation table), the data segment at 0x10 with a far pointer to the same routine,
 * and the stub at 0x18. The overlay has two routines and a far call to the stub's first.
 */
function program() {
  const image = new Uint8Array(0x200);
  const put = (at: number, bytes: number[]) => image.set(bytes, at);
  const word = (at: number, value: number) => put(at, [value & 0xff, value >> 8]);
  // The entry loads the data segment; then call far 0x18:0x25.
  put(0x00, [0xba, 0x10, 0x00]);
  put(0x03, [0x9a, 0x25, 0x00, 0x18, 0x00]);
  // A far pointer in the data segment.
  put(0x120, [0x25, 0x00, 0x18, 0x00]);
  const header = 32;
  // The segment table at 0x140: segment, a word, flags, a word.
  [
    [0x00, 1],
    [0x10, 0],
    [0x18, 3],
  ].forEach(([segment, flags], i) => (word(0x140 + 8 * i, segment!), word(0x144 + 8 * i, flags!)));
  // The stub at 0x180: int 3Fh, the overlay at 0 of the overlay data, its size, no fixups, two routines.
  const overlay = [0x90, 0xcb, 0x9a, 0x20, 0x00, 0x18, 0x00, 0xcb];
  put(0x180, [0xcd, 0x3f, 0, 0, 0, 0, 0, 0, overlay.length, 0, 0, 0, 2, 0]);
  put(0x1a0, [0xcd, 0x3f, 0, 0, 0]);
  put(0x1a5, [0xcd, 0x3f, 2, 0, 0]);
  const fbov = [0x46, 0x42, 0x4f, 0x56, overlay.length, 0, 0, 0, (header + 0x140) & 0xff, (header + 0x140) >> 8, 0, 0];
  fbov.push(3, 0, 0, 0);
  const exeHeader = new Uint8Array(header);
  const size = header + image.length;
  // One relocation, at 0x1c, for the segment word of the far call.
  exeHeader.set([0x4d, 0x5a, size % 512, 0, Math.ceil(size / 512), 0, 1, 0, 2, 0]);
  exeHeader.set([0x1c, 0], 0x18);
  exeHeader.set([0x06, 0, 0, 0], 0x1c);
  return Uint8Array.from([...exeHeader, ...image, ...fbov, ...overlay]);
}

describe("behaviour profiles", () => {
  it("reads TIM 1 and Even More as TIM.EXE, and another list id too", () => {
    expect(behaviourProfile("tim1")).toBe(TIM_PROFILE);
    expect(behaviourProfile("evenmore")).toBe(TIM_PROFILE);
    expect(behaviourProfile("something else")).toBe(TIM_PROFILE);
    expect(behaviourProfile("toons")).toBe(BEHAVIOUR_PROFILES.toons);
    expect(BEHAVIOUR_PROFILES.tim2).toMatchObject({ recordLookup: "pointer-table", partPointer: "far" });
  });
});

describe("loadOverlaidProgram", () => {
  it("leads far calls and stub entries to the overlay's routines and keeps the load image as the file has it", () => {
    const read = loadOverlaidProgram(program());
    const { image, loadImage } = read;
    // The overlay is at 0x200, segment 0x20.
    expect(image.length).toBe(0x208);
    // The far call in the load image's code goes to the overlay's second routine, 0x20:2.
    expect([...image.subarray(0x03, 0x08)]).toEqual([0x9a, 0x02, 0x00, 0x20, 0x00]);
    // The far call in the overlay goes to its first routine.
    expect([...image.subarray(0x202, 0x207)]).toEqual([0x9a, 0x00, 0x00, 0x20, 0x00]);
    // Each stub entry is a far jump to its routine.
    expect([...image.subarray(0x1a0, 0x1aa)]).toEqual([0xea, 0, 0, 0x20, 0, 0xea, 2, 0, 0x20, 0]);
    // The far pointer in the data stays as the file has it, and the load image is untouched.
    expect([...image.subarray(0x120, 0x124)]).toEqual([0x25, 0x00, 0x18, 0x00]);
    expect([...loadImage.subarray(0x03, 0x08)]).toEqual([0x9a, 0x25, 0x00, 0x18, 0x00]);
    expect(read.routine(0x18, 0x25)).toEqual({ segment: 0x20, offset: 2, address: 0x202 });
    expect(read.routine(0x00, 0x03)).toEqual({ segment: 0, offset: 3, address: 3 });
  });
});
