import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import { addConnectionSummaries } from "../src/read/behaviour-connection-relay.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";

const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };
const preserving = {
  complete: true,
  partMemoryComplete: true,
  preservesArgumentMemory: true,
  preservesPartState: true,
  unknownEffects: [],
};
function helper(address: number, extra: Partial<EngineSummary> = {}): EngineSummary {
  return {
    ...fact,
    address,
    kind: "read-only",
    purpose: "Synthetic callee.",
    argumentOffset: 6,
    argumentKind: "object",
    writes: [],
    returns: [],
    calls: [],
    footprint: preserving,
    ...extra,
  };
}
/** push bp; mov bp,sp; push si; mov si,[bp+6]; call far 0:0x80; pop si; pop bp; retf, optionally with a nop. */
function routine(extra: number[] = []) {
  const image = new Uint8Array(0x100);
  image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6, ...extra, 0x9a, 0x80, 0, 0, 0, 0x5e, 0x5d, 0xcb]);
  image[0x80] = 0xcb;
  return new Map([[0, readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0)]]);
}
const pattern = `push bp
mov bp,sp
push si
mov si,16:ss[bp+6]
callf $ropePoint
pop si
pop bp
retf`;

describe("rope and belt helper summaries", () => {
  it("names the rope record, pulley records and end words a matched rope geometry update writes", () => {
    const summaries = new Map([[0x80, helper(0x80)]]);
    addConnectionSummaries(routine(), summaries, { ropeGeometry: [pattern], ropeReverse: [] });
    const summary = summaries.get(0)!;
    expect(summary.kind).toBe("rope-geometry");
    expect(summary.footprint).toMatchObject({ partMemoryComplete: true, preservesPartState: true });
    expect(summary.writes.map((write) => [write.root, write.offset])).toEqual([
      ["argument", 0x14],
      ["argument", 0x16],
      ["argument", 0x18],
      ["argument", 0x1a],
    ]);
    expect(summary.connected?.partFields.map((field) => field.offset)).toEqual([0x96, 0x9c]);
    expect(summary.connected?.recordLinks).toEqual([0x54, 0x66, 0x68]);
  });

  it("makes no summary when the callee writes a part or the instruction graph differs", () => {
    const writing = helper(0x80, {
      writes: [
        {
          ...fact,
          root: "argument",
          path: [],
          offset: 0x0c,
          width: 16,
          value: { kind: "constant", value: 1, width: 16 },
          condition: { kind: "true" },
        },
      ],
    });
    const summaries = new Map([[0x80, writing]]);
    addConnectionSummaries(routine(), summaries, { ropeGeometry: [pattern], ropeReverse: [] });
    expect(summaries.has(0)).toBe(false);
    const changed = new Map([[0x80, helper(0x80)]]);
    addConnectionSummaries(routine([0x90]), changed, { ropeGeometry: [pattern], ropeReverse: [] });
    expect(changed.has(0)).toBe(false);
  });
});
