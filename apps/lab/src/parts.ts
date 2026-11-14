/** The parts of the loaded version, read from its files, for the Sprites page. */

import {
  partNamesOf,
  readProgramParts,
  readTim2Parts,
  readToonsParts,
  type Part,
  type PartList,
  type ProgramParts,
  type TypeRecord,
} from "@opentim/content";
import type { Edition } from "./edition.ts";
import type { Resource } from "./importer.ts";
import { decode } from "./sprites.ts";

/** The id of the part list of a recognised version, like `tim1`, if the catalog links it to one. */
export const listIdOf = (edition?: Edition) => (edition?.status === "recognized" ? edition.profile.parts : undefined);

export interface LoadedParts {
  list: PartList;
  /** Where the parts come from: the game's program, or for TIM 2 its resources. */
  source: "program" | "resources";
  /** The records of the program's type table, by part number, when read from the program. */
  records: Map<number, TypeRecord>;
  /** Everything read from the program, which the behaviour analysis starts from. */
  program?: ProgramParts;
  /** The numbers of the parts OpenTIM has no id for yet, which the list calls `part-` and the number. */
  unknown: number[];
  problem?: never;
}

/** Why the parts of the loaded files couldn't be read. */
export interface PartsProblem {
  problem: string;
  list?: never;
  source?: never;
  records?: never;
  program?: never;
  unknown?: never;
}

/** The numbers of the parts the reader kept without an id of their own. */
const unknownParts = (list: PartList) =>
  list.parts
    .filter((p) => p.id === `part-${p.type}`)
    .map((p) => p.type)
    .sort((a, b) => a - b);

/**
 * Reads the parts of the loaded files: TIM 1, Even More and Toons from their program, TIM 2 from `INFO.RES` and its
 * animations. When they can't be read, it says why. Undefined for a version without a parts reader.
 */
export function readLoadedParts(
  listId: string | undefined,
  resources: readonly Resource[],
  program: { name: string; data: Uint8Array },
): LoadedParts | PartsProblem | undefined {
  const byName = new Map(resources.map((r) => [r.name, r]));
  const spriteCount = (sheet: string) => {
    const r = byName.get(sheetFile(sheet));
    const d = r && decode(r);
    return d?.status === "decoded" ? d.image.frames.length : undefined;
  };
  const from = (name: string) =>
    program.name === name ? undefined : { problem: `This game’s parts are read from ${name}, not ${program.name}.` };
  try {
    if (listId === "tim1" || listId === "evenmore") {
      const wrong = from("TIM.EXE");
      if (wrong) return wrong;
      const read = readProgramParts(listId, program.data, spriteCount, (sheet) => byName.get(sheetFile(sheet))?.data);
      return {
        list: read.list,
        source: "program",
        records: new Map(read.records.map((r) => [r.type, r])),
        program: read,
        unknown: unknownParts(read.list),
      };
    }
    if (listId === "toons") {
      const wrong = from("TOONS.EXE");
      if (wrong) return wrong;
      // No behaviour read: it knows TIM.EXE only, so the records are shown without `program`.
      const read = readToonsParts(program.data, spriteCount, { keepUnknown: true });
      return {
        list: read.list,
        source: "program",
        records: new Map(read.records.map((r) => [r.type, r])),
        unknown: unknownParts(read.list),
      };
    }
    if (listId === "tim2") {
      if (!byName.has("INFO.RES")) return { problem: "INFO.RES isn’t in the loaded files." };
      // A part OpenTIM has no id for yet is kept, so it shows as unknown.
      const list = readTim2Parts((name) => byName.get(name)?.data, { keepUnknown: true });
      return { list, source: "resources", records: new Map(), unknown: unknownParts(list) };
    }
  } catch (error) {
    return { problem: `Couldn’t read the parts from the loaded files: ${(error as Error).message}` };
  }
  return undefined;
}

/**
 * The name to show for a part: the game's own when it has one, else its id in words. Toons parts take their names
 * from Toons' own list, never from the TIM games'.
 */
export function partName(part: Part, listId?: string): { name: string; source: "game" | "id" } {
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const name = part.name ?? partNamesOf(listId).get(part.id);
  return name ? { name: capital(name), source: "game" } : { name: capital(part.id.replace(/-/g, " ")), source: "id" };
}

export type PartOrder = "number" | "name";

/** The parts that match a search on name, id or number, in this order. */
export function findParts(parts: readonly Part[], query: string, order: PartOrder, listId?: string): Part[] {
  const q = query.trim().toLowerCase();
  const name = (p: Part) => partName(p, listId).name;
  const found = parts.filter(
    (p) => !q || String(p.type) === q || p.id.includes(q) || name(p).toLowerCase().includes(q),
  );
  return order === "name"
    ? found.sort((a, b) => name(a).localeCompare(name(b)))
    : found.sort((a, b) => a.type - b.type);
}

/** The file that holds a sprite sheet in the original games. */
export const sheetFile = (sheet: string) => `${sheet}.BMP`;

/**
 * Why a part of this list has no frames, in a sentence for its grey dot, or undefined when it has frames. In TIM 2 the
 * part's `.ANM` file then draws no sprites; in TIM 1 and Even More, a part without frames has a record in `TIM.EXE`
 * that doesn't place its sprites, so the program draws it in its own code.
 */
export function whyNoFrames(listId: string, part: Part): string | undefined {
  if (part.frames.length) return undefined;
  if (!part.sheets.length) return "It has no sprite sheet: the game draws it without sprites, so there are no frames.";
  if (listId === "tim2") return "Its .ANM file has no frames with sprites: the game draws it another way.";
  if (listId === "toons")
    return "It has no PART sheet: TOONS.EXE draws it from the CAT or SID sheet of what it is doing, and those tables weren’t found in this TOONS.EXE.";
  return "Its record in TIM.EXE doesn’t place its sprites: the game draws it in its own code, like walls from tiles. Not worked out yet.";
}
