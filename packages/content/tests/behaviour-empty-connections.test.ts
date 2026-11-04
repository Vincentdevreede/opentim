import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { proveEmptyConnections } from "../src/read/behaviour-empty-connections.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import { discoverCountedLoops } from "../src/read/behaviour-loops.ts";

const finding = { confidence: "inferred" as const, evidence: [], assumptions: [] };
function propagation(): EngineSummary {
  return {
    ...finding,
    address: 0x100,
    kind: "connected-gear-propagation",
    purpose: "Propagates movement through a complete finite part graph.",
    argumentOffset: 6,
    argumentKind: "object",
    calls: [],
    writes: [],
    returns: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    partGraph: {
      ...finding,
      objectArguments: [6, 8],
      fields: [{ offset: 18, width: 16 }],
      recursiveCalls: [0x100],
      links: [0x30, 0x32, 0x34, 0x36],
      peer: { routine: 0x110, connectionField: 0x20, endpointFields: [0, 2] },
    },
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: true,
      unknownEffects: [],
    },
  };
}

function fixture(
  options: {
    near?: boolean;
    extraStore?: boolean;
    changedGuard?: boolean;
    relocation?: number;
    prefixExtra?: number[];
    returnAccumulator?: boolean;
    initialCounter?: number;
  } = {},
) {
  const bytes = [0x55, 0x8b, 0xec, 0x83, 0xec, 4, 0x56, 0x57, 0x8b, 0x76, 6];
  bytes.push(...(options.prefixExtra ?? []), 0x33, 0xff, 0xc7, 0x46, 0xfe, options.initialCounter ?? 0, 0, 0xeb, 0);
  const entryJump = bytes.length - 1,
    body = bytes.length;
  bytes.push(
    0x8b,
    0x5e,
    0xfe,
    0xd1,
    0xe3,
    0x8b,
    0x40,
    0x30,
    0x89,
    0x46,
    0xfc,
    0x0b,
    0xc0,
    options.changedGuard ? 0x75 : 0x74,
    0,
  );
  const nullJump = bytes.length - 1;
  bytes.push(0x57, 0xb8, 2, 0, 0x50, 0xff, 0x76, 0xfc, 0x56, 0x90);
  const relocation = options.relocation ?? 0;
  if (options.near) {
    bytes.push(0x0e, 0xe8);
    const relative = 0x100 - (relocation + bytes.length + 2);
    bytes.push(relative & 255, (relative >> 8) & 255);
  } else bytes.push(0x9a, 0, 1, 0, 0);
  bytes.push(0x83, 0xc4, 8, 0x8b, 0xf8);
  const nullTarget = bytes.length;
  if (options.extraStore) bytes.push(0xc7, 0x46, 0xfa, 1, 0);
  bytes[nullJump] = nullTarget - nullJump - 1;
  bytes.push(0xff, 0x46, 0xfe);
  const header = bytes.length;
  bytes[entryJump] = header - entryJump - 1;
  bytes.push(
    0x83,
    0x7e,
    0xfe,
    4,
    0x7c,
    (body - header - 6) & 255,
    ...(options.returnAccumulator ? [0x8b, 0xc7] : []),
    0x5f,
    0x5e,
    0x8b,
    0xe5,
    0x5d,
    0xcb,
  );
  const image = new Uint8Array(0x120).fill(0x66);
  image.set(bytes, relocation);
  image[0x100] = 0xcb;
  const code = readRoutineCode(image, { address: relocation, segment: 0, offset: relocation }, 0);
  const helper = propagation();
  const loop = discoverCountedLoops(code, new Map([[helper.address, helper]]), 12)[0];
  expect(code.status).toBe("complete");
  expect(loop).toBeDefined();
  return { image, code, helper, loop: loop! };
}

describe("empty connection-loop certificates", () => {
  it.each([false, true])("proves the exact null path with near call %s", (near) => {
    const { code, helper, loop } = fixture({ near });
    const result = proveEmptyConnections(code, loop, helper);
    expect(result).toMatchObject({
      fields: [0x30, 0x32, 0x34, 0x36],
      localPointer: { segment: "ss", base: ["bp"], displacement: -4, width: 16 },
      zeroRegisters: ["ax"],
      scratchRegisters: ["bx"],
      confidence: "inferred",
    });
    expect(result!.evidence.some((e) => e.address === loop.proof.update)).toBe(true);
    expect(result!.assumptions.some((a) => a.includes("active iteration"))).toBe(true);
  });

  it("discovers a relocated caller without a fixed code address", () => {
    const { code, helper, loop } = fixture({ relocation: 0x20, near: true });
    expect(proveEmptyConnections(code, loop, helper)?.fields).toEqual([0x30, 0x32, 0x34, 0x36]);
  });

  it("rejects the reversed null guard", () => {
    const { code, helper, loop } = fixture({ changedGuard: true });
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
  });

  it("rejects a private store on the null path", () => {
    const { code, helper, loop } = fixture({ extraStore: true });
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
  });

  it("rejects a CFG edge that bypasses the pointer setup", () => {
    const { code, helper, loop } = fixture();
    code.edges.push({ from: loop.bodyEntry, to: loop.bodyEntry + 5, kind: "taken" });
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
  });

  it("rejects a zero branch that skips the counter update", () => {
    const { code, helper, loop } = fixture();
    const branch = code.instructions.find((i) => i.mnemonic === "je")!;
    branch.target = { address: loop.header, segment: 0, offset: loop.header };
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
  });

  it("rejects an incorrect helper target or calling convention", () => {
    const { code, helper, loop } = fixture();
    helper.address++;
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
    helper.address--;
    helper.returnConvention = { kind: "near", stackBytes: 0 };
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
  });

  it("rejects a connection range or entry domain outside the existing loop proof", () => {
    const { code, helper, loop } = fixture();
    helper.partGraph!.links[2] = 0x38;
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
    helper.partGraph!.links[2] = 0x34;
    loop.minimumCounter = undefined;
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
  });

  it("rejects a pointer word outside the reserved private frame", () => {
    const { code, helper, loop } = fixture();
    const store = code.instructions.find(
      (i) => i.mnemonic === "mov" && i.operands[0]?.kind === "memory" && i.operands[0].displacement === -4,
    )!;
    const pushed = code.instructions.find(
      (i) => i.mnemonic === "push" && i.operands[0]?.kind === "memory" && i.operands[0].displacement === -4,
    )!;
    if (store.operands[0]?.kind === "memory") store.operands[0].displacement = -6;
    if (pushed.operands[0]?.kind === "memory") pushed.operands[0].displacement = -6;
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
  });

  it.each([
    ["an owner exchanged through the second operand", [0x96]],
    ["a frame exchanged through the second operand", [0x95]],
    ["a changed frame base", [0x45]],
    ["an explicit data segment write", [0x8e, 0xd8]],
    ["an explicit stack segment write", [0x8e, 0xd0]],
    ["an implicit data segment write", [0xc5, 0x07]],
    ["an interrupt with unknown register effects", [0xcd, 0x21]],
  ])("rejects %s on an ancestor path", (_name, prefixExtra) => {
    const { code, helper, loop } = fixture({ prefixExtra: prefixExtra as number[] });
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
  });

  it("rejects an owner load which does not dominate the loop", () => {
    const { code, helper, loop } = fixture();
    code.edges.push({ from: code.address, to: loop.header, kind: "taken" });
    expect(proveEmptyConnections(code, loop, helper)).toBeUndefined();
  });
});

describe("empty connection-loop transfer", () => {
  it("retains a zero accumulator when every inspected connection is null", () => {
    const prefixExtra = [0x30, 0x32, 0x34, 0x36].flatMap((offset) => [0xc7, 0x44, offset, 0, 0]);
    const { image, code, helper, loop } = fixture({ prefixExtra, returnAccumulator: true });
    expect(loop.emptyConnections).toBeDefined();
    const result = analyseRoutine(image, code, { code, engineSummaries: new Map([[helper.address, helper]]) });
    expect(result.analysisWork!.pendingPaths).toBe(0);
    expect(result.returnPathsComplete).toBe(true);
    expect(result.outcomes?.length).toBeGreaterThan(0);
    expect(result.outcomes?.every((o) => o.returnValue.kind === "constant" && o.returnValue.value === 0)).toBe(true);
  });
  it("keeps an unknown connected graph result unresolved", () => {
    const { image, code, helper } = fixture({ returnAccumulator: true });
    const result = analyseRoutine(image, code, { code, engineSummaries: new Map([[helper.address, helper]]) });
    expect(result.outcomes?.some((o) => o.returnValue.kind !== "constant")).toBe(true);
    expect(result.outcomes?.some((o) => o.returnValue.kind === "constant" && o.returnValue.value === 0)).toBe(true);
  });
  it("does not overwrite AX when the loop has no active iteration", () => {
    const { image, code, helper } = fixture({ initialCounter: 4, returnAccumulator: false, prefixExtra: [0xb8, 7, 0] });
    const result = analyseRoutine(image, code, { code, engineSummaries: new Map([[helper.address, helper]]) });
    expect(result.outcomes?.every((o) => o.returnValue.kind === "constant" && o.returnValue.value === 7)).toBe(true);
    expect(result.loops).toEqual([]);
  });
});
