/**
 * What the Lab reads from TIM2.EXE about the part types. TIM2.EXE isn't packed: its data segment is the one its entry
 * code loads first (`mov dx, segment`), and the data segment holds a table with a near pointer per part type to that
 * type's 72-byte record. The records follow the table, so the table ends where the first record starts.
 *
 * A record has far pointers to the type's routines; the one at `0x18` draws a part. Most types share one routine that
 * draws their frame; walls and tiles have routines of their own, which `tim2Drawing` tells apart.
 */

import { findChunk, readChunks } from "@opentim/resources";

export interface Tim2Types {
  /** Where the data segment starts in the file. */
  dataSegment: number;
  /** Where the type table starts in the data segment. */
  table: number;
  /** Each type's record, by type number. */
  records: Uint8Array[];
}

export const TIM2_RECORD_SIZE = 0x48;
/** The far pointer of the routine that draws a part, in a type's record. */
const DRAW = 0x18;
/** How many records in a row the table search wants, to be sure. */
const RUN = 20;

/** Reads TIM2.EXE's type table, or throws when the program doesn't look like TIM2.EXE. */
export function readTim2Types(exe: Uint8Array): Tim2Types {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const word = (at: number) => view.getUint16(at, true);
  if (exe.length < 0x40 || word(0) !== 0x5a4d) throw new Error("Not a DOS program: no MZ header");
  const header = word(8) * 16;
  const entry = header + word(0x16) * 16 + word(0x14);
  if (exe[entry] !== 0xba) throw new Error("The entry code doesn't load the data segment first");
  const dataSegment = header + word(entry + 1) * 16;
  for (let table = 0; table < 0x8000 && dataSegment + table + RUN * 2 <= exe.length; table += 2) {
    const at = dataSegment + table;
    const first = word(at);
    if (first <= table || (first - table) % 2) continue;
    let run = 1;
    while (run < RUN && word(at + run * 2) === first + run * TIM2_RECORD_SIZE) run++;
    if (run < RUN) continue;
    const count = (first - table) / 2;
    const records = Array.from({ length: count }, (_, type) => {
      const record = dataSegment + word(at + type * 2);
      if (record + TIM2_RECORD_SIZE > exe.length) throw new Error(`Type ${type}'s record runs past the program`);
      return exe.slice(record, record + TIM2_RECORD_SIZE);
    });
    return { dataSegment, table, records };
  }
  throw new Error("No type table in the data segment");
}

/**
 * How TIM2.EXE draws a type: as a wall of pieces, as a pattern of tiles, as a box filled with one colour (the colour
 * block), or by its frame.
 */
export type Tim2Drawing = "wall" | "pattern" | "block" | "frame";

/** The far pointer of a type's draw routine, as one number. */
const drawRoutine = (record: Uint8Array | undefined) =>
  record ? new DataView(record.buffer, record.byteOffset).getUint32(DRAW, true) : undefined;

/**
 * The types TIM2.EXE draws as walls, patterns or colour blocks. The brick wall (1) is drawn by the wall routine, the
 * tile (122) by the pattern routine and the colour block (127) by the block routine; every type whose record points at
 * the same routine is drawn the same way.
 */
export function tim2Drawing(types: Tim2Types): Map<number, Tim2Drawing> {
  const wall = drawRoutine(types.records[1]);
  const pattern = drawRoutine(types.records[122]);
  const block = drawRoutine(types.records[127]);
  return new Map(
    types.records.map((record, type) => {
      const routine = drawRoutine(record);
      const how = routine === wall ? "wall" : routine === pattern ? "pattern" : routine === block ? "block" : "frame";
      return [type, how];
    }),
  );
}

/** A width and a height. */
export interface Tim2Size {
  width: number;
  height: number;
}

/** One outline of a `.PAR` file: its points, in the part's size, the last with bit 0x4000 of its flags. */
export interface Tim2Outline {
  /** Two words before the points, which TIM2.EXE reads and doesn't keep. */
  skipped: [number, number];
  points: { flags: number; x: number; y: number }[];
}

/**
 * A part's `.PAR` file, as TIM2.EXE's loader (in its overlays; in the floppy build at file offset `0x6571f`) reads it
 * into the part's type record when it loads the type's animation.
 */
export interface Tim2Properties {
  /** 0x149; the loader refuses 0 and anything higher. */
  version: number;
  /** The part's type. The loader refuses a file for another type. */
  type: number;
  /** Compared with the air to work out how fast the part falls (type record 0x36). */
  density: number;
  /** Type record 0x38; the loader makes 0 into 1000. */
  mass: number;
  /** Type record 0x3a, passed to collisions with the friction. */
  bounciness: number;
  /** Type record 0x3c. */
  friction: number;
  /** Type record 0x40: the most a part's vertical speed can be. 0 in every file; TIM2.EXE works it out from the air. */
  terminalVelocity: number;
  /** The smallest and largest size a player can resize the part to, in steps of 16 (type record 0x32 and 0x2e). */
  minSize: Tim2Size;
  maxSize: Tim2Size;
  /** Type record 0x42: the size TIM2.EXE mirrors most parts in, and gives a part whose type has no size of its own. */
  size: Tim2Size;
  /**
   * Bit 0x08 makes the loader add each outline mirrored left to right, bit 0x10 upside down, each within the size:
   * x becomes width - 1 - x. The loader doesn't keep the word, and no other bit is read.
   */
  flags: number;
  /** The part's shapes for collisions, as points. Which one the game uses when isn't read yet. */
  outlines: Tim2Outline[];
}

const PROPERTIES = "PROP";
const NEWEST_PROPERTIES = 0x149;
const LAST_POINT = 0x4000;

/**
 * Reads a part's `.PAR` file: a `PAR:` chunk with `PROP`, then words: the version, the type, the density, mass,
 * bounciness, friction and terminal velocity, the smallest width and height, the largest width and height, the size,
 * the flags, the number of outlines and their number of points in all, then the outlines. Undefined when it isn't one.
 */
export function readPar(par: Uint8Array): Tim2Properties | undefined {
  let data: Uint8Array | undefined;
  try {
    data = findChunk(readChunks(par), "PAR:")?.data;
  } catch {
    return undefined;
  }
  if (!data || data.length < 0x24 || String.fromCharCode(...data.subarray(0, 4)) !== PROPERTIES) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const word = (at: number) => view.getInt16(at, true);
  const version = view.getUint16(4, true);
  if (version === 0 || version > NEWEST_PROPERTIES) return undefined;
  const size = (at: number) => ({ width: word(at), height: word(at + 2) });
  const outlines: Tim2Outline[] = [];
  const count = word(0x20);
  let at = 0x24;
  // The loader reads the outlines only when the file says it has points.
  for (let i = 0; word(0x22) && i < count; i++) {
    if (at + 4 > data.length) return undefined;
    const outline: Tim2Outline = { skipped: [word(at), word(at + 2)], points: [] };
    at += 4;
    for (let flags = 0; !(flags & LAST_POINT); at += 6) {
      if (at + 6 > data.length) return undefined;
      flags = view.getUint16(at, true);
      outline.points.push({ flags, x: word(at + 2), y: word(at + 4) });
    }
    outlines.push(outline);
  }
  return {
    version,
    type: word(6),
    density: word(8),
    mass: word(0x0a),
    bounciness: word(0x0c),
    friction: word(0x0e),
    terminalVelocity: word(0x10),
    minSize: size(0x12),
    maxSize: size(0x16),
    size: size(0x1a),
    flags: word(0x1e),
    outlines,
  };
}

/**
 * Whether a part's `.PAR` file has the size limits of TIM 2's walls: 576 × 416 as its largest size. In the floppy and
 * CD builds the types with that size are exactly the ones TIM2.EXE draws with its wall routine, the large pipes
 * included. That is a match in the files, not a rule the program follows, so it only stands in when TIM2.EXE isn't
 * loaded.
 */
export function hasWallLimits(par: Uint8Array): boolean {
  const properties = readPar(par);
  return properties?.maxSize.width === 576 && properties.maxSize.height === 416;
}

/**
 * How TIM2.EXE's size routine (in the floppy build at file offset `0x21477`; it runs whenever a part's state is set,
 * also when a level is set up) fills two words of a part's record, offsets `0x44` and `0x46`, which its usual draw
 * routine mirrors the part in. The type picks the way, by lists in the code that are the same in all three builds.
 * Every type not in the lists below gets the size of the frame its state shows when bit 0x1000 of its third flag word
 * is set, and the size in its `.PAR` file when it isn't.
 */
/** Types that keep their own size there. */
const KEEPS_ITS_SIZE = new Set([
  1, 2, 5, 46, 48, 56, 60, 82, 83, 84, 85, 97, 99, 100, 101, 102, 118, 121, 122, 123, 124, 125, 126, 127, 203, 205, 271,
  280,
]);
/** Types that get 0. */
const NO_SIZE = new Set([8, 10, 76]);
/** Types that get the size of the frame their state shows. */
const FRAME_SIZE = new Set([4, 7, 57, 58, 71, 88]);
/** Bit 0x1000 of the third flag word: a type the size routine gives its frame's size. */
const SIZED_BY_FRAME = 0x1000;

/** What `tim2MirrorSide` needs of a placed part. */
export interface Tim2MirroredPart {
  type: number;
  size: Tim2Size;
  flags: readonly number[];
  state: readonly number[];
}

/** What `tim2MirrorSide` needs of the part's type: its animation's frames and size, and its `.PAR` size. */
export interface Tim2MirroredType {
  frames: readonly { id: number; box?: { x: number; y: number; width: number; height: number } }[];
  states?: readonly number[];
  mirrorBox?: Tim2Size;
  parSize?: Tim2Size;
}

/**
 * Where TIM2.EXE's usual draw routine measures a mirrored part from: a sprite of a part mirrored left to right lands
 * at this width less its place less its own width, as if the part were this wide. The routine moves the part by the
 * mirror size (see above) less the right edge of the frame of state 0, and then mirrors the frame in the animation's
 * size, so the width is the mirror size, less that edge, plus the animation's width; the same goes down. Undefined
 * when the animation or the `.PAR` size it needs is missing.
 */
export function tim2MirrorSide(part: Tim2MirroredPart, type: Tim2MirroredType): Tim2Size | undefined {
  const frameOf = (state: number) => {
    const id = type.states?.[state] ?? state;
    return type.frames.find((f) => f.id === id)?.box;
  };
  const first = frameOf(0);
  const shown = frameOf(part.state[0] ?? 0);
  if (!first || !type.mirrorBox) return undefined;
  const third = part.flags[2] ?? 0;
  const mirror = KEEPS_ITS_SIZE.has(part.type)
    ? part.size
    : NO_SIZE.has(part.type)
      ? { width: 0, height: 0 }
      : FRAME_SIZE.has(part.type) || third & SIZED_BY_FRAME
        ? shown
        : type.parSize;
  if (!mirror) return undefined;
  return {
    width: mirror.width - first.x - first.width + type.mirrorBox.width,
    height: mirror.height - first.y - first.height + type.mirrorBox.height,
  };
}
