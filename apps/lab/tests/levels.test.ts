import type { Level, LevelPart, PartList } from "@opentim/content";
import type { Frame as Bitmap } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import type { Resource } from "../src/importer.ts";
import {
  PLAY_AREAS,
  goalPartsOf,
  groupOf,
  layoutScene,
  partAt,
  readLevels,
  toonsSetting,
  toonsTiles,
  type DrawnPart,
} from "../src/levels.ts";

const NONE = 0xffff;
const b = (value: number) => ({ byte: value });
type Item = number | string | { byte: number };

function bytes(...items: Item[]): Uint8Array {
  const out: number[] = [];
  for (const item of items) {
    if (typeof item === "number") out.push(item & 0xff, (item >> 8) & 0xff);
    else if (typeof item === "string") out.push(...[...item].map((c) => c.charCodeAt(0)), 0);
    else out.push(item.byte);
  }
  return Uint8Array.from(out);
}

interface PartSpec {
  type: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  state?: number;
  flags1?: number;
  flags2?: number;
  flags3?: number;
  belt?: { at?: [number, number]; width?: number; parts?: [number, number] };
  ropes?: { at?: [number, number]; parts?: [number, number] }[];
  links?: [number, number];
}

/** A part of version 0x102. */
function part(p: PartSpec): Item[] {
  const { x = 0, y = 0, width = 16, height = 16, state = 0, flags1 = 0xe000, flags2 = 0, flags3 = 0 } = p;
  const belt = p.belt ?? {};
  const rope = (i: number): Item[] => {
    const r = p.ropes?.[i];
    const at = r?.at ?? [0, 0];
    return r?.parts ? [1, b(at[0]), b(at[1]), ...r.parts, b(0), b(0)] : [0, b(at[0]), b(at[1])];
  };
  return [
    p.type,
    flags1,
    flags2,
    flags3,
    state,
    0,
    width,
    height,
    width,
    height,
    x,
    y,
    0,
    belt.parts ? 1 : 0,
    b(belt.at?.[0] ?? 0),
    b(belt.at?.[1] ?? 0),
    belt.width ?? 0,
    ...(belt.parts ?? []),
    ...rope(0),
    ...rope(1),
    ...(p.links ?? [NONE, NONE]),
    NONE,
    NONE,
    ...(p.type === 7 ? [NONE] : []),
  ];
}

function puzzle(title: string, board: PartSpec[], bin: PartSpec[] = []): Uint8Array {
  return bytes(
    0xaced,
    0x102,
    title,
    "Goal",
    0,
    0,
    67,
    272,
    0,
    0,
    1000,
    board.length,
    0,
    bin.length,
    ...[...board, ...bin].flatMap(part),
  );
}

const resource = (name: string, data: Uint8Array): Resource => ({
  name,
  kind: "level",
  group: name.endsWith(".GKC") ? "scene" : "level",
  archive: "RESOURCE.001",
  offset: 0,
  data,
});

const sprite = (width: number, height: number): Bitmap => ({
  width,
  height,
  pixels: new Uint8Array(width * height).fill(1),
  mask: new Uint8Array(width * height).fill(1),
});

const LIST: PartList = {
  id: "test",
  game: "Test",
  parts: [
    {
      id: "bowling-ball",
      type: 0,
      sheets: ["PART0"],
      frames: [{ id: 0, sprites: [{ sheet: "PART0", sprite: 0, x: 0, y: 0, layer: 0 }] }],
    },
    { id: "brick-wall", type: 1, sheets: ["PART1"], frames: [] },
    { id: "curved-pipe-wall", type: 47, sheets: ["PART47"], frames: [] },
    { id: "pulley", type: 7, sheets: [], frames: [] },
    { id: "belt", type: 8, sheets: [], frames: [] },
    { id: "rope", type: 10, sheets: [], frames: [] },
    { id: "color-block", type: 127, sheets: [], frames: [] },
  ],
};

const SHEETS: Record<string, Bitmap[]> = {
  PART0: [sprite(32, 32)],
  PART1: Array.from({ length: 8 }, () => sprite(16, 16)),
  PART47: Array.from({ length: 4 }, () => sprite(32, 32)),
};
const spriteOf = (sheet: string, index: number) => SHEETS[sheet]?.[index];

/** The sort words of a Toons level, none here: a type keeps its number. */
const SORT = { kinds: new Map<number, number>(), binKinds: new Map<number, number>() };

describe("readLevels", () => {
  it("lists levels in number order before scenes, and says why a file can't be read", () => {
    const scene = bytes(0xaced, 0x102, 67, 268, 1001, 0, 0, 0);
    const entries = readLevels(
      [
        resource("TITLE.GKC", scene),
        resource("L10.LEV", puzzle("Ten", [])),
        resource("L2.LEV", puzzle("Two", [])),
        resource("ELEV1.LEV", bytes(0xacef, 0x113)),
      ],
      "tim",
    );
    expect(entries.map((e) => [e.resource.name, e.kind, e.level?.title ?? e.error])).toEqual([
      ["ELEV1.LEV", "level", "The file ends too early (at byte 4)"],
      ["L2.LEV", "level", "Two"],
      ["L10.LEV", "level", "Ten"],
      ["TITLE.GKC", "scene", undefined],
    ]);
  });
});

describe("layoutScene", () => {
  it("tiles walls, picks the sprite of the state, mirrors and leaves the bin out", () => {
    const data = puzzle(
      "T",
      [
        { type: 1, x: 0, y: 0, width: 64, height: 16, flags1: 0xe040 },
        { type: 47, x: 100, y: 0, width: 32, height: 32, state: 2, flags2: 0x10 },
        { type: 0, x: 200, y: 50, width: 32, height: 32 },
        { type: 99, x: 300, y: 50, width: 20, height: 20 },
      ],
      [{ type: 0, x: -1, y: -1 }],
    );
    const level = readLevels([resource("L1.LEV", data)], "tim")[0]!.level!;
    const scene = layoutScene(level, LIST, spriteOf);
    expect(scene.parts.map((p) => [p.part.index, p.how, p.detail])).toEqual([
      [0, "tiles", "tiles of PART1 from sprite 0"],
      [1, "sprite", "sprite 2 of PART47"],
      [2, "frame", "frame 0"],
      [3, "outline", "type 99 isn’t in the part list"],
    ]);
    // The view starts at x -8, so the first middle tile, at screen x 24, has bit 0x10 set: state + 2.
    expect(scene.parts[0]!.composition!.placed.map((p) => p.placement.sprite)).toEqual([0, 2, 1, 3]);
    expect(scene.parts[1]!.composition!.placed[0]!.placement).toMatchObject({ x: 0, flip: "h" });
    expect(scene.bin.map((p) => p.index)).toEqual([4]);
    expect(scene.notes.map((n) => n.status)).toEqual(["partial"]);
    expect(partAt(scene, { x: 210, y: 60 })?.part.index).toBe(2);
    expect(partAt(scene, { x: 500, y: 300 })).toBeUndefined();
  });

  it("draws TIM 2 walls and tile patterns as TIM2.EXE's routines do, and other parts by the frame of their state", () => {
    const tim2 = (...parts: PartSpec[]) =>
      bytes(0xacef, 0x106, "T", "G", 67, 272, 0, 0, 1000, parts.length, 0, 0, ...parts.flatMap(part));
    const data = tim2(
      // Bit 0x40 of the first word means something else in TIM 2, so this ball isn't tiled.
      { type: 0, flags1: 0x1040, flags3: 0x40, state: 1 },
      { type: 1, width: 64, flags3: 0x40 },
      { type: 47, x: 4, y: 0, width: 40, height: 16, flags3: 0x40 },
      // The colour block, which TIM2.EXE draws with its block routine.
      { type: 127, width: 20, height: 10, flags3: 0x14c0 },
      // Without bit 0x40 of the third word the part starts in the bin.
      { type: 0 },
    );
    const level = readLevels([resource("TLEV1.LEV", data)], "tim")[0]!.level!;
    const tile = (id: number, sprite = id) => ({ id, sprites: [{ sheet: "PART1", sprite, x: 0, y: 0, layer: 0 }] });
    const list: PartList = {
      ...LIST,
      parts: LIST.parts.map((p) =>
        p.type === 0
          ? { ...p, states: [0, 0] }
          : p.type === 1
            ? {
                ...p,
                // A run of four across from state 0, then one of four down from state 4.
                frames: Array.from({ length: 8 }, (_, i) => tile(i)),
                sequences: [
                  { sequence: 2, state: 4 },
                  { sequence: 1, state: 8 },
                ],
              }
            : p.type === 47
              ? { ...p, frames: [{ id: 0, sprites: [{ sheet: "PART1", sprite: 0, x: 0, y: 0, layer: 0 }] }] }
              : p,
      ),
    };
    const drawing = new Map([
      [1, "wall" as const],
      [47, "pattern" as const],
      [127, "block" as const],
    ]);
    const scene = layoutScene(level, list, spriteOf, drawing);
    expect(scene.area).toEqual({ x: 0, y: 0, width: 640, height: 400 });
    expect(scene.bin.map((p) => p.index)).toEqual([4]);
    expect(scene.parts.map((p) => [p.how, p.detail])).toEqual([
      ["frame", "frame 0 for state 1"],
      ["tiles", "pieces of a wall, by TIM2.EXE’s wall rule"],
      ["tiles", "a pattern of tiles, by TIM2.EXE’s pattern rule"],
      ["block", "a box in colour 5, by TIM2.EXE’s block rule"],
    ]);
    expect(scene.parts[3]!.composition!.shapes).toEqual([
      { kind: "box", x: 0, y: 0, width: 20, height: 10, colour: 5, fill: 5, after: 0 },
    ]);
    // The first and last state of the run at the ends, the ones between in turn.
    expect(scene.parts[1]!.composition!.placed.map((p) => [p.placement.sprite, p.placement.x])).toEqual([
      [0, 0],
      [1, 16],
      [2, 32],
      [3, 48],
    ]);
    // A grid from 0, 0 of the screen, cut off at the box widened to groups of 8 across.
    expect(scene.parts[2]!.composition!.placed.map((p) => p.x)).toEqual([-4, 12, 28]);
    expect(scene.parts[2]!.clip).toEqual({ x: 0, y: 0, width: 48, height: 16 });
    // Without TIM2.EXE's type table the flag bits don't stand in: every part is drawn by its frame, and the scene says so.
    const unread = layoutScene(level, list, spriteOf);
    expect(unread.parts.map((p) => p.how)).toEqual(["frame", "frame", "frame", "outline"]);
    expect(unread.notes.map((n) => n.title)).toContain("Walls and patterns drawn as frames.");
    expect(scene.notes.map((n) => n.title)).not.toContain("Walls and patterns drawn as frames.");
  });

  it("leaves TIM 2's solution parts on the board when the solution is shown", () => {
    const data = bytes(
      ...[0xacef, 0x106, "T", "G", 67, 272, 0, 0, 1000, 3, 0, 0],
      ...part({ type: 0, flags3: 0x40 }),
      ...part({ type: 0, flags3: 0x100 }),
      ...part({ type: 0 }),
    );
    const level = readLevels([resource("TLEV1.LEV", data)], "tim")[0]!.level!;
    const board = (solution: boolean) =>
      layoutScene(level, LIST, spriteOf, undefined, { solution }).parts.map((p) => p.part.index);
    expect(board(false)).toEqual([0]);
    // Bit 0x100 keeps a part in the bin even then.
    expect(board(true)).toEqual([0, 2]);
  });

  it("turns a mirrored TIM 2 wall over its long side, as TIM2.EXE's wall routine does", () => {
    const data = bytes(
      0xacef,
      0x106,
      "T",
      "G",
      67,
      272,
      0,
      0,
      1000,
      2,
      0,
      0,
      ...part({ type: 1, width: 32, height: 16, flags2: 0x20, flags3: 0x40 }),
      ...part({ type: 1, width: 16, height: 32, flags2: 0x10, flags3: 0x40 }),
    );
    const level = readLevels([resource("TLEV1.LEV", data)], "tim")[0]!.level!;
    const tile = (id: number) => ({ id, sprites: [{ sheet: "PART47", sprite: 0, x: 0, y: 0, layer: 0 }] });
    const list: PartList = {
      ...LIST,
      parts: LIST.parts.map((p) =>
        p.type === 1
          ? {
              ...p,
              frames: Array.from({ length: 4 }, (_, i) => tile(i)),
              sequences: [{ sequence: 2, state: 2 }],
              mirrorBox: { width: 40, height: 36 },
            }
          : p,
      ),
    };
    const [lying, standing] = layoutScene(level, list, spriteOf, new Map([[1, "wall" as const]])).parts;
    expect(lying!.detail).toBe("pieces of a wall, by TIM2.EXE’s wall rule");
    // PART47's sprites are 32 × 32: lying, each piece moves to 36 - 0 - 32 and turns upside down.
    expect(lying!.composition!.placed.map((p) => [p.placement.y, p.placement.flip])).toEqual([[4, "v"]]);
    // Standing, it moves to 40 - 0 - 32 across and turns left to right.
    expect(standing!.composition!.placed.map((p) => [p.placement.x, p.placement.flip])).toEqual([[8, "h"]]);
  });

  it("tiles a standing wall from state + 4 to state + 7", () => {
    const data = puzzle("T", [{ type: 1, x: 8, y: 8, width: 16, height: 64, flags1: 0xe040 }]);
    const level = readLevels([resource("L1.LEV", data)], "tim")[0]!.level!;
    const [wall] = layoutScene(level, LIST, spriteOf).parts;
    expect(wall!.composition!.placed.map((p) => [p.placement.sprite, p.placement.y])).toEqual([
      [4, 0],
      [5, 16],
      [6, 32],
      [7, 48],
    ]);
  });

  it("runs a rope through the pulleys its slots link to, and a belt along two sides of its hubs", () => {
    const data = puzzle("T", [
      { type: 10, ropes: [{ parts: [1, 3] }] },
      { type: 0, x: 0, y: 100, ropes: [{ at: [16, 0] }], links: [2, NONE] },
      { type: 7, x: 50, y: 20, ropes: [{ at: [0, 6] }, { at: [15, 6] }], links: [3, 1] },
      { type: 0, x: 100, y: 100, ropes: [{ at: [16, 0] }], links: [2, NONE] },
      { type: 8, belt: { parts: [5, 6] } },
      { type: 0, x: 0, y: 200, belt: { at: [4, 4], width: 8 } },
      { type: 0, x: 100, y: 200, belt: { at: [4, 4], width: 8 } },
    ]);
    const level = readLevels([resource("L1.LEV", data)], "tim")[0]!.level!;
    const { lines } = layoutScene(level, LIST, spriteOf);
    expect(lines[0]).toEqual({
      kind: "rope",
      part: 0,
      color: 6,
      knots: [
        { x: 16, y: 100 },
        { x: 116, y: 100 },
      ],
      segments: [
        [
          { x: 16, y: 100 },
          { x: 50, y: 26 },
        ],
        [
          { x: 65, y: 26 },
          { x: 116, y: 100 },
        ],
      ],
    });
    expect(lines[1]).toEqual({
      kind: "belt",
      part: 4,
      color: 0,
      segments: [
        [
          { x: 8, y: 204 },
          { x: 108, y: 204 },
        ],
        [
          { x: 8, y: 212 },
          { x: 108, y: 212 },
        ],
      ],
    });
  });

  it("says when a rope's links lead somewhere else than a pulley", () => {
    const data = puzzle("T", [
      { type: 10, ropes: [{ parts: [1, 2] }] },
      { type: 0, links: [3, NONE] },
      { type: 0, x: 50 },
      { type: 0, x: 90 },
    ]);
    const level = readLevels([resource("L1.LEV", data)], "tim")[0]!.level!;
    const scene = layoutScene(level, LIST, spriteOf);
    expect(scene.lines[0]!.broken).toBe(true);
    expect(scene.notes.some((n) => n.title.includes("doesn’t close"))).toBe(true);
  });

  it("only draws boxes without a part list", () => {
    const level = readLevels([resource("L1.LEV", puzzle("T", [{ type: 0, x: 5, y: 5 }]))], "tim")[0]!.level!;
    const scene = layoutScene(level, undefined, spriteOf);
    expect(scene.parts[0]!.how).toBe("outline");
    expect(scene.notes[0]!.title).toBe("No part list for this game.");
  });
});

/** A placed Toons part with only what the tile and bin rules read. */
const toonsPart = (width: number, height: number, state = 0, marks = 0) =>
  ({
    index: 0,
    group: "static",
    flags: [0x6040, 0x180, marks],
    state: [state, 0],
    size: { width, height },
  }) as LevelPart;

describe("toonsTiles", () => {
  const sprites = (p: LevelPart, width = 16, middles = 3) =>
    toonsTiles(p, "PART28", { width, middles }).map((t) => t.sprite);

  it("ends a row with its end tiles and takes the middle tiles in turn from the first", () => {
    expect(sprites(toonsPart(96, 16))).toEqual([0, 1, 2, 3, 1, 4]);
    expect(sprites(toonsPart(48, 16, 10))).toEqual([10, 11, 14]);
  });

  it("uses the column's own end and middle tiles after the row's", () => {
    expect(sprites(toonsPart(16, 96))).toEqual([5, 6, 7, 8, 6, 9]);
  });

  it("draws the ladder's tiles 32 wide", () => {
    const tiles = toonsTiles(toonsPart(32, 48), "PART45", { width: 32, middles: 1 });
    expect(tiles.map((t) => [t.sprite, t.x, t.y])).toEqual([
      [3, 0, 0],
      [4, 0, 16],
      [5, 0, 32],
    ]);
  });

  it("repeats the state on a part wider and taller than a tile", () => {
    expect(sprites(toonsPart(32, 32, 6))).toEqual([6, 6, 6, 6]);
  });
});

describe("groupOf", () => {
  // A Toons level: two fixed eye-hooks tied by a rope, a balloon without the fixed bit tied to one of them by another
  // rope, and two tunnels without it that are each other's other end.
  const part = (index: number, type: number, marks: number, more: Partial<LevelPart> = {}) =>
    ({
      ...toonsPart(16, 16, 0, marks),
      index,
      type,
      position: { x: index * 20, y: 0 },
      ropes: [{ at: { x: 0, y: 0 } }, { at: { x: 0, y: 0 } }],
      links: [null, null],
      belt: { at: { x: 0, y: 0 }, width: 0 },
      ...more,
    }) as LevelPart;
  const rope = (index: number, parts: [number, number]) =>
    part(index, 14, 0x08, {
      ropes: [{ at: { x: 0, y: 0 }, rope: { parts, slots: [0, 0] } }, { at: { x: 0, y: 0 } }],
    });
  const level = {
    layout: "toons",
    parts: [
      part(0, 15, 0x48),
      part(1, 15, 0x48),
      part(2, 23, 0x08),
      rope(3, [0, 1]),
      rope(4, [2, 1]),
      part(5, 46, 0x08, { tunnel: 6 }),
      part(6, 46, 0x08, { tunnel: 5 }),
    ],
  } as unknown as Level;
  const groups = (solution = false) => level.parts.map((p) => groupOf(level, p, solution, SORT));

  it("puts a Toons part without bit 0x40 of the third flag word in the bin, with the ropes tied to it", () => {
    expect(groups()).toEqual(["static", "static", "bin", "static", "bin", "gone", "bin"]);
  });

  it("puts every Toons part where the file has it for the solution", () => {
    expect(groups(true)).toEqual(level.parts.map(() => "static"));
  });

  it("needs TOONS.EXE's sort words for a Toons puzzle", () => {
    expect(() => groupOf(level, level.parts[0]!)).toThrow(/TOONS\.EXE/);
  });

  it("keeps TIM 1's groups as the file has them", () => {
    expect(groupOf({ layout: "tim" } as Level, toonsPart(16, 16, 0, 0))).toBe("static");
  });

  it("draws a rope between two parts on the board, and says which tunnel the puzzle start takes off", () => {
    const scene = layoutScene(level, undefined, () => undefined, undefined, { toonsSort: SORT });
    expect(scene.parts.map((p) => p.part.index)).toEqual([0, 1, 3]);
    // A type TOONS.EXE's sort words don't place keeps its number: the rope, the balloon, the tunnel.
    expect(scene.bin.map((p) => p.index)).toEqual([4, 2, 6]);
    expect(scene.notes.map((n) => n.title)).toContain("1 tunnel taken off.");
  });

  it("puts the bin in the order of TOONS.EXE's sort words, and the file's order for the solution", () => {
    const binKinds = new Map([
      [46, 0],
      [23, 1],
      [14, 2],
    ]);
    const toonsSort = { kinds: new Map<number, number>(), binKinds };
    expect(layoutScene(level, undefined, () => undefined, undefined, { toonsSort }).bin).toEqual([
      level.parts[6],
      level.parts[2],
      level.parts[4],
    ]);
    expect(layoutScene(level, undefined, () => undefined, undefined, { solution: true }).bin).toEqual([]);
  });

  it("draws an electric switch on the board without the plug the puzzle start pulls out, and says so", () => {
    // Switch #0 (state 1: a plug in its first place) stays; hair drier #1, plugged into it, goes to the bin.
    const plugged = {
      layout: "toons",
      parts: [
        part(0, 2, 0x42, { state: [1, 0], plugs: [1, null] }),
        part(1, 52, 0x01, { plugs: [0, null], plugPlace: 0 }),
      ],
    } as unknown as Level;
    const scene = layoutScene(plugged, undefined, () => undefined, undefined, { toonsSort: SORT });
    expect(scene.parts.map((d) => [d.part.index, d.part.state[0], d.part.plugs])).toEqual([[0, 0, [null, null]]]);
    expect(scene.notes.map((n) => n.title)).toEqual(
      expect.arrayContaining(["1 plug pulled out.", "1 part with another state."]),
    );
    // The level itself keeps the file's values.
    expect(plugged.parts[0]!.state[0]).toBe(1);
  });
});

describe("toonsSetting", () => {
  it("says the setting as TOONS.EXE reads it for the part's type", () => {
    expect(toonsSetting(38, 4)).toBe("time 4");
    expect(toonsSetting(39, 0x4001)).toBe("count 1, counting down");
    expect(toonsSetting(39, 13)).toBe("count 13, counting up");
    expect(toonsSetting(40, 0x30)).toBe("3 sections");
    expect(toonsSetting(42, 0x41)).toBe("“A”");
    expect(toonsSetting(20, 1)).toBe("1 shot");
    expect(toonsSetting(69, 5)).toBe("5 eggs");
  });

  it("gives nothing for a type whose code doesn't read it", () => {
    expect(toonsSetting(59, 1)).toBeUndefined();
  });
});

describe("PLAY_AREAS", () => {
  it("has Toons' screen seen from the view TOONS.EXE starts a puzzle with", () => {
    expect(PLAY_AREAS.toons).toEqual({ x: -91, y: -8, width: 640, height: 400 });
    expect(PLAY_AREAS.tim).toMatchObject({ x: 0, y: 0 });
  });
});

describe("goalPartsOf", () => {
  it("rings only the part a condition names, and every part of the types otherwise", () => {
    const drawn = (index: number, type: number) => ({ part: { index, type } }) as DrawnPart;
    const parts = [drawn(0, 13), drawn(1, 13), drawn(2, 9)];
    const lamp = { type: 13, name: "Lava Lamp" };
    const indexes = (c: Parameters<typeof goalPartsOf>[0]) => goalPartsOf(c, parts).map((d) => d.part.index);
    expect(indexes({ kind: "part", part: 1, types: [lamp], tests: [] })).toEqual([1]);
    expect(indexes({ kind: "count", types: [lamp], tests: [] })).toEqual([0, 1]);
    expect(indexes({ kind: "word", tests: [] })).toEqual([]);
  });
});
