import type {
  AnimationDescription,
  BehaviourDescription,
  BehaviourReport,
  BehaviourWalk,
  Expression,
  PartBehaviour,
  Predicate,
} from "@opentim/content";
import { describe, expect, it } from "vitest";
import { statesText, summariseBehaviour, summariseEffects, summariseWalks, writer } from "../src/behaviour.ts";

const fields = [
  { offset: 0x0c, name: "state" },
  { offset: 0x12, name: "stateDelta" },
];
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const field = (offset: number, object = "part"): Expression => ({ kind: "field", object, offset, width: 16 });
const compare = (operator: string, left: Expression, right: Expression): Predicate => ({
  kind: "compare",
  operator,
  left,
  right,
  signed: false,
});
const evidence = [{ address: 0x1d034, bytes: [0x55], text: "push bp" }];
const finding = { confidence: "inferred" as const, assumptions: ["An assumption."], evidence };

describe("writer", () => {
  const { expression, predicate } = writer(fields);

  it("names the part's fields and writes other places by their offset", () => {
    expect(expression(field(0x0c))).toBe("state");
    expect(expression(field(0x8a))).toBe("part+0x8a");
    expect(expression(field(0x1e, "referenced-by(part+0x84)"))).toBe("[part+0x84]+0x1e");
    expect(expression(field(0x0c, "referenced-by(part+0x84)"))).toBe("[part+0x84].state");
    expect(expression(field(0x40ef, "data"))).toBe("ds:0x40ef");
  });

  it("names linked objects by what they are, from the fields the program's code shows", () => {
    expect(expression(field(0x78))).toBe("found");
    expect(expression(field(0x0c, "referenced-by(part after unresolved write at 0x1d32a+0x78)"))).toBe("found.state");
    expect(expression(field(0x7a, "referenced-by(part+0x78) after field effect at 0x1d32a"))).toBe("found.overlapX");
    expect(expression(field(0x04, "referenced-by(part+0x54)"))).toBe("belt.end1");
    expect(expression(field(0x08, "referenced-by(referenced-by(part+0x54)+0x6)"))).toBe("belt.end2+0x08");
    expect(expression(field(0x0c, "referenced-by(referenced-by(part+0x54)+0x6)"))).toBe("belt.end2.state");
    expect(expression(field(0x09, "referenced-by(part+0x82)"))).toBe("outline[2].y");
    expect(expression(field(0x00, "referenced-by(part+0x66)"))).toBe("rope.part");
    expect(expression(field(0x02, "referenced-by(part+0x66)"))).toBe("rope+0x02");
    expect(expression(field(0x0c, "overlap candidate at 0x4a70"))).toBe("found.state");
    expect(expression(field(0x62))).toBe("socket1");
    expect(expression(field(0x00, "address of part"))).toBe("this");
    expect(expression(field(0x0c, "member found by the loop at 0x1a01a"))).toBe("found.state");
    expect(expression(field(0x00, "member found by the loop at 0x1a01a link"))).toBe("found");
    expect(expression(field(0x00, "answer of the query at 0x19fd3"))).toBe("answer at 0x19fd3");
  });

  it("names what a search or a call leaves on the parts it selects", () => {
    expect(expression(field(0x78, "found list after the query at 0x19ef6"))).toBe("found");
    expect(expression(field(0x0c, "referenced-by(found list after the query at 0x19ef6+0x78)"))).toBe("found.state");
    expect(expression(field(0x78, "next in the found list of the query at 0x19ef6"))).toBe("next found");
    expect(expression(field(0x7a, "value the query at 0x19ef6 writes to a found part"))).toBe(
      "overlapX from the call at 0x19ef6",
    );
    expect(expression(field(0x96, "value the call at 0x1a730 writes to a selected part"))).toBe(
      "part+0x96 from the call at 0x1a730",
    );
    expect(expression(field(0x5a, "part after field effect at 0x1a730"))).toBe("link0");
    expect(expression(field(0x0c, "value after the list scan at 0x1d451 in member found by the loop at 0x1a01a"))).toBe(
      "found.state after the scan at 0x1d451",
    );
  });

  it("gives this part's own fields the names that only hold for it", () => {
    const gear = writer(fields, new Map([[0x5a, "gearLeft"]]));
    expect(gear.expression(field(0x5a))).toBe("gearLeft");
    expect(gear.expression(field(0x5a, "referenced-by(part+0x78)"))).toBe("found.link0");
  });

  it("writes small numbers in decimal and others in hex, with brackets around nested sums", () => {
    expect(expression(constant(9))).toBe("9");
    expect(expression(constant(0x1000))).toBe("0x1000");
    const plus = { kind: "binary", operator: "+", left: field(0x0c), right: constant(1), width: 16 } as const;
    expect(expression(plus)).toBe("state + 1");
    expect(expression({ kind: "binary", operator: "&", left: plus, right: constant(3), width: 16 })).toBe(
      "(state + 1) & 3",
    );
  });

  it("joins conditions and says when there is none", () => {
    expect(predicate({ kind: "true" })).toBe("always");
    expect(
      predicate({
        kind: "and",
        terms: [compare("!=", field(0x12), constant(0)), compare("==", field(0x0c), constant(4))],
      }),
    ).toBe("stateDelta != 0 and state == 4");
  });
});

describe("statesText", () => {
  it("writes runs of states as ranges", () => {
    expect(statesText([0, 1, 3])).toBe("0–1, 3");
    expect(statesText([0, 1, 2, 4])).toBe("0–2, 4");
    expect(statesText([])).toBe("none");
    expect(statesText(null)).toBe("any");
  });
});

describe("summariseBehaviour", () => {
  const routine = (role: string, segment: number, offset: number, shared = false, sharedDefault = false) => ({
    ...finding,
    slot: 0,
    field: 0x22,
    address: segment * 16 + offset,
    segment,
    offset,
    shared,
    sharedDefault,
    role: `${role} callback candidate`,
  });
  const part: PartBehaviour = {
    id: "trampoline",
    type: 39,
    routines: [routine("run", 0x190f, 0x3f44), routine("resize", 0, 0x2a9, true, true)],
    stateWrites: [],
    transitions: [
      { ...finding, from: [4], to: constant(0), condition: compare("!=", field(0x12), constant(0)), routine: 0x1d034 },
      { ...finding, from: [0, 1], to: field(0x0c), condition: { kind: "true" }, routine: 0x1d034 },
    ],
    counters: [],
    reset: [],
    visibleEffects: [],
    triggers: [
      { ...finding, name: "run callback candidate", routine: 0x1d034 },
      { ...finding, name: "Field 0x12 gates a state change", routine: 0x1d034, field: 0x12 },
    ],
    uncertainties: ["Effects of call at 0x1d04e to 0x8ea6 are not fully resolved"],
  };
  const report = {
    layout: { fields: fields.map((f) => ({ ...f, confidence: "checked", evidence: [], assumptions: [] })) },
    timing: {
      diagnostics: [],
      pit: { divisor: 5041, confidence: "inferred", evidence, assumptions: ["The PIT clock is 1,193,182 Hz."] },
      cycle: {
        minimumInterrupts: 8,
        minimumPeriodMilliseconds: 33.8,
        confidence: "inferred",
        evidence,
        assumptions: [],
      },
    },
    parts: [part],
    assumptions: [],
  } as unknown as BehaviourReport;
  const summary = summariseBehaviour(report);
  const trampoline = summary.parts[39]!;

  it("names each routine by its role and marks shared empty ones", () => {
    expect(trampoline.routines.map((r) => [r.role, r.at, r.empty])).toEqual([
      ["run", "0x190f:0x3f44", false],
      ["resize", "0x0000:0x02a9", true],
    ]);
  });

  it("writes state changes as text and marks those that keep the state", () => {
    expect(trampoline.changes.map((c) => [c.routine, c.from, c.to, c.toState, c.keeps, c.condition])).toEqual([
      ["run", [4], "0", 0, false, "stateDelta != 0"],
      ["run", [0, 1], "state", undefined, true, "always"],
    ]);
    expect(trampoline.changes[0]!.evidence).toEqual([{ address: 0x1d034, text: "push bp" }]);
  });

  it("keeps the triggers other than the six routines", () => {
    expect(trampoline.triggers.map((t) => t.name)).toEqual(["stateDelta gates a state change"]);
  });

  it("works out the timer rate from its divisor", () => {
    expect(summary.timing.divisor).toBe(5041);
    expect(summary.timing.ticksPerSecond).toBeCloseTo(236.7, 1);
    expect(summary.timing.minimumTicks).toBe(8);
  });
});

describe("summariseWalks", () => {
  const visit = (state: number) => ({ ...finding, state, frame: state, atRun: 0, runCalls: 0 });
  const walk = (more: Partial<BehaviourWalk>): BehaviourWalk => ({
    ...finding,
    status: "rest",
    states: [],
    frames: [],
    runCalls: 0,
    fields: [],
    timingReason: "",
    ...more,
  });
  const animation = (
    kind: AnimationDescription["trigger"]["kind"],
    name: string,
    w: BehaviourWalk,
    inputCondition?: Predicate,
  ): AnimationDescription => ({
    ...finding,
    id: name,
    initial: "run-guard",
    prerequisites: [],
    inputCondition,
    trigger: { ...finding, kind, name, routine: 0x1d034, condition: { kind: "true" }, writes: [] },
    walk: w,
  });
  const report = {
    layout: { fields: fields.map((f) => ({ ...f, confidence: "checked", evidence: [], assumptions: [] })) },
    parts: [{ type: 3, routines: [] }],
  } as unknown as BehaviourReport;
  const description = {
    parts: [
      {
        type: 3,
        animations: [
          animation(
            "input-case",
            "If the state-control value is not 0",
            walk({ status: "loop", frames: [visit(0), visit(1), visit(2)], loopStart: 1 }),
            compare("!=", field(0x12), constant(0)),
          ),
          animation(
            "callback",
            "rope callback candidate",
            walk({
              status: "unresolved",
              stop: {
                kind: "state",
                description: "The seed fixes only some bits of the state.",
                evidence: [],
                branches: [
                  {
                    condition: compare("==", field(0x0c), constant(0)),
                    walk: walk({ status: "unresolved", frames: [visit(0)], reason: "Needs the control value." }),
                  },
                ],
              },
            }),
          ),
          animation(
            "related-write",
            "A recorded effect of explosion",
            walk({ parameterised: { kind: "hold", state: field(0x0c) } }),
          ),
          animation(
            "callback",
            "bounce callback candidate",
            walk({
              status: "unresolved",
              stop: {
                kind: "ambiguity",
                description: "The recorded branches have different field effects.",
                evidence: [],
                branches: [
                  {
                    condition: { kind: "and", terms: [compare("==", field(0x0c), constant(0))] },
                    alternatives: [compare("==", field(0x12), constant(0)), compare("==", field(0x12), constant(2))],
                    walk: walk({ status: "rest", frames: [visit(1), visit(1)] }),
                  },
                  {
                    condition: compare("!=", field(0x0c), constant(0)),
                    // Splits again twice more, past the branches the summary shows, and every way ends.
                    walk: walk({
                      status: "unresolved",
                      stop: {
                        kind: "ambiguity",
                        description: "The recorded branches have different field effects.",
                        evidence: [],
                        branches: [
                          {
                            condition: compare("==", field(0x12), constant(1)),
                            walk: walk({
                              status: "unresolved",
                              stop: {
                                kind: "ambiguity",
                                description: "The recorded branches have different field effects.",
                                evidence: [],
                                branches: [
                                  {
                                    condition: compare("==", field(0x12), constant(3)),
                                    walk: walk({ status: "joins" }),
                                  },
                                  {
                                    condition: compare("!=", field(0x12), constant(3)),
                                    walk: walk({ status: "rest" }),
                                  },
                                ],
                              },
                            }),
                          },
                          { condition: compare("!=", field(0x12), constant(1)), walk: walk({ status: "joins" }) },
                        ],
                      },
                    }),
                  },
                ],
              },
            }),
          ),
          animation("related-write", "Hit by an explosion", walk({ status: "rest", frames: [visit(0)] })),
        ],
      },
    ],
  } as unknown as BehaviourDescription;
  const [run, rope, explosion, bounce, hit] = summariseWalks(report, description)[3]!;

  it("names each walk by its trigger and writes its condition as terms", () => {
    expect(run).toMatchObject({ trigger: "run", start: "run-guard", condition: ["stateDelta != 0"] });
    expect(rope).toMatchObject({ trigger: "rope", condition: [] });
    expect(explosion).toMatchObject({ trigger: "by explosion", end: "hold" });
    expect(hit).toMatchObject({ trigger: "hit by an explosion", end: "rest" });
  });

  it("keeps the frames, where a loop goes back to, and the path under each condition where it splits", () => {
    expect(run).toMatchObject({ frames: [0, 1, 2], end: "loop", loopFrom: 1, branches: [] });
    expect(rope).toMatchObject({
      end: "branches",
      reason: "The seed fixes only some bits of the state.",
      branches: [{ condition: ["state == 0"], path: { frames: [0], end: "stop", reason: "Needs the control value." } }],
    });
    expect(rope!.settled).toBeUndefined();
  });

  it("says when every way a walk splits into ends, also past the branches it shows", () => {
    expect(bounce).toMatchObject({ end: "branches", settled: true });
    expect(bounce!.branches[1]!.path.branches[0]!.path).toMatchObject({
      end: "branches",
      settled: true,
      ways: 2,
      branches: [],
    });
  });

  it("writes rules that lead to the same next fields as what they all test and one of their cases", () => {
    expect(bounce!.branches[0]!.condition).toEqual(["state == 0", "one of 2 cases"]);
  });
});

describe("summariseEffects", () => {
  const report = {
    layout: {
      fields: [...fields, { offset: 0x36, name: "velocityX" }, { offset: 0x38, name: "velocityY" }].map((f) => ({
        ...f,
        confidence: "checked",
        evidence: [],
        assumptions: [],
      })),
    },
    parts: [{ type: 12, routines: [] }],
  } as unknown as BehaviourReport;
  const effect = (more: object) => ({
    ...finding,
    sourceType: 41,
    sourcePart: "explosion",
    routine: 0x1a73a,
    sourceCondition: compare(
      "==",
      { kind: "binary", operator: "+", left: field(0x0c), right: constant(1), width: 16 },
      constant(2),
    ),
    sourceConditionWords: [],
    condition: compare(
      "!=",
      { kind: "binary", operator: "&", left: field(0x06), right: constant(0x1000), width: 16 },
      constant(0),
    ),
    conditionWords: ["on the moving list"],
    description: "An explosion that reaches it sets its speed to 4096.",
    ...more,
  });
  const description = {
    parts: [
      {
        type: 12,
        effectsFromOthers: [
          effect({ sets: [{ kind: "speed", fields: [0x36, 0x38], speed: 4096, setter: 0x7d97 }] }),
          effect({
            sets: [
              {
                kind: "speed",
                fields: [0x36, 0x38],
                speed: 3072,
                setter: 0x7d97,
                away: { routine: 0x496e, degrees: 0.22 },
              },
            ],
          }),
          effect({
            sourceType: 13,
            sourcePart: "jack-in-the-box",
            sourceConditionWords: ["mirrored"],
            velocityDirection: "up and to the right",
            description:
              "A jack in the box that reaches it sets its velocity up and to the right (velocityX 4096, velocityY -4096).",
            sets: [
              { kind: "field", offset: 0x36, width: 16, value: 4096 },
              { kind: "field", offset: 0x38, width: 16, value: 0xf000 },
            ],
          }),
          effect({
            sourceType: 39,
            sourcePart: "trampoline",
            touch: { returns: 0 },
            description: "A trampoline it touches halves velocityX (rounding down).",
            sets: [
              {
                kind: "expression",
                offset: 0x36,
                width: 16,
                value: { kind: "binary", operator: ">>", left: field(0x36), right: constant(1), width: 16 },
                words: "halves velocityX (rounding down)",
              },
            ],
          }),
        ],
      },
    ],
  } as unknown as BehaviourDescription;
  const [push, away, punch, touch] = summariseEffects(report, description)[12]!;

  it("writes what another part sets and the value, with what this part must be in a few words", () => {
    expect(push).toMatchObject({
      sourceType: 41,
      source: "explosion",
      sets: [{ what: "speed", value: "4096" }],
      when: ["moving list"],
      sourceWhen: [],
      sourceCondition: "state + 1 == 2",
      confidence: "inferred",
    });
  });

  it("says when a speed points away from the other part, and how close", () => {
    expect(push!.awayWithin).toBeUndefined();
    expect(away).toMatchObject({ sets: [{ what: "speed away", value: "3072" }], awayWithin: 0.22 });
  });

  it("reads both velocities as their direction on the screen, keeping the numbers for the tip", () => {
    expect(punch).toMatchObject({
      sets: [{ what: "", value: "up and to the right" }],
      sourceWhen: ["mirrored"],
    });
    expect(punch!.description).toContain("(velocityX 4096, velocityY -4096)");
  });

  it("writes a value of the part's own fields as a formula, and marks a touch", () => {
    expect(touch).toMatchObject({ touch: true, sets: [{ what: "velocityX", value: "velocityX >> 1" }] });
    expect(push!.touch).toBeUndefined();
  });
});
