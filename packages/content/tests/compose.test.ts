import type { Frame as Bitmap } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import { compose, coverSprites, drawOrder } from "../src/compose.ts";
import type { Part, Placement } from "../src/model.ts";

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
