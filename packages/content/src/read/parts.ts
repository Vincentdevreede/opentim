/**
 * Builds a part list from the files of a game: for TIM 1 and Even More from the type table in `TIM.EXE`, for TIM 2
 * from `INFO.RES` and the `.ANM` animations. The extraction script writes the committed lists with these, and the lab
 * reads the files it loads with them.
 */

import type { Frame, Part, PartList } from "../model.ts";
import { NOT_IN_TIM1, TIM2_IDS, TIM_IDS } from "../part-ids.ts";
import { unpackLzexe } from "./lzexe.ts";
import { animationFrames, animationSheets, readAnimation, readPartNames } from "./tim2.ts";
import { RECORD_SIZE, findDataSegment, findTypeTable, readOffsets, readTypes, type ExeType } from "./type-table.ts";
import { sheetFrameSizes, type FrameSize } from "./behaviour-sheet-frames.ts";

export const GAMES = {
  tim1: { game: "The Incredible Machine", types: 58 },
  evenmore: { game: "Even More! The Incredible Machine", types: 66 },
  tim2: { game: "The Incredible Machine 2", types: 0 },
};
export type ListId = keyof typeof GAMES;

/** The number of sprites in a sheet, like `PART18`, or undefined when the game has no such sheet. */
export type SpriteCount = (sheet: string) => number | undefined;
/** The file of a sheet, like `PART18`, as it ships, or undefined when the game has no such sheet. */
export type SheetData = (sheet: string) => Uint8Array | undefined;

/** A record of the type table, as it is in the program. */
export interface TypeRecord {
  type: number;
  /** Where the record starts in the unpacked program image. */
  at: number;
  bytes: Uint8Array;
}

export interface ProgramParts {
  list: PartList;
  /** Every record of the table, also of the types that aren't parts. */
  records: TypeRecord[];
  /** Where the table starts in the unpacked program image. */
  table: number;
  dataSegment: number;
  /**
   * The size of each frame of a part's sheet, by type, as the game's frame list gets it when it loads the sheet. Only
   * when the sheets were given, and only for a sheet the game's loader reads the way the analysis proved.
   */
  sheetFrames?: Map<number, FrameSize[]>;
}

/**
 * The frames of a TIM 1 or Even More type, with every sprite checked against its sheet. A type without pieces shows
 * sprite N as frame N, on its one layer: at the position its record gives for the frame, or at the origin when the
 * sheet has a single sprite. The program draws the other types its own way, like walls from tiles, so they get none.
 */
function framesOf(
  type: number,
  exe: ExeType,
  sheet: string,
  sprites: number | undefined,
  image: Uint8Array,
  ds: number,
): Frame[] {
  if (!exe.frames.length) {
    if (!sprites || (!exe.offsets && sprites > 1)) return [];
    if (exe.layers[1] !== 0xff) throw new Error(`Type ${type} shows single sprites but has two layers`);
    const offsets: [number, number][] = exe.offsets ? readOffsets(image, ds, exe.offsets, sprites) : [[0, 0]];
    return offsets.map(([x, y], id) => ({ id, sprites: [{ sheet, sprite: id, x, y, layer: exe.layers[0] }] }));
  }
  return exe.frames.map((pieces, id) => ({
    id,
    sprites: pieces.flatMap((piece) =>
      piece.sprites.map(({ sprite, x, y }) => {
        if (sprites === undefined || sprite >= sprites)
          throw new Error(`Type ${type}, frame ${id} uses sprite ${sprite} of ${sheet}, which has ${sprites ?? 0}`);
        return { sheet, sprite, x, y, layer: piece.layer };
      }),
    ),
  }));
}

/**
 * Reads the parts of TIM 1 or Even More from `TIM.EXE`, packed as it ships, and the sprite counts of its sheets. With
 * the sheets' files, it also reads the frame sizes the game keeps for each part.
 */
export function readProgramParts(
  list: "tim1" | "evenmore",
  program: Uint8Array,
  spriteCount: SpriteCount,
  sheetData?: SheetData,
): ProgramParts {
  const counts = new Map<string, number | undefined>();
  const spritesIn = (sheet: string) => {
    if (!counts.has(sheet)) counts.set(sheet, spriteCount(sheet));
    return counts.get(sheet);
  };
  const image = unpackLzexe(program);
  const ds = findDataSegment(image);
  const { types } = GAMES[list];
  const table = findTypeTable(image, ds, types, (t) => spritesIn(`PART${t}`));
  const exeTypes = readTypes(image, ds, table, types);
  const parts = exeTypes.flatMap((exe, type): Part[] => {
    const id = TIM_IDS[type];
    if (!id || (list === "tim1" && NOT_IN_TIM1.has(type))) return [];
    const sheet = `PART${type}`;
    const sprites = spritesIn(sheet);
    return [
      {
        id,
        type,
        sheets: sprites === undefined ? [] : [sheet],
        frames: framesOf(type, exe, sheet, sprites, image, ds),
      },
    ];
  });
  const records = exeTypes.map(({ at }, type) => ({ type, at, bytes: image.slice(at, at + RECORD_SIZE) }));
  const result: ProgramParts = { list: { id: list, game: GAMES[list].game, parts }, records, table, dataSegment: ds };
  if (sheetData) {
    result.sheetFrames = new Map();
    for (const part of parts) {
      const data = sheetData(`PART${part.type}`);
      const sizes = data && sheetFrameSizes(data);
      if (sizes) result.sheetFrames.set(part.type, sizes);
    }
  }
  return result;
}

/**
 * Reads the parts of TIM 2 from its resources, by name. A part without an id in `part-ids.ts` stops the read, so a
 * committed list never gets one; with `keepUnknown`, it gets `part-<number>` instead, so a viewer can show it as new.
 */
export function readTim2Parts(
  resource: (name: string) => Uint8Array | undefined,
  { keepUnknown = false }: { keepUnknown?: boolean } = {},
): PartList {
  const info = resource("INFO.RES");
  if (!info) throw new Error("No INFO.RES, so not TIM 2");
  const parts = [...readPartNames(info)].map(([type, name]): Part => {
    const id = TIM2_IDS[type] ?? (keepUnknown ? `part-${type}` : undefined);
    if (!id) throw new Error(`TIM 2 part ${type} (${name}) has no id in part-ids.ts`);
    const anm = resource(`PART${type}.ANM`);
    const sheets = anm ? animationSheets(anm) : resource(`PART${type}.BMP`) ? [`PART${type}`] : [];
    const animation = anm ? readAnimation(anm) : undefined;
    const part: Part = {
      id,
      type,
      name,
      sheets: sheets.filter((s) => resource(`${s}.BMP`)),
      frames: animation ? animationFrames(animation) : [],
    };
    if (animation?.steps.length) part.states = animation.steps;
    if (animation) part.mirrorBox = { width: animation.width, height: animation.height };
    if (animation?.sequences.length)
      part.sequences = animation.sequences.map(({ sequence, step }) => ({ sequence, state: step }));
    return part;
  });
  return { id: "tim2", game: GAMES.tim2.game, parts };
}
