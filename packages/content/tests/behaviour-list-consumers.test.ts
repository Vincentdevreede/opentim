import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { discoverExternalListConsumers } from "../src/read/behaviour-list-consumers.ts";
import { discoverListLoops } from "../src/read/behaviour-list-loops.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };
function fixture(
  options: {
    nextWrite?: boolean;
    ownerWrite?: boolean;
    prefixWrite?: boolean;
    call?: boolean;
    badStack?: boolean;
    unbounded?: boolean;
    badLocal?: boolean;
    search?: boolean;
  } = {},
) {
  const bytes: number[] = [],
    labels = new Map<string, number>(),
    branches: [number, string][] = [];
  const emit = (...v: number[]) => bytes.push(...v),
    label = (name: string) => labels.set(name, bytes.length),
    jump = (op: number, name: string) => {
      emit(op, 0);
      branches.push([bytes.length - 1, name]);
    };
  emit(0x55, 0x8b, 0xec, 0x83, 0xec, 4, 0x56, 0x57, 0x8b, 0x5e, 6);
  if (options.prefixWrite) emit(0xc7, 0x47, 12, 1, 0);
  emit(0x8b, 0x47, 0x1e, 0x03, 0x46, 10, 0x89, 0x46, 0xfe, 0x8b, 0x77, 0x40);
  jump(0xeb, "header");
  label("body");
  if (options.ownerWrite) emit(0x8b, 0x5e, 6, 0xc7, 0x47, 12, 1, 0);
  else emit(0xc7, 0x44, options.nextWrite ? 0x40 : 0x12, 1, 0);
  if (options.call) {
    emit(0x56, 0x9a, 0, 1, 0, 0);
    if (!options.badStack) emit(0x59);
  }
  if (options.badLocal) emit(0xc7, 0x46, 0xff, 1, 0);
  if (options.search) {
    emit(0x8b, 0x44, 4, 0x89, 0x46, 0xfc, 0xb9, 2, 0, 0xbb, 0x80, 1);
    label("search");
    emit(0x2e, 0x8b, 7, 0x3b, 0x46, 0xfc);
    jump(0x74, "matched");
    emit(0x83, 0xc3, 2);
    jump(0xe2, "search");
    jump(0xeb, "advance");
    label("matched");
    emit(0x2e, 0xff, 0x67, 4);
    label("case");
    emit(0xc7, 0x44, 0x12, 1, 0);
    label("advance");
  }
  if (options.unbounded) {
    label("cycle");
    emit(0x90);
    jump(0xeb, "cycle");
  }
  emit(0x8b, 0x74, 0x40);
  label("header");
  emit(0x0b, 0xf6);
  jump(0x74, "exit");
  jump(0xeb, "body");
  label("exit");
  emit(0x5f, 0x5e, 0x8b, 0xe5, 0x5d, 0xcb);
  for (const [at, name] of branches) bytes[at] = (labels.get(name)! - at - 1) & 255;
  const image = new Uint8Array(0x200);
  image.set(bytes);
  image[0x100] = 0xcb;
  if (options.search) {
    const target = labels.get("case")!;
    image.set([3, 0, 9, 0, target & 255, target >> 8, target & 255, target >> 8], 0x180);
  }
  const helper: EngineSummary = {
    ...fact,
    address: 0x100,
    kind: "owner-field-update",
    purpose: "Updates one supplied member.",
    argumentOffset: 6,
    argumentKind: "object",
    calls: [],
    returns: [],
    returnConvention: { kind: "far", stackBytes: 0 },
    writes: [
      {
        ...fact,
        root: "argument",
        path: [],
        offset: 12,
        width: 16,
        value: { kind: "constant", value: 2, width: 16 },
        condition: { kind: "true" },
      },
    ],
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: false,
      unknownEffects: [],
    },
  };
  const helpers = new Map([[helper.address, helper]]),
    code = readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0);
  return { code, helpers, helper };
}
describe("conditional external list consumers", () => {
  it("proves a complete routine conditionally without inventing local query provenance", () => {
    const { code, helpers } = fixture({ call: true });
    expect(discoverListLoops(code, helpers, 12)).toEqual([]);
    const contracts = discoverExternalListConsumers(code, helpers, 12);
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({
      argumentOffset: 6,
      headField: 0x40,
      nextField: 0x40,
      returnConvention: { kind: "far", stackBytes: 0 },
      requires: { finite: true, acyclic: true, completeBases: true, excludesArgument: true },
      loop: { source: "external-list", queries: [] },
    });
    expect(contracts[0]!.fields).toContainEqual({ root: "member", offset: 12, width: 16 });
    expect(contracts[0]!.fields).not.toContainEqual(expect.objectContaining({ root: "stack" }));
    expect(contracts[0]!.assumptions.join(" ")).toContain("caller must prove");
  });
  it.each([
    { nextWrite: true },
    { ownerWrite: true },
    { prefixWrite: true },
    { call: true, badStack: true },
    { unbounded: true },
    { badLocal: true },
  ])("rejects changed links, owner writes, unbalanced calls and unbounded body paths: %o", (options) => {
    const { code, helpers } = fixture(options);
    expect(discoverExternalListConsumers(code, helpers, 12)).toEqual([]);
  });
  it("proves a bounded sparse switch and rejects a changed count", () => {
    const { code, helpers } = fixture({ search: true });
    expect(discoverExternalListConsumers(code, helpers, 12)).toHaveLength(1);
    const count = code.instructions.find(
      (i) => i.mnemonic === "mov" && i.operands[0]?.kind === "register" && i.operands[0].name === "cx",
    )!;
    count.operands[1] = { kind: "immediate", value: 0, width: 16 };
    expect(discoverExternalListConsumers(code, helpers, 12)).toEqual([]);
  });
  it("rejects an unbounded callee part footprint", () => {
    const { code, helpers, helper } = fixture({ call: true });
    helper.footprint = {
      ...helper.footprint,
      complete: false,
      partMemoryComplete: false,
      unknownPartEffects: ["Unbounded part writes."],
    };
    expect(discoverExternalListConsumers(code, helpers, 12)).toEqual([]);
  });
  it("keeps explicitly separate outline writes and resource uncertainty", () => {
    const { code, helpers, helper } = fixture({ call: true });
    helper.writes.push({
      ...fact,
      root: "argument",
      path: [0x52],
      offset: 1,
      width: 8,
      separateStorage: "outline",
      value: { kind: "constant", value: 4, width: 8 },
      condition: { kind: "true" },
    });
    helper.footprint = { ...helper.footprint, complete: false, unknownGlobalEffects: ["Resource effects."] };
    const contract = discoverExternalListConsumers(code, helpers, 12)[0];
    expect(contract?.unknownGlobals).toBe(true);
    expect(contract?.fields).toContainEqual({ root: "outline", offset: 1, width: 8 });
    helper.writes[1]!.separateStorage = undefined;
    expect(discoverExternalListConsumers(code, helpers, 12)).toEqual([]);
  });
  it("rejects hidden prefix CFG entries and broken return frames", () => {
    const a = fixture();
    a.code.edges.push({ from: a.code.instructions.at(-1)!.address, to: a.code.instructions[1]!.address, kind: "jump" });
    expect(discoverExternalListConsumers(a.code, a.helpers, 12)).toEqual([]);
    const b = fixture();
    b.code.instructions.at(-1)!.operands = [{ kind: "immediate", value: 2, width: 16 }];
    expect(discoverExternalListConsumers(b.code, b.helpers, 12)).toEqual([]);
  });
});
