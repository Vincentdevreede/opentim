import { describe, expect, it } from "vitest";
import type { Level, LevelPart } from "../src/read/level.ts";
import { summariseTim2Goal } from "../src/read/tim2-goal.ts";

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
});
