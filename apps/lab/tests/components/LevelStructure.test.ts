import type { Level, LevelPart, LoadedHeader } from "@opentim/content";
import { LOADED_HEADERS, EVEN_MORE_FLOPPY_EXE } from "@opentim/content";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import { visibleText } from "../visible-text.ts";
import LevelStructure from "../../src/components/levels/LevelStructure.vue";

const part = (index: number, type: number, links: [number | null, number | null] = [null, null]): LevelPart => ({
  index,
  group: "static",
  type,
  flags: [0, 0, 0],
  state: [0, 0],
  size: { width: 32, height: 32 },
  baseSize: { width: 30, height: 32 },
  position: { x: 10 * index, y: 20 },
  extra: 0,
  belt: { at: { x: 0, y: 0 }, width: 0 },
  ropes: [{ at: { x: 0, y: 0 } }, { at: { x: 0, y: 0 } }],
  links,
  plugs: [null, null],
  offset: 0,
  length: 0,
  fields: [],
});

const level = (parts: LevelPart[], layout: Level["layout"] = "tim"): Level => ({
  layout,
  kind: "puzzle",
  magic: 0xacee,
  version: 0x105,
  airPressure: 67,
  gravity: 272,
  music: 1000,
  parts,
  fields: [
    { key: "gravity", offset: 4, size: 2, value: 272 },
    { key: "scroll.x", offset: 6, size: 2, value: -8 },
    { key: "binFlag", offset: 8, size: 2, value: 0 },
  ],
  length: 0,
});

const CHECKED = LOADED_HEADERS.get(EVEN_MORE_FLOPPY_EXE);
const html = (l: Level, selected?: number, header: LoadedHeader | undefined = CHECKED) =>
  renderToString(createSSRApp({ render: () => h(LevelStructure, { level: l, name: "L1.LEV", selected, header }) }));

it("tags each field of a part with the record words the loader keeps it in", async () => {
  const page = await html(level([part(0, 9, [1, null]), part(1, 2)]), 0);
  const text = visibleText(page);
  expect(text).toContain("base size 30 × 32 → 0x50 0x52");
  expect(text).toContain("position 0, 20 → 0x8C 0x8E");
  expect(text).toContain("links #1, none → 0x5A 0x5C");
  expect(page).toContain("savedPositionX, savedPositionY");
});

it("says a gear's links to gears aren't kept", async () => {
  const text = visibleText(await html(level([part(0, 14, [1, null]), part(1, 14)]), 0));
  expect(text).toContain("links #1, none not kept");
});

it("shows the header's words for a checked build, and the scroll limits only as a guess", async () => {
  const page = await html(level([]));
  expect(visibleText(page)).toContain("gravity 272 → [0x4CB9]");
  expect(page).toContain("text-hypothesis");
  expect(page).toContain("bin switch");
  const unchecked = { build: "", words: {}, byOrder: [] };
  expect(visibleText(await html(level([]), undefined, unchecked))).not.toContain("→");
});

it("leaves the tags out for Toons, whose loader isn't read", async () => {
  expect(visibleText(await html(level([part(0, 9)], "toons"), 0))).not.toContain("→");
});
