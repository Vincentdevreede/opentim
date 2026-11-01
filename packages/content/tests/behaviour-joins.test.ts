import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";
const entry = { address: 0, segment: 0, offset: 0 },
  prefix = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 6],
  suffix = [0x5e, 0x5d, 0xcb];
const diamond = (left: number[], right: number[], offset = 0x12) => [
  0x83,
  0x7c,
  offset,
  0,
  0x74,
  left.length + 2,
  ...left,
  0xeb,
  right.length,
  ...right,
];
describe("complementary control-flow joins", () => {
  it("collapses irrelevant branch choices before their shared continuation without increasing the budget", () => {
    const bytes = [...prefix];
    for (let n = 0; n < 10; n++) bytes.push(...diamond([0xb8, 1, 0], [0xb8, 2, 0], 0x12 + n * 2), 0xb8, 3, 0);
    bytes.push(0xc7, 0x44, 12, 5, 0, ...suffix);
    const result = analyseRoutine(Uint8Array.from(bytes), entry, { maxVisits: 300 });
    expect(result.controlFlowJoins).toHaveLength(10);
    expect(result.uncertainties).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]!.condition).toEqual({ kind: "true" });
    expect(result.transitions[0]!.to).toMatchObject({ kind: "constant", value: 5 });
    expect(result.controlFlowJoins!.every((join) => join.evidence.some((i) => i.text.startsWith("jmp")))).toBe(true);
  });
  it("retains alternatives when the selected register is still used", () => {
    const result = analyseRoutine(
      Uint8Array.from([...prefix, ...diamond([0xb8, 1, 0], [0xb8, 2, 0]), 0x89, 0x44, 12, ...suffix]),
      entry,
    );
    expect(result.controlFlowJoins).toHaveLength(0);
    expect(new Set(result.transitions.map((t) => (t.to.kind === "constant" ? t.to.value : null)))).toEqual(
      new Set([1, 2]),
    );
  });
  it("keeps writes to other part fields even when both paths choose the same frame", () => {
    const result = analyseRoutine(
      Uint8Array.from([
        ...prefix,
        ...diamond([0xc7, 0x84, 0x96, 0, 1, 0], [0xc7, 0x84, 0x96, 0, 2, 0]),
        0xc7,
        0x44,
        12,
        3,
        0,
        ...suffix,
      ]),
      entry,
    );
    expect(result.controlFlowJoins).toHaveLength(0);
    expect(result.outcomes).toHaveLength(2);
  });
  it("does not treat a byte assignment as killing the other byte of a live word", () => {
    const result = analyseRoutine(
      Uint8Array.from([
        ...prefix,
        ...diamond([0xb8, 0xff, 0x10], [0xb8, 0xff, 0x20]),
        0xb0,
        0,
        0x89,
        0x44,
        12,
        ...suffix,
      ]),
      entry,
    );
    expect(result.controlFlowJoins).toHaveLength(0);
    expect(new Set(result.transitions.map((t) => (t.to.kind === "constant" ? t.to.value : null)))).toEqual(
      new Set([0x1000, 0x2000]),
    );
  });
  it("keeps live byte aliases when their word has no established high byte", () => {
    const result = analyseRoutine(
      Uint8Array.from([...prefix, ...diamond([0xb0, 1], [0xb0, 2]), 0xb4, 0, 0x89, 0x44, 12, ...suffix]),
      entry,
    );
    expect(result.controlFlowJoins).toHaveLength(0);
    expect(new Set(result.transitions.map((t) => (t.to.kind === "constant" ? t.to.value : null)))).toEqual(
      new Set([1, 2]),
    );
  });
});

describe("return paths near the analysis limit", () => {
  it("finishes a queued short path without increasing the visit budget for its expanding sibling", () => {
    const bytes = [0x55, 0x8b, 0xec, 0x8b, 0x76, 6, 0x83, 0x7c, 0x12, 0, 0x74, 0];
    const branch = bytes.length - 1;
    for (let n = 0; n < 10; n++) bytes.push(0x83, 0x7c, 0x30 + n * 2, 0, 0x74, 5, 0xc7, 0x44, 0x50 + n * 2, 1, 0);
    bytes.push(0xc7, 0x44, 12, 2, 0, 0xeb, 5);
    const cheap = bytes.length;
    bytes.push(0xc7, 0x44, 12, 7, 0, 0x5d, 0xcb);
    bytes[branch] = cheap - branch - 1;
    const image = new Uint8Array(bytes);
    const routine = analyseRoutine(image, { address: 0, segment: 0, offset: 0 }, { maxVisits: 60, stateCount: 8 });
    expect(routine.transitions).toContainEqual(
      expect.objectContaining({ to: { kind: "constant", value: 7, width: 16 }, confidence: "inferred" }),
    );
    expect(routine.uncertainties.some((reason) => reason.includes("budget (60)"))).toBe(true);
    expect(routine.returnPathsComplete).toBe(false);
  });
});
