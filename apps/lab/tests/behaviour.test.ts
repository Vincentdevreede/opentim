import type { BehaviourReport, Expression, PartBehaviour, Predicate } from "@opentim/content";
import { describe, expect, it } from "vitest";
import { statesText, summariseBehaviour, writer } from "../src/behaviour.ts";

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
