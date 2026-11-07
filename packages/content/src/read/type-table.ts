/**
 * Reads the part types of The Incredible Machine and Even More from their unpacked program. The program keeps a table
 * with one 58-byte record per type. A record can point to the type's frames; each frame is a chain of 15-byte pieces
 * that put up to four sprites of the type's sheet on one layer. A type without pieces draws sprite N of its sheet as
 * frame N, and its record can point to a position per frame instead.
 */

/** A sprite of the type's sheet, at a position relative to the part. */
export interface ExeSprite {
  sprite: number;
  x: number;
  y: number;
}

/** Sprites drawn on one layer. A frame is one or more pieces. */
export interface ExePiece {
  layer: number;
  sprites: ExeSprite[];
}

export interface ExeType {
  /** Where the record starts in the program image. */
  at: number;
  /** The layers the type is drawn on, 0xff when unused. Every piece of a frame is on one of them. */
  layers: [number, number];
  frames: ExePiece[][];
  /** Where the positions of the frames start in the data segment, or 0 when the record has none. */
  offsets: number;
}

export const RECORD_SIZE = 58;
const FRAMES_FIELD = 0x16;
const OFFSETS_FIELD = 0x18;
const LAYERS_FIELD = 0x1c;
const PIECE_SIZE = 15;
const MAX_FRAMES = 64;
const MAX_PIECES = 8;
const NO_SPRITE = 0xff;

const u16 = (image: Uint8Array, offset: number) =>
  offset >= 0 && offset + 1 < image.length ? image[offset]! | (image[offset + 1]! << 8) : 0;
const s8 = (b: number) => (b > 127 ? b - 256 : b);

/**
 * The data segment of the program: the value most often loaded into DS, by `mov ax, value; mov ds, ax` or the same
 * through DX. Pointers in the table are offsets in this segment.
 */
export function findDataSegment(image: Uint8Array): number {
  const counts = new Map<number, number>();
  for (let i = 0; i + 5 <= image.length; i++) {
    const viaAx = image[i] === 0xb8 && image[i + 3] === 0x8e && image[i + 4] === 0xd8;
    const viaDx = image[i] === 0xba && image[i + 3] === 0x8e && image[i + 4] === 0xda;
    if (viaAx || viaDx) {
      const value = u16(image, i + 1);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (!best) throw new Error("No data segment found");
  return best[0];
}

/**
 * True when a piece could start at this offset of the data segment. A real piece never draws the same sprite twice
 * at one position, which rules out runs of zero bytes.
 */
function isPiece(image: Uint8Array, ds: number, pointer: number): boolean {
  const at = ds * 16 + pointer;
  if (pointer < 2 || at + PIECE_SIZE > image.length) return false;
  const sprites = image.subarray(at + 3, at + 7);
  if (image[at + 2]! > 7 || sprites[0] === NO_SPRITE || !sprites.every((f) => f < 0x80 || f === NO_SPRITE))
    return false;
  const seen = new Set<number>();
  for (let i = 0; i < 4 && sprites[i] !== NO_SPRITE; i++) {
    const key = (sprites[i]! << 16) | (image[at + 7 + 2 * i]! << 8) | image[at + 8 + 2 * i]!;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function readFrame(image: Uint8Array, ds: number, pointer: number): ExePiece[] {
  const pieces: ExePiece[] = [];
  while (pointer && pieces.length < MAX_PIECES) {
    const at = ds * 16 + pointer;
    if (at + PIECE_SIZE > image.length) break;
    const sprites: ExeSprite[] = [];
    for (let i = 0; i < 4 && image[at + 3 + i] !== NO_SPRITE; i++)
      sprites.push({ sprite: image[at + 3 + i]!, x: s8(image[at + 7 + 2 * i]!), y: s8(image[at + 8 + 2 * i]!) });
    pieces.push({ layer: image[at + 2]!, sprites });
    pointer = u16(image, at);
  }
  return pieces;
}

function readFrames(image: Uint8Array, ds: number, list: number): ExePiece[][] {
  const frames: ExePiece[][] = [];
  if (!list) return frames;
  for (let k = 0; k < MAX_FRAMES; k++) {
    const pointer = u16(image, ds * 16 + list + 2 * k);
    if (!isPiece(image, ds, pointer)) break;
    frames.push(readFrame(image, ds, pointer));
  }
  return frames;
}

/** Reads `count` records of the type table that starts at this offset of the image. */
export function readTypes(image: Uint8Array, ds: number, start: number, count: number): ExeType[] {
  return Array.from({ length: count }, (_, t) => {
    const at = start + t * RECORD_SIZE;
    return {
      at,
      layers: [image[at + LAYERS_FIELD]!, image[at + LAYERS_FIELD + 1]!],
      frames: readFrames(image, ds, u16(image, at + FRAMES_FIELD)),
      offsets: u16(image, at + OFFSETS_FIELD),
    };
  });
}

/** Reads the positions of `count` frames: two signed bytes each, x then y. */
export function readOffsets(image: Uint8Array, ds: number, pointer: number, count: number): [number, number][] {
  const at = ds * 16 + pointer;
  if (at + 2 * count > image.length) throw new Error(`Frame positions at ${pointer.toString(16)} run past the program`);
  return Array.from({ length: count }, (_, i) => [s8(image[at + 2 * i]!), s8(image[at + 2 * i + 1]!)]);
}

/**
 * Finds the start of the type table: the offset where `count` records read best. `spriteCount` gives the number of
 * sprites in each type's sheet, or undefined when the type has none. A record reads well when its frames only use
 * sprites its sheet has, and badly when it has frames without a sheet. Records one place off fail that test, which
 * plausible-looking bytes alone don't.
 */
export function findTypeTable(
  image: Uint8Array,
  ds: number,
  count: number,
  spriteCount: (type: number) => number | undefined,
): number {
  let best = { score: -Infinity, start: -1 };
  const last = image.length - count * RECORD_SIZE;
  const layersLookRight = (at: number) =>
    image[at + LAYERS_FIELD]! <= 7 && (image[at + LAYERS_FIELD + 1]! <= 7 || image[at + LAYERS_FIELD + 1] === 0xff);
  for (let start = 0; start <= last; start++) {
    if (![0, 1, 2, 3, 4, 5, 6, 7].every((t) => layersLookRight(start + t * RECORD_SIZE))) continue;
    let score = 0;
    readTypes(image, ds, start, count).forEach((type, t) => {
      const sprites = spriteCount(t);
      const used = type.frames.flat().flatMap((p) => p.sprites.map((s) => s.sprite));
      if (layersLookRight(start + t * RECORD_SIZE)) score += 1;
      if (used.length) score += sprites !== undefined && used.every((s) => s < sprites) ? 4 : -4;
    });
    if (score > best.score) best = { score, start };
  }
  if (best.start < 0) throw new Error("No type table found");
  return best.start;
}

/** What is known about a field of a record. */
export interface RecordField {
  offset: number;
  size: 1 | 2 | 4;
  name: string;
  /**
   * `checked`: shown by the program's own code, which reads the field for this purpose, or by reading the part
   * lists from every build. `guess`: named from patterns in the values or from other research, not shown by the
   * code yet. `unknown`: no idea yet.
   */
  known: "checked" | "guess" | "unknown";
  /** What the field means, in a sentence or two. */
  note: string;
}

const callback = (offset: number, name: string): RecordField => ({
  offset,
  size: 4,
  name: `${name} code`,
  known: "guess",
  note: `A far pointer to the type's code. The program calls through it, so it is code; "${name}" is the traditional name for its place in the record.`,
});

/** The fields of a 58-byte record, in order. */
export const RECORD_FIELDS: RecordField[] = [
  {
    offset: 0x00,
    size: 2,
    name: "density",
    known: "checked",
    note: "Compared with the air to work out the acceleration: lighter than air rises, heavier falls. The balloon has 9.",
  },
  {
    offset: 0x02,
    size: 2,
    name: "mass",
    known: "checked",
    note: "Copied into each part when it is set up, and compared between two parts that collide. The balloon has 1, the bowling ball 200.",
  },
  {
    offset: 0x04,
    size: 2,
    name: "bounciness",
    known: "checked",
    note: "A collision uses the lower value of the two parts. A super ball keeps its own when it is 128 or more.",
  },
  { offset: 0x06, size: 2, name: "friction", known: "checked", note: "Used by the same collision code as bounciness." },
  {
    offset: 0x08,
    size: 2,
    name: "acceleration",
    known: "checked",
    note: "0 in the file. The program works it out from density, gravity and air, and adds it to the part's vertical speed every step.",
  },
  {
    offset: 0x0a,
    size: 2,
    name: "terminal velocity",
    known: "checked",
    note: "0 in the file. Worked out by the program; the most a part's vertical speed can be.",
  },
  {
    offset: 0x0c,
    size: 2,
    name: "max width",
    known: "guess",
    note: "The widest it can be resized to. A part that can't be resized has 0 here and 240 as its minimum.",
  },
  { offset: 0x0e, size: 2, name: "max height", known: "guess", note: "The highest it can be resized to." },
  { offset: 0x10, size: 2, name: "min width", known: "guess", note: "The narrowest it can be resized to." },
  { offset: 0x12, size: 2, name: "min height", known: "guess", note: "The lowest it can be resized to." },
  {
    offset: 0x14,
    size: 2,
    name: "frame size list",
    known: "guess",
    note: "Read like the frame sizes, a pointer per state to a size. 0 for every part, so never used.",
  },
  {
    offset: FRAMES_FIELD,
    size: 2,
    name: "frames",
    known: "checked",
    note: "Where the list of frames starts in the data segment, or 0 when the type has no pieces.",
  },
  {
    offset: OFFSETS_FIELD,
    size: 2,
    name: "frame positions",
    known: "checked",
    note: "Where a position per frame starts in the data segment, or 0. Frame N then shows sprite N.",
  },
  {
    offset: 0x1a,
    size: 2,
    name: "frame sizes",
    known: "checked",
    note: "Where a width and height per state start, or 0. The program sets the part's size from it.",
  },
  { offset: LAYERS_FIELD, size: 1, name: "layer", known: "checked", note: "The layer the type is drawn on." },
  {
    offset: LAYERS_FIELD + 1,
    size: 1,
    name: "second layer",
    known: "checked",
    note: "A second layer, or 0xff when unused.",
  },
  {
    offset: 0x1e,
    size: 2,
    name: "outline points",
    known: "checked",
    note: "How many points the part's outline has. The program makes room for them when it sets the part up.",
  },
  {
    offset: 0x20,
    size: 2,
    name: "parts bin place",
    known: "guess",
    note: "Its place in the parts bin: 0 is the bowling ball, 1 the basketball. Parts that are never in the bin seem to have 50.",
  },
  callback(0x22, "bounce"),
  callback(0x26, "run"),
  callback(0x2a, "reset"),
  callback(0x2e, "flip"),
  callback(0x32, "resize"),
  callback(0x36, "rope"),
];
