import { describe, expect, it } from "vitest";
import { analyseRoutine } from "../src/read/behaviour.ts";

const entry = { address: 0, segment: 0, offset: 0 };
const analyse = (bytes: number[], stateCount = 4) => analyseRoutine(Uint8Array.from(bytes), entry, { stateCount });
const prologue = [0x55, 0x8b, 0xec, 0x56, 0x8b, 0x76, 0x06];
const epilogue = [0x5e, 0x5d, 0xcb];

describe("static behaviour", () => {
  it("finds the stack object pointer and a state write gated by a comparison", () => {
    const routine = analyse([
      ...prologue,
      0x83,
      0x7c,
      0x0c,
      0x02,
      0x75,
      0x05,
      0xc7,
      0x44,
      0x0c,
      0x03,
      0x00,
      ...epilogue,
    ]);
    expect(routine.objectPointer.registers).toContain("si");
    const write = routine.writes.find((w) => w.object === "part" && w.offset === 0x0c)!;
    expect(write.value).toEqual({ kind: "constant", value: 3, width: 16 });
    expect(write.condition).toMatchObject({
      kind: "and",
      terms: [
        {
          kind: "compare",
          operator: "==",
          left: { kind: "field", object: "part", offset: 0x0c },
          right: { kind: "constant", value: 2 },
        },
      ],
    });
    const transition = routine.transitions.find((t) => t.to.kind === "constant")!;
    expect(transition.from).toEqual([2]);
    expect(transition.evidence.map((e) => e.address)).toEqual(expect.arrayContaining([7, 11, 13]));
  });

  it("composes an increment and a wrap before returning, without an intermediate visible state", () => {
    const routine = analyse([
      ...prologue,
      0xff,
      0x44,
      0x0c,
      0x83,
      0x7c,
      0x0c,
      0x04,
      0x7c,
      0x05,
      0xc7,
      0x44,
      0x0c,
      0x00,
      0x00,
      ...epilogue,
    ]);
    const wrap = routine.transitions.find((t) => t.to.kind === "constant" && t.to.value === 0)!;
    expect(wrap.from).toEqual([3]);
    expect(routine.writes.filter((w) => w.offset === 0x0c)).toHaveLength(2);
    const advance = routine.transitions.find((t) => t.to.kind === "binary")!;
    expect(advance.from).toEqual([0, 1, 2]);
  });

  it("retains a counter expression and the branch that gates the final state", () => {
    const routine = analyse([
      ...prologue,
      0xff,
      0x84,
      0x96,
      0x00,
      0x83,
      0xbc,
      0x96,
      0x00,
      0x04,
      0x7c,
      0x05,
      0xc7,
      0x44,
      0x0c,
      0x01,
      0x00,
      ...epilogue,
    ]);
    const write = routine.writes.find((w) => w.offset === 0x0c)!;
    expect(write.condition).toMatchObject({
      kind: "and",
      terms: [
        {
          kind: "compare",
          operator: ">=",
          left: { kind: "binary", operator: "+", left: { kind: "field", offset: 0x96 }, right: { value: 1 } },
          right: { value: 4 },
        },
      ],
    });
  });

  it("marks a write uncertain after the object pointer is overwritten", () => {
    const routine = analyse([...prologue, 0x8b, 0xf0, 0xc7, 0x44, 0x0c, 0x01, 0x00, ...epilogue]);
    expect(routine.status).toBe("partial");
    expect(routine.writes.find((w) => w.offset === 0x0c)).toMatchObject({
      object: "unknown",
      confidence: "unresolved",
    });
    expect(routine.uncertainties.some((s) => s.includes("pointer is lost"))).toBe(true);
  });

  it("stops on unknown bytes instead of inventing instruction lengths", () => {
    const routine = analyse([...prologue, 0x66, 0xc7, 0x44, 0x0c, 0x01, 0x00, ...epilogue]);
    expect(routine.status).toBe("error");
    expect(routine.writes).toHaveLength(0);
    expect(routine.uncertainties.join(" ")).toContain("0x0007");
  });

  it("does not run or unroll a loop", () => {
    const routine = analyse([...prologue, 0xff, 0x84, 0x96, 0x00, 0xeb, 0xfa]);
    expect(routine.status).toBe("partial");
    expect(routine.uncertainties.join(" ")).toContain("Back edge");
    expect(routine.writes).toHaveLength(1);
  });
});
