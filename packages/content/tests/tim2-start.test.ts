import { describe, expect, it } from "vitest";
import type { Level } from "../src/read/level.ts";
import { summariseTim2Goal } from "../src/read/tim2-goal.ts";
import {
  tim2BinInsert,
  tim2LastOnList,
  tim2ListOrder,
  tim2PuzzleStart,
  type Tim2StartTables,
} from "../src/read/tim2-start.ts";

type Spec = {
  type: number;
  group?: "static" | "moving";
  third?: number;
  x?: number;
  y?: number;
  state?: number;
  tie?: [number, number];
  belt?: [number, number];
  links?: [number | null, number | null];
  plugs?: [number | null, number | null];
  pulley?: number;
};
const level = (specs: Spec[]) =>
  ({
    layout: "tim2",
    parts: specs.map((p, index) => ({
      index,
      group: p.group ?? "static",
      type: p.type,
      flags: [0, 0, p.third ?? 0],
      state: [p.state ?? 0, 0],
      position: { x: p.x ?? 0, y: p.y ?? 0 },
      plugs: p.plugs ?? [null, null],
      ropes: [
        { at: { x: 0, y: 0 }, ...(p.tie ? { rope: { parts: p.tie, slots: [0, 0] } } : {}) },
        { at: { x: 0, y: 0 } },
      ],
      links: p.links ?? [null, null],
      belt: { at: { x: 0, y: 0 }, width: 0, ...(p.belt ? { parts: p.belt } : {}) },
      ...(p.pulley === undefined ? {} : { pulley: p.pulley }),
    })),
  }) as unknown as Level;
const FIXED = 0x40;

/** Types 1 and 2 sort before 3 on the lists; the bin's table has 3, then 1, then 2. */
const tables: Tim2StartTables = {
  listKeys: new Map([
    [1, 0],
    [2, 0],
    [3, 5],
  ]),
  binRank: new Map([
    [3, 0],
    [1, 1],
    [2, 2],
    [8, 3],
    [10, 4],
    [22, 5],
  ]),
  // The sockets have places to plug into (bit 2), type 2 has a plug (bit 1).
  third: new Map([
    [21, 2],
    [26, 2],
    [96, 2],
    [2, 1],
  ]),
};

describe("TIM 2's puzzle start", () => {
  it("keeps a list by the type's word, the lowest part first, and a part whose type has bit 0x1000 last", () => {
    const l = level([{ type: 3 }, { type: 1, y: 10 }, { type: 1, y: 50 }, { type: 4 }, { type: 2, y: 50, x: 9 }]);
    expect(tim2ListOrder(l, "static", { ...tables, third: new Map([[4, 0x1000]]) })).toEqual([4, 2, 1, 0, 3]);
  });

  it("sorts a part whose file alone has bit 0x1000, as the loader keeps only the file's bits 0x140", () => {
    const l = level([
      { type: 1, y: 10 },
      { type: 2, y: 50, third: 0x1000 },
    ]);
    expect(tim2ListOrder(l, "static", tables)).toEqual([1, 0]);
  });

  it("puts a part in the bin before the first of its type or of a later type, so a type's parts come reversed", () => {
    const l = level([{ type: 1 }, { type: 2 }, { type: 1 }, { type: 3 }, { type: 99 }]);
    const bin: number[] = [];
    for (const index of [0, 1, 2, 3, 4]) tim2BinInsert(bin, index, l, tables);
    expect(bin).toEqual([3, 2, 0, 1, 4]);
  });

  it("takes belts and ropes with a part, unties them on the board, and unplugs the parts plugged into it", () => {
    const l = level([
      { type: 21, third: FIXED, plugs: [1, null], state: 5 },
      { type: 2, plugs: [0, null] },
      { type: 3, third: FIXED },
      { type: 8, third: FIXED, belt: [1, 2] },
      { type: 10, third: FIXED, tie: [1, 2] },
    ]);
    const start = tim2PuzzleStart(l, tables);
    expect(start.bin).toEqual([1, 3, 4]);
    expect([...start.plugs]).toEqual([[0, [null, null]]]);
    // The electric switch keeps bit 4 of its state and has no plug left.
    expect([...start.states]).toEqual([[0, 4]]);
    expect(start.unbelted).toEqual([2]);
    expect(start.untied).toEqual([[2, 0]]);
  });

  it("sets an unplugged part's state again by its type's routine, and a part with a plug keeps its state", () => {
    const l = level([
      { type: 96, third: FIXED, plugs: [3, 4], state: 23 },
      { type: 26, third: FIXED, plugs: [5, 6], state: 3 },
      { type: 99, third: FIXED, plugs: [7, null], state: 6 },
      { type: 2, plugs: [0, null] },
      { type: 2, third: FIXED, plugs: [0, null] },
      { type: 2, third: FIXED, plugs: [1, null] },
      { type: 2, plugs: [1, null] },
      { type: 2, plugs: [2, null] },
    ]);
    // The laser-activated plug keeps 23 mod 7 = 2 and its second place, 14 more; the generator its first place, 1;
    // type 99, which has no routine that sets it, stays as the file has it.
    expect([...tim2PuzzleStart(l, tables).states]).toEqual([
      [0, 16],
      [1, 1],
    ]);
  });

  it("puts a remote control in the bin and takes its explosives off when either goes", () => {
    const l = level([
      { type: 22, third: FIXED, links: [null, 1] },
      { type: 55, links: [null, 0] },
    ]);
    const start = tim2PuzzleStart(l, tables);
    expect(start.bin).toEqual([0]);
    expect([...start.gone]).toEqual([1]);
  });

  it("leaves the parts without bit 0x100 on the board for the solution", () => {
    const l = level([{ type: 1 }, { type: 2, third: 0x100 }]);
    expect(tim2PuzzleStart(l, tables, true).bin).toEqual([1]);
  });
});

describe("which part can be the last on its list", () => {
  it("lets a part on the board be last only when it is last as the puzzle starts", () => {
    // Type 1 parts sort by height, the lowest first; the one put in the bin leaves the list.
    const l = level([
      { type: 1, third: FIXED, y: 50 },
      { type: 1, third: FIXED, y: 10 },
      { type: 1, y: 5 },
    ]);
    expect(tim2LastOnList(l, 0, tables)).toEqual({ can: false, behind: 1 });
    expect(tim2LastOnList(l, 1, tables)).toEqual({ can: true, above: [] });
  });

  it("lets a part from the bin be last when put higher than the parts of its word, unless a part must come after", () => {
    const l = level([
      { type: 1, third: FIXED, y: 50 },
      { type: 1, y: 70 },
      { type: 3, third: FIXED, y: 90 },
      { type: 3, y: 70 },
    ]);
    // A part with a higher word comes after type 1 wherever the player puts it.
    expect(tim2LastOnList(l, 1, tables)).toEqual({ can: false, behind: 2 });
    expect(tim2LastOnList(l, 3, tables)).toEqual({ can: true, above: [2] });
    // A rope goes before the first part of its word.
    const rope = level([
      { type: 1, third: FIXED, y: 50 },
      { type: 10, y: 70 },
    ]);
    expect(tim2LastOnList(rope, 1, tables)).toEqual({ can: false, behind: 0 });
  });

  it("puts a part with bit 0x1000 from the bin before the first such part on the board", () => {
    // The bit comes from the type, as the loader keeps it.
    const last = { ...tables, third: new Map([[2, 0x1000]]) };
    const l = level([{ type: 2, third: FIXED }, { type: 2 }, { type: 3 }]);
    expect(tim2LastOnList(l, 1, last)).toEqual({ can: false, behind: 0 });
    const alone = level([{ type: 1, third: FIXED, y: 9 }, { type: 2 }]);
    expect(tim2LastOnList(alone, 1, last)).toEqual({ can: true, above: [] });
  });

  it("doesn't count bit 0x1000 that only the file has, as the list order doesn't", () => {
    const l = level([
      { type: 1, third: FIXED | 0x1000, y: 50 },
      { type: 1, third: FIXED, y: 10 },
    ]);
    expect(tim2LastOnList(l, 0, tables)).toEqual({ can: false, behind: 1 });
    expect(tim2LastOnList(l, 1, tables)).toEqual({ can: true, above: [] });
  });

  it("warns that a count can pass with fewer parts only when its part can be last", () => {
    const l = level([
      { type: 1, third: FIXED, y: 50 },
      { type: 1, third: FIXED, y: 10 },
      { type: 1, third: FIXED, y: 90 },
    ]);
    const goal = (part: number) => {
      const withGoal = {
        ...l,
        tim2: {
          notes: [],
          ignored: [0, 0],
          spare: 0,
          goal: { first: 1, last: 0, entries: [{ part, values: [0, 9, 2, 0, 0, 0, 0] }] },
        },
      } as unknown as Level;
      return summariseTim2Goal(withGoal, () => "Thing", tables)!.summary.ways[0]![0]!;
    };
    expect(goal(0).caution).toBeUndefined();
    expect(goal(1).caution).toMatch(/#1 is the last part on its list when the puzzle starts.*fewer than 2/);
  });
});

describe("pulling plugs out at the start", () => {
  it("unplugs only a part whose type has a plug or places to plug into", () => {
    // Type 3 has neither bit: going to the bin, it leaves the switch as it is.
    const l = level([
      { type: 21, third: FIXED, plugs: [1, 2], state: 7 },
      { type: 3, plugs: [0, null] },
      { type: 2, plugs: [0, null] },
    ]);
    const start = tim2PuzzleStart(l, tables);
    expect([...start.plugs]).toEqual([[0, [1, null]]]);
    expect([...start.states]).toEqual([[0, 5]]);
  });

  it("leaves the state of a part with a plug when the part it is plugged into goes to the bin", () => {
    const l = level([
      { type: 2, third: FIXED, plugs: [1, null], state: 3 },
      { type: 21, plugs: [0, null], state: 1 },
    ]);
    const start = tim2PuzzleStart(l, tables);
    expect([...start.plugs]).toEqual([[0, [null, null]]]);
    expect(start.states.size).toBe(0);
  });
});
