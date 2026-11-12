import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { EngineSummary, EngineWrite } from "../src/read/behaviour-helpers.ts";
import { addRopeCutSummary, ROPE_CUT_ASSUMPTIONS } from "../src/read/behaviour-rope-cut.ts";

const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };
const CALLEES = ["segments", "wrapper", "factory", "release", "insert", "shift", "position", "ropeGeometry"];
const write = (root: EngineWrite["root"], offset: number, path: number[] = []): EngineWrite => ({
  ...fact,
  root,
  argumentOffset: 6,
  path,
  offset,
  width: 16,
  value: { kind: "unknown", reason: "x", width: 16 },
  condition: { kind: "true" },
});
function helper(address: number, kind: string, extra: Partial<EngineSummary> = {}): EngineSummary {
  return {
    ...fact,
    address,
    kind,
    purpose: "Synthetic callee.",
    argumentOffset: 6,
    argumentKind: "object",
    writes: [],
    returns: [],
    calls: [],
    footprint: {
      complete: true,
      partMemoryComplete: true,
      preservesArgumentMemory: true,
      preservesPartState: true,
      unknownEffects: [],
    },
    ...extra,
  };
}
const RELEASE = 0x100,
  FREE = 0x180;
const far = (address: number) => [0x9a, address & 0xff, address >> 8, 0, 0];
const address = (name: string) => (name === "release" ? RELEASE : 0x80 + CALLEES.indexOf(name));
/**
 * The release of a new piece: it frees the outline buffer at 0x82, the belt record at 0x54 unless flag 1 is set, the
 * rope record at 0x66 for types 7 and 10, and then the piece. With `extra` it also clears word 0x40 of the piece first.
 */
function release(extra = false) {
  return [
    ...[0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06, ...(extra ? [0xc7, 0x44, 0x40, 0, 0] : []), 0x0b, 0xf6, 0x74, 0x49],
    ...[0x83, 0xbc, 0x82, 0x00, 0x00, 0x74, 0x0a, 0xff, 0xb4, 0x82, 0x00, ...far(FREE), 0x59],
    ...[0x83, 0x7c, 0x54, 0x00, 0x74, 0x10, 0xf7, 0x44, 0x08, 0x01, 0x00, 0x75, 0x09],
    ...[0xff, 0x74, 0x54, ...far(FREE), 0x59],
    ...[0x83, 0x7c, 0x66, 0x00, 0x74, 0x15, 0x83, 0x7c, 0x04, 0x07, 0x74, 0x06, 0x83, 0x7c, 0x04, 0x0a, 0x75, 0x09],
    ...[0xff, 0x74, 0x66, ...far(FREE), 0x59],
    ...[0x56, ...far(FREE), 0x59, 0x5e, 0x5d, 0xcb],
  ];
}
/** push bp; mov bp,sp; eight far calls, to 0x80, 0x81 and on and the release at 0x100; pop bp; retf. */
function routine(releaseWritesMore = false) {
  const image = new Uint8Array(0x200);
  image.set([0x55, 0x8b, 0xec, ...CALLEES.flatMap((name) => far(address(name))), 0x5d, 0xcb]);
  for (const name of CALLEES) image[address(name)] = 0xcb;
  image.set(release(releaseWritesMore), RELEASE);
  image[FREE] = 0xcb;
  return new Map(
    [0, RELEASE, FREE].map((at) => [at, readRoutineCode(image, { address: at, segment: 0, offset: at }, 0)]),
  );
}
const pattern = ["push bp", "mov bp,sp", ...CALLEES.map((name) => "callf $" + name), "pop bp", "retf"].join("\n");
/** A part factory whose rope end (type 49) has a proved constructor, unless `ends` is false. */
function factory(ends = true): EngineSummary["factory"] {
  return {
    typeArgument: 6,
    constructorTable: { segment: 0, offset: 0, stride: 4, typeCount: 64 },
    noConstructorTypes: [],
    alwaysSuccessfulConstructors: ends ? [{ ...fact, type: 49, address: 0x1000 }] : [],
    noConstructor: {
      ...fact,
      purpose: "Synthetic.",
      footprint: {
        complete: true,
        partMemoryComplete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: [],
      },
      writes: [],
      freshFieldsOnly: true,
    },
  };
}
function callees(kinds: Partial<Record<string, string>> = {}) {
  const kind = (name: string, fallback: string) => kinds[name] ?? fallback;
  return new Map<number, EngineSummary>([
    [0x80, helper(0x80, kind("segments", "argument-buffer-update"))],
    [0x81, helper(0x81, kind("wrapper", "call-wrapper"))],
    [0x82, helper(0x82, kind("factory", "part-factory"), { factory: factory() })],
    [RELEASE, helper(RELEASE, kind("release", "call-wrapper"))],
    [0x84, helper(0x84, kind("insert", "ordered-part-insertion"), { writes: [write("argument", 0, [-1])] })],
    [0x85, helper(0x85, kind("shift", "wide-integer-shift"))],
    [0x86, helper(0x86, kind("position", "frame-position"))],
    [
      0x87,
      helper(0x87, kind("ropeGeometry", "rope-geometry"), {
        writes: [write("argument", 0x14)],
        connected: { ...fact, partFields: [{ offset: 0x96, width: 16 }], recordFields: [], recordLinks: [0x66] },
      }),
    ],
  ]);
}

describe("the scissors' rope cut", () => {
  it("names the links and rope record fields a cut can change, and keeps every part's state", () => {
    const summaries = callees();
    addRopeCutSummary(routine(), summaries, [pattern]);
    const summary = summaries.get(0)!;
    expect(summary.kind).toBe("rope-cut");
    expect(summary.footprint).toMatchObject({ partMemoryComplete: true, preservesPartState: true });
    const parts = summary.connected!.partFields.map((field) => field.offset);
    expect(parts).toEqual(expect.arrayContaining([0x5a, 0x5c, 0x66, 0x68, 0x00, 0x96]));
    expect(parts).not.toContain(0x0c);
    expect(summary.connected!.recordFields).toEqual(
      expect.arrayContaining([
        { offset: 0x04, width: 16 },
        { offset: 0x0b, width: 8 },
        { offset: 0x14, width: 16 },
      ]),
    );
    expect(summary.assumptions).toEqual(expect.arrayContaining(ROPE_CUT_ASSUMPTIONS));
  });

  it("is not summarised when a callee isn't what the proof needs", () => {
    const summaries = callees({ factory: "call-wrapper" });
    addRopeCutSummary(routine(), summaries, [pattern]);
    expect(summaries.has(0)).toBe(false);
  });

  const unproved = {
    complete: false,
    partMemoryComplete: false,
    preservesArgumentMemory: false,
    preservesPartState: false,
    unknownEffects: ["anything"],
  };
  it.each<[string, (summaries: Map<number, EngineSummary>) => void, boolean?]>([
    [
      "the wrapper writes its part",
      (s) => s.set(0x81, helper(0x81, "call-wrapper", { writes: [write("argument", 0x40)] })),
    ],
    ["the release is not the piece's cleanup", () => undefined, true],
    [
      "the position helper's footprint is unproved",
      (s) => s.set(0x86, helper(0x86, "frame-position", { footprint: unproved })),
    ],
    [
      "the position helper writes another part",
      (s) => s.set(0x86, helper(0x86, "frame-position", { writes: [write("argument", 0x40, [0x5a])] })),
    ],
    ["the rope end's constructor is unproved", (s) => void (s.get(0x82)!.factory = factory(false))],
  ])("is not summarised when %s", (_, change, releaseWritesMore) => {
    const summaries = callees();
    change(summaries);
    addRopeCutSummary(routine(releaseWritesMore), summaries, [pattern]);
    expect(summaries.has(0)).toBe(false);
  });
});
