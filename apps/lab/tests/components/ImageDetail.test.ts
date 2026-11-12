import { createRenderer, nextTick, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import ImageDetail from "../../src/components/sprites/ImageDetail.vue";
import type { Resource } from "../../src/importer.ts";

// A renderer without a browser is enough to mount the component and change its state as the page would.
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

/** Mounts the detail of an image file and gives the state its template works with. */
function mountDetail() {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  const resource: Resource = {
    name: "A.BMP",
    kind: "sprites",
    group: "sprites",
    archive: "RESOURCE.001",
    offset: 0,
    data: new Uint8Array([0]),
  };
  const app = renderer.createApp(
    { ...ImageDetail, render: () => null },
    {
      resource,
      decoded: { status: "text" },
      galleryPalette: "auto",
    },
  );
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  unmount = () => app.unmount();
  return (app as unknown as { _instance: { setupState: Record<string, unknown> } })._instance.setupState;
}

it("drops the colour highlight when the Colours tab is left", async () => {
  const state = mountDetail();
  state.tab = "colours";
  await nextTick();
  state.highlight = 4;
  state.tab = "details";
  await nextTick();
  expect(state.highlight).toBeUndefined();
});
