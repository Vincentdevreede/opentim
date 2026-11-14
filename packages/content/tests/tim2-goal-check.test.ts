import { describe, expect, it } from "vitest";
import { checkTim2Goals, madeUpTim2Goals, tim2GoalTests } from "../src/run/tim2-goal-check.ts";

describe("checkTim2Goals", () => {
  // A stand-in for the goal routine that counts its check and always answers "not met":
  // inc word [0x2c2]; mov ax, 1; retf.
  const memory = new Uint8Array(0x10000);
  memory.set([0xff, 0x06, 0xc2, 0x02, 0xb8, 0x01, 0x00, 0xcb], 0x8000);
  const routine = {
    segment: 0x800,
    offset: 0,
    address: 0x8000,
    first: 0x7416,
    entries: 0x7418,
    last: 0x74a8,
    checks: 0x2c2,
    lists: { bin: 0x64af, moving: 0x64a7, static: 0x649f },
  };
  const program = { memory, dataSegment: 0x100 };
  const goal = (first: number) => ({
    puzzle: 0,
    first,
    entries: Array.from({ length: 8 }, () => ({ part: null, values: [0, 0, 0, 0, 0, 0, 0] })),
    last: 0,
    parts: [],
  });

  it("finds no difference where the routine does what the read goal says", () => {
    const [result] = checkTim2Goals(program, routine, [goal(1)], { trials: 20 });
    expect(result).toMatchObject({ trials: 20, differ: 0 });
  });

  it("counts a trial in which both run on, and one in which only the game does as a difference", () => {
    // jmp $: a routine that never ends. The read goal runs on too while its counted part of type 0xffff is on a list.
    const forever = new Uint8Array(0x10000);
    forever.set([0xeb, 0xfe], 0x8000);
    const odd = { type: 0xffff, state: 0, x: 0, y: 0, baseWidth: 1, baseHeight: 1, group: "static" as const };
    const entries = goal(1).entries.map((e, k) => (k ? e : { part: 0, values: [0, 0, 1, 0, 0, 0, 0] }));
    const [result] = checkTim2Goals(
      { memory: forever, dataSegment: 0x100 },
      routine,
      [{ ...goal(1), entries, parts: [odd] }],
      { trials: 20 },
    );
    expect(result!.runOn).toBeGreaterThan(0);
    expect(result!.runOn + result!.differ).toBe(20);
    if (result!.differ) expect(result!.firstDifference).toMatch(/the game ran on alone/);
  });

  it("says where the routine answers otherwise", () => {
    const [result] = checkTim2Goals(program, routine, [goal(0)], { trials: 20 });
    expect(result).toMatchObject({ differ: 20, firstDifference: "trial 0: the game answers 1, the read goal 0" });
  });
});

describe("tim2GoalTests", () => {
  it("names the tests of each entry up to the first without a part, and of a count only for a count", () => {
    const entries = [
      { part: 0, values: [0, 0, 0] },
      { part: 1, values: [0, 0, 2] },
      { part: null, values: [] },
      { part: 2, values: [0, 0, 0] },
    ];
    expect(tim2GoalTests({ first: 1, entries, last: 0 })).toEqual([
      "a part in the bin is the goal's",
      "a part on a list is the goal's",
      "enough checks",
      "entry 1: holds",
      "entry 2: holds",
      "entry 2: the type",
      "entry 2: enough parts",
    ]);
    expect(tim2GoalTests({ first: 0, entries, last: 0 })).toEqual(["the first word isn't 0"]);
  });
});

describe("madeUpTim2Goals", () => {
  it("makes the same goals each time, each entry pointing at one of its parts", () => {
    const goals = madeUpTim2Goals(20);
    expect(madeUpTim2Goals(20)).toEqual(goals);
    for (const goal of goals)
      for (const e of goal.entries) if (e.part !== null) expect(goal.parts[e.part]).toBeDefined();
  });
});
