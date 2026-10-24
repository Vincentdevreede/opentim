import { createRenderer, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { resources, selected } from "../../../src/library.ts";
import ImportOverview from "../../../src/components/import/ImportOverview.vue";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

// A renderer without a browser is enough to mount the component and exercise its
// window keyboard listener without replacing its shortcut handling with a mock.
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

class Element {
  constructor(
    readonly tag = "div",
    readonly isContentEditable = false,
  ) {}
  closest() {
    return ["input", "textarea", "select"].includes(this.tag) ? this : null;
  }
}
class Button extends Element {}
let unmount = () => {};
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resources.value = [];
});

it("leaves editing keys alone while preserving Enter navigation outside editors", () => {
  const listeners = new Map<string, (e: KeyboardEvent) => void>();
  vi.stubGlobal("window", {
    addEventListener: (name: string, handler: (e: KeyboardEvent) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("HTMLButtonElement", Button);
  resources.value = ["A.BMP", "B.BMP"].map((name) => ({
    name,
    kind: "sprites",
    group: "sprites",
    archive: "RESOURCE.001",
    offset: 0,
    data: new Uint8Array([0]),
  }));
  selected.value = "A.BMP";
  const app = renderer.createApp({ ...ImportOverview, render: () => null });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  unmount = () => app.unmount();
  const handler = listeners.get("keydown")!;
  for (const target of [
    new Element("input"),
    new Element("textarea"),
    new Element("select"),
    new Element("div", true),
  ]) {
    for (const key of ["Enter", "ArrowDown", "ArrowUp", "/"]) {
      const preventDefault = vi.fn();
      handler({ key, target, preventDefault } as unknown as KeyboardEvent);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(selected.value).toBe("A.BMP");
    }
  }
  handler({ key: "Enter", target: new Element(), preventDefault: vi.fn() } as unknown as KeyboardEvent);
  expect(push).toHaveBeenCalledWith("/files");
});
