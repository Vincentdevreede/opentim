import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import type { Resource } from "../src/importer.ts";
import { fieldsOf } from "../src/fields.ts";
import { inspectByte } from "../src/inspect.ts";

const u16 = (...values: number[]) => new Uint8Array(new Uint16Array(values).buffer);
const u32 = (...values: number[]) => new Uint8Array(new Uint32Array(values).buffer);

function resource(name: string, group: Resource["group"], data: Uint8Array): Resource {
  return { name, kind: "binary", group, archive: "RESOURCE.001", offset: 100, data };
}

// Two frames: 2×1 and 3×1. BMP: at 0, INF: at 8 (data 16), OFF: at 26 (data 34), SCN: at 42 (data 50).
const frames = [Uint8Array.of(0, 0x82, 5, 0x40), Uint8Array.of(16, 0xc3, 0x12, 0x30, 0x40)];
const sheet = resource(
  "PART1.BMP",
  "sprites",
  writeChunk("BMP:", [
    writeChunk("INF:", u16(2, 2, 3, 1, 1)),
    writeChunk("OFF:", u32(0, 4)),
    writeChunk("SCN:", Uint8Array.from([...frames[0]!, ...frames[1]!])),
  ]),
);

const inspect = (r: Resource, offset: number, palette?: Uint8Array) => inspectByte(r, offset, fieldsOf(r), palette);

describe("inspectByte", () => {
  it("tells where a byte is in its archive and chunk", () => {
    const info = inspect(sheet, 19);
    expect(info.archiveOffset).toBe(100 + 17 + 19);
    expect(info.chunk).toEqual({ tag: "INF:", relative: 3, header: false });
  });

  it("explains chunk headers", () => {
    expect(inspect(sheet, 9)).toMatchObject({ meaning: "chunk tag: INF:", range: [8, 12] });
    expect(inspect(sheet, 13)).toMatchObject({ meaning: "chunk size: 10", range: [12, 16] });
  });

  it("explains the frame sizes and offsets", () => {
    expect(inspect(sheet, 16).meaning).toBe("frame count: 2");
    expect(inspect(sheet, 21)).toMatchObject({ meaning: "width of frame 1: 3", range: [20, 22] });
    expect(inspect(sheet, 24).meaning).toBe("height of frame 1: 1");
    expect(inspect(sheet, 38)).toMatchObject({ meaning: "start of frame 1: 0x0004", jump: 54 });
  });

  it("explains SCN commands with their colours", () => {
    const palette = new Uint8Array(768);
    palette.set([255, 0, 0], 5 * 3);
    expect(inspect(sheet, 52, palette)).toMatchObject({
      meaning: "repeat a colour: 5 × 2",
      group: "frame 0",
      detail: "at x 0, y 0",
      range: [51, 53],
      swatches: [{ index: 5, color: "rgb(255 0 0)" }],
    });
    expect(inspect(sheet, 54)).toMatchObject({ meaning: "base colour, added to every colour: 16", group: "frame 1" });
    const copy = inspect(sheet, 57);
    expect(copy).toMatchObject({ meaning: "copy colours: 3", range: [55, 58] });
    expect(copy.swatches?.map((s) => s.index)).toEqual([17, 18, 19]);
    expect(inspect(sheet, 58).meaning).toBe("end of frame");
  });

  it("tells which frame a byte belongs to", () => {
    expect(inspect(sheet, 24).frame).toBe(1);
    expect(inspect(sheet, 34).frame).toBe(0);
    expect(inspect(sheet, 56).frame).toBe(1);
    expect(inspect(sheet, 16).frame).toBeUndefined();
  });

  it("explains palette colours", () => {
    const vga = new Uint8Array(768);
    vga.set([63, 32, 0], 3);
    const pal = resource("TIM.PAL", "palette", writeChunk("PAL:", [writeChunk("VGA:", vga)]));
    expect(inspect(pal, 16 + 4)).toMatchObject({
      meaning: "colour 1: 63 32 0",
      range: [19, 22],
    });
  });

  it("explains the header of compressed pixels", () => {
    const data = writeChunk("SCR:", [
      writeChunk("DIM:", u16(2, 1)),
      writeChunk("BIN:", Uint8Array.of(2, ...u32(1), 0)),
    ]);
    const screen = resource("TITLE.SCR", "screen", data);
    expect(inspect(screen, 18).meaning).toBe("height: 1");
    expect(inspect(screen, 28).meaning).toBe("compression: LZW");
    expect(inspect(screen, 30).meaning).toBe("unpacked size: 1");
  });

  it("reads a file without chunks as words", () => {
    const text = resource("TOONS.BMP", "sprites", Uint8Array.of(13, 10, 32));
    expect(inspect(text, 1)).toEqual({ archiveOffset: 118, meaning: "word: 2573", type: "u16 LE", range: [0, 2] });
    expect(inspect(text, 2)).toMatchObject({ meaning: "byte: 32", range: [2, 3] });
  });
});
