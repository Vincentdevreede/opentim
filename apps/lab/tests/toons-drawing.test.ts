import { describe, expect, it } from "vitest";
import type { Frame } from "@opentim/resources";
import type { LevelPart, SpriteOf, ToonsDrawing } from "@opentim/content";
import { toonsPicture } from "../src/toons-drawing.ts";

const image = (width: number, height = 8): Frame => ({
  width,
  height,
  pixels: new Uint8Array(width * height),
  mask: new Uint8Array(width * height).fill(1),
});
const spriteOf: SpriteOf = () => image(10);

/** A placed Toons part with what the drawing code reads. */
const part = (type: number, width: number, height: number, state = 0, setting = 0, flags2 = 0) =>
  ({
    type,
    flags: [0x6000, flags2, 0x40],
    state: [state, 0],
    size: { width, height },
    position: { x: 100, y: 50 },
    setting,
  }) as unknown as LevelPart;

const drawing: ToonsDrawing = {
  dispatcher: 0,
  routines: new Map([[0, 0x6fd8d]]),
  conveyor: { first: [1, 1, 2, 2, 0, 0], last: [7, 7, 8, 8, 9, 9], middle: [3, 3, 4, 4, 6, 6] },
  counter: {
    ones: Array.from({ length: 10 }, (_, d): [number, number] => [55, 10 + d]),
    tens: Array.from({ length: 10 }, (_, d): [number, number] => [38, 20 + d]),
  },
  thumpulator: {
    pieces: [
      { x: 57, y: 22, sprite: 13 },
      { x: 63, y: 27, sprite: 14 },
      { x: 56, y: 14, sprite: 15 },
    ],
    shift: [0, 0, 10, 20, 30, 40, 20, 0],
  },
};
const frames = [{ id: 0, sprites: [{ sheet: "PART39", sprite: 10, x: 20, y: 0, layer: 5 }] }];

describe("toonsPicture", () => {
  it("lays a conveyor belt out in tiles: sprite 4 takes turns with 5, sprite 6 moves down every other tile", () => {
    const tiles = (state: number) =>
      toonsPicture(part(0, 80, 32, state), [], "PART0", drawing, spriteOf)!.sprites.map((p) => [p.sprite, p.x, p.y]);
    expect(tiles(2)).toEqual([
      [2, 0, 0],
      [4, 16, 0],
      [5, 32, 0],
      [4, 48, 0],
      [8, 64, 0],
    ]);
    // The last tile keeps the place of the tile before it.
    expect(tiles(4).map(([, , y]) => y)).toEqual([0, 0, 1, 0, 0]);
  });

  it("puts the counter's lights and digits over its frame", () => {
    const sprites = toonsPicture(part(39, 105, 29, 0, 0x4000 | 37), frames, "PART39", drawing, spriteOf)!.sprites;
    expect(sprites.map((p) => [p.sprite, p.x, p.y])).toEqual([
      [10, 20, 0],
      [21, 21, 9],
      [22, 66, 12],
      [7, 56, 17],
      [3, 39, 23],
    ]);
  });

  it("stacks the thumpulator's sections from its setting", () => {
    const sprites = toonsPicture(part(40, 102, 221, 0, 0x30), frames, "PART40", drawing, spriteOf)!.sprites;
    expect(sprites.map((p) => p.sprite)).toEqual([0, 10, 13, 10, 14, 10, 15, 7]);
    expect(sprites.at(-1)).toMatchObject({ x: 21, y: 17 + 3 * 65 });
  });

  it("swaps the timer's sprite 12 for 13 when it is mirrored", () => {
    const timer = [{ id: 0, sprites: [{ sheet: "PART38", sprite: 12, x: 4, y: 12, layer: 4 }] }];
    expect(toonsPicture(part(38, 68, 39, 0, 0, 0x10), timer, "PART38", drawing, spriteOf)!.sprites[0]).toMatchObject({
      sprite: 13,
      x: 68 - 4 - 10,
      flip: "h",
    });
  });

  it("leaves other types to their frames", () => {
    expect(toonsPicture(part(7, 16, 16), frames, "PART7", drawing, spriteOf)).toBeUndefined();
  });
});

describe("toonsPicture of the message machine", () => {
  it("draws its letter outlined, with a shadow, over sprite 0 and under its frame", () => {
    const font = { height: 2, first: 0x41, glyphs: [{ width: 2, bits: Uint8Array.from([0xc0, 0x80]) }] };
    const machine = [{ id: 0, sprites: [{ sheet: "PART42", sprite: 4, x: 17, y: -10, layer: 5 }] }];
    const picture = toonsPicture(part(42, 51, 74, 0, 0x41), machine, "PART42", drawing, spriteOf, font)!;
    expect(picture.sprites.map((p) => p.sprite)).toEqual([0, 4]);
    const shapes = picture.shapes ?? [];
    expect(shapes.every((s) => s.after === 1)).toBe(true);
    // Five black copies (four outline places and the shadow), then the letter in one colour of the program's five.
    expect(shapes.filter((s) => s.colour === 0)).toHaveLength(10);
    const letter = shapes.slice(10);
    expect(letter[0]).toMatchObject({ kind: "box", x: 25, y: 29, width: 2, height: 1 });
    expect([4, 10, 14, 15]).toContain(letter[0]!.colour);
  });
});
