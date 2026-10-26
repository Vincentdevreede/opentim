import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import type { Resource } from "../src/importer.ts";
import { headerBytes, markerAt, markersOf } from "../src/markers.ts";

const u16 = (...values: number[]) => new Uint8Array(new Uint16Array(values).buffer);
const u32 = (...values: number[]) => new Uint8Array(new Uint32Array(values).buffer);

function resource(name: string, group: Resource["group"], data: Uint8Array): Resource {
  return { name, kind: "binary", group, archive: "RESOURCE.001", offset: 0, data };
}

const sheet = (scn: Uint8Array) =>
  writeChunk("BMP:", [writeChunk("INF:", u16(1, 1, 1)), writeChunk("OFF:", u32(0)), writeChunk("SCN:", scn)]);

describe("markersOf", () => {
  it("marks every chunk of an image, nested in its container", () => {
    const { markers, note } = markersOf(resource("PART1.BMP", "sprites", sheet(Uint8Array.of(0, 0x81, 5, 0x40))));
    expect(note).toBeUndefined();
    expect(markers.map((m) => [m.offset, m.label, m.depth])).toEqual([
      [0, "BMP:", 0],
      [8, "INF:", 1],
      [22, "OFF:", 1],
      [34, "SCN:", 1],
    ]);
    expect(markers[1]!.detail).toBe("frame count, widths and heights · 6 B");
  });

  it("marks where the decoder stopped first", () => {
    const { markers } = markersOf(resource("PART2.BMP", "sprites", sheet(Uint8Array.of(0, 0x81, 99, 0x40))));
    expect(markers[0]).toMatchObject({ offset: 34 + 8 + 1, label: "Stopped", error: true });
    expect(markers).toHaveLength(5);
  });

  it("marks the colours of a palette", () => {
    const pal = writeChunk("PAL:", [writeChunk("VGA:", new Uint8Array(768))]);
    expect(markersOf(resource("TIM.PAL", "palette", pal)).markers.map((m) => m.detail)).toEqual([
      "palette · 776 B",
      "256 colours, 6 bits per channel · 768 B",
    ]);
  });

  it("explains files without markers", () => {
    expect(markersOf(resource("L1.LEV", "level", Uint8Array.of(1))).note).toMatch(/No decoder reads/);
    const text = Uint8Array.from("\r\n Start  Stop", (c) => c.charCodeAt(0));
    expect(markersOf(resource("TOONS.BMP", "sprites", text)).note).toMatch(/text/);
  });
});

describe("markerAt", () => {
  it("finds the innermost chunk holding a byte, and the header bytes", () => {
    const { markers } = markersOf(resource("PART3.BMP", "sprites", sheet(Uint8Array.of(0, 0x81, 5, 0x40))));
    expect(markerAt(markers, 25)?.label).toBe("OFF:");
    expect(markerAt(markers, 2)?.label).toBe("BMP:");
    expect(headerBytes(markers).has(29)).toBe(true);
    expect(headerBytes(markers).has(30)).toBe(false);
  });
});
