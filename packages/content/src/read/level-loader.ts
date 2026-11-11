/**
 * Where the game's puzzle loader puts the fields of a level file, as `scripts/check-level-fields.ts` found by loading
 * every shipped puzzle of the two recorded builds in the emulator (see "What the loader keeps" in `docs/levels.md`).
 * TIM 1 and Even More only: Toons and TIM 2 have their own loaders, which aren't read.
 */

/** The SHA-256 of the `TIM.EXE` of Even More, English floppy. */
export const EVEN_MORE_FLOPPY_EXE = "b11cf18e51a14dbcee9872ec2a524caec4e5f656c8612c3a4c7de16c79bd9fa9";
/** The SHA-256 of the `TIM.EXE` of The Incredible Machine, French. */
export const TIM_FRENCH_EXE = "4a54cc37f477dde0f22d887e9930fbc384936cf089faa3343b27cac8aecd82d6";

/** Where a field of a placed part goes in the part record the loader makes for it. */
export interface LoadedPlace {
  /** The record's words (or bytes) that hold the field, one per value the field has, in the field's order. */
  at: number[];
  /** True when each value is a byte rather than a word. */
  bytes?: true;
  /** Further words that hold the same values, like the saved copy of a word. */
  also?: number[];
  /** For a field that names parts kept in a record of their own: the word that points at it, and where in it. */
  through?: { word: number; at: number[] };
  /** The names the analysis gives the words, when it has them. */
  names?: string[];
  /** True when the loader doesn't keep the field as such. */
  notKept?: true;
  /** What else holds, in a few words. */
  note?: string;
}

/** The fields of a placed part, by the keys `LevelPart` names them with. */
export type LoadedKey =
  | "type"
  | "flags"
  | "state"
  | "size"
  | "baseSize"
  | "position"
  | "extra"
  | "beltPlace"
  | "beltParts"
  | "ropeSlot.0"
  | "ropeSlot.1"
  | "rope"
  | "links"
  | "plugs"
  | "pulley";

export const LOADED_FIELDS: Record<LoadedKey, LoadedPlace> = {
  type: { at: [0x04], names: ["type"] },
  flags: {
    at: [0x06, 0x08, 0x0a],
    also: [0x94],
    names: ["listFlags", "drawingFlags", "third flags"],
    note: "the second also in savedDrawingFlags 0x94; in Even More 0x0a has the goal marks too, and 10 of 4,448 parts differ there",
  },
  state: {
    at: [0x90],
    names: ["savedState"],
    note: "the first value; the second is 0 in every shipped part. A bin part's is also at 0x0c",
  },
  size: { at: [0x40, 0x42], also: [0x44, 0x46], note: "the extents, and again the frame size at 0x44, 0x46" },
  baseSize: { at: [0x50, 0x52], names: ["baseWidth", "baseHeight"] },
  position: {
    at: [0x8c, 0x8e],
    names: ["savedPositionX", "savedPositionY"],
    note: "the run starts from the saved place",
  },
  extra: { at: [0x96] },
  beltPlace: { at: [0x56, 0x57], bytes: true, also: [0x58], note: "the width in the word 0x58" },
  beltParts: {
    at: [],
    through: { word: 0x54, at: [4, 6] },
    note: "the belt record, which has the belt itself at +2; all three parts point at it",
  },
  "ropeSlot.0": { at: [0x6a, 0x6b], bytes: true },
  "ropeSlot.1": { at: [0x6c, 0x6d], bytes: true },
  rope: {
    at: [],
    through: { word: 0x66, at: [2, 4] },
    note: "the rope record, which has the rope itself at +0 and the two parts again at +6, +8; the tied parts point at it. Only the first slot's rope is known: the second is empty in every shipped part",
  },
  links: {
    at: [0x5a, 0x5c],
    also: [0x5e, 0x60],
    names: ["rope links"],
    note: "as the linked part's record, again at 0x5e, 0x60. A gear's link to a gear stays 0: a gear finds its neighbours by their places",
  },
  plugs: { at: [0x62, 0x64], note: "as the plugged part's record, 0 for none" },
  pulley: {
    at: [],
    notKept: true,
    note: "the pulley's links hold the two parts the rope ties instead, and theirs hold the pulley",
  },
};

/** The type of the gear, whose links to other gears the loader leaves 0, in TIM 1 and Even More. */
export const GEAR_TYPE = 14;

/** The words of the data segment the loader puts the header's numbers in, for a build it was checked on. */
export interface LoadedHeader {
  build: string;
  /** By the header field's key, as `Level.fields` names it. */
  words: Record<string, number>;
  /** Keys whose word is only where the block's order puts it: the play screen sets those words itself. */
  byOrder: string[];
}

const SCROLL = ["scroll.x", "scroll.y"];

/** The header's words, by the SHA-256 of the build's `TIM.EXE`. */
export const LOADED_HEADERS = new Map<string, LoadedHeader>([
  [
    EVEN_MORE_FLOPPY_EXE,
    {
      build: "Even More, English floppy",
      words: {
        "bonus.0": 0x4cb3,
        "bonus.1": 0x4cb5,
        airPressure: 0x4cb7,
        gravity: 0x4cb9,
        "scroll.x": 0x4cbb,
        "scroll.y": 0x4cbd,
        music: 0x4cbf,
        binFlag: 0x4a67,
      },
      byOrder: SCROLL,
    },
  ],
  [
    TIM_FRENCH_EXE,
    {
      build: "The Incredible Machine, French",
      words: {
        "bonus.0": 0x522f,
        "bonus.1": 0x5231,
        airPressure: 0x5233,
        gravity: 0x5235,
        "scroll.x": 0x5237,
        "scroll.y": 0x5239,
        music: 0x523b,
      },
      byOrder: SCROLL,
    },
  ],
]);
