import { describe, expect, it } from "vitest";
import { analyseRoutine, binary, type Expression } from "../src/read/behaviour.ts";
const entry = { address: 0, offset: 0, segment: 0 };
const prologue = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6];
const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
function divide(bytes: number[]) {
  return analyseRoutine(Uint8Array.from([...prologue, ...bytes, 0x5e, 0x5d, 0xcb]), entry);
}

describe("static integer division relations", () => {
  it("retains signed remainder and quotient expressions from a sign-extended input", () => {
    const result = divide([0x8b, 0x44, 12, 0x99, 0xbb, 7, 0, 0xf7, 0xfb, 0x89, 0x54, 12, 0x89, 0x44, 0x12]);
    expect(result.transitions[0]!.to).toMatchObject({ kind: "binary", operator: "s%", right: constant(7) });
    expect(result.writes.find((write) => write.offset === 18)!.value).toMatchObject({ kind: "binary", operator: "s/" });
    expect(result.uncertainties).toEqual([]);
    expect(result.transitions[0]!.evidence.some((item) => item.text === "cwd")).toBe(true);
    expect(result.transitions[0]!.evidence.some((item) => item.text === "idiv bx")).toBe(true);
  });

  it("uses truncation toward zero and retains the dividend's remainder sign", () => {
    expect(binary("s/", constant(0xfff6), constant(7))).toEqual(constant(0xffff));
    expect(binary("s%", constant(0xfff6), constant(7))).toEqual(constant(0xfffd));
    expect(binary("s/", constant(10), constant(0xfffd))).toEqual(constant(0xfffd));
    expect(binary("s%", constant(10), constant(0xfffd))).toEqual(constant(1));
  });

  it("supports zero-extended unsigned division without a fabricated high word", () => {
    const result = divide([0x8b, 0x44, 12, 0x33, 0xd2, 0xbb, 7, 0, 0xf7, 0xf3, 0x89, 0x54, 12]);
    expect(result.transitions[0]!.to).toMatchObject({ kind: "binary", operator: "%" });
    expect(result.uncertainties).toEqual([]);
  });

  it.each([
    [[0xb8, 10, 0, 0xbb, 3, 0, 0xf6, 0xf3], 0x0103],
    [[0xb8, 0xf6, 0xff, 0xbb, 3, 0, 0xf6, 0xfb], 0xfffd],
  ])("packs a byte quotient and remainder in their actual AL and AH destinations", (bytes, expected) => {
    const result = divide([...bytes, 0x89, 0x44, 12]);
    expect(result.transitions[0]!.to).toEqual(constant(expected));
  });

  it("stops a definite divide-by-zero path with instruction evidence", () => {
    const result = divide([0xb8, 4, 0, 0x33, 0xd2, 0x33, 0xdb, 0xf7, 0xf3]);
    expect(result.outcomes).toHaveLength(0);
    expect(result.transitions[0]!.to).toMatchObject({
      kind: "unknown",
      reason: expect.stringContaining("divisor is zero"),
    });
    expect(result.uncertainties.join(" ")).toContain("0x");
  });

  it("does not continue normally after a proved byte quotient overflow", () => {
    const result = divide([0xb8, 0xe8, 3, 0xbb, 2, 0, 0xf6, 0xf3]);
    expect(result.outcomes).toHaveLength(0);
    expect(result.transitions[0]!.to).toMatchObject({ kind: "unknown", reason: expect.stringContaining("overflows") });
  });

  it("retains an explicit boundary when the signed -1 divisor can overflow", () => {
    const result = divide([0x8b, 0x44, 12, 0x99, 0xbb, 0xff, 0xff, 0xf7, 0xfb, 0x89, 0x54, 12]);
    expect(result.uncertainties.join(" ")).toContain("Division safety");
    expect(result.transitions.some((transition) => transition.confidence === "unresolved")).toBe(true);
  });
});

describe("static byte multiplication", () => {
  it("multiplies bytes with their sign for imul and without it for mul", () => {
    // mov al,ff; mov bl,2; imul bl (or mul bl); mov [si+0c],ax
    const product = (operation: number) =>
      divide([0xb0, 0xff, 0xb3, 2, 0xf6, operation, 0x89, 0x44, 0x0c]).transitions.map((t) => t.to);
    expect(product(0xeb)).toEqual([constant(0xfffe)]);
    expect(product(0xe3)).toEqual([constant(0x01fe)]);
  });
});
