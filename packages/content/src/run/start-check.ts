/**
 * Compares what `puzzleStart` says a TIM 2 or Toons puzzle starts with against what the game's own puzzle start did
 * in the emulator (`GameMachine`): the bin and its order, the parts on the board, the parts taken off, and on the board
 * the states, plugs, ropes and belts the start changes. A change is a word of a board part's record that differs
 * between the level as the loader left it and the puzzle as the start left it.
 */
import type { Level } from "../read/level.ts";
import type { PuzzleStart } from "../read/puzzle-start.ts";
import { tim2ListOrder, type Tim2StartTables } from "../read/tim2-start.ts";
import type { GameParts, LevelStartRun } from "./level-start.ts";

/** Where a game's part record keeps what the start can change, as `check-level-fields` finds it. */
export interface StartFields {
  /** The working state, the frame the part is drawn with. */
  state: number;
  /** The two plugs: a near pointer (Toons) or a far one (TIM 2) to the plugged part, 0 for none. */
  plugs: [number, number];
  /** The records of the ropes tied at the two rope places, 0 for none. */
  ropes: [number, number];
  /** The record of the belt round the part, 0 for none. */
  belt: number;
}

/** Toons' 0xb3-byte part record. */
export const TOONS_START_FIELDS: StartFields = { state: 0x0e, plugs: [0x6b, 0x6d], ropes: [0x6f, 0x71], belt: 0x5d };
/** TIM 2's 0xba-byte part record. */
export const TIM2_START_FIELDS: StartFields = { state: 0x10, plugs: [0x6e, 0x72], ropes: [0x76, 0x78], belt: 0x58 };

/** What the game's start did, in the same terms as `PuzzleStart`, with the parts on the board. */
export interface GameStartResult extends Omit<PuzzleStart, "toons"> {
  board: Set<number>;
}

const word = (record: Uint8Array, at: number) => record[at]! | (record[at + 1]! << 8);

/** Reads what the start did from the records before and after it. */
export function gameStartResult(run: LevelStartRun, fields: StartFields): GameStartResult {
  const { loaded, started } = run;
  const indexOf = (parts: GameParts, at: number) => parts.pool.indexOf(at);
  const bin = started.lists.bin.map((at) => indexOf(started, at));
  const board = new Set([...started.lists.moving, ...started.lists.fixed].map((at) => indexOf(started, at)));
  const gone = new Set<number>();
  const states = new Map<number, number>();
  const plugs = new Map<number, [number | null, number | null]>();
  const untied: [number, number][] = [];
  const unbelted: number[] = [];
  const byPointer = new Map(started.pointers.map((pointer, index) => [pointer, index]));
  const plugged = (value: number) => (value ? (byPointer.get(value) ?? -1) : null);
  started.pool.forEach((at, index) => {
    if (!at) return;
    if (!board.has(index)) {
      if (!bin.includes(index)) gone.add(index);
      return;
    }
    const before = loaded.records.get(loaded.pool[index]!);
    const after = started.records.get(at);
    if (!before || !after) return;
    if (word(before, fields.state) !== word(after, fields.state)) states.set(index, word(after, fields.state));
    if (fields.plugs.some((k) => word(before, k) !== word(after, k)))
      plugs.set(index, [plugged(word(after, fields.plugs[0])), plugged(word(after, fields.plugs[1]))]);
    fields.ropes.forEach((k, place) => {
      if (word(before, k) && !word(after, k)) untied.push([index, place]);
    });
    if (word(before, fields.belt) && !word(after, fields.belt)) unbelted.push(index);
  });
  return { bin, board, gone, states, plugs, untied, unbelted };
}

const partList = (indexes: Iterable<number>) => [...indexes].map((i) => `#${i}`).join(", ") || "none";
const plugText = ([a, b]: [number | null, number | null]) =>
  `${a === null ? "none" : `#${a}`} and ${b === null ? "none" : `#${b}`}`;

/** The differences between ours and the game's, each a sentence. Empty when they agree. */
export function startDifferences(level: Level, ours: PuzzleStart, game: GameStartResult): string[] {
  const out: string[] = [];
  const oursBoard = new Set(level.parts.map((p) => p.index).filter((i) => !ours.bin.includes(i) && !ours.gone.has(i)));
  const only = <T>(a: Iterable<T>, b: Iterable<T>) => {
    const other = new Set(b);
    return [...a].filter((i) => !other.has(i));
  };
  const binSame = ours.bin.length === game.bin.length && ours.bin.every((i, k) => game.bin[k] === i);
  if (!binSame) {
    const sameParts = only(ours.bin, game.bin).length === 0 && only(game.bin, ours.bin).length === 0;
    out.push(
      sameParts
        ? `the bin's order: ours ${partList(ours.bin)}, the game's ${partList(game.bin)}`
        : `the bin: ours ${partList(ours.bin)}, the game's ${partList(game.bin)}`,
    );
  }
  const onBoard = only(oursBoard, game.board);
  const offBoard = only(game.board, oursBoard);
  if (onBoard.length) out.push(`on the board by ours only: ${partList(onBoard)}`);
  if (offBoard.length) out.push(`on the board by the game only: ${partList(offBoard)}`);
  if (only(ours.gone, game.gone).length || only(game.gone, ours.gone).length)
    out.push(`taken off: ours ${partList(ours.gone)}, the game's ${partList(game.gone)}`);
  for (const index of new Set([...ours.states.keys(), ...game.states.keys()]))
    if (ours.states.get(index) !== game.states.get(index))
      out.push(
        `#${index}'s state after the start: ours ${ours.states.get(index) ?? "unchanged"}, the game's ${game.states.get(index) ?? "unchanged"}`,
      );
  for (const index of new Set([...ours.plugs.keys(), ...game.plugs.keys()])) {
    const a = ours.plugs.get(index);
    const b = game.plugs.get(index);
    if (a?.[0] !== b?.[0] || a?.[1] !== b?.[1])
      out.push(
        `#${index}'s plugs after the start: ours ${a ? plugText(a) : "unchanged"}, the game's ${b ? plugText(b) : "unchanged"}`,
      );
  }
  const places = (pairs: [number, number][]) => pairs.map(([i, p]) => `#${i} place ${p + 1}`);
  const oursUntied = places(ours.untied);
  const gameUntied = places(game.untied);
  if (only(oursUntied, gameUntied).length || only(gameUntied, oursUntied).length)
    out.push(`ropes untied: ours ${oursUntied.join(", ") || "none"}, the game's ${gameUntied.join(", ") || "none"}`);
  if (only(ours.unbelted, game.unbelted).length || only(game.unbelted, ours.unbelted).length)
    out.push(`belts taken off: ours ${partList(ours.unbelted)}, the game's ${partList(game.unbelted)}`);
  return out;
}

/**
 * TIM 2: the moving and fixed lists in the order the Lab says (`tim2ListOrder`), after the loader and, less the parts
 * that went to the bin or were taken off, after the start, against the game's lists. The goal routine walks the lists
 * in that order, so it decides which part is last on its list (`tim2LastOnList`). Empty when they agree.
 */
export function tim2ListDifferences(
  level: Level,
  tables: Tim2StartTables,
  ours: PuzzleStart,
  run: LevelStartRun,
): string[] {
  const out: string[] = [];
  const board = (i: number) => !ours.bin.includes(i) && !ours.gone.has(i);
  for (const [when, parts] of [
    ["after the loader", run.loaded],
    ["after the start", run.started],
  ] as const)
    for (const [list, group] of [
      ["moving", "moving"],
      ["fixed", "static"],
    ] as const) {
      const order = tim2ListOrder(level, group, tables).filter((i) => when === "after the loader" || board(i));
      const game = parts.lists[list].map((at) => parts.pool.indexOf(at));
      if (order.length !== game.length || order.some((i, k) => game[k] !== i))
        out.push(`the ${list} list ${when}: ours ${partList(order)}, the game's ${partList(game)}`);
    }
  return out;
}
