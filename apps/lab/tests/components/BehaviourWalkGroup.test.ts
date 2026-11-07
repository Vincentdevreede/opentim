import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import type { WalkRow } from "../../src/behaviour-view.ts";
import BehaviourWalkGroup from "../../src/components/sprites/BehaviourWalkGroup.vue";

const row = (start: WalkRow["start"], frames: number[], key: string, variants: string[][] = []): WalkRow => ({
  key,
  trigger: "run",
  start,
  path: { confidence: "inferred", frames, end: "rest", branches: [] },
  confidence: "inferred",
  shared: [`contextCounter == ${key}`],
  variants,
  about: ["If the state-control value is not 0"],
  descriptions: [],
});
const text = async (rows: WalkRow[]) =>
  visibleText(
    await renderToString(
      createSSRApp({ render: () => h(BehaviourWalkGroup, { trigger: "run", rows, frames: [0, 1] }) }),
    ),
  ).trim();

it("lists a few walks of a trigger one a line", async () => {
  const shown = await text([row("reset", [], "a"), row("run-guard", [0, 1], "b")]);
  expect(shown).toBe("run 2 walks placed rests as it is contextCounter == a running 0 → 1 · rests contextCounter == b");
});

it("folds the many input cases of a run, like the jack-in-the-box's 156, by where they start", async () => {
  // 1 placed, 1 created, then 8 frames with 12 rows of which one has two cases, and a row without a first frame.
  const rows = [row("reset", [], "placed"), row("creation", [0], "created")];
  for (let frame = 0; frame < 8; frame++)
    for (let k = 0; k < 12; k++)
      rows.push(row("run-guard", [frame, 18], `${frame}.${k}`, k === 0 ? [["state == 0"], ["state == 1"]] : []));
  rows.push(row("run-guard", [], "any"));
  const shown = await text(rows);
  expect(shown).toBe(
    [
      "run 107 walks 99 paths",
      "placed 1 walk",
      "created from 0 1 walk",
      "running 1 walk",
      ...Array.from({ length: 8 }, (_, frame) => `running from ${frame} 13 walks`),
    ].join(" "),
  );
});

it("puts where a hit needs the part on a line below the trigger's name", async () => {
  const trigger =
    "hit by a teeter-totter, when its positionX is 0 to 12 pixels left of the teeter-totter's right end (positionX + 74)";
  const html = await renderToString(
    createSSRApp({ render: () => h(BehaviourWalkGroup, { trigger, rows: [row("reset", [], "a")], frames: [0, 1] }) }),
  );
  expect(html).toContain(">hit by a teeter-totter</span>");
  expect(html).toContain(
    ">when its positionX is 0 to 12 pixels left of the teeter-totter&#39;s right end (positionX + 74)</span>",
  );
});
