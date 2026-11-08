import { PART_LISTS, type Part } from "@opentim/content";
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
    const profile = { id: "x", name: "X", languages: [], files: [], parts: "tim1" };
    expect(listIdOf({ status: "recognized", profile })).toBe("tim1");
    expect(listIdOf({ status: "recognized", profile: { ...profile, parts: undefined } })).toBeUndefined();
    expect(listIdOf({ status: "unknown" } as Edition)).toBeUndefined();
    expect(listIdOf(undefined)).toBeUndefined();
  });
});

describe("readLoadedParts", () => {
  it("uses the committed list, with the reason, when the files can't give the parts", () => {
    expect(readLoadedParts(undefined, [])).toBeUndefined();
    const withoutProgram = readLoadedParts("tim1", []);
    expect(withoutProgram?.list).toBe(PART_LISTS.tim1);
    expect(withoutProgram?.source).toBe("committed");
    expect(withoutProgram?.problem).toMatch(/TIM\.EXE/);
    const damaged = readLoadedParts("evenmore", [], { name: "TIM.EXE", data: new Uint8Array(64) });
    expect(damaged?.source).toBe("committed");
    expect(damaged?.problem).toMatch(/no MZ header/);
    expect(readLoadedParts("tim2", [])?.problem).toMatch(/INFO\.RES/);
  });

  it("keeps a TIM 2 part our list doesn't have, and names it as missing from our list", () => {
    const text = "0.\tBowling Ball\tHelp.\r\n999.\tSomething New\tHelp.\r\n";
    const info = Uint8Array.from(text, (c) => c.charCodeAt(0));
    const loaded = readLoadedParts("tim2", [
      { name: "INFO.RES", kind: "binary", group: "other", archive: "RESOURCE.001", offset: 0, data: info },
    ]);
    expect(loaded?.source).toBe("resources");
    expect(loaded?.missing).toEqual([999]);
    expect(loaded?.differs).toContain(999);
  });
});

describe("partName", () => {
  it("prefers the game's own name, then TIM 2's name for the same object, then the id", () => {
    expect(partName(part("balloon", 4, { name: "Big Balloon" }))).toEqual({ name: "Big Balloon", source: "game" });
    expect(partName(part("bowling-ball", 0))).toEqual({ name: "Bowling Ball", source: "game" });
    expect(partName(part("jack-o-lantern", 32))).toEqual({ name: "Jack o lantern", source: "id" });
    expect(partName(part("explosion", 41)).name).toBe("Explosion");
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

  it("says TIM 2 frames are in the .ANM files", () => {
    expect(whyNoFrames("tim2", part({}))).toMatch(/\.ANM/);
  });

  it("says a TIM 1 or Even More part is drawn in the program's own code", () => {
    expect(whyNoFrames("evenmore", part({}))).toMatch(/TIM\.EXE/);
  });
});
