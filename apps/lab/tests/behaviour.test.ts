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
import {
  statesText,
  summariseBehaviour,
  summariseDoings,
  summariseEffects,
  summariseRests,
  summariseWalks,
  goalMarkSetters,
  goalMarkWords,
  tidyWords,
  type OtherEffect,
  writer,
} from "../src/behaviour.ts";

const fields = [
  { offset: 0x0c, name: "state" },
  { offset: 0x12, name: "stateDelta" },
];
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const field = (offset: number, object = "part"): Expression => ({ kind: "field", object, offset, width: 16 });
const binary = (operator: string, left: Expression, right: Expression): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width: 16,
});
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
    expect(expression(field(0x00, "answer of the query at 0x19fd3"))).toBe("the query's answer");
  });

  it("names what a search or a call leaves on the parts it selects", () => {
    expect(expression(field(0x78, "found list after the query at 0x19ef6"))).toBe("found");
    expect(expression(field(0x0c, "referenced-by(found list after the query at 0x19ef6+0x78)"))).toBe("found.state");
    expect(expression(field(0x78, "next in the found list of the query at 0x19ef6"))).toBe("next found");
    expect(expression(field(0x7a, "value the query at 0x19ef6 writes to a found part"))).toBe("overlapX from the call");
    expect(expression(field(0x96, "value the call at 0x1a730 writes to a selected part"))).toBe("extra from the call");
    expect(expression(field(0x5a, "part after field effect at 0x1a730"))).toBe("link0");
    expect(expression(field(0x0c, "value after the list scan at 0x1d451 in member found by the loop at 0x1a01a"))).toBe(
      "found.state after the scan",
    );
  });

  it("names the other values a run finds itself, in place of the analysis's own words", () => {
    expect(expression(field(0x12, "part after the query at 0x1d2d1"))).toBe("stateDelta after the query");
    expect(expression(field(0x12, "part after list scan at 0x1bff5"))).toBe("stateDelta after the scan");
    expect(expression(field(-2, "local after list scan at 0x1c1f8"))).toBe("local -2 after the scan");
    expect(expression(field(-4, "local after find-first loop at 0x1c1f8"))).toBe("local -4 after the loop");
    expect(expression(field(0x12, "part at the walk's start"))).toBe("stateDelta at the walk's start");
    expect(expression(field(0x00, "centre angle answer at 0x1a5c4"))).toBe("the centre angle");
    expect(expression(field(0x00, "nullable allocation result at 0x192d3"))).toBe("the new part");
    expect(expression(field(0x00, "gear connection conflict at 0x1b1b0"))).toBe("the gear jam");
    expect(expression(field(0x00, "next in the ordered list after the insertion at 0x1a2b4"))).toBe(
      "next in the list after the insertion",
    );
    expect(expression(field(0x0c, "a part reached through a rope, belt or pulley at 0x65c1"))).toBe("reached.state");
    expect(expression(field(0x0c, "a candidate selected by the overlap query at 0x4a70"))).toBe("found.state");
    expect(expression(field(0x0c, "referenced-by(part after the query at 0x1d2af+0x84)"))).toBe("[part+0x84].state");
  });

  it("gives this part's own fields the names that only hold for it", () => {
    const gear = writer(fields, new Map([[0x5a, "gearLeft"]]));
    expect(gear.expression(field(0x5a))).toBe("gearLeft");
    expect(gear.expression(field(0x5a, "referenced-by(part+0x78)"))).toBe("found.link0");
  });

  it("writes numbers in decimal and masks in hex, with brackets around nested sums", () => {
    expect(expression(constant(9))).toBe("9");
    expect(expression(constant(0x1000))).toBe("4096");
    const plus = { kind: "binary", operator: "+", left: field(0x0c), right: constant(1), width: 16 } as const;
    expect(expression(plus)).toBe("state + 1");
    expect(expression({ kind: "binary", operator: "&", left: plus, right: constant(3), width: 16 })).toBe(
      "(state + 1) & 3",
    );
  });

  it("reads numbers in a condition by what they are: signed values, masks in hex and directions in degrees", () => {
    // A speed or a frame is signed, also when a test only says equal or not, and a negative number added is taken off.
    expect(predicate(compare("!=", field(0x12), constant(0xd000)))).toBe("stateDelta != -12288");
    const signedTest: Predicate = {
      kind: "compare",
      operator: ">=",
      left: field(0x0c),
      right: constant(0xfff2),
      signed: true,
    };
    expect(predicate(signedTest)).toBe("state >= -14");
    expect(predicate(compare("!=", binary("+", field(0x0c), constant(0xffff)), constant(0)))).toBe("state - 1 != 0");
    // An unsigned test keeps the number it compares with as it is.
    expect(predicate(compare("<", field(0x12), constant(0xe000)))).toBe("stateDelta < 57344");
    // A mask of a mask is one mask, and the masked value reads in hex like it, or as a number under a small mask.
    expect(predicate(compare("==", binary("&", field(0x12), constant(7)), constant(4)))).toBe("stateDelta & 0x7 == 4");
    const kind = binary("&", binary("&", field(0x12), constant(0x8018)), constant(0x7fff));
    expect(predicate(compare("==", kind, constant(0x10)))).toBe("stateDelta & 0x18 == 0x10");
    expect(predicate(compare("==", binary("&", field(0x08), constant(16)), constant(0)))).toBe("not mirrored");
    expect(predicate(compare("!=", binary("&", field(0x08), constant(0x18)), constant(8)))).toBe(
      "part+0x08 & 0x18 != 0x8",
    );
    // Bits set before a mask that keeps none of them say nothing, and a mask that keeps only those is a number.
    const set = binary("|", field(0x08), constant(0x40));
    expect(predicate(compare("==", binary("&", set, constant(0x400)), constant(0)))).toBe("part+0x08 & 0x400 == 0");
    expect(predicate(compare("!=", binary("&", set, constant(0x40)), constant(0)))).toBe("0x40 != 0");
    // The direction a part was hit from is an angle, a full turn being 0x10000; a masked one stays in bits.
    const angles = writer([...fields, { offset: 0x88, name: "contactAngle" }]);
    const angle = field(0x88, "collider");
    expect(angles.predicate(compare("<", angle, constant(0xe000)))).toBe("collider.contactAngle < 315°");
    expect(angles.predicate(compare("<", binary("+", angle, constant(0x800)), constant(0x1000)))).toBe(
      "collider.contactAngle + 11.25° < 22.5°",
    );
    const side = binary("&", binary("+", angle, constant(0x4000)), constant(0x8000));
    expect(angles.predicate(compare("==", side, constant(0)))).toBe("(collider.contactAngle + 0x4000) & 0x8000 == 0");
    // Outside a condition a word reads as the signed number it is.
    expect(expression(constant(0xd000))).toBe("-12288");
  });

  it("names what the rope code passes a rope callback, and the record of the rope it is asked about", () => {
    const named = [...fields, { offset: 0x04, name: "type" }];
    const rope = writer(named, new Map(), "rope");
    const asked =
      'pointer loaded from table 0x2fe1+0x66 indexed by {"kind":"binary","operator":"+","left":{"kind":"field","object":"argument","offset":10,"width":16},"right":{"kind":"field","object":"address of part","offset":0,"width":16},"width":16}';
    expect(rope.predicate(compare("==", field(0x0c, "argument"), constant(2)))).toBe("ropeKind == 2");
    expect(rope.predicate(compare("!=", field(0x0a, "argument"), constant(0)))).toBe("ropeSlot != 0");
    expect(rope.predicate(compare("==", field(0x04, "referenced-by(argument+0x6)"), constant(3)))).toBe(
      "otherEnd.type == 3",
    );
    expect(rope.predicate(compare("<=", field(0x12, "argument"), field(0x12, "argument")))).toBe(
      "pullMomentum.high <= pullMomentum.high",
    );
    expect(rope.predicate(compare("==", field(0x0e, asked), constant(0)))).toBe("askedRope+0x0e == 0");
    // Other routines' arguments aren't the rope code's, so they keep the analysis's words.
    expect(writer(named).predicate(compare("==", field(0x0c, "argument"), constant(2)))).toBe("argument 12 == 2");
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

  it("says a test of one named flag bit in words, for the part itself and for another part", () => {
    const flags = writer([
      ...fields,
      {
        offset: 0x08,
        name: "drawingFlags",
        masks: [
          { value: 0x10, name: "horizontalFlip" },
          { value: 0x20, name: "verticalFlip" },
        ],
      },
    ]);
    const bit = (offset: number, mask: number, object = "part") => binary("&", field(offset, object), constant(mask));
    expect(flags.predicate(compare("==", bit(0x08, 0x10), constant(0)))).toBe("not mirrored");
    expect(flags.predicate(compare("!=", bit(0x08, 0x20), constant(0)))).toBe("upside down");
    expect(flags.predicate(compare("==", bit(0x08, 0x20), constant(0x20)))).toBe("upside down");
    expect(flags.predicate(compare("==", bit(0x08, 0x2000), constant(0)))).toBe("in play");
    expect(flags.predicate(compare("!=", bit(0x06, 0x1000, "collider"), constant(0)))).toBe(
      "collider on the moving list",
    );
    expect(flags.predicate(compare("==", bit(0x06, 0x40), constant(0)))).toBe("not drawn as tiles");
    expect(flags.predicate(compare("!=", bit(0x0a, 0x100), constant(0)))).toBe("goal mark set");
    // A bit flipped before the test tests the other way.
    const flipped = binary("&", binary("^", field(0x08), constant(0x10)), constant(0x10));
    expect(flags.predicate(compare("==", flipped, constant(0)))).toBe("mirrored");
    // Bits without a name, and more than one bit, keep the analysis's form.
    expect(flags.predicate(compare("==", bit(0x08, 0x0200), constant(0)))).toBe("drawingFlags & 0x200 == 0");
    expect(flags.predicate(compare("==", bit(0x08, 0x30), constant(0)))).toBe("drawingFlags & 0x30 == 0");
  });
});

describe("tidyWords", () => {
  it("leaves out the bit of a flag the analysis names, and names a field it calls by its offset", () => {
    expect(tidyWords("its out-of-play flag 0x2000 is clear")).toBe("its out-of-play flag is clear");
    expect(tidyWords("its positionY is not its field 0x28")).toBe("its positionY is not its olderY");
    expect(tidyWords("its field 0x70 is 3")).toBe("its field 0x70 is 3");
  });
});

describe("statesText", () => {
  it("writes runs of states as ranges", () => {
    expect(statesText([0, 1, 3])).toBe("0–1, 3");
    expect(statesText([0, 1, 2, 4])).toBe("0–2, 4");
    expect(statesText([])).toBe("none");
    expect(statesText(null)).toBe("any");
  });

  it("says a run below 0 with to, so it doesn't read as a subtraction", () => {
    expect(statesText([-1, 0, 1, 2, 3])).toBe("-1 to 3");
    expect(statesText([-1])).toBe("-1");
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
    condition: Predicate = { kind: "true" },
  ): AnimationDescription => ({
    ...finding,
    id: name,
    initial: "run-guard",
    prerequisites: [],
    inputCondition,
    trigger: { ...finding, kind, name, routine: 0x1d034, condition, writes: [] },
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
          animation("related-write", "Hit by an explosion", walk({ status: "rest", frames: [visit(0xffff)] })),
          animation(
            "related-write",
            "Touching an electric switch, if the frame is 0 and a part-specific value is 12288",
            walk({ status: "rest", frames: [visit(0)] }),
            compare("==", field(0x0c), constant(0)),
            // The input case and the hit's own test, as the analysis gives a hit walked from an input case.
            {
              kind: "and",
              terms: [compare("==", field(0x0c), constant(0)), compare("==", field(0x12), constant(0))],
            },
          ),
          animation(
            "callback",
            "rope callback candidate",
            walk({ status: "rest", frames: [visit(1)] }),
            compare("==", field(0x0c, "argument"), constant(2)),
          ),
          animation(
            "callback",
            "flip callback candidate",
            walk({ status: "rest", frames: [visit(1)] }),
            compare("==", field(0x0c, "argument"), constant(2)),
          ),
        ],
      },
    ],
  } as unknown as BehaviourDescription;
  const [run, rope, explosion, bounce, hit, touch, pulled, flipped] = summariseWalks(report, description)[3]!;

  it("names each walk by its trigger and writes its condition as terms", () => {
    expect(run).toMatchObject({ trigger: "run", start: "run-guard", condition: ["stateDelta != 0"] });
    expect(rope).toMatchObject({ trigger: "rope", condition: [] });
    expect(explosion).toMatchObject({ trigger: "by explosion", end: "hold" });
    expect(hit).toMatchObject({ trigger: "hit by an explosion", end: "rest", frames: [-1] });
  });

  it("names what the rope code passes only in the walks the rope callback starts", () => {
    expect(pulled).toMatchObject({ trigger: "rope", condition: ["ropeKind == 2"] });
    expect(flipped).toMatchObject({ trigger: "flip", condition: ["argument 12 == 2"] });
  });

  it("names a touch by the part it touches, keeping what it needs of the part for the tip", () => {
    expect(touch).toMatchObject({ trigger: "touching an electric switch" });
    expect(touch!.about).toBe("Touching an electric switch, if the frame is 0 and a part-specific value is 12288");
  });

  it("keeps what a hit itself tests next to the input case it is walked from, saying each term once", () => {
    expect(touch!.condition).toEqual(["state == 0", "stateDelta == 0"]);
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
      fields: [
        ...fields,
        { offset: 0x36, name: "velocityX" },
        { offset: 0x38, name: "velocityY" },
        { offset: 0x84, name: "contactPart" },
      ].map((f) => ({
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
              "A jack-in-the-box that reaches it sets its velocity up and to the right (velocityX 4096, velocityY -4096).",
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
          effect({
            sourceType: 39,
            sourcePart: "trampoline",
            touch: { returns: 0 },
            description: "A trampoline it touches clears its contact flag and sets its fine vertical position.",
            sets: [
              { kind: "field", offset: 0x84, width: 16, value: 0 },
              {
                kind: "expression",
                offset: 0x06,
                width: 16,
                value: { kind: "binary", operator: "&", left: field(0x06), right: constant(0xfffe), width: 16 },
                words: "clears its contact flag 0x0001 in list flags",
              },
              {
                kind: "expression",
                offset: 0x1a,
                width: 16,
                value: field(0x20),
                words: "sets field 0x1a to the low word of positionY × 512",
              },
              {
                kind: "expression",
                offset: 0x1c,
                width: 16,
                value: field(0x20),
                words: "sets field 0x1c to the high word of positionY × 512",
              },
            ],
          }),
          effect({
            sourceType: 51,
            sourcePart: "vacuum-cleaner",
            touch: {},
            sets: [
              {
                kind: "expression",
                offset: 0x08,
                width: 16,
                value: { kind: "binary", operator: "|", left: field(0x08), right: constant(0x2000), width: 16 },
                words: "sets its out-of-play flag 0x2000 in drawing flags",
              },
              {
                kind: "expression",
                offset: 0x0a,
                width: 16,
                value: { kind: "binary", operator: "|", left: field(0x0a), right: constant(0x100), width: 16 },
                words: "sets its goal mark 0x0100 in field 0x0a",
              },
              {
                kind: "expression",
                offset: 0x38,
                width: 16,
                value: { kind: "binary", operator: "+", left: field(0x38), right: constant(0x800), width: 16 },
                words: "adds 2048 to velocityY",
              },
            ],
          }),
        ],
      },
    ],
  } as unknown as BehaviourDescription;
  const [push, away, punch, touch, trampoline, vacuum] = summariseEffects(report, description)[12]!;

  it("writes what another part sets and the value, with what this part must be in a few words", () => {
    expect(push).toMatchObject({
      sourceType: 41,
      source: "explosion",
      sets: [{ what: "speed", value: "4096" }],
      when: ["moving list"],
      sourceWhen: [],
      sourceConditions: ["state + 1 == 2"],
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
    expect(touch).toMatchObject({ touch: true, sets: [{ what: "velocityX", value: "halved, rounding down" }] });
    expect(push!.touch).toBeUndefined();
    expect(vacuum!.sets[2]).toEqual({ what: "velocityY", value: "velocityY + 2048" });
  });

  it("writes a formula another part adds, and a velocity it only keeps within the part's speed limit", () => {
    const push = (words: string, offset: number) => ({
      kind: "expression",
      offset,
      width: 16,
      value: field(offset),
      words,
    });
    const fan = {
      parts: [
        {
          type: 12,
          effectsFromOthers: [
            effect({
              sourceType: 50,
              sourcePart: "fan",
              sets: [
                push("keeps velocityY within its speed limit", 0x38),
                push("adds 16 * (256 - |overlapX|) to velocityX, kept within its speed limit", 0x36),
                push("adds 1536 to velocityX, kept within its speed limit", 0x36),
              ],
            }),
          ],
        },
      ],
    } as unknown as BehaviourDescription;
    expect(summariseEffects(report, fan)[12]![0]!.sets).toEqual([
      { what: "velocityY", value: "kept within its speed limit" },
      { what: "velocityX", value: "velocityX + 16 * (256 - |overlapX|), kept within its speed limit" },
      { what: "velocityX", value: "velocityX + 1536, kept within its speed limit" },
    ]);
  });

  it("names the fields a contact search after the effect may change", () => {
    const launch = {
      parts: [
        {
          type: 12,
          effectsFromOthers: [
            effect({
              sourceType: 3,
              sourcePart: "teeter-totter",
              sets: [{ kind: "field", offset: 0x38, width: 16, value: 0xe400 }],
              searched: [0x12, 0x40],
            }),
          ],
        },
      ],
    } as unknown as BehaviourDescription;
    expect(summariseEffects(report, launch)[12]![0]!.searched).toEqual(["stateDelta", "part+0x40"]);
    expect(summariseEffects(report, description)[12]![0]!.searched).toBeUndefined();
  });

  it("says a flag bit with a proved meaning by its name, and both words of the fine position as one", () => {
    expect(trampoline!.sets).toEqual([
      { what: "contactPart", value: "0" },
      { what: "contact flag", value: "cleared" },
      { what: "fine Y", value: "positionY × 512" },
    ]);
    expect(vacuum!.sets.slice(0, 2)).toEqual([
      { what: "out-of-play flag", value: "set" },
      { what: "goal mark", value: "set", mark: 0x100 },
    ]);
  });

  it("joins effects of one part that say the same, keeping the condition of each way", () => {
    const way = (value: number, assumption: string, address: number) =>
      effect({
        sourceType: 13,
        sourcePart: "jack-in-the-box",
        sourceCondition: compare("<=", field(0x0c), constant(value)),
        sets: [{ kind: "speed", fields: [0x36, 0x38], speed: 4096, setter: 0x7d97 }],
        assumptions: [assumption],
        evidence: [{ address, bytes: "90", text: "nop" }],
      });
    const twice = {
      parts: [{ type: 12, effectsFromOthers: [way(7, "One.", 0x10), way(18, "Two.", 0x20)] }],
    } as unknown as BehaviourDescription;
    const [joined, ...rest] = summariseEffects(report, twice)[12]!;
    expect(rest).toEqual([]);
    expect(joined!.sourceConditions).toEqual(["state <= 7", "state <= 18"]);
    expect(joined!.assumptions).toEqual(["One.", "Two."]);
    expect(joined!.evidence.map((e) => e.address)).toEqual([0x10, 0x20]);
  });
});

describe("summariseRests", () => {
  const report = {
    layout: { fields: fields.map((f) => ({ ...f, confidence: "checked", evidence: [], assumptions: [] })) },
    parts: [
      { type: 3, routines: [] },
      { type: 21, routines: [] },
    ],
  } as unknown as BehaviourReport;
  const rest = (more: object) => ({ ...finding, fields: [], ...more });
  const description = {
    parts: [
      {
        type: 3,
        rest: rest({
          status: "saved",
          description: "The reset keeps the frame the level saved: 0, 1 or 2.",
          frames: [0, 1, 2],
        }),
        stableStates: [
          { ...finding, state: 0, fields: [], origins: [{ condition: { kind: "true" }, evidence }] },
          {
            ...finding,
            state: 1,
            fields: [],
            walks: 158,
            origins: [
              { condition: compare("!=", field(0x12), constant(0)), evidence },
              { condition: { kind: "true" }, evidence },
            ],
          },
          {
            ...finding,
            state: 2,
            fields: [],
            walks: 157,
            origins: [
              { condition: compare("!=", field(0x12), constant(0)), evidence },
              { condition: compare("==", field(0x12), constant(0)), evidence },
            ],
          },
        ],
      },
      {
        type: 21,
        rest: rest({
          status: "sockets",
          description: "The reset sets the frame from the part's sockets.",
          frames: [0, 4],
        }),
        stableStates: [],
      },
      {
        type: 60,
        rest: rest({
          status: "saved",
          description: "The reset keeps the frame the level saved.",
          frames: [0, 1, 2, 3, 0xffff],
        }),
        stableStates: [
          { ...finding, state: 3, fields: [], walks: 1, origins: [] },
          { ...finding, state: 0xffff, fields: [], walks: 1, origins: [] },
        ],
      },
    ],
  } as unknown as BehaviourDescription;
  const rests = summariseRests(report, description);

  it("keeps how the reset leaves the frame, with the frames it can be", () => {
    expect(rests[3]).toMatchObject({ status: "saved", frames: [0, 1, 2], confidence: "inferred" });
    expect(rests[21]).toMatchObject({ status: "sockets", frames: [0, 4], resting: [] });
    expect(rests[3]!.state).toBeUndefined();
  });

  it("lists the resting frames with how many walks end there and the conditions on the way", () => {
    expect(rests[3]!.resting).toMatchObject([
      { state: 0, conditions: [], ways: 1, always: true },
      { state: 1 },
      { state: 2, walks: 157, conditions: ["stateDelta != 0", "stateDelta == 0"], ways: 157, capped: true },
    ]);
    expect(rests[3]!.resting[0]!.walks).toBeUndefined();
  });

  it("rests on a frame always when a way there has no test, keeping no other way's condition as needed", () => {
    expect(rests[3]!.resting[1]).toMatchObject({ walks: 158, always: true, conditions: [], ways: 158 });
    expect(rests[3]!.resting[2]!.always).toBeUndefined();
  });

  it("gives a frame the program keeps as a word signed, like the wood incline's -1, in order", () => {
    expect(rests[60]!.frames).toEqual([-1, 0, 1, 2, 3]);
    expect(rests[60]!.resting.map((r) => r.state)).toEqual([-1, 3]);
  });
});

describe("summariseDoings", () => {
  const line = (kind: string, description: string, confidence = "inferred", condition?: Predicate) => ({
    ...finding,
    confidence,
    kind,
    description,
    ...(condition ? { condition } : {}),
  });
  const cannonball =
    "Creates a cannonball (type 43, which starts on frame 0) at positionX = its positionX + 97 and positionY = its positionY - 7, moving at velocityX = 12288 and velocityY = -4096 (each kept within the cannonball's speed limit).";
  const ran =
    "Sets the part's ran-this-step mark 0x0040 in drawing flags (the step's run loop clears it first and then calls no run callback of a part that has it).";
  const relay =
    "May change field 0x14 of a part its ropes, belt or pulleys reach (this part too): the value the relay passes along.";
  const description = {
    parts: [
      {
        type: 18,
        effects: [
          line("related-object", cannonball, "inferred", compare("==", field(0x0c), constant(2))),
          line("drawing", ran, "inferred", compare("!=", field(0x12), constant(0))),
          line("drawing", ran, "unresolved", compare("==", field(0x12), constant(0))),
          line("drawing", `Sets flag 0x200 of the part's drawing flags. ${ran}`, "inferred", { kind: "true" }),
          line("helper", "Can call a shared helper: Turns a rope around."),
          line("related-object", relay),
        ],
      },
    ],
  } as unknown as BehaviourDescription;
  const report = {
    layout: { fields: fields.map((f) => ({ ...f, confidence: "checked", evidence: [], assumptions: [] })) },
    parts: [{ type: 18, routines: [] }],
  } as unknown as BehaviourReport;
  const doings = summariseDoings(report, description)[18]!;

  it("keeps the parts it creates, what it does to other parts and its own flags with a proved meaning", () => {
    expect(doings.map((d) => [d.on, d.description])).toEqual([
      ["created", cannonball],
      ["itself", ran.replace(" 0x0040", "")],
      ["others", relay],
    ]);
  });

  it("makes each sentence one line, and ways that say the same one line, as unsure as the least sure of them", () => {
    expect(doings[1]).toMatchObject({ ways: 3, confidence: "unresolved" });
    expect(doings[0]).toMatchObject({ ways: 1, confidence: "inferred" });
  });

  it("keeps the condition of each way, so a line never reads as if it always happens", () => {
    expect(doings[0]!.conditions).toEqual(["state == 2"]);
    expect(doings[1]!.conditions).toEqual(["stateDelta != 0", "stateDelta == 0", "always"]);
    expect(doings[2]!.conditions).toEqual([]);
  });
});

describe("summariseDoings with ways that say the same", () => {
  const way = (address: number, assumption: string) => ({
    confidence: "inferred",
    kind: "drawing",
    description:
      "Sets the part's ran-this-step mark 0x0040 in drawing flags (the step's run loop clears it first and then calls no run callback of a part that has it).",
    assumptions: [assumption],
    evidence: [{ address, bytes: "90", text: "nop" }],
    condition: { kind: "true" },
  });
  const first = way(0x100, "The first way's assumption.");
  const second = way(0x200, "The second way's assumption.");
  const description = { parts: [{ type: 18, effects: [first, second] }] } as unknown as BehaviourDescription;
  const report = {
    layout: { fields: fields.map((f) => ({ ...f, confidence: "checked", evidence: [], assumptions: [] })) },
    parts: [{ type: 18, routines: [] }],
  } as unknown as BehaviourReport;

  it("keeps the assumptions and evidence of every way, and leaves the description's own lists alone", () => {
    const [line] = summariseDoings(report, description)[18]!;
    expect(line).toMatchObject({ ways: 2 });
    expect(line!.assumptions).toEqual(["The first way's assumption.", "The second way's assumption."]);
    expect(line!.evidence.map((e) => e.address)).toEqual([0x100, 0x200]);
    expect(first.assumptions).toEqual(["The first way's assumption."]);
  });
});

describe("goal marks", () => {
  const effect = (sourceType: number, source: string, mark: number) =>
    ({ sourceType, source, sets: [{ what: "goal mark", value: "set", mark }] }) as unknown as OtherEffect;
  const setters = goalMarkSetters({
    31: [effect(40, "Cat", 0x200), effect(41, "Alligator", 0x200), effect(42, "Vacuum", 0x100)],
  });

  it("knows the parts that set each mark on a part", () => {
    expect(setters.get("31:512")).toEqual(["Cat", "Alligator"]);
    expect(setters.get("31:256")).toEqual(["Vacuum"]);
  });

  it("says a goal's test of a mark by the parts that set it, and keeps a bit no part is seen to set", () => {
    expect(goalMarkWords("field 0xa has the bits 0x200", [31], setters)).toBe("marked by Cat or Alligator");
    expect(goalMarkWords("field 0xa hasn't the bits 0x100", [31], setters)).toBe("not marked by Vacuum");
    expect(goalMarkWords("field 0xa has the bits 0x10", [31], setters)).toBe("field 0xa has the bits 0x10");
    expect(goalMarkWords("field 0xa has the bits 0x80", [31], setters)).toBe("goal mark set");
  });
});
