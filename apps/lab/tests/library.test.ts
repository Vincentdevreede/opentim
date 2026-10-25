import { writeArchive, writeLanguagePackage, writeMap } from "@opentim/resources";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROFILES, sha256 } from "../src/edition.ts";
import {
  archives,
  cancel,
  chooseLanguage,
  confirmImport,
  discard,
  failure,
  forget,
  importFiles,
  needsLanguage,
  phase,
  resources,
  restore,
  selected,
  staging,
} from "../src/library.ts";

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

/** Adds a version made of these files to the catalog, for one test. */
async function known(id: string, ...files: File[]) {
  const hashes = files.map(async (f) => ({
    name: f.name,
    sha256: await sha256(new Uint8Array(await f.arrayBuffer())),
  }));
  PROFILES.push({ id, name: id, languages: ["en"], files: await Promise.all(hashes) });
}
const catalogSize = PROFILES.length;

/** Imports files and continues, like the user does on the start screen. */
async function load(...files: File[]) {
  await importFiles(files);
  await confirmImport();
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
  discard();
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
afterEach(() => {
  vi.unstubAllGlobals();
  PROFILES.splice(catalogSize);
});

describe("staged import", () => {
  it("waits for the user to continue before loading and saving", async () => {
    const disk = storage();
    await importFiles([archive("A.BMP")]);
    expect(phase.value).toBe("staged");
    expect(staging.value?.edition.status).toBe("unknown");
    expect(resources.value).toEqual([]);
    expect(disk.directories.size).toBe(0);
    await confirmImport();
    expect(phase.value).toBe("loaded");
    expect(resources.value.map((r) => r.name)).toEqual(["A.BMP", "TIM.PAL"]);
    expect(staging.value).toBeUndefined();
    expect(disk.directories.size).toBe(1);
  });

  it("adds an add-on over the game, replacing files and resources with the same name", async () => {
    storage();
    const game = [archive("A.BMP", "RESOURCE.001"), archive("B.BMP", "RESOURCE.002")];
    await known("tim1-en", ...game);
    await importFiles(game);
    expect(staging.value?.edition.status).toBe("recognized");
    await importFiles([archive("C.BMP", "RESOURCE.002"), archive("A.BMP", "RESOURCE.003")]);
    expect(staging.value?.files.map((a) => a.name)).toEqual(["RESOURCE.001", "RESOURCE.002", "RESOURCE.003"]);
    expect(staging.value?.resources.map((r) => [r.name, r.archive])).toEqual([
      ["A.BMP", "RESOURCE.003"],
      ["C.BMP", "RESOURCE.002"],
      ["TIM.PAL", "RESOURCE.003"],
    ]);
    await confirmImport();
    expect(archives.value.map((a) => a.name)).toEqual(["RESOURCE.001", "RESOURCE.002", "RESOURCE.003"]);
  });

  it("starts over with new files when the staged game has no add-on", async () => {
    storage();
    const names = ["TIM.PAL", "PART1.BMP", "FF.LEV"];
    const demo = new File([writeArchive(names.map((name) => ({ name, data: Uint8Array.of(1) })))], "RESOURCE.001");
    await known("tim1-en-demo", demo);
    await importFiles([demo]);
    expect(staging.value?.edition.status).toBe("recognized");
    await importFiles([archive("B.BMP", "RESOURCE.002")]);
    expect(staging.value?.files.map((a) => a.name)).toEqual(["RESOURCE.002"]);
  });

  it("adds more files to a version that isn't recognised", async () => {
    storage();
    await importFiles([archive("A.BMP", "RESOURCE.001")]);
    await importFiles([archive("B.BMP", "RESOURCE.002")]);
    expect(staging.value?.files.map((f) => f.name)).toEqual(["RESOURCE.001", "RESOURCE.002"]);
  });

  it("checks the archives against RESOURCE.MAP and saves it with them", async () => {
    const disk = storage();
    const map = writeMap([
      { name: "RESOURCE.001", offsets: [0, 18] },
      { name: "RESOURCE.002", offsets: [0, 18] },
    ]);
    await importFiles([archive("A.BMP", "RESOURCE.001"), new File([map], "RESOURCE.MAP")]);
    expect(staging.value?.map).toMatchObject({ missing: ["RESOURCE.002"], problems: [] });
    await importFiles([archive("B.BMP", "RESOURCE.002")]);
    expect(staging.value?.map).toMatchObject({ missing: [], problems: [] });
    await confirmImport();
    expect([...disk.directories.values()][0]!.has("RESOURCE.MAP")).toBe(true);
    await restore();
    expect(archives.value.map((a) => a.name)).toEqual(["RESOURCE.001", "RESOURCE.002", "RESOURCE.MAP"]);
  });

  it("installs the chosen language from installation disks before continuing", async () => {
    const disk = storage();
    const pack = (sprite: string) =>
      writeLanguagePackage([
        { name: "RESOURCE.002", data: writeArchive([{ name: sprite, data: Uint8Array.of(1) }]) },
        {
          name: "RESOURCE.MAP",
          data: writeMap([
            { name: "RESOURCE.001", offsets: [0] },
            { name: "RESOURCE.002", offsets: [0] },
          ]),
        },
        { name: "INSTALL.COM", data: Uint8Array.of(1) },
      ]);
    const palette = writeArchive([{ name: "TIM.PAL", data: Uint8Array.of(1) }]);
    await importFiles([
      new File([pack("FR.BMP")], "FRENCH.RES"),
      new File([pack("DE.BMP")], "GERMAN.RES"),
      new File([palette], "RESOURCE.001"),
    ]);
    expect(staging.value?.languages).toEqual(["FRENCH", "GERMAN"]);
    expect(needsLanguage(staging.value!)).toBe(true);
    await confirmImport();
    expect(phase.value).toBe("staged");

    await chooseLanguage("FRENCH");
    await chooseLanguage("GERMAN");
    expect(staging.value?.files.map((f) => f.name)).toEqual(["RESOURCE.001", "RESOURCE.002", "RESOURCE.MAP"]);
    expect(staging.value?.map).toMatchObject({ missing: [], problems: [] });
    await confirmImport();
    expect(resources.value.map((r) => r.name)).toEqual(["DE.BMP", "TIM.PAL"]);
    expect([...[...disk.directories.values()][0]!.keys()].sort()).toEqual([
      "RESOURCE.001",
      "RESOURCE.002",
      "RESOURCE.MAP",
    ]);
  });

  it("keeps the loaded files when new ones are put aside", async () => {
    storage();
    await load(archive("OLD.BMP"));
    await importFiles([archive("NEW.BMP")]);
    expect(phase.value).toBe("staged");
    expect(resources.value.map((r) => r.name)).toContain("OLD.BMP");
    discard();
    expect(phase.value).toBe("loaded");
    expect(staging.value).toBeUndefined();
  });
});

describe("saved library replacement", () => {
  it("restores archives saved by the previous storage layout", async () => {
    const disk = storage();
    disk.directories.set("library", new Map([["RESOURCE.001", archive("OLD.BMP")]]));
    await restore();
    expect(resources.value.map((r) => r.name)).toContain("OLD.BMP");
  });

  it("preserves the previous library when a replacement write fails", async () => {
    const disk = storage();
    await load(archive("OLD.BMP"));
    const previous = disk.pointers.get(ACTIVE);
    disk.onWrite(async () => {
      throw new Error("quota exceeded");
    });
    await load(archive("NEW.BMP"));
    expect(phase.value).toBe("error");
    expect(disk.pointers.get(ACTIVE)).toBe(previous);
    expect(disk.directories.size).toBe(1);
    await restore();
    expect(resources.value.map((r) => r.name)).toContain("OLD.BMP");
  });

  it.each(["write", "close"])("discards a replacement cancelled during %s", async (stage) => {
    const disk = storage();
    await load(archive("OLD.BMP"));
    const previous = disk.pointers.get(ACTIVE);
    const reached = deferred();
    const release = deferred();
    const pause = async () => {
      reached.resolve();
      await release.promise;
    };
    if (stage === "write") disk.onWrite(pause);
    else disk.onClose(pause);
    const importing = load(archive("NEW.BMP"));
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
    const older = load(archive("OLD.BMP"));
    await reached.promise;
    disk.onWrite(async () => {});
    await load(archive("NEW.BMP"));
    release.resolve();
    await older;
    expect(disk.directories.size).toBe(1);
    await restore();
    expect(resources.value.map((r) => r.name)).toContain("NEW.BMP");
  });

  it("does not resurrect a forgotten library when a pending write completes", async () => {
    const disk = storage();
    await load(archive("OLD.BMP"));
    const reached = deferred();
    const release = deferred();
    disk.onWrite(async () => {
      reached.resolve();
      await release.promise;
    });
    const importing = load(archive("NEW.BMP"));
    await reached.promise;
    await forget();
    release.resolve();
    await importing;
    await restore();
    expect(resources.value).toEqual([]);
    expect(disk.directories.size).toBe(0);
  });
});
