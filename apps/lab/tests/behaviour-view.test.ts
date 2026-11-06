import type { Expression } from "@opentim/content";
import { describe, expect, it } from "vitest";
import { valueForState, writer, type Change, type PartSummary, type Walk } from "../src/behaviour.ts";
import {
  changeRows,
  endText,
  outlineShape,
  outlineSides,
  readTerm,
  restingMore,
  ownTerms,
  routineGroups,
  stateGroups,
  targetsText,
  writeRows,
  tidyTerm,
  tidyTerms,
  walkGroups,
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

describe("values a test picks", () => {
  it("writes the two values and the test that picks one", () => {
    const { expression } = writer([{ offset: 0x0c, name: "state" }]);
    const picked = (operator: string, other: string, then: Expression, otherwise: Expression) =>
      binary(
        "+",
        binary("*", binary(operator, state, constant(2)), then),
        binary("*", binary(other, state, constant(2)), otherwise),
      );
    expect(expression(picked("==", "!=", constant(3), constant(5)))).toBe("3 if state == 2, else 5");
    expect(expression(picked("<", ">=", binary("+", state, constant(1)), constant(5)))).toBe(
      "(state + 1) if state < 2, else 5",
    );
    // Without the opposite test, it is a sum like any other.
    expect(expression(picked("==", "==", constant(3), constant(5)))).toBe("((state == 2) * 3) + ((state == 2) * 5)");
  });
});

describe("tidying conditions", () => {
  it("writes an absolute value and a negative constant shorter", () => {
    const { expression } = writer([{ offset: 0x0c, name: "state" }]);
    const difference = binary("-", state, { ...state, offset: 0x28 });
    const sign = binary(">>", difference, constant(15));
    const absolute = binary("-", binary("^", difference, sign), sign);
    expect(tidyTerm(`${expression(absolute)} <= 1`)).toBe("|state - olderY| <= 1");
    expect(tidyTerm(`${expression(binary("+", absolute, constant(1)))} > 2`)).toBe("|state - olderY| + 1 > 2");
    const own = binary(">>", state, constant(15));
    expect(tidyTerm(`${expression(binary("-", binary("^", state, own), own))} < 3`)).toBe("|state| < 3");
    // Also of another part's field, like the overlap of the part a search found.
    expect(tidyTerm("(found.overlapX ^ (found.overlapX >> 15)) - (found.overlapX >> 15) < 292")).toBe(
      "|found.overlapX| < 292",
    );
    expect(tidyTerm("x + 0xffe0 > 3")).toBe("x - 32 > 3");
    expect(tidyTerm("(x - 32) - 0xffc0")).toBe("(x - 32) + 64");
  });

  it("drops repeats, comparisons of numbers and terms another implies", () => {
    expect(tidyTerms(["a < 0", "a != 0", "a <= 0", "3 == 3", "a < 0", "b >= 2"])).toEqual(["a < 0", "b >= 2"]);
    // Masked bits read in hex, and say the same.
    expect(tidyTerms(["k & 0x7 != 0x4", "k & 0x7 == 0x2", "0x200 != 0"])).toEqual(["k & 0x7 == 0x2"]);
  });
});

describe("restingMore", () => {
  it("counts the other ways from every walk that rests on a frame, and says and others when only a few are kept", () => {
    expect(restingMore({ ways: 1 })).toBe("");
    expect(restingMore({ ways: 2 })).toBe("1 more way");
    expect(restingMore({ ways: 158 })).toBe("157 more ways");
    expect(restingMore({ ways: 191, capped: true })).toBe("and others");
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

describe("hits in words", () => {
  const write = (target: string, value: number) => ({
    routine: "reset",
    target,
    value: String(value),
    condition: "always",
    confidence: "inferred" as const,
    assumptions: [],
    evidence: [],
  });
  const outline = (points: [number, number][]) =>
    ({
      routines: [],
      changes: [],
      triggers: [],
      counters: [],
      effects: [],
      uncertainties: [],
      reset: points.flatMap(([x, y], k) => [write(`outline[${k}].x`, x), write(`outline[${k}].y`, y)]),
    }) as PartSummary;

  it("works out the side each edge faces from the points a reset writes", () => {
    expect(
      outlineSides(
        outline([
          [0, 11],
          [47, 11],
          [47, 27],
          [0, 27],
        ]),
      ),
    ).toEqual(["top", "right", "bottom", "left"]);
    expect(
      outlineSides(
        outline([
          [8, 0],
          [23, 0],
          [31, 8],
          [31, 23],
          [23, 31],
          [8, 31],
          [0, 23],
          [0, 8],
        ]),
      ),
    ).toEqual(["top", "top right", "right", "bottom right", "bottom", "bottom left", "left", "top left"]);
    expect(outlineSides(outline([]))).toBeUndefined();
  });

  it("says which way the hit surface faces and which edge was hit", () => {
    expect(readTerm("(collider.contactAngle + 0x4000) & 0x8000 == 0")).toBe("hit from above");
    expect(readTerm("(collider.contactAngle + 0x4000) & 0x8000 != 0")).toBe("hit from below");
    expect(readTerm("collider.contactEdge == 0", ["top", "right"])).toBe("hit on the top (edge 0)");
    expect(readTerm("collider.contactEdge != 1", ["top", "right"])).toBe("not on the right (edge 1)");
    expect(readTerm("collider.contactEdge == 2")).toBe("hit on edge 2");
    expect(readTerm("collider.contactEdge < 3")).toBe("hit on edges 0–2");
    expect(readTerm("socket1 == 0")).toBe("socket1 == 0");
  });

  it("drops not equal to a number when the condition says equal to another", () => {
    expect(tidyTerms(["collider.contactEdge != 3", "collider.contactEdge == 0", "collider.contactEdge != 0"])).toEqual([
      "collider.contactEdge == 0",
      "collider.contactEdge != 0",
    ]);
  });
});

describe("writeRows", () => {
  const write = (target: string, value: string) => ({
    routine: "reset",
    target,
    value,
    condition: "always",
    confidence: "inferred" as const,
    assumptions: [],
    evidence: [],
  });

  it("folds a routine's writes to the outline points into one row of points", () => {
    const rows = writeRows([
      write("outline[0].x", "0"),
      write("outline[0].y", "0"),
      write("outline[1].x", "frameWidth"),
      write("outline[1].y", "0"),
      write("state", "0"),
    ]);
    expect(rows.map((r) => [r.target, r.values])).toEqual([
      ["outline", ["(0,0)", "(frameWidth,0)"]],
      ["state", ["0"]],
    ]);
  });

  it("writes an equality with a 16-bit word as its signed value", () => {
    expect(tidyTerm("state + stateDelta != 0xffff")).toBe("state + stateDelta != -1");
  });
});

describe("outlineShape", () => {
  const write = (target: string, value: string) => ({
    routine: "reset",
    target,
    value,
    condition: "always",
    confidence: "inferred" as const,
    assumptions: [],
    evidence: [],
  });
  const part = (points: [string, string][]) =>
    ({
      routines: [],
      changes: [],
      triggers: [],
      counters: [],
      effects: [],
      uncertainties: [],
      reset: points.flatMap(([x, y], k) => [write(`outline[${k}].x`, x), write(`outline[${k}].y`, y)]),
    }) as PartSummary;

  it("works the points out for the frame's size, as bytes", () => {
    const wall = part([
      ["0", "0"],
      ["frameWidth + 0xff", "0"],
      ["frameWidth + 0xff", "frameHeight + 0xff"],
      ["0", "frameHeight + 0xff"],
    ]);
    expect(outlineShape(wall, { width: 32, height: 16 })).toEqual([
      { x: 0, y: 0 },
      { x: 31, y: 0 },
      { x: 31, y: 15 },
      { x: 0, y: 15 },
    ]);
  });

  it("gives nothing when a point depends on more than the frame's size", () => {
    expect(
      outlineShape(
        part([
          ["0", "0"],
          ["positionX", "0"],
        ]),
        { width: 8, height: 8 },
      ),
    ).toBeUndefined();
  });
});

describe("walkGroups", () => {
  const walk = (
    trigger: string,
    start: Walk["start"],
    frames: number[],
    condition: string[],
    more: Partial<Walk> = {},
  ): Walk => ({
    confidence: "inferred",
    frames,
    end: "rest",
    branches: [],
    trigger,
    start,
    condition,
    about: trigger,
    ...more,
  });

  it("puts walks that follow the same path into one row, with the terms they share and what each adds", () => {
    const [group] = walkGroups([
      walk("run", "run-guard", [0, 1], ["stateDelta != 0", "state == 0"]),
      walk("run", "run-guard", [0, 1], ["stateDelta != 0", "state == 1"]),
    ]);
    expect(group!.rows).toHaveLength(1);
    expect(group!.rows[0]).toMatchObject({ shared: ["stateDelta != 0"], variants: [["state == 0"], ["state == 1"]] });
  });

  it("lists run first, and the walks of a trigger in the order they start", () => {
    const groups = walkGroups([
      walk("bounce", "reset", [], []),
      walk("run", "run-guard", [2], []),
      walk("run", "reset", [0], []),
    ]);
    expect(groups.map((g) => g.trigger)).toEqual(["run", "bounce"]);
    expect(groups[0]!.rows.map((r) => r.start)).toEqual(["reset", "run-guard"]);
  });

  it("tidies the conditions of branches", () => {
    const [group] = walkGroups([
      walk("run", "reset", [], [], {
        end: "branches",
        branches: [
          {
            condition: ["state == 0", "0 == 0"],
            path: { confidence: "inferred", frames: [0], end: "stop", branches: [] },
          },
        ],
      }),
    ]);
    expect(group!.rows[0]!.path.branches[0]!.condition).toEqual(["state == 0"]);
  });

  it("keeps whether every way a split goes ends, and doesn't put it in a row with an open split", () => {
    const split = { end: "branches" as const, branches: [] };
    const [group] = walkGroups([
      walk("run", "reset", [0], [], { ...split, settled: true }),
      walk("run", "reset", [0], [], split),
    ]);
    expect(group!.rows.map((row) => row.path.settled)).toEqual([true, undefined]);
  });
});

describe("endText", () => {
  const path = (end: Walk["end"], frames: number[], more = {}) => ({
    confidence: "inferred" as const,
    frames,
    end,
    branches: [],
    ...more,
  });
  it("says how a path ends in a few words", () => {
    expect(endText(path("rest", [0, 1]))).toBe("rests");
    expect(endText(path("loop", [0, 1, 2], { loopFrom: 1 }))).toBe("loops to 1");
    expect(endText(path("cycle", [], { cycle: { period: 4, direction: -1 } }))).toBe("cycles 4 frames down");
    expect(endText(path("stop", [3]))).toBe("stops");
    expect(endText(path("joins", [2]))).toBe("continues like another way");
    expect(endText(path("branches", [0], { branches: [{}, {}] }))).toBe("2 ways");
    expect(endText(path("branches", [0], { branches: [{}, {}], settled: true }))).toBe("2 ways, all end");
    expect(endText(path("branches", [0], { ways: 3 }))).toBe("3 ways");
    expect(endText(path("branches", [0], { ways: 1, settled: true }))).toBe("1 way, it ends");
  });
});
