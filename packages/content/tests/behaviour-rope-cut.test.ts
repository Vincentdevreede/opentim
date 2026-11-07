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
/** push bp; mov bp,sp; eight far calls to 0x80, 0x81 and on; pop bp; retf. */
function routine() {
  const image = new Uint8Array(0x100);
  const calls = CALLEES.flatMap((_, n) => [0x9a, 0x80 + n, 0, 0, 0]);
  image.set([0x55, 0x8b, 0xec, ...calls, 0x5d, 0xcb]);
  for (let n = 0; n < CALLEES.length; n++) image[0x80 + n] = 0xcb;
  return new Map([[0, readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0)]]);
}
const pattern = ["push bp", "mov bp,sp", ...CALLEES.map((name) => "callf $" + name), "pop bp", "retf"].join("\n");
function callees(kinds: Partial<Record<string, string>> = {}) {
  const kind = (name: string, fallback: string) => kinds[name] ?? fallback;
  return new Map<number, EngineSummary>([
    [0x80, helper(0x80, kind("segments", "argument-buffer-update"))],
    [0x81, helper(0x81, kind("wrapper", "call-wrapper"))],
    [0x82, helper(0x82, kind("factory", "part-factory"))],
    [0x83, helper(0x83, kind("release", "call-wrapper"))],
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
});
