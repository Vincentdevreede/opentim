import { TIM_PART_WORDS, type PuzzleGoal } from "@opentim/content";
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
        render: () =>
          h(LevelGoal, {
            goal: { status: "done", goal: g },
            areaNumbers: new Map(),
            // TIM.EXE's words by place, as the levels page gives them for TIM 1 and Even More.
            record: { fields: [], words: TIM_PART_WORDS },
            ...props,
          }),
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

it("says other flag tests by their names, and writes the goal routine in the same words", async () => {
  const g = goal(["drawingFlags hasn't the bits 0x2000"], [{ word: "word 0x5068", becomes: ["0"] }]);
  (g as { lines: string[] }).lines = [
    "for each part on the moving list:",
    "  if part.listFlags has the bits 0x8000:",
    "    if part.0xa hasn't the bits 0x200:",
    "      word 0x5068 += 1",
    "  if ax ≠ part.0x26:",
    "  if word 0x506c = 4:",
  ];
  const page = await text(g, { markSetters: new Map([["31:512", ["cat"]]]) });
  expect(page).toContain("in play");
  expect(page).toContain("if part placed by the puzzle:");
  expect(page).toContain("if part not marked by cat:");
  expect(page).toContain("its word 1 += 1");
  expect(page).toContain("if its word 2 = 4:");
  expect(page).toContain("if ax ≠ part.olderX:");
  expect(page).not.toContain("0x");
});

it("leaves the flag bits and fields of a game without TIM.EXE's words as they are", async () => {
  const g = goal(["field 0xa has the bits 0x200", "drawingFlags hasn't the bits 0x2000"]);
  (g as { lines: string[] }).lines = ["  if ax ≠ part.0x26:"];
  const page = await text(g, { markSetters: new Map([["31:512", ["cat"]]]), record: { fields: [] } });
  expect(page).toContain("field 0xa has the bits 0x200");
  expect(page).toContain("the bits 0x2000");
  expect(page).not.toContain("in play");
  expect(page).toContain("if ax ≠ part.0x26:");
  expect(page).not.toContain("olderX");
});

it("calls a word the routine reads with an index its table, apart from its single words", async () => {
  const g = goal([], [{ word: "word 0x506c", becomes: ["0"] }]);
  (g as { lines: string[] }).lines = ["        word 0x5068[bx] = 1", "  if word 0x5068[bx] = 0:", "  word 0x506c += 1"];
  const page = await text(g);
  expect(page).toContain("its table[bx] = 1");
  expect(page).toContain("if its table[bx] = 0:");
  expect(page).toContain("its count += 1");
  expect(page).not.toContain("0x");
});

it("says in a chip that a Toons part depends on the ropes, which the player can take off and tie elsewhere", async () => {
  const g = goal(["rope1 ≠ 0"]);
  const condition = g.summary.ways[0]![0]!;
  const html = await renderToString(
    createSSRApp({
      render: () =>
        h(LevelGoal, {
          goal: { status: "done", goal: g },
          areaNumbers: new Map(),
          atStart: new Map([[condition, { parts: [1], player: "ropes" as const }]]),
        }),
    }),
  );
  expect(visibleText(html)).toContain("ropes");
  expect(html).toContain("a rope between two parts on the board stays tied");
  expect(html).toContain("take either end off and tie it elsewhere, or put the rope in the bin");
});
