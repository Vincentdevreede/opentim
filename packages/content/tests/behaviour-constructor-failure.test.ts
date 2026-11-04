import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { proveConstructorFailureOwnership } from "../src/read/behaviour-constructor-failure.ts";
import type { InitialZeroFields } from "../src/read/behaviour-constructor-failure.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const proof = { confidence: "inferred" as const, evidence: [], assumptions: [] };
const footprint = {
  complete: false,
  partMemoryComplete: true,
  preservesArgumentMemory: true,
  preservesPartState: true,
  unknownEffects: [],
};
function fixture(sharedReturnJump = false) {
  const bytes = [
    0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0xb8, 4, 0, 0x50, 0xff, 0x74, 0x10, 0x9a, 0, 1, 0, 0, 0x59, 0x59, 0x89, 0x44,
    0x20, 0x0b, 0xc0, 0x75, 5, 0xb8, 1, 0, 0xeb, 9, 0x56, 0x9a, 0x80, 1, 0, 0, 0x59, 0x33, 0xc0, 0x5e, 0x5d, 0xcb,
  ];
  if (sharedReturnJump) {
    bytes.splice(42, 0, 0xeb, 0xf3);
    bytes[32] = 11;
  }
  const image = new Uint8Array(0x400);
  image.set(bytes);
  const code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
  const allocator: EngineSummary = {
    ...proof,
    address: 0x100,
    kind: "nullable-allocation",
    purpose: "Allocates fresh storage.",
    argumentOffset: 6,
    argumentKind: "scalar",
    calls: [],
    writes: [],
    footprint,
    returnPointerClass: "nullable-fresh",
    returnConvention: { kind: "far", stackBytes: 0 },
    returns: [
      {
        ...proof,
        register: "ax",
        value: { kind: "constant", value: 0, width: 16 },
        condition: { kind: "true" },
        pointer: { kind: "constant", value: 0 },
      },
      {
        ...proof,
        register: "ax",
        value: { kind: "unknown", reason: "A new allocation.", width: 16 },
        condition: { kind: "true" },
        pointer: { kind: "fresh", name: "allocation" },
      },
    ],
  };
  const factory: EngineSummary = {
    ...allocator,
    address: 0x300,
    kind: "part-factory",
    allocationSize: 0x80,
    factory: {
      typeArgument: 6,
      constructorTable: { segment: 0, offset: 0x200, stride: 16, typeCount: 1 },
      noConstructorTypes: [],
      noConstructor: {
        ...proof,
        evidence: [{ address: 0x100, bytes: [], text: "Cleared allocation." }],
        purpose: "A cleared fresh part with its prefix initialized.",
        freshFieldsOnly: true,
        writes: [],
        footprint,
      },
    },
  };
  const zero: InitialZeroFields = {
    ...proof,
    fields: [
      { offset: 0x22, width: 16, value: 0 },
      { offset: 0x24, width: 16, value: 0 },
    ],
  };
  const summaries = new Map([[allocator.address, allocator]]);
  const prove = (fields = [0x20, 0x22, 0x24]) =>
    proveConstructorFailureOwnership(code, factory, summaries, fields, zero);
  return { code, allocator, factory, zero, prove };
}
describe("constructor allocation-failure ownership", () => {
  it("follows a success jump through a shared epilogue bridge without changing the return value", () => {
    const { code, prove } = fixture(true);
    expect(prove()).toMatchObject({ failureValue: 1, zeroFields: [0x20, 0x22, 0x24] });
    const jump = code.instructions.find((i) => i.address === 42)!;
    jump.target = { address: 28, segment: 0, offset: 28 };
    expect(prove()).toBeUndefined();
  });
  it("certifies only null allocation returns and leaves the success helper separate", () => {
    const { prove } = fixture();
    expect(prove()).toMatchObject({
      address: 0,
      allocation: 0x100,
      allocatedField: 0x20,
      countField: 0x10,
      elementSize: 4,
      failureValue: 1,
      zeroFields: [0x20, 0x22, 0x24],
      requiredInitialZeroFields: [0x22, 0x24],
      successHelper: 0x180,
    });
    expect(prove()!.evidence.length).toBeGreaterThan(20);
  });
  it("requires explicit entry zero facts for every other released field", () => {
    const { zero, prove } = fixture();
    zero.fields.pop();
    expect(prove()).toBeUndefined();
  });
  it("rejects a factory prefix which overwrites a released field", () => {
    const { factory, prove } = fixture();
    factory.factory!.noConstructor.writes.push({
      ...proof,
      root: "argument",
      argumentOffset: 6,
      path: [],
      offset: 0x23,
      width: 8,
      value: { kind: "constant", value: 1, width: 8 },
      condition: { kind: "true" },
    });
    expect(prove()).toBeUndefined();
  });
  it.each([
    [0x22, 0x24],
    [0x20, 0x21, 0x24],
    [0x20, 0x22, 0x80],
  ])("rejects missing, overlapping or out-of-range release fields", (...fields) => {
    expect(fixture().prove(fields)).toBeUndefined();
  });
  it("rejects a nonzero failure selector or reversed allocation test", () => {
    const a = fixture();
    const value = a.code.instructions.find((i) => i.mnemonic === "mov" && i.address === 28)!.operands[1]!;
    if (value.kind === "immediate") value.value = 2;
    expect(a.prove()).toBeUndefined();
    const b = fixture();
    b.code.instructions.find((i) => i.mnemonic === "jne")!.mnemonic = "je";
    expect(b.prove()).toBeUndefined();
  });
  it("rejects a byte store and a CFG edge bypassing the null store", () => {
    const a = fixture(),
      store = a.code.instructions.find((i) => i.address === 21)!.operands[0]!;
    if (store.kind === "memory") store.width = 8;
    expect(a.prove()).toBeUndefined();
    const b = fixture();
    b.code.edges.push({ from: 19, to: 28, kind: "next" });
    expect(b.prove()).toBeUndefined();
  });
  it("requires a trusted fresh-or-null allocator with the matching return convention", () => {
    const a = fixture();
    a.allocator.returnPointerClass = undefined;
    expect(a.prove()).toBeUndefined();
    const b = fixture();
    b.allocator.returnConvention = { kind: "near", stackBytes: 0 };
    expect(b.prove()).toBeUndefined();
    const c = fixture();
    c.allocator.returns.pop();
    expect(c.prove()).toBeUndefined();
  });
});
