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
    expect(
      summary.writes.filter((write) => write.root === "argument").map((write) => [write.root, write.offset]),
    ).toEqual([
      ["argument", 0x14],
      ["argument", 0x16],
      ["argument", 0x18],
      ["argument", 0x1a],
    ]);
    expect(summary.connected?.partFields.map((field) => field.offset)).toEqual([0x96, 0x9c]);
    // Each pulley's loop runs twice and writes two words of its rope record in each pass.
    expect(summary.connected?.recordFields.map((field) => field.offset)).toEqual([0x14, 0x16, 0x18, 0x1a]);
    expect(summary.connected?.recordLinks).toEqual([0x54, 0x66, 0x68]);
  });

  it("builds a hit test from a proved rope reversal, turning the rope's own fields into record fields", () => {
    const reversal = helper(0x80, {
      kind: "rope-reversal",
      writes: [
        {
          ...fact,
          root: "argument",
          path: [],
          offset: 0x02,
          width: 16,
          value: { kind: "unknown", reason: "end", width: 16 },
          condition: { kind: "true" },
        },
      ],
      connected: { ...fact, partFields: [{ offset: 0x5a, width: 16 }], recordFields: [], recordLinks: [0x66] },
    });
    const hitPattern = pattern.replace("$ropePoint", "$ropeReverse");
    const summaries = new Map([[0x80, reversal]]);
    addConnectionSummaries(routine(), summaries, { ropeGeometry: [], ropeReverse: [], hitTest: [hitPattern] });
    const summary = summaries.get(0)!;
    expect(summary.kind).toBe("part-hit-test");
    expect(summary.writes.every((write) => write.root === "unknown")).toBe(true);
    expect(summary.footprint.preservesArgumentMemory).toBe(false);
    expect(summary.connected?.partFields).toEqual([{ offset: 0x5a, width: 16 }]);
    expect(summary.connected?.recordFields).toEqual([
      { offset: 0x04, width: 16 },
      { offset: 0x06, width: 16 },
      { offset: 0x02, width: 16 },
    ]);
    const plain = new Map([[0x80, helper(0x80)]]);
    addConnectionSummaries(routine(), plain, { ropeGeometry: [], ropeReverse: [], hitTest: [hitPattern] });
    expect(plain.has(0)).toBe(false);
  });

  it("bounds the relay to its byte, the rope end words, pulley links and records", () => {
    const image = new Uint8Array(0x100);
    image.set([0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6]);
    image.set([0x9a, 0x80, 0, 0, 0, 0x9a, 0x90, 0, 0, 0, 0x9a, 0xa0, 0, 0, 0, 0x5e, 0x5d, 0xcb], 7);
    for (const address of [0x80, 0x90, 0xa0]) image[address] = 0xcb;
    const codes = new Map([[0, readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0)]]);
    const field = (offset: number, root: "argument" | "unknown" = "argument") => ({
      ...fact,
      root,
      path: [],
      offset,
      width: 16,
      value: { kind: "unknown" as const, reason: "x", width: 16 },
      condition: { kind: "true" as const },
    });
    const belt = helper(0x80, { kind: "owner-field-update", writes: [field(0x08)] });
    const ends = helper(0x90, {
      kind: "belt-end-check",
      connected: {
        ...fact,
        partFields: [{ offset: 0x5a, width: 16 }],
        recordFields: [{ offset: 0x04, width: 16 }],
        recordLinks: [0x54],
      },
    });
    const geometry = helper(0xa0, {
      kind: "rope-geometry",
      writes: [field(0x14), field(0x96, "unknown")],
      connected: { ...fact, partFields: [{ offset: 0x96, width: 16 }], recordFields: [], recordLinks: [0x66] },
    });
    const summaries = new Map([
      [0x80, belt],
      [0x90, ends],
      [0xa0, geometry],
    ]);
    const relay = `push bp
mov bp,sp
push si
mov si,16:ss[bp+6]
callf $beltGeometry
callf $beltEnds
callf $ropeGeometry
pop si
pop bp
retf`;
    addConnectionSummaries(codes, summaries, { ropeGeometry: [], ropeReverse: [], relay: [relay] });
    const summary = summaries.get(0)!;
    expect(summary.kind).toBe("related-byte-propagation");
    expect(summary.footprint).toMatchObject({
      partMemoryComplete: true,
      preservesArgumentMemory: false,
      preservesPartState: true,
    });
    expect(summary.connected?.partFields).toEqual([
      { offset: 0x14, width: 8 },
      { offset: 0x5a, width: 16 },
      { offset: 0x96, width: 16 },
    ]);
    expect(summary.connected?.recordFields.map((item) => item.offset)).toEqual([0x04, 0x08, 0x14]);
    expect(summary.writes.find((write) => write.root === "argument")).toMatchObject({ offset: 0x14, width: 8 });
    // The rope ends come only from the rope geometry update and the links only from the belt end check, which decided
    // assumptions 19 and 20 rule out for the owner of some callers.
    expect(summary.connected?.ropeHolderFields).toEqual([{ offset: 0x96, width: 16 }]);
    expect(summary.connected?.beltEndFields).toEqual([{ offset: 0x5a, width: 16 }]);
    summaries.delete(0);
    summaries.set(0xa0, helper(0xa0));
    addConnectionSummaries(codes, summaries, { ropeGeometry: [], ropeReverse: [], relay: [relay] });
    expect(summaries.has(0)).toBe(false);
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
