import { describe, expect, it } from "vitest";
import type { GoalNames } from "../src/read/describe-goals.ts";
import { conditionText, summariseGoal, type GoalSummary } from "../src/read/goal-conditions.ts";
import {
  readGoalRoutines,
  type GoalComparison,
  type GoalStatement,
  type GoalTest,
  type GoalValue,
} from "../src/read/puzzle-goals.ts";

// Puzzle 2's goal in Even More (0x14bf): every bowling ball (type 0) on the moving list [0x4d7d] at positionY 264, and
// at the same height the step before (previousY at 0x24).
const EVERY_BALL_AT_REST =
  "558bec56ba01008b367d4deb19837c04007511817c20080175088b44203b4424740233d28b340bf675e30bd27406c7066d4a00025e5dcb";

const MODE = 0x4a6d;
const MOVING = 0x4d7d;
const FIXED = 0x4e1f;
const STEPS = 0x4aab;
const KEPT = 0x5068;

const names: GoalNames = {
  fields: new Map([
    [0x04, "type"],
    [0x0c, "state"],
    [0x12, "stateDelta"],
    [0x1e, "positionX"],
    [0x20, "positionY"],
    [0x24, "previousY"],
  ]),
  types: new Map([
    [0, "bowling-ball"],
    [2, "basketball"],
    [5, "balloon"],
    [6, "mouse-motor"],
    [15, "fish-bowl"],
  ]),
  lists: [
    { head: FIXED, bit: 0x2000, name: "the fixed list" },
    { head: MOVING, bit: 0x1000, name: "the moving list" },
  ],
  words: new Map([
    [MODE, "the game mode"],
    [STEPS, "the step count"],
  ]),
  mode: { word: MODE, met: 0x200 },
};

// Small goal programs in the reader's own form.
const c = (value: number): GoalValue => ({ kind: "constant", value });
const reg = (name: string): GoalValue => ({ kind: "register", name });
const word = (address: number): GoalValue => ({ kind: "word", address: c(address) });
const field = (part: string, offset: number): GoalValue => ({
  kind: "word",
  address: { kind: "binary", op: "+", left: reg(part), right: c(offset) },
});
const t = (left: GoalValue, op: GoalComparison, right: GoalValue): GoalTest => ({ op, signed: true, left, right });
const set = (target: GoalValue, value: GoalValue): GoalStatement => ({
  kind: "set",
  target: target as Extract<GoalStatement, { kind: "set" }>["target"],
  value,
});
const when = (test: GoalTest, then: GoalStatement[], otherwise: GoalStatement[] = []): GoalStatement => ({
  kind: "if",
  test,
  then,
  else: otherwise,
});
const met = set(word(MODE), c(0x200));
/** `si = [list]; while si != 0: body; si = [si]`, the walk the goals write without the list routines. */
const walk = (list: number, body: GoalStatement[]): GoalStatement[] => [
  set(reg("si"), word(list)),
  {
    kind: "loop",
    before: [],
    test: t(reg("si"), "!=", c(0)),
    body: [...body, set(reg("si"), { kind: "word", address: reg("si") })],
  },
];
const ofType = (type: number, body: GoalStatement[]) => when(t(field("si", 0x04), "==", c(type)), body);

function summary(body: GoalStatement[]): GoalSummary {
  const routines = new Map([[0x100, { address: 0x100, segment: 0, offset: 0x100, body }]]);
  return summariseGoal(routines, 0x100, names);
}
const text = (s: GoalSummary) => s.ways.map((way) => way.map(conditionText));

describe("summariseGoal", () => {
  it("says a flag a walk clears as what every part of a type must pass", () => {
    const routines = readGoalRoutines(
      (() => {
        const bytes = new Uint8Array(0x1500);
        bytes.set(Buffer.from(EVERY_BALL_AT_REST, "hex"), 0x14bf);
        return bytes;
      })(),
      0,
      0x14bf,
    );
    const goal = summariseGoal(routines, 0x14bf, names);
    expect(text(goal)).toEqual([["every bowling-ball on the moving list: positionY = 264, positionY = previousY"]]);
    expect(goal.ways[0]![0]!.area).toEqual({ x: {}, y: { min: 264, max: 264 } });
  });

  it("says a goal met inside a walk as some part passing the tests, with the area they put it in", () => {
    const goal = summary(
      walk(MOVING, [
        ofType(2, [
          when(t(field("si", 0x1e), ">=", c(24)), [
            when(t(field("si", 0x1e), "<=", c(243)), [when(t(field("si", 0x20), "==", c(249)), [met])]),
          ]),
        ]),
      ]),
    );
    expect(text(goal)).toEqual([["some basketball on the moving list: 24 ≤ positionX ≤ 243, positionY = 249"]]);
    expect(goal.ways[0]![0]).toMatchObject({
      kind: "some",
      types: [{ type: 2, name: "basketball" }],
      area: { x: { min: 24, max: 243 }, y: { min: 249, max: 249 } },
    });
  });

  it("says the number of an unsigned test as it is, also from 0x8000 up", () => {
    const below = (left: GoalValue, right: GoalValue): GoalTest => ({ op: "<", signed: false, left, right });
    const atLeast = (left: GoalValue, right: GoalValue): GoalTest => ({ op: ">=", signed: false, left, right });
    expect(text(summary(walk(MOVING, [when(below(field("si", 0x1e), c(40000)), [met])])))).toEqual([
      ["some part on the moving list: positionX < 40000 (unsigned)"],
    ]);
    const range = walk(MOVING, [
      when(atLeast(field("si", 0x1e), c(100)), [when(below(field("si", 0x1e), c(40000)), [met])]),
    ]);
    expect(text(summary(range))).toEqual([["some part on the moving list: 100 ≤ positionX < 40000 (unsigned)"]]);
  });

  it("gives no way for a goal no part can meet, as a part of two types at once", () => {
    expect(text(summary(walk(MOVING, [ofType(0, [ofType(2, [met])])])))).toEqual([]);
  });

  it("leaves out a test another way of failing already asks, so a box of tests reads as ranges", () => {
    // if x < 342 fail, else if x > 442 fail, else if y < 218 fail
    const goal = summary([
      set(reg("dx"), c(1)),
      ...walk(MOVING, [
        ofType(2, [
          when(
            t(field("si", 0x1e), "<", c(342)),
            [set(reg("dx"), c(0))],
            [
              when(
                t(field("si", 0x1e), ">", c(442)),
                [set(reg("dx"), c(0))],
                [when(t(field("si", 0x20), "<", c(218)), [set(reg("dx"), c(0))])],
              ),
            ],
          ),
        ]),
      ]),
      when(t(reg("dx"), "!=", c(0)), [met]),
    ]);
    expect(text(goal)).toEqual([["every basketball on the moving list: 342 ≤ positionX ≤ 442, positionY ≥ 218"]]);
    expect(goal.ways[0]![0]!.area).toEqual({ x: { min: 342, max: 442 }, y: { min: 218 } });
  });

  it("says a count of parts against a number, and a word like the step count", () => {
    const goal = summary([
      set(reg("dx"), c(0)),
      ...walk(MOVING, [
        ofType(5, [
          when(t(field("si", 0x0c), "==", c(0)), [
            set(reg("dx"), { kind: "binary", op: "+", left: reg("dx"), right: c(1) }),
          ]),
        ]),
      ]),
      when(t(reg("dx"), "<", c(2)), [when(t(word(STEPS), ">=", c(20)), [met])]),
    ]);
    expect(text(goal)).toEqual([
      ["the count of balloon on the moving list where state = 0 < 2", "the step count ≥ 20"],
    ]);
  });

  it("finds the first part a search stops at", () => {
    const search: GoalStatement[] = [
      set(reg("si"), word(MOVING)),
      {
        kind: "loop",
        before: [],
        test: t(field("si", 0x04), "!=", c(2)),
        body: [set(reg("si"), { kind: "word", address: reg("si") })],
      },
      when(t(field("si", 0x20), ">", c(300)), [met]),
    ];
    expect(text(summary(search))).toEqual([["the first basketball on the moving list: positionY > 300"]]);
  });

  it("says a word the goal keeps from step to step, and the ways that a test of it splits the goal into", () => {
    // Counts the steps every mouse motor turns in a row, and is met after 5.
    const goal = summary([
      set(reg("dx"), c(1)),
      ...walk(FIXED, [ofType(6, [when(t(field("si", 0x12), "==", c(0)), [set(reg("dx"), c(0))])])]),
      when(
        t(reg("dx"), "==", c(0)),
        [set(word(KEPT), c(0))],
        [set(word(KEPT), { kind: "binary", op: "+", left: word(KEPT), right: c(1) })],
      ),
      when(t(word(KEPT), ">", c(4)), [met]),
    ]);
    expect(text(goal)).toEqual([
      ["every mouse-motor on the fixed list: stateDelta ≠ 0", "word 0x5068 from the step before + 1 > 4"],
    ]);
    expect(goal.remembered).toEqual([
      {
        word: "word 0x5068",
        becomes: [
          "becomes 0 when some mouse-motor on the fixed list: stateDelta = 0",
          "else becomes word 0x5068 from the step before + 1",
        ],
      },
    ]);
  });

  it("says why a goal that adds up the parts' fields doesn't fit", () => {
    const goal = summary([
      set(reg("cx"), c(0)),
      ...walk(FIXED, [set(reg("cx"), { kind: "binary", op: "+", left: reg("cx"), right: field("si", 0x0c) })]),
      when(t(reg("cx"), ">=", c(3)), [met]),
    ]);
    expect(goal.ways).toEqual([]);
    expect(goal.problem).toBe("it reads an unset value: what a walk leaves in cx");
  });

  it("says why a goal whose routine calls itself without end doesn't fit, instead of running on forever", () => {
    const again: GoalStatement = { kind: "call", routine: 0x100, segment: 0, offset: 0x100, stack: 0 };
    const goal = summary([when(t(word(STEPS), "<", c(20)), [again], [met])]);
    expect(goal.ways).toEqual([]);
    expect(goal.problem).toBe("the routine at 0x100 calls itself more than 8 deep");
  });

  it("follows a routine that calls itself once after setting the word its test reads", () => {
    const again: GoalStatement = { kind: "call", routine: 0x100, segment: 0, offset: 0x100, stack: 0 };
    // The second time in, the word is 1, so the routine tests the step count instead of calling itself again.
    const goal = summary([
      when(t(word(KEPT), "==", c(0)), [set(word(KEPT), c(1)), again], [when(t(word(STEPS), ">=", c(20)), [met])]),
    ]);
    expect(goal.problem).toBeUndefined();
    expect(text(goal)).toEqual([["the step count ≥ 20"]]);
  });

  it("stops a goal that runs too many routines in all, though none calls itself", () => {
    // Eight routines that each call the next one twice: 255 runs.
    const call = (address: number): GoalStatement => ({
      kind: "call",
      routine: address,
      segment: 0,
      offset: address,
      stack: 0,
    });
    const routines = new Map(
      Array.from({ length: 8 }, (_, k) => {
        const address = 0x100 + k;
        const body = k < 7 ? [call(address + 1), call(address + 1)] : [when(t(word(STEPS), ">=", c(20)), [met])];
        return [address, { address, segment: 0, offset: address, body }] as const;
      }),
    );
    const goal = summariseGoal(routines, 0x100, names);
    expect(goal.ways).toEqual([]);
    expect(goal.problem).toBe("it runs more than 64 routines");
  });
});
