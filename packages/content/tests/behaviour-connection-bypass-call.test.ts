import { describe, expect, it } from "vitest";
import { analyseRoutine, type Expression, type Predicate } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const fact = {
  confidence: "inferred" as const,
  evidence: [],
  assumptions: ["The checked bypass calls no other routine."],
};
const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const field = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
const compare = (left: Expression, operator: string, right = 0): Predicate => ({
  kind: "compare",
  operator,
  left,
  right: constant(right),
  signed: false,
});
function helper(): EngineSummary {
  const flag: Expression = { kind: "binary", operator: "&", left: field(8), right: constant(0x200), width: 16 };
  const links: Expression = { kind: "binary", operator: "|", left: field(0x60), right: field(0x62), width: 16 };
  return {
    ...fact,
    address: 0x100,
    kind: "connection-query",
    purpose: "May dispatch a peer callback.",
    argumentOffset: 6,
    argumentKind: "object",
    calls: [],
    writes: [],
    returns: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: false,
      partMemoryComplete: false,
      preservesArgumentMemory: false,
      preservesPartState: false,
      unknownEffects: ["Indirect callback effects."],
    },
    shortCircuit: {
      ...fact,
      argumentOffset: 6,
      ownerArgument: 8,
      cases: [
        { condition: compare(flag, "!="), value: constant(1) },
        { condition: { kind: "and", terms: [compare(flag, "=="), compare(links, "==")] }, value: constant(0) },
      ],
      remaining: { kind: "and", terms: [compare(flag, "=="), compare(links, "!=")] },
    },
  };
}
function analyse(initial: number[], far = true) {
  const image = new Uint8Array(0x120);
  // The first argument is excludedPart=0; the owner is the second argument.
  const call = far ? [0x9a, 0, 1, 0, 0] : [0xe8, 0, 0];
  const bytes = [
    0x55,
    0x8b,
    0xec,
    0x56,
    0x8b,
    0x76,
    6,
    ...initial,
    0x56,
    0xb8,
    0,
    0,
    0x50,
    ...call,
    0x83,
    0xc4,
    4,
    0x89,
    0x44,
    12,
    0x5e,
    0x5d,
    0xcb,
  ];
  if (!far) {
    const at = bytes.indexOf(0xe8);
    bytes[at + 1] = (0x100 - at - 3) & 255;
    bytes[at + 2] = 0;
  }
  image.set(bytes);
  image[0x100] = 0xcb;
  return analyseRoutine(
    image,
    { address: 0, segment: 0, offset: 0 },
    { engineSummaries: new Map([[0x100, helper()]]) },
  );
}
const store = (offset: number, value: number) => [0xc7, 0x44, offset, value & 255, value >> 8];
describe("connection-query bypass composition", () => {
  it("maps the owner through the second argument and returns one for the checked flag", () => {
    const result = analyse(store(8, 0x200));
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 1)).toBe(true);
    expect(result.uncertainties).toEqual([]);
    expect(result.engineCalls?.some((c) => c.purpose.includes("certified connection-query bypass"))).toBe(true);
  });
  it("returns zero when the checked flag is clear and both connections are null", () => {
    const result = analyse([...store(8, 0), ...store(0x60, 0), ...store(0x62, 0)]);
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 0)).toBe(true);
    expect(result.uncertainties).toEqual([]);
  });
  it("keeps an unsupplied or connected input unresolved", () => {
    for (const initial of [[], [...store(8, 0), ...store(0x60, 7), ...store(0x62, 0)]]) {
      const result = analyse(initial);
      expect(result.uncertainties.some((s) => s.startsWith("Effects of call"))).toBe(true);
      expect(result.engineCalls?.some((c) => c.purpose.includes("certified connection-query bypass"))).toBe(false);
    }
  });
  it("rejects a near call with no far-return frame", () => {
    const result = analyse(store(8, 0x200), false);
    expect(result.uncertainties.some((s) => s.startsWith("Effects of call"))).toBe(true);
    expect(result.engineCalls?.some((c) => c.purpose.includes("certified connection-query bypass"))).toBe(false);
  });
});
