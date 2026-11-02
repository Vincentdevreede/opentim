import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverConstructorEffects } from "../src/read/behaviour-constructor-effects.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import type { BehaviourLayout } from "../src/read/behaviour-layout.ts";

const proof = { confidence: "inferred" as const, evidence: [], assumptions: [] };
const footprint = {
  complete: false,
  partMemoryComplete: true,
  preservesArgumentMemory: true,
  preservesPartState: true,
  unknownEffects: [],
};
function fixture(bytes: number[], options: { ownerHelper?: boolean; argumentWidth?: 8 } = {}) {
  const image = new Uint8Array(0x800);
  image.set(bytes, 0x200);
  image.set([0, 2, 0, 0], 0x400);
  const factory: EngineSummary = {
    ...proof,
    address: 0x100,
    kind: "part-factory",
    purpose: "Synthetic factory.",
    argumentOffset: 6,
    argumentKind: "scalar",
    calls: [],
    writes: [],
    returns: [],
    footprint,
    factory: {
      typeArgument: 6,
      constructorTable: { segment: 0, offset: 0x400, stride: 16, typeCount: 1 },
      noConstructorTypes: [],
      noConstructor: {
        ...proof,
        purpose: "Synthetic prefix and suffix.",
        writes: [],
        freshFieldsOnly: true,
        footprint,
      },
    },
  };
  const layout: BehaviourLayout = {
    ...proof,
    objectArgument: { ...proof, offset: 6 },
    callbacks: [],
    diagnostics: [],
    fields: [{ ...proof, name: "outlinePoints", offset: 0x62 }],
  };
  const codes = new Map(),
    summaries = new Map([[0x100, factory]]);
  if (options.ownerHelper) {
    image.set([0x55, 0x8b, 0xec, 0x8b, 0x5e, 6, 0xc7, 0x47, 0x20, 1, 0, 0x5d, 0xcb], 0x600);
    summaries.set(0x600, {
      ...factory,
      address: 0x600,
      factory: undefined,
      argumentKind: "object",
      kind: "owner-field-update",
      writes: [
        {
          ...proof,
          root: "argument",
          argumentOffset: 6,
          path: [],
          offset: 0x20,
          width: 16,
          value: { kind: "constant", value: 1, width: 16 },
          condition: { kind: "true" },
        },
      ],
      footprint: { ...footprint, partMemoryComplete: true, preservesArgumentMemory: false },
    });
  }
  if (options.argumentWidth) {
    const code = readRoutineCode(image, { address: 0x200, segment: 0, offset: 0x200 }, 0);
    const pushed = code.instructions.find((i) => i.mnemonic === "push" && i.operands[0]?.kind === "memory")!
      .operands[0]!;
    if (pushed.kind === "memory") pushed.width = options.argumentWidth;
    codes.set(0x200, code);
  }
  const initialSize = codes.size;
  discoverConstructorEffects(image, codes, summaries, layout, 0);
  expect(codes.size).toBe(initialSize);
  return factory.factory!.constructors!;
}
const prefix = [0x55, 0x8b, 0xec, 0x56, 0x57, 0x8b, 0x76, 6],
  suffix = [0x5f, 0x5e, 0x5d, 0xcb];
describe("constructor write scopes", () => {
  it("bounds owner and outline stores without claiming a complete factory call", () => {
    const findings = fixture([
      ...prefix,
      0xc7,
      0x44,
      12,
      1,
      0,
      0x8b,
      0x7c,
      0x62,
      0xc6,
      5,
      1,
      0x83,
      0xc7,
      4,
      0xc6,
      5,
      2,
      ...suffix,
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidence.length).toBeGreaterThan(3);
    expect(findings[0]!.assumptions.join(" ")).toContain("failure cleanup remains a separate obligation");
  });
  it.each([
    [0x8b, 0x7c, 0x64, 0xc6, 5, 1],
    [0xa3, 0, 6],
    [0x8b, 0xe0],
    [0x9a, 0, 6, 0, 0],
  ])("rejects unrelated stores, globals, an untracked stack or an unbounded callee", (...bytes) => {
    expect(fixture([...prefix, ...bytes, ...suffix])).toEqual([]);
  });
});

describe("constructor owner argument forwarding", () => {
  const call = [0x9a, 0, 6, 0, 0, 0x59];
  it("accepts the intact first word argument pushed directly from the frame", () => {
    expect(fixture([...prefix, 0xff, 0x76, 6, ...call, ...suffix], { ownerHelper: true })).toHaveLength(1);
  });
  it.each([8, -2])("rejects a different frame slot at %s", (slot) => {
    expect(fixture([...prefix, 0xff, 0x76, slot & 255, ...call, ...suffix], { ownerHelper: true })).toEqual([]);
  });
  it("rejects a byte-sized argument descriptor", () => {
    expect(fixture([...prefix, 0xff, 0x76, 6, ...call, ...suffix], { ownerHelper: true, argumentWidth: 8 })).toEqual(
      [],
    );
  });
  it("rejects a constructor which overwrites the entry argument", () => {
    expect(fixture([...prefix, 0xc7, 0x46, 6, 0, 0, 0xff, 0x76, 6, ...call, ...suffix], { ownerHelper: true })).toEqual(
      [],
    );
  });
});
