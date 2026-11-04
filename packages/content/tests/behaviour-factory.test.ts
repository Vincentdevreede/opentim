import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
const fact = {
  confidence: "inferred" as const,
  assumptions: ["The allocator's live payloads are disjoint."],
  evidence: [{ address: 0x90, bytes: [0, 0, 0, 0], text: "A null constructor pointer" }],
};
function fixture(type: number, typeArgument = 6) {
  const image = new Uint8Array(0x100).fill(0x66);
  image.set([
    0x55,
    0x8b,
    0xec,
    0x56,
    0x8b,
    0x76,
    6,
    0xc7,
    0x44,
    12,
    2,
    0,
    0xb8,
    type & 255,
    type >> 8,
    0x50,
    ...(typeArgument === 8 ? [0x33, 0xc0, 0x50] : []),
    0x9a,
    0x80,
    0,
    0,
    0,
    0x59,
    ...(typeArgument === 8 ? [0x59] : []),
    0xff,
    0x44,
    12,
    0x5e,
    0x5d,
    0xcb,
  ]);
  image[0x80] = 0xcb;
  const factory: EngineSummary = {
    ...fact,
    address: 0x80,
    argumentOffset: 6,
    argumentKind: "scalar",
    kind: "part-factory",
    purpose: "Creates a part.",
    calls: [],
    writes: [],
    returns: [],
    returnPointerClass: "nullable-fresh",
    returnConvention: { kind: "far", stackBytes: 0 },
    footprint: {
      complete: false,
      preservesArgumentMemory: false,
      preservesPartState: false,
      unknownEffects: ["The selected constructor is unresolved."],
    },
    factory: {
      typeArgument,
      constructorTable: { segment: 0, offset: 0x90, stride: 8, typeCount: 4 },
      noConstructorTypes: [3],
      noConstructor: {
        ...fact,
        purpose: "Creates a part without invoking a constructor.",
        freshFieldsOnly: true,
        writes: [],
        initialState: { offset: 12, value: 0 },
        footprint: {
          complete: false,
          partMemoryComplete: true,
          preservesArgumentMemory: true,
          preservesPartState: true,
          unknownEffects: ["Heap metadata changes."],
          unknownPartEffects: [],
          unknownGlobalEffects: ["Heap metadata changes."],
        },
      },
    },
  };
  return analyseRoutine(image, { address: 0, segment: 0, offset: 0 }, { engineSummaries: new Map([[0x80, factory]]) });
}

describe("constant-type factory contracts", () => {
  it("preserves existing fields only for a proved null-constructor type", () => {
    const result = fixture(3);
    expect(result.transitions[0]!.to).toMatchObject({ kind: "constant", value: 3 });
    expect(result.uncertainties.some((reason) => reason.startsWith("Effects of call"))).toBe(false);
    expect(result.transitions[0]!.assumptions.join(" ")).toContain("constant type argument");
  });

  it("does not apply a no-constructor contract to a different type", () => {
    const result = fixture(2);
    expect(result.transitions.some((transition) => transition.confidence === "unresolved")).toBe(true);
    expect(result.uncertainties.some((reason) => reason.startsWith("Effects of call"))).toBe(true);
  });

  it("uses the discovered type-argument position rather than assuming the first argument", () => {
    const result = fixture(3, 8);
    expect(result.transitions[0]!.to).toMatchObject({ kind: "constant", value: 3 });
  });

  it("does not write an allocated object's zero state to the existing owner", () => {
    expect(
      fixture(3)
        .writes.filter((write) => write.object === "part" && write.offset === 12)
        .map((write) => write.value),
    ).not.toContainEqual({ kind: "constant", value: 0, width: 16 });
  });
});
