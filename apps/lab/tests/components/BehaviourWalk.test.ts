import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import type { WalkRow } from "../../src/behaviour-view.ts";
import BehaviourWalk from "../../src/components/sprites/BehaviourWalk.vue";

const row: WalkRow = {
  key: "run",
  trigger: "run",
  start: "run-guard",
  path: { confidence: "inferred", frames: [0, 1, 2, 9], end: "loop", loopFrom: 1, branches: [] },
  confidence: "inferred",
  shared: ["stateDelta != 0"],
  variants: [],
  about: ["If the state-control value is not 0"],
  descriptions: [],
};
const text = async (r: WalkRow, frames = [0, 1, 2]) =>
  visibleText(await renderToString(createSSRApp({ render: () => h(BehaviourWalk, { row: r, frames }) })));

it("shows where a walk starts, its frames, how it ends and the condition it needs", async () => {
  const html = await renderToString(createSSRApp({ render: () => h(BehaviourWalk, { row, frames: [0, 1, 2] }) }));
  expect(await text(row)).toContain("running 0 → 1 → 2 → 9 · loops to 1");
  expect(html).toContain("stateDelta != 0");
  // Only the part's own frames can be shown, so 9 is no button.
  expect(html.match(/title="Show frame/g)).toHaveLength(3);
});

it("counts the cases that follow the same path", async () => {
  expect(await text({ ...row, variants: [["state == 0"], ["state == 1"]] })).toContain("2×");
});
