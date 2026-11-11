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

it("tags each field of a part with the name of the record word the loader keeps it in", async () => {
  const page = await html(level([part(0, 9, [1, null]), part(1, 2)]), 0);
  const text = visibleText(page);
  expect(text).toContain("base size 30 × 32 → baseWidth/Height");
  expect(text).toContain("position 0, 20 → savedPositionX/Y");
  expect(text).toContain("links #1, none → link0/1");
  // The offsets are in the tip, and a word without a name reads "kept".
  expect(page).toContain("In the part record at 0x8C 0x8E");
  expect(text).toContain("size 32 × 32 kept");
});

it("says a gear's links to gears aren't kept", async () => {
  const text = visibleText(await html(level([part(0, 14, [1, null]), part(1, 14)]), 0));
  expect(text).toContain("links #1, none not kept");
});

it("says the header's numbers are kept for a checked build, with the word in the tip, and the scroll limits as a guess", async () => {
  const page = await html(level([]));
  expect(visibleText(page)).toContain("gravity 272 kept");
  expect(page).toContain("in the word 0x4CB9");
  expect(visibleText(page)).toContain("scroll.x -8 scroll kept?");
  expect(page).toContain("bin switch");
  const unchecked = { build: "", words: {}, byOrder: [] };
  expect(visibleText(await html(level([]), undefined, unchecked))).not.toContain("kept");
});

it("says a part's flags in words, with how many bits aren't known and the stored words in the tip", async () => {
  const flagged = { ...part(0, 9), flags: [0x1040, 0x0030, 0x0008] };
  const page = await html(level([flagged]), 0);
  expect(visibleText(page)).toContain(
    "flags drawn as tiles · on the moving list · mirrored · upside down 1 bit not known",
  );
  expect(page).toContain('title="0x1040 0x0030 0x0008"');
});

it("leaves the tags out for Toons, whose loader isn't read", async () => {
  expect(visibleText(await html(level([part(0, 9)], "toons"), 0))).not.toContain("→");
});

it("keeps a Toons part's flags as the stored words, since the meanings are TIM's", async () => {
  const flagged = { ...part(0, 9), flags: [0x1040, 0x0030, 0x0008] };
  const text = visibleText(await html(level([flagged], "toons"), 0));
  expect(text).toContain("flags 0x1040 0x0030 0x0008");
  expect(text).not.toContain("mirrored");
});
