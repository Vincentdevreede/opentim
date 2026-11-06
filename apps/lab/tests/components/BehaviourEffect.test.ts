import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import type { OtherEffect } from "../../src/behaviour.ts";
import BehaviourEffect from "../../src/components/sprites/BehaviourEffect.vue";

const effect: OtherEffect = {
  confidence: "inferred",
  assumptions: [],
  evidence: [],
  sourceType: 41,
  source: "explosion",
  sets: [{ what: "speed", value: "4096" }],
  when: ["moving list"],
  sourceWhen: [],
  sourceCondition: "state + 1 == 2",
  description: "An explosion that reaches it sets its speed to 4096. Only when it is on the moving list.",
};
const text = async (e: OtherEffect, name = "Explosion") =>
  visibleText(await renderToString(createSSRApp({ render: () => h(BehaviourEffect, { effect: e, name }) }))).trim();

it("shows the other part, what it sets and the value on one line, with a chip for the list", async () => {
  expect(await text(effect)).toBe("Explosion speed 4096 moving list");
});

it("keeps the source's own condition for its tip, not the line", async () => {
  const html = await renderToString(createSSRApp({ render: () => h(BehaviourEffect, { effect, name: "Explosion" }) }));
  expect(html).toContain("When the explosion has: state + 1 == 2");
  expect(html).not.toContain("centre");
  expect(await text({ ...effect, sourceWhen: ["mirrored"], sets: [{ what: "velocity", value: "4096, -4096" }] })).toBe(
    "Explosion velocity 4096, -4096 mirrored moving list",
  );
});

it("says a speed points away from the other part, with how close the tip", async () => {
  const away = { ...effect, sets: [{ what: "speed away", value: "4096" }], awayWithin: 0.22 };
  expect(await text(away)).toBe("Explosion speed away 4096 moving list");
  const html = await renderToString(
    createSSRApp({ render: () => h(BehaviourEffect, { effect: away, name: "Explosion" }) }),
  );
  expect(html).toContain("It points from the explosion&#39;s centre to this part&#39;s, within 0.22°.");
});

it("shows both velocities as a direction on the line and their numbers in the tip", async () => {
  const punch = {
    ...effect,
    source: "jack-in-the-box",
    sourceType: 13,
    sets: [{ what: "", value: "up and to the left" }],
    sourceWhen: ["not mirrored"],
    description:
      "A jack in the box that reaches it sets its velocity up and to the left (velocityX -4096, velocityY -4096).",
  };
  expect(await text(punch, "Jack-in-the-box")).toBe("Jack-in-the-box up and to the left not mirrored moving list");
  const html = await renderToString(
    createSSRApp({ render: () => h(BehaviourEffect, { effect: punch, name: "Jack-in-the-box" }) }),
  );
  expect(html).toContain("(velocityX -4096, velocityY -4096)");
});

it("reads a flag another part sets and the fine position it puts the part on in a few words", async () => {
  const vacuum = {
    ...effect,
    source: "vacuum-cleaner",
    sourceType: 51,
    touch: true as const,
    sets: [
      { what: "out-of-play flag", value: "set" },
      { what: "goal mark 0x0100", value: "set" },
    ],
    when: [],
    sourceWhen: ["stateDelta is not 0"],
  };
  expect(await text(vacuum, "Vacuum cleaner")).toBe(
    "Vacuum cleaner out-of-play flag set goal mark 0x0100 set touching stateDelta is not 0",
  );
  const trampoline = { ...vacuum, sets: [{ what: "fine Y", value: "positionY × 512" }], sourceWhen: [] };
  expect(await text(trampoline, "Trampoline")).toBe("Trampoline fine Y positionY × 512 touching");
});
