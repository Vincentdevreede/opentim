import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
const prefix = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6],
  suffix = [0x5e, 0x5d, 0xcb],
  entry = { address: 0, segment: 0, offset: 0 };
function guarded(body: number[]) {
  return analyseRoutine(
    Uint8Array.from([
      ...prefix,
      0x83,
      0x7c,
      0x12,
      7,
      0x75,
      body.length + 2,
      ...body,
      0xeb,
      5,
      0xc7,
      0x44,
      12,
      0,
      0,
      ...suffix,
    ]),
    entry,
  );
}
describe("path-equality refinement", () => {
  it("uses a checked input equality in subsequent scalar reads", () => {
    const r = guarded([0x8b, 0x44, 0x12, 0x89, 0x44, 12]);
    expect(r.transitions.some((t) => t.to.kind === "constant" && t.to.value === 7)).toBe(true);
    const selected = r.transitions.find((t) => t.to.kind === "constant" && t.to.value === 7)!;
    expect(selected.evidence.some((i) => i.text.startsWith("cmp"))).toBe(true);
  });
  it("reads a later field assignment instead of reusing its input equality", () => {
    const r = guarded([0xc7, 0x44, 0x12, 9, 0, 0x8b, 0x44, 0x12, 0x89, 0x44, 12]);
    expect(new Set(r.transitions.map((t) => (t.to.kind === "constant" ? t.to.value : null)))).toEqual(new Set([0, 9]));
  });
  it("keeps a copied earlier value separate from a later assignment to its source field", () => {
    const r = guarded([0x8b, 0x44, 0x12, 0xc7, 0x44, 0x12, 9, 0, 0x89, 0x44, 12]);
    expect(new Set(r.transitions.map((t) => (t.to.kind === "constant" ? t.to.value : null)))).toEqual(new Set([0, 7]));
  });
  it("does not apply an old equality to storage read after an untracked alias write", () => {
    const r = guarded([0x8b, 0xf8, 0xc7, 5, 1, 0, 0x8b, 0x44, 0x12, 0x89, 0x44, 12]);
    expect(r.transitions.some((t) => t.confidence === "unresolved")).toBe(true);
    expect(r.transitions.some((t) => t.to.kind === "constant" && t.to.value === 7)).toBe(false);
  });
});
