/**
 * Reads the level files of The Incredible Machine, Even More and Sid & Al's Incredible Toons: the `.LEV` puzzles and
 * the `.GKC` scenes, like the title screen. Both are the same format. A file starts with a magic number and a version,
 * then the header, then every part with where it stands and what it is tied to.
 *
 * Every byte of a file is accounted for: a file reads only when the layout ends exactly at its last byte. Names of
 * fields whose meaning isn't known yet say so, and their values are kept as they are.
 */

/** TIM 1, Even More and the Add-On Disk share one layout; Toons stores a few fields more and a few less. */
export type LevelLayout = "tim" | "toons";

/** A puzzle has a title, a goal and bonus points. A freeform file, like a scene, has none of those. */
export type LevelKind = "puzzle" | "freeform";

/** The three lists of parts in a level, in the order the file stores them. */
export type PartGroup = "static" | "moving" | "bin";

export interface LevelField {
  /** The field's name, like `gravity`. */
  key: string;
  offset: number;
  /** In bytes. */
  size: number;
  value: number | string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A place on a part where a rope can be tied, and the rope tied there, if any. */
export interface RopeSlot {
  /** Where on the part, as two bytes. */
  at: Point;
  rope?: {
    /** The two parts the rope runs between, by their index in the level. */
    parts: [number | null, number | null];
    /** The slot used on each of those parts. */
    slots: [number, number];
  };
}

export interface LevelPart {
  /** The part's place in the file, counting from 0 over all three groups. Links between parts use it. */
  index: number;
  group: PartGroup;
  /** The part's number, as in the part lists. */
  type: number;
  /**
   * The flag words as stored: two before version 0x101, three after. Known bits: 0x40 of the first means the part is
   * drawn as 16 × 16 tiles, like a wall; 0x10 of the second mirrors it left to right and 0x20 upside down.
   */
  flags: number[];
  /** The two state values. In TIM 1 and Even More the first is the frame the part shows. */
  state: [number, number];
  size: Size;
  /** A second size that often equals the first. What sets it apart isn't known; drawing uses the first. */
  size2: Size;
  /** Where the part stands, in pixels of the original game. */
  position: Point;
  /** One more value whose meaning depends on the part; for a rope it seems to be a length. */
  extra: number;
  belt: {
    /** Where on the part a belt runs around, as two bytes. */
    at: Point;
    width: number;
    /** For a belt, the two parts it runs around, by their index in the level. */
    parts?: [number | null, number | null];
  };
  ropes: [RopeSlot, RopeSlot];
  /** Parts this one is tied to by a rope or a belt, by index. */
  links: [number | null, number | null];
  /** The parts plugged into this one, from version 0x101. */
  plugs?: [number | null, number | null];
  /** For a pulley, the rope or part that runs over it. */
  pulley?: number | null;
  /** For a Toons tunnel, the tunnel it leads to. */
  tunnel?: number | null;
  /** Toons stores one byte (from version 0x106) and one word more per part. Their meaning isn't known. */
  toons?: { byte?: number; word: number };
  /**
   * Files before version 0x102 store points after each part, as a byte for x and a byte for y. They trace the part's
   * outline, like the eight corners of a ball. The TIM 1 program reads them and doesn't keep them.
   */
  outline?: Point[];
  /** Where the part's bytes are in the file. */
  offset: number;
  /** How many bytes the part takes. */
  length: number;
}

export interface Level {
  layout: LevelLayout;
  kind: LevelKind;
  magic: number;
  version: number;
  /** The puzzle's title, for puzzles. */
  title?: string;
  /** What the player has to do. Puzzles have one, and freeform files from version 0x105 have an empty one. */
  goal?: string;
  /**
   * The two bonus counters of a puzzle. The program shows them on the panel, counts them down while the machine runs
   * and adds them up as the total bonus when the puzzle is solved.
   */
  bonus?: [number, number];
  airPressure: number;
  gravity: number;
  /**
   * How far the view of a puzzle scrolls right and down, in pixels. The view starts at -8, -8 and scrolls 16 pixels
   * when the pointer touches the screen's edge, up to these. -8 means it doesn't scroll that way.
   */
  scroll?: [number, number];
  /** The number of the music the level plays. Which song each number is isn't known yet. */
  music: number;
  /** From version 0x105, a word before the parts bin. */
  binFlag?: number;
  parts: LevelPart[];
  /** Every header field, with where it is, for showing the bytes. */
  fields: LevelField[];
  length: number;
}

export class LevelError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(offset ? `${message} (at byte ${offset})` : message);
    this.offset = offset;
  }
}

export const LEVEL_MAGIC = [0xaced, 0xacee];
/** TIM 2 levels start with this magic. Their layout is different and isn't read yet. */
export const TIM2_LEVEL_MAGIC = 0xacef;
/** The pulley's number in TIM 1 and Even More, and in Toons. Only pulleys store the extra word. */
const PULLEY = { tim: 7, toons: 17 } as const;
const TOONS_TUNNEL = 46;
const NONE = 0xffff;
const MAX_PARTS = 2000;

class Reader {
  offset = 0;
  readonly data: Uint8Array;
  readonly view: DataView;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  need(size: number) {
    if (this.offset + size > this.data.length) throw new LevelError("The file ends too early", this.offset);
  }

  u8() {
    this.need(1);
    return this.data[this.offset++]!;
  }

  u16() {
    this.need(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i16() {
    this.need(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  index() {
    const value = this.u16();
    return value === NONE ? null : value;
  }

  /** A text that ends with a zero byte. The games store their own code page; Latin-1 is close enough to show it. */
  text() {
    const end = this.data.indexOf(0, this.offset);
    if (end < 0) throw new LevelError("A text has no end", this.offset);
    const value = String.fromCharCode(...this.data.subarray(this.offset, end));
    this.offset = end + 1;
    return value;
  }
}

function readPart(r: Reader, index: number, group: PartGroup, version: number, layout: LevelLayout): LevelPart {
  const offset = r.offset;
  const type = r.u16();
  const flags = [r.u16(), r.u16()];
  if (version > 0x100) flags.push(r.u16());
  const state: [number, number] = [r.i16(), r.i16()];
  const size = { width: r.u16(), height: r.u16() };
  const size2 = { width: r.u16(), height: r.u16() };
  const position = { x: r.i16(), y: r.i16() };
  const extra = r.i16();

  const hasBelt = r.u16() !== 0;
  const beltAt = { x: r.u8(), y: r.u8() };
  const belt: LevelPart["belt"] = { at: beltAt, width: r.u16() };
  if (hasBelt) belt.parts = [r.index(), r.index()];

  const rope = (): RopeSlot => {
    const has = r.u16() !== 0;
    const slot: RopeSlot = { at: { x: r.u8(), y: r.u8() } };
    if (has) {
      const parts: [number | null, number | null] = [r.index(), r.index()];
      slot.rope = { parts, slots: [r.u8(), r.u8()] };
    }
    return slot;
  };
  const ropes: [RopeSlot, RopeSlot] = [rope(), rope()];
  const links: [number | null, number | null] = [r.index(), r.index()];

  const part: LevelPart = {
    index,
    group,
    type,
    flags,
    state,
    size,
    size2,
    position,
    extra,
    belt,
    ropes,
    links,
    offset,
    length: 0,
  };
  if (version > 0x100) part.plugs = [r.index(), r.index()];
  if (type === PULLEY[layout]) part.pulley = r.index();
  if (layout === "toons") {
    if (type === TOONS_TUNNEL) part.tunnel = r.index();
    part.toons = { word: 0 };
    if (version > 0x105) part.toons.byte = r.u8();
    part.toons.word = r.u16();
  } else if (version < 0x102) {
    const count = r.u16();
    part.outline = Array.from({ length: count }, () => ({ x: r.u8(), y: r.u8() }));
  }
  part.length = r.offset - offset;
  return part;
}

function readAs(data: Uint8Array, layout: LevelLayout, kind: LevelKind): Level {
  const r = new Reader(data);
  const fields: LevelField[] = [];
  const field = <T extends number | string>(key: string, read: () => T): T => {
    const offset = r.offset;
    const value = read();
    fields.push({ key, offset, size: r.offset - offset, value });
    return value;
  };

  const magic = field("magic", () => r.u16());
  if (magic === TIM2_LEVEL_MAGIC) throw new LevelError("TIM 2 levels have their own layout, which isn’t read yet", 0);
  if (!LEVEL_MAGIC.includes(magic)) throw new LevelError(`Not a level file: the magic is 0x${magic.toString(16)}`, 0);
  const version = field("version", () => r.u16());

  const level: Level = {
    layout,
    kind,
    magic,
    version,
    airPressure: 0,
    gravity: 0,
    music: 0,
    parts: [],
    fields,
    length: 0,
  };
  if (kind === "puzzle") {
    level.title = field("title", () => r.text());
    level.goal = field("goal", () => r.text());
    if (layout === "tim") level.bonus = [field("bonus.0", () => r.u16()), field("bonus.1", () => r.u16())];
  } else if (version >= 0x104) {
    level.goal = field("goal", () => r.text());
  }
  level.airPressure = field("airPressure", () => r.u16());
  level.gravity = field("gravity", () => r.u16());
  if (kind === "puzzle") level.scroll = [field("scroll.x", () => r.i16()), field("scroll.y", () => r.i16())];
  level.music = field("music", () => r.u16());
  const staticCount = field("static", () => r.u16());
  const movingCount = field("moving", () => r.u16());
  const binCount = layout === "tim" ? field("bin", () => r.u16()) : 0;
  if (staticCount + movingCount + binCount > MAX_PARTS) throw new LevelError("Too many parts", r.offset);

  const groups: [PartGroup, number][] = [
    ["static", staticCount],
    ["moving", movingCount],
  ];
  for (const [group, count] of groups)
    for (let i = 0; i < count; i++) level.parts.push(readPart(r, level.parts.length, group, version, layout));
  if (layout === "tim") {
    if (version >= 0x105) level.binFlag = field("binFlag", () => r.u16());
    for (let i = 0; i < binCount; i++) level.parts.push(readPart(r, level.parts.length, "bin", version, layout));
  }

  if (r.offset !== data.length)
    throw new LevelError(`The layout ends ${data.length - r.offset} bytes before the file does`, r.offset);
  level.length = data.length;
  return level;
}

/**
 * Reads a level or scene. Puzzles and freeform files differ only in their header, and nothing in the file says which
 * one it is, so both are tried, puzzles first except for `.GKC` scenes. The one that ends exactly at the last byte
 * is the answer.
 */
export function readLevel(
  data: Uint8Array,
  { layout = "tim", name = "" }: { layout?: LevelLayout; name?: string } = {},
) {
  const kinds: LevelKind[] = /\.GKC$/i.test(name) ? ["freeform", "puzzle"] : ["puzzle", "freeform"];
  let first: unknown;
  for (const kind of kinds) {
    try {
      return readAs(data, layout, kind);
    } catch (error) {
      if (!(error instanceof LevelError) || error.offset === 0) throw error;
      first ??= error;
    }
  }
  throw first;
}
