import { describe, expect, it } from "vitest";
import type { BehaviourReport, Expression, FieldWrite, Predicate } from "../src/read/behaviour.ts";
import { evaluateBehaviourCondition } from "../src/read/describe-behaviour.ts";
import {
  effectsFromOthers,
  FIXED_LIST_ASSUMPTION,
  predicateForType,
  SCREEN_DIRECTION_ASSUMPTION,
  TOUCH_ASSUMPTION,
  TYPE_TABLE_ASSUMPTION,
  nameOf,
} from "../src/read/describe-effects.ts";

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
          direction: { routine: 0x496e, call: 0x1a7c2, from: "part", to: MEMBER },
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
/** The centre angle and the speed setter, with rounded arctangent and cosine tables. */
const tables = [
  {
    address: 0x496e,
    centreAngle: {
      ...finding,
      assumptions: ["The centre angle's assumption."],
      backend: {
        lookup: {
          initialImageWords: Array.from({ length: 512 }, (_, t) => Math.round((Math.atan(t / 512) * 2048) / Math.PI)),
        },
      },
    },
  },
  {
    address: 0x7d97,
    directedVelocity: {
      stores: [
        { field: 0x36, coefficient: "horizontal" },
        { field: 0x38, coefficient: "vertical" },
      ],
      coefficients: {
        vertical: {
          table: {
            initialImageWords: Array.from(
              { length: 2049 },
              (_, n) => Math.round(16384 * Math.cos((Math.PI * n) / 2048)) & 0xffff,
            ),
          },
        },
      },
    },
  },
];
function report(proved = false): BehaviourReport {
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
      ...(proved ? tables : []),
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
    expect(push.assumptions).toContain(TYPE_TABLE_ASSUMPTION);
  });

  it("says the push goes away from the explosion when the centre angle and the setter's tables prove it", () => {
    const push = effectsFromOthers(report(true), evaluateBehaviourCondition)
      .get(12)!
      .effects.find((e) => e.sets[0]!.kind === "speed")!;
    expect(push.sets[0]).toMatchObject({ kind: "speed", speed: 4096, away: { routine: 0x496e } });
    expect((push.sets[0] as { away: { degrees: number } }).away.degrees).toBeLessThan(0.3);
    expect(push.description).toBe(
      "An explosion that reaches it sets its speed to 4096, away from the explosion. Only when it is on the moving list.",
    );
    expect(push.assumptions).toContain("The centre angle's assumption.");
  });

  it("says the push has no screen direction of its own, only away", () => {
    const push = lines.get(12)!.effects.find((e) => e.sets[0]!.kind === "speed")!;
    expect(push.velocityDirection).toBeUndefined();
    expect(push.assumptions).not.toContain(SCREEN_DIRECTION_ASSUMPTION);
  });

  it("writes both velocities it sets as a direction on the screen with the signed numbers, and the source's named flags", () => {
    const set = lines.get(12)!.effects.find((e) => e.sets[0]!.kind === "field")!;
    expect(set.sourceConditionWords).toEqual(["mirrored"]);
    expect(set.description).toBe(
      "An explosion that reaches it, when the explosion is mirrored, sets its velocity up and to the right (velocityX 4096, velocityY -4096). Only when it is on the moving list.",
    );
    expect(set.velocityDirection).toBe("up and to the right");
    expect(set.assumptions).toContain(SCREEN_DIRECTION_ASSUMPTION);
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

  it("reads type record words from the program, except the frame list the game writes while it runs", () => {
    const table = {
      address: 0x1000,
      stride: 58,
      words: [Array(29).fill(0), Array.from({ length: 29 }, (_, n) => n + 100)],
    };
    const word = (offset: number) => ({
      kind: "compare" as const,
      operator: "==",
      left: {
        kind: "table" as const,
        segment: 0,
        offset: 0x1000 + offset,
        index: { kind: "constant" as const, value: 58, width: 16 },
        width: 16,
      },
      right: { kind: "constant" as const, value: 0, width: 16 },
      signed: false,
    });
    const used = { table: false };
    // The mass at +0x02 of type 1 is the program's word.
    expect(predicateForType(word(2), "member", 4, 1, table, used)).toMatchObject({
      left: { kind: "constant", value: 101 },
    });
    // The frame list at +0x14 stays a read made while the game runs.
    expect(predicateForType(word(0x14), "member", 4, 1, table, used)).toMatchObject({ left: { kind: "table" } });
  });
});

describe("effects of parts that touch", () => {
  const TOUCHER = "collider";
  const velocityY = f(TOUCHER, 0x38);
  const sign = (e: Expression): Expression => ({ kind: "binary", operator: ">>", left: e, right: c(15), width: 16 });
  const absolute = (e: Expression): Expression => ({
    kind: "binary",
    operator: "-",
    left: { kind: "binary", operator: "^", left: e, right: sign(e), width: 16 },
    right: sign(e),
    width: 16,
  });
  const touchWrite = (offset: number, value: Expression, object = TOUCHER): FieldWrite => ({
    ...finding,
    object,
    offset,
    width: 16,
    value,
    condition: { kind: "true" },
    routine: 0x1da61,
  });
  const outcome = (terms: Predicate[], fields: FieldWrite[], returns = 0) => ({
    ...finding,
    effectsComplete: true,
    condition: { kind: "and" as const, terms },
    fields,
    returnValue: c(returns),
  });
  const mirrored = (set: boolean) => compare(and(f("part", 8), 16), set ? "!=" : "==", c(0));
  const edge = (n: number) => compare(f(TOUCHER, 0x8a), "==", c(n));
  const slow = compare(absolute(velocityY), "<", c(1536), true);
  const fast = compare(absolute(velocityY), ">=", c(1536), true);
  const reversed: Expression = { kind: "binary", operator: "-", left: c(0), right: absolute(velocityY), width: 16 };
  const part = (id: string, type: number, reads: number[] = [], bounce?: number) => ({
    id,
    type,
    routines:
      bounce === undefined
        ? []
        : [{ slot: 0, field: 0x22, address: bounce, segment: 0, offset: 0, shared: false, sharedDefault: false }],
    transitions: reads.map((offset) => ({
      ...finding,
      from: null,
      to: f("part", 12),
      condition: compare(f("part", offset), "!=", c(0)),
      routine: 0x500,
    })),
  });
  const report = {
    layout: {
      fields: [
        { offset: 4, name: "type" },
        { offset: 12, name: "state" },
        { offset: 0x36, name: "velocityX" },
        { offset: 0x38, name: "velocityY" },
        { offset: 0x8a, name: "contactEdge" },
        { offset: 8, name: "drawingFlags", masks: [{ name: "horizontalFlip", value: 16 }] },
      ],
    },
    parts: [
      part("cat", 12),
      part("brick-wall", 1),
      part("bullet", 20, [0x38]),
      part("mouse", 42),
      part("alligator", 61, [], 0x1da61),
    ],
    helpers: [
      {
        kind: "part-factory",
        factory: {
          startingWords: [
            { field: 6, values: Array.from({ length: 62 }, (_, t) => (t === 1 || t === 61 ? 0x4800 : 0x800)) },
          ],
        },
      },
    ],
    routines: [
      {
        address: 0x1da61,
        outcomes: [
          // Both speeds when the alligator isn't mirrored: the two paths join into one line without the speed test.
          outcome([mirrored(false), edge(0), fast, compare(f(TOUCHER, 4), "!=", c(42))], [touchWrite(0x38, reversed)]),
          outcome([mirrored(false), edge(0), slow, compare(f(TOUCHER, 4), "!=", c(42))], [touchWrite(0x38, reversed)]),
          // Only a mirrored alligator, and only for the mouse; it also changes the alligator itself.
          outcome(
            [mirrored(true), compare(f(TOUCHER, 4), "==", c(42))],
            [touchWrite(0x38, c(0xfa00)), touchWrite(12, c(7), "part")],
            1,
          ),
          // A value the analysis doesn't know gives no line.
          outcome([edge(3)], [touchWrite(0x36, { kind: "unknown", reason: "Not known.", width: 16 })]),
        ],
      },
    ],
  } as unknown as BehaviourReport;
  const lines = effectsFromOthers(report, evaluateBehaviourCondition);
  const touches = (type: number) => lines.get(type)?.effects.filter((e) => e.touch) ?? [];

  it("gives a moving part what the bounce of a part it touches sets, from its own fields, with the tests in words", () => {
    const [line] = touches(12);
    expect(touches(12)).toHaveLength(1);
    expect(line).toMatchObject({
      sourcePart: "alligator",
      routine: 0x1da61,
      touch: { returns: 0 },
      sets: [{ kind: "expression", offset: 0x38, words: "sets velocityY to -|velocityY|" }],
      sourceCondition: mirrored(false),
      sourceConditionWords: ["not mirrored"],
      condition: compare(f("part", 0x8a), "==", c(0)),
      conditionWords: ["its contactEdge is 0"],
      description:
        "An alligator it touches, when the alligator is not mirrored, sets velocityY to -|velocityY|. Only when its contactEdge is 0. Its bounce returns 0 then, so no contact response follows.",
    });
    expect(line!.assumptions).toContain(TOUCH_ASSUMPTION);
  });

  it("keeps a test that names another type, and says when a contact response may follow", () => {
    const mouse = touches(42);
    expect(mouse.map((e) => e.description)).toEqual([
      "An alligator it touches, when the alligator is mirrored, sets velocityY to -1536. Its bounce returns 1 then, so the game may go on to a contact response, which can change these again.",
    ]);
  });

  it("gives the same setting on paths whose tests can't be said as one a single line with each path as a case", () => {
    const both = {
      ...report,
      routines: [
        {
          address: 0x1da61,
          outcomes: [
            outcome([mirrored(false), edge(0)], [touchWrite(0x38, c(0xfa00))]),
            outcome([mirrored(true), edge(2)], [touchWrite(0x38, c(0xfa00))]),
          ],
        },
      ],
    } as unknown as BehaviourReport;
    const cat = effectsFromOthers(both, evaluateBehaviourCondition)
      .get(12)!
      .effects.filter((e) => e.touch);
    expect(cat).toHaveLength(1);
    expect(cat[0]!.cases?.map((item) => item.words)).toEqual([
      "the alligator is not mirrored, and its contactEdge is 0",
      "the alligator is mirrored, and its contactEdge is 2",
    ]);
    expect(cat[0]!.description).toBe(
      "An alligator it touches sets velocityY to -1536 in 2 cases: (1) when the alligator is not mirrored, and its contactEdge is 0; (2) when the alligator is mirrored, and its contactEdge is 2. Its bounce returns 0 then, so no contact response follows.",
    );
  });

  it("leaves out a fixed type by the decided assumption, and a part whose rules read the field", () => {
    expect(lines.get(1)).toEqual({ effects: [], assumptions: [FIXED_LIST_ASSUMPTION] });
    expect(touches(20)).toEqual([]);
  });
});

describe("part names in the descriptions", () => {
  it("calls part 43 the cannonball, though its id stays pinball", () => {
    expect(nameOf("pinball")).toBe("cannonball");
    expect(nameOf("pinball-bumper")).toBe("pinball bumper");
  });
});
