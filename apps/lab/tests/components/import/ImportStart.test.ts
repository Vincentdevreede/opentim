import { createRenderer, ssrContextKey, type Component } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { staging, type Staging } from "../../../src/library.ts";
import ImportStart from "../../../src/components/import/ImportStart.vue";

// A renderer without a browser is enough to mount the component and press its buttons through their handlers.
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
  staging.value = undefined;
});

it("offers the catalog entry to copy by hand when the browser has no clipboard", async () => {
  vi.stubGlobal("navigator", {});
  staging.value = { files: [] } as unknown as Staging;
  const start: Component = { ...ImportStart, render: () => null };
  const app = renderer.createApp(start);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  unmount = () => app.unmount();
  const state = (app as unknown as { _instance: { setupState: Record<string, unknown> } })._instance.setupState;

  await (state.copyEntry as () => Promise<void>)();
  expect(state.copied).toBe(false);
  expect(state.copyFailed).toBe(true);
});
