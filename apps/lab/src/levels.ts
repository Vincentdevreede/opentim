/**
 * The levels of the loaded files, read with the content package, and how the Levels page draws them. The drawing is a
 * research view: it shows what is read from the files, and says where it guesses or can't draw a part.
 */

import {
  readLevel,
  type Level,
  type LevelLayout,
  type LevelPart,
  type Part,
  type PartList,
  type Placement,
  compose,
  type Bounds,
  type Composition,
  type SpriteOf,
} from "@opentim/content";
import type { Edition } from "./edition.ts";
import type { Resource } from "./importer.ts";
import type { Confidence } from "./kinds.ts";

export interface LevelEntry {
  resource: Resource;
  /** A puzzle file (`.LEV`) or a scene like the title screen (`.GKC`). */
  kind: "level" | "scene";
  level?: Level;
  error?: string;
}

/**
 * The play area of TIM 1 and Even More, in pixels, measured from where the levels put their parts: all but a few fit
 * in it, and the ones outside stand just off its edge. TIM.EXE starts the view at -8, -8.
 */
export const PLAY_AREA = { width: 576, height: 368 };
/** How far around the play area the page draws, to show the parts placed outside it. */
export const MARGIN = 48;

/** Toons stores its parts with a few more fields; the other games share one layout. */
export const layoutOf = (edition?: Edition): LevelLayout =>
  edition?.status === "recognized" && edition.profile.id.startsWith("toons") ? "toons" : "tim";

const isLevelFile = (r: Resource) => /\.(LEV|GKC)$/.test(r.name);

/** Sorts names with numbers in them as people do: L2 before L10. */
const byName = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/**
 * Reads every level and scene of the loaded files. The layout of the recognised version is tried first and the other
 * one after it, since an unknown version can still be Toons.
 */
export function readLevels(resources: readonly Resource[], layout: LevelLayout): LevelEntry[] {
  const other: LevelLayout = layout === "tim" ? "toons" : "tim";
  return resources
    .filter(isLevelFile)
    .map((resource): LevelEntry => {
      const kind = resource.name.endsWith(".GKC") ? "scene" : "level";
      let error: unknown;
      for (const l of [layout, other]) {
        try {
          return { resource, kind, level: readLevel(resource.data, { layout: l, name: resource.name }) };
        } catch (e) {
          error ??= e;
        }
      }
      return { resource, kind, error: error instanceof Error ? error.message : String(error) };
    })
    .sort((a, b) => (a.kind === b.kind ? byName(a.resource.name, b.resource.name) : a.kind === "level" ? -1 : 1));
}

/**
 * How a part is drawn, each by the rule of TIM.EXE:
 * - `frame`: the frame of its state from the part list, for parts the program puts together from several sprites.
 * - `sprite`: the sprite of its sheet with the number of its state, at the part's position. The part list leaves only
 *   types without a table of offsets per state to this, and for those TIM.EXE adds no offset.
 * - `tiles`: 16 × 16 tiles, for parts with bit 0x40 in the first flag word, like walls.
 * - `line`: a rope or a belt, drawn as lines between the parts it ties.
 * - `outline`: nothing to draw it with, so only its box is shown.
 */
export type DrawHow = "frame" | "sprite" | "tiles" | "line" | "outline";

export interface DrawnPart {
  part: LevelPart;
  /** The part in the part list, by its number. */
  listPart?: Part;
  how: DrawHow;
  /** What was used, in words, like `frame 3` or `sprite 2 of PART47`. */
  detail: string;
  /** Relative to the part's position, already mirrored. */
  composition?: Composition;
  mirrored: { x: boolean; y: boolean };
  /** The box the part takes in the level. */
  box: Bounds;
}

export interface Point {
  x: number;
  y: number;
}

export interface Line {
  kind: "rope" | "belt";
  /** The index of the rope or belt part. */
  part: number;
  /** Straight pieces. A rope stops at a pulley and goes on from its other side; the pulley's picture joins them. */
  segments: [Point, Point][];
  /** The palette index TIM.EXE draws it with: 6 for ropes, 0 for belts. */
  color: number;
  /** Where TIM.EXE draws a knot: at the rope's ends, unless they are tied to a pulley or a rope end. */
  knots?: Point[];
  /** Set when the rope's route through the pulleys doesn't reach its other end. */
  broken?: boolean;
}

export interface Note {
  status: Confidence;
  title: string;
  detail: string;
}

export interface Scene {
  /** The static and moving parts, in the order the file stores them, which is also the drawing order. */
  parts: DrawnPart[];
  lines: Line[];
  /** Parts waiting in the bin, which aren't on the board. */
  bin: LevelPart[];
  notes: Note[];
  /** The knot TIM.EXE draws at a rope's ends: picture 36 of GP_BORD, 5 pixels left of and 2 above the slot. */
  knot: Composition;
}

/** Bit 0x40 of the first flag word: TIM.EXE draws the part as 16 × 16 tiles. */
const TILED = 0x40;
/** Bits of the second flag word that mirror a part, left to right and upside down. */
const MIRROR_X = 0x10;
const MIRROR_Y = 0x20;
/** Where TIM.EXE starts the view. Which middle tile of a wall comes first depends on the position on the screen. */
const VIEW = -8;
const TILE = 16;
const LINE_PARTS = new Set(["rope", "belt"]);
const PULLEY = { tim: 7, toons: 17 } as const;
const ROPE_COLOR = 6;
const ROPE_END = 49;
const KNOT: Placement = { sheet: "GP_BORD", sprite: 36, x: -5, y: -2, layer: 0 };
const BELT_COLOR = 0;

/**
 * The tiles of a part with bit 0x40, as TIM.EXE draws them. A row starts with the sprite of the state and ends with
 * state + 3, a column starts with state + 4 and ends with state + 7. In between, state + 1 and + 2 (or + 5 and + 6) take
 * turns, starting by bit 0x10 of the screen position. A part both wider and taller than a tile repeats the state.
 */
export function tiles(part: LevelPart, sheet: string): Placement[] {
  const columns = part.size.width >> 4;
  const rows = part.size.height >> 4;
  const state = part.state[0];
  let across = ((part.position.x - VIEW) & 0x10) >> 4;
  let down = ((part.position.y - VIEW) & 0x10) >> 4;
  let sprite = state;
  const out: Placement[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (rows === 1) sprite = column === 0 ? state : column === columns - 1 ? state + 3 : state + across + 1;
      else if (columns === 1) sprite = row === 0 ? state + 4 : row === rows - 1 ? state + 7 : state + down + 5;
      out.push({ sheet, sprite, x: column * TILE, y: row * TILE, layer: 0 });
      across ^= 1;
    }
    down ^= 1;
  }
  return out;
}

/** Mirrors placements inside the part's size, as TIM.EXE does: x becomes width - x - the sprite's width. */
function mirror(
  sprites: readonly Placement[],
  part: LevelPart,
  spriteOf: SpriteOf,
  x: boolean,
  y: boolean,
): Placement[] {
  if (!x && !y) return [...sprites];
  return sprites.map((p) => {
    const image = spriteOf(p.sheet, p.sprite);
    if (!image) return p;
    const h = (p.flip?.includes("h") ?? false) !== x;
    const v = (p.flip?.includes("v") ?? false) !== y;
    const flip = `${h ? "h" : ""}${v ? "v" : ""}`;
    return {
      ...p,
      x: x ? part.size.width - p.x - image.width : p.x,
      y: y ? part.size.height - p.y - image.height : p.y,
      flip: (flip || undefined) as Placement["flip"],
    };
  });
}

function drawPart(part: LevelPart, list: PartList | undefined, spriteOf: SpriteOf): DrawnPart {
  const listPart = list?.parts.find((p) => p.type === part.type);
  const flags2 = part.flags[1] ?? 0;
  const mirrored = { x: (flags2 & MIRROR_X) !== 0, y: (flags2 & MIRROR_Y) !== 0 };
  const { x, y } = part.position;
  const box = { x, y, width: part.size.width, height: part.size.height };
  const base = { part, listPart, mirrored, box };
  if (listPart && LINE_PARTS.has(listPart.id)) return { ...base, how: "line", detail: `a ${listPart.id}` };
  const state = part.state[0];
  // TIM.EXE loads the sheet of type N as `part` + N + `.bmp`, so a type the list doesn't have can still be drawn.
  if (!listPart) {
    const sheet = `PART${part.type}`;
    if (!list || !spriteOf(sheet, state))
      return { ...base, how: "outline", detail: `type ${part.type} isn’t in the part list` };
    const single: Placement[] = [{ sheet, sprite: state, x: 0, y: 0, layer: 0 }];
    const composition = compose(mirror(single, part, spriteOf, mirrored.x, mirrored.y), spriteOf);
    return {
      ...base,
      how: "sprite",
      detail: `sprite ${state} of ${sheet}, a type the part list doesn’t have`,
      composition,
    };
  }
  const sheet = listPart.sheets[0];
  if ((part.flags[0] ?? 0) & TILED && sheet) {
    const composition = compose(tiles(part, sheet), spriteOf);
    if (composition.missing.length) return { ...base, how: "outline", detail: `tiles of ${sheet} are missing` };
    return { ...base, how: "tiles", detail: `tiles of ${sheet} from sprite ${state}`, composition };
  }
  const frame = listPart.frames.find((f) => f.id === state);
  if (frame) {
    const composition = compose(mirror(frame.sprites, part, spriteOf, mirrored.x, mirrored.y), spriteOf);
    if (composition.placed.length) return { ...base, how: "frame", detail: `frame ${state}`, composition };
  }
  if (!sheet) return { ...base, how: "outline", detail: "no sprite sheet" };
  if (!spriteOf(sheet, state)) return { ...base, how: "outline", detail: `${sheet} has no sprite ${state}` };
  const single: Placement[] = [{ sheet, sprite: state, x: 0, y: 0, layer: 0 }];
  const composition = compose(mirror(single, part, spriteOf, mirrored.x, mirrored.y), spriteOf);
  return { ...base, how: "sprite", detail: `sprite ${state} of ${sheet}`, composition };
}

/** Where a rope is tied to a part: the part's position plus the slot's place. */
function slotPoint(part: LevelPart, slot: number): Point {
  const s = part.ropes[slot]?.at ?? { x: 0, y: 0 };
  return { x: part.position.x + s.x, y: part.position.y + s.y };
}

const indexed = (parts: readonly LevelPart[], i: number | null | undefined) =>
  i === null || i === undefined ? undefined : parts[i];

/**
 * The rope is drawn straight: when a level is set up, TIM.EXE sets each rope's length to the distance between its
 * ends, and it only bends a rope whose length is more than 4 pixels longer than that distance.
 *
 * A rope runs from the slot of its first part. The part's link for that slot names the next part: a pulley, which
 * the rope enters at its first slot and leaves at its second, going on to the pulley's first link. The route ends at
 * the slot of the rope's second part.
 */
function ropeLine(rope: LevelPart, parts: readonly LevelPart[], pulley: number): Line | undefined {
  const tie = rope.ropes[0]?.rope;
  const from = indexed(parts, tie?.parts[0]);
  const to = indexed(parts, tie?.parts[1]);
  if (!tie || !from || !to) return undefined;
  const segments: [Point, Point][] = [];
  let start = slotPoint(from, tie.slots[0]);
  let next = indexed(parts, from.links[tie.slots[0]]);
  const seen = new Set<number>();
  let broken = false;
  while (next && next.index !== to.index) {
    if (next.type !== pulley || seen.has(next.index)) {
      broken = true;
      break;
    }
    seen.add(next.index);
    segments.push([start, slotPoint(next, 0)]);
    start = slotPoint(next, 1);
    next = indexed(parts, next.links[0]);
  }
  segments.push([start, slotPoint(to, tie.slots[1])]);
  const knotted = (p: LevelPart) => p.type !== pulley && p.type !== ROPE_END;
  const knots = [...(knotted(from) ? [segments[0]![0]] : []), ...(knotted(to) ? [segments.at(-1)![1]] : [])];
  return { kind: "rope", part: rope.index, segments, color: ROPE_COLOR, knots, ...(broken ? { broken } : {}) };
}

/**
 * A belt runs around a hub on each of two parts: a square at the part's belt place, as wide as its belt width. The
 * place counts from where TIM.EXE draws the part, which is its position for every part that carries a hub in the
 * levels: only the generator has offsets per state, and those are 0 in the states the levels use (0 and 4). TIM.EXE
 * draws two lines: along the left and right sides of the hubs when they are further apart up and down than across,
 * else along their tops and bottoms.
 */
function beltLine(belt: LevelPart, parts: readonly LevelPart[]): Line | undefined {
  const a = indexed(parts, belt.belt.parts?.[0]);
  const b = indexed(parts, belt.belt.parts?.[1]);
  if (!a || !b) return undefined;
  const hub = (p: LevelPart) => ({ x: p.position.x + p.belt.at.x, y: p.position.y + p.belt.at.y, d: p.belt.width });
  const [h1, h2] = [hub(a), hub(b)];
  const standing = Math.abs(h1.x - h2.x) < Math.abs(h1.y - h2.y);
  const side = (h: typeof h1, far: boolean): Point =>
    standing ? { x: h.x + (far ? h.d : 0), y: h.y + (h.d >> 1) } : { x: h.x + (h.d >> 1), y: h.y + (far ? h.d : 0) };
  return {
    kind: "belt",
    part: belt.index,
    segments: [
      [side(h1, false), side(h2, false)],
      [side(h1, true), side(h2, true)],
    ],
    color: BELT_COLOR,
  };
}

const plural = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
const numbers = (parts: { part: LevelPart }[]) => parts.map((p) => `#${p.part.index}`).join(", ");

/** Lays out a level for drawing, and lists what the drawing leaves out or guesses. */
export function layoutScene(level: Level, list: PartList | undefined, spriteOf: SpriteOf): Scene {
  const board = level.parts.filter((p) => p.group !== "bin");
  const parts = board.map((p) => drawPart(p, list, spriteOf));
  const pulley = PULLEY[level.layout];
  const lines: Line[] = [];
  for (const d of parts) {
    if (d.how !== "line") continue;
    const line = d.listPart?.id === "belt" ? beltLine(d.part, level.parts) : ropeLine(d.part, level.parts, pulley);
    if (line) lines.push(line);
  }

  const notes: Note[] = [];
  if (!list)
    notes.push({
      status: "unsupported",
      title: "No part list for this game.",
      detail: "Without one the parts can’t be drawn, so only their boxes are shown.",
    });
  const outlined = parts.filter((p) => p.how === "outline");
  if (list && outlined.length)
    notes.push({
      status: "partial",
      title: `${plural(outlined.length, "part")} drawn as a box.`,
      detail: `${numbers(outlined)}: ${[...new Set(outlined.map((p) => p.detail))].join("; ")}.`,
    });
  const broken = lines.filter((l) => l.broken);
  if (broken.length)
    notes.push({
      status: "partial",
      title: `${plural(broken.length, "rope")} with a route that doesn’t close.`,
      detail: `${broken.map((l) => `#${l.part}`).join(", ")}: the links lead to a part that isn’t a pulley, so the last piece is drawn straight.`,
    });
  const knot = compose([KNOT], spriteOf);
  return { parts, lines, bin: level.parts.filter((p) => p.group === "bin"), notes, knot };
}

/** The topmost part at a point of the level, for clicks. Lines can't be picked; their part shows in the structure. */
export function partAt(scene: Scene, point: Point): DrawnPart | undefined {
  const inside = (b: Bounds) => point.x >= b.x && point.y >= b.y && point.x < b.x + b.width && point.y < b.y + b.height;
  return [...scene.parts].reverse().find((p) => p.how !== "line" && inside(p.box));
}
