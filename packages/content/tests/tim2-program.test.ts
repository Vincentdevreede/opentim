import { describe, expect, it } from "vitest";
import { writeChunk } from "@opentim/resources";
import { TIM2_RECORD_SIZE, hasWallLimits, readTim2Types, tim2Drawing } from "../src/read/tim2-program.ts";

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

  it("refuses a program that isn't TIM2.EXE", () => {
    expect(() => readTim2Types(new Uint8Array(64))).toThrow(/MZ/);
  });

  it("tells a .PAR file with the walls' size limits", () => {
    const par = (largest: [number, number]) => {
      const data = new Uint8Array(0x24);
      data.set(Array.from("PROPI", (c) => c.charCodeAt(0)));
      const view = new DataView(data.buffer);
      view.setUint16(0x16, largest[0], true);
      view.setUint16(0x18, largest[1], true);
      return writeChunk("PAR:", data);
    };
    expect(hasWallLimits(par([576, 416]))).toBe(true);
    expect(hasWallLimits(par([576, 512]))).toBe(false);
    expect(hasWallLimits(new Uint8Array(4))).toBe(false);
  });
});
