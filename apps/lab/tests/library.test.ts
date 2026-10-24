import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archives, cancel, failure, forget, importFiles, phase, resources, restore, selected } from "../src/library.ts";

const ACTIVE = "opentim.lab.library";

function archive(sprite: string, name = "RESOURCE.001") {
  const entry = (filename: string) => {
    const bytes = new Uint8Array(18);
    bytes.set(new TextEncoder().encode(filename));
    new DataView(bytes.buffer).setUint32(13, 1, true);
    return bytes;
  };
  return new File([new Uint8Array([...entry("TIM.PAL"), ...entry(sprite)])], name);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function storage() {
  const directories = new Map<string, Map<string, File>>();
  const pointers = new Map<string, string>();
  let beforeWrite = async () => {};
  let beforeClose = async () => {};
  const root = {
    removeEntry: async (name: string) => {
      directories.delete(name);
    },
    getDirectoryHandle: async (name: string) => {
      if (!directories.has(name)) directories.set(name, new Map());
      const files = directories.get(name)!;
      return {
        entries: async function* () {
          for (const [name, file] of files) yield [name, { kind: "file", getFile: async () => file }] as const;
        },
        getFileHandle: async (name: string) => ({
          createWritable: async () => {
            let pending: File;
            return {
              write: async (data: Uint8Array<ArrayBuffer>) => {
                await beforeWrite();
                pending = new File([data], name);
              },
              close: async () => {
                await beforeClose();
                files.set(name, pending);
              },
              abort: async () => {},
            };
          },
        }),
      };
    },
  };
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });
  vi.stubGlobal(
    "FileSystemFileHandle",
    class {
      createWritable() {}
    },
  );
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => pointers.get(name) ?? null,
    setItem: (name: string, value: string) => {
      pointers.set(name, value);
    },
  });
  return {
    directories,
    pointers,
    onWrite: (hook: () => Promise<void>) => {
      beforeWrite = hook;
    },
    onClose: (hook: () => Promise<void>) => {
      beforeClose = hook;
    },
  };
}

beforeEach(() => {
  cancel();
  resources.value = [];
  archives.value = [];
  selected.value = undefined;
  failure.value = undefined;
  phase.value = "empty";
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("saved library replacement", () => {
  it("restores archives saved by the previous storage layout", async () => {
    const disk = storage();
    disk.directories.set("library", new Map([["RESOURCE.001", archive("OLD.BMP")]]));
    await restore();
    expect(resources.value.map((r) => r.name)).toContain("OLD.BMP");
  });

  it("preserves the previous library when a replacement write fails", async () => {
    const disk = storage();
    await importFiles([archive("OLD.BMP")]);
    const previous = disk.pointers.get(ACTIVE);
    disk.onWrite(async () => {
      throw new Error("quota exceeded");
    });
    await importFiles([archive("NEW.BMP")]);
    expect(phase.value).toBe("error");
    expect(disk.pointers.get(ACTIVE)).toBe(previous);
    expect(disk.directories.size).toBe(1);
    await restore();
    expect(resources.value.map((r) => r.name)).toContain("OLD.BMP");
  });

  it.each(["write", "close"])("discards a replacement cancelled during %s", async (stage) => {
    const disk = storage();
    await importFiles([archive("OLD.BMP")]);
    const previous = disk.pointers.get(ACTIVE);
    const reached = deferred();
    const release = deferred();
    const pause = async () => {
      reached.resolve();
      await release.promise;
    };
    if (stage === "write") disk.onWrite(pause);
    else disk.onClose(pause);
    const importing = importFiles([archive("NEW.BMP")]);
    await reached.promise;
    cancel();
    release.resolve();
    await importing;
    expect(disk.pointers.get(ACTIVE)).toBe(previous);
    expect(disk.directories.size).toBe(1);
    await restore();
    expect(resources.value.map((r) => r.name)).toContain("OLD.BMP");
  });

  it("keeps a newer import when an older write finishes later", async () => {
    const disk = storage();
    const reached = deferred();
    const release = deferred();
    disk.onWrite(async () => {
      reached.resolve();
      await release.promise;
    });
    const older = importFiles([archive("OLD.BMP")]);
    await reached.promise;
    disk.onWrite(async () => {});
    await importFiles([archive("NEW.BMP")]);
    release.resolve();
    await older;
    expect(disk.directories.size).toBe(1);
    await restore();
    expect(resources.value.map((r) => r.name)).toContain("NEW.BMP");
  });

  it("does not resurrect a forgotten library when a pending write completes", async () => {
    const disk = storage();
    await importFiles([archive("OLD.BMP")]);
    const reached = deferred();
    const release = deferred();
    disk.onWrite(async () => {
      reached.resolve();
      await release.promise;
    });
    const importing = importFiles([archive("NEW.BMP")]);
    await reached.promise;
    await forget();
    release.resolve();
    await importing;
    await restore();
    expect(resources.value).toEqual([]);
    expect(disk.directories.size).toBe(0);
  });
});
