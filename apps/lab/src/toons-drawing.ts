/**
 * The drawing code TOONS.EXE has for some types of its own, followed for the Levels page: the conveyor belt, the timer,
 * the counter, the thumpulator and the message machine. Each gives the sprites (and, for the message machine's letter,
 * the pixels) relative to the part's position, already mirrored where the program mirrors them.
 */
import { glyphOf, glyphPixel, type Font } from "@opentim/resources";
import type { LevelPart, Placement, Shape, SpriteOf, ToonsDrawing } from "@opentim/content";

export interface ToonsPicture {
  sprites: Placement[];
  shapes?: Shape[];
  detail: string;
}

const CONVEYOR = 0;
const TIMER = 38;
const COUNTER = 39;
const THUMPULATOR = 40;
const MESSAGE_MACHINE = 42;
const TILE = 16;
const MIRROR_X = 0x10;
const MIRROR_Y = 0x20;
/** The timer shows sprite 12, or 13 when it is mirrored (TOONS.EXE's timer routine swaps them). */
const TIMER_SPRITES = [12, 13];
/** The counter's two lights, sprites 21 and 22, at these places; counting down swaps them. */
const COUNTER_LIGHTS: [number, number][] = [
  [21, 9],
  [66, 12],
];
const COUNTING_DOWN = 0x4000;
/** The thumpulator's sections start 17 pixels down and each takes 65. */
const SECTION_TOP = 17;
const SECTION = 65;
/** The message machine's text is centred on this place, in the font the game loads as `tuxedo.fnt`. */
export const MESSAGE_FONT = "TUXEDO.FNT";
const MESSAGE_CENTRE = { x: 26, y: 30 };
/** The colours the text draws its letters in, in turn by the letter and its place, and the background it avoids. */
const MESSAGE_COLOURS = [4, 10, 14, 15, 12];
const MESSAGE_BACKGROUND = 12;
const OUTLINE = 0;
/** Where TOONS.EXE starts the view, which the colour of the message machine's letters depends on. */
const VIEW = { x: -91, y: -8 };

const frameSprites = (frames: readonly { id: number; sprites: Placement[] }[], id: number) =>
  frames.find((f) => f.id === id)?.sprites ?? [];

/** Mirrors placements inside the part's width (and height), as the generic drawing code does. */
function mirrored(sprites: readonly Placement[], part: LevelPart, spriteOf: SpriteOf): Placement[] {
  const x = ((part.flags[1] ?? 0) & MIRROR_X) !== 0;
  const y = ((part.flags[1] ?? 0) & MIRROR_Y) !== 0;
  if (!x && !y) return [...sprites];
  return sprites.map((p) => {
    const image = spriteOf(p.sheet, p.sprite);
    if (!image) return p;
    const flip = `${x ? "h" : ""}${y ? "v" : ""}` as Placement["flip"];
    return {
      ...p,
      x: x ? part.size.width - p.x - image.width : p.x,
      y: y ? part.size.height - p.y - image.height : p.y,
      flip,
    };
  });
}

/**
 * The conveyor belt: a row of 16-pixel tiles of its sheet, the first, the last and the ones between picked by its
 * state. Between, sprite 4 takes turns with 5, and sprite 6 moves 1 pixel down every other tile; the last tile keeps
 * the place of the tile before it.
 */
function conveyor(part: LevelPart, sheet: string, layer: number, tables: NonNullable<ToonsDrawing["conveyor"]>) {
  const state = part.state[0];
  const count = part.size.width >> 4;
  const out: Placement[] = [];
  let turn = 0;
  let down = 0;
  for (let i = 0; i < count; i++) {
    let sprite: number;
    if (i === 0) sprite = tables.first[state] ?? 0;
    else if (i === count - 1) sprite = tables.last[state] ?? 0;
    else {
      sprite = tables.middle[state] ?? 0;
      if (sprite === 4 && turn % 2) sprite = 5;
      down = sprite === 6 && turn % 2 ? 1 : 0;
      turn++;
    }
    out.push({ sheet, sprite, x: i * TILE, y: down, layer });
  }
  return out;
}

/** The counter's frame, then its lights and its two digits over it, which aren't mirrored. */
function counter(part: LevelPart, frame: Placement[], sheet: string, layer: number, places: ToonsDrawing["counter"]) {
  const value = (part.setting ?? 0) & ~COUNTING_DOWN;
  const down = ((part.setting ?? 0) & COUNTING_DOWN) !== 0;
  const lights = COUNTER_LIGHTS.map(([x, y], k): Placement => ({
    sheet,
    sprite: 21 + (down ? k : 1 - k),
    x,
    y,
    layer,
  }));
  const digit = (d: number, table: [number, number][]): Placement => {
    const [x, y] = table[d] ?? [0, 0];
    return { sheet, sprite: d, x: x + 1, y, layer };
  };
  return [
    ...frame,
    ...lights,
    ...(places ? [digit(value % 10, places.ones), digit(Math.floor(value / 10) % 10, places.tens)] : []),
  ];
}

/**
 * The thumpulator, from its setting: a top piece (sprite 0, or 1 five pixels lower with bit 0x100), a section for each
 * of the setting's bits 4 to 7, each its frame 0 (or, for the section bits 0 to 3 name, the frame of bits 10 to 12)
 * with one of three pieces in turn, and a bottom piece (sprite 7, or 6 with bit 0x200). Mirrored across, each piece in
 * the part's width.
 */
function thumpulator(
  part: LevelPart,
  frames: readonly { id: number; sprites: Placement[] }[],
  sheet: string,
  layer: number,
  table: NonNullable<ToonsDrawing["thumpulator"]>,
  spriteOf: SpriteOf,
): Placement[] {
  const setting = part.setting ?? 0;
  const active = setting & 0xf;
  const sections = (setting >> 4) & 0xf;
  const lower = (setting >> 8) & 1;
  const bottom = (setting >> 9) & 1;
  const shown = (setting >> 10) & 7;
  const across = ((part.flags[1] ?? 0) & MIRROR_X) !== 0;
  const at = (sprite: number, x: number, y: number): Placement => {
    const width = spriteOf(sheet, sprite)?.width ?? 0;
    return { sheet, sprite, x: across ? part.size.width - x - width : x, y, layer, ...(across ? { flip: "h" } : {}) };
  };
  const out: Placement[] = [at(lower, 0, lower ? 5 : 0)];
  for (let k = 0; k < sections; k++) {
    const top = SECTION_TOP + k * SECTION;
    const frame = k === active ? shown : 0;
    for (const p of frameSprites(frames, frame)) {
      const width = spriteOf(p.sheet, p.sprite)?.width ?? 0;
      out.push({
        ...p,
        x: across ? part.size.width - p.x - width : p.x,
        y: top + p.y,
        ...(across ? { flip: "h" } : {}),
      });
    }
    const piece = table.pieces[k % table.pieces.length]!;
    out.push(at(piece.sprite, piece.x + (table.shift[frame] ?? 0), top + piece.y));
  }
  out.push(at(7 - bottom, lower ? 19 : 21, SECTION_TOP + sections * SECTION));
  return out;
}

/** A glyph's pixels as boxes one pixel high, at x, y in one colour. */
function glyphBoxes(font: Font, char: number, x: number, y: number, colour: number, after: number): Shape[] {
  const glyph = glyphOf(font, char);
  if (!glyph) return [];
  const out: Shape[] = [];
  for (let row = 0; row < font.height; row++)
    for (let column = 0; column < glyph.width; column++) {
      if (!glyphPixel(glyph, column, row)) continue;
      let end = column;
      while (end + 1 < glyph.width && glyphPixel(glyph, end + 1, row)) end++;
      out.push({
        kind: "box",
        x: x + column,
        y: y + row,
        width: end - column + 1,
        height: 1,
        colour,
        fill: colour,
        after,
      });
      column = end;
    }
  return out;
}

/**
 * The message machine's text: its setting as characters up to a 0 byte, centred on the machine. Each letter is drawn
 * outlined in black, with a shadow 2 pixels left and down, in a colour picked by the letter and its place on the screen.
 */
function message(part: LevelPart, font: Font, after: number): Shape[] {
  const setting = part.setting ?? 0;
  const bytes = [setting & 0xff, setting >> 8];
  const end = bytes.indexOf(0);
  const chars = end < 0 ? bytes : bytes.slice(0, end);
  const width = chars.reduce((w, c) => w + (glyphOf(font, c)?.width ?? 0), 0);
  let x = MESSAGE_CENTRE.x - Math.floor(width / 2);
  const y = MESSAGE_CENTRE.y - Math.floor(font.height / 2);
  const out: Shape[] = [];
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, 1],
    [0, -1],
    [-2, 2],
  ] as const) {
    let at = x;
    for (const c of chars) {
      out.push(...glyphBoxes(font, c, at + dx, y + dy, OUTLINE, after));
      at += glyphOf(font, c)?.width ?? 0;
    }
  }
  let previous = -1;
  for (const c of chars) {
    // The program picks the colour from the letter and where it is on the screen, skipping the background colour
    // and the colour of the letter before.
    const screenX = (part.position.x - VIEW.x + x) & 0xffff;
    const screenY = (part.position.y - VIEW.y + y) & 0xffff;
    let k = (c ^ screenX ^ screenY) % MESSAGE_COLOURS.length;
    while (k === previous || MESSAGE_COLOURS[k] === MESSAGE_BACKGROUND) k = (k + 1) % MESSAGE_COLOURS.length;
    previous = k;
    out.push(...glyphBoxes(font, c, x, y, MESSAGE_COLOURS[k]!, after));
    x += glyphOf(font, c)?.width ?? 0;
  }
  return out;
}

/**
 * A Toons part drawn by the drawing code of its type, or undefined for a type drawn from its frames, or when what the
 * code needs (its tables, or the message machine's font) isn't there.
 */
export function toonsPicture(
  part: LevelPart,
  frames: readonly { id: number; sprites: Placement[] }[],
  sheet: string,
  drawing: ToonsDrawing,
  spriteOf: SpriteOf,
  font?: Font,
): ToonsPicture | undefined {
  const frame = frameSprites(frames, part.state[0]);
  const layer = frame[0]?.layer ?? frames.find((f) => f.sprites.length)?.sprites[0]?.layer ?? 0;
  const at = (offset: number | undefined) => (offset === undefined ? "" : ` at 0x${offset.toString(16)}`);
  const by = (type: number) => `by TOONS.EXE’s routine${at(drawing.routines.get(type))}`;
  switch (part.type) {
    case CONVEYOR:
      if (!drawing.conveyor) return undefined;
      return {
        sprites: conveyor(part, sheet, layer, drawing.conveyor),
        detail: `tiles of a conveyor belt, ${by(CONVEYOR)}`,
      };
    case TIMER: {
      const flipped = ((part.flags[1] ?? 0) & MIRROR_X) !== 0;
      const swapped = frame.map((p) =>
        TIMER_SPRITES.includes(p.sprite) ? { ...p, sprite: TIMER_SPRITES[flipped ? 1 : 0]! } : p,
      );
      return { sprites: mirrored(swapped, part, spriteOf), detail: `frame ${part.state[0]}, ${by(TIMER)}` };
    }
    case COUNTER:
      return {
        sprites: counter(part, mirrored(frame, part, spriteOf), sheet, layer, drawing.counter),
        detail: `frame ${part.state[0]} with its count, ${by(COUNTER)}`,
      };
    case THUMPULATOR:
      if (!drawing.thumpulator) return undefined;
      return {
        sprites: thumpulator(part, frames, sheet, layer, drawing.thumpulator, spriteOf),
        detail: `sections from its setting, ${by(THUMPULATOR)}`,
      };
    case MESSAGE_MACHINE: {
      if (!font) return undefined;
      const base: Placement = { sheet, sprite: 0, x: 0, y: 0, layer };
      return {
        sprites: [base, ...mirrored(frame, part, spriteOf)],
        shapes: message(part, font, 1),
        detail: `frame ${part.state[0]} over its letter, ${by(MESSAGE_MACHINE)}`,
      };
    }
  }
  return undefined;
}
