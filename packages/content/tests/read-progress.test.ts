import { describe, expect, it } from "vitest";
import { describeBehaviour } from "../src/read/describe-behaviour.ts";
import type { BehaviourReport } from "../src/read/behaviour.ts";

describe("progress of the walks", () => {
  it("counts the pass over the sources and then each part, ending at the total", () => {
    // A report without routines: every step is quick, but each part is counted, as a source of hits and on its own.
    const part = { routines: [], transitions: [], counters: [], triggers: [], uncertainties: [], visibleEffects: [] };
    const report = {
      layout: {
        fields: [
          { offset: 0x02, name: "type" },
          { offset: 0x0c, name: "state" },
        ],
        callbacks: [],
      },
      parts: [
        { ...part, type: 0, id: "a" },
        { ...part, type: 1, id: "b" },
      ],
      routines: [],
      assumptions: [],
      relatedObjectEffects: [],
    } as unknown as BehaviourReport;
    const seen: [number, number][] = [];
    describeBehaviour(report, (done, total) => seen.push([done, total]));
    expect(seen).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
  });
});
