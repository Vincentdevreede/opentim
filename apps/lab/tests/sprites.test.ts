import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import type { Resource } from "../src/importer.ts";
import { autoPalette, decode, paletteColors, statusOf } from "../src/sprites.ts";

const u16 = (...values: number[]) => new Uint8Array(new Uint16Array(values).buffer);
const u32 = (...values: number[]) => new Uint8Array(new Uint32Array(values).buffer);

function resource(name: string, data: Uint8Array): Resource {
  return { name, kind: "sprites", group: "sprites", archive: "RESOURCE.001", offset: 0, data };
}

describe("autoPalette", () => {
  it("prefers the palette with the image's name", () => {
    expect(autoPalette("TITLE.SCR", ["GAME.PAL", "TITLE.PAL"])).toEqual({
      name: "TITLE.PAL",
      reason: "same name as the image",
    });
  });

  it("falls back to the game's main palette", () => {
    expect(autoPalette("PART1.BMP", ["SIERRA.PAL", "TIM.PAL"])?.name).toBe("TIM.PAL");
    expect(autoPalette("CATBUTT.BMP", ["DYNAMIX.PAL", "GAME.PAL", "TITLE.PAL"])?.name).toBe("GAME.PAL");
    expect(autoPalette("PART1.BMP", ["OTHER.PAL"])?.name).toBe("OTHER.PAL");
    expect(autoPalette("PART1.BMP", [])).toBeUndefined();
  });
});

describe("decode", () => {
  it("decodes an image once", () => {
    const data = writeChunk("BMP:", [
      writeChunk("INF:", u16(1, 1, 1)),
      writeChunk("OFF:", u32(0)),
      writeChunk("SCN:", Uint8Array.of(0, 0x81, 5, 0x40)),
    ]);
    const r = resource("PART1.BMP", data);
    const result = decode(r);
    expect(result.status).toBe("decoded");
    expect(decode(r)).toBe(result);
  });

  it("tells a text file with an image name apart from a damaged image", () => {
    expect(decode(resource("TOONS.BMP", new TextEncoder().encode("\r\n Start  Stop   Length Name"))).status).toBe(
      "text",
    );
    expect(decode(resource("PART2.BMP", writeChunk("BMP:", [writeChunk("INF:", u16(1, 1, 1))])))).toEqual({
      status: "error",
      message: "No SCN: or BIN: chunk with pixels",
    });
  });
});

describe("paletteColors", () => {
  it("reads a palette, or nothing when it is damaged", () => {
    const vga = writeChunk("PAL:", [writeChunk("VGA:", new Uint8Array(768))]);
    expect(paletteColors(resource("TIM.PAL", vga))).toHaveLength(768);
    expect(paletteColors(resource("BAD.PAL", Uint8Array.of(1, 2)))).toBeUndefined();
  });
});

describe("statusOf", () => {
  it("badges a resource by what its decoder made of it", () => {
    const text = Uint8Array.from("\r\n Start  Stop", (c) => c.charCodeAt(0));
    expect(statusOf(resource("TOONS.BMP", text))).toEqual({ status: "unsupported", label: "not an image" });
    expect(statusOf({ ...resource("BAD.PAL", Uint8Array.of(1)), group: "palette" })).toEqual({
      status: "error",
      label: "decode error",
    });
    expect(statusOf({ ...resource("L1.LEV", Uint8Array.of(1)), group: "level" })).toEqual({ status: "unsupported" });
  });
});
