import { describe, expect, it } from "vitest";
import type { BehaviourReport, Expression, FieldWrite, Predicate, Transition } from "../src/read/behaviour.ts";
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
