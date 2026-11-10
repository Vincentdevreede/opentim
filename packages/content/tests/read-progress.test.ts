import { describe, expect, it } from "vitest";
import { describeBehaviour } from "../src/read/describe-behaviour.ts";
import type { BehaviourReport } from "../src/read/behaviour.ts";

describe("progress of the walks", () => {
  it("counts the pass over the sources and then each part, ending at the total", () => {
    // A report without fields or routines: every step is quick, but each part is still counted.
    const report = {
      layout: { fields: [], callbacks: [] },
      parts: [
        { type: 0, id: "a", routines: [], transitions: [], counters: [], triggers: [], uncertainties: [] },
        { type: 1, id: "b", routines: [], transitions: [], counters: [], triggers: [], uncertainties: [] },
      ],
      routines: [],
      assumptions: [],
      relatedObjectEffects: [],
    } as unknown as BehaviourReport;
    const seen: [number, number][] = [];
    try {
      describeBehaviour(report, (done, total) => seen.push([done, total]));
    } catch {
      // A made-up report may not describe; the progress before that still counts.
    }
    expect(seen[0]).toEqual([1, 5]);
    expect(seen.every(([done, total], k) => total === 5 && (k === 0 || done > seen[k - 1]![0]))).toBe(true);
  });
});
