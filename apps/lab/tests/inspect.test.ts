import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import type { Resource } from "../src/importer.ts";
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

describe("inspectByte", () => {
  it("tells where a byte is in its archive and chunk", () => {
    const info = inspectByte(sheet, 19);
    expect(info.archiveOffset).toBe(100 + 17 + 19);
    expect(info.chunk).toEqual({ tag: "INF:", relative: 3, header: false });
  });

  it("explains chunk headers", () => {
    expect(inspectByte(sheet, 9)).toMatchObject({ meaning: "tag INF:", range: [8, 12] });
    expect(inspectByte(sheet, 13)).toMatchObject({ meaning: "size: 10 bytes", range: [12, 16] });
  });

  it("explains the frame sizes and offsets", () => {
    expect(inspectByte(sheet, 16).meaning).toBe("frame count: 2");
    expect(inspectByte(sheet, 21)).toMatchObject({ meaning: "width of frame 1: 3", range: [20, 22] });
    expect(inspectByte(sheet, 24).meaning).toBe("height of frame 1: 1");
    expect(inspectByte(sheet, 38)).toMatchObject({ meaning: "frame 1 starts at SCN: + 0x0004", jump: 54 });
  });

  it("explains SCN commands with their colours", () => {
    const palette = new Uint8Array(768);
    palette.set([255, 0, 0], 5 * 3);
    expect(inspectByte(sheet, 52, palette)).toMatchObject({
      meaning: "frame 0 · repeat colour 5 × 2",
      detail: "at x 0, y 0",
      range: [51, 53],
      swatches: [{ index: 5, color: "rgb(255 0 0)" }],
    });
    expect(inspectByte(sheet, 54).meaning).toBe("frame 1 · base colour 16");
    const copy = inspectByte(sheet, 57);
    expect(copy).toMatchObject({ meaning: "frame 1 · copy 3 colours", range: [55, 58] });
    expect(copy.swatches?.map((s) => s.index)).toEqual([17, 18, 19]);
    expect(inspectByte(sheet, 58).meaning).toBe("frame 1 · end of frame");
  });

  it("tells which frame a byte belongs to", () => {
    expect(inspectByte(sheet, 24).frame).toBe(1);
    expect(inspectByte(sheet, 34).frame).toBe(0);
    expect(inspectByte(sheet, 56).frame).toBe(1);
    expect(inspectByte(sheet, 16).frame).toBeUndefined();
  });

  it("explains palette colours", () => {
    const vga = new Uint8Array(768);
    vga.set([63, 32, 0], 3);
    const pal = resource("TIM.PAL", "palette", writeChunk("PAL:", [writeChunk("VGA:", vga)]));
    expect(inspectByte(pal, 16 + 4)).toMatchObject({
      meaning: "colour 1: green of R 63 G 32 B 0",
      range: [19, 22],
    });
  });

  it("explains the header of compressed pixels", () => {
    const data = writeChunk("SCR:", [
      writeChunk("DIM:", u16(2, 1)),
      writeChunk("BIN:", Uint8Array.of(2, ...u32(1), 0)),
    ]);
    const screen = resource("TITLE.SCR", "screen", data);
    expect(inspectByte(screen, 18).meaning).toBe("height: 1");
    expect(inspectByte(screen, 28).meaning).toBe("compression: LZW (2)");
    expect(inspectByte(screen, 30).meaning).toBe("unpacked size: 1 byte");
  });

  it("only places bytes outside chunks", () => {
    const text = resource("TOONS.BMP", "sprites", Uint8Array.of(13, 10, 32));
    expect(inspectByte(text, 1)).toEqual({ archiveOffset: 118 });
  });
});
