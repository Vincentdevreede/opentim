/**
 * Reads the part types of Sid & Al's Incredible Toons from `TOONS.EXE`. The program isn't packed: its load image
 * follows the EXE header. It keeps a table with one 70-byte record per type, like the 58-byte records of TIM 1 with
 * far pointers instead of near ones. A record can point to the type's frames, each a chain of 17-byte pieces that put
 * up to four sprites of the type's sheet on one layer, to a position per frame and to a size per frame.
 */

import type { RecordField } from "./type-table.ts";

/** A sprite of the type's sheet, at a position relative to the part. */
export interface ToonsSprite {
  sprite: number;
  x: number;
  y: number;
}

/** Sprites drawn on one layer. A frame is one or more pieces. */
export interface ToonsPiece {
  layer: number;
  sprites: ToonsSprite[];
}

export interface ToonsType {
  /** Where the record starts in the load image. */
  at: number;
  /** The layers the type is drawn on, 0xff when unused. */
  layers: [number, number];
  /** The frames of the record's list, or none when it has no list. */
  frames: ToonsPiece[][];
  /** A position per frame, x then y, when the record has a list of them. */
  positions?: [number, number][];
  /** How many middle tiles in turn a part drawn as tiles has, from the byte at 0x2c. */
  middles: number;
}

export const TOONS_RECORD_SIZE = 70;
const FRAMES_FIELD = 0x18;
const POSITIONS_FIELD = 0x1c;
const SIZES_FIELD = 0x20;
const LAYERS_FIELD = 0x26;
const MIDDLES_FIELD = 0x2c;
const PIECE_SIZE = 17;
const MAX_FRAMES = 64;
/** Al's and Sid's lists are long: every frame of everything they do, one action after another. */
const MAX_CRITTER_FRAMES = 1024;
/** Al and Sid, whom TOONS.EXE draws from the sheet of what they are doing rather than a `PART` sheet. */
export const TOONS_CRITTERS: readonly number[] = [36, 37];
const MAX_PIECES = 8;
const NO_SPRITE = 0xff;
const MAX_TYPES = 256;

const u16 = (image: Uint8Array, offset: number) =>
  offset >= 0 && offset + 1 < image.length ? image[offset]! | (image[offset + 1]! << 8) : 0;
const s8 = (b: number) => (b > 127 ? b - 256 : b);
/** Where a far pointer of the load image points, or 0 for a null pointer. */
const far = (image: Uint8Array, offset: number) => u16(image, offset + 2) * 16 + u16(image, offset);

/** The load image of a DOS program that isn't packed: the bytes the EXE header says DOS loads. */
export function loadImage(exe: Uint8Array): Uint8Array {
  if (u16(exe, 0) !== 0x5a4d) throw new Error("Not a DOS program: no MZ header");
  const lastPage = u16(exe, 2);
  const pages = u16(exe, 4);
  const end = (pages - (lastPage ? 1 : 0)) * 512 + lastPage;
  const start = u16(exe, 8) * 16;
  if (end > exe.length || start >= end) throw new Error("The EXE header gives a load image outside the file");
  return exe.subarray(start, end);
}

/**
 * Finds the type table the way TOONS.EXE reaches it: `mov dx, 70; imul dx; add ax, start; mov [bp+n], segment`, the
 * address of the record of the type in AX. The most common start and segment win. Then the number of types: the
 * routines that walk every type end their loop with `cmp si, n` or `cmp di, n` soon after reaching a record.
 */
export function findToonsTypeTable(image: Uint8Array): { start: number; count: number } {
  const starts = new Map<number, number>();
  const reaches: number[] = [];
  for (let i = 0; i + 13 <= image.length; i++) {
    const record = image[i] === 0xba && u16(image, i + 1) === TOONS_RECORD_SIZE && image[i + 3] === 0xf7;
    if (!record || image[i + 4] !== 0xea) continue;
    reaches.push(i);
    if (image[i + 5] !== 0x05 || image[i + 8] !== 0xc7 || image[i + 9] !== 0x46) continue;
    const at = u16(image, i + 11) * 16 + u16(image, i + 6);
    starts.set(at, (starts.get(at) ?? 0) + 1);
  }
  const best = [...starts].sort((a, b) => b[1] - a[1])[0];
  if (!best) throw new Error("No type table found: no code reaches a record of 70 bytes");
  const counts = new Map<number, number>();
  for (const i of reaches)
    for (let j = i; j < i + 0x80 && j + 8 <= image.length; j++) {
      const compare = image[j] === 0x83 && (image[j + 1] === 0xfe || image[j + 1] === 0xff);
      if (!compare || !loopsBackBefore(image, j + 3, i)) continue;
      const n = image[j + 2]!;
      counts.set(n, (counts.get(n) ?? 0) + 1);
      break;
    }
  const count = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!count) throw new Error("The number of types wasn't found");
  if (best[0] + count * TOONS_RECORD_SIZE > image.length) throw new Error("The type table runs past the program");
  return { start: best[0], count: Math.min(count, MAX_TYPES) };
}

/**
 * True when the code at `at` jumps back to before `before` while the compare said less: `jl back`, or `jge over;
 * jmp back` as the compiler writes a long loop.
 */
function loopsBackBefore(image: Uint8Array, at: number, before: number): boolean {
  if (image[at] === 0x7c) return at + 2 + s8(image[at + 1]!) <= before;
  if (image[at] === 0x7d && image[at + 1] === 0x03 && image[at + 2] === 0xe9) {
    const rel = u16(image, at + 3);
    return at + 5 + (rel > 0x7fff ? rel - 0x10000 : rel) <= before;
  }
  return false;
}

function readPiece(image: Uint8Array, at: number): ToonsPiece {
  const sprites: ToonsSprite[] = [];
  for (let i = 0; i < 4 && image[at + 5 + i] !== NO_SPRITE; i++)
    sprites.push({ sprite: image[at + 5 + i]!, x: s8(image[at + 9 + 2 * i]!), y: s8(image[at + 10 + 2 * i]!) });
  return { layer: image[at + 4]!, sprites };
}

/** A frame: its pieces, following each piece's far pointer to the next until a null pointer. */
function readFrame(image: Uint8Array, at: number): ToonsPiece[] {
  const pieces: ToonsPiece[] = [];
  while (at && pieces.length < MAX_PIECES && at + PIECE_SIZE <= image.length) {
    pieces.push(readPiece(image, at));
    at = far(image, at);
  }
  return pieces;
}

/** True when a piece could start here: its first sprite is there and the others are sprites or end the list. */
function isPiece(image: Uint8Array, at: number): boolean {
  if (at <= 0 || at + PIECE_SIZE > image.length) return false;
  const sprites = image.subarray(at + 5, at + 9);
  return sprites[0] !== NO_SPRITE && sprites.every((s) => s < 0x80 || s === NO_SPRITE);
}

/**
 * The frames of a record: far pointers to pieces, one per frame. The list has no count of its own; the positions and
 * the sizes follow it in every record that has them, so it ends where the first of those starts, and else at the first
 * pointer that doesn't lead to a piece.
 */
function readFrames(image: Uint8Array, record: number, max: number): ToonsPiece[][] {
  const list = far(image, record + FRAMES_FIELD);
  if (!list) return [];
  const after = [far(image, record + POSITIONS_FIELD), far(image, record + SIZES_FIELD)].filter((p) => p > list);
  const end = after.length ? Math.min(...after) : list + 4 * max;
  const frames: ToonsPiece[][] = [];
  for (let at = list; at + 4 <= end && frames.length < max; at += 4) {
    const piece = far(image, at);
    // Al's and Sid's lists have no frames where an action has no entry; their lists go on after the gap.
    if (!piece && max === MAX_CRITTER_FRAMES && after.length) {
      frames.push([]);
      continue;
    }
    if (!isPiece(image, piece)) break;
    frames.push(readFrame(image, piece));
  }
  return frames;
}

/** Reads `count` records of the type table that starts at this offset of the load image. */
export function readToonsTypes(image: Uint8Array, start: number, count: number): ToonsType[] {
  return Array.from({ length: count }, (_, t) => {
    const at = start + t * TOONS_RECORD_SIZE;
    const frames = readFrames(image, at, TOONS_CRITTERS.includes(t) ? MAX_CRITTER_FRAMES : MAX_FRAMES);
    const type: ToonsType = {
      at,
      layers: [image[at + LAYERS_FIELD]!, image[at + LAYERS_FIELD + 1]!],
      frames,
      middles: image[at + MIDDLES_FIELD]!,
    };
    const positions = far(image, at + POSITIONS_FIELD);
    if (positions) type.positions = readPositions(image, positions, Math.max(frames.length, MAX_FRAMES));
    return type;
  });
}

/** Reads up to `count` positions, two signed bytes each, stopping at the end of the image. */
function readPositions(image: Uint8Array, at: number, count: number): [number, number][] {
  const n = Math.max(0, Math.min(count, Math.floor((image.length - at) / 2)));
  return Array.from({ length: n }, (_, i) => [s8(image[at + 2 * i]!), s8(image[at + 2 * i + 1]!)]);
}

/** One thing Al or Sid does: a run of frames of the type's list, drawn from one sheet. */
export interface ToonsAction {
  /** The first frame of the action in the type's frame list. */
  start: number;
  /** How many frames the action has. */
  frames: number;
  /** The sheet TOONS.EXE draws the action's frames from, like `CATROOT`. */
  sheet: string;
}

/** Finds every place a byte pattern starts; `-1` in the pattern matches any byte. */
function findAll(image: Uint8Array, pattern: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + pattern.length <= image.length; i++)
    if (pattern.every((b, k) => b < 0 || image[i + k] === b)) out.push(i);
  return out;
}

const ANY = -1;
/** `mov ax, segment; mov es, ax; mov si, es:[bx + table]`: the table of what Al or Sid does, by action. */
const ACTION_TABLE = [0xb8, ANY, ANY, 0x8e, 0xc0, 0x26, 0x8b, 0xb7, ANY, ANY];
/** `mov dx, 9; imul dx; add ax, names`: the names of the sheets, 9 bytes each. */
const SHEET_NAMES = [0xba, 0x09, 0x00, 0xf7, 0xea, 0x05, ANY, ANY];
/** `mov dx, 6; imul dx; mov dx, segment; mov bx, ax; mov es, dx; cmp word es:[bx + table], 0`: the first frames. */
const FIRST_FRAMES = [
  0xba,
  0x06,
  0x00,
  0xf7,
  0xea,
  0xba,
  ANY,
  ANY,
  0x8b,
  0xd8,
  0x8e,
  0xc2,
  0x26,
  0x83,
  0xbf,
  ANY,
  ANY,
  0x00,
];
const ACTION_SIZE = 12;
const NAME_SIZE = 9;
const MAX_ACTIONS = 256;

/**
 * Al's and Sid's actions, by type (36 and 37), as TOONS.EXE draws them. Before it draws Al or Sid, TOONS.EXE takes
 * the action the part is doing, looks up the action's 12-byte entry in the data segment (a frame count, then the
 * sheet's number) and loads that sheet, `cat…` or `sid…` from a list of 9-byte names; then it draws the frame of the
 * part's state from the type's own frame list. A second table gives each action's first frame in that list (6 bytes
 * an action: the frame, negative for some, and a far pointer to the action's code). Each table is found by the code
 * that reads it, Al's first. An action without an entry is left out. Empty when the code isn't found.
 */
export function readToonsActions(exe: Uint8Array): Map<number, (ToonsAction | undefined)[]> {
  const image = loadImage(exe);
  const entry = u16(exe, 0x16) * 16 + u16(exe, 0x14);
  if (image[entry] !== 0xba) return new Map();
  // Borland's start-up code loads the data segment first: `mov dx, segment`.
  const data = u16(image, entry + 1) * 16;
  const tables = findAll(image, ACTION_TABLE).map((at) => u16(image, at + 1) * 16 + u16(image, at + 8));
  const names = findAll(image, SHEET_NAMES).map((at) => u16(image, at + 6));
  const firsts = findAll(image, FIRST_FRAMES).map((at) => u16(image, at + 6) * 16 + u16(image, at + 15));
  if (tables.length !== 2 || names.length !== 2 || firsts.length !== 2) return new Map();
  return new Map(
    TOONS_CRITTERS.map((type, k) => {
      const nameAt = names[k]!;
      const actions: (ToonsAction | undefined)[] = [];
      for (let a = 0; a < MAX_ACTIONS; a++) {
        const pointer = u16(image, tables[k]! + 2 * a);
        // The entries lie just before the names, so a pointer that doesn't point at one ends the table.
        const isEntry = pointer && pointer < nameAt && (nameAt - pointer) % ACTION_SIZE === 0;
        if (pointer && !isEntry) break;
        if (!pointer) {
          actions.push(undefined);
          continue;
        }
        const at = data + pointer;
        const nameStart = data + nameAt + NAME_SIZE * image[at + 1]!;
        const name = String.fromCharCode(...image.subarray(nameStart, nameStart + NAME_SIZE)).split("\0")[0]!;
        const first = u16(image, firsts[k]! + 6 * a);
        const start = first > 0x7fff ? 0x10000 - first : first;
        actions.push(name ? { start, frames: image[at]!, sheet: name.toUpperCase() } : undefined);
      }
      while (actions.length && !actions.at(-1)) actions.pop();
      return [type, actions];
    }),
  );
}

const toonsCallback = (offset: number, n: number): RecordField => ({
  offset,
  size: 4,
  name: `code ${n}`,
  known: "guess",
  note: "A far pointer to the type's code, in the place where TIM 1 keeps its six callbacks. Most point into the small stubs that load the program's overlays.",
});

/** The fields of a 70-byte record of `TOONS.EXE`, in order. */
export const TOONS_RECORD_FIELDS: RecordField[] = [
  {
    offset: 0x00,
    size: 2,
    name: "density",
    known: "guess",
    note: "Where TIM 1 keeps it; the balloon has 9, as in TIM 1.",
  },
  {
    offset: 0x02,
    size: 2,
    name: "mass",
    known: "guess",
    note: "Where TIM 1 keeps it; the balloon has 1, as in TIM 1.",
  },
  { offset: 0x04, size: 2, name: "bounciness", known: "guess", note: "Where TIM 1 keeps it." },
  { offset: 0x06, size: 2, name: "friction", known: "guess", note: "Where TIM 1 keeps it." },
  {
    offset: 0x08,
    size: 2,
    name: "acceleration",
    known: "checked",
    note: "0 in the file. TOONS.EXE works it out for every type in one loop, as TIM 1 does.",
  },
  {
    offset: 0x0a,
    size: 2,
    name: "terminal velocity",
    known: "checked",
    note: "0 in the file. Worked out in the same loop as the acceleration.",
  },
  { offset: 0x0c, size: 2, name: "max width", known: "guess", note: "Where TIM 1 keeps it. Walls have 640." },
  { offset: 0x0e, size: 2, name: "max height", known: "guess", note: "Where TIM 1 keeps it. Walls have 400." },
  { offset: 0x10, size: 2, name: "min width", known: "guess", note: "Where TIM 1 keeps it. Walls have 32." },
  { offset: 0x12, size: 2, name: "min height", known: "guess", note: "Where TIM 1 keeps it. Walls have 32." },
  {
    offset: 0x14,
    size: 4,
    name: "sheet",
    known: "checked",
    note: "0 in the file. TOONS.EXE puts a far pointer to the loaded `PART` sheet of the type here.",
  },
  {
    offset: FRAMES_FIELD,
    size: 4,
    name: "frames",
    known: "checked",
    note: "A far pointer to a far pointer per frame, each to a chain of 17-byte pieces, or 0. TOONS.EXE draws a part from it when bit 0x1000 of its drawing flags is set.",
  },
  {
    offset: POSITIONS_FIELD,
    size: 4,
    name: "frame positions",
    known: "checked",
    note: "A far pointer to a position per state, two signed bytes, or 0. Without frames, state N shows sprite N there.",
  },
  {
    offset: SIZES_FIELD,
    size: 4,
    name: "frame sizes",
    known: "checked",
    note: "A far pointer to a width and height per state, or 0. TOONS.EXE sets the part's size from it, or else from the sprite of the state.",
  },
  { offset: 0x24, size: 2, name: "word 0x24", known: "unknown", note: "0 for every type." },
  { offset: LAYERS_FIELD, size: 1, name: "layer", known: "checked", note: "The layer the type is drawn on." },
  {
    offset: LAYERS_FIELD + 1,
    size: 1,
    name: "second layer",
    known: "checked",
    note: "A second layer, or 0xff when unused.",
  },
  {
    offset: 0x28,
    size: 2,
    name: "word 0x28",
    known: "unknown",
    note: "Where TIM 1 keeps the number of outline points.",
  },
  {
    offset: 0x2a,
    size: 2,
    name: "word 0x2a",
    known: "unknown",
    note: "Mostly the type's own number. The inclines 47 to 51 all have 48, the empty types other numbers.",
  },
  {
    offset: MIDDLES_FIELD,
    size: 2,
    name: "middle tiles",
    known: "checked",
    note: "How many middle tiles take turns when the part is drawn as tiles. TOONS.EXE reads its low byte.",
  },
  toonsCallback(0x2e, 1),
  toonsCallback(0x32, 2),
  toonsCallback(0x36, 3),
  toonsCallback(0x3a, 4),
  toonsCallback(0x3e, 5),
  toonsCallback(0x42, 6),
];
