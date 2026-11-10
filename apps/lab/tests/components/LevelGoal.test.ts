import type { PuzzleGoal } from "@opentim/content";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import LevelGoal from "../../src/components/levels/LevelGoal.vue";

const goal = (tests: string[], remembered: PuzzleGoal["summary"]["remembered"] = []): PuzzleGoal =>
  ({
    puzzle: 70,
    lines: [],
    summary: {
      ways: [[{ kind: "every", types: [{ type: 31, name: "mouse" }], lists: "the moving list", tests }]],
      remembered,
    },
  }) as unknown as PuzzleGoal;

const text = async (g: PuzzleGoal, props: Record<string, unknown> = {}) =>
  visibleText(
    await renderToString(
      createSSRApp({
        render: () => h(LevelGoal, { goal: { status: "done", goal: g }, areaNumbers: new Map(), ...props }),
      }),
    ),
  );

it("says a number of steps as the least time it takes", async () => {
  const page = await text(goal(["the second step count ≥ 308"]), { stepMilliseconds: 110 });
  expect(page).toContain("the second step count ≥ 308 (34 s)");
  expect(await text(goal(["the step count ≥ 20"]), { stepMilliseconds: 110 })).toContain("the step count ≥ 20 (2.2 s)");
});

it("says a goal mark by the parts that set it, and the goal's own word as its count", async () => {
  const page = await text(
    goal(
      ["field 0xa has the bits 0x200"],
      [{ word: "word 0x5068", becomes: ["word 0x5068 from the step before + 1"] }],
    ),
    { markSetters: new Map([["31:512", ["cat", "alligator"]]]) },
  );
  expect(page).toContain("marked by cat or alligator");
  expect(page).toContain("its count from the step before + 1");
  expect(page).not.toContain("0x");
});
