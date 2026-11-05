import { describe, expect, it } from "vitest";
import type { BehaviourReport, Expression, FieldWrite, Predicate } from "../src/read/behaviour.ts";
import { describeBehaviour, evaluateBehaviourCondition } from "../src/read/describe-behaviour.ts";
import { hitsFromOthers } from "../src/read/describe-hits.ts";

const MEMBER = "overlap candidate at 0x1a819";
const proof = {
  confidence: "inferred" as const,
  assumptions: ["Synthetic extracted rule"],
  evidence: [{ address: 0x123, bytes: [0x90], text: "nop" }],
};
const c = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const f = (object: string, offset: number): Expression => ({ kind: "field", object, offset, width: 16 });
const compare = (left: Expression, operator: string, right: Expression): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed: false,
});
const and = (...terms: Predicate[]): Predicate => ({ kind: "and", terms });
const masked = (object: string, offset: number, mask: number): Expression => ({
  kind: "binary",
  operator: "&",
  left: f(object, offset),
  right: c(mask),
  width: 16,
});
const write = (object: string, offset: number, value: Expression): FieldWrite => ({
  object,
  offset,
  width: 16,
  value,
  condition: { kind: "true" },
  routine: 500,
  ...proof,
});
const isType = (type: number) => compare(f(MEMBER, 4), "==", c(type));
const goingToFrame2 = compare(
  { kind: "binary", operator: "+", left: f("part", 12), right: c(1), width: 16 },
  "==",
  c(2),
);
const moving = compare(masked(MEMBER, 6, 0x1000), "!=", c(0));
const mirrored = compare(masked(MEMBER, 8, 0x10), "!=", c(0));
const notMirrored = compare(masked(MEMBER, 8, 0x10), "==", c(0));
const outcome = (condition: Predicate, fields: FieldWrite[]) => ({
  ...proof,
  scope: "one overlap-list member" as const,
  header: 0x1a819,
  object: MEMBER,
  effectsComplete: true,
  condition,
  fields,
});
const rule = (to: Expression, condition: Predicate) => ({ from: null, to, condition, routine: 100, ...proof });
const part = (id: string, type: number, transitions: ReturnType<typeof rule>[], routines: number[] = []) => ({
  id,
  type,
  frameCount: 3,
  routines: routines.map((address) => ({ slot: 1, address, role: "run callback candidate", ...proof })),
  stateWrites: [],
  transitions,
  counters: [],
  reset: [],
  visibleEffects: [],
  triggers: [],
  uncertainties: [],
});

/** A balloon and a mouse motor whose run reads the control value at 0x12, and an explosion that hits them. */
function report(): BehaviourReport {
  const reset = [write("part", 12, c(0)), write("part", 0x12, c(0))];
  return {
    listId: "synthetic",
    imageLength: 0,
    dataSegment: 0,
    layout: {
      fields: [
        { name: "state", offset: 12, ...proof },
        { name: "type", offset: 4, ...proof },
        { name: "drawingFlags", offset: 8, ...proof },
      ],
      ...proof,
    },
    timing: { diagnostics: [] },
    assumptions: [],
    relatedObjectEffects: [],
    parts: [
      {
        ...part("balloon", 4, [
          rule(c(1), and(compare(f("part", 12), "==", c(0)), compare(f("part", 0x12), "==", c(1)))),
          rule(c(1), compare(f("part", 12), "==", c(1))),
          rule(c(0), and(compare(f("part", 12), "==", c(0)), compare(f("part", 0x12), "==", c(0)))),
        ]),
        reset,
        routines: [
          { slot: 1, address: 100, role: "run callback candidate", ...proof },
          { slot: 2, address: 200, role: "reset callback candidate", ...proof },
        ],
      },
      part("mouse-motor", 6, [rule(c(1), compare(f("part", 0x12), "!=", c(0)))]),
      part("cat", 12, []),
      part("explosion", 41, [], [500]),
    ],
    routines: [
      { address: 100, writes: [], ...proof },
      { address: 200, writes: reset, outcomes: [{ condition: { kind: "true" }, fields: reset, ...proof }], ...proof },
      {
        address: 500,
        writes: [],
        ...proof,
        iterationOutcomes: [
          // The balloon's control value set to 1, reached on two paths with different tests of the explosion.
          outcome(and(goingToFrame2, moving, isType(4)), [write(MEMBER, 0x12, c(1))]),
          outcome(and(compare(f("part", 12), "==", c(3)), moving, isType(4)), [write(MEMBER, 0x12, c(1))]),
          // The mouse motor's start: the step by whether it is mirrored, and the counter.
          outcome(and(goingToFrame2, isType(6), mirrored), [
            write(MEMBER, 0x12, c(0xffff)),
            write(MEMBER, 0x96, c(100)),
          ]),
          outcome(and(goingToFrame2, isType(6), notMirrored), [write(MEMBER, 0x12, c(1)), write(MEMBER, 0x96, c(100))]),
          // No type named: the search may hold parts the explosion never acts on.
          outcome(compare(f(MEMBER, 0x12), "==", c(0)), [write(MEMBER, 0x12, c(1))]),
          // A value the walk can't follow.
          outcome(isType(6), [write(MEMBER, 0x12, { kind: "unknown", reason: "unknown", width: 16 })]),
          // A field no rule reads.
          outcome(isType(12), [write(MEMBER, 0x96, c(5))]),
        ],
      },
    ],
  } as unknown as BehaviourReport;
}

describe("walks from other parts that change a part's frame", () => {
  const hits = hitsFromOthers(report(), evaluateBehaviourCondition);

  it("keeps one hit per set of written fields, with the tests every path makes", () => {
    const balloon = hits.get(4)!.hits;
    expect(balloon).toHaveLength(1);
    expect(balloon[0]).toMatchObject({
      name: "Hit by an explosion",
      sources: [{ type: 41, part: "explosion", routine: 500 }],
      writes: [{ object: "part", offset: 0x12, value: c(1) }],
      condition: compare(masked("part", 6, 0x1000), "!=", c(0)),
      conditionWords: ["on the moving list"],
    });
  });

  it("walks a part that touches another part whose bounce callback changes it", () => {
    // The contact dispatch calls the touched part's bounce callback with the touching part as `collider`.
    const data = report();
    const tack = { ...part("thumb-tack", 53, []), routines: [{ slot: 0, address: 600, role: "bounce", ...proof }] };
    data.parts.push(tack as never);
    const angle = (value: number) => compare(f("collider", 0x88), "==", c(value));
    data.routines.push({
      address: 600,
      writes: [],
      ...proof,
      outcomes: [
        {
          ...proof,
          effectsComplete: true,
          condition: and(compare(f("collider", 4), "==", c(4)), angle(0x8000)),
          fields: [write("collider", 0x12, c(1))],
        },
        // A path that also changes the thumb tack itself isn't a walk of the balloon alone.
        {
          ...proof,
          effectsComplete: true,
          condition: and(compare(f("collider", 4), "==", c(4)), angle(0x5e00)),
          fields: [write("collider", 0x12, c(1)), write("part", 0x12, c(1))],
        },
      ],
    } as never);
    const balloon = hitsFromOthers(data, evaluateBehaviourCondition).get(4)!.hits;
    const touch = balloon.find((hit) => hit.name === "Touching a thumb tack")!;
    expect(touch).toMatchObject({
      sources: [{ type: 53, part: "thumb-tack", routine: 600 }],
      writes: [{ object: "part", offset: 0x12, value: c(1) }],
      condition: compare(f("part", 0x88), "==", c(0x8000)),
    });
    expect(touch.assumptions.join(" ")).toContain("The part touches the source");
    // The explosion's hit stays its own walk, though it writes the same.
    expect(balloon.map((hit) => hit.name)).toContain("Hit by an explosion");
  });

  it("splits the mouse motor's start by the step it gets, with the part's own test", () => {
    const motor = hits.get(6)!.hits;
    expect(motor.map((h) => h.writes.map((w) => [w.offset, w.value]))).toEqual([
      [
        [0x12, c(0xffff)],
        [0x96, c(100)],
      ],
      [
        [0x12, c(1)],
        [0x96, c(100)],
      ],
    ]);
    expect(motor.map((h) => h.condition)).toEqual([
      compare(masked("part", 8, 0x10), "!=", c(0)),
      compare(masked("part", 8, 0x10), "==", c(0)),
    ]);
  });

  it("leaves out outcomes that name no type, set an unknown value or a field no rule reads", () => {
    expect(hits.get(12)).toBeUndefined();
    expect(hits.get(41)).toBeUndefined();
    expect(hits.get(6)!.hits).toHaveLength(2);
  });

  it("walks the balloon from its reset frame after the hit", () => {
    const balloon = describeBehaviour(report()).parts[0]!;
    const hit = balloon.animations.find((a) => a.id === "hit-0")!;
    expect(hit.trigger).toMatchObject({ kind: "related-write", name: "Hit by an explosion" });
    expect(hit.walk.states).toEqual([0, 1, 1]);
    expect(hit.walk.status).toBe("rest");
  });
});
