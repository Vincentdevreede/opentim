import { describe, expect, it } from "vitest";
import { RECORD_SIZE, findDataSegment, findTypeTable, readOffsets, readTypes } from "../src/read/type-table.ts";

const DS = 0x100;
const TABLE = 0x40;
const TYPES = 8;

/**
 * A small program image: code that loads DS, a type table of eight records, and in the data segment a frame list
 * for type 2 with two frames and frame positions for type 3. Filler bytes don't look like records, so only the real
 * table fits.
 */
function image() {
  const img = new Uint8Array(DS * 16 + 0x100).fill(0xee);
  img.set([0xb8, DS & 0xff, DS >> 8, 0x8e, 0xd8], 0);
  img.set([0xba, DS & 0xff, DS >> 8, 0x8e, 0xda], 8);
  for (let t = 0; t < TYPES; t++) {
    const at = TABLE + t * RECORD_SIZE;
    img.fill(0, at, at + RECORD_SIZE);
    img.set([3, 0xff], at + 0x1c);
  }
  const data = DS * 16;
  const piece = (at: number, next: number, layer: number, frames: [number, number, number][]) => {
    img.fill(0xff, data + at, data + at + 15);
    img.set([next & 0xff, next >> 8, layer], data + at);
    frames.forEach(([frame, x, y], i) => {
      img[data + at + 3 + i] = frame;
      img.set([x & 0xff, y & 0xff], data + at + 7 + 2 * i);
    });
  };
  img.set([0x10, 0, 0x20, 0, 0, 0], data + 0x02); // the list: frames at 0x10 and 0x20, then the end
  img.set([0x02, 0], TABLE + 2 * RECORD_SIZE + 0x16);
  piece(0x10, 0, 4, [
    [0, 0, 0],
    [1, 9, 13],
  ]);
  piece(0x20, 0x30, 4, [[0, 0, 0]]);
  piece(0x30, 0, 5, [[2, -9, -6]]);
  img.set([0x40, 0], TABLE + 3 * RECORD_SIZE + 0x18);
  img.set([0, 0, 0xfa, 0xf0, 19, 0xff], data + 0x40);
  return img;
}

describe("the type table", () => {
  it("finds the data segment from the code that loads it", () => {
    expect(findDataSegment(image())).toBe(DS);
  });

  it("reads a type's frames as chains of pieces", () => {
    const types = readTypes(image(), DS, TABLE, TYPES);
    expect(types[0]).toEqual({ at: TABLE, layers: [3, 0xff], frames: [], offsets: 0 });
    expect(types[2]!.frames).toEqual([
      [
        {
          layer: 4,
          sprites: [
            { sprite: 0, x: 0, y: 0 },
            { sprite: 1, x: 9, y: 13 },
          ],
        },
      ],
      [
        { layer: 4, sprites: [{ sprite: 0, x: 0, y: 0 }] },
        { layer: 5, sprites: [{ sprite: 2, x: -9, y: -6 }] },
      ],
    ]);
  });

  it("reads the positions of a type's frames", () => {
    const type = readTypes(image(), DS, TABLE, TYPES)[3]!;
    expect(type.frames).toEqual([]);
    expect(readOffsets(image(), DS, type.offsets, 3)).toEqual([
      [0, 0],
      [-6, -16],
      [19, -1],
    ]);
  });

  it("finds the table where the frames fit the sheets", () => {
    expect(findTypeTable(image(), DS, TYPES, (t) => (t === 2 ? 3 : 1))).toBe(TABLE);
  });
});
