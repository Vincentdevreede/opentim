import { describe, expect, it } from "vitest";
import { readGoalRoutines, type GoalStatement } from "../src/read/puzzle-goals.ts";
import type { ToonsMemory } from "../src/read/toons-drawing.ts";
import { checkToonsGoals, toonsLists } from "../src/run/toons-goal-check.ts";

describe("toonsLists", () => {
  it("reads the parts lists from the list head routine: the word it gives for each bit of its mask", () => {
    const dx = { kind: "register", name: "dx" } as const;
    const c = (value: number) => ({ kind: "constant", value }) as const;
    const hasnt = (bit: number) => ({
      op: "==" as const,
      signed: false,
      left: { kind: "binary", op: "&", left: dx, right: c(bit) } as const,
      right: c(0),
    });
    const give = (head: number): GoalStatement => ({
      kind: "set",
      target: { kind: "register", name: "ax" },
      value: { kind: "word", address: c(head) },
    });
    const body: GoalStatement[] = [
      {
        kind: "if",
        test: hasnt(0x2000),
        then: [{ kind: "if", test: hasnt(0x1000), then: [], else: [give(0x49d6)] }],
        else: [give(0x4a89)],
      },
    ];
    expect(toonsLists({ address: 0, segment: 0, offset: 0, body })).toEqual([
      { head: 0x49d6, bit: 0x1000 },
      { head: 0x4a89, bit: 0x2000 },
    ]);
  });
});

describe("checkToonsGoals", () => {
  const DATA = 0x1000;
  const STEPS = 0x500;
  const c = (value: number) => ({ kind: "constant", value }) as const;
  /** A made-up TOONS.EXE with the goal's code at 0x10:0 and the data segment at 0x1000. */
  const check = (code: string, body?: GoalStatement[]) => {
    const memory = new Uint8Array(0x30000);
    memory.set(Buffer.from(code, "hex"), 0x100);
    const toons: ToonsMemory = {
      memory,
      dataSegment: DATA,
      codeSegments: [0],
      resolve: (segment, offset) => ({ segment, offset }),
      fileOffset: (address) => address,
    };
    const routines = body
      ? new Map([[0x100, { address: 0x100, segment: 0x10, offset: 0, body }]])
      : readGoalRoutines(memory, 0x10, 0);
    const goals = [{ puzzle: 0, segment: 0x10, offset: 0, address: 0x100 }];
    return checkToonsGoals(toons, routines, goals, [], STEPS, { trials: 3 })[0]!;
  };

  it("counts a game that stops, not one that runs past its limit, as a difference", () => {
    // The read program runs on; the game's routine is `hlt`.
    const forever: GoalStatement[] = [
      {
        kind: "loop",
        before: [],
        test: { op: "==", signed: false, left: c(0), right: c(0) },
        body: [{ kind: "set", target: { kind: "register", name: "ax" }, value: c(0) }],
      },
    ];
    const result = check("f4", forever);
    expect(result).toMatchObject({ runOn: 0, differ: 3, compared: 0 });
    expect(result.firstDifference).toContain("the game stopped");
  });

  it("says how many trials it compared, none when every one reads a value never set", () => {
    // mov ax, [bp-2]; mov [0x100], ax
    expect(check("558bec8b46fea300015dcb")).toMatchObject({ unset: 3, compared: 0 });
    // mov ax, [0x12]; mov [0x10], ax
    expect(check("558beca11200a310005dcb")).toMatchObject({ differ: 0, compared: 3 });
  });

  it("reads a word at offset 0xffff with its high byte at offset 0, as the processor does", () => {
    // mov ax, [0xffff]; mov [0x10], ax
    expect(check("558beca1ffffa310005dcb")).toMatchObject({ differ: 0, compared: 3 });
  });
});
