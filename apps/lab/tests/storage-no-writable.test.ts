import { writeArchive } from "@opentim/resources";
import { afterEach, expect, it, vi } from "vitest";
import { canPersist, importFiles, phase, resources } from "../src/library.ts";

afterEach(() => vi.unstubAllGlobals());

// In its own file, because losing storage is remembered for the rest of the session.
it("loads files for this session only when OPFS can't be written outside a worker", async () => {
  // Safari before 17: OPFS exists, but file handles have no createWritable().
  const getDirectory = vi.fn();
  vi.stubGlobal("navigator", { storage: { getDirectory } });
  vi.stubGlobal("FileSystemFileHandle", class {});
  vi.stubGlobal("localStorage", { length: 0, getItem: () => null, setItem: () => {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => (callback(0), 0));

  const data = writeArchive([
    { name: "TIM.PAL", data: Uint8Array.of(1) },
    { name: "PART1.BMP", data: Uint8Array.of(2) },
  ]);
  await importFiles([new File([data], "RESOURCE.001")]);
  expect(phase.value).toBe("loaded");
  expect(resources.value.map((r) => r.name)).toEqual(["PART1.BMP", "TIM.PAL"]);
  expect(canPersist.value).toBe(false);
  expect(getDirectory).not.toHaveBeenCalled();
});
