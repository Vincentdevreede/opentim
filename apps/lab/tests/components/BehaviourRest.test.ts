import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import type { RestSummary } from "../../src/behaviour.ts";
import BehaviourRest from "../../src/components/sprites/BehaviourRest.vue";

const finding = { confidence: "inferred" as const, assumptions: [], evidence: [] };
const rest: RestSummary = {
  ...finding,
  status: "saved",
  frames: [0, 1, 2],
  description: "The reset keeps the frame the level saved: 0, 1 or 2.",
  resting: [
    { ...finding, state: 0, conditions: [], ways: 1 },
    { ...finding, state: 1, walks: 2, conditions: ["stateDelta != 0 and 0 == 0", "stateDelta == 0"], ways: 2 },
    { ...finding, state: 2, walks: 1, conditions: [], ways: 1 },
  ],
};
const html = (r: RestSummary, frames = [0, 1, 2]) =>
  renderToString(createSSRApp({ render: () => h(BehaviourRest, { rest: r, frames }) }));
const text = async (r: RestSummary) => visibleText(await html(r)).trim();

it("says the reset keeps the frame the level saved, with the frames it can be, and where the part rests", async () => {
  expect(await text(rest)).toBe("placed keeps the saved frame · 0–2 rests on 0–2");
  expect(await html(rest)).toContain("The level gives the frame.");
});

it("says a frame set from the plugs, a known frame and an unresolved reset in a few words", async () => {
  expect(await text({ ...rest, status: "sockets", frames: [0, 4, 8, 12], resting: [] })).toBe(
    "placed from its plugs · 0, 4, 8, 12",
  );
  const known = { ...rest, status: "known" as const, state: 0, frames: undefined, resting: [] };
  expect(await text(known)).toBe("placed frame 0");
  expect(await html(known)).toContain('title="Show frame 0"');
  expect(await text({ ...rest, status: "unresolved", frames: undefined, resting: [] })).toBe("placed unresolved");
});

it("tells in the tip how many walks end on each resting frame, and where a run keeps it", async () => {
  const page = await html(rest);
  expect(page).toContain("0: a run keeps it");
  expect(page).toContain("1: 2 walks end here");
  expect(page).toContain("2: 1 walk ends here");
});

it("shows frame -1 of a part like the wood incline as -1", async () => {
  const incline = {
    ...rest,
    frames: [-1, 0, 1, 2, 3],
    resting: [{ ...finding, state: -1, walks: 1, conditions: [], ways: 1 }],
  };
  expect(await text(incline)).toBe("placed keeps the saved frame · -1–3 rests on -1");
});

it("says in the tip when a way to a resting frame has no test, so the part rests there always", async () => {
  const always = {
    ...rest,
    resting: [{ ...finding, state: 0, walks: 158, conditions: [], always: true as const, ways: 158 }],
  };
  expect(await html(always)).toContain("0: 158 walks end here, one way with no test");
});
