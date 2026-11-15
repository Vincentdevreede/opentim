/**
 * What a puzzle starts with, by game: which parts wait in the bin and in what order, which stay on the board, and what
 * the start changes on the board. The Lab lays a puzzle out with it, and `check-puzzle-start` compares it with each
 * game's own puzzle start run in the emulator.
 *
 * - TIM 1 and Even More keep the bin in the file, as a third group; the level loader puts it on the bin list in the
 *   file's order and changes nothing else.
 * - TIM 2 keeps every part on the board in the file. When a puzzle starts, TIM2.EXE puts every part without bit 0x40
 *   of the third flag word in the bin. For the designer's solution it leaves on the board the parts with neither 0x40
 *   nor 0x100.
 * - Toons: TOONS.EXE's puzzle setup (`toonsPuzzleStart`), which also pulls plugs, unties ropes and belts and takes a
 *   tunnel's other end off.
 */
import type { Level, LevelPart } from "./level.ts";
import { tim2PuzzleStart, type Tim2StartTables } from "./tim2-start.ts";
import { toonsPuzzleStart, type ToonsPuzzleStart } from "./toons-goals.ts";

/** Bit 0x40 of TIM 2's third flag word: the part stays on the board when the puzzle starts. */
export const TIM2_FIXED = 0x40;
/** Bit 0x100 of TIM 2's third flag word: the part stays in the bin when the game shows the puzzle's solution. */
export const TIM2_NOT_IN_SOLUTION = 0x100;

/** The words of TOONS.EXE's type table its lists and its bin are sorted by (`readToonsListKinds`, `readToonsBinKinds`). */
export interface ToonsSort {
  kinds: ReadonlyMap<number, number>;
  binKinds: ReadonlyMap<number, number>;
}

/** Where the parts are when a puzzle starts, and what the start changes on the board. */
export interface PuzzleStart {
  /** The parts in the bin, by index in the level, in the order the game keeps them. */
  bin: number[];
  /** The parts the start takes off the board and frees (a Toons tunnel's other end). */
  gone: Set<number>;
  /** The states the start leaves board parts with, where it changes them. */
  states: Map<number, number>;
  /** Each board part's two plugs after the start, for the parts whose plugs it changes. */
  plugs: Map<number, [number | null, number | null]>;
  /** The rope places it clears on the board: a part's index and the place, 0 or 1. */
  untied: [number, number][];
  /** The board parts it takes a belt off. */
  unbelted: number[];
  /** Toons: the setup in full. */
  toons?: ToonsPuzzleStart;
}

/** Which of a level's parts are in the bin when its puzzle starts, before the order. */
function inBin(level: Level, part: LevelPart, solution: boolean): boolean {
  if (level.layout === "tim") return part.group === "bin";
  const third = part.flags[2] ?? 0;
  if (third & TIM2_FIXED) return false;
  return !solution || (third & TIM2_NOT_IN_SOLUTION) !== 0;
}

/**
 * What a level's puzzle starts with. `solution` asks for the designer's solution instead (TIM 2; TIM 1 and Toons start
 * it as the file has it). A Toons puzzle needs TOONS.EXE's sort words (`sort`).
 */
export function puzzleStart(
  level: Level,
  { solution = false, sort, tim2 }: { solution?: boolean; sort?: ToonsSort; tim2?: Tim2StartTables } = {},
): PuzzleStart {
  const none = { gone: new Set<number>(), states: new Map(), plugs: new Map(), untied: [], unbelted: [] };
  if (level.layout === "toons") {
    if (solution) return { bin: [], ...none };
    if (!sort) throw new Error("A Toons puzzle starts by the sort words of TOONS.EXE.");
    const start = toonsPuzzleStart(level, sort.kinds, sort.binKinds);
    const board = (index: number) => !start.bin.has(index) && !start.gone.has(index);
    const unbelted = new Set<number>();
    for (const part of level.parts)
      if (part.belt.parts && start.bin.has(part.index))
        for (const end of part.belt.parts) if (end !== null && board(end)) unbelted.add(end);
    return {
      bin: start.binOrder,
      gone: start.gone,
      states: new Map([...start.states].filter(([index]) => board(index))),
      plugs: new Map([...start.plugs].filter(([index]) => board(index))),
      untied: start.untied,
      unbelted: [...unbelted].sort((a, b) => a - b),
      toons: start,
    };
  }
  if (level.layout === "tim2" && tim2) return tim2PuzzleStart(level, tim2, solution);
  return { bin: level.parts.filter((p) => inBin(level, p, solution)).map((p) => p.index), ...none };
}
