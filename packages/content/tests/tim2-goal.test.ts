import { describe, expect, it } from "vitest";
import { conditionText } from "../src/read/goal-conditions.ts";
import type { Level, LevelPart } from "../src/read/level.ts";
import {
  findTim2GoalRoutine,
  runTim2Goal,
  summariseTim2Goal,
  tim2GoalWords,
  Tim2GoalRunsOn,
  type Tim2GoalPart,
  type Tim2GoalWorld,
} from "../src/read/tim2-goal.ts";

const part = (index: number, type: number, group: "static" | "moving", fixed = true): LevelPart =>
  ({
    index,
    group,
    type,
    flags: [0, 0, fixed ? 0x40 : 0],
    baseSize: { width: 16, height: 10 },
  }) as LevelPart;

function level(first: number, last: number, entries: [number | null, ...number[]][]): Level {
  const parts = [part(0, 1, "static"), part(1, 9, "moving"), part(2, 29, "static"), part(3, 4, "moving", false)];
  return {
    parts,
    tim2: {
      notes: [],
      ignored: [0, 0],
      spare: 0,
      goal: { first, last, entries: entries.map(([p, ...values]) => ({ part: p, values })) },
    },
  } as unknown as Level;
}

const names = (type: number) => ({ 9: "Basketball", 29: "Lava Lamp", 4: "Balloon" })[type] ?? `type ${type}`;

describe("TIM 2 goals", () => {
  it("says each entry as the goal routine tests it", () => {
    const goal = summariseTim2Goal(
      level(1, 0, [
        [2, 1, 21, 0, 0, 0, 0, 0],
        [1, 0, 0, 3, 100, 200, 50, 40],
        [3, 0, 0, 0, -1, -1, -1, -1],
        [null, 0, 0, 0, 0, 0, 0, 0],
      ]),
      names,
    )!;
    const [lamp, balls, balloon] = goal.summary.ways[0]!;
    expect(lamp).toMatchObject({ kind: "part", part: 2, tests: ["state 1 to 21"] });
    expect(lamp!.caution).toBeUndefined();
    // When the counted part ends last on its list, TIM2.EXE forgets the entry.
    expect(balls!.caution).toMatch(/#1 is the last part on its list.*fewer than 3/);
    expect(balls).toMatchObject({
      kind: "count",
      lists: "the moving list",
      where: ["its middle inside x 100 to 150, y 200 to 240"],
      count: { op: ">=", value: 3 },
      // The middle is the position plus half the base size, strictly inside.
      area: { x: { min: 93, max: 141 }, y: { min: 196, max: 234 } },
    });
    expect(balloon).toMatchObject({
      kind: "part",
      tests: ["its middle off the screen (640 × 400)", "out of the parts bin"],
    });
    expect(goal.lines).toHaveLength(4);
  });

  it("waits for the last word's number of checks, and has no way when the first word is 0", () => {
    expect(summariseTim2Goal(level(1, 108, [[2, 1, 1, 0, 0, 0, 0, 0]]), names)!.summary.ways[0]!.at(-1)).toEqual({
      kind: "word",
      tests: ["at least 108 steps after the machine starts"],
    });
    const none = summariseTim2Goal(level(0, 0, [[2, 1, 1, 0, 0, 0, 0, 0]]), names)!.summary;
    expect(none.ways).toEqual([]);
    expect(none.problem).toMatch(/first word is 0/);
  });

  it("says a count's part must be out of the parts bin in the count's line", () => {
    const [count] = summariseTim2Goal(level(1, 0, [[3, 0, 0, 2, 100, 200, 50, 40]]), names)!.summary.ways[0]!;
    expect(conditionText(count!)).toBe(
      "the count of Balloon on the moving list where its middle inside x 100 to 150, y 200 to 240 ≥ 2, #3 out of the parts bin",
    );
  });

  it("uses an entry's one state limit for both limits up to version 0x109, as TIM2.EXE's loader does", () => {
    const [lamp, balls] = summariseTim2Goal(
      level(1, 0, [
        [2, 4, 0, 0, 0, 0, 0],
        [1, 0, 3, 100, 200, 50, 40],
      ]),
      names,
    )!.summary.ways[0]!;
    expect(lamp).toMatchObject({ kind: "part", part: 2, tests: ["state 4"] });
    expect(balls).toMatchObject({
      kind: "count",
      where: ["its middle inside x 100 to 150, y 200 to 240"],
      count: { op: ">=", value: 3 },
    });
  });
});

describe("tim2GoalWords", () => {
  it("gives an entry of six words its one state limit twice, as TIM2.EXE's loader does, and keeps seven as they are", () => {
    expect(tim2GoalWords([4, 0, 100, 200, 50, 40])).toEqual([4, 4, 0, 100, 200, 50, 40]);
    expect(tim2GoalWords([1, 5, 2, 100, 200, 50, 40])).toEqual([1, 5, 2, 100, 200, 50, 40]);
  });
});

describe("findTim2GoalRoutine", () => {
  it("finds the routine by its reach into the entries and reads its words from its instructions", () => {
    const routine = [
      [0x55, 0x8b, 0xec], // push bp; mov bp, sp
      [0x83, 0x3e, 0x16, 0x74, 0x00], // cmp word [0x7416], 0
      [0x8b, 0x16, 0xb1, 0x64, 0xa1, 0xaf, 0x64], // mov dx, [0x64b1]; mov ax, [0x64af]: the bin
      [0x8b, 0x16, 0xa9, 0x64, 0xa1, 0xa7, 0x64], // the moving list
      [0x8b, 0x16, 0xa9, 0x64, 0xa1, 0xa7, 0x64], // the moving list again
      [0x8b, 0x16, 0xa1, 0x64, 0xa1, 0x9f, 0x64], // the static list
      [0xb8, 0x18, 0x74, 0x05, 0xee, 0xff], // mov ax, 0x7418; add ax, -18
      [0xff, 0x06, 0xc2, 0x02], // inc word [0x2c2]
      [0x3b, 0x06, 0xa8, 0x74], // cmp ax, [0x74a8]
      [0xcb], // retf
    ].flat();
    const memory = new Uint8Array(0x400);
    memory.set(routine, 0x234);
    expect(findTim2GoalRoutine({ memory, overlays: [0x20], codeSegments: [0] })).toEqual({
      segment: 0x20,
      offset: 0x34,
      address: 0x234,
      first: 0x7416,
      entries: 0x7418,
      last: 0x74a8,
      checks: 0x2c2,
      lists: { bin: 0x64af, moving: 0x64a7, static: 0x649f },
    });
    // Without a last word right after the eight entries it isn't the goal routine.
    memory[0x234 + routine.length - 4] = 0xaa;
    expect(findTim2GoalRoutine({ memory, overlays: [0x20], codeSegments: [0] })).toBeUndefined();
  });
});

describe("runTim2Goal", () => {
  const p = (type: number, state = 0, x = 0, y = 0): Tim2GoalPart => ({
    type,
    state,
    x,
    y,
    baseWidth: 10,
    baseHeight: 20,
  });
  const entry = (part: Tim2GoalPart | null, ...values: number[]) => ({
    part,
    values: [...values, 0, 0, 0, 0, 0, 0, 0],
  });
  const world = (over: Partial<Tim2GoalWorld>): Tim2GoalWorld => ({
    first: 1,
    entries: [],
    last: 0,
    moving: [],
    static: [],
    bin: [],
    checks: 0,
    ...over,
  });

  it("answers 0 without a goal, and 1 without counting while a goal part is in the bin", () => {
    const lamp = p(29, 3);
    expect(runTim2Goal(world({ first: 0, checks: 4 }))).toEqual({ answer: 0, checks: 5 });
    expect(runTim2Goal(world({ entries: [entry(lamp, 1, 5)], bin: [lamp], checks: 4 }))).toEqual({
      answer: 1,
      checks: 4,
    });
    expect(runTim2Goal(world({ entries: [entry(lamp, 1, 5)], static: [lamp], checks: 4 }))).toEqual({
      answer: 2,
      checks: 5,
    });
  });

  it("tests a moving part's middle strictly inside the area, or off the screen, and a static part's state", () => {
    const ball = p(9, 0, 95, 190); // middle 100, 200
    const inside = (x: number, y: number, w: number, h: number) =>
      runTim2Goal(world({ entries: [entry(ball, 0, 0, 0, x, y, w, h)], moving: [ball] })).answer;
    expect(inside(99, 199, 2, 2)).toBe(2);
    expect(inside(100, 199, 2, 2)).toBe(1);
    expect(inside(98, 199, 2, 2)).toBe(1);
    expect(inside(0, 0, -1, 0)).toBe(1);
    const gone = p(9, 0, 636, 190); // middle 641, 200
    expect(runTim2Goal(world({ entries: [entry(gone, 0, 0, 0, 0, 0, -1, 0)], moving: [gone] })).answer).toBe(2);
    // On the static list the area isn't tested, the state is.
    expect(runTim2Goal(world({ entries: [entry(ball, 0, 0, 0, 99, 199, 2, 2)], static: [ball] })).answer).toBe(2);
    expect(runTim2Goal(world({ entries: [entry(ball, 1, 2, 0, 99, 199, 2, 2)], static: [ball] })).answer).toBe(1);
  });

  it("stops looking for a part's entry at the first entry without a part", () => {
    const lamp = p(29, 3);
    const other = p(29, 9);
    const goal = { entries: [entry(lamp, 1, 5), entry(null), entry(other, 1, 5)], static: [lamp, other] };
    expect(runTim2Goal(world(goal)).answer).toBe(2);
  });

  it("counts parts of the entry part's type from the first part, and forgets the count after the last part", () => {
    const balls = [p(9, 1), p(9, 2), p(4, 1), p(9, 1)];
    const count = (n: number, at: number) =>
      runTim2Goal(world({ entries: [entry(balls[at]!, 1, 1, n)], static: balls })).answer;
    expect(count(2, 0)).toBe(2);
    expect(count(3, 0)).toBe(1);
    // With the entry's part last on its list, running out of parts doesn't fail the goal.
    expect(count(3, 3)).toBe(1); // no entry held either
    const lamp = p(29, 3);
    const both = world({ entries: [entry(lamp, 1, 5), entry(balls[3]!, 1, 1, 3)], static: [lamp, ...balls] });
    expect(runTim2Goal(both).answer).toBe(2);
    expect(runTim2Goal({ ...both, static: [...balls, lamp] }).answer).toBe(1);
  });

  it("runs on, as the routine does, when a counted part has type 0xffff, the word's value for no count", () => {
    const odd = p(0xffff, 1);
    const goal = world({ entries: [entry(odd, 1, 1, 2)], static: [p(9), odd, p(9)] });
    expect(() => runTim2Goal(goal)).toThrow(Tim2GoalRunsOn);
    // A failing entry before it on the list still ends the walk.
    const lamp = p(29, 3);
    expect(runTim2Goal({ ...goal, entries: [...goal.entries, entry(lamp, 1, 2)], static: [lamp, odd] }).answer).toBe(1);
  });

  it("holds a met goal back until the last word's number of checks", () => {
    const lamp = p(29, 3);
    const goal = world({ entries: [entry(lamp, 1, 5)], static: [lamp], last: 3 });
    expect(runTim2Goal({ ...goal, checks: 1 })).toEqual({ answer: 1, checks: 2 });
    expect(runTim2Goal({ ...goal, checks: 2 })).toEqual({ answer: 2, checks: 3 });
  });
});
