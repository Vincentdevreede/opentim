import { describe, expect, it } from "vitest";
import type { BehaviourReport, Expression, FieldWrite, Predicate, Transition } from "../src/read/behaviour.ts";
import {
  CONTROL_VALUE_ASSUMPTION,
  CONVEYOR_BELT_ASSUMPTION,
  ELECTRIC_MOTOR_ASSUMPTION,
  GEAR_ASSUMPTION,
  MONKEY_BIKE_ASSUMPTION,
  MOUSE_MOTOR_ASSUMPTION,
  TEETER_TOTTER_END_ASSUMPTION,
} from "../src/read/behaviour-saved-frames.ts";
import { describeBehaviour, walkBehaviourRules, type KnownField } from "../src/read/describe-behaviour.ts";

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
