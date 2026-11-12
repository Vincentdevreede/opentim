import { describe, expect, it } from "vitest";
import { writeChunk } from "../src/chunk.ts";
import { readTtmFiles, ttmPalettes } from "../src/ttm.ts";

const u16 = (...values: number[]) => [...new Uint8Array(new Uint16Array(values).buffer)];
const u32 = (value: number) => [...new Uint8Array(new Uint32Array([value]).buffer)];
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
/** A name argument: NUL-terminated and padded to an even length. */
const name = (text: string) => {
  const bytes = [...ascii(text), 0];
  return bytes.length & 1 ? [...bytes, 0] : bytes;
};

/** A script with these commands, unpacked inside its `TT3:` chunk. */
function script(code: number[]) {
  return Uint8Array.from([
    ...writeChunk("VER:", Uint8Array.from(ascii("4.14\0"))),
    ...writeChunk("TT3:", Uint8Array.from([0, ...u32(code.length), ...code])),
  ]);
}

describe("readTtmFiles", () => {
  it("lists the screens, bitmaps and palettes a script loads, skipping the other commands", () => {
    const code = [
      ...u16(0xf01f),
      ...name("TITLE.SCR"),
      ...u16(0x1061, 0),
      ...u16(0xf05f),
      ...name("game.PAL"),
      ...u16(0x2012, 3, 4),
      ...u16(0xf02f),
      ...name("ttl.bmp"),
    ];
    expect(readTtmFiles(script(code))).toEqual([
      { load: "screen", name: "TITLE.SCR" },
      { load: "palette", name: "game.PAL" },
      { load: "bitmap", name: "ttl.bmp" },
    ]);
  });

  it("ignores other commands with a name", () => {
    expect(readTtmFiles(script([...u16(0xf04f), ...name("SOUND"), ...u16(0xf02f), ...name("A.BMP")]))).toEqual([
      { load: "bitmap", name: "A.BMP" },
    ]);
  });

  it("refuses a file without a TT3: chunk", () => {
    expect(() => readTtmFiles(writeChunk("VER:", new Uint8Array(2)))).toThrow(/TT3/);
  });
});

describe("ttmPalettes", () => {
  it("gives an image the palette loaded before it, or else the first one after it", () => {
    const palettes = ttmPalettes([
      [
        { load: "screen", name: "TITLE.SCR" },
        { load: "palette", name: "game.PAL" },
        { load: "bitmap", name: "a.bmp" },
        { load: "palette", name: "OTHER.PAL" },
        { load: "bitmap", name: "b.bmp" },
      ],
    ]);
    expect(Object.fromEntries(palettes)).toEqual({
      "TITLE.SCR": "GAME.PAL",
      "A.BMP": "GAME.PAL",
      "B.BMP": "OTHER.PAL",
    });
  });
});
