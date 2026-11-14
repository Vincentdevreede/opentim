import { writeChunk } from "@opentim/resources";
import { afterEach, describe, expect, it } from "vitest";
import { usePalettes } from "../src/components/sprites/palettes.ts";
import { isTim2, sixteenColours, tim2ColourProblem, tim2Colours, tim2Driver } from "../src/components/tim2-colours.ts";
import type { Resource } from "../src/importer.ts";
import { program, resources } from "../src/library.ts";

/** A resource of the loaded files. */
const resource = (name: string, data: Uint8Array, group: Resource["group"] = "other"): Resource => ({
  name,
  kind: group === "palette" ? "palette" : "overlay",
  group,
  archive: "RESOURCE.001",
  offset: 0,
  data,
});

/** A made-up VM.OVL whose `HEG:` driver, not packed, does what TIM2.EXE's does. */
function vmOvl(): Uint8Array {
  const code = [
    ...[0xb2, 0xc0, 0x8a, 0xc1, 0xee, 0xeb, 0x00, 0xee],
    ...[0xb8, 0x13, 0x10, 0xbb, 0x00, 0x01, 0xcd, 0x10],
    ...[0x8a, 0xd0, 0x8a, 0xe0, 0xd0, 0xcc, 0xd0, 0xcc, 0xd0, 0xcc, 0xd0, 0xcc, 0x80, 0xe2, 0xf0],
  ];
  const packed = new Uint8Array(5 + code.length);
  new DataView(packed.buffer).setUint32(1, code.length, true);
  packed.set(code, 5);
  return writeChunk("OVL:", [writeChunk("HEG:", packed)]);
}

/** A palette whose colour n is n, n, n in 6 bits, so colour 17 differs from colour 1. */
function palette(): Uint8Array {
  return writeChunk("PAL:", [
    writeChunk(
      "VGA:",
      Uint8Array.from({ length: 768 }, (_, i) => ((i / 3) | 0) % 64),
    ),
  ]);
}

function load(name: string, files: Resource[]) {
  program.value = { name, data: new Uint8Array([0x4d, 0x5a]), sha256: "" };
  resources.value = files;
}

afterEach(() => {
  program.value = undefined;
  resources.value = [];
  tim2Colours.value = 16;
});

describe("the TIM 2 colours setting", () => {
  it("only counts for TIM 2", () => {
    load("TIM.EXE", [resource("VM.OVL", vmOvl())]);
    expect(isTim2.value).toBe(false);
    expect(tim2Driver.value).toBeUndefined();
    expect(sixteenColours.value).toBe(false);
    expect(tim2ColourProblem.value).toBeUndefined();
  });

  it("draws TIM 2 in 16 colours with the driver from VM.OVL, and in 256 when asked", () => {
    load("TIM2.EXE", [resource("VM.OVL", vmOvl()), resource("TIM.PAL", palette(), "palette")]);
    expect(sixteenColours.value).toBe(true);
    const { colorsOf } = usePalettes();
    // Colour 17 shows as colour 1: 4 × 255 / 63 rounds to 16.
    expect([...colorsOf("TIM.PAL")!.subarray(17 * 3, 18 * 3)]).toEqual([4, 4, 4]);
    tim2Colours.value = 256;
    expect(sixteenColours.value).toBe(false);
    expect([...colorsOf("TIM.PAL")!.subarray(17 * 3, 18 * 3)]).toEqual([69, 69, 69]);
  });

  it("says why without VM.OVL or with a driver it doesn't know, and only while 16 colours are asked for", () => {
    load("TIM2.EXE", []);
    expect(sixteenColours.value).toBe(false);
    expect(tim2ColourProblem.value).toMatch(
      /^VM\.OVL, which holds TIM2\.EXE’s video drivers, isn’t in the loaded files/,
    );
    load("TIM2.EXE", [resource("VM.OVL", writeChunk("OVL:", [writeChunk("VGA:", new Uint8Array(5))]))]);
    expect(tim2ColourProblem.value).toMatch(/^VM\.OVL has no HEG: driver\. .*palette’s own colours\.$/);
    tim2Colours.value = 256;
    expect(tim2ColourProblem.value).toBeUndefined();
  });
});
