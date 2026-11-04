import { describe, expect, it } from "vitest";
import { readRoutineCode } from "../src/read/behaviour-code.ts";
import type { EngineSummary } from "../src/read/behaviour-helpers.ts";
import { addOutlineSearchSummary } from "../src/read/behaviour-outline-search.ts";

const fact = { confidence: "inferred" as const, assumptions: [], evidence: [] };
const CALLEES = ["listHead", "segments", "listNext"];
function helper(address: number, kind: string): EngineSummary {
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
  };
}
/** push bp; mov bp,sp; three far calls to 0x80, 0x81 and 0x82; pop bp; retf. */
function routine() {
  const image = new Uint8Array(0x100);
  image.set([0x55, 0x8b, 0xec, ...CALLEES.flatMap((_, n) => [0x9a, 0x80 + n, 0, 0, 0]), 0x5d, 0xcb]);
  for (let n = 0; n < CALLEES.length; n++) image[0x80 + n] = 0xcb;
  return new Map([[0, readRoutineCode(image, { address: 0, segment: 0, offset: 0 }, 0)]]);
}
const pattern = ["push bp", "mov bp,sp", ...CALLEES.map((name) => "callf $" + name), "pop bp", "retf"].join("\n");

describe("the outline search", () => {
  it("builds a found list that may hold the owner, and changes no part's state", () => {
    const summaries = new Map([
      [0x80, helper(0x80, "list-head")],
      [0x81, helper(0x81, "argument-buffer-update")],
      [0x82, helper(0x82, "list-next")],
    ]);
    addOutlineSearchSummary(routine(), summaries, [pattern]);
    const summary = summaries.get(0)!;
    expect(summary).toMatchObject({ kind: "overlap-list", list: { headField: 0x78, excludesArgument: false } });
    expect(summary.footprint).toMatchObject({ partMemoryComplete: true, preservesPartState: true });
    expect(summary.writes.map((write) => [write.root, write.offset])).toEqual([
      ["argument", 0x78],
      ["unknown", 0x78],
    ]);
  });

  it("is not summarised when the list helpers aren't proved", () => {
    const summaries = new Map([
      [0x80, helper(0x80, "call-wrapper")],
      [0x81, helper(0x81, "argument-buffer-update")],
      [0x82, helper(0x82, "list-next")],
    ]);
    addOutlineSearchSummary(routine(), summaries, [pattern]);
    expect(summaries.has(0)).toBe(false);
  });
});
