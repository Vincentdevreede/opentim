import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
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
  (await renderToString(createSSRApp({ render: () => h(BehaviourEffect, { effect: e, name }) })))
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
