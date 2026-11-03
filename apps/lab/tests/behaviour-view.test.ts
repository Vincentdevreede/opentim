import type { Expression } from "@opentim/content";
import { describe, expect, it } from "vitest";
import { valueForState, writer, type Change, type PartSummary } from "../src/behaviour.ts";
import {
  changeRows,
  ownTerms,
  routineGroups,
  stateGroups,
  targetsText,
  tidyTerm,
  tidyTerms,
} from "../src/behaviour-view.ts";

const constant = (value: number): Expression => ({ kind: "constant", value, width: 16 });
const state: Expression = { kind: "field", object: "part", offset: 0x0c, width: 16 };
const binary = (operator: string, left: Expression, right: Expression): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width: 16,
});
const change = (routine: string, from: number[] | null, to: string, condition: string, more: Partial<Change> = {}) =>
  ({
    routine,
    from,
    to,
    condition,
    keeps: false,
    confidence: "inferred",
    assumptions: [],
    evidence: [],
    ...more,
  }) as Change;

describe("valueForState", () => {
  it("works out an expression of the state and stops at anything else", () => {
    expect(valueForState(binary("&", binary("-", state, constant(4)), constant(4)), 6, 0x0c)).toBe(0);
    expect(valueForState(binary("|", binary("&", state, constant(4)), constant(1)), 6, 0x0c)).toBe(5);
    expect(valueForState(binary("-", state, constant(1)), 0, 0x0c)).toBe(0xffff);
    expect(valueForState(binary("+", state, { ...state, offset: 0x12 }), 1, 0x0c)).toBeUndefined();
  });
});

describe("tidying conditions", () => {
  it("writes an absolute value and a negative constant shorter", () => {
    const { expression } = writer([{ offset: 0x0c, name: "state" }]);
    const difference = binary("-", state, { ...state, offset: 0x28 });
    const sign = binary(">>", difference, constant(15));
    const absolute = binary("-", binary("^", difference, sign), sign);
    expect(tidyTerm(`${expression(absolute)} <= 1`)).toBe("|state - part+0x28| <= 1");
    expect(tidyTerm(`${expression(binary("+", absolute, constant(1)))} > 2`)).toBe("|state - part+0x28| + 1 > 2");
    const own = binary(">>", state, constant(15));
    expect(tidyTerm(`${expression(binary("-", binary("^", state, own), own))} < 3`)).toBe("|state| < 3");
    expect(tidyTerm("x + 0xffe0 > 3")).toBe("x - 32 > 3");
    expect(tidyTerm("(x - 32) - 0xffc0")).toBe("(x - 32) + 64");
  });

  it("drops repeats, comparisons of numbers and terms another implies", () => {
    expect(tidyTerms(["a < 0", "a != 0", "a <= 0", "3 == 3", "a < 0", "b >= 2"])).toEqual(["a < 0", "b >= 2"]);
  });
});

describe("targetsText", () => {
  it("gives one target, or a few runs of targets per state", () => {
    expect(targetsText([4, 5, 6, 7], [0, 0, 0, 0])).toBe(0);
    expect(targetsText([0, 1, 2, 3, 4, 5, 6, 7], [0, 0, 0, 0, 4, 4, 4, 4])).toBe("0–3→0 · 4–7→4");
    expect(targetsText([0, 1, 2, 3], [1, 2, 3, 4])).toBeUndefined();
  });
});

describe("changeRows", () => {
  it("joins the paths that make the same change and keeps what each adds", () => {
    const rows = changeRows([
      change("run", [4], "0", "stateDelta != 0 and a == 1", { toState: 0 }),
      change("run", [4], "0", "stateDelta != 0 and a == 2", { toState: 0 }),
      change("run", [0, 1, 2, 3, 4, 5, 6, 7], "state & 4", "state <= 7", { targets: [0, 0, 0, 0, 4, 4, 4, 4] }),
    ]);
    expect(rows.map((r) => [r.fromText, r.target, r.shared, r.variants])).toEqual([
      ["4", "→ 0", ["stateDelta != 0"], [["a == 1"], ["a == 2"]]],
      ["0–7", "0–3→0 · 4–7→4", ["state <= 7"], []],
    ]);
    expect(rows[1]!.expression).toBe("state & 4");
    expect(ownTerms(rows[1]!)).toEqual([]);
  });
});

describe("groups", () => {
  const routine = (role: string, address: number) => ({
    role,
    at: "",
    address,
    shared: false,
    empty: false,
    confidence: "checked" as const,
    assumptions: [],
    evidence: [],
  });
  const part: PartSummary = {
    routines: [routine("bounce", 1), routine("run", 2)],
    changes: [
      change("run", [0], "1", "always", { toState: 1 }),
      change("run", null, "state", "always", { keeps: true }),
      change("bounce", [1], "0", "always", { toState: 0, confidence: "unresolved" }),
      change("0x12345", [], "unknown", "always"),
    ],
    triggers: [],
    counters: [],
    reset: [],
    effects: [
      {
        routine: "run",
        target: "drawX",
        value: "1",
        condition: "always",
        confidence: "checked",
        assumptions: [],
        evidence: [],
      },
    ],
    uncertainties: [],
  };

  it("puts every change and drawing write under its routine, in the record's order", () => {
    expect(routineGroups(part).map((g) => [g.role, g.changes.length, g.kept, g.draws.length, g.open])).toEqual([
      ["bounce", 1, 0, 0, true],
      ["run", 1, 1, 1, false],
      ["0x12345", 1, 0, 0, false],
    ]);
  });

  it("puts the changes under the states they start from", () => {
    expect(stateGroups(part).map((g) => [g.fromText, g.rows.map((r) => r.routine)])).toEqual([
      ["0", ["run"]],
      ["1", ["bounce"]],
      ["none of its own", ["0x12345"]],
    ]);
  });
});
