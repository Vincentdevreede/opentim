import type { Part } from "@opentim/content";
import { writeChunk } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import type { Edition } from "../src/edition.ts";
import { findParts, listIdOf, partName, readLoadedParts, whyNoFrames } from "../src/parts.ts";

const part = (id: string, type: number, extra: Partial<Part> = {}): Part => ({
  id,
  type,
  sheets: [`PART${type}`],
  frames: [],
  ...extra,
});

describe("listIdOf", () => {
  it("gives the list of a recognised version that has one", () => {
    const profile = { id: "x", name: "X", languages: [], files: [], parts: "tim1", program: "TIM.EXE" };
    expect(listIdOf({ status: "recognized", profile })).toBe("tim1");
    expect(listIdOf({ status: "recognized", profile: { ...profile, parts: undefined } })).toBeUndefined();
    expect(listIdOf({ status: "unknown" } as Edition)).toBeUndefined();
    expect(listIdOf(undefined)).toBeUndefined();
  });
});

describe("readLoadedParts", () => {
  const exe = (name: string, data = new Uint8Array(64)) => ({ name, data });

  it("says why the parts can't be read, without a list to stand in", () => {
    expect(readLoadedParts(undefined, [], exe("TIM.EXE"))).toBeUndefined();
    const damaged = readLoadedParts("evenmore", [], exe("TIM.EXE"));
    expect(damaged?.list).toBeUndefined();
    expect(damaged?.problem).toMatch(/no MZ header/);
    expect(readLoadedParts("tim2", [], exe("TIM2.EXE"))?.problem).toMatch(/INFO\.RES/);
  });

  it("reads the parts only from the game's own program", () => {
    expect(readLoadedParts("tim1", [], exe("TOONS.EXE"))?.problem).toMatch(/from TIM\.EXE, not TOONS\.EXE/);
    expect(readLoadedParts("toons", [], exe("TIM.EXE"))?.problem).toMatch(/from TOONS\.EXE, not TIM\.EXE/);
  });

  it("keeps a TIM 2 part OpenTIM has no id for, and names it as unknown", () => {
    const text = "0.\tBowling Ball\tHelp.\r\n999.\tSomething New\tHelp.\r\n";
    const info = Uint8Array.from(text, (c) => c.charCodeAt(0));
    const loaded = readLoadedParts(
      "tim2",
      [{ name: "INFO.RES", kind: "binary", group: "other", archive: "RESOURCE.001", offset: 0, data: info }],
      exe("TIM2.EXE"),
    );
    expect(loaded?.source).toBe("resources");
    expect(loaded?.unknown).toEqual([999]);
  });

  it("reads TIM 2 frames from the .ANM files", () => {
    const resource = (name: string, data: Uint8Array) =>
      ({ name, kind: "binary", group: "other", archive: "RESOURCE.001", offset: 0, data }) as const;
    const words = (...values: number[]) => new Uint8Array(Uint16Array.from(values).buffer);
    // One frame that draws sprite 0 of sheet 1 at (2, 3), in a 10 by 10 box at the origin.
    const anm = words(0x4254, 1001, 0, 1, 0, 16, 10, 10, 0, 0, 10, 10, 0, 2, 1, 0, 2, 3, 0, 0, 1);
    const tag = Uint8Array.from([1, 0, 1, 0, ...Array.from("PART0.BMP\0", (c) => c.charCodeAt(0))]);
    const loaded = readLoadedParts(
      "tim2",
      [
        resource(
          "INFO.RES",
          Uint8Array.from("0.\tBowling Ball\tHelp.\r\n", (c) => c.charCodeAt(0)),
        ),
        resource("PART0.ANM", Uint8Array.from([...writeChunk("ANM:", anm), ...writeChunk("TAG:", tag)])),
        resource("PART0.BMP", new Uint8Array(1)),
      ],
      exe("TIM2.EXE"),
    );
    expect(loaded?.list?.parts[0]?.frames).toEqual([
      {
        id: 0,
        sprites: [{ sheet: "PART0", sprite: 0, x: 2, y: 3, layer: 0 }],
        box: { x: 0, y: 0, width: 10, height: 10 },
      },
    ]);
  });
});

describe("partName", () => {
  it("prefers the game's own name, then TIM 2's name for the same object, then the id", () => {
    expect(partName(part("balloon", 4, { name: "Big Balloon" }))).toEqual({ name: "Big Balloon", source: "game" });
    expect(partName(part("bowling-ball", 0))).toEqual({ name: "Bowling Ball", source: "game" });
    expect(partName(part("jack-o-lantern", 32))).toEqual({ name: "Jack o lantern", source: "id" });
    expect(partName(part("explosion", 41)).name).toBe("Explosion");
  });

  it("names a Toons part from Toons' own names only", () => {
    expect(partName(part("teeter-totter", 3), "toons")).toEqual({ name: "Teeter-Totter", source: "game" });
    expect(partName(part("pulley", 17), "toons")).toEqual({ name: "Pulley", source: "game" });
    expect(partName(part("mallet", 65), "toons")).toEqual({ name: "Mallet", source: "id" });
    expect(partName(part("pulley", 7), "tim1").name).toBe("Pulley");
  });
});

describe("findParts", () => {
  const parts = [part("cat", 12), part("bowling-ball", 0), part("basketball", 9)];

  it("finds parts by name, id or number", () => {
    expect(findParts(parts, "ball", "number").map((p) => p.id)).toEqual(["bowling-ball", "basketball"]);
    expect(findParts(parts, "12", "number").map((p) => p.id)).toEqual(["cat"]);
    expect(findParts(parts, "", "number").map((p) => p.type)).toEqual([0, 9, 12]);
  });

  it("sorts by name", () => {
    expect(findParts(parts, "", "name").map((p) => p.id)).toEqual(["basketball", "bowling-ball", "cat"]);
  });
});

describe("whyNoFrames", () => {
  const part = (over: Partial<Part>): Part => ({ id: "gear", type: 14, sheets: ["PART14"], frames: [], ...over });

  it("has no reason for a part with frames", () => {
    expect(whyNoFrames("tim1", part({ frames: [{ id: 0, sprites: [] }] }))).toBeUndefined();
  });

  it("says a part without a sheet is drawn without sprites", () => {
    expect(whyNoFrames("tim1", part({ sheets: [] }))).toMatch(/no sprite sheet/);
    expect(whyNoFrames("tim2", part({ sheets: [] }))).toMatch(/no sprite sheet/);
  });

  it("says a TIM 2 part without frames draws no sprites in its .ANM file", () => {
    expect(whyNoFrames("tim2", part({}))).toMatch(/\.ANM/);
  });

  it("says a TIM 1 or Even More part is drawn in the program's own code", () => {
    expect(whyNoFrames("evenmore", part({}))).toMatch(/TIM\.EXE/);
  });
});
