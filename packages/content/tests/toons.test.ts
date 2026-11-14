import { describe, expect, it } from "vitest";
import { readToonsParts } from "../src/read/parts.ts";
import {
  findToonsTypeTable,
  loadImage,
  readToonsActions,
  readToonsTypes,
  TOONS_RECORD_SIZE,
} from "../src/read/toons.ts";

/**
 * A made-up program: code that reaches the table the way TOONS.EXE does and walks three types, a table of three
 * records at segment 0x10, and a frame list with its pieces, positions and sizes after it.
 */
function program() {
  const image = new Uint8Array(0x400);
  const put = (at: number, bytes: number[]) => image.set(bytes, at);
  const word = (at: number, value: number) => put(at, [value & 0xff, value >> 8]);
  const far = (at: number, segment: number, offset: number) => (word(at, offset), word(at + 2, segment));
  // 0x10: mov ax, si; mov dx, 70; imul dx; add ax, 0x0000; mov word [bp-0x28], 0x0010
  put(0x10, [0x8b, 0xc6, 0xba, 0x46, 0x00, 0xf7, 0xea, 0x05, 0x00, 0x00, 0xc7, 0x46, 0xd8, 0x10, 0x00]);
  // inc si; cmp si, 3; jl back to 0x10
  put(0x1f, [0x46, 0x83, 0xfe, 0x03, 0x7c, 0x10 - 0x25]);
  const table = 0x100;
  const record = (t: number) => table + t * TOONS_RECORD_SIZE;
  // Type 1: frames, positions and sizes at segment 0x30, the list from 0x00, two frames.
  far(record(1) + 0x18, 0x30, 0x00);
  far(record(1) + 0x20, 0x30, 0x08);
  far(record(1) + 0x1c, 0x30, 0x10);
  put(record(1) + 0x26, [3, 0xff]);
  far(0x300, 0x32, 0x00);
  far(0x304, 0x32, 0x11);
  put(0x310, [0, 0, 5, 6]);
  // Piece at 0x320: next is the piece at 0x331, layer 3, sprites 0 and 1.
  far(0x320, 0x33, 0x01);
  put(0x324, [3, 0, 1, 0xff, 0xff, 2, 3, 0xfc, 5]);
  put(0x331, [0, 0, 0, 0, 4, 2, 0xff, 0xff, 0xff, 7, 8]);
  // Type 2: no frames, a position per state, drawn as tiles with two middle tiles.
  far(record(2) + 0x1c, 0x38, 0x00);
  put(0x380, [1, 2, 0xff, 0xfe]);
  put(record(2) + 0x26, [5, 0xff]);
  put(record(2) + 0x2c, [2]);
  const header = new Uint8Array(32);
  const size = header.length + image.length;
  header.set([0x4d, 0x5a, size % 512, 0, Math.ceil(size / 512), 0, 0, 0, 2, 0]);
  return Uint8Array.from([...header, ...image]);
}

describe("loadImage", () => {
  it("gives the bytes after the header, up to the size the header gives", () => {
    expect(loadImage(program()).length).toBe(0x400);
  });

  it("refuses a file that isn't a DOS program", () => {
    expect(() => loadImage(new Uint8Array(64))).toThrow(/MZ/);
  });
});

describe("findToonsTypeTable", () => {
  it("finds the table where the code reaches it, and the count where its loops stop", () => {
    expect(findToonsTypeTable(loadImage(program()))).toEqual({ start: 0x100, count: 3 });
  });
});

describe("readToonsTypes", () => {
  it("reads frames as chains of pieces, ending the list where the sizes start", () => {
    const [, one, two] = readToonsTypes(loadImage(program()), 0x100, 3);
    expect(one!.layers).toEqual([3, 0xff]);
    expect(one!.frames).toEqual([
      [
        {
          layer: 3,
          sprites: [
            { sprite: 0, x: 2, y: 3 },
            { sprite: 1, x: -4, y: 5 },
          ],
        },
        { layer: 4, sprites: [{ sprite: 2, x: 7, y: 8 }] },
      ],
      [{ layer: 4, sprites: [{ sprite: 2, x: 7, y: 8 }] }],
    ]);
    expect(one!.positions?.slice(0, 2)).toEqual([
      [0, 0],
      [5, 6],
    ]);
    expect(two!.frames).toEqual([]);
    expect(two!.positions?.slice(0, 2)).toEqual([
      [1, 2],
      [-1, -2],
    ]);
    expect(two!.middles).toBe(2);
  });
});

describe("readToonsParts", () => {
  it("makes parts of the types with a sheet, sprite N as frame N where there are no frames", () => {
    const sprites: Record<string, number> = { PART1: 3, PART2: 2 };
    const read = readToonsParts(program(), (sheet) => sprites[sheet], { keepUnknown: true });
    expect(read.list.parts.map((p) => p.type)).toEqual([1, 2]);
    const two = read.list.parts[1]!;
    expect(two.frames.map((f) => f.sprites)).toEqual([
      [{ sheet: "PART2", sprite: 0, x: 1, y: 2, layer: 5 }],
      [{ sheet: "PART2", sprite: 1, x: -1, y: -2, layer: 5 }],
    ]);
    expect(two.tiles).toEqual({ width: 16, middles: 2 });
    expect(read.records.map((r) => r.bytes.length)).toEqual([70, 70, 70]);
  });

  it("refuses a frame that uses a sprite its sheet doesn't have", () => {
    expect(() => readToonsParts(program(), (sheet) => (sheet === "PART1" ? 2 : undefined))).toThrow(/sprite 2/);
  });
});

/** A made-up program with Al's and Sid's tables where TOONS.EXE's code finds them. */
function critterProgram() {
  const image = new Uint8Array(0x800);
  const put = (at: number, bytes: number[]) => image.set(bytes, at);
  const word = (at: number, value: number) => put(at, [value & 0xff, value >> 8]);
  const text = (at: number, value: string) =>
    put(
      at,
      [...value].map((c) => c.charCodeAt(0)),
    );
  // The start-up code loads the data segment, 0x40.
  put(0x00, [0xba, 0x40, 0x00]);
  // mov ax, 0x60; mov es, ax; mov si, es:[bx + table], for Al and then Sid.
  put(0x10, [0xb8, 0x60, 0x00, 0x8e, 0xc0, 0x26, 0x8b, 0xb7, 0x00, 0x00]);
  put(0x20, [0xb8, 0x60, 0x00, 0x8e, 0xc0, 0x26, 0x8b, 0xb7, 0x10, 0x00]);
  // mov dx, 9; imul dx; add ax, names.
  put(0x30, [0xba, 0x09, 0x00, 0xf7, 0xea, 0x05, 0x00, 0x01]);
  put(0x40, [0xba, 0x09, 0x00, 0xf7, 0xea, 0x05, 0x80, 0x01]);
  // mov dx, 6; imul dx; mov dx, 0x68; mov bx, ax; mov es, dx; cmp word es:[bx + table], 0.
  const first = (at: number, table: number) =>
    put(at, [0xba, 6, 0, 0xf7, 0xea, 0xba, 0x68, 0, 0x8b, 0xd8, 0x8e, 0xc2, 0x26, 0x83, 0xbf, table, 0, 0]);
  first(0x50, 0x00);
  first(0x70, 0x20);
  // Al: action 0 has an entry, action 1 none, action 2 another; a pointer that isn't an entry ends the table.
  [0xe8, 0, 0xf4, 0x01].forEach((p, i) => word(0x600 + 2 * i, p));
  put(0x400 + 0xe8, [1, 0]);
  put(0x400 + 0xf4, [3, 1]);
  text(0x500, "catroot");
  text(0x509, "catwalk");
  [0, 0, 0xfffe].forEach((f, i) => word(0x680 + 6 * i, f));
  // Sid: one action.
  word(0x610, 0x174);
  put(0x400 + 0x174, [2, 0]);
  text(0x580, "sidroot");
  const header = new Uint8Array(32);
  const size = header.length + image.length;
  header.set([0x4d, 0x5a, size % 512, 0, Math.ceil(size / 512), 0, 0, 0, 2, 0]);
  return Uint8Array.from([...header, ...image]);
}

describe("readToonsActions", () => {
  it("reads each action's first frame, frame count and sheet, Al's tables first", () => {
    const actions = readToonsActions(critterProgram());
    expect(actions.get(36)).toEqual([
      { start: 0, frames: 1, sheet: "CATROOT" },
      undefined,
      { start: 2, frames: 3, sheet: "CATWALK" },
    ]);
    expect(actions.get(37)).toEqual([{ start: 0, frames: 2, sheet: "SIDROOT" }]);
  });

  it("gives nothing when the code that reads the tables isn't there", () => {
    expect(readToonsActions(program()).size).toBe(0);
  });
});
