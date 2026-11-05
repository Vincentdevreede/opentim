import { describe, expect, it } from "vitest";
import type { BehaviourReport, Expression, FieldWrite, Predicate } from "../src/read/behaviour.ts";
import { evaluateBehaviourCondition } from "../src/read/describe-behaviour.ts";
import { effectsFromOthers, FIXED_LIST_ASSUMPTION } from "../src/read/describe-effects.ts";

const MEMBER = "overlap candidate at 0x1a819";
const c = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const f = (object: string, offset: number): Expression => ({ kind: "field", object, offset, width: 16 });
const and = (left: Expression, mask: number): Expression => ({
  kind: "binary",
  operator: "&",
  left,
  right: c(mask),
  width: 16,
});
const compare = (left: Expression, operator: string, right: Expression, signed = false): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed,
});
/** The mass word of the member's type record, at +0x02 of a 58-byte record at 0x2ef10. */
const mass: Expression = {
  kind: "table",
  segment: 0x2ef1,
  offset: 2,
  index: { kind: "binary", operator: "*", left: f(MEMBER, 4), right: c(58), width: 16 },
  width: 16,
};
const finding = { confidence: "inferred" as const, assumptions: ["A stated assumption."], evidence: [] };
const write = (offset: number, value: Expression, speed?: number): FieldWrite => ({
  ...finding,
  object: MEMBER,
  offset,
  width: 16,
  value,
  condition: { kind: "true" },
  routine: 0x1a73a,
  ...(speed === undefined
    ? {}
    : {
        directedSpeed: {
          routine: 0x7d97,
          call: 0x1a7d1,
          speed: c(speed),
          axis: offset === 0x36 ? ("horizontal" as const) : ("vertical" as const),
        },
      }),
});
const unknown: Expression = { kind: "unknown", reason: "The speed times a coefficient.", width: 16 };
const goingToFrame2 = compare(
  { kind: "binary", operator: "+", left: f("part", 12), right: c(1), width: 16 },
  "==",
  c(2),
);
const moving = compare(and(f(MEMBER, 6), 0x1000), "!=", c(0));
/** The explosion's push for one speed class, as its proved loop gives it. */
const push = (low: number, high: number, speed: number) => ({
  ...finding,
  scope: "one overlap-list member" as const,
  header: 0x1a819,
  object: MEMBER,
  effectsComplete: true,
  condition: {
    kind: "and" as const,
    terms: [
      goingToFrame2,
      moving,
      compare(f(MEMBER, 4), "!=", c(4)),
      compare(mass, ">=", c(low), true),
      compare(mass, "<", c(high), true),
    ],
  },
  fields: [write(0x36, unknown, speed), write(0x38, unknown, speed)],
});
function report(): BehaviourReport {
  const words = (massWord: number) => [0, massWord, ...Array(27).fill(0)];
  const part = (id: string, type: number, reads: number[] = []) => ({
    id,
    type,
    routines:
      type === 41
        ? [{ slot: 1, field: 0x26, address: 0x1a73a, segment: 0, offset: 0, shared: false, sharedDefault: false }]
        : [],
    transitions: reads.map((offset) => ({
      ...finding,
      from: null,
      to: f("part", 12),
      condition: compare(f("part", offset), "!=", c(0)),
      routine: 0x500,
    })),
  });
  return {
    layout: {
      fields: [
        { offset: 4, name: "type" },
        { offset: 12, name: "state" },
        { offset: 0x36, name: "velocityX" },
        { offset: 0x38, name: "velocityY" },
        { offset: 8, name: "drawingFlags", masks: [{ name: "horizontalFlip", value: 16 }] },
      ],
    },
    parts: [
      part("cat", 12),
      part("brick-wall", 1),
      part("bullet", 20, [0x36]),
      part("balloon", 4),
      part("explosion", 41),
    ],
    helpers: [
      {
        kind: "part-factory",
        factory: {
          startingWords: [
            {
              field: 6,
              values: Array(42)
                .fill(0x800)
                .map((v, t) => (t === 1 ? 0x4800 : v)),
            },
          ],
        },
      },
    ],
    typeTable: {
      address: 0x2ef10,
      stride: 58,
      words: Array.from({ length: 42 }, (_, type) =>
        words(type === 12 ? 120 : type === 1 ? 50 : type === 20 ? 100 : 1),
      ),
    },
    routines: [
      {
        address: 0x1a73a,
        iterationOutcomes: [
          push(21, 121, 4096),
          push(121, 151, 3584),
          {
            ...finding,
            scope: "one overlap-list member",
            header: 0x1a819,
            object: MEMBER,
            effectsComplete: true,
            condition: {
              kind: "and",
              terms: [compare(and(f("part", 8), 16), "!=", c(0)), moving],
            },
            fields: [write(0x36, c(4096)), write(0x38, c(0xf000))],
          },
          {
            ...finding,
            scope: "one overlap-list member",
            header: 0x1a819,
            object: MEMBER,
            effectsComplete: true,
            condition: compare(f(MEMBER, 0x1e), "<", c(100)),
            fields: [write(0x36, c(1))],
          },
        ],
      },
    ],
  } as unknown as BehaviourReport;
}

describe("effects of other parts", () => {
  const lines = effectsFromOthers(report(), evaluateBehaviourCondition);

  it("gives a moving part the explosion's push with the speed of its type's mass class", () => {
    const cat = lines.get(12)!.effects;
    const push = cat.find((e) => e.sets[0]!.kind === "speed")!;
    expect(push).toMatchObject({
      sourcePart: "explosion",
      sourceType: 41,
      sets: [{ kind: "speed", fields: [0x36, 0x38], speed: 4096, setter: 0x7d97 }],
      conditionWords: ["on the moving list"],
      sourceCondition: goingToFrame2,
      description:
        "An explosion that reaches it sets its speed to 4096, in a direction the explosion works out. Only when it is on the moving list.",
    });
    expect(push.condition).toEqual(compare(and(f("part", 6), 0x1000), "!=", c(0)));
    expect(push.assumptions).toContain(
      "A type record keeps the words it has in the program while a level runs, so a word the code reads from it, like the mass at +0x02, is the one in TIM.EXE.",
    );
  });

  it("writes numbers it sets as signed velocities, with the source's named flags", () => {
    const set = lines.get(12)!.effects.find((e) => e.sets[0]!.kind === "field")!;
    expect(set.sourceConditionWords).toEqual(["mirrored"]);
    expect(set.description).toBe(
      "An explosion that reaches it, when the explosion is mirrored, sets velocityX to 4096 and sets velocityY to -4096. Only when it is on the moving list.",
    );
  });

  it("leaves out a fixed type by the decided assumption, and says so", () => {
    expect(lines.get(1)).toEqual({ effects: [], assumptions: [FIXED_LIST_ASSUMPTION] });
  });

  it("leaves out an effect that can change the part's frame, and one its type rules out", () => {
    // The bullet's own rules read its horizontal velocity; the balloon is left out by its type.
    expect(lines.get(20)).toBeUndefined();
    expect(lines.get(4)?.effects.some((e) => e.sets[0]!.kind === "speed")).toBe(false);
  });

  it("makes no line for an outcome its type alone doesn't decide", () => {
    expect(lines.get(12)!.effects.some((e) => e.sets.some((s) => s.kind === "field" && s.value === 1))).toBe(false);
  });
});
