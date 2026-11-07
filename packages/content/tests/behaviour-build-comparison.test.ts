import { describe, expect, it } from "vitest";
import { choose } from "../src/read/behaviour.ts";
import type { BehaviourReport, Expression, Predicate } from "../src/read/behaviour.ts";
import { partSemantics, semantic } from "../src/read/behaviour-build-comparison.ts";

const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
const field = (offset: number, object = "part"): Expression => ({ kind: "field", object, offset, width: 16 });
const compare = (operator: string, left: Expression, right: Expression) =>
  ({ kind: "compare", operator, left, right, signed: false }) as Extract<Predicate, { kind: "compare" }>;
const raw = (operator: string, left: Expression, right: Expression): Expression =>
  ({ kind: "binary", operator, left, right, width: 16 }) as Expression;
const same = (a: unknown, b: unknown) => expect(JSON.stringify(semantic(a))).toBe(JSON.stringify(semantic(b)));

describe("what the build comparison compares", () => {
  it("takes two shifts by numbers as one shift", () => {
    same(raw("<<", raw("<<", field(12), constant(1, 8)), constant(1, 8)), raw("<<", field(12), constant(2, 8)));
  });

  it("takes a chain of + in any grouping and order", () => {
    const [a, b, c] = [field(2), field(4), field(6)];
    same(raw("+", a, raw("+", b, c)), raw("+", raw("+", c, a), b));
    expect(JSON.stringify(semantic(raw("+", a, b)))).not.toBe(JSON.stringify(semantic(raw("-", a, b))));
  });

  it("takes a choice by its cases, whatever order its tests come in", () => {
    const [t1, t2] = [compare("==", field(8), constant(0)), compare("!=", field(14), constant(0))];
    const [x, y, z] = [constant(1), constant(2), constant(3)];
    // t1 ? (t2 ? x : y) : z, and the same tested t2 first.
    const first = choose(t1, choose(t2, x, y), z);
    const second = choose(t2, choose(t1, x, z), choose(t1, y, z));
    same(first, second);
    expect(JSON.stringify(semantic(first))).not.toBe(JSON.stringify(semantic(choose(t1, choose(t2, y, x), z))));
  });

  it("takes two findings that differ in one test, one way and the other, as one without it", () => {
    const [a, b] = [compare("!=", field(18), constant(0)), compare("==", field(12), field(14))];
    const notB = compare("!=", field(12), field(14));
    const effect = (condition: Predicate) => ({ object: "part", offset: 42, value: constant(5), condition });
    same(
      [effect({ kind: "and", terms: [a, b] } as Predicate), effect({ kind: "and", terms: [notB, a] } as Predicate)],
      [effect(a)],
    );
    // Other values stay apart.
    expect(
      (semantic([effect({ kind: "and", terms: [a, b] } as Predicate), { ...effect(notB), value: constant(6) }]) as [])
        .length,
    ).toBe(2);
  });

  it("numbers a part's globals by where its findings use them, so builds with other offsets compare equal", () => {
    const part = (globals: [number, number]) =>
      ({
        type: 1,
        id: "brick-wall",
        routines: [],
        stateWrites: [],
        counters: [],
        reset: [],
        visibleEffects: [],
        triggers: [],
        transitions: [
          { from: [0], to: 1, condition: compare("==", field(globals[0], "data"), constant(0)), updates: [] },
          { from: [1], to: 0, condition: compare("==", field(globals[1], "data"), constant(0)), updates: [] },
        ],
      }) as unknown as BehaviourReport["parts"][number];
    const report = {} as BehaviourReport;
    const of = (globals: [number, number]) => JSON.stringify(partSemantics(part(globals), report));
    expect(of([20073, 20101])).toBe(of([20457, 20485]));
    // The same global twice is not two globals.
    expect(of([20073, 20073])).not.toBe(of([20457, 20485]));
  });
});
