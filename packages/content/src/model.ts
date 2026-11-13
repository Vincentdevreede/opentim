/**
 * The parts of a game and how their states are put together from sprite frames. See `docs/research/content.md` for the
 * design: lists never name files, palettes or archives, only sheets, so a graphics pack can replace the images.
 */

export interface PartList {
  /** The list's id, like `tim1`. The version catalog links each version of a game to one. */
  id: string;
  /** The game the list describes, for display. */
  game: string;
  parts: Part[];
}

export interface Part {
  /**
   * A short English name in lowercase with hyphens, like `bowling-ball`. It names the object, not its number: the
   * same object has the same id in every list, and an id never changes once published.
   */
  id: string;
  /** The number the original game uses for the part, in its levels and sheet names. */
  type: number;
  /**
   * The game's own English name, when a part is read from files that name it (TIM 2's `INFO.RES`). The committed lists
   * leave it out: `names.json` holds the names, by id, for every list.
   */
  name?: string;
  /** The sprite sheets the part's sprites come from, like `PART18`. Empty for parts drawn as lines, like the belt. */
  sheets: string[];
  /**
   * What the part can look like, each a picture put together from sprites, as the original program does it. Empty
   * when the program draws the part some other way or the list doesn't know yet; a viewer can then show the sprites
   * of its sheets. In TIM 1 and Even More, the game's state N shows frame N.
   */
  frames: Frame[];
  /**
   * The frame each of the game's states shows, when state N doesn't show frame N. TIM 2's animations have such a list:
   * a level saves a state, and the state picks the frame.
   */
  states?: number[];
  /**
   * TIM 2's animations in the game's order: each sequence starts at a state and runs until the next one starts. The
   * program asks for a sequence by its number.
   */
  sequences?: { sequence: number; state: number }[];
  /** The size TIM 2 mirrors a whole frame in: the game measures a mirrored sprite's place from its far side. */
  mirrorBox?: { width: number; height: number };
  /** Values from the original program whose meaning isn't known yet, by where they were found. Never used for drawing. */
  raw?: Record<string, number>;
}

/** What a part looks like at one moment: sprites placed together. */
export interface Frame {
  /** The frame's number in the original game. */
  id: number;
  sprites: Placement[];
  /** Boxes and lines the frame draws too, like the fishing line of TIM 2's fish tank. */
  shapes?: Shape[];
}

/**
 * A box or a line in a frame, in units relative to the part's origin, with colours as indexes of the game's palette.
 * `after` is how many of the frame's sprites the game draws before it.
 */
export type Shape =
  /** A box: its outline in `colour`, filled with `fill` when it has one. */
  | { kind: "box"; x: number; y: number; width: number; height: number; colour: number; fill?: number; after: number }
  /** A line between two points, both drawn. */
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; colour: number; after: number };

/** A sprite put in a frame. */
export interface Placement {
  /** A sprite sheet of the part, like `PART18`. */
  sheet: string;
  /** The sprite's number in its sheet. */
  sprite: number;
  /** Units relative to the part's origin. One unit is one pixel of the original game. */
  x: number;
  y: number;
  /** The layer from the original program. Which layers are drawn on top isn't known yet. */
  layer: number;
  flip?: "h" | "v" | "hv";
}
