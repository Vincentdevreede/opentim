/**
 * The levels of the loaded files, read with the content package, and how the Levels page draws them. The drawing is a
 * research view: it shows what is read from the files, and says where it guesses or can't draw a part.
 */

import {
  PULLEY,
  TOONS_CRITTERS,
  TIM2_SCREEN,
  readLevel,
  type GoalCondition,
  type Level,
  type LevelLayout,
  type LevelPart,
  type Part,
  type PartList,
  type Placement,
  type Shape,
  type Tim2Size as Size,
  compose,
  tim2MirrorSide,
  type Bounds,
  type Composition,
  type SpriteOf,
  type Tim2Drawing,
  type ToonsDrawing,
  type ToonsPuzzleStart,
  toonsPuzzleStart,
} from "@opentim/content";
import type { Font } from "@opentim/resources";
import { toonsPicture } from "./toons-drawing.ts";
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

/** A play area: where its top left corner is in the level's pixels, and its size. */
export interface PlayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The play area of TIM 1 and Even More, in pixels, measured from where the levels put their parts: all but a few fit
 * in it, and the ones outside stand just off its edge. TIM.EXE starts the view at -8, -8.
 */
export const PLAY_AREA: PlayArea = { x: 0, y: 0, width: 576, height: 368 };
/**
 * The play area by layout. TIM 2's is its screen, 640 × 400: TIM2.EXE's goal routine counts a part off the screen when
 * its middle is outside it, and its panels are drawn in a frame of that size. While a puzzle is set up, the control
 * panel covers the left 48 pixels and the parts bin the right 80.
 *
 * Toons' is its screen too, 640 × 400, seen from -91, -8: when a puzzle starts, TOONS.EXE sets the view to -91 across
 * and -8 down (over the level's own scroll words) and draws the whole screen, so the play area runs from -91 to 549
 * across and from -8 to 392 down.
 */
export const PLAY_AREAS: Record<LevelLayout, PlayArea> = {
  tim: PLAY_AREA,
  toons: { x: -91, y: -8, width: 640, height: 400 },
  tim2: { x: 0, y: 0, ...TIM2_SCREEN },
};
/** The games of each level layout, for display. */
export const LAYOUT_NAMES: Record<LevelLayout, string> = { tim: "TIM 1, Even More", toons: "Toons", tim2: "TIM 2" };
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
 * - `block`: TIM 2's colour block, a box filled with one colour.
 * - `code`: a Toons part its type's own drawing code draws, like the counter with its digits.
 * - `outline`: nothing to draw it with, so only its box is shown.
 */
export type DrawHow = "frame" | "sprite" | "tiles" | "line" | "block" | "code" | "outline";

/** What the Toons types with drawing code of their own need: the code's tables and the message machine's font. */
export interface ToonsCode {
  drawing: ToonsDrawing;
  font?: Font;
}

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
  /** Where the picture is cut off, in pixels of the level, when the program cuts it off. */
  clip?: Bounds;
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
  /** The play area of the level's game. */
  area: PlayArea;
  /** The static and moving parts, in the order the file stores them, which is also the drawing order. */
  parts: DrawnPart[];
  lines: Line[];
  /** Parts waiting in the bin, which aren't on the board; for a Toons puzzle in the order TOONS.EXE keeps them. */
  bin: LevelPart[];
  notes: Note[];
  /** The knot TIM.EXE draws at a rope's ends: picture 36 of GP_BORD, 5 pixels left of and 2 above the slot. */
  knot: Composition;
  /** The picture TIM2.EXE shows for each of a TIM 2 level's notes. */
  noteMarks: NoteMark[];
}

/** Where a TIM 2 level's note is, and its picture. */
export interface NoteMark {
  text: string;
  at: Point;
  composition: Composition;
}

/** The sheet TIM2.EXE draws a note's picture from. */
const NOTE_SHEET = "HANDLES";

/**
 * TIM2.EXE draws a note as picture 41 of HANDLES at the note's place, or picture 42 when the note's third word is 2 or
 * more. When the word is odd it mirrors the picture left to right and draws it 4 pixels further left.
 */
function noteMarks(level: Level, spriteOf: SpriteOf): NoteMark[] {
  return (level.tim2?.notes ?? []).map((note) => {
    const mirrored = (note.z & 1) !== 0;
    const sprite: Placement = { sheet: NOTE_SHEET, sprite: note.z > 1 ? 42 : 41, x: 0, y: 0, layer: 0 };
    return {
      text: note.text,
      at: { x: note.x - (mirrored ? 4 : 0), y: note.y },
      composition: compose([mirrored ? { ...sprite, flip: "h" } : sprite], spriteOf),
    };
  });
}

/** Bit 0x40 of TIM 2's third flag word: the part stays on the board when the puzzle starts. */
const TIM2_FIXED = 0x40;
/** Bit 0x100 of TIM 2's third flag word: the part stays in the bin when the game shows the puzzle's solution. */
const TIM2_NOT_IN_SOLUTION = 0x100;
/** Where a part is when the puzzle starts: on its list, in the bin, or `gone` for a Toons tunnel the setup frees. */
export type StartGroup = LevelPart["group"] | "gone";

/**
 * The words of TOONS.EXE's type table that Toons sorts its parts by: `kinds` for the parts lists
 * (`readToonsListKinds`), `binKinds` for the bin (`readToonsBinKinds`).
 */
export interface ToonsSort {
  kinds: ReadonlyMap<number, number>;
  binKinds: ReadonlyMap<number, number>;
}

const toonsStarts = new WeakMap<Level, { sort: ToonsSort; start: ToonsPuzzleStart }[]>();
/** TOONS.EXE's puzzle start of a level (`toonsPuzzleStart`), worked out once per level and sort words. */
export function toonsStart(level: Level, sort: ToonsSort): ToonsPuzzleStart {
  const known = toonsStarts.get(level) ?? [];
  const found = known.find((k) => k.sort.kinds === sort.kinds && k.sort.binKinds === sort.binKinds);
  if (found) return found.start;
  const start = toonsPuzzleStart(level, sort.kinds, sort.binKinds);
  toonsStarts.set(level, [...known.slice(-3), { sort, start }]);
  return start;
}

/**
 * The list a part is on when the puzzle starts. TIM 1 keeps its parts bin as a third list in the file. TIM 2 keeps
 * every part on the board in the file, and when a puzzle starts TIM2.EXE drops every part without bit 0x40 of the
 * third flag word into the parts bin, so those are the bin. When the player asks for the designer's solution, it loads
 * the level again and leaves on the board the parts with neither 0x40 nor 0x100: those are the solution.
 *
 * Toons has no bin in its files either. TOONS.EXE's puzzle setup puts every part without bit 0x40 in the bin, and with
 * it the ropes and belts tied to it and the other end of a tunnel, which it frees (`toonsPuzzleStart`); a rope or a
 * belt between two parts that stay stays on the board. The type table's sort words (`sort`) decide which tunnel of a
 * pair goes to the bin, so a Toons puzzle needs them. Where the file puts the parts is the solution. The bits that are
 * 0x100 in TIM 2 aren't set in Toons' levels.
 */
export const groupOf = (level: Level, part: LevelPart, solution = false, sort?: ToonsSort): StartGroup => {
  const third = part.flags[2] ?? 0;
  if (level.layout === "toons") {
    if (solution) return part.group;
    if (!sort) throw new Error("A Toons puzzle starts by the sort words of TOONS.EXE.");
    const start = toonsStart(level, sort);
    return start.bin.has(part.index) ? "bin" : start.gone.has(part.index) ? "gone" : part.group;
  }
  if (level.layout === "tim" || third & TIM2_FIXED) return part.group;
  return solution && !(third & TIM2_NOT_IN_SOLUTION) ? part.group : "bin";
};

/** The Toons types whose setting TOONS.EXE reads, and what it counts for them. */
const TOONS_SHOTS: Record<number, [string, string]> = {
  20: ["shot", "shots"],
  22: ["boulder", "boulders"],
  69: ["egg", "eggs"],
};

/**
 * A Toons part's setting in words, as TOONS.EXE reads it for the part's type, or undefined for a type whose code
 * doesn't read it. The timer counts its time down in the low byte; the counter keeps its count with bit 0x4000 when it
 * counts down; the message machine shows the setting as text, one letter in the shipped levels; the thumpulator takes
 * its number of sections from bits 4 to 7; the pistol, the catapult and the hen use one up with each shot.
 */
export function toonsSetting(type: number, setting: number): string | undefined {
  const count = (n: number, [one, more]: [string, string]) => `${n} ${n === 1 ? one : more}`;
  switch (type) {
    case 38:
      return `time ${setting & 0xff}`;
    case 39:
      return `count ${setting & 0xbfff}, counting ${setting & 0x4000 ? "down" : "up"}`;
    case 40:
      return count((setting >> 4) & 0xf, ["section", "sections"]);
    case 42: {
      // The text ends at a 0 byte: the high byte is 0 for a single letter.
      const bytes = [setting & 0xff, setting >> 8];
      const end = bytes.indexOf(0);
      return `“${String.fromCharCode(...(end < 0 ? bytes : bytes.slice(0, end)))}”`;
    }
  }
  const shots = TOONS_SHOTS[type];
  return shots ? count(setting, shots) : undefined;
}

/** Bit 0x40 of the first flag word: TIM.EXE draws the part as 16 × 16 tiles. */
const TILED = 0x40;
/**
 * TIM2.EXE's colour block routine: a box the part's size, filled and outlined in the palette colour of the low byte
 * of the part's extra word, colour 5 when that is 0.
 */
function blockShape(part: LevelPart): Shape {
  const colour = part.extra & 0xff || 5;
  return { kind: "box", x: 0, y: 0, width: part.size.width, height: part.size.height, colour, fill: colour, after: 0 };
}
/** Bits of the second flag word that mirror a part, left to right and upside down. */
const MIRROR_X = 0x10;
const MIRROR_Y = 0x20;
/** Where TIM.EXE starts the view. Which middle tile of a wall comes first depends on the position on the screen. */
const VIEW = -8;
const TILE = 16;
const LINE_PARTS = new Set(["rope", "belt"]);
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

/**
 * The tiles of a Toons part drawn as tiles, as TOONS.EXE draws them: `width` wide (32 for the ladder, else 16) and 16
 * high. A row starts with the sprite of the state and ends with state + middles + 1; a column starts with state +
 * middles + 2 and ends with state + 2 × middles + 3. The tiles between take the middle sprites in turn, from the first.
 * A part both wider and taller than a tile repeats the state.
 */
export function toonsTiles(part: LevelPart, sheet: string, { width, middles }: { width: number; middles: number }) {
  const columns = Math.floor(part.size.width / width);
  const rows = part.size.height >> 4;
  const state = part.state[0];
  let turn = 0;
  let sprite = state;
  const out: Placement[] = [];
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      if (rows === 1)
        sprite = column === 0 ? state : column === columns - 1 ? state + middles + 1 : state + (turn++ % middles) + 1;
      else if (columns === 1)
        sprite =
          row === 0
            ? state + middles + 2
            : row === rows - 1
              ? state + 2 * middles + 3
              : state + middles + (turn++ % middles) + 3;
      out.push({ sheet, sprite, x: column * width, y: row * TILE, layer: 0 });
    }
  return out;
}

/**
 * Mirrors placements inside a size, as TIM.EXE does inside the part's size: x becomes width - x - the sprite's width.
 * TIM 2 parts are mirrored in the size `tim2MirrorSide` gives.
 */
function mirror(sprites: readonly Placement[], side: Size, spriteOf: SpriteOf, x: boolean, y: boolean): Placement[] {
  if (!x && !y) return [...sprites];
  return sprites.map((p) => {
    const image = spriteOf(p.sheet, p.sprite);
    if (!image) return p;
    const h = (p.flip?.includes("h") ?? false) !== x;
    const v = (p.flip?.includes("v") ?? false) !== y;
    const flip = `${h ? "h" : ""}${v ? "v" : ""}`;
    return {
      ...p,
      x: x ? side.width - p.x - image.width : p.x,
      y: y ? side.height - p.y - image.height : p.y,
      flip: (flip || undefined) as Placement["flip"],
    };
  });
}

/** The frame a state of a part shows: in TIM 2 the animation's list of states picks it. */
const frameOf = (part: Part, state: number) => part.frames.find((f) => f.id === (part.states?.[state] ?? state));

/**
 * The states of the run TIM2.EXE's wall routine draws from. A part as wide as tall or wider uses the states from 0 up
 * to where the next sequence starts; a taller one uses the first sequence that starts after state 0, up to the next.
 */
function wallRun(part: Part, standing: boolean): number[] | undefined {
  const starts = new Set(part.sequences?.map((s) => s.state));
  const last = Math.max(part.states?.length ?? part.frames.length, ...starts);
  const next = (from: number) => {
    for (let s = from + 1; s <= last; s++) if (starts.has(s)) return s;
    return undefined;
  };
  const start = standing ? next(0) : 0;
  const end = start === undefined ? undefined : (next(start) ?? last);
  return start === undefined || end === undefined || end <= start
    ? undefined
    : Array.from({ length: end - start }, (_, i) => start + i);
}

/**
 * A TIM 2 wall as TIM2.EXE's wall routine draws it: pieces as wide (or, standing, as tall) as the run's first frame,
 * the run's first state at one end, its last at the other and the ones between in turn in the middle.
 */
function wallPieces(part: LevelPart, listPart: Part, spriteOf: SpriteOf): Placement[] | undefined {
  const standing = part.size.width < part.size.height;
  // Either mirror bit turns a wall over its long side: one lying down upside down, a standing one left to right.
  const mirrored = ((part.flags[1] ?? 0) & (MIRROR_X | MIRROR_Y)) !== 0;
  const turn = (p: Placement): Placement => {
    const image = spriteOf(p.sheet, p.sprite);
    const box = listPart.mirrorBox;
    if (!mirrored || !image || !box) return p;
    const h = (p.flip?.includes("h") ?? false) !== standing;
    const v = (p.flip?.includes("v") ?? false) !== !standing;
    const flip = `${h ? "h" : ""}${v ? "v" : ""}` as Placement["flip"] | "";
    const turned: Placement = {
      sheet: p.sheet,
      sprite: p.sprite,
      x: standing ? box.width - p.x - image.width + shift : p.x,
      y: standing ? p.y : box.height - p.y - image.height,
      layer: p.layer,
    };
    return flip ? { ...turned, flip } : turned;
  };
  const run = wallRun(listPart, standing);
  const first = run && frameOf(listPart, run[0]!);
  if (!run || !first) return undefined;
  const box = compose(first.sprites, spriteOf).bounds;
  const size = standing ? box.height : box.width;
  // The pool table wall standing mirrored moves right by its piece's width less 16, as TIM2.EXE does.
  const shift = standing && listPart.id === "pool-table-wall" ? box.width - 16 : 0;
  if (!size) return undefined;
  const count = Math.trunc((standing ? part.size.height : part.size.width) / size);
  const middles = run.length - 2;
  return Array.from({ length: count }, (_, k) => {
    const state = k === 0 ? run[0]! : k === count - 1 ? run.at(-1)! : run[1 + ((k - 1) % Math.max(middles, 1))]!;
    const frame = frameOf(listPart, state);
    return (frame?.sprites ?? []).map(turn).map((p) => ({
      ...p,
      x: p.x + (standing ? 0 : k * size),
      y: p.y + (standing ? k * size : 0),
    }));
  }).flat();
}

/**
 * A TIM 2 tile pattern as TIM2.EXE draws it: the frame of state 0 over and over on a grid of its size that starts at
 * 0, 0 of the screen, cut off at the part's box, which the program widens to whole groups of 8 pixels across.
 */
function patternPieces(part: LevelPart, listPart: Part, spriteOf: SpriteOf): { pieces: Placement[]; clip: Bounds } {
  const frame = frameOf(listPart, 0);
  const box = frame ? compose(frame.sprites, spriteOf).bounds : { x: 0, y: 0, width: 0, height: 0 };
  const left = part.position.x & ~7;
  const right = (part.position.x + part.size.width - 1) | 7;
  const top = part.position.y;
  const bottom = part.position.y + part.size.height - 1;
  const clip = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  if (!frame || !box.width || !box.height) return { pieces: [], clip };
  const pieces: Placement[] = [];
  // Relative to the part's position, like every other picture of a part.
  for (let x = Math.trunc(left / box.width) * box.width; x <= right; x += box.width)
    for (let y = Math.trunc(top / box.height) * box.height; y <= bottom; y += box.height)
      for (const p of frame.sprites) pieces.push({ ...p, x: p.x + x - part.position.x, y: p.y + y - part.position.y });
  return { pieces, clip };
}

/**
 * Mirrors boxes and lines inside a size, as `mirror` does with sprites. TIM2.EXE mirrors a line's ends as width - x,
 * without taking 1 off, so a line drawn from 0 lands on the width.
 */
function mirrorShapes(shapes: readonly Shape[], side: Size, x: boolean, y: boolean): Shape[] {
  const { width: w, height: h } = side;
  return shapes.map((s) =>
    s.kind === "box"
      ? { ...s, x: x ? w - s.x - s.width : s.x, y: y ? h - s.y - s.height : s.y }
      : {
          ...s,
          x1: x ? w - s.x1 : s.x1,
          x2: x ? w - s.x2 : s.x2,
          y1: y ? h - s.y1 : s.y1,
          y2: y ? h - s.y2 : s.y2,
        },
  );
}

function drawPart(
  part: LevelPart,
  layout: LevelLayout,
  list: PartList | undefined,
  spriteOf: SpriteOf,
  drawing?: ReadonlyMap<number, Tim2Drawing>,
  toons?: ToonsCode,
): DrawnPart {
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
    const composition = compose(mirror(single, part.size, spriteOf, mirrored.x, mirrored.y), spriteOf);
    return {
      ...base,
      how: "sprite",
      detail: `sprite ${state} of ${sheet}, a type the part list doesn’t have`,
      composition,
    };
  }
  const sheet = listPart.sheets[0];
  if (layout === "tim2") {
    const how = drawing?.get(part.type) ?? "frame";
    const by = "TIM2.EXE’s";
    if (how === "block") {
      const shape = blockShape(part);
      const composition = compose([], spriteOf, { shapes: [shape] });
      return { ...base, how: "block", detail: `a box in colour ${shape.colour}, by ${by} block rule`, composition };
    }
    if (how === "wall") {
      const pieces = wallPieces(part, listPart, spriteOf);
      const composition = pieces && compose(pieces, spriteOf);
      if (composition?.placed.length)
        return { ...base, how: "tiles", detail: `pieces of a wall, by ${by} wall rule`, composition };
    } else if (how === "pattern") {
      const { pieces, clip } = patternPieces(part, listPart, spriteOf);
      const composition = compose(pieces, spriteOf);
      if (composition.placed.length)
        return { ...base, how: "tiles", detail: `a pattern of tiles, by ${by} pattern rule`, composition, clip };
    }
  } else if ((part.flags[0] ?? 0) & TILED && sheet) {
    const toons = layout === "toons" && listPart.tiles;
    const composition = compose(toons ? toonsTiles(part, sheet, toons) : tiles(part, sheet), spriteOf);
    if (composition.missing.length) return { ...base, how: "outline", detail: `tiles of ${sheet} are missing` };
    return { ...base, how: "tiles", detail: `tiles of ${sheet} from sprite ${state}`, composition };
  }
  if (layout === "toons" && toons && sheet) {
    const picture = toonsPicture(part, listPart.frames, sheet, toons.drawing, spriteOf, toons.font);
    const composition = picture && compose(picture.sprites, spriteOf, { shapes: picture.shapes ?? [] });
    if (picture && composition?.placed.length) return { ...base, how: "code", detail: picture.detail, composition };
  }
  // In TIM 2 the state picks a frame from the animation's list of states.
  const shown = listPart.states?.[state] ?? state;
  const frame = frameOf(listPart, state);
  if (frame) {
    // TIM2.EXE's usual draw routine mirrors a part in a size of its own, not in the part's size.
    const side = (layout === "tim2" && tim2MirrorSide(part, listPart)) || part.size;
    const shapes = mirrorShapes(frame.shapes ?? [], side, mirrored.x, mirrored.y);
    const composition = compose(mirror(frame.sprites, side, spriteOf, mirrored.x, mirrored.y), spriteOf, { shapes });
    const detail = shown === state ? `frame ${state}` : `frame ${shown} for state ${state}`;
    if (composition.placed.length) return { ...base, how: "frame", detail, composition };
  }
  // Al and Sid have no sheet of their own: a frame without sprites is one whose action names no sheet.
  if (layout === "toons" && TOONS_CRITTERS.includes(part.type))
    return { ...base, how: "outline", detail: `frame ${state} has no sheet` };
  if (!sheet) return { ...base, how: "outline", detail: "no sprite sheet" };
  if (!spriteOf(sheet, state)) return { ...base, how: "outline", detail: `${sheet} has no sprite ${state}` };
  const single: Placement[] = [{ sheet, sprite: state, x: 0, y: 0, layer: 0 }];
  const composition = compose(mirror(single, part.size, spriteOf, mirrored.x, mirrored.y), spriteOf);
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

/**
 * Lays out a level for drawing, and lists what the drawing leaves out or guesses. A TIM 2 level takes how TIM2.EXE
 * draws each type (`drawing`), a Toons puzzle TOONS.EXE's drawing code (`toons`) and sort words (`toonsSort`).
 */
export function layoutScene(
  level: Level,
  list: PartList | undefined,
  spriteOf: SpriteOf,
  drawing?: ReadonlyMap<number, Tim2Drawing>,
  { solution = false, toons, toonsSort }: { solution?: boolean; toons?: ToonsCode; toonsSort?: ToonsSort } = {},
): Scene {
  const groups = new Map(level.parts.map((p) => [p, groupOf(level, p, solution, toonsSort)]));
  const board = level.parts.filter((p) => groups.get(p) !== "bin" && groups.get(p) !== "gone");
  // A Toons puzzle starts with the bin in TOONS.EXE's order and the parts on the board as its setup leaves them.
  const start = level.layout === "toons" && !solution && toonsSort ? toonsStart(level, toonsSort) : undefined;
  const atStart = (p: LevelPart): LevelPart => {
    const state = start?.states.get(p.index);
    const plugs = start?.plugs.get(p.index);
    if (state === undefined && !plugs) return p;
    return { ...p, ...(state === undefined ? {} : { state: [state, p.state[1]] }), ...(plugs ? { plugs } : {}) };
  };
  const parts = board.map((p) => drawPart(atStart(p), level.layout, list, spriteOf, drawing, toons));
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
  if (level.layout === "tim2" && !drawing)
    notes.push({
      status: "partial",
      title: "Walls and patterns drawn as frames.",
      detail: "TIM2.EXE’s type table wasn’t found, so its wall, pattern and block rules aren’t known.",
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
  const gone = level.parts.filter((p) => groups.get(p) === "gone");
  if (gone.length)
    notes.push({
      status: "decoded",
      title: `${plural(gone.length, "tunnel")} taken off.`,
      detail: `${gone.map((p) => `#${p.index}`).join(", ")}: the other end of a tunnel in the bin. TOONS.EXE takes it off as the puzzle starts and makes a new one when the player puts the tunnel on the board.`,
    });
  // The plugs the setup pulls out of a part that stays on the board, and the states it changes there.
  const pulled = start?.unplugged.filter((u) => !start.bin.has(u.into) || !start.bin.has(u.part)) ?? [];
  if (pulled.length)
    notes.push({
      status: "decoded",
      title: `${plural(pulled.length, "plug")} pulled out.`,
      detail: `${pulled.map((u) => `#${u.part} from #${u.into}`).join(", ")}: the puzzle start unplugs what it puts in the bin.`,
    });
  if (start?.states.size)
    notes.push({
      status: "decoded",
      title: `${plural(start.states.size, "part")} with another state.`,
      detail: `${[...start.states].map(([i, state]) => `#${i} ${state}`).join(", ")}: drawn with the state the puzzle start leaves them in.`,
    });
  const knot = compose([KNOT], spriteOf);
  return {
    area: PLAY_AREAS[level.layout],
    parts,
    lines,
    bin: start ? start.binOrder.map((i) => level.parts[i]!) : level.parts.filter((p) => groups.get(p) === "bin"),
    notes,
    knot,
    noteMarks: noteMarks(level, spriteOf),
  };
}

/** The parts a goal's condition looks at: the one part it names, or else every part of its types. */
export const goalPartsOf = (condition: GoalCondition, parts: readonly DrawnPart[]): DrawnPart[] =>
  condition.part !== undefined
    ? parts.filter((d) => d.part.index === condition.part)
    : parts.filter((d) => condition.types?.some((t) => t.type === d.part.type));

/** The topmost part at a point of the level, for clicks. Lines can't be picked; their part shows in the structure. */
export function partAt(scene: Scene, point: Point): DrawnPart | undefined {
  const inside = (b: Bounds) => point.x >= b.x && point.y >= b.y && point.x < b.x + b.width && point.y < b.y + b.height;
  return [...scene.parts].reverse().find((p) => p.how !== "line" && inside(p.box));
}
