import { describe, expect, it } from "vitest";
import type { GoalStatement } from "../src/read/puzzle-goals.ts";
import { toonsLists } from "../src/run/toons-goal-check.ts";

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
