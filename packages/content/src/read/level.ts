/**
 * Reads the level files of The Incredible Machine, Even More, Sid & Al's Incredible Toons and The Incredible Machine
 * 2: the `.LEV` puzzles and the `.GKC` scenes, like the title screen. They are one format with small differences. A
 * file starts with a magic number and a version, then the header, then every part with where it stands and what it is
 * tied to.
 *
 * Every byte of a file is accounted for: a file reads only when the layout ends exactly at its last byte. Names of
 * fields whose meaning isn't known yet say so, and their values are kept as they are.
 */

/**
 * TIM 1, Even More and the Add-On Disk share one layout; Toons stores a few fields more and a few less. TIM 2 has its
 * own magic number, notes in the header and its goal after the parts.
 */
export type LevelLayout = "tim" | "toons" | "tim2";

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
  /**
   * The part's base size, which often equals the first size. The loader keeps it as the record's baseWidth and
   * baseHeight, which the contact code measures with; drawing uses the first size.
   */
  baseSize: Size;
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
  /** For TIM 2's programmable ball, from version 0x111: six words the game keeps with the ball. */
  program?: number[];
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
  /** Every field of the part, with where it is in the file, for showing the bytes. Keys follow the properties above. */
  fields: LevelField[];
}

/** A note a TIM 2 puzzle shows, like a hint on the screen. */
export interface LevelNote {
  x: number;
  y: number;
  /** A third word, from version 0x112. Its meaning isn't known. */
  z: number;
  text: string;
}

/**
 * One of the eight entries TIM 2 stores after the parts. The first names a part of the level, like the ball a puzzle
 * asks to knock off the screen, so they likely say the goal; what the other words mean isn't known yet.
 */
export interface LevelGoalEntry {
  part: number | null;
  values: number[];
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
  /**
   * From version 0x105, a word before the parts bin. The game's level reader reads the parts bin only when it isn't 0
   * or when it loads a puzzle, so a puzzle always gets its bin.
   */
  binFlag?: number;
  parts: LevelPart[];
  /** Every header field, with where it is, for showing the bytes. */
  fields: LevelField[];
  length: number;
  /** What only TIM 2 levels have. */
  tim2?: {
    /**
     * From version 0x113: a byte TIM2.EXE keeps and writes back when it saves the level, and uses for nothing else. 0 in
     * every shipped level.
     */
    spareByte?: number;
    /** From version 0x113: the palette colour TIM2.EXE fills the play area with, behind the parts. A new level has 3. */
    background?: number;
    /** The notes with a text, from version 0x110. The file has eight places for them. */
    notes: LevelNote[];
    /** Two words where TIM 1 keeps the scroll limits. TIM2.EXE reads them and sets them to 0. */
    ignored: [number, number];
    /** A third count after the static and moving parts. TIM2.EXE reads it and doesn't keep it. */
    spare: number;
    /** From version 0x107: a word, eight entries and a word after the parts. */
    goal?: { first: number; entries: LevelGoalEntry[]; last: number };
  };
}

export class LevelError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(offset ? `${message} (at byte ${offset})` : message);
    this.offset = offset;
  }
}

export const LEVEL_MAGIC = [0xaced, 0xacee];
/** TIM 2 levels start with this magic. */
export const TIM2_LEVEL_MAGIC = 0xacef;
/** The pulley's number in TIM 1, Even More and TIM 2, and in Toons. Only pulleys store the extra word. */
export const PULLEY = { tim: 7, toons: 17, tim2: 7 } as const;
/** TIM 2's programmable ball, which stores six words more. */
const PROGRAMMABLE_BALL = 87;
const TOONS_TUNNEL = 46;
const NONE = 0xffff;
const MAX_PARTS = 2000;
const nullable = (value: number) => (value === NONE ? null : value);

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
  const fields: LevelField[] = [];
  const field = <T extends number | string>(key: string, read: () => T): T => {
    const at = r.offset;
    const value = read();
    fields.push({ key, offset: at, size: r.offset - at, value });
    return value;
  };
  const point = (key: string): Point => ({ x: field(`${key}.x`, () => r.u8()), y: field(`${key}.y`, () => r.u8()) });
  /** Two links to parts by index, stored as FFFF when there is none. */
  const index2 = (key: string): [number | null, number | null] => [
    nullable(field(`${key}.0`, () => r.u16())),
    nullable(field(`${key}.1`, () => r.u16())),
  ];

  const type = field("type", () => r.u16());
  const flags = [field("flags.0", () => r.u16()), field("flags.1", () => r.u16())];
  if (version > 0x100) flags.push(field("flags.2", () => r.u16()));
  const state: [number, number] = [field("state.0", () => r.i16()), field("state.1", () => r.i16())];
  const size = { width: field("size.width", () => r.u16()), height: field("size.height", () => r.u16()) };
  const baseSize = {
    width: field("baseSize.width", () => r.u16()),
    height: field("baseSize.height", () => r.u16()),
  };
  const position = { x: field("position.x", () => r.i16()), y: field("position.y", () => r.i16()) };
  const extra = field("extra", () => r.i16());

  const hasBelt = field("belt", () => r.u16()) !== 0;
  const beltAt = point("belt.at");
  const belt: LevelPart["belt"] = { at: beltAt, width: field("belt.width", () => r.u16()) };
  if (hasBelt) belt.parts = index2("belt.parts");

  const rope = (n: number): RopeSlot => {
    const has = field(`ropes.${n}`, () => r.u16()) !== 0;
    const slot: RopeSlot = { at: point(`ropes.${n}.at`) };
    if (has) {
      const parts = index2(`ropes.${n}.parts`);
      slot.rope = {
        parts,
        slots: [field(`ropes.${n}.slots.0`, () => r.u8()), field(`ropes.${n}.slots.1`, () => r.u8())],
      };
    }
    return slot;
  };
  const ropes: [RopeSlot, RopeSlot] = [rope(0), rope(1)];
  const links = index2("links");

  const part: LevelPart = {
    index,
    group,
    type,
    flags,
    state,
    size,
    baseSize,
    position,
    extra,
    belt,
    ropes,
    links,
    offset,
    length: 0,
    fields,
  };
  if (version > 0x100) part.plugs = index2("plugs");
  if (type === PULLEY[layout]) part.pulley = nullable(field("pulley", () => r.u16()));
  if (layout === "tim2" && type === PROGRAMMABLE_BALL && version >= 0x111)
    part.program = Array.from({ length: 6 }, (_, i) => field(`program.${i}`, () => r.i16()));
  if (layout === "toons") {
    if (type === TOONS_TUNNEL) part.tunnel = nullable(field("tunnel", () => r.u16()));
    part.toons = { word: 0 };
    if (version > 0x105) part.toons.byte = field("toons.byte", () => r.u8());
    part.toons.word = field("toons.word", () => r.u16());
  } else if (version < 0x102) {
    const count = field("outline", () => r.u16());
    part.outline = Array.from({ length: count }, (_, i) => point(`outline.${i}`));
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
 * Reads a TIM 2 level as TIM2.EXE's loader does. Every TIM 2 level is a puzzle with a title and a goal; the header
 * then has eight notes, and the parts are followed by eight entries that likely say the goal.
 */
function readTim2(data: Uint8Array): Level {
  const r = new Reader(data);
  const fields: LevelField[] = [];
  const field = <T extends number | string>(key: string, read: () => T): T => {
    const offset = r.offset;
    const value = read();
    fields.push({ key, offset, size: r.offset - offset, value });
    return value;
  };
  const magic = field("magic", () => r.u16());
  const version = field("version", () => r.u16());
  const bytes: [number, number] | undefined =
    version >= 0x113 ? [field("spareByte", () => r.u8()), field("background", () => r.u8())] : undefined;
  const title = field("title", () => r.text());
  const goal = field("goal", () => r.text());
  const notes: LevelNote[] = [];
  const readNotes = () => {
    field("notes", () => r.u16());
    for (let i = 0; i < 8; i++) {
      const x = field(`notes.${i}.x`, () => r.i16());
      const y = field(`notes.${i}.y`, () => r.i16());
      const z = version >= 0x112 ? field(`notes.${i}.z`, () => r.i16()) : 0;
      const text = field(`notes.${i}.text`, () => r.text());
      if (text) notes.push({ x, y, z, text });
    }
  };
  if (version >= 0x110) readNotes();
  const level: Level = {
    layout: "tim2",
    kind: "puzzle",
    magic,
    version,
    title,
    goal,
    airPressure: field("airPressure", () => r.i16()),
    gravity: field("gravity", () => r.i16()),
    music: 0,
    parts: [],
    fields,
    length: 0,
    tim2: { notes, ignored: [field("ignored.0", () => r.i16()), field("ignored.1", () => r.i16())], spare: 0 },
  };
  if (bytes) [level.tim2!.spareByte, level.tim2!.background] = bytes;
  level.music = field("music", () => r.i16());
  const staticCount = field("static", () => r.u16());
  const movingCount = field("moving", () => r.u16());
  level.tim2!.spare = field("spare", () => r.u16());
  if (staticCount + movingCount > MAX_PARTS) throw new LevelError("Too many parts", r.offset);
  const groups: [PartGroup, number][] = [
    ["static", staticCount],
    ["moving", movingCount],
  ];
  for (const [group, count] of groups)
    for (let i = 0; i < count; i++) level.parts.push(readPart(r, level.parts.length, group, version, "tim2"));
  if (version >= 0x107) {
    const first = field("goal.first", () => r.u16());
    const entries = Array.from({ length: 8 }, (_, i): LevelGoalEntry => {
      const part = nullable(field(`goal.${i}.part`, () => r.u16()));
      const count = version > 0x109 ? 7 : 6;
      return { part, values: Array.from({ length: count }, (_, k) => field(`goal.${i}.${k}`, () => r.i16())) };
    });
    level.tim2!.goal = { first, entries, last: field("goal.last", () => r.u16()) };
  }
  // Versions 0x108 and 0x109 keep the notes here instead.
  if (version >= 0x108 && version <= 0x109) readNotes();
  if (r.offset !== data.length)
    throw new LevelError(`The layout ends ${data.length - r.offset} bytes before the file does`, r.offset);
  level.length = data.length;
  return level;
}

/**
 * Reads a level or scene. A TIM 2 level is known by its magic number and read in its own layout, whatever `layout`
 * says. Puzzles and freeform files differ only in their header, and nothing in the file says which one it is, so both
 * are tried, puzzles first except for `.GKC` scenes. The one that ends exactly at the last byte is the answer.
 */
export function readLevel(
  data: Uint8Array,
  { layout = "tim", name = "" }: { layout?: LevelLayout; name?: string } = {},
) {
  if (data.length >= 2 && (data[0]! | (data[1]! << 8)) === TIM2_LEVEL_MAGIC) return readTim2(data);
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
