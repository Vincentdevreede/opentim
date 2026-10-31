/** The parts of the loaded version, read from its files, for the Sprites page. */

import {
  PART_LISTS,
  readProgramParts,
  readTim2Parts,
  type Part,
  type PartList,
  type Placement,
  type TypeRecord,
} from "@opentim/content";
import type { Frame as Bitmap } from "@opentim/resources";
import type { Edition } from "./edition.ts";
import type { Resource } from "./importer.ts";
import { decode } from "./sprites.ts";

/** The id of the part list of a recognised version, like `tim1`, if the catalog links it to one. */
export const listIdOf = (edition?: Edition) => (edition?.status === "recognized" ? edition.profile.parts : undefined);

export interface LoadedParts {
  list: PartList;
  /** Where the parts come from: the loaded program, the loaded resources, or the list committed to OpenTIM. */
  source: "program" | "resources" | "committed";
  /** The records of the program's type table, by part number, when read from the program. */
  records: Map<number, TypeRecord>;
  /** Why the parts couldn't be read from the loaded files. */
  problem?: string;
  /** The numbers of the parts that differ from the committed list, when read from the loaded files. */
  differs: number[];
}

/** The numbers of the parts that aren't the same in both lists. */
function differences(list: PartList, committed: PartList): number[] {
  const types = new Set([...list.parts, ...committed.parts].map((p) => p.type));
  const find = (l: PartList, type: number) => JSON.stringify(l.parts.find((p) => p.type === type));
  return [...types].filter((t) => find(list, t) !== find(committed, t)).sort((a, b) => a - b);
}

/**
 * Reads the parts of the loaded files: TIM 1 and Even More from their program, TIM 2 from `INFO.RES` and its
 * animations. Without those files, or when they can't be read, the committed list stands in, with the reason.
 */
export function readLoadedParts(
  listId: string | undefined,
  resources: readonly Resource[],
  program?: { name: string; data: Uint8Array },
): LoadedParts | undefined {
  const committed = listId ? PART_LISTS[listId] : undefined;
  if (!listId || !committed) return undefined;
  const byName = new Map(resources.map((r) => [r.name, r]));
  const fallback = (problem: string): LoadedParts => ({
    list: committed,
    source: "committed",
    records: new Map(),
    problem,
    differs: [],
  });
  try {
    if (listId === "tim1" || listId === "evenmore") {
      if (program?.name !== "TIM.EXE") return fallback("Add TIM.EXE to read the parts from the program.");
      const spriteCount = (sheet: string) => {
        const r = byName.get(sheetFile(sheet));
        const d = r && decode(r);
        return d?.status === "decoded" ? d.image.frames.length : undefined;
      };
      const read = readProgramParts(listId, program.data, spriteCount);
      return {
        list: read.list,
        source: "program",
        records: new Map(read.records.map((r) => [r.type, r])),
        differs: differences(read.list, committed),
      };
    }
    if (listId === "tim2") {
      if (!byName.has("INFO.RES")) return fallback("INFO.RES isn’t in the loaded files.");
      const list = readTim2Parts((name) => byName.get(name)?.data);
      return { list, source: "resources", records: new Map(), differs: differences(list, committed) };
    }
  } catch (error) {
    return fallback(`Couldn’t read the parts from the loaded files: ${(error as Error).message}`);
  }
  return fallback("The lab can’t read the parts of this game from its files yet.");
}

/** TIM 2 names its parts; the same object has the same id in the other lists. */
const GAME_NAMES = new Map((PART_LISTS.tim2?.parts ?? []).flatMap((p) => (p.name ? [[p.id, p.name] as const] : [])));

/** The name to show for a part: the game's own when it has one, else its id in words. */
export function partName(part: Part): { name: string; source: "game" | "id" } {
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const name = part.name ?? GAME_NAMES.get(part.id);
  return name ? { name: capital(name), source: "game" } : { name: capital(part.id.replace(/-/g, " ")), source: "id" };
}

export type PartOrder = "number" | "name";

/** The parts that match a search on name, id or number, in this order. */
export function findParts(parts: readonly Part[], query: string, order: PartOrder): Part[] {
  const q = query.trim().toLowerCase();
  const found = parts.filter(
    (p) => !q || String(p.type) === q || p.id.includes(q) || partName(p).name.toLowerCase().includes(q),
  );
  return order === "name"
    ? found.sort((a, b) => partName(a).name.localeCompare(partName(b).name))
    : found.sort((a, b) => a.type - b.type);
}

/** The file that holds a sprite sheet in the original games. */
export const sheetFile = (sheet: string) => `${sheet}.BMP`;

/** A sprite of a sheet, decoded, or undefined when the sheet or sprite isn't in the loaded files. */
export type SpriteOf = (sheet: string, sprite: number) => Bitmap | undefined;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A sprite placed in a frame, with its position after pulling the layers apart. */
export interface Placed {
  placement: Placement;
  image: Bitmap;
  x: number;
  y: number;
}

export interface Composition {
  /** In drawing order. */
  placed: Placed[];
  /** The box around the drawn sprites, relative to the part's origin. */
  bounds: Bounds;
  /** Placements whose sprite isn't in the loaded files. */
  missing: Placement[];
}

/**
 * The layers of these placements in drawing order. Which layer the game draws on top isn't known; the Sprite Lab
 * research suggests layer 5 first and 0 last, so that is the guess here.
 */
export const drawOrder = (sprites: readonly Placement[]) =>
  [...new Set(sprites.map((s) => s.layer))].sort((a, b) => b - a);

/**
 * Puts a frame's sprites together. Hidden layers are left out, and `spread` moves each layer that many units further
 * down than the one drawn before it, to see the layers apart.
 */
export function compose(
  sprites: readonly Placement[],
  spriteOf: SpriteOf,
  { hidden = new Set<number>(), spread = 0 }: { hidden?: ReadonlySet<number>; spread?: number } = {},
): Composition {
  const layers = drawOrder(sprites).filter((l) => !hidden.has(l));
  const placed: Placed[] = [];
  const missing: Placement[] = [];
  layers.forEach((layer, rank) => {
    for (const placement of sprites.filter((s) => s.layer === layer)) {
      const image = spriteOf(placement.sheet, placement.sprite);
      if (image) placed.push({ placement, image, x: placement.x, y: placement.y + rank * spread });
      else missing.push(placement);
    }
  });
  if (!placed.length) return { placed, bounds: { x: 0, y: 0, width: 0, height: 0 }, missing };
  const x = Math.min(...placed.map((p) => p.x));
  const y = Math.min(...placed.map((p) => p.y));
  const right = Math.max(...placed.map((p) => p.x + p.image.width));
  const bottom = Math.max(...placed.map((p) => p.y + p.image.height));
  return { placed, bounds: { x, y, width: right - x, height: bottom - y }, missing };
}

/** The sprites of a part's first frame, or the first sprite of its sheet when the list has no frames for it. */
export function coverSprites(part: Part): Placement[] {
  const first = part.frames[0]?.sprites;
  if (first) return first;
  const sheet = part.sheets[0];
  return sheet ? [{ sheet, sprite: 0, x: 0, y: 0, layer: 0 }] : [];
}
