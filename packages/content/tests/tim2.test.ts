import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import { animationSheets, readPartNames } from "../src/read/tim2.ts";

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe("TIM 2", () => {
  it("reads the part names from INFO.RES", () => {
    const info = bytes("  0.\tBowling Ball\tHelp text one.\r\n10.\tRope\tHelp text two.\r\nnot a part\r\n");
    expect(readPartNames(info)).toEqual(
      new Map([
        [0, "Bowling Ball"],
        [10, "Rope"],
      ]),
    );
  });

  it("reads the sheets an animation draws from", () => {
    const tag = Uint8Array.from([2, 0, 1, 0, ...bytes("part18X.BMP\0"), 2, 0, ...bytes("PART41.BMP\0")]);
    const anm = Uint8Array.from([...writeChunk("ANM:", new Uint8Array(4)), ...writeChunk("TAG:", tag)]);
    expect(animationSheets(anm)).toEqual(["PART18X", "PART41"]);
  });
});
