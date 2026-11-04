import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverConstructorCleanup, ownedConstructorContract } from "../src/read/behaviour-owned-constructors.ts";
import type { ConstructorFailureOwnership } from "../src/read/behaviour-constructor-failure.ts";
import type { OwnedHeapRelease } from "../src/read/behaviour-heap-release.ts";

function fixture() {
  const bytes = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x0b, 0xf6];
  const labels = new Map<string, number>(),
    branches: [number, string][] = [];
  const jump = (opcode: number, label: string) => {
    bytes.push(opcode, 0);
    branches.push([bytes.length - 1, label]);
  };
  const label = (name: string) => labels.set(name, bytes.length);
  const call = () => bytes.push(0x9a, 0, 1, 0, 0, 0x59);
  jump(0x74, "done");
  bytes.push(0x83, 0x7c, 0x20, 0);
  jump(0x74, "first");
  bytes.push(0xff, 0x74, 0x20);
  call();
  label("first");
  bytes.push(0x83, 0x7c, 0x22, 0);
  jump(0x74, "second");
  bytes.push(0xf7, 0x44, 8, 1, 0);
  jump(0x75, "second");
  bytes.push(0xff, 0x74, 0x22);
  call();
  label("second");
  bytes.push(0x83, 0x7c, 0x24, 0);
  jump(0x74, "owner");
  bytes.push(0x83, 0x7c, 4, 1);
  jump(0x74, "release");
  bytes.push(0x83, 0x7c, 4, 2);
  jump(0x75, "owner");
  label("release");
  bytes.push(0xff, 0x74, 0x24);
  call();
  label("owner");
  bytes.push(0x56);
  call();
  label("done");
  bytes.push(0x5e, 0x5d, 0xcb);
  for (const [at, target] of branches) bytes[at] = (labels.get(target)! - at - 1) & 255;
  const code = readRoutineCode(Uint8Array.from(bytes), { address: 0, segment: 0, offset: 0 }, 0);
  const cleanup = discoverConstructorCleanup(code, 0x40)!;
  const proof = { confidence: "inferred" as const, evidence: [], assumptions: [] };
  const failure: ConstructorFailureOwnership = {
    ...proof,
    address: 0x200,
    allocation: 0x300,
    allocationInstruction: 0x210,
    allocatedField: 0x20,
    countField: 0x10,
    elementSize: 4,
    failureValue: 1,
    zeroFields: [0x20, 0x22, 0x24],
    requiredInitialZeroFields: [0x22, 0x24],
    successEntry: 0x220,
    successHelper: 0x400,
  };
  const release: OwnedHeapRelease = {
    ...proof,
    address: 0x100,
    allocator: 0x500,
    headerSize: 4,
    globals: { first: 0x10, last: 0x12, free: 0x14, boundary: 0x16, error: 0x18 },
  };
  return { code, cleanup, failure, release, proof };
}

describe("owned constructor cleanup", () => {
  it("finds secondary release fields by structure and retains all cleanup instructions", () => {
    const { code, cleanup } = fixture();
    expect(cleanup).toMatchObject({ release: 0x100, releaseFields: [0x20, 0x22, 0x24], confidence: "checked" });
    expect(cleanup.evidence).toHaveLength(code.instructions.length);
  });
  it("rejects a changed zero guard, secondary pointer or escaping call", () => {
    const a = fixture();
    a.code.instructions.find((i) => i.mnemonic === "je")!.mnemonic = "jne";
    expect(discoverConstructorCleanup(a.code, 0x40)).toBeUndefined();
    const b = fixture(),
      pushed = b.code.instructions.find((i) => i.mnemonic === "push" && i.operands[0]?.kind === "memory")!.operands[0]!;
    if (pushed.kind === "memory") pushed.displacement += 1;
    expect(discoverConstructorCleanup(b.code, 0x40)).toBeUndefined();
    const c = fixture();
    c.code.calls[0]!.target!.address += 1;
    expect(discoverConstructorCleanup(c.code, 0x40)).toBeUndefined();
  });
  it("requires a complete cleanup CFG and bounded distinct released fields", () => {
    const { code } = fixture();
    expect(discoverConstructorCleanup(code, 0x24)).toBeUndefined();
    code.edges.push({ from: code.address, to: code.instructions.at(-1)!.address, kind: "next" });
    expect(discoverConstructorCleanup(code, 0x40)).toBeUndefined();
  });
  it("combines separate scope, null-field and owned-release obligations", () => {
    const { failure, proof, cleanup, release } = fixture();
    expect(ownedConstructorContract(failure, proof, cleanup, release)).toMatchObject({ confidence: "inferred" });
    expect(ownedConstructorContract(failure, proof, cleanup, release)!.evidence).toEqual(cleanup.evidence);
  });
  it("rejects missing null facts, a different release routine or an unresolved component", () => {
    const { failure, proof, cleanup, release } = fixture();
    expect(ownedConstructorContract({ ...failure, zeroFields: [0x20] }, proof, cleanup, release)).toBeUndefined();
    expect(ownedConstructorContract(failure, proof, cleanup, { ...release, address: 0x101 })).toBeUndefined();
    for (let n = 0; n < 4; n++) {
      const facts = [failure, proof, cleanup, release];
      const old = facts[n]!.confidence;
      facts[n]!.confidence = "unresolved";
      expect(ownedConstructorContract(failure, proof, cleanup, release)).toBeUndefined();
      facts[n]!.confidence = old;
    }
  });
});
