import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadLibrary } from "../src/storage.ts";

/** A folder of the private file system with only the calls the Lab makes on the root. */
function folder(names: string[]) {
  const entries = new Map(names.map((name) => [name, { kind: "directory" as const }]));
  return {
    names: () => [...entries.keys()],
    async *entries() {
      yield* [...entries];
    },
    getDirectoryHandle: async (name: string) => {
      if (!entries.has(name)) throw new DOMException("missing", "NotFoundError");
      return { async *entries() {} };
    },
    removeEntry: async (name: string) => void entries.delete(name),
  };
}

const locks = navigator.locks;
let root: ReturnType<typeof folder>;

beforeEach(() => {
  root = folder(["library", "library-done", "library-cut-off", "other"]);
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => root }, locks });
  vi.stubGlobal(
    "FileSystemFileHandle",
    class {
      createWritable() {}
    },
  );
  vi.stubGlobal("localStorage", { length: 1, getItem: () => "library-done", setItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

it("removes the folder of a save that never finished when loading", async () => {
  await loadLibrary();
  expect(root.names()).toEqual(["library", "library-done", "other"]);
});

it("leaves every folder while a save is running, also in another tab", async () => {
  let finish = () => {};
  const saving = locks.request("opentim.lab.saving", { mode: "shared" }, () => new Promise<void>((r) => (finish = r)));
  await loadLibrary();
  expect(root.names()).toEqual(["library", "library-done", "library-cut-off", "other"]);
  finish();
  await saving;
});
