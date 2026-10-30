import evenmore from "./lists/evenmore.json" with { type: "json" };
import tim1 from "./lists/tim1.json" with { type: "json" };
import tim2 from "./lists/tim2.json" with { type: "json" };
import type { PartList } from "./model.ts";

export type { Frame, Part, PartList, Placement } from "./model.ts";
export {
  GAMES,
  readProgramParts,
  readTim2Parts,
  type SpriteCount,
  type ListId,
  type ProgramParts,
  type TypeRecord,
} from "./read/parts.ts";
export { RECORD_FIELDS, RECORD_SIZE, type RecordField } from "./read/type-table.ts";

/** Every part list, by id. The version catalog says which list belongs to a version of a game. */
export const PART_LISTS: Record<string, PartList> = Object.fromEntries(
  ([tim1, evenmore, tim2] as PartList[]).map((list) => [list.id, list]),
);

/** The part with this number in a list, if the list has one. */
export const partOfType = (list: PartList, type: number) => list.parts.find((part) => part.type === type);
