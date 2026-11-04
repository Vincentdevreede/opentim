import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const finding = {
  confidence: "inferred" as const,
  evidence: [],
  assumptions: ["Complete parts are equal or disjoint and separate from the private C stack."],
};
function summary(): EngineSummary {
  // Numeric contract discovery has separate tests. This fixture tests application of a certified footprint.
  return {
    ...finding,
    address: 0x800,
    kind: "contact-first-response",
    purpose: "Updates velocity while preserving state.",
    argumentOffset: 6,
    argumentKind: "object",
    calls: [],
    returns: [],
    contactResponseFirst: { kind: "sliding-contact-response" } as NonNullable<EngineSummary["contactResponseFirst"]>,
    returnConvention: { kind: "far", stackBytes: 0 },
    writes: [
      {
        ...finding,
        root: "argument",
        argumentOffset: 6,
        path: [],
        offset: 54,
        width: 16,
        condition: { kind: "true" },
        value: { kind: "unknown", reason: "The numeric relation is retained separately.", width: 16 },
      },
    ],
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: [],
      unknownPartEffects: [],
      unknownGlobalEffects: [],
    },
  };
}
function caller(body: number[], far = true) {
  const origin = 0x100,
    prefix = [0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0xc7, 0x44, 54, 7, 0, 0x8b, 0x84, 0x84, 0, 0x50];
  const call = far
    ? [0x9a, 0, 8, 0, 0]
    : [0xe8, (0x800 - origin - prefix.length - 3) & 255, (0x800 - origin - prefix.length - 3) >> 8];
  const image = new Uint8Array(0x1000);
  image.set([...prefix, ...call, 0x59, ...body, 0x5d, 0xcb], origin);
  const code = readRoutineCode(image, { address: origin, segment: 0, offset: origin }, 0);
  return analyseRoutine(image, code, {
    dataSegment: 0,
    stateOffset: 12,
    engineSummaries: new Map([[0x800, summary()]]),
  });
}
describe("Applying collision response footprints", () => {
  it("does not reuse an owner velocity when a related response argument may alias it", () => {
    const result = caller([0x83, 0x7c, 54, 7, 0x75, 7, 0xc7, 0x44, 12, 1, 0, 0xeb, 5, 0xc7, 0x44, 12, 2, 0]);
    const states = result.transitions.flatMap((t) => (t.to.kind === "constant" ? [t.to.value] : []));
    expect(states).toContain(1);
    expect(states).toContain(2);
    expect(result.uncertainties.some((u) => u.startsWith("Object pointer is lost"))).toBe(false);
  });
  it("retains a certain state write after a response with a complete unrelated-field footprint", () => {
    const result = caller([0xc7, 0x44, 12, 3, 0]);
    expect(
      result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 3 && t.confidence !== "unresolved"),
    ).toBe(true);
    expect(result.uncertainties.some((u) => u.startsWith("Effects of call"))).toBe(false);
  });
  it("requires the complete far return frame before accepting the footprint", () => {
    const result = caller([0xc7, 0x44, 12, 3, 0], false);
    expect(result.uncertainties.some((u) => u.includes("helper return frame"))).toBe(true);
    expect(result.transitions.some((t) => t.to.kind === "constant" && t.to.value === 3)).toBe(false);
  });
});
