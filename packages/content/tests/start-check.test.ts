import { describe, expect, it } from "vitest";
import type { Level } from "../src/read/level.ts";
import { puzzleStart } from "../src/read/puzzle-start.ts";
import type { GameParts, LevelStartRun } from "../src/run/level-start.ts";
import { gameStartResult, startDifferences, type StartFields } from "../src/run/start-check.ts";

const FIELDS: StartFields = { state: 0, plugs: [2, 4], farPlugs: false, ropes: [6, 8], belt: 10 };
/** TIM 2 keeps its plugs as far pointers: the offset, then the segment. */
const FAR_FIELDS: StartFields = { state: 0, plugs: [2, 6], farPlugs: true, ropes: [10, 12], belt: 14 };

/** Parts at 0x100, 0x200, …, each a record of 12 bytes with the given words, on the lists given by index. */
function parts(words: number[][], lists: { moving: number[]; fixed: number[]; bin: number[] }): GameParts {
  const pool = words.map((_, k) => 0x100 * (k + 1));
  const records = new Map(
    words.map((w, k) => [pool[k]!, new Uint8Array(w.flatMap((v) => [v & 0xff, v >> 8]))] as [number, Uint8Array]),
  );
  const at = (indexes: number[]) => indexes.map((i) => pool[i]!);
  return {
    pool,
    records,
    pointers: pool,
    memory: new Uint8Array(),
    lists: { moving: at(lists.moving), fixed: at(lists.fixed), bin: at(lists.bin) },
  };
}

const level = (thirds: number[]) =>
  ({
    layout: "tim2",
    parts: thirds.map((third, index) => ({ index, flags: [0, 0, third], group: "static" })),
  }) as unknown as Level;

describe("the puzzle start check", () => {
  it("reads the bin, the board, the parts taken off and what changed on the board from the records", () => {
    const loaded = parts(
      [
        [1, 0x300, 0, 7, 0, 5],
        [0, 0, 0, 0, 0, 0],
        [0, 0x100, 0, 0, 0, 0],
      ],
      { moving: [], fixed: [0, 1, 2], bin: [] },
    );
    const started = parts(
      [
        [2, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
      ],
      { moving: [], fixed: [0], bin: [1] },
    );
    const run: LevelStartRun = { loaded, started, unknown: new Map() };
    const game = gameStartResult(run, FIELDS);
    expect(game.bin).toEqual([1]);
    expect([...game.board]).toEqual([0]);
    expect([...game.gone]).toEqual([2]);
    expect([...game.states]).toEqual([[0, 2]]);
    expect([...game.plugs]).toEqual([[0, [null, null]]]);
    expect(game.untied).toEqual([[0, 0]]);
    expect(game.unbelted).toEqual([0]);
  });

  it("reads a far plug by both its words, so a record at offset 0 and a change of segment alone count", () => {
    // Part #1's record is at 0x200, which a far pointer can give as 0x20:0. #0 is unplugged from it; #2's plug moves
    // from it to #3's record at 0x40:0, a change of the segment only.
    const loaded = parts(
      [
        [0, 0, 0x20, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0x20, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
      ],
      { moving: [], fixed: [0, 1, 2, 3], bin: [] },
    );
    const started = parts(
      [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0x40, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
      ],
      { moving: [], fixed: [0, 1, 2, 3], bin: [] },
    );
    expect([...gameStartResult({ loaded, started, unknown: new Map() }, FAR_FIELDS).plugs]).toEqual([
      [0, [null, null]],
      [2, [3, null]],
    ]);
  });

  it("says each way the game's start differs from ours, and nothing when they agree", () => {
    // TIM 2: parts without bit 0x40 go to the bin.
    const l = level([0x40, 0, 0]);
    const ours = puzzleStart(l);
    expect(ours.bin).toEqual([1, 2]);
    const agree = {
      bin: [1, 2],
      board: new Set([0]),
      gone: new Set<number>(),
      states: new Map(),
      plugs: new Map(),
      untied: [],
      unbelted: [],
    };
    expect(startDifferences(l, ours, agree)).toEqual([]);
    expect(startDifferences(l, ours, { ...agree, bin: [2, 1] })).toEqual([
      "the bin's order: ours #1, #2, the game's #2, #1",
    ]);
    expect(startDifferences(l, ours, { ...agree, bin: [1], gone: new Set([2]), states: new Map([[0, 3]]) })).toEqual([
      "the bin: ours #1, #2, the game's #1",
      "taken off: ours none, the game's #2",
      "#0's state after the start: ours unchanged, the game's 3",
    ]);
  });

  it("leaves the parts with bit 0x100 in the bin for TIM 2's solution", () => {
    expect(puzzleStart(level([0x40, 0, 0x100]), { solution: true }).bin).toEqual([2]);
  });
});
