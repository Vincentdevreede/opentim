import { createRenderer, defineComponent, ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { usePlayer, useSpriteKeys } from "../src/components/sprites/player.ts";

// A renderer without a browser is enough to mount a component that listens for keys on the window.
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

/** An element that only knows its own tag, enough for `closest` with a list of tags. */
class Element {
  constructor(readonly tag: string) {}
  closest(selectors: string) {
    return selectors.split(",").some((s) => s.trim() === this.tag) ? this : null;
  }
}

let unmount = () => {};
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

it("leaves Space to a focused button or disclosure, and plays otherwise", () => {
  const listeners = new Map<string, (e: KeyboardEvent) => void>();
  vi.stubGlobal("window", {
    addEventListener: (name: string, handler: (e: KeyboardEvent) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  vi.stubGlobal("HTMLElement", Element);
  let player!: ReturnType<typeof usePlayer>;
  const app = renderer.createApp(
    defineComponent({
      setup() {
        const count = ref(3);
        player = usePlayer(count);
        useSpriteKeys(player, count, ref(1));
        return () => null;
      },
    }),
  );
  app.mount({});
  unmount = () => app.unmount();
  const handler = listeners.get("keydown")!;

  for (const tag of ["button", "summary"]) {
    const preventDefault = vi.fn();
    handler({ key: " ", target: new Element(tag), preventDefault } as unknown as KeyboardEvent);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(player.playing.value).toBe(false);
  }
  const preventDefault = vi.fn();
  handler({ key: " ", target: new Element("div"), preventDefault } as unknown as KeyboardEvent);
  expect(preventDefault).toHaveBeenCalled();
  expect(player.playing.value).toBe(true);
});
