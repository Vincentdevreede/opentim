import type { Part } from "@opentim/content";
import { createRenderer, h, nextTick, ref, ssrContextKey, type Component } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import PartDetail from "../../src/components/sprites/PartDetail.vue";
import { AUTO } from "../../src/components/sprites/palettes.ts";

// A renderer without a browser is enough to mount the component and give it another part, as the Parts page does.
const renderer = createRenderer<object, object>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert: () => {},
  remove: () => {},
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null,
  patchProp: () => {},
});

let unmount = () => {};
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

const partOf = (type: number): Part => ({ id: `part-${type}`, type, sheets: [], frames: [] });

it("goes back to the automatic palette for the next part", async () => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  const part = ref(partOf(1));
  const detail: Component = { ...PartDetail, render: () => null };
  const app = renderer.createApp({
    render: () => h(detail, { part: part.value, sheetSprites: () => undefined, galleryPalette: AUTO }),
  });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  unmount = () => app.unmount();
  type Instance = { subTree: { component: { setupState: Record<string, unknown> } } };
  const state = (app as unknown as { _instance: Instance })._instance.subTree.component.setupState;

  state.detailPalette = "TIM.PAL";
  part.value = partOf(2);
  await nextTick();
  expect(state.detailPalette).toBe(AUTO);
});
