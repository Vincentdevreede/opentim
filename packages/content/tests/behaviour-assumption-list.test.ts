import { describe, expect, it } from "vitest";
import type { BehaviourReport } from "../src/read/behaviour.ts";
import {
  addBuild,
  assumptionKey,
  collectAssumptions,
  compareAssumptions,
  renderAssumptions,
  type AssumptionTable,
} from "../src/read/behaviour-assumption-list.ts";
import { DECIDED_ASSUMPTIONS } from "../src/read/behaviour-assumptions.ts";

const decided = DECIDED_ASSUMPTIONS[0]!.assumptions[0]!;
const report = {
  assumptions: ["The PIT clock is 1,193,182 Hz."],
  helpers: [{ address: 0x100, assumptions: ["Callees preserve SI | DI.", "A path like C:\\| reads back."] }],
  parts: [
    { id: "cat", type: 12, routines: [{ address: 0x200 }], assumptions: ["A part assumption."] },
    { id: "teeter-totter", type: 3, routines: [{ address: 0x300 }], assumptions: [decided] },
  ],
  routines: [
    {
      address: 0x200,
      assumptions: [],
      writes: [
        { assumptions: ["A loop at 0x1a01a is finite.", "A part assumption."] },
        { assumptions: ["A loop at 0x1a01a is finite."] },
      ],
    },
  ],
} as unknown as BehaviourReport;

describe("the generated assumptions list", () => {
  it("counts the findings stating each assumption and the parts they belong to, without program addresses", () => {
    const uses = collectAssumptions(report);
    expect(uses.get("A loop at <address> is finite.")).toEqual({ findings: 2, parts: new Set(["cat"]) });
    expect(uses.get("A part assumption.")).toEqual({ findings: 2, parts: new Set(["cat"]) });
    expect(uses.get("The PIT clock is 1,193,182 Hz.")?.parts.size).toBe(0);
    expect(assumptionKey("at 0x66 and 0x1d32a")).toBe("at 0x66 and <address>");
  });

  it("writes a table every assumption can be found in again, with the decided ones marked", () => {
    const table: AssumptionTable = new Map();
    addBuild(table, "evenmore", collectAssumptions(report));
    const document = renderAssumptions(table, { tim1: 0, evenmore: 1 });
    expect(document).toContain("| Callees preserve SI \\| DI. | – | 1 · 1/1 | none, shared |");
    expect(document).toContain("| A path like C:\\\\\\| reads back. |");
    expect(document).toContain(`| **decided** ${decided} |`);
    expect(compareAssumptions(table, document)).toEqual({ missing: [], stale: [] });
  });

  it("names an assumption the list doesn't have, and one the builds no longer state", () => {
    const table: AssumptionTable = new Map();
    addBuild(table, "tim1", collectAssumptions(report));
    const document = renderAssumptions(table, { tim1: 1, evenmore: 0 });
    table.delete("A part assumption.");
    addBuild(table, "tim1", new Map([["A new assumption.", { findings: 1, parts: new Set<string>() }]]));
    expect(compareAssumptions(table, document)).toEqual({
      missing: ["A new assumption."],
      stale: ["A part assumption."],
    });
  });
});
