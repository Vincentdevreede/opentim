import { PART_LISTS, type Part, type Placement } from "@opentim/content";
import type { Frame as Bitmap } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import type { Edition } from "../src/edition.ts";
import { compose, coverSprites, drawOrder, findParts, listIdOf, partName, readLoadedParts } from "../src/parts.ts";

const bitmap = (width: number, height: number): Bitmap => ({
  width,
  height,
  pixels: new Uint8Array(width * height),
  mask: new Uint8Array(width * height).fill(1),
});
const at = (sprite: number, x: number, y: number, layer: number): Placement => ({
  sheet: "PART1",
  sprite,
  x,
  y,
  layer,
});
const sheet = [bitmap(10, 4), bitmap(6, 6)];
const spriteOf = (s: string, sprite: number) => (s === "PART1" ? sheet[sprite] : undefined);

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

describe("compose", () => {
  it("draws the highest layer first and boxes the sprites around the origin", () => {
    const images = [at(0, 0, 0, 0), at(1, -3, 2, 4)];
    expect(drawOrder(images)).toEqual([4, 0]);
    const { placed, bounds, missing } = compose(images, spriteOf);
    expect(placed.map((p) => p.placement.layer)).toEqual([4, 0]);
    expect(bounds).toEqual({ x: -3, y: 0, width: 13, height: 8 });
    expect(missing).toEqual([]);
  });

  it("leaves out hidden layers and pulls the others apart", () => {
    const images = [at(0, 0, 0, 0), at(1, 0, 0, 4)];
    expect(compose(images, spriteOf, { hidden: new Set([4]) }).placed.map((p) => p.placement.layer)).toEqual([0]);
    expect(compose(images, spriteOf, { spread: 10 }).placed.map((p) => p.y)).toEqual([0, 10]);
  });

  it("lists placements whose sprite isn't loaded", () => {
    const { placed, bounds, missing } = compose([at(5, 0, 0, 0)], spriteOf);
    expect(placed).toEqual([]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(missing).toHaveLength(1);
  });
});

describe("coverSprites", () => {
  it("shows the first frame, or else the first sprite of the first sheet", () => {
    const sprites = [at(1, 2, 3, 4)];
    expect(coverSprites(part("cat", 1, { frames: [{ id: 0, sprites }] }))).toBe(sprites);
    expect(coverSprites(part("wall", 1))).toEqual([{ sheet: "PART1", sprite: 0, x: 0, y: 0, layer: 0 }]);
    expect(coverSprites(part("belt", 8, { sheets: [] }))).toEqual([]);
  });
});
