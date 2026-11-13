/**
 * What the Lab reads from TIM2.EXE about the part types. TIM2.EXE isn't packed: its data segment is the one its entry
 * code loads first (`mov dx, segment`), and the data segment holds a table with a near pointer per part type to that
 * type's 72-byte record. The records follow the table, so the table ends where the first record starts.
 *
 * A record has far pointers to the type's routines; the one at `0x18` draws a part. Most types share one routine that
 * draws their frame; walls and tiles have routines of their own, which `tim2Drawing` tells apart.
 */

import { findChunk, readChunks } from "@opentim/resources";

export interface Tim2Types {
  /** Where the data segment starts in the file. */
  dataSegment: number;
  /** Where the type table starts in the data segment. */
  table: number;
  /** Each type's record, by type number. */
  records: Uint8Array[];
}

export const TIM2_RECORD_SIZE = 0x48;
/** The far pointer of the routine that draws a part, in a type's record. */
const DRAW = 0x18;
/** How many records in a row the table search wants, to be sure. */
const RUN = 20;

/** Reads TIM2.EXE's type table, or throws when the program doesn't look like TIM2.EXE. */
export function readTim2Types(exe: Uint8Array): Tim2Types {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const word = (at: number) => view.getUint16(at, true);
  if (exe.length < 0x40 || word(0) !== 0x5a4d) throw new Error("Not a DOS program: no MZ header");
  const header = word(8) * 16;
  const entry = header + word(0x16) * 16 + word(0x14);
  if (exe[entry] !== 0xba) throw new Error("The entry code doesn't load the data segment first");
  const dataSegment = header + word(entry + 1) * 16;
  for (let table = 0; table < 0x8000 && dataSegment + table + RUN * 2 <= exe.length; table += 2) {
    const at = dataSegment + table;
    const first = word(at);
    if (first <= table || (first - table) % 2) continue;
    let run = 1;
    while (run < RUN && word(at + run * 2) === first + run * TIM2_RECORD_SIZE) run++;
    if (run < RUN) continue;
    const count = (first - table) / 2;
    const records = Array.from({ length: count }, (_, type) => {
      const record = dataSegment + word(at + type * 2);
      if (record + TIM2_RECORD_SIZE > exe.length) throw new Error(`Type ${type}'s record runs past the program`);
      return exe.slice(record, record + TIM2_RECORD_SIZE);
    });
    return { dataSegment, table, records };
  }
  throw new Error("No type table in the data segment");
}

/**
 * How TIM2.EXE draws a type: as a wall of pieces, as a pattern of tiles, as a box filled with one colour (the colour
 * block), or by its frame.
 */
export type Tim2Drawing = "wall" | "pattern" | "block" | "frame";

/** The far pointer of a type's draw routine, as one number. */
const drawRoutine = (record: Uint8Array | undefined) =>
  record ? new DataView(record.buffer, record.byteOffset).getUint32(DRAW, true) : undefined;

/**
 * The types TIM2.EXE draws as walls, patterns or colour blocks. The brick wall (1) is drawn by the wall routine, the
 * tile (122) by the pattern routine and the colour block (127) by the block routine; every type whose record points at
 * the same routine is drawn the same way.
 */
export function tim2Drawing(types: Tim2Types): Map<number, Tim2Drawing> {
  const wall = drawRoutine(types.records[1]);
  const pattern = drawRoutine(types.records[122]);
  const block = drawRoutine(types.records[127]);
  return new Map(
    types.records.map((record, type) => {
      const routine = drawRoutine(record);
      const how = routine === wall ? "wall" : routine === pattern ? "pattern" : routine === block ? "block" : "frame";
      return [type, how];
    }),
  );
}

/**
 * Whether a part's `.PAR` file has the size limits of TIM 2's walls. A `.PAR` file is a `PAR:` chunk that starts with
 * `PROPI`, a byte 1 and the part's type, then words of its properties; the words at 0x16 and 0x18 look like the largest
 * size a player can stretch the part to. In the floppy and CD builds the types with 576 × 416 there are exactly the ones
 * TIM2.EXE draws with its wall routine, the large pipes included. That is a match in the files, not a rule the program
 * follows, so it only stands in when TIM2.EXE isn't loaded.
 */
export function hasWallLimits(par: Uint8Array): boolean {
  let data: Uint8Array | undefined;
  try {
    data = findChunk(readChunks(par), "PAR:")?.data;
  } catch {
    return false;
  }
  if (!data || data.length < 0x1a || String.fromCharCode(...data.subarray(0, 5)) !== "PROPI") return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint16(0x16, true) === 576 && view.getUint16(0x18, true) === 416;
}
