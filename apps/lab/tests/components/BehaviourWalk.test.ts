import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import type { BehaviourDescription, BehaviourReport, Expression, Predicate } from "@opentim/content";
import { summariseWalks } from "../../src/behaviour.ts";
import { walkGroups, type WalkRow } from "../../src/behaviour-view.ts";
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

it("reads a rope walk's condition by the names of what the rope code passes, with their raw form in the tip", async () => {
  const finding = { confidence: "inferred" as const, assumptions: [], evidence: [] };
  const word = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
  const argument = (offset: number): Expression => ({ kind: "field", object: "argument", offset, width: 16 });
  const masked: Expression = {
    kind: "binary",
    operator: "&",
    left: { kind: "binary", operator: "&", left: argument(0x0c), right: word(0x8007), width: 16 },
    right: word(0x7fff),
    width: 16,
  };
  const asked: Expression = {
    kind: "field",
    object:
      'pointer loaded from table 0x2fe1+0x66 indexed by {"kind":"field","object":"address of part","offset":0,"width":16}',
    offset: 0x0e,
    width: 16,
  };
  const condition: Predicate = {
    kind: "and",
    terms: [
      { kind: "compare", operator: "==", left: masked, right: word(4), signed: false },
      { kind: "compare", operator: "==", left: asked, right: word(0), signed: false },
      {
        kind: "compare",
        operator: "!=",
        left: { kind: "field", object: "part", offset: 0x36, width: 16 },
        right: word(0xd000),
        signed: false,
      },
    ],
  };
  const walk = { ...finding, status: "rest", states: [], frames: [], runCalls: 0, fields: [], timingReason: "" };
  const report = {
    layout: { fields: [{ offset: 0x36, name: "velocityX", ...finding }] },
    parts: [{ type: 3, routines: [] }],
  } as unknown as BehaviourReport;
  const description = {
    parts: [
      {
        type: 3,
        animations: [
          {
            ...finding,
            id: "rope",
            initial: "documented-rest",
            prerequisites: [],
            inputCondition: condition,
            trigger: { ...finding, kind: "callback", name: "rope callback candidate", routine: 0x1d52d, writes: [] },
            walk: { ...walk, frames: [{ ...finding, state: 1, frame: 1, atRun: 0, runCalls: 0 }] },
          },
        ],
      },
    ],
  } as unknown as BehaviourDescription;
  const [group] = walkGroups(summariseWalks(report, description)[3]!);
  const html = await renderToString(
    createSSRApp({ render: () => h(BehaviourWalk, { row: group!.rows[0]!, frames: [0, 1, 2] }) }),
  );
  const line = visibleText(html);
  expect(line).toContain("pull kind 4 and askedRope+0x0e == 0 and velocityX != -12288");
  expect(line).not.toContain("argument");
  expect(line).not.toContain("table");
  expect(html).toContain("pull kind is ropeKind, argument+0x0c: 1, 2 or 4 as the rope code works it out (0x7996)");
  expect(html).toContain("askedRope is [table …+0x66[…]]");
});
