import { describe, expect, it } from "vitest";
import { analyseRoutine, inferDispatchedObjectArgument } from "../src/read/behaviour.ts";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const entry = { address: 0, segment: 0, offset: 0 };
const prologue = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6];
const epilogue = [0x5e, 0x5d, 0xcb];
const analyse = (bytes: number[]) => analyseRoutine(Uint8Array.from(bytes), entry, { stateCount: 4 });

function engine(address: number): EngineSummary {
  return {
    address,
    kind: "synthetic service",
    purpose: "A synthetic call boundary",
    argumentOffset: 6,
    argumentKind: "scalar",
    writes: [],
    returns: [],
    calls: [],
    confidence: "inferred",
    assumptions: [],
    evidence: [],
    footprint: { complete: true, preservesArgumentMemory: true, preservesPartState: true, unknownEffects: [] },
  };
}

function callFixture(helper: number[]) {
  const image = new Uint8Array(0x100).fill(0x66);
  image.set([
    ...prologue,
    0x56, // push the owner
    0xe8,
    0x16,
    0, // near call at 8 to 0x21
    0x59,
    0x8b,
    0xf8, // mov di, ax
    0x0b,
    0xff, // or di, di
    0xc7,
    0x45,
    0x0c,
    1,
    0,
    ...epilogue,
  ]);
  image.set(helper, 0x21);
  image[0x80] = 0xc3;
  const helperEntry = { address: 0x21, segment: 0, offset: 0x21 };
  const summary = analyseRoutine(image, helperEntry, { argumentOffset: 4 });
  const result = analyseRoutine(image, entry, { summaries: new Map([[0x21, summary]]) });
  return { image, summary, result };
}

describe("symbolic pointer identities and call returns", () => {
  it.each([
    [0x0b, 0xf6],
    [0x23, 0xf6],
  ])("preserves the owner through an idempotent register test %s", (...test) => {
    const result = analyse([...prologue, ...test, 0xc7, 0x44, 0x0c, 1, 0, ...epilogue]);
    expect(result.writes.find((write) => write.offset === 12)).toMatchObject({
      object: "part",
      value: { kind: "constant", value: 1 },
    });
    expect(result.uncertainties.some((issue) => issue.includes("pointer is lost"))).toBe(false);
  });

  it.each([
    [0x33, 0xc0],
    [0x2b, 0xc0],
  ])("recognizes true zeroing even when the input register is unknown %s", (...zero) => {
    const result = analyse([...prologue, ...zero, 0x89, 0x44, 0x0c, ...epilogue]);
    expect(result.writes.find((write) => write.offset === 12)?.value).toEqual({
      kind: "constant",
      value: 0,
      width: 16,
    });
  });

  it("preserves a related pointer through OR with itself without promoting it to the owner", () => {
    const result = analyse([...prologue, 0x8b, 0x7c, 0x78, 0x0b, 0xff, 0xc7, 0x45, 0x12, 1, 0, ...epilogue]);
    expect(result.writes.find((write) => write.offset === 18)).toMatchObject({
      object: "referenced-by(part+0x78)",
      confidence: "unresolved",
    });
    expect(result.writes.some((write) => write.object === "unknown")).toBe(false);
  });

  it("retains a distinct post-call field identity while keeping the path unresolved", () => {
    const image = new Uint8Array(0x80).fill(0x66);
    image.set([...prologue, 0x9a, 0x60, 0, 0, 0, 0x8b, 0x7c, 0x78, 0x0b, 0xff, 0xc7, 0x45, 0x12, 1, 0, ...epilogue]);
    image[0x60] = 0xcb;
    const result = analyseRoutine(image, entry);
    const write = result.writes.find((write) => write.offset === 18)!;
    expect(write.object).toContain("after unresolved effect");
    expect(write.confidence).toBe("unresolved");
    expect(result.uncertainties.some((issue) => issue.includes("pointer is lost"))).toBe(false);
    expect(result.transitions.every((transition) => transition.confidence === "unresolved")).toBe(true);
  });

  it("maps a helper's returned owner pointer even when the helper does not write the state", () => {
    const { summary, result } = callFixture([0x55, 0x8b, 0xec, 0x8b, 0x46, 4, 0x5d, 0xc3]);
    expect(summary.returnPathsComplete).toBe(true);
    expect(result.writes.find((write) => write.offset === 12)).toMatchObject({
      object: "part",
      value: { kind: "constant", value: 1 },
    });
    expect(result.uncertainties.some((issue) => issue.includes("pointer is lost"))).toBe(false);
  });

  it("keeps a proven return pointer while retaining unresolved helper memory effects", () => {
    const helper = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 4, 0xe8, 0x55, 0, 0x8b, 0xc6, 0x5e, 0x5d, 0xc3];
    const { summary, result } = callFixture(helper);
    expect(summary.uncertainEffects).toBe(true);
    expect(summary.returnPathsComplete).toBe(true);
    expect(result.writes.find((write) => write.offset === 12)).toMatchObject({
      object: "part",
      confidence: "unresolved",
    });
    expect(result.uncertainties.some((issue) => issue.includes("pointer is lost"))).toBe(false);
  });

  it("does not reuse one return pointer when another path has no proved return relation", () => {
    const helper = [0x55, 0x8b, 0xec, 0x85, 0xd2, 0x74, 2, 0xeb, 0xfe, 0x8b, 0x46, 4, 0x5d, 0xc3];
    const { summary, result } = callFixture(helper);
    expect(summary.returnPathsComplete).toBe(false);
    expect(result.uncertainties.some((issue) => issue.includes("pointer is lost"))).toBe(true);
  });

  it("retains a factory's nullable fresh pointer class despite unknown constructor effects", () => {
    const image = new Uint8Array(0x100).fill(0x66);
    image.set([
      ...prologue,
      0xb8,
      2,
      0,
      0x50,
      0x9a,
      0x80,
      0,
      0,
      0,
      0x59,
      0x8b,
      0xf8,
      0x0b,
      0xff,
      0x74,
      5,
      0xc7,
      0x45,
      0x0c,
      1,
      0,
      ...epilogue,
    ]);
    const factory = engine(0x80);
    factory.kind = "part-factory";
    factory.returnPointerClass = "nullable-fresh";
    factory.footprint = {
      complete: false,
      preservesArgumentMemory: false,
      preservesPartState: false,
      unknownEffects: ["Constructor effects remain unknown"],
    };
    const result = analyseRoutine(image, entry, { engineSummaries: new Map([[0x80, factory]]) });
    const write = result.writes.find((write) => write.offset === 12)!;
    expect(write.object).toContain("fresh object returned");
    expect(write.confidence).toBe("unresolved");
    expect(result.uncertainties.some((issue) => issue.includes("pointer is lost"))).toBe(false);
  });

  it("invalidates unbounded globals without discarding a proved owner-state preservation contract", () => {
    const image = new Uint8Array(0x100).fill(0x66);
    image.set([
      ...prologue,
      0xc7,
      0x06,
      0x90,
      0,
      1,
      0,
      0x9a,
      0x80,
      0,
      0,
      0,
      0x83,
      0x3e,
      0x90,
      0,
      1,
      0x75,
      5,
      0xc7,
      0x44,
      0x0c,
      2,
      0,
      ...epilogue,
    ]);
    const service = engine(0x80);
    service.footprint.unknownGlobalEffects = ["Backend writes global memory"];
    const result = analyseRoutine(image, entry, { engineSummaries: new Map([[0x80, service]]) });
    expect(
      result.transitions.some((transition) => transition.to.kind === "field" && transition.to.object === "part"),
    ).toBe(true);
    expect(
      result.transitions.some((transition) => transition.to.kind === "constant" && transition.to.value === 2),
    ).toBe(true);
    expect(result.transitions.every((transition) => transition.confidence === "unresolved")).toBe(true);
  });
});

describe("helper relations and indexed pointer reads", () => {
  it("retains conditional pointer returns from a read-only engine helper", () => {
    const image = new Uint8Array(0x100).fill(0x66);
    image.set([
      ...prologue,
      0x56,
      0x9a,
      0x40,
      0,
      0,
      0,
      0x59,
      0x8b,
      0xf8,
      0x0b,
      0xff,
      0xc7,
      0x45,
      0x12,
      1,
      0,
      ...epilogue,
    ]);
    image.set(
      [
        0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, 0x83, 0x7c, 0x0c, 0, 0x74, 5, 0x8b, 0x44, 0x56, 0xeb, 3, 0x8b, 0x44,
        0x54, 0x5e, 0x5d, 0xcb,
      ],
      0x40,
    );
    const summary = analyseRoutine(image, { address: 0x40, segment: 0, offset: 0x40 });
    const getter = engine(0x40);
    getter.kind = "read-only";
    getter.argumentKind = "object";
    const result = analyseRoutine(image, entry, {
      summaries: new Map([[0x40, summary]]),
      engineSummaries: new Map([[0x40, getter]]),
    });
    const destinations = result.writes.filter((write) => write.offset === 18).map((write) => write.object);
    expect(destinations).toEqual(expect.arrayContaining(["referenced-by(part+0x54)", "referenced-by(part+0x56)"]));
    expect(result.uncertainties.some((issue) => issue.includes("pointer is lost"))).toBe(false);
  });

  it("retains a conditional pointer class for a value read from a dynamically indexed object array", () => {
    const result = analyse([
      ...prologue,
      0x8b,
      0x5e,
      8, // mov bx, the index argument
      0xd1,
      0xe3,
      0x8b,
      0x78,
      0x66, // mov di, [bx+si+0x66]
      0x0b,
      0xff,
      0xc7,
      0x45,
      0x12,
      1,
      0,
      ...epilogue,
    ]);
    const write = result.writes.find((write) => write.offset === 18)!;
    expect(write.object).toContain("pointer loaded from table");
    expect(write.confidence).toBe("unresolved");
    expect(result.uncertainties.some((issue) => issue.includes("pointer is lost"))).toBe(false);
  });

  it.each([
    ["leftShift32", 0x0200, 0xff00],
    ["arithmeticRightShift32", 0xffc0, 0xffff],
  ] as const)("applies the proved %s register relation algebraically", (operation, low, high) => {
    const image = new Uint8Array(0x100).fill(0x66);
    image.set([
      ...prologue,
      0xb8,
      1,
      0x80,
      0xba,
      0xff,
      0xff,
      0xb1,
      9,
      0x9a,
      0x80,
      0,
      0,
      0,
      0x89,
      0x44,
      0x60,
      0x89,
      0x54,
      0x62,
      ...epilogue,
    ]);
    const shift = engine(0x80);
    shift.argumentKind = "unknown";
    shift.numeric = { operation, width: 32, low: "ax", high: "dx", count: "cl", minimumCount: 0, maximumCount: 31 };
    const result = analyseRoutine(image, entry, { engineSummaries: new Map([[0x80, shift]]) });
    expect(result.writes.find((write) => write.offset === 0x60)?.value).toMatchObject({ kind: "constant", value: low });
    expect(result.writes.find((write) => write.offset === 0x62)?.value).toMatchObject({
      kind: "constant",
      value: high,
    });
  });

  it("keeps register outputs unknown outside the shift helper's proved domain", () => {
    const image = new Uint8Array(0x100).fill(0x66);
    image.set([...prologue, 0xb8, 1, 0, 0x33, 0xd2, 0xb1, 32, 0x9a, 0x80, 0, 0, 0, 0x89, 0x44, 0x60, ...epilogue]);
    const shift = engine(0x80);
    shift.argumentKind = "unknown";
    shift.numeric = {
      operation: "leftShift32",
      width: 32,
      low: "ax",
      high: "dx",
      count: "cl",
      minimumCount: 0,
      maximumCount: 31,
    };
    const result = analyseRoutine(image, entry, { engineSummaries: new Map([[0x80, shift]]) });
    expect(result.writes.find((write) => write.offset === 0x60)?.value.kind).toBe("unknown");
  });

  it("retains the signs of byte and word extensions", () => {
    const byte = analyse([...prologue, 0xb0, 0x80, 0x98, 0x89, 0x44, 0x60, ...epilogue]);
    expect(byte.writes.find((write) => write.offset === 0x60)?.value).toMatchObject({
      kind: "constant",
      value: 0xff80,
    });
    const word = analyse([...prologue, 0xb8, 0, 0x80, 0x99, 0x89, 0x54, 0x60, ...epilogue]);
    expect(word.writes.find((write) => write.offset === 0x60)?.value).toMatchObject({
      kind: "constant",
      value: 0xffff,
    });
  });
});

describe("callback argument positions and callee stack cleanup", () => {
  it.each([1, 2])("derives an owner argument after %s later pushed words", (following) => {
    const image = new Uint8Array(0x200).fill(0x66);
    image.set(
      [
        0x55,
        0x8b,
        0xec,
        0x83,
        0xec,
        0x10,
        0xff,
        0x76,
        0xfc, // push owner stored in a local
        ...Array.from({ length: following }, () => 0x57),
        0x8b,
        0x5e,
        0xfc,
        0x8b,
        0x47,
        0x24,
        0xba,
        58,
        0,
        0xf7,
        0xea,
        0xba,
        0x80,
        0,
        0x8b,
        0xd8,
        0x8e,
        0xc2,
        0x26,
        0xff,
        0x9f,
        0x36,
        0,
        0x5d,
        0xcb,
      ],
      0x100,
    );
    const code = readRoutineCode(image, { address: 0x100, segment: 0, offset: 0x100 }, 0);
    const site = code.instructions.find((instruction) => instruction.flow === "call")!.address;
    expect(inferDispatchedObjectArgument(code, site, 0x24)?.offset).toBe(6 + following * 2);
  });

  it("maps the owner's second argument independently from scalar argument offsets", () => {
    const image = new Uint8Array(0x100).fill(0x66);
    image.set([...prologue, 0x56, 0xb8, 7, 0, 0x50, 0x9a, 0x60, 0, 0, 0, ...epilogue]);
    image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 8, 0x8b, 0x46, 6, 0x89, 0x44, 0x0c, 0x5e, 0x5d, 0xca, 4, 0], 0x60);
    const summary = analyseRoutine(image, { address: 0x60, segment: 0, offset: 0x60 }, { argumentOffset: 8 });
    expect(summary.objectPointer).toMatchObject({ argumentOffset: 8, argumentBase: 6 });
    const result = analyseRoutine(image, entry, { summaries: new Map([[0x60, summary]]) });
    expect(result.writes.find((write) => write.object === "part" && write.offset === 12)?.value).toMatchObject({
      kind: "constant",
      value: 7,
    });
  });

  it.each([false, true])("discards callee-cleaned arguments before a later pop (engine summary %s)", (useEngine) => {
    const image = new Uint8Array(0x100).fill(0x66);
    image.set([...prologue, 0x56, 0x33, 0xc0, 0x50, 0x9a, 0x60, 0, 0, 0, 0x5f, 0xc7, 0x45, 0x0c, 1, 0, ...epilogue]);
    image.set([0x55, 0x8b, 0xec, 0xb8, 7, 0, 0x5d, 0xca, 2, 0], 0x60);
    const summary = analyseRoutine(image, { address: 0x60, segment: 0, offset: 0x60 });
    const service = engine(0x60);
    service.returnConvention = { kind: "far", stackBytes: 2 };
    const result = analyseRoutine(image, entry, {
      summaries: new Map([[0x60, summary]]),
      ...(useEngine ? { engineSummaries: new Map([[0x60, service]]) } : {}),
    });
    expect(result.writes.find((write) => write.offset === 12)).toMatchObject({
      object: "part",
      value: { kind: "constant", value: 1 },
    });
    expect(result.uncertainties.some((issue) => issue.includes("pointer is lost"))).toBe(false);
  });

  it("forgets non-state fields when only state preservation is proved", () => {
    const image = new Uint8Array(0x100).fill(0x66);
    image.set([
      ...prologue,
      0xc7,
      0x44,
      0x0c,
      1,
      0,
      0xc7,
      0x84,
      0x96,
      0,
      0,
      0,
      0x56,
      0x9a,
      0x80,
      0,
      0,
      0,
      0x59,
      0x83,
      0xbc,
      0x96,
      0,
      0,
      0x75,
      5,
      0xc7,
      0x44,
      0x0c,
      2,
      0,
      ...epilogue,
    ]);
    const service = engine(0x80);
    service.argumentKind = "object";
    service.footprint.complete = false;
    service.footprint.preservesArgumentMemory = false;
    service.footprint.partMemoryComplete = false;
    const result = analyseRoutine(image, entry, { engineSummaries: new Map([[0x80, service]]) });
    expect(
      result.transitions.some((transition) => transition.to.kind === "constant" && transition.to.value === 1),
    ).toBe(true);
    expect(
      result.transitions.some((transition) => transition.to.kind === "constant" && transition.to.value === 2),
    ).toBe(true);
    expect(result.transitions.every((transition) => transition.confidence === "unresolved")).toBe(true);
  });
});
