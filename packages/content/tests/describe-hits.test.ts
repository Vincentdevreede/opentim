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

const flags = (offset: number, mask: number, set: boolean) => ({ ...proof, offset, mask, set });
const search = (address: number, memberTests: ReturnType<typeof flags>[]) => ({
  ...proof,
  address,
  kind: "overlap-list",
  list: { memberTests },
});
/** A routine whose loop goes over the list one search call fills. */
const fromSearch = (
  address: number,
  header: number,
  call: number,
  query: number,
  found: ReturnType<typeof outcome>,
) => ({
  address,
  writes: [],
  ...proof,
  listLoops: [{ header, source: "overlap-query", queries: [call] }],
  engineCalls: [{ ...proof, instruction: call, summary: query, purpose: "Synthetic search." }],
  iterationOutcomes: [{ ...found, header }],
});

/**
 * A balloon and a mouse motor whose run reads the control value at 0x12, and an explosion that hits them. A rocket
 * that a candle lights, and a bullet a jack-in-the-box punches, whose sources name no type.
 */
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
      part("rocket", 36, [rule(c(1), compare(f("part", 0x12), "!=", c(0)))]),
      part("bullet", 20, [rule(c(1), compare(f("part", 0x36), "!=", c(0)))]),
      part("candle", 45, [], [600]),
      part("jack-in-the-box", 13, [], [700]),
    ],
    helpers: [
      search(0x448e, [flags(0x0a, 4, true), flags(8, 0x2000, false)]),
      search(0x42da, [flags(8, 0x2000, false)]),
      {
        ...proof,
        address: 0x15d9b,
        kind: "part-factory",
        factory: { constructorFlags: [{ ...proof, type: 36, field: 0x0a, mask: 4 }] },
      },
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
      // The candle's first search: it lights every part it finds that isn't lit yet, and names no type.
      fromSearch(
        600,
        0x19acd,
        0x19ab2,
        0x448e,
        outcome(compare(f(MEMBER, 0x12), "==", c(0)), [write(MEMBER, 0x12, c(1))]),
      ),
      // The jack-in-the-box's punch on any part on the moving list.
      fromSearch(700, 0x1b9c8, 0x1b92f, 0x42da, outcome(moving, [write(MEMBER, 0x36, c(0xf800))])),
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

  it("walks a part no source names when the search's tests are known and the type gets the flags they need", () => {
    const rocket = hits.get(36)!.hits;
    expect(rocket).toHaveLength(1);
    expect(rocket[0]).toMatchObject({
      name: "Hit by a candle",
      writes: [{ object: "part", offset: 0x12, value: c(1) }],
      condition: and(
        compare(f("part", 0x12), "==", c(0)),
        compare(masked("part", 0x0a, 4), "!=", c(0)),
        compare(masked("part", 8, 0x2000), "==", c(0)),
      ),
    });
    // The balloon reads the control value too, but no code gives it the flag the candle's search needs.
    expect(hits.get(4)!.hits.map((h) => h.name)).toEqual(["Hit by an explosion"]);
    expect(hits.get(20)!.hits).toMatchObject([
      {
        name: "Hit by a jack in the box",
        writes: [{ offset: 0x36, value: c(0xf800) }],
        condition: and(compare(masked("part", 6, 0x1000), "!=", c(0)), compare(masked("part", 8, 0x2000), "==", c(0))),
      },
    ]);
  });

  it("walks the balloon from its reset frame after the hit", () => {
    const balloon = describeBehaviour(report()).parts[0]!;
    const hit = balloon.animations.find((a) => a.id === "hit-0")!;
    expect(hit.trigger).toMatchObject({ kind: "related-write", name: "Hit by an explosion" });
    expect(hit.walk.states).toEqual([0, 1, 1]);
    expect(hit.walk.status).toBe("rest");
  });
});
