import { writeArchive } from "@opentim/resources";
import { afterEach, expect, it, vi } from "vitest";
import { canPersist, forget, importFiles, phase, resources, restore } from "../src/library.ts";

afterEach(() => vi.unstubAllGlobals());

// In its own file, because losing storage is remembered for the rest of the session.
it("loads files for this session only when the browser can't store them", async () => {
  // Outside a secure context, navigator.storage doesn't exist.
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("localStorage", { length: 0, getItem: () => null, setItem: () => {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => (callback(0), 0));

  await expect(restore()).resolves.toBeUndefined();
  expect(canPersist.value).toBe(false);

  const data = writeArchive([
    { name: "TIM.PAL", data: Uint8Array.of(1) },
    { name: "PART1.BMP", data: Uint8Array.of(2) },
  ]);
  await importFiles([new File([data], "RESOURCE.001")]);
  expect(phase.value).toBe("loaded");
  expect(resources.value.map((r) => r.name)).toEqual(["PART1.BMP", "TIM.PAL"]);

  await expect(forget()).resolves.toBeUndefined();
  expect(phase.value).toBe("empty");
});
