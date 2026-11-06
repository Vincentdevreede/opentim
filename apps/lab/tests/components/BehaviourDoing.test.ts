import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import type { Doing } from "../../src/behaviour.ts";
import BehaviourDoing from "../../src/components/sprites/BehaviourDoing.vue";

const doing: Doing = {
  confidence: "inferred",
  assumptions: [],
  evidence: [],
  on: "created",
  description:
    "Creates a bullet (type 20) at positionX = its positionX + 36 and positionY = its positionY + 3, moving at velocityX = 12288 and the bullet's starting velocityY (each kept within the bullet's speed limit).",
  ways: 1,
};
const html = (d: Doing) => renderToString(createSSRApp({ render: () => h(BehaviourDoing, { doing: d }) }));
/** The text with the apostrophes the server writes as an entity put back. */
const text = async (d: Doing) =>
  visibleText(await html(d))
    .trim()
    .replaceAll("&#39;", "'");

it("starts a created part's line with what it creates and how it moves", async () => {
  expect(await text(doing)).toBe(
    "A bullet (type 20) at positionX = its positionX + 36 and positionY = its positionY + 3, moving at velocityX = 12288 and the bullet's starting velocityY (each kept within the bullet's speed limit).",
  );
  expect(await html(doing)).toContain("line-clamp-2");
});

it("keeps the sentence of what it does to other parts whole, and counts the ways that give it", async () => {
  const goal = {
    ...doing,
    on: "others" as const,
    description:
      "Sets another part's goal mark 0x0200 in field 0x0a (no part's code reads it, only the puzzle goal checks, which end a puzzle when every part of one type has its mark).",
    ways: 3,
  };
  expect(await text(goal)).toBe(`${goal.description} 3×`);
  expect(await html(goal)).toContain("3 ways through its routines, inferred.");
});
