import { describe, expect, it } from "vitest";
import { writeChunk } from "@opentim/resources";
import { TIM2_RECORD_SIZE, readPar, readTim2Types, tim2Drawing, tim2MirrorSide } from "../src/read/tim2-program.ts";

/** A made-up program: an MZ header, entry code that loads the data segment, and a type table with its records. */
function program(types: number, draw: (type: number) => number): Uint8Array {
  const header = 0x20;
  const dataSegment = 2; // paragraphs after the code, so 0x20 bytes into the image
  const table = 0x10;
  const records = table + types * 2;
  const image = new Uint8Array(0x20 + records + types * TIM2_RECORD_SIZE);
  const view = new DataView(image.buffer);
  image.set([0xba, dataSegment, 0], 0); // mov dx, segment, where the header says the entry is
  for (let type = 0; type < types; type++) {
    const record = records + type * TIM2_RECORD_SIZE;
    view.setUint16(0x20 + table + type * 2, record, true);
    view.setUint32(0x20 + record + 0x18, draw(type), true);
  }
  const exe = new Uint8Array(header + image.length);
  const head = new DataView(exe.buffer);
  head.setUint16(0, 0x5a4d, true);
  head.setUint16(8, header / 16, true);
  exe.set(image, header);
  return exe;
}

describe("TIM2.EXE's type table", () => {
  it("finds the records and tells walls, tile patterns and colour blocks by the routine they share with types 1, 122 and 127", () => {
    const draw = (type: number) =>
      type === 1 || type === 46
        ? 0x14242ce0
        : type >= 121 && type <= 124
          ? 0x21f7b87b
          : type === 127
            ? 0x21f7b1ab
            : 0x14242e7d;
    const types = readTim2Types(program(130, draw));
    expect(types.records).toHaveLength(130);
    expect(types.table).toBe(0x10);
    const drawing = tim2Drawing(types);
    expect([...drawing].filter(([, how]) => how === "wall").map(([t]) => t)).toEqual([1, 46]);
    expect([...drawing].filter(([, how]) => how === "pattern").map(([t]) => t)).toEqual([121, 122, 123, 124]);
    expect(drawing.get(127)).toBe("block");
    expect(drawing.get(0)).toBe("frame");
  });

  it("refuses a program cut off before its last record ends", () => {
    const exe = program(30, () => 0x14242e7d);
    expect(readTim2Types(exe).records).toHaveLength(30);
    expect(() => readTim2Types(exe.slice(0, exe.length - 1))).toThrow(/Type 29's record runs past the program/);
  });

  it("refuses a program that isn't TIM2.EXE", () => {
    expect(() => readTim2Types(new Uint8Array(64))).toThrow(/MZ/);
  });

  it("reads a .PAR file's properties and outlines", () => {
    const words = [0x149, 12, 2000, 120, 0, 64, 0, 240, 240, 0, 0, 39, 42, 8, 1, 2];
    const points = [7, 9, 0, 0, 1, 0x4000, 38, 41];
    const data = new Uint8Array(4 + (words.length + points.length) * 2);
    data.set([0x50, 0x52, 0x4f, 0x50]);
    const view = new DataView(data.buffer);
    [...words, ...points].forEach((w, i) => view.setInt16(4 + i * 2, w, true));
    const properties = readPar(writeChunk("PAR:", data))!;
    expect(properties).toMatchObject({
      version: 0x149,
      type: 12,
      density: 2000,
      mass: 120,
      friction: 64,
      minSize: { width: 240, height: 240 },
      maxSize: { width: 0, height: 0 },
      size: { width: 39, height: 42 },
      flags: 8,
    });
    expect(properties.outlines).toEqual([
      {
        skipped: [7, 9],
        points: [
          { flags: 0, x: 0, y: 1 },
          { flags: 0x4000, x: 38, y: 41 },
        ],
      },
    ]);
    data[0] = 0x51;
    expect(readPar(writeChunk("PAR:", data))).toBeUndefined();
  });

  it("measures a mirrored part from where TIM2.EXE's size routine and draw routine put it", () => {
    const type = {
      frames: [
        { id: 0, box: { x: 0, y: 0, width: 45, height: 42 } },
        { id: 1, box: { x: 2, y: 0, width: 30, height: 40 } },
      ],
      states: [0, 1],
      mirrorBox: { width: 45, height: 42 },
      parSize: { width: 39, height: 42 },
    };
    const part = (t: number, third = 0, state = 0) => ({
      type: t,
      size: { width: 64, height: 32 },
      flags: [0, 0x10, third],
      state: [state, 0],
    });
    // Most types: the .PAR size, less the first frame's right edge, plus the animation's size.
    expect(tim2MirrorSide(part(12), type)).toEqual({ width: 39, height: 42 });
    // Bit 0x1000 of the third flag word: the size of the frame the state shows.
    expect(tim2MirrorSide(part(12, 0x1000, 1), type)).toEqual({ width: 30, height: 40 });
    // The goldfish bowl (88) always takes its frame's size, the gear (8) 0, and the tiles their own size.
    expect(tim2MirrorSide(part(88, 0, 1), type)).toEqual({ width: 30, height: 40 });
    expect(tim2MirrorSide(part(8), type)).toEqual({ width: 0, height: 0 });
    expect(tim2MirrorSide(part(122), type)).toEqual({ width: 64, height: 32 });
    // Without the .PAR size, or the animation, it can't say.
    expect(tim2MirrorSide(part(12), { ...type, parSize: undefined })).toBeUndefined();
    expect(tim2MirrorSide(part(12), { ...type, mirrorBox: undefined })).toBeUndefined();
  });
});
