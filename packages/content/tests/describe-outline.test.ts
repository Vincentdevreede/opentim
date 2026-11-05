import { describe, expect, it } from "vitest";
import type { BehaviourReport, Expression, FieldWrite } from "../src/read/behaviour.ts";
import { outlineObject, outlineWords } from "../src/read/describe-outline.ts";

const report = {
  layout: {
    fields: [
      { offset: 0x44, name: "frameWidth" },
      { offset: 0x46, name: "frameHeight" },
      { offset: 0x82, name: "outlinePoints" },
    ],
  },
} as unknown as BehaviourReport;
const OUTLINE = "referenced-by(part+0x82)";
const c = (value: number): Expression => ({ kind: "constant", value, width: 8 });
const less = (offset: number): Expression => ({
  kind: "binary",
  operator: "+",
  left: { kind: "field", object: "part", offset, width: 16 },
  right: { kind: "constant", value: 255, width: 16 },
  width: 16,
});
const write = (offset: number, value: Expression, object = OUTLINE): FieldWrite => ({
  object,
  offset,
  width: 8,
  value,
  condition: { kind: "true" },
  routine: 0x190fc,
  confidence: "inferred",
  assumptions: [],
  evidence: [],
});

describe("outline writes", () => {
  it("names the outline pointer from the layout", () => {
    expect(outlineObject(report)).toBe(OUTLINE);
  });

  it("reads a ball's reset as its outline corners, X before Y", () => {
    const corners = [
      [8, 0],
      [23, 0],
      [31, 8],
    ];
    const writes = corners.flatMap(([x, y], index) => [write(index * 4, c(x!)), write(index * 4 + 1, c(y!))]);
    expect(outlineWords(writes, report)).toBe("Sets its outline to 3 corners: (8, 0), (23, 0), (31, 8).");
  });

  it("reads adding 255 to a size in a byte as the size minus 1", () => {
    const writes = [write(4, less(0x44)), write(8, less(0x44)), write(9, less(0x46))];
    expect(outlineWords(writes, report)).toBe(
      "Moves outline corner 2 x to its frame width - 1, corner 3 x to its frame width - 1 and y to its frame height - 1.",
    );
  });

  it("ignores writes to other objects", () => {
    expect(outlineWords([write(12, c(31), "referenced-by(part+0x84)")], report)).toBeUndefined();
  });
});
