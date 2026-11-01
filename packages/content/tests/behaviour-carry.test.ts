import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
const entry = { address: 0, segment: 0, offset: 0 };
const prologue = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6];
function analyse(bytes: number[]) {
  return analyseRoutine(Uint8Array.from([...prologue, ...bytes, 0x5e, 0x5d, 0xcb]), entry);
}

describe("carry relations in static arithmetic", () => {
  it("carries from a low-word addition into the high word and keeps the producer evidence", () => {
    const r = analyse([0xba, 0xff, 0xff, 0x83, 0xc2, 1, 0xb8, 5, 0, 0x15, 0, 0, 0x89, 0x44, 12]);
    expect(r.transitions[0]!.to).toMatchObject({ kind: "constant", value: 6 });
    expect(r.transitions[0]!.evidence.some((i) => i.text === "add dx, 0x0001")).toBe(true);
    expect(r.uncertainties).toEqual([]);
  });
  it("retains a symbolic carry without treating an input field as zero", () => {
    const r = analyse([0x8b, 0x54, 0x36, 0x03, 0x54, 0x36, 0x8b, 0x44, 12, 0x15, 0, 0, 0x89, 0x44, 12]);
    expect(r.transitions[0]!.to).toMatchObject({ kind: "binary", operator: "+" });
    expect(JSON.stringify(r.transitions[0]!.to)).toContain('"offset":54');
    expect(r.uncertainties).toEqual([]);
  });
  it("propagates a subtraction borrow through SBB", () => {
    const r = analyse([0x33, 0xd2, 0x83, 0xea, 1, 0xb8, 5, 0, 0x1d, 0, 0, 0x89, 0x44, 12]);
    expect(r.transitions[0]!.to).toMatchObject({ kind: "constant", value: 4 });
  });
  it.each([
    [0xf9, 0x40],
    [0xf9, 0x48],
    [0xf8, 0xf5],
  ])("preserves or complements CF independently of other flags", (...bytes) => {
    const r = analyse([0xb8, 5, 0, ...bytes, 0x15, 0, 0, 0x89, 0x44, 12]);
    const expected = bytes[1] === 0x40 ? 7 : bytes[1] === 0x48 ? 5 : 6;
    expect(r.transitions[0]!.to).toMatchObject({ kind: "constant", value: expected });
  });
  it("CLC overrides a prior compare's carry without changing its zero flag", () => {
    const r = analyse([0x33, 0xc0, 0x83, 0xf8, 1, 0xf8, 0x72, 5, 0xc7, 0x44, 12, 3, 0, 0x89, 0x44, 0x12]);
    expect(r.transitions).toHaveLength(1);
    expect(r.transitions.every((t) => t.to.kind === "constant" && t.to.value === 3)).toBe(true);
  });
  it("does not reuse a compare for a branch combining changed carry and old zero flags", () => {
    const r = analyse([0xb8, 2, 0, 0x83, 0xf8, 1, 0xf9, 0x77, 5, 0xc7, 0x44, 12, 3, 0]);
    expect(r.transitions.some((t) => JSON.stringify(t.condition).includes("separately changed carry"))).toBe(true);
  });
  it("keeps an unestablished incoming carry unresolved", () => {
    const r = analyse([0xb8, 5, 0, 0x15, 0, 0, 0x89, 0x44, 12]);
    expect(r.transitions[0]!.confidence).toBe("unresolved");
    expect(JSON.stringify(r.transitions[0]!.to)).toContain("Carry reaching");
  });
});
