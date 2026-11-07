import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { runOutlineTables } from "../src/read/behaviour-outline-run.ts";
import { outlineTableWords } from "../src/read/describe-outline.ts";

// The bellows' reset in Even More (English floppy, at 0x1944f): it picks a table from one of two lists by its frame,
// the second list when it is flipped left to right, copies 6 corners into the outline records and calls the helper
// that adds the edges.
const BELLOWS =
  "558bec83ec0456578b7606f744081000740b8b5c0cd1e38bbf822deb098b5c0cd1e38bbf582dc746fe00008b8482008946fceb178a058b5efc88078a4501884701ff46fe8346fc0483c702837efe067ce3569ae8690000595f5e8be55dcb";
// Its tables at 0x2d34, the unflipped list at 0x2d58, the flipped tables after it and their list at 0x2d82.
const BELLOWS_DATA =
  "00002c123f143f1b2c1d002f000a2c123f143f1b2c1d0025000e2c123f143f1b2c1d0021342d402d4c2d001413123f003f2f131d001b001413123f0a3f25131d001b001413123f0e3f21131d001b5e2d6a2d762d";
// The cat's reset (at 0x19cfb): one of two tables by whether it is flipped, 5 corners, whatever its frame.
const CAT =
  "558bec83ec0256578b5e06f7470810007405befe2deb03bef42dc746fe00008b5e068bbf8200eb138a0488058a4401884501ff46fe83c70483c602837efe057ce7ff76069ae8690000595f5e8be55dcb";
const CAT_DATA = "00070a00241a24250a28031a1d00270a1d280325";

const FIELDS = { outline: 0x82, state: 0x0c, flags: 0x08 };
const NAMES = { 0x10: "horizontalFlip" };

function program(code: string, entry: number, data: string, at: number) {
  const image = new Uint8Array(entry + 0x100);
  image.set(Buffer.from(code, "hex"), entry);
  image.set(Buffer.from(data, "hex"), at);
  return image;
}
const run = (image: Uint8Array, entry: number, frames: number, written = new Set<number>()) => {
  const code = readRoutineCode(image, { segment: 0x1000, offset: entry - 0x10000, address: entry }, 0);
  return runOutlineTables(code, image, 0, FIELDS, frames, written);
};

describe("outline tables found by running the reset", () => {
  it("reads the bellows' outline for each frame, flipped and not", () => {
    const copy = run(program(BELLOWS, 0x1944f, BELLOWS_DATA, 0x2d34), 0x1944f, 3)!;
    expect(copy.tables).toHaveLength(6);
    expect(copy.tables[0]).toEqual({
      when: [["frame == 0", "flags & 0x10 == 0"]],
      address: 0x2d34,
      corners: [
        [0, 0],
        [44, 18],
        [63, 20],
        [63, 27],
        [44, 29],
        [0, 47],
      ],
    });
    expect(copy.tables[1]).toMatchObject({ when: [["frame == 0", "flags & 0x10 != 0"]], address: 0x2d5e });
    expect(outlineTableWords(copy, NAMES)).toMatch(
      /^Copies its outline from a table chosen by its frame and how it is flipped: on frame 0 when not flipped left to right, 6 corners \(0, 0\), .*; on frame 0 when flipped left to right, 6 corners \(0, 20\), /,
    );
  });

  it("reads the cat's two outlines by flip alone, as its reset never reads its frame", () => {
    const copy = run(program(CAT, 0x19cfb, CAT_DATA, 0x2df4), 0x19cfb, 10)!;
    expect(copy.tables.map((table) => table.when)).toEqual([[["flags & 0x10 == 0"]], [["flags & 0x10 != 0"]]]);
    expect(outlineTableWords(copy, NAMES)).toBe(
      "Copies its outline from a table chosen by how it is flipped: when not flipped left to right, 5 corners (0, 7), (10, 0), (36, 26), (36, 37), (10, 40); when flipped left to right, 5 corners (3, 26), (29, 0), (39, 10), (29, 40), (3, 37).",
    );
  });

  it("gives no tables when an instruction writes into one by its address", () => {
    expect(run(program(CAT, 0x19cfb, CAT_DATA, 0x2df4), 0x19cfb, 10, new Set([0x2e00]))).toBeUndefined();
  });

  it("gives no tables when the reset reads a part field other than the frame, outline and flags", () => {
    // test word [bx+0x0a], 0x10 in place of the flag test.
    const image = program(CAT, 0x19cfb, CAT_DATA, 0x2df4);
    image[0x19cfb + 13] = 0x0a;
    expect(run(image, 0x19cfb, 10)).toBeUndefined();
  });

  it("gives no tables for a part without frames when its reset reads the frame", () => {
    expect(run(program(BELLOWS, 0x1944f, BELLOWS_DATA, 0x2d34), 0x1944f, 0)).toBeUndefined();
  });
});
