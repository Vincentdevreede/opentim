import { describe, expect, it } from "vitest";
import { type Expression, type Transition, transitionCounts } from "../src/read/behaviour.ts";

const runValue = (object: string): Expression => ({ kind: "field", object, offset: 0x14, width: 16, unresolved: true });
const rule = (...values: Expression[]): Transition => ({
  from: [0],
  to: { kind: "constant", value: 1, width: 16 },
  condition: { kind: "true" },
  routine: 0x10,
  confidence: "inferred",
  assumptions: [],
  evidence: [],
  updates: values.map((value) => ({
    object: "part",
    offset: 0x14,
    width: 16,
    value,
    condition: { kind: "true" },
    routine: 0x10,
    confidence: "inferred",
    assumptions: [],
    evidence: [],
  })),
});

describe("transition counts", () => {
  it("counts a value a call writes but nobody follows apart from named run values", () => {
    const counts = transitionCounts([
      rule({ kind: "unknown", reason: "A call may change this field", width: 16 }),
      rule(runValue("value the call at 0x1a730 writes to a selected part")),
      rule(runValue("part after field effect at 0x1a730")),
      rule(runValue("value the query at 0x19ef6 writes to a found part")),
      rule(runValue("found list after the query at 0x19ef6")),
      rule(runValue("centre angle answer at 0x2000"), { kind: "constant", value: 3, width: 16 }),
      // A rule that writes both a placeholder and a named value says no more than its placeholder.
      rule(runValue("answer of the query at 0x8"), runValue("part after list scan at 0x9")),
      rule({ kind: "constant", value: 3, width: 16 }),
    ]);
    expect(counts).toEqual({ unresolved: 0, conditional: 0, unknownWrites: 1, callWritten: 4, namedRunValues: 2 });
  });
});
