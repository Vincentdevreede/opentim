import { describe, expect, it } from "vitest";
import type { BehaviourReport, Expression, FieldWrite, Predicate, Transition } from "../src/read/behaviour.ts";
import {
  CONTROL_VALUE_ASSUMPTION,
  CONVEYOR_BELT_ASSUMPTION,
  ELECTRIC_MOTOR_ASSUMPTION,
  GEAR_ASSUMPTION,
  MONKEY_BIKE_ASSUMPTION,
  MONKEY_BIKE_REACTION_ASSUMPTION,
  MOUSE_MOTOR_ASSUMPTION,
  TEETER_TOTTER_END_ASSUMPTION,
} from "../src/read/behaviour-saved-frames.ts";
import {
  START,
  describeBehaviour,
  walkBehaviourRules,
  type AnimationDescription,
  type BehaviourWalk,
  type KnownField,
} from "../src/read/describe-behaviour.ts";
import type { MeasuredClip } from "../src/read/behaviour-validation.ts";
import { compareMeasuredWalks } from "../src/read/behaviour-walk-validation.ts";

const proof = {
  confidence: "inferred" as const,
  assumptions: ["Synthetic extracted rule"],
  evidence: [{ address: 0x123, bytes: [0x90], text: "nop" }],
};
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const field = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
const add = (offset: number, value: number): Expression => ({
  kind: "binary",
  operator: "+",
  left: field(offset),
  right: constant(value),
  width: 16,
});
const test = (offset: number, operator: string, value: number): Predicate => ({
  kind: "compare",
  left: field(offset),
  operator,
  right: constant(value),
  signed: false,
});
const both = (...terms: Predicate[]): Predicate => ({ kind: "and", terms });
const write = (offset: number, value: Expression): FieldWrite => ({
  object: "part",
  offset,
  width: 16,
  value,
  condition: { kind: "true" },
  routine: 100,
  ...proof,
});
const rule = (
  to: Expression,
  condition: Predicate,
  updates: FieldWrite[] = [],
): Transition & { updates: FieldWrite[] } => ({ from: null, to, condition, updates, routine: 100, ...proof });
const known = (offset: number, value: number): KnownField => ({
  object: "part",
  offset,
  width: 16,
  value,
  knownMask: 0xffff,
  ...proof,
});

function report(transitions: Transition[], reset: FieldWrite[] = [write(12, constant(0))]): BehaviourReport {
  return {
    listId: "synthetic",
    imageLength: 0,
    dataSegment: 0,
    layout: {
      fields: [
        { name: "state", offset: 12, ...proof },
        { name: "type", offset: 4, ...proof },
        { name: "flags", offset: 8, ...proof },
      ],
      ...proof,
    },
    timing: { diagnostics: [] },
    assumptions: [],
    relatedObjectEffects: [],
    parts: [
      {
        id: "trampoline",
        type: 39,
        frameCount: 3,
        routines: [
          { slot: 1, address: 100, role: "run callback candidate", ...proof },
          { slot: 2, address: 200, role: "reset callback candidate", ...proof },
          { slot: 0, address: 300, role: "bounce callback candidate", ...proof },
        ],
        stateWrites: [],
        transitions,
        counters: [],
        reset,
        visibleEffects: [],
        triggers: [],
        uncertainties: [],
      },
    ],
    routines: [
      { address: 100, writes: [], ...proof },
      { address: 200, writes: reset, outcomes: [{ condition: { kind: "true" }, fields: reset, ...proof }], ...proof },
      { address: 300, writes: [], outcomes: [], ...proof },
    ],
  } as unknown as BehaviourReport;
}

describe("descriptions from extracted behaviour rules", () => {
  it("does not derive a starting state through untracked callback effects", () => {
    const data = report([rule(field(12), test(12, "==", 0))]);
    data.routines[2]!.outcomes = [
      {
        ...proof,
        effectsComplete: false,
        condition: { kind: "true" },
        fields: [write(12, constant(1))],
        returnValue: constant(0),
        confidence: "unresolved",
      },
    ];
    const animation = describeBehaviour(data).parts[0]!.animations.find((item) => item.trigger.kind === "callback")!;
    expect(animation.walk.states).toEqual([]);
    expect(animation.walk.reason).toContain("untracked");
  });

  it("applies a related producer's final state and timer together", () => {
    const data = report(
      [rule(field(12), both(test(12, "==", 0), test(0x12, "==", 0)))],
      [write(12, constant(0)), write(0x12, constant(0)), write(0x96, constant(0))],
    );
    const object = "referenced-by(part+0x78)";
    const activation = { ...write(0x12, constant(1)), object, routine: 400 };
    const timer = { ...write(0x96, constant(100)), object, routine: 400 };
    data.relatedObjectEffects = [{ ...proof, sourceType: 62, sourcePart: "teapot", targetType: 39, write: activation }];
    data.routines.push({
      ...data.routines[0]!,
      address: 400,
      outcomes: [
        {
          ...proof,
          effectsComplete: true,
          condition: { kind: "true" },
          fields: [activation, timer],
          returnValue: constant(0),
        },
      ],
    });
    const activationDescription = describeBehaviour(data).parts[0]!.animations.find(
      (item) => item.trigger.kind === "related-write",
    )!;
    expect(activationDescription.initialFields?.find((item) => item.offset === 0x96)).toMatchObject({ value: 100 });
    expect(activationDescription.initialFields?.find((item) => item.offset === 0x12)).toMatchObject({ value: 1 });
  });

  it("walks a triggered counter animation back to rest with evidence and exact run counts", () => {
    const rules = [
      rule(field(12), both(test(12, "==", 1), test(0x96, "<", 3)), [write(0x96, add(0x96, 1))]),
      rule(constant(2), both(test(12, "==", 1), test(0x96, ">=", 3)), [write(0x96, constant(0))]),
      rule(field(12), both(test(12, "==", 2), test(0x96, "<", 1)), [write(0x96, add(0x96, 1))]),
      rule(constant(0), both(test(12, "==", 2), test(0x96, ">=", 1)), [write(0x12, constant(0))]),
      rule(field(12), test(12, "==", 0)),
    ];
    const data = report(rules, [write(12, constant(0)), write(0x12, constant(0)), write(0x96, constant(0))]);
    const bounce = data.routines[2] as unknown as { outcomes: unknown[] };
    bounce.outcomes = [
      {
        condition: test(0x84, "!=", 0),
        fields: [write(12, constant(1)), write(0x12, constant(1)), write(0x96, constant(0))],
        ...proof,
      },
    ];
    const description = describeBehaviour(data).parts[0]!;
    const animation = description.animations.find((item) => item.trigger.kind === "callback")!;
    expect(description.rest.state).toBe(0);
    expect(animation.trigger.condition).toEqual(test(0x84, "!=", 0));
    expect(animation.walk.states).toEqual([1, 1, 1, 1, 2, 2, 0, 0]);
    expect(animation.walk.frames.map((frame) => [frame.state, frame.runCalls])).toEqual([
      [1, 4],
      [2, 2],
      [0, 1],
    ]);
    expect(animation.walk.status).toBe("rest");
    expect(animation.walk.frames.every((frame) => frame.gameSteps === undefined)).toBe(true);
    expect(animation.walk.evidence[0]?.address).toBe(0x123);
  });

  it("derives a conditional stable ending from code without claiming it is the reset state", () => {
    const ending = both(test(0x12, "!=", 0), test(12, ">=", 2));
    const data = report(
      [
        rule(field(12), test(0x12, "==", 0)),
        rule(add(12, 1), both(test(0x12, "!=", 0), test(12, "<", 2))),
        rule(constant(0), ending, [write(0x12, constant(0))]),
      ],
      [],
    );
    (data.routines[2] as unknown as { outcomes: unknown[] }).outcomes = [
      {
        condition: test(0x84, "!=", 0),
        fields: [write(0x12, constant(1))],
        ...proof,
      },
    ];
    const part = describeBehaviour(data).parts[0]!;
    expect(part.rest.status).toBe("unresolved");
    expect(part.stableStates.map((state) => state.state)).toEqual([0]);
    const animation = part.animations.find(
      (item) => item.initial === "documented-rest" && item.trigger.kind === "callback",
    )!;
    expect(animation.prerequisites[0]!.condition).toEqual(ending);
    expect(animation.walk.states).toEqual([0, 1, 2, 0, 0]);
    expect(animation.walk.status).toBe("rest");
  });

  it("separates an unresolved trigger event from its known conditional owner write", () => {
    const data = report(
      [
        rule(field(12), test(0x12, "==", 0)),
        rule(add(12, 1), both(test(0x12, "!=", 0), test(12, "<", 2))),
        rule(constant(0), both(test(0x12, "!=", 0), test(12, ">=", 2)), [write(0x12, constant(0))]),
      ],
      [],
    );
    (data.routines[2] as unknown as { outcomes: unknown[] }).outcomes = [
      {
        condition: {
          kind: "compare",
          operator: "<",
          left: { kind: "unknown", reason: "Collider geometry", width: 16 },
          right: constant(1024),
          signed: true,
        },
        fields: [
          { ...write(0x12, constant(1)), confidence: "unresolved" },
          { ...write(0x36, { kind: "unknown", reason: "Collider velocity", width: 16 }), object: "collider" },
        ],
        ...proof,
        confidence: "unresolved",
        effectsComplete: true,
      },
    ];
    const part = describeBehaviour(data).parts[0]!;
    const animation = part.animations.find(
      (item) => item.initial === "documented-rest" && item.trigger.kind === "callback",
    )!;
    expect(animation.trigger.confidence).toBe("unresolved");
    expect(animation.confidence).toBe("unresolved");
    expect(animation.walk).toMatchObject({ states: [0, 1, 2, 0, 0], status: "rest", confidence: "inferred" });
    expect(
      animation.walk.assumptions.some((assumption) => assumption.includes("If this recorded trigger write is reached")),
    ).toBe(true);
  });

  it("partitions a control parameter using only constants assigned by extracted producers", () => {
    const next: Expression = { kind: "binary", operator: "+", left: field(12), right: field(0x12), width: 16 };
    const compareNext = (operator: string, value: number): Predicate => ({
      kind: "compare",
      left: next,
      operator,
      right: constant(value),
      signed: true,
    });
    const data = report([
      rule(field(12), test(0x12, "==", 0)),
      rule(constant(2), both(test(0x12, "!=", 0), compareNext("<", 0))),
      rule(constant(0), both(test(0x12, "!=", 0), compareNext(">", 2))),
      rule(next, both(test(0x12, "!=", 0), compareNext(">=", 0), compareNext("<=", 2))),
    ]);
    data.layout.fields.push({ name: "stateDelta", offset: 0x12, ...proof });
    data.routines[2]!.writes = [write(0x12, constant(1)), write(0x12, constant(0xffff))];
    const cases = describeBehaviour(data).parts[0]!.animations.filter((item) => item.trigger.kind === "input-case");
    const controls = new Set(
      cases.flatMap(
        (item) => item.initialFields?.filter((field) => field.offset === 0x12).map((field) => field.value) ?? [],
      ),
    );
    expect(controls.has(1)).toBe(true);
    expect(controls.has(0xffff)).toBe(true);
    expect(controls.has(2)).toBe(false);
    expect(
      cases.some((item) => item.walk.status === "loop" && item.walk.states.slice(0, 4).join(",") === "0,1,2,0"),
    ).toBe(true);
    expect(cases.some((item) => item.trigger.name.includes("state-control value is 1"))).toBe(true);
  });

  it("leaves out an input case that needs a frame the part doesn't have", () => {
    const data = report([rule(field(12), test(12, "<=", 2)), rule(constant(0), test(12, ">", 2))]);
    data.parts[0]!.frameCount = 3;
    const names = describeBehaviour(data)
      .parts[0]!.animations.filter((item) => item.trigger.kind === "input-case")
      .map((item) => item.trigger.name);
    expect(names.some((name) => name.includes("at most 2"))).toBe(true);
    expect(names.some((name) => name.includes("above 2"))).toBe(false);
  });

  it("does not replace a nonzero control by one when no code producer assigns one", () => {
    const data = report([
      rule(field(12), test(0x12, "==", 0)),
      rule({ kind: "binary", operator: "+", left: field(12), right: field(0x12), width: 16 }, test(0x12, "!=", 0)),
      rule(constant(0), test(12, "==", 2)),
    ]);
    const cases = describeBehaviour(data).parts[0]!.animations.filter((item) => item.trigger.kind === "input-case");
    expect(cases.some((item) => item.initialFields?.some((field) => field.offset === 0x12 && field.value === 1))).toBe(
      false,
    );
  });

  it("continues across complementary unknown guards with identical field transfers", () => {
    const data = report([
      rule(constant(1), both(test(12, "==", 0), test(8, "==", 0))),
      rule(constant(1), both(test(12, "==", 0), test(8, "!=", 0))),
      rule(field(12), test(12, "==", 1)),
    ]);
    expect(walkBehaviourRules(data, 39, [known(12, 0)])).toMatchObject({ states: [0, 1, 1], status: "rest" });
  });

  it("follows each rule an unknown input chooses, as a conditional branch with its own ending", () => {
    const data = report([
      rule(constant(1), both(test(12, "==", 0), test(8, "==", 0))),
      rule(constant(2), both(test(12, "==", 0), test(8, "!=", 0))),
      rule(field(12), test(12, "==", 1)),
      rule(field(12), test(12, "==", 2)),
    ]);
    const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
    expect(walk).toMatchObject({ states: [0], status: "unresolved", stop: { kind: "ambiguity" } });
    const branches = walk.stop!.branches!;
    expect(branches.map((branch) => [branch.condition, branch.walk.states, branch.walk.status])).toEqual([
      [both(test(12, "==", 0), test(8, "==", 0)), [1, 1], "rest"],
      [both(test(12, "==", 0), test(8, "!=", 0)), [2, 2], "rest"],
    ]);
    expect(walkBehaviourRules(data, 39, [known(12, 0)], { branchDepth: 0 }).stop?.branches).toBeUndefined();
  });

  it("continues past a rule whose only unresolved part is a written value when the run covers every path", () => {
    const unknownValue: Expression = { kind: "unknown", reason: "A scan result", width: 16 };
    const step = {
      ...rule(constant(1), test(12, "==", 0), [write(0x20, unknownValue)]),
      confidence: "unresolved" as const,
    };
    const data = report([step, rule(field(12), test(12, "==", 1))]);
    const settled = {
      ...proof,
      effectsComplete: true,
      condition: { kind: "true" },
      fields: [],
      returnValue: constant(0),
      confidence: "inferred",
    };
    Object.assign(data.routines[0]!, { uncertainties: [], outcomes: [settled] as never });
    const walk = walkBehaviourRules(data, 39, [known(12, 0), known(0x20, 5)]);
    expect(walk).toMatchObject({ states: [0, 1, 1], status: "rest", confidence: "inferred" });
    expect(walk.fields.find((field) => field.offset === 0x20)).toBeUndefined();
    Object.assign(data.routines[0]!, { uncertainties: ["Back edge requires a loop invariant"] });
    expect(walkBehaviourRules(data, 39, [known(12, 0)]).stop?.kind).toBe("effects");
  });

  it("branches on a value the same run computed without carrying it into later runs", () => {
    const scanned: Expression = {
      kind: "field",
      object: "part after unresolved write at 0x50",
      offset: 0x12,
      width: 16,
      unresolved: true,
    };
    const scan = (operator: string): Predicate => ({
      kind: "compare",
      left: scanned,
      operator,
      right: constant(0),
      signed: false,
    });
    const data = report([
      rule(constant(1), both(test(12, "==", 0), scan("=="))),
      rule(constant(2), both(test(12, "==", 0), scan("!="))),
      rule(field(12), test(12, "==", 1)),
      rule(field(12), test(12, "==", 2)),
    ]);
    data.routines[0] = {
      ...data.routines[0]!,
      uncertainties: [],
      outcomes: [
        { ...proof, effectsComplete: true, condition: { kind: "true" }, fields: [], returnValue: constant(0) },
      ],
    } as never;
    const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
    expect(walk.stop?.branches?.map((branch) => [branch.walk.states, branch.walk.status])).toEqual([
      [[1, 1], "rest"],
      [[2, 2], "rest"],
    ]);
  });

  it("goes on past a helper that keeps the state, forgetting the other fields", () => {
    const unresolved = {
      ...rule(field(12), test(12, "==", 0), [write(0x62, { kind: "unknown", reason: "x", width: 16 } as never)]),
      confidence: "unresolved" as const,
    };
    const data = report([unresolved]);
    const outcome = (more: object) =>
      ({ ...proof, condition: test(12, "==", 0), fields: [], returnValue: constant(0), ...more }) as never;
    data.routines[0] = {
      ...data.routines[0]!,
      uncertainties: [],
      uncertainEffects: true,
      returnPathsComplete: true,
      outcomes: [outcome({ effectsComplete: false, keepsState: true })],
    } as never;
    const walk = walkBehaviourRules(data, 39, [known(12, 0), known(4, 39)]);
    expect([walk.states, walk.status]).toEqual([[0, 0, 0], "rest"]);
    expect(walk.fields.find((item) => item.offset === 4)?.knownMask ?? 0).toBe(0);
    // A path whose effects are incomplete for another reason still stops the walk.
    (data.routines[0] as unknown as { outcomes: unknown[] }).outcomes = [outcome({ effectsComplete: false })];
    expect(walkBehaviourRules(data, 39, [known(12, 0)]).stop?.kind).toBe("effects");
  });

  it("ends a branch that reaches a state another branch of the same walk already follows", () => {
    const scanned: Expression = {
      kind: "field",
      object: "part after unresolved write at 0x50",
      offset: 0x12,
      width: 16,
      unresolved: true,
    };
    const scan = (operator: string): Predicate => ({
      kind: "compare",
      left: scanned,
      operator,
      right: constant(0),
      signed: false,
    });
    const data = report([
      rule(constant(1), both(test(12, "==", 0), scan("=="))),
      rule(constant(2), both(test(12, "==", 0), scan("!="))),
      rule(constant(2), test(12, "==", 1)),
      rule(field(12), test(12, "==", 2)),
    ]);
    data.routines[0] = {
      ...data.routines[0]!,
      uncertainties: [],
      outcomes: [
        { ...proof, effectsComplete: true, condition: { kind: "true" }, fields: [], returnValue: constant(0) },
      ],
    } as never;
    const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
    // The first branch goes 1 then 2 and holds there; the second starts at 2, which the first already follows.
    expect(walk.stop?.branches?.map((branch) => [branch.walk.states, branch.walk.status])).toEqual([
      [[1, 2, 2], "rest"],
      [[2], "joins"],
    ]);
    // It names where it continues: the first branch, at its second state.
    expect(walk.stop?.branches?.[1]?.walk.joined).toEqual({ path: [0], index: 1, sameTests: true });
  });

  it("walks each starting state a partly known seed allows, keeping only states with a frame", () => {
    const data = report(
      [rule(constant(1), test(12, "==", 0)), rule(field(12), test(12, "==", 1)), rule(field(12), test(12, "==", 2))],
      [],
    );
    const partial = { ...known(12, 0), knownMask: 0xfffc };
    const walk = walkBehaviourRules(data, 39, [partial]);
    expect(walk.stop?.kind).toBe("state");
    expect(walk.stop?.branches?.map((branch) => [branch.condition, branch.walk.states, branch.walk.status])).toEqual([
      [test(12, "==", 0), [0, 1, 1], "rest"],
      [test(12, "==", 1), [1, 1], "rest"],
      [test(12, "==", 2), [2, 2], "rest"],
    ]);
    const none = walkBehaviourRules(data, 39, []);
    expect(none.stop?.branches?.map((branch) => [branch.condition, branch.walk.states])).toEqual([
      [test(12, "==", 0), [0, 1, 1]],
      [test(12, "==", 1), [1, 1]],
      [test(12, "==", 2), [2, 2]],
    ]);
    // More than three unknown bits still allow only the frames, like a generator whose reset keeps two bits.
    const wide = walkBehaviourRules(data, 39, [{ ...known(12, 0), knownMask: 0xfff0 }]);
    expect(wide.stop?.branches?.map((branch) => branch.condition)).toEqual([0, 1, 2].map((n) => test(12, "==", n)));
    data.parts[0]!.frameCount = 16;
    const low = walkBehaviourRules(data, 39, [{ ...known(12, 3), knownMask: 0x0003 }]);
    expect(low.stop?.branches?.map((branch) => branch.condition)).toEqual([3, 7, 11, 15].map((n) => test(12, "==", n)));
    // Up to 32 frames, like the fish bowl's 23, each frame is a starting state.
    data.parts[0]!.frameCount = 23;
    expect(walkBehaviourRules(data, 39, []).stop?.branches?.map((branch) => branch.walk.states[0])).toEqual([
      ...Array(23).keys(),
    ]);
    data.parts[0]!.frameCount = 33;
    expect(walkBehaviourRules(data, 39, []).stop?.branches).toBeUndefined();
    data.parts[0]!.frameCount = 0;
    expect(walkBehaviourRules(data, 39, []).stop?.branches).toBeUndefined();
    expect(walkBehaviourRules(data, 39, [{ ...known(12, 0), knownMask: 0xfff0 }]).stop?.branches).toBeUndefined();
  });

  it("lists where a stopping field's value comes from without claiming every writer", () => {
    const sum: Expression = { kind: "binary", operator: "+", left: field(12), right: field(0x12), width: 16 };
    const data = report([rule(sum, test(0x12, "!=", 0)), rule(field(12), test(0x12, "==", 0))]);
    data.routines[2]!.outcomes = [
      { ...proof, effectsComplete: true, condition: { kind: "true" }, fields: [write(0x12, constant(1))] },
    ] as never;
    data.relatedObjectEffects = [
      {
        ...proof,
        sourceType: 50,
        sourcePart: "electric-motor",
        write: { ...write(0x12, constant(0xffff)), object: "referenced-by(part+0x54)" },
      },
    ];
    const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
    expect(walk.stop?.kind).toBe("state");
    expect(walk.stop?.producers?.map((item) => [item.source, item.value])).toEqual([
      ["bounce", constant(1)],
      ["electric-motor", constant(0xffff)],
    ]);
    // Each number a writer gives is followed on its own; any other value keeps the stop.
    const branches = walk.stop?.branches ?? [];
    expect(branches.map((branch) => branch.condition)).toEqual([
      test(0x12, "==", 1),
      test(0x12, "==", 0xffff),
      { kind: "and", terms: [test(0x12, "!=", 1), test(0x12, "!=", 0xffff)] },
    ]);
    expect(branches[0]!.walk.states.slice(0, 3)).toEqual([0, 1, 2]);
    expect(branches[2]!.walk.stop?.kind).toBe("state");
  });

  describe("ways a run decides by itself", () => {
    const settled = (data: ReturnType<typeof report>) => {
      data.routines[0] = {
        ...data.routines[0]!,
        uncertainties: [],
        returnPathsComplete: true,
        outcomes: [
          { ...proof, effectsComplete: true, condition: { kind: "true" }, fields: [], returnValue: constant(0) },
        ],
      } as never;
      return data;
    };
    const compare = (left: Expression, operator: string, value: number): Predicate => ({
      kind: "compare",
      left,
      operator,
      right: constant(value),
      signed: false,
    });
    const answer: Expression = {
      kind: "field",
      object: "answer of the query at 0x50",
      offset: 0,
      width: 16,
      unresolved: true,
    };
    const found: Expression = { kind: "field", object: "member found by the loop at 0x60", offset: 4, width: 16 };

    it("branches on the fields of a part the run found, like the type of the part a cat looks at", () => {
      const data = settled(
        report([
          rule(constant(1), both(test(12, "==", 0), compare(found, "==", 42))),
          rule(constant(2), both(test(12, "==", 0), compare(found, "!=", 42))),
          rule(field(12), test(12, "==", 1)),
          rule(field(12), test(12, "==", 2)),
        ]),
      );
      const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
      expect(walk.stop?.branches?.map((branch) => [branch.walk.states, branch.walk.status])).toEqual([
        [[1, 1], "rest"],
        [[2, 2], "rest"],
      ]);
    });

    it("branches on whether a gear's train is blocked, a value the run works out from the other gears", () => {
      const blocked: Expression = { kind: "field", object: "gear connection conflict at 0x70", offset: 0, width: 16 };
      const data = settled(
        report([
          rule(constant(1), both(test(12, "==", 0), compare(blocked, "==", 0))),
          rule(constant(2), both(test(12, "==", 0), compare(blocked, "!=", 0))),
          rule(field(12), test(12, "==", 1)),
          rule(field(12), test(12, "==", 2)),
        ]),
      );
      const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
      expect(walk.stop?.branches?.map((branch) => [branch.walk.states, branch.walk.status])).toEqual([
        [[1, 1], "rest"],
        [[2, 2], "rest"],
      ]);
    });

    it("follows each rule from an unknown frame when every rule gives a known next frame, like the pinball bumper", () => {
      const rules = [
        rule(field(12), both(test(0x12, "==", 0), test(12, "==", 0))),
        rule(constant(0), both(test(0x12, "==", 0), test(12, "!=", 0))),
        rule(constant(1), test(0x12, "!=", 0), [write(0x12, constant(0))]),
      ];
      const drawn = () => {
        const data = settled(report(rules));
        data.parts[0] = { ...data.parts[0]!, frameCount: 0 } as never;
        return data;
      };
      const walk = walkBehaviourRules(drawn(), 39, []);
      const branches = walk.stop?.branches ?? [];
      expect(branches.map((branch) => branch.walk.states[0])).toEqual([0, 1]);
      expect(branches.every((branch) => ["rest", "joins"].includes(branch.walk.status))).toBe(true);
      // Hit, only one rule applies: the walk goes on from the frame it gives.
      const hit = walkBehaviourRules(drawn(), 39, [known(0x12, 1)]);
      expect(hit.stop?.branches?.map((branch) => [branch.walk.states, branch.walk.status])).toEqual([
        [[1, 0, 0], "rest"],
      ]);
    });

    it("follows rules that lead to the same next fields as one way, under what they all test", () => {
      const data = settled(
        report([
          rule(constant(1), both(test(12, "==", 0), compare(answer, "==", 0))),
          rule(constant(1), both(test(12, "==", 0), compare(answer, "!=", 0), compare(found, "==", 42))),
          rule(constant(2), both(test(12, "==", 0), compare(answer, "!=", 0), compare(found, "!=", 42))),
          rule(field(12), test(12, "==", 1)),
          rule(field(12), test(12, "==", 2)),
        ]),
      );
      const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
      const branches = walk.stop?.branches ?? [];
      expect(branches.map((branch) => branch.walk.states)).toEqual([
        [1, 1],
        [2, 2],
      ]);
      expect(branches[0]!.condition).toEqual({ kind: "and", terms: [test(12, "==", 0)] });
      expect(branches[0]!.alternatives).toHaveLength(2);
      expect(branches[1]!.alternatives).toBeUndefined();
    });

    it("ends a branch that knows more tests than another branch following the same state", () => {
      const data = settled(
        report([
          rule(constant(2), both(test(12, "==", 0), compare(answer, "==", 0))),
          rule(constant(1), both(test(12, "==", 0), compare(answer, "!=", 0), test(0x40, "==", 0))),
          rule(field(12), both(test(12, "==", 0), compare(answer, "!=", 0), test(0x40, "!=", 0))),
          rule(constant(2), test(12, "==", 1)),
          rule(field(12), test(12, "==", 2)),
        ]),
      );
      const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
      // The second branch reaches frame 2 knowing the field at 0x40 is 0. The first follows frame 2 knowing nothing
      // about it, which covers that case too. The third stays at frame 0, which the walk itself follows.
      expect(walk.stop?.branches?.map((branch) => [branch.walk.states, branch.walk.status])).toEqual([
        [[2, 2], "rest"],
        [[1, 2], "joins"],
        [[0], "joins"],
      ]);
      // Both knew more tests than the place they continue at: the first branch's start, and the walk's own start.
      expect(walk.stop?.branches?.slice(1).map((branch) => branch.walk.joined)).toEqual([
        { path: [0], index: 0, sameTests: false },
        { path: [], index: 0, sameTests: false },
      ]);
    });

    describe("widening at the branch depth limit", () => {
      /** Every walk at the end of a branch, with how deep it lies. */
      const leaves = (walk: BehaviourWalk, depth = 0): { walk: BehaviourWalk; depth: number }[] =>
        walk.stop?.branches?.length
          ? walk.stop.branches.flatMap((branch) => leaves(branch.walk, depth + 1))
          : [{ walk, depth }];
      const nodes = (walk: BehaviourWalk): BehaviourWalk[] => [
        walk,
        ...(walk.stop?.branches ?? []).flatMap((branch) => nodes(branch.walk)),
      ];
      const widened = (walk: BehaviourWalk) => walk.assumptions.some((text) => text.includes("branch depth limit"));
      /**
       * Like the mouse motor in TIM 1: at every step the run's answer either keeps the part as it is, or flips its
       * frame and counts its counter at 0x96 down. The counter starts at 0, so it goes through every number and no
       * state repeats.
       */
      const motor = () => {
        const count = write(0x96, add(0x96, -1));
        const data = settled(
          report([
            rule(field(12), compare(answer, "==", 0)),
            rule(constant(1), both(test(12, "==", 0), compare(answer, "!=", 0)), [count]),
            rule(constant(0), both(test(12, "==", 1), compare(answer, "!=", 0)), [count]),
          ]),
        );
        data.parts[0]!.frameCount = 2;
        return data;
      };

      it("forgets a counter that differs from an earlier state at the same frame, and then ends", () => {
        const walk = walkBehaviourRules(motor(), 39, [known(12, 0), known(0x96, 0)]);
        expect(leaves(walk).every((leaf) => ["rest", "loop", "joins"].includes(leaf.walk.status))).toBe(true);
        // The counter is known down to the depth limit; there the walk goes on without it.
        const wide = nodes(walk).filter(widened);
        expect(wide.length).toBeGreaterThan(0);
        expect(wide.every((node) => !node.fields.some((item) => item.offset === 0x96))).toBe(true);
        expect(Math.max(...leaves(walk).map((leaf) => leaf.depth))).toBeGreaterThan(24);
      });

      it("doesn't widen a walk that ends within the depth", () => {
        const walk = walkBehaviourRules(motor(), 39, [known(12, 0)]);
        expect(leaves(walk).every((leaf) => ["rest", "loop", "joins"].includes(leaf.walk.status))).toBe(true);
        expect(nodes(walk).some(widened)).toBe(false);
      });

      it("stops as before when no earlier state at the same frame differs", () => {
        const walk = walkBehaviourRules(motor(), 39, [known(12, 0), known(0x96, 0)], { branchDepth: 0 });
        expect(walk).toMatchObject({ states: [0], status: "unresolved", stop: { kind: "ambiguity" } });
        expect(walk.stop?.branches).toBeUndefined();
      });
    });
  });

  describe("states a decided assumption rules out", () => {
    /** A monkey bike with 13 frames, whose run rules are given. */
    const bike = (transitions: Transition[]) => {
      const data = report(transitions);
      data.parts[0] = { ...data.parts[0]!, id: "monkey-bike", frameCount: 13 } as never;
      data.routines[0] = {
        ...data.routines[0]!,
        uncertainties: [],
        returnPathsComplete: true,
        outcomes: [
          { ...proof, effectsComplete: true, condition: { kind: "true" }, fields: [], returnValue: constant(0) },
        ],
      } as never;
      return data;
    };

    it("doesn't start the monkey bike on a pedalling frame with its counter at 0", () => {
      const data = bike([rule(constant(0), { kind: "true" })]);
      const walk = walkBehaviourRules(data, 39, [known(0x96, 0)]);
      expect(walk.stop?.branches?.map((branch) => branch.walk.states[0])).toEqual([0, 1, 2, 3, 4]);
      expect(walk.assumptions).toContain(MONKEY_BIKE_ASSUMPTION);
    });

    it("doesn't follow the way where its counter is 0 on a pedalling frame, and follows the one left", () => {
      const data = bike([
        rule(constant(10), both(test(12, "==", 9), test(0x96, "!=", 0))),
        rule(constant(0), both(test(12, "==", 9), test(0x96, "==", 0))),
        rule(field(12), test(12, "==", 10)),
        rule(field(12), test(12, "==", 0)),
      ]);
      const walk = walkBehaviourRules(data, 39, [known(12, 9)]);
      expect(walk.stop?.branches?.map((branch) => [branch.walk.states, branch.walk.status])).toEqual([
        [[10, 10], "rest"],
      ]);
      expect(walk.assumptions).toContain(MONKEY_BIKE_ASSUMPTION);
    });
  });

  describe("the monkey bike's control value during its reaction", () => {
    const minus = (offset: number, value: number): Expression => ({
      kind: "binary",
      operator: "-",
      left: field(offset),
      right: constant(value),
      width: 16,
    });
    const counted = (operator: string): Predicate => ({
      kind: "compare",
      left: minus(0x96, 1),
      operator,
      right: constant(0),
      signed: false,
    });
    /**
     * Like the monkey bike's run: while its counter at 0x96 runs it shows frames 5 and 6, then frame 0, where it pedals
     * on to frame 1 unless its control value at 0x12 is 0. Its reaction never writes the control value.
     */
    const reacting = () => {
      const data = report([
        { ...rule(constant(6), both(test(0x96, "!=", 0), counted("!=")), [write(0x96, minus(0x96, 1))]), from: [5] },
        { ...rule(constant(5), both(test(0x96, "!=", 0), counted("!=")), [write(0x96, minus(0x96, 1))]), from: [6] },
        { ...rule(constant(0), both(test(0x96, "!=", 0), counted("==")), [write(0x96, minus(0x96, 1))]), from: [5, 6] },
        { ...rule(field(12), both(test(0x96, "==", 0), test(0x12, "==", 0))), from: [0, 1] },
        { ...rule(constant(1), both(test(0x96, "==", 0), test(0x12, "!=", 0))), from: [0, 1] },
      ]);
      data.parts[0] = { ...data.parts[0]!, id: "monkey-bike", frameCount: 13 } as never;
      data.routines[0] = {
        ...data.routines[0]!,
        uncertainties: [],
        returnPathsComplete: true,
        outcomes: [
          { ...proof, effectsComplete: true, condition: { kind: "true" }, fields: [], returnValue: constant(0) },
        ],
      } as never;
      return data;
    };
    const nodes = (walk: BehaviourWalk): BehaviourWalk[] => [
      walk,
      ...(walk.stop?.branches ?? []).flatMap((branch) => nodes(branch.walk)),
    ];
    const recording: MeasuredClip = {
      path: "synthetic",
      frames: [5, 6, 5, 6, 0].map((state, n) => ({ state, control: 0, timer: 4 - n })),
      loopStart: null,
      input: {},
      skippedEngineServices: {},
    };
    const compared = (walk: BehaviourWalk) => {
      const animation: AnimationDescription = {
        ...proof,
        id: "react",
        initial: "reset",
        prerequisites: [],
        initialFields: [known(12, 5)],
        trigger: { ...proof, kind: "run", name: "Run", routine: 100, condition: { kind: "true" }, writes: [] },
        walk,
      };
      return compareMeasuredWalks([animation], recording, reacting()).classification;
    };

    it("keeps the control value it had when the reaction started, so a recording that gives it proves the ending", () => {
      const walk = walkBehaviourRules(reacting(), 39, [known(12, 5)], { reaction: true });
      // After the reaction, the test of the control value is a test of the value the walk started with.
      const end = nodes(walk).find((node) => node.states[0] === 0 && node.stop?.branches?.length);
      expect(JSON.stringify(end?.stop?.branches?.map((branch) => branch.condition))).toContain(START);
      expect(end?.assumptions).toContain(MONKEY_BIKE_REACTION_ASSUMPTION);
      expect(compared(walk)).toBe("complete");
    });

    it("doesn't keep it when the walk may not, like after the bike's own bounce or rope callback", () => {
      const walk = walkBehaviourRules(reacting(), 39, [known(12, 5)]);
      expect(nodes(walk).some((node) => node.assumptions.includes(MONKEY_BIKE_REACTION_ASSUMPTION))).toBe(false);
      expect(compared(walk)).toBe("prefix");
    });

    it("doesn't keep it in the description after the bike's own bounce", () => {
      const data = reacting();
      const hit = [write(12, constant(5)), write(0x96, constant(4))];
      data.routines[2] = {
        ...data.routines[2]!,
        writes: hit,
        outcomes: [{ ...proof, condition: { kind: "true" }, fields: hit, returnValue: constant(0) }],
      };
      const bounce = describeBehaviour(data).parts[0]!.animations.find((item) => item.trigger.kind === "callback")!;
      expect(bounce.walk.states[0]).toBe(5);
      expect(nodes(bounce.walk).some((node) => node.assumptions.includes(MONKEY_BIKE_REACTION_ASSUMPTION))).toBe(false);
    });

    it("doesn't keep it from a frame outside the reaction", () => {
      const walk = walkBehaviourRules(reacting(), 39, [known(12, 0), known(0x96, 0)], { reaction: true });
      expect(JSON.stringify(walk.stop?.branches?.map((branch) => branch.condition))).not.toContain(START);
      expect(nodes(walk).some((node) => node.assumptions.includes(MONKEY_BIKE_REACTION_ASSUMPTION))).toBe(false);
    });
  });

  describe("control values a decided assumption limits", () => {
    /** A part with 3 frames whose run adds its control value to its frame, given an id. */
    const tilting = (id: string) => {
      const data = report([
        rule(field(12), test(0x12, "==", 0)),
        rule({ kind: "binary", operator: "+", left: field(12), right: field(0x12), width: 16 }, test(0x12, "!=", 0), [
          write(0x12, constant(0)),
        ]),
      ]);
      data.parts[0] = { ...data.parts[0]!, id, frameCount: 3 } as never;
      data.layout.fields.push({ name: "stateDelta", offset: 0x12, ...proof });
      data.routines[2]!.writes = [write(0x12, constant(1)), write(0x12, constant(0xffff))];
      return data;
    };
    const controls = (walk: ReturnType<typeof walkBehaviourRules>) =>
      walk.stop?.branches?.map((branch) => JSON.stringify(branch.condition));

    it("follows only -1, 0 and 1 for the jack-in-the-box's control value, with no branch for any other number", () => {
      const walk = walkBehaviourRules(tilting("jack-in-the-box"), 39, [known(12, 1)]);
      expect(walk.stop?.branches).toHaveLength(3);
      expect(controls(walk)?.some((text) => text.includes('"!="'))).toBe(false);
      expect(walk.assumptions).toContain(CONTROL_VALUE_ASSUMPTION);
    });

    it("gives no decided numbers to a part without that decision", () => {
      const walk = walkBehaviourRules(tilting("bellows"), 39, [known(12, 1)]);
      expect(walk.stop?.branches).toBeUndefined();
      expect(walk.assumptions).not.toContain(CONTROL_VALUE_ASSUMPTION);
    });

    it("doesn't tip the teeter-totter past an end", () => {
      const left = walkBehaviourRules(tilting("teeter-totter"), 39, [known(12, 0)]);
      expect(left.stop?.branches?.map((branch) => branch.walk.states.slice(0, 2))).toEqual([
        [0, 0],
        [0, 1],
      ]);
      expect(left.assumptions).toContain(TEETER_TOTTER_END_ASSUMPTION);
      const right = walkBehaviourRules(tilting("teeter-totter"), 39, [known(12, 2)]);
      expect(right.stop?.branches?.map((branch) => branch.walk.states.slice(0, 2))).toEqual([
        [2, 2],
        [2, 1],
      ]);
    });
  });

  describe("a control value a rope question may have changed", () => {
    /** The value the control value holds right after a rope query, when a question can come back to the part. */
    const afterQuery: Expression = {
      kind: "field",
      object: "part after the query at 0x1d2d1",
      offset: 0x12,
      width: 16,
      unresolved: true,
    };
    /** A teeter-totter that asks along its ropes and then adds what its control value holds to its frame. */
    const asking = (keepsValue: boolean) => {
      const data = report([
        rule(field(12), test(0x12, "==", 0)),
        {
          ...rule(
            { kind: "binary", operator: "+", left: field(12), right: afterQuery, width: 16 },
            test(0x12, "!=", 0),
            [write(0x12, keepsValue ? afterQuery : constant(0))],
          ),
          confidence: "unresolved",
        },
      ]);
      data.parts[0] = { ...data.parts[0]!, id: "teeter-totter", frameCount: 3 } as never;
      data.routines[0]!.outcomes = [
        { ...proof, effectsComplete: true, condition: { kind: "true" }, fields: [] },
      ] as never;
      return data;
    };
    const values = (walk: ReturnType<typeof walkBehaviourRules>) =>
      walk.stop?.branches?.map((branch) => (branch.condition as { right: { value: number } }).right.value);

    it("follows each decided number for it, and not one that tips the teeter-totter past an end", () => {
      const walk = walkBehaviourRules(asking(false), 39, [known(12, 0), known(0x12, 1)]);
      expect(values(walk)).toEqual([0, 1]);
      expect(walk.stop?.branches?.map((branch) => branch.walk.states.slice(0, 2))).toEqual([
        [0, 0],
        [0, 1],
      ]);
      expect(walk.stop?.branches?.every((branch) => branch.walk.status === "rest")).toBe(true);
      expect(walk.assumptions).toEqual(
        expect.arrayContaining([CONTROL_VALUE_ASSUMPTION, TEETER_TOTTER_END_ASSUMPTION]),
      );
    });

    it("uses the number for that run only, and works out the next run's value again", () => {
      const walk = walkBehaviourRules(asking(true), 39, [known(12, 1), known(0x12, 1)]);
      const up = walk.stop?.branches?.find((branch) => branch.walk.states[1] === 2)?.walk;
      // The control value keeps that number, but the next run's query gives a new one.
      expect(up?.fields.find((item) => item.offset === 0x12)?.value).toBe(1);
      expect(up?.stop?.kind).toBe("state");
      expect(values(up!)).toEqual([0, 0xffff]);
    });

    it("gives no numbers to a part without that decision", () => {
      const data = asking(false);
      data.parts[0] = { ...data.parts[0]!, id: "bellows" } as never;
      expect(walkBehaviourRules(data, 39, [known(12, 0), known(0x12, 1)]).stop?.branches).toBeUndefined();
    });
  });

  describe("starting frames of parts drawn by their own code", () => {
    /** A part without a frame list, whose run always goes to frame 0. */
    const drawn = (id: string) => {
      const data = report([rule(constant(0), { kind: "true" })]);
      data.parts[0] = { ...data.parts[0]!, id, frameCount: 0 } as never;
      return data;
    };

    it("starts the conveyor belt on the first frame of each block of 7", () => {
      const walk = walkBehaviourRules(drawn("conveyor-belt"), 39, []);
      expect(walk.stop?.branches?.map((branch) => branch.walk.states[0])).toEqual([0, 7, 14, 21, 28]);
      expect(walk.stop?.branches?.every((branch) => ["rest", "joins"].includes(branch.walk.status))).toBe(true);
      expect(walk.assumptions).toContain(CONVEYOR_BELT_ASSUMPTION);
    });

    it("starts the gear on each of its four frames", () => {
      const walk = walkBehaviourRules(drawn("gear"), 39, []);
      expect(walk.stop?.branches?.map((branch) => branch.walk.states[0])).toEqual([0, 1, 2, 3]);
      expect(walk.assumptions).toContain(GEAR_ASSUMPTION);
    });

    it("starts the mouse motor on frame 0 or 1 and the electric motor on frames 0 to 2", () => {
      const mouse = walkBehaviourRules(drawn("mouse-motor"), 39, []);
      expect(mouse.stop?.branches?.map((branch) => branch.walk.states[0])).toEqual([0, 1]);
      expect(mouse.assumptions).toContain(MOUSE_MOTOR_ASSUMPTION);
      const electric = walkBehaviourRules(drawn("electric-motor"), 39, []);
      expect(electric.stop?.branches?.map((branch) => branch.walk.states[0])).toEqual([0, 1, 2]);
      expect(electric.assumptions).toContain(ELECTRIC_MOTOR_ASSUMPTION);
    });

    it("starts a case in the middle of a run on every frame the belt shows, not only a level's", () => {
      const walk = walkBehaviourRules(drawn("conveyor-belt"), 39, [], { midRun: true });
      expect(walk.stop?.branches?.map((branch) => branch.walk.states[0])).toEqual([...Array(35).keys()]);
    });

    it("still gives no starting frame to another part without a frame list", () => {
      // Its next frame depends on the frame it starts on, so the rules alone can't give one either.
      const data = report([
        rule({ kind: "binary", operator: "+", left: field(12), right: constant(1), width: 16 }, { kind: "true" }),
      ]);
      data.parts[0] = { ...data.parts[0]!, id: "rope", frameCount: 0 } as never;
      const walk = walkBehaviourRules(data, 39, []);
      expect(walk.stop?.branches).toBeUndefined();
      expect(walk.status).toBe("unresolved");
    });
  });

  it("goes on without a branch when the rules that apply all lead to the same frame", () => {
    const data = report([
      rule(constant(1), both(test(12, "==", 0), test(0x40, "==", 0)), [write(0x30, constant(1))]),
      rule(constant(1), both(test(12, "==", 0), test(0x40, "!=", 0)), [write(0x30, constant(2))]),
      rule(field(12), test(12, "==", 1)),
    ]);
    const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
    expect(walk.stop).toBeUndefined();
    expect(walk.states.slice(0, 2)).toEqual([0, 1]);
    expect(walk.status).toBe("rest");
    expect(walk.assumptions).toContain(
      "The rules that apply here lead to the same next frame; the fields they set differently are forgotten.",
    );
  });

  it("knows a field a branch tested for one number, so the next step can use it", () => {
    const data = report([
      rule(constant(1), both(test(12, "==", 0), test(0x40, "==", 3)), [write(0x30, field(0x40))]),
      rule(constant(2), both(test(12, "==", 0), test(0x40, "!=", 3))),
      rule(constant(2), both(test(12, "==", 1), test(0x30, "==", 3))),
      rule(constant(0), both(test(12, "==", 1), test(0x30, "!=", 3))),
      rule(field(12), test(12, "==", 2)),
    ]);
    const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
    const tested = walk.stop?.branches?.find((branch) => JSON.stringify(branch.condition).includes('"value":3'));
    expect(tested?.walk.states.slice(0, 2)).toEqual([1, 2]);
    expect(tested?.walk.status).toBe("rest");
  });

  it("does not branch on an opaque deciding value", () => {
    const hidden: Expression = { kind: "unknown", reason: "An unresolved operand", width: 16 };
    const guard = (operator: string): Predicate => ({
      kind: "compare",
      left: hidden,
      operator,
      right: constant(0),
      signed: false,
    });
    const data = report([
      rule(constant(1), both(test(12, "==", 0), guard("=="))),
      rule(constant(2), both(test(12, "==", 0), guard("!="))),
      rule(field(12), test(12, "==", 1)),
      rule(field(12), test(12, "==", 2)),
    ]);
    const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
    expect(walk.status).toBe("unresolved");
    expect(walk.stop?.branches).toBeUndefined();
  });

  it("branches by frame when an opaque value only chooses between rules that lead to the same frame", () => {
    // Like the balloon: with its control value set it goes on to the next frame, whether or not the game could make
    // the part that frees its rope; that only changes other fields.
    const hidden: Expression = { kind: "unknown", reason: "An unresolved operand", width: 16 };
    const guard = (operator: string): Predicate => ({
      kind: "compare",
      left: hidden,
      operator,
      right: constant(0),
      signed: false,
    });
    const data = report([
      rule(field(12), both(test(12, "==", 0), test(0x12, "==", 0))),
      rule(constant(1), both(test(12, "==", 0), test(0x12, "!=", 0), guard("==")), [
        write(12, constant(1)),
        write(0x30, constant(1)),
      ]),
      rule(constant(1), both(test(12, "==", 0), test(0x12, "!=", 0), guard("!=")), [
        write(12, constant(1)),
        write(0x30, constant(2)),
      ]),
      rule(field(12), test(12, "==", 1)),
    ]);
    // Every return path of the run is one of these rules, so one of them applies.
    const covered = (item: ReturnType<typeof report>) => {
      item.routines[0] = { ...item.routines[0]!, returnPathsComplete: true } as never;
      return item;
    };
    const walk = walkBehaviourRules(covered(data), 39, [known(12, 0), known(0x30, 0)]);
    expect(walk.stop?.kind).toBe("ambiguity");
    const branches = walk.stop?.branches ?? [];
    expect(branches.map((branch) => [branch.condition, branch.walk.states, branch.walk.status])).toEqual([
      [both(test(12, "==", 0), test(0x12, "==", 0)), [0], "joins"],
      [both(test(12, "==", 0), test(0x12, "!=", 0)), [1, 1], "rest"],
    ]);
    expect(branches[1]!.alternatives).toEqual([both(guard("==")), both(guard("!="))]);
    // The two ways write 1 and 2, so only the bits they agree on stay known.
    expect(branches[1]!.walk.fields.find((item) => item.offset === 0x30)?.knownMask).toBe(0xfffc);
    expect(branches[1]!.walk.assumptions).toContain(
      "The rules that apply here lead to the same next frame; the fields they set differently are forgotten.",
    );
    // When what the rules of one frame all test doesn't rule out the other frame, no branch is chosen.
    const loose = report([
      rule(field(12), both(test(12, "==", 0), test(0x12, "==", 0))),
      rule(constant(1), both(test(12, "==", 0), guard("=="))),
      rule(constant(1), both(test(12, "==", 0), test(0x12, "!=", 0), guard("!="))),
      rule(field(12), test(12, "==", 1)),
    ]);
    const looseWalk = walkBehaviourRules(covered(loose), 39, [known(12, 0)]);
    expect(looseWalk.stop?.kind).toBe("ambiguity");
    expect(looseWalk.stop?.branches).toBeUndefined();
  });

  it("does not join an unknown guard when its other exit is missing", () => {
    const data = report([rule(constant(1), test(8, "==", 0)), rule(field(12), test(12, "==", 1))]);
    expect(walkBehaviourRules(data, 39, [known(12, 0)])).toMatchObject({ states: [0], status: "unresolved" });
  });

  it("forgets unwritten counters across incomplete alias effects", () => {
    const data = report([
      rule(constant(1), test(12, "==", 0)),
      rule(field(12), both(test(12, "==", 1), test(0x96, "==", 3))),
    ]);
    data.routines[0]!.uncertainEffects = true;
    const walk = walkBehaviourRules(data, 39, [known(12, 0), known(0x96, 3)]);
    expect(walk.states).toEqual([0, 1]);
    expect(walk.status).toBe("unresolved");
    expect(walk.fields.find((field) => field.offset === 0x96)).toBeUndefined();
  });

  it("reports the unresolved helper instruction separately from its plain-language reason", () => {
    const item = rule({ kind: "unknown", reason: "Call result at 0x456", width: 16 }, { kind: "true" });
    item.evidence = [{ address: 0x456, bytes: [0xe8, 0, 0], text: "call 0x0459" }];
    const walk = walkBehaviourRules(report([item]), 39, [known(12, 0)]);
    expect(walk.reason).toContain("helper result");
    expect(walk.reason).not.toContain("0x");
    expect(walk.stop?.evidence.map((item) => item.address)).toEqual([0x456]);
  });

  it("proves a symbolic hold across complete complementary branches without choosing a frame", () => {
    const data = report([rule(field(12), test(8, "==", 0)), rule(field(12), test(8, "!=", 0))], []);
    const walk = walkBehaviourRules(data, 39, []);
    expect(walk.states).toEqual([]);
    expect(walk.parameterised?.kind).toBe("hold");
    expect(walk.status).toBe("rest");
  });

  it("holds an unknown state when the rules only add to what the walk knows", () => {
    const data = report(
      [rule(field(12), test(8, "==", 0), [write(0x62, constant(0))]), rule(field(12), test(8, "!=", 0))],
      [],
    );
    const walk = walkBehaviourRules(data, 39, []);
    expect([walk.status, walk.parameterised?.kind, walk.runCalls]).toEqual(["rest", "hold", 1]);
  });

  it("holds an unknown state from what is left after a helper that keeps the state forgets the other fields", () => {
    const forgets = { ...rule(field(12), test(8, "==", 0)), confidence: "unresolved" as const };
    const data = report([forgets, rule(field(12), test(8, "!=", 0), [write(0x62, constant(0))])], []);
    data.routines[0] = {
      ...data.routines[0]!,
      uncertainties: [],
      uncertainEffects: true,
      returnPathsComplete: true,
      outcomes: [
        { ...proof, condition: test(8, "==", 0), fields: [], returnValue: constant(0), keepsState: true },
        { ...proof, condition: test(8, "!=", 0), fields: [], returnValue: constant(0), effectsComplete: true },
      ],
    } as never;
    const walk = walkBehaviourRules(data, 39, [known(4, 39)]);
    expect([walk.status, walk.parameterised?.kind, walk.runCalls]).toEqual(["rest", "hold", 2]);
    expect(walk.fields.find((item) => item.offset === 4)?.knownMask ?? 0).toBe(0);
    // Without the helper's proof that it keeps the state, nothing is held.
    (data.routines[0] as unknown as { outcomes: { keepsState?: boolean }[] }).outcomes[0]!.keepsState = undefined;
    expect(walkBehaviourRules(data, 39, [known(4, 39)]).parameterised).toBeUndefined();
  });

  it("does not treat an unresolved state-field reference as an identity proof", () => {
    const data = report(
      [rule({ kind: "field", object: "part", offset: 12, width: 16, unresolved: true }, { kind: "true" })],
      [],
    );
    expect(walkBehaviourRules(data, 39, []).parameterised).toBeUndefined();
    expect(walkBehaviourRules(data, 39, [known(12, 0)]).status).toBe("unresolved");
  });

  it("stops before choosing an unknown control value", () => {
    const description = describeBehaviour(report([rule(constant(1), test(0x12, "!=", 0))]));
    expect(description.parts[0]!.animations[0]!.walk).toMatchObject({ status: "unresolved", states: [0], runCalls: 0 });
  });

  it("keeps an unknown rest state unknown", () => {
    const data = report([rule(constant(0), { kind: "true" })]);
    (data.routines[1] as unknown as { outcomes: unknown[] }).outcomes = [];
    const part = describeBehaviour(data).parts[0]!;
    expect(part.rest.state).toBeUndefined();
    expect(part.animations[0]!.walk.states).toEqual([]);
  });

  it("does not fill unassigned flags with zero", () => {
    const flags: Expression = { kind: "binary", operator: "&", left: field(8), right: constant(0xffef), width: 16 };
    const data = report([rule(constant(1), test(8, "==", 0))], [write(12, constant(0)), write(8, flags)]);
    const part = describeBehaviour(data).parts[0]!;
    expect(part.rest.fields.find((item) => item.offset === 8)).toMatchObject({ value: 0, knownMask: 0x10 });
    expect(part.animations[0]!.walk).toMatchObject({ status: "unresolved", states: [0] });
  });

  it("uses a proved cleared flag bit without guessing the other bits", () => {
    const flagTest: Predicate = {
      kind: "compare",
      left: { kind: "binary", operator: "&", left: field(8), right: constant(16), width: 16 },
      operator: "==",
      right: constant(0),
      signed: false,
    };
    const data = report(
      [rule(field(12), flagTest)],
      [
        write(12, constant(0)),
        write(8, { kind: "binary", operator: "&", left: field(8), right: constant(0xffef), width: 16 }),
      ],
    );
    expect(describeBehaviour(data).parts[0]!.animations[0]!.walk.status).toBe("rest");
  });

  it("applies final fields simultaneously using entry expressions", () => {
    const data = report([
      rule(constant(1), test(12, "==", 0), [write(0x96, field(12))]),
      rule(field(12), test(12, "==", 1)),
    ]);
    const walk = walkBehaviourRules(data, 39, [known(12, 0)]);
    expect(walk.fields.find((item) => item.offset === 0x96)?.value).toBe(0);
  });

  it("stops at an unresolved destination and retains the known prefix", () => {
    const data = report([
      rule(constant(1), test(12, "==", 0)),
      rule({ kind: "unknown", width: 16, reason: "Unknown helper result" }, test(12, "==", 1)),
    ]);
    expect(walkBehaviourRules(data, 39, [known(12, 0)])).toMatchObject({
      states: [0, 1],
      runCalls: 1,
      status: "unresolved",
    });
  });

  it("does not hide a potentially applicable unknown branch", () => {
    const data = report([rule(constant(1), { kind: "true" }), rule(constant(2), test(0x12, "==", 1))]);
    expect(walkBehaviourRules(data, 39, [known(12, 0)])).toMatchObject({ states: [0], status: "unresolved" });
  });
});

describe("per-member trigger tuples", () => {
  function memberReport(complete = true) {
    const data = report(
      [rule(field(12), test(12, "==", 0))],
      [write(12, constant(0)), write(0x12, constant(0)), write(0x96, constant(0))],
    );
    const object = "overlap candidate at 0x400";
    const activation = { ...write(0x12, constant(1)), object, routine: 400 };
    const timer = { ...write(0x96, constant(100)), object, routine: 400 };
    data.relatedObjectEffects = [{ ...proof, sourceType: 62, sourcePart: "teapot", targetType: 39, write: activation }];
    data.routines.push({
      ...data.routines[0]!,
      address: 400,
      outcomes: [],
      iterationOutcomes: [
        {
          ...proof,
          scope: "one overlap-list member",
          header: 0x400,
          object,
          condition: { kind: "true" },
          fields: [activation, timer],
          effectsComplete: complete,
        },
      ],
    });
    return data;
  }

  it("uses all final member assignments without mistaking them for a callback return", () => {
    const result = describeBehaviour(memberReport()).parts[0]!.animations.find(
      (animation) => animation.trigger.kind === "related-write",
    )!;
    expect(result.trigger.scope).toBe("one overlap-list member");
    expect(result.initialFields).toContainEqual(expect.objectContaining({ offset: 0x96, value: 100 }));
    expect(result.initialFields).toContainEqual(expect.objectContaining({ offset: 0x12, value: 1 }));
    expect(result.trigger.assumptions.join(" ")).toContain("list membership is not asserted");
  });

  it("does not derive a start from an incomplete member relation", () => {
    const result = describeBehaviour(memberReport(false)).parts[0]!.animations.find(
      (animation) => animation.trigger.kind === "related-write",
    )!;
    expect(result.walk.states).toEqual([]);
    expect(result.walk.reason).toContain("untracked");
  });
});

describe("creation defaults and related input conditions", () => {
  it("keeps a periodic frame block symbolic and proves every starting phase", () => {
    const phase: Expression = { kind: "binary", operator: "&", left: field(12), right: constant(3), width: 16 };
    const end: Predicate = { kind: "compare", left: phase, right: constant(3), operator: "==", signed: false };
    const data = report([
      rule(add(12, 1), both(test(18, "==", 1), { ...end, operator: "!=" })),
      rule(add(12, -3), both(test(18, "==", 1), end)),
      rule(field(12), test(18, "!=", 1)),
    ]);
    data.parts[0]!.frameCount = 16;
    const cycles = describeBehaviour(data).parts[0]!.animations.filter((a) => a.walk.parameterised?.kind === "cycle");
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]!.walk.parameterised).toMatchObject({
      kind: "cycle",
      period: 4,
      direction: 1,
      minimumBase: 0,
      maximumBase: 12,
    });
    expect(cycles[0]!.walk.states).toEqual([]);
    expect(cycles[0]!.initialFields?.some((f) => f.offset === 12)).toBe(false);
    expect(cycles[0]!.assumptions.join(" ")).toContain("does not select a level's initial state");
  });

  it("does not translate a state-specific exceptional rule into a periodic cycle", () => {
    const phase: Expression = { kind: "binary", operator: "&", left: field(12), right: constant(3), width: 16 };
    const data = report([
      rule(add(12, 1), { kind: "compare", left: phase, right: constant(3), operator: "!=", signed: false }),
      rule(add(12, -3), { kind: "compare", left: phase, right: constant(3), operator: "==", signed: false }),
      rule(constant(0), test(12, "==", 15)),
    ]);
    data.parts[0]!.frameCount = 16;
    expect(describeBehaviour(data).parts[0]!.animations.some((a) => a.walk.parameterised?.kind === "cycle")).toBe(
      false,
    );
  });

  it("does not describe different linked fields as a value compared with itself", () => {
    const left: Expression = { kind: "field", object: "referenced-by(part+0x84)", offset: 0x30, width: 16 };
    const right: Expression = { ...left, offset: 0x32 };
    const condition: Predicate = { kind: "compare", left, right, operator: "==", signed: false };
    const descriptions = describeBehaviour(report([rule(constant(1), both(test(12, "==", 0), condition))]))
      .parts[0]!.animations.filter((animation) => animation.trigger.kind === "input-case")
      .map((animation) => animation.trigger.description);
    expect(descriptions.some((description) => description?.includes("relationship between field values"))).toBe(true);
    expect(descriptions.join(" ")).not.toContain("value is a linked object's recorded value");
  });

  it("does not split input cases on the zero words of a fresh part", () => {
    const step: Expression = { kind: "binary", operator: "+", left: field(12), right: field(0x30), width: 16 };
    const data = report([rule(step, test(0x30, "!=", 0)), rule(field(12), test(0x30, "==", 0))]);
    data.creation = [
      {
        ...proof,
        routine: 500,
        partType: 39,
        source: "constructor",
        uncertainties: [],
        fields: [
          { ...proof, name: "state", offset: 12, width: 16, value: 0 },
          { ...proof, name: "+0x30", offset: 0x30, width: 16, value: 7 },
        ],
      },
    ];
    const cases = describeBehaviour(data).parts[0]!.animations.filter((animation) => animation.initial === "run-guard");
    expect(cases.some((animation) => animation.initialFields?.some((f) => f.offset === 0x30 && f.value === 7))).toBe(
      false,
    );
  });

  it("says when the starting frame is the one the level saved, rather than an unresolved reset", () => {
    const data = report([rule(field(12), test(12, "==", 0))], [write(0x12, constant(0))]);
    data.lifecycle = { reset: [{ ...proof, stateSource: 0x90, fields: [] }], history: [], diagnostics: [] } as never;
    expect(describeBehaviour(data).parts[0]!.rest).toMatchObject({
      status: "unresolved",
      reason:
        "The starting frame is the one the level saved: the reset paths keep it, so TIM.EXE alone doesn't give it.",
    });
    // A reset path that writes the frame leaves it to that path instead.
    const writes = report([rule(field(12), test(12, "==", 0))], [write(12, field(0x62))]);
    writes.lifecycle = data.lifecycle;
    expect(describeBehaviour(writes).parts[0]!.rest.reason).toBe(
      "The reset paths are resolved, but the frame they leave depends on fields the reset doesn't fix.",
    );
  });

  it("names what a rope, belt or pulley helper may change on the parts it reaches", () => {
    const data = report([rule(field(12), { kind: "true" })]);
    const object = "a part reached through a rope, belt or pulley at 0x1aaf7";
    data.routines[2]!.writes = [0x14, 0x6a, 0x96, 0x40].map((offset) => ({
      ...write(offset, { kind: "unknown", reason: "forgotten", width: 16 }),
      object,
      routine: 300,
    }));
    const lines = describeBehaviour(data).parts[0]!.effects.map((effect) => effect.description);
    expect(lines).toContain(
      "May change field 0x14 of a part its ropes, belt or pulleys reach (this part too): the value the relay passes along.",
    );
    expect(lines).toContain(
      "May change the rope links of a part its ropes, belt or pulleys reach (this part too), turning a rope round.",
    );
    expect(lines).toContain("May move the rope ends of a part its ropes, belt or pulleys reach (this part too).");
    expect(lines).toContain("May change a field of a part its ropes, belt or pulleys reach (this part too).");
    expect(lines.join(" ")).not.toContain("another part's");
  });

  it("names writes to a rope's record and to the part that touches a bounce callback's owner", () => {
    const data = report([rule(field(12), { kind: "true" })]);
    const rope = "referenced-by(part+0x66)";
    const counter: Expression = {
      kind: "binary",
      operator: "+",
      left: { kind: "field", object: rope, offset: 0x0e, width: 16 },
      right: constant(1),
      width: 16,
    };
    data.routines[2]!.writes = [
      { ...write(0x0e, counter), object: rope, routine: 300 },
      { ...write(12, constant(9)), object: "collider", routine: 300 },
    ];
    const lines = describeBehaviour(data).parts[0]!.effects.map((effect) => effect.description);
    expect(lines).toContain("Adds 1 to field 0x0e of the record of its rope at 0x66.");
    expect(lines).toContain("Selects state 9 on the touching part.");
    // An overlap query's summary writes the parts it finds.
    const found = "a candidate selected by the overlap query at 0x19540";
    data.routines[2]!.writes = [0x78, 0x7a].map((offset) => ({
      ...write(offset, { kind: "unknown", reason: "forgotten", width: 16 }),
      object: found,
      routine: 300,
    }));
    const search = describeBehaviour(data).parts[0]!.effects.map((effect) => effect.description);
    expect(search).toContain("Links a part its search finds into its found list (field 0x78).");
    expect(search).toContain("May change field 0x7a of a part its search finds.");
    // An object the routine creates itself.
    data.routines[2]!.writes = [
      { ...write(0x1e, constant(5)), object: "nullable allocation returned at 0x1b3a1", routine: 300 },
    ];
    expect(describeBehaviour(data).parts[0]!.effects.map((effect) => effect.description)).toContain(
      "Sets field 0x1e of the object it creates at 0x1b3a1.",
    );
    // A counter says which field it counts with.
    data.parts[0]!.counters = [{ ...proof, offset: 0x96, comparisons: [{ ...proof }] }] as never;
    expect(describeBehaviour(data).parts[0]!.effects.map((effect) => effect.description)).toContain(
      "Counts with field 0x96, which later tests read.",
    );
  });

  it("says a flip that toggles a drawing flag turns that reflection round", () => {
    const data = report([rule(field(12), { kind: "true" })]);
    data.layout.fields = data.layout.fields.filter((item) => item.offset !== 0x08);
    data.layout.fields.push({
      name: "drawingFlags",
      offset: 0x08,
      masks: [
        { value: 0x10, name: "horizontalFlip" },
        { value: 0x20, name: "verticalFlip" },
      ],
      ...proof,
    } as never);
    const toggle = (mask: number): Expression => ({
      kind: "binary",
      operator: "^",
      left: field(0x08),
      right: constant(mask),
      width: 16,
    });
    data.parts[0]!.visibleEffects = [
      { ...write(0x08, toggle(0x20)), routine: 300 },
      { ...write(0x08, toggle(0x41)), routine: 300 },
    ];
    const lines = describeBehaviour(data).parts[0]!.effects.map((effect) => effect.description);
    expect(lines).toContain("Turns the part's vertical reflection round.");
    expect(lines).toContain("Turns flag 0x41 of the part's drawing flags round.");
    // An or sets bits and an and clears them, whatever the others were.
    const set: Expression = { kind: "binary", operator: "|", left: field(0x08), right: constant(0x2040), width: 16 };
    data.parts[0]!.visibleEffects = [
      { ...write(0x08, set), routine: 300 },
      {
        ...write(0x08, { kind: "binary", operator: "&", left: set, right: constant(0xdfdf), width: 16 }),
        routine: 300,
      },
    ];
    const flags = describeBehaviour(data).parts[0]!.effects.map((effect) => effect.description);
    expect(flags).toContain("Sets flags 0x40 and 0x2000 of the part's drawing flags.");
    expect(flags).toContain(
      "Sets flag 0x40 of the part's drawing flags. Clears the part's vertical reflection on this path. Clears flag 0x2000 of the part's drawing flags.",
    );
  });

  it("starts a part with one frame on frame 0 when its reset keeps the saved frame", () => {
    const data = report([rule(field(12), { kind: "true" })], [write(0x12, constant(0))]);
    data.lifecycle = { reset: [{ ...proof, stateSource: 0x90, fields: [] }], history: [], diagnostics: [] } as never;
    data.parts[0]!.frameCount = 1;
    const part = describeBehaviour(data).parts[0]!;
    expect(part.rest).toMatchObject({ status: "known", state: 0, frame: 0 });
    expect(part.rest.assumptions.join(" ")).toContain("a part with one frame starts on frame 0");
    data.parts[0]!.frameCount = 3;
    expect(describeBehaviour(data).parts[0]!.rest.status).toBe("unresolved");
  });

  it("starts parts the program draws itself on the frames a decided assumption gives", () => {
    const keepSaved = (id: string) => {
      const data = report([rule(field(12), { kind: "true" })], [write(0x12, constant(0))]);
      data.lifecycle = { reset: [{ ...proof, stateSource: 0x90, fields: [] }], history: [], diagnostics: [] } as never;
      data.parts[0]!.id = id;
      data.parts[0]!.frameCount = 0;
      return describeBehaviour(data).parts[0]!;
    };
    // A wall has one starting frame, so its reset is known and it rests there.
    const wall = keepSaved("brick-wall");
    expect(wall.rest).toMatchObject({ status: "known", state: 0 });
    expect(wall.rest.assumptions.join(" ")).toContain("the grass floor and the super ball on frame 0");
    expect(wall.stableStates.map((stable) => stable.state)).toEqual([0]);
    // A pulley can start on any of its four rope directions.
    const pulley = keepSaved("pulley");
    expect(pulley.rest).toMatchObject({ status: "unresolved", frames: [0, 1, 2, 3] });
    expect(pulley.stableStates.map((stable) => stable.state)).toEqual([0, 1, 2, 3]);
    // A part without such an assumption keeps no frames.
    expect(keepSaved("trampoline").rest.frames).toBeUndefined();
  });

  it("lists the frames a part with a frame list can start on when its reset keeps the saved frame", () => {
    const data = report([rule(field(12), test(12, "==", 0))], [write(0x12, constant(0))]);
    data.lifecycle = { reset: [{ ...proof, stateSource: 0x90, fields: [] }], history: [], diagnostics: [] } as never;
    expect(describeBehaviour(data).parts[0]!.rest).toMatchObject({
      status: "unresolved",
      frames: [0, 1, 2],
      description: "The reset keeps the frame the level saved: one of frames 0 to 2.",
    });
  });

  it("rests on each frame when the run keeps every field", () => {
    const data = report([rule(field(12), { kind: "true" })], [write(0x12, constant(0))]);
    data.parts[0]!.frameCount = 3;
    expect(describeBehaviour(data).parts[0]!.stableStates.map((stable) => stable.state)).toEqual([0, 1, 2]);
    // A run that keeps the frame only under a test doesn't make every frame a resting frame.
    const tested = report([rule(field(12), test(0x30, "==", 0)), rule(constant(0), test(0x30, "!=", 0))]);
    tested.parts[0]!.frameCount = 3;
    expect(describeBehaviour(tested).parts[0]!.stableStates.map((stable) => stable.state)).not.toContain(2);
  });

  // A reset like the electric switch's: it keeps bit 2 of the frame and sets bit 0 and bit 1 by whether the words at
  // 0x62 and 0x64 are 0. Each path is one outcome of the reset routine.
  function bitReset(keep: number | undefined, frameCount: number, low = 0, id = "trampoline") {
    const data = report([rule(field(12), test(12, "==", 0))]);
    data.parts[0]!.id = id;
    const base = (bits: number): Expression =>
      keep === undefined
        ? constant(bits)
        : bits
          ? {
              kind: "binary",
              operator: "|",
              left: { kind: "binary", operator: "&", left: field(12), right: constant(keep), width: 16 },
              right: constant(bits),
              width: 16,
            }
          : { kind: "binary", operator: "&", left: field(12), right: constant(keep), width: 16 };
    const outcomes = [0, 1, 2, 3].map((bits) => ({
      condition: both(test(0x62, bits & 1 ? "!=" : "==", 0), test(0x64, bits & 2 ? "!=" : "==", 0)),
      fields: [write(12, base(bits << low))],
      ...proof,
    }));
    data.routines[1] = { ...data.routines[1]!, outcomes } as never;
    data.parts[0]!.frameCount = frameCount;
    data.lifecycle = { reset: [{ ...proof, stateSource: 0x90, fields: [] }], history: [], diagnostics: [] } as never;
    return describeBehaviour(data).parts[0]!.rest;
  }

  it("lists the frames a reset leaves when it keeps some bits of the saved frame and sets the others by tests", () => {
    const rest = bitReset(4, 8);
    expect(rest.status).toBe("unresolved");
    expect(rest.frames).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(rest.description).toBe(
      "The reset keeps bit 2 of the frame saved in the level and sets bit 0 when the word at +0x62 is not 0 and bit 1 when the word at +0x64 is not 0, so it leaves one of frames 0 to 7.",
    );
    expect(rest.reason).toBe(
      "The reset paths are resolved; which of these frames they leave depends on fields the reset doesn't fix.",
    );
    // Like the generator: it keeps the two low bits and sets bits 2 and 3.
    expect(bitReset(3, 16, 2).description).toContain("keeps bits 0 and 1 of the frame saved in the level");
    // The generator never starts partway through a turn (decided), so bits 0 and 1 of the saved frame are 0.
    const generator = bitReset(3, 16, 2, "generator");
    expect(generator.frames).toEqual([0, 4, 8, 12]);
    expect(generator.assumptions.join(" ")).toContain("never starts the generator partway through a turn");
    // Like the solar panel: no bit of the saved frame is kept.
    expect(bitReset(undefined, 4)).toMatchObject({
      frames: [0, 1, 2, 3],
      description:
        "The reset sets bit 0 when the word at +0x62 is not 0 and bit 1 when the word at +0x64 is not 0, so it leaves one of frames 0 to 3, whatever the frame saved in the level.",
    });
  });

  it("names no frames when a reset path can leave a frame the part doesn't have", () => {
    const rest = bitReset(4, 4);
    expect(rest.frames).toBeUndefined();
    expect(rest.reason).toBe(
      "The reset paths are resolved, but the frame they leave depends on fields the reset doesn't fix.",
    );
  });

  it("says a write of the saved state is the state the next level reset starts from", () => {
    const data = report([rule(field(12), test(12, "==", 0))]);
    data.layout.fields.push({ name: "savedState", offset: 0x90, ...proof } as never);
    data.routines[2] = {
      ...data.routines[2]!,
      outcomes: [{ condition: { kind: "true" }, fields: [write(0x90, constant(4)), write(12, constant(4))], ...proof }],
    } as never;
    const descriptions = describeBehaviour(data).parts[0]!.animations.map((item) => item.trigger.description);
    expect(descriptions.join(" ")).toContain("Saves state 4 as the one the next level reset starts from.");
  });

  it("keeps a creation state separate from a loaded level's unknown reset value", () => {
    const data = report(
      [rule(constant(2), test(12, "==", 1)), rule(constant(0), test(12, "==", 2)), rule(field(12), test(12, "==", 0))],
      [write(12, field(0x90))],
    );
    data.creation = [
      {
        ...proof,
        routine: 500,
        partType: 39,
        source: "constructor",
        uncertainties: [],
        fields: [{ ...proof, name: "state", offset: 12, width: 16, value: 1 }],
      },
    ];
    const description = describeBehaviour(data).parts[0]!;
    expect(description.rest.status).toBe("unresolved");
    expect(description.creation).toMatchObject({ status: "known", state: 1 });
    expect(description.animations.find((animation) => animation.initial === "creation")!.walk.states).toEqual([
      1, 2, 0, 0,
    ]);
  });

  const related: Expression = { kind: "field", object: "referenced-by(part+0x84)", offset: 0x20, width: 16 };
  const guard: Predicate = { kind: "compare", left: related, operator: "==", right: constant(0), signed: false };
  const opposite: Predicate = { ...guard, operator: "!=" };
  function connectedRules(changePointer = false, possibleAlias = false) {
    return [
      rule(
        add(12, 1),
        both(guard, test(12, "<", 2)),
        changePointer ? [write(0x84, constant(0))] : possibleAlias ? [write(0x20, constant(1))] : [],
      ),
      rule(constant(0), both(guard, test(12, "==", 2))),
      rule(field(12), opposite),
    ];
  }

  it("describes a conditional cycle while a code-shown related-object guard stays unchanged", () => {
    const data = report(connectedRules());
    const result = walkBehaviourRules(data, 39, [known(12, 0)], { condition: guard });
    expect(result.status).toBe("loop");
    expect(result.states).toEqual([0, 1, 2, 0]);
  });

  it("forgets a related guard when a traversed pointer changes", () => {
    const result = walkBehaviourRules(report(connectedRules(true)), 39, [known(12, 0)], { condition: guard });
    expect(result.status).toBe("unresolved");
    expect(result.states).toEqual([0, 1]);
  });

  it("forgets a related guard after an overlapping owner write that can alias it", () => {
    const result = walkBehaviourRules(report(connectedRules(false, true)), 39, [known(12, 0)], { condition: guard });
    expect(result.status).toBe("unresolved");
    expect(result.states).toEqual([0, 1]);
  });
});

it("does not preserve a related input constraint through untracked memory effects", () => {
  const related: Expression = { kind: "field", object: "referenced-by(part+0x84)", offset: 0x20, width: 16 };
  const guard: Predicate = { kind: "compare", left: related, operator: "==", right: constant(0), signed: false };
  const data = report([
    rule(add(12, 1), both(guard, test(12, "<", 2))),
    rule(constant(0), both(guard, test(12, "==", 2))),
    rule(field(12), { ...guard, operator: "!=" }),
  ]);
  data.routines[0]!.uncertainEffects = true;
  data.routines[0]!.outcomes = [];
  const result = walkBehaviourRules(data, 39, [known(12, 0)], { condition: guard });
  expect(result.status).toBe("unresolved");
  expect(result.states).toEqual([0, 1]);
});

it("keeps listed outline storage separate from part flags and state fields in words", () => {
  const data = report([rule(field(12), { kind: "true" })]);
  data.layout.fields.push({ name: "drawingFlags", offset: 8, ...proof });
  data.routines[0]!.writes.push({ ...write(8, constant(0)), object: "outline storage of a listed part at 0x10" });
  const effects = describeBehaviour(data).parts[0]!.effects;
  expect(
    effects.some((e) => e.description === "May update the outline coordinates of a part in the overlap list."),
  ).toBe(true);
  expect(effects.some((e) => /drawing flags|selected state/.test(e.description))).toBe(false);
});

describe("starting frames a callback's condition rules out", () => {
  const bounce = (condition: Predicate) => {
    const data = report([rule(field(12), test(12, "==", 1)), rule(constant(1), test(12, "!=", 1))], []);
    data.routines[2]!.outcomes = [
      {
        ...proof,
        effectsComplete: true,
        condition,
        fields: [write(0x12, constant(1))],
        returnValue: constant(0),
      },
    ];
    const animation = describeBehaviour(data).parts[0]!.animations.find((item) => item.trigger.kind === "callback")!;
    return animation.walk.stop?.branches?.map((branch) => branch.condition);
  };

  it("follows only the frames the callback's test of the frame allows", () => {
    expect(bounce(test(12, "!=", 0))).toEqual([test(12, "==", 1), test(12, "==", 2)]);
  });

  it("still follows the one frame the test leaves", () => {
    expect(bounce(test(12, "==", 2))).toEqual([test(12, "==", 2)]);
  });
});

describe("countdowns", () => {
  const minus = (offset: number, value: number): Expression => ({
    kind: "binary",
    operator: "-",
    left: field(offset),
    right: constant(value),
    width: 16,
  });
  const compare = (left: Expression, operator: string, value: number): Predicate => ({
    kind: "compare",
    left,
    operator,
    right: constant(value),
    signed: false,
  });
  const complete = (data: BehaviourReport, outcomes: unknown[]) => {
    data.routines[0] = { ...data.routines[0]!, uncertainties: [], returnPathsComplete: true, outcomes } as never;
    return data;
  };
  const anyPath = {
    ...proof,
    effectsComplete: true,
    condition: { kind: "true" },
    fields: [],
    returnValue: constant(0),
  };
  /** A windmill: while the heat at 0x9c lasts it turns between frames 0 and 1, one heat a run. */
  const windmill = () => {
    const turning = (from: number, to: number) => ({
      ...rule(constant(to), both(test(0x9c, "!=", 0), compare(minus(0x9c, 1), "!=", 0), test(12, "==", from)), [
        write(0x9c, minus(0x9c, 1)),
      ]),
      from: [from],
    });
    return complete(
      report([
        rule(field(12), test(0x9c, "==", 0)),
        rule(field(12), both(test(0x9c, "!=", 0), compare(minus(0x9c, 1), "==", 0)), [write(0x9c, minus(0x9c, 1))]),
        turning(0, 1),
        turning(1, 0),
      ]),
      [anyPath],
    );
  };
  const leaves = (walk: BehaviourWalk): BehaviourWalk[] =>
    walk.stop?.branches?.length ? walk.stop.branches.flatMap((branch) => leaves(branch.walk)) : [walk];

  it("follows a countdown it doesn't know from its starting value, and ends", () => {
    const walk = walkBehaviourRules(windmill(), 39, [known(12, 0)]);
    const all = leaves(walk);
    expect(all.every((leaf) => ["rest", "loop", "joins"].includes(leaf.status))).toBe(true);
    // The heat's tests are tests of the heat the walk started with.
    expect(JSON.stringify(walk.stop?.branches?.map((branch) => branch.condition))).toContain(START);
    // A turn that comes round with the heat further on continues like the earlier turn.
    expect(all.some((leaf) => leaf.joined?.shift?.some((shift) => shift.offset === 0x9c))).toBe(true);
  });

  it("lets a recording that gives the starting value prove when the countdown ends", () => {
    const walk = walkBehaviourRules(windmill(), 39, [known(12, 0)]);
    const animation: AnimationDescription = {
      ...proof,
      id: "turning",
      initial: "reset",
      prerequisites: [],
      initialFields: [known(12, 0)],
      trigger: { ...proof, kind: "run", name: "Run", routine: 100, condition: { kind: "true" }, writes: [] },
      walk,
    };
    const recording = (heat: number | undefined, frames: number[]): MeasuredClip => ({
      path: "synthetic",
      frames: frames.map((state) => ({ state, ...(heat === undefined ? {} : { heat }) })),
      loopStart: null,
      input: {},
      skippedEngineServices: {},
    });
    // With heat 4 it turns three times and holds frame 1.
    expect(compareMeasuredWalks([animation], recording(4, [0, 1, 0, 1, 1]), windmill()).classification).toBe(
      "complete",
    );
    // With heat 5 it would turn once more: the walk disagrees with a recording that holds there.
    expect(compareMeasuredWalks([animation], recording(5, [0, 1, 0, 1, 1]), windmill()).classification).toBe(
      "different",
    );
    // Without the heat, the recording can't tell when it stops.
    expect(compareMeasuredWalks([animation], recording(undefined, [0, 1, 0, 1, 1]), windmill()).classification).toBe(
      "prefix",
    );
  });

  it("takes a rule apart into its paths when they split on a countdown, like the mouse motor's", () => {
    // While the control value at 0x12 is set, each run counts the counter at 0x96 down, and clears the control value
    // when it runs out. The two paths are one rule, which leaves the control value unknown.
    const data = complete(
      report([
        rule(field(12), test(0x12, "!=", 0), [
          write(0x96, minus(0x96, 1)),
          write(0x12, { kind: "unknown", reason: "Field 0x12 differs on complementary paths", width: 16 }),
        ]),
        rule(field(12), test(0x12, "==", 0)),
      ]),
      [
        {
          ...anyPath,
          condition: both(test(0x12, "!=", 0), compare(minus(0x96, 1), "!=", 0)),
          fields: [write(0x96, minus(0x96, 1))],
        },
        {
          ...anyPath,
          condition: both(test(0x12, "!=", 0), compare(minus(0x96, 1), "==", 0)),
          fields: [write(0x96, minus(0x96, 1)), write(0x12, constant(0))],
        },
        { ...anyPath, condition: test(0x12, "==", 0) },
      ],
    );
    const walk = walkBehaviourRules(data, 39, [known(12, 0), known(0x12, 1), known(0x96, 3)]);
    expect(walk).toMatchObject({ status: "rest", states: [0, 0, 0, 0, 0] });
    expect(walk.fields.find((item) => item.offset === 0x12)?.value).toBe(0);
  });

  it("knows a field the run stores from its list scan when the rule tests that value, like the mouse motor's", () => {
    // With the control value at 0x12 clear, the run scans its list and may start itself, which sets the control value.
    // The control value after the scan is one value of the run: the rule that finds it 0 stores 0.
    const scanned: Expression = {
      kind: "field",
      object: "part after list scan at 0x1bff5",
      offset: 0x12,
      width: 16,
      unresolved: true,
    };
    const data = complete(
      report([
        rule(field(12), both(test(0x12, "==", 0), compare(scanned, "==", 0)), [write(0x12, scanned)]),
        rule(constant(1), both(test(0x12, "==", 0), compare(scanned, "!=", 0)), [write(0x12, scanned)]),
        rule(field(12), test(0x12, "!=", 0)),
      ]),
      [anyPath],
    );
    const walk = walkBehaviourRules(data, 39, [known(12, 0), known(0x12, 0)]);
    const still = walk.stop?.branches?.find((branch) => branch.walk.states[0] === 0)?.walk;
    expect(still?.fields.find((item) => item.offset === 0x12)?.value).toBe(0);
    // The scan that found something leaves the control value unknown: the walk doesn't choose it.
    const started = walk.stop?.branches?.find((branch) => branch.walk.states[0] === 1)?.walk;
    expect(started?.fields.some((item) => item.offset === 0x12)).toBe(false);
  });
});
