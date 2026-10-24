import { writeArchive } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import {
  ImportError,
  checkComplete,
  checkSelection,
  describeContents,
  indexArchive,
  sortSelection,
} from "../src/importer.ts";

const archive = (...names: string[]) => writeArchive(names.map((name) => ({ name, data: Uint8Array.of(1, 2) })));
const file = (name: string, size = 10) => ({ name, size });

function thrown(fn: () => unknown): ImportError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ImportError) return error;
    throw error;
  }
  throw new Error("Expected an ImportError");
}

describe("sortSelection", () => {
  it("keeps RESOURCE archives sorted and explains every skipped file", () => {
    const { archives, skipped, log } = sortSelection([
      file("resource.002"),
      file("TIM_DOS.ZIP", 5000),
      file("RESOURCE.001"),
      file("TIM.EXE"),
      file("README.TXT"),
    ]);
    expect(archives.map((f) => f.name)).toEqual(["RESOURCE.001", "resource.002"]);
    expect(skipped.map((r) => [r.name, r.outcome])).toEqual([
      ["TIM_DOS.ZIP", "rejected"],
      ["TIM.EXE", "skipped"],
      ["README.TXT", "skipped"],
    ]);
    expect(skipped[1]?.size).toBeUndefined();
    expect(log).toHaveLength(3);
  });
});

describe("checkSelection", () => {
  it("needs at least one archive", () => {
    expect(thrown(() => checkSelection([])).title).toBe("No RESOURCE files found");
  });

  it("rejects the same archive twice, ignoring case", () => {
    expect(thrown(() => checkSelection([file("RESOURCE.001"), file("resource.001")])).title).toBe("Duplicate archive");
  });
});

describe("indexArchive", () => {
  it("lists every resource with its kind and group", () => {
    const resources = indexArchive("RESOURCE.001", archive("TIM.PAL", "PART1.BMP", "SFX001.SX"), new Set());
    expect(resources.map((r) => [r.name, r.kind, r.group, r.archive])).toEqual([
      ["TIM.PAL", "palette", "palette", "RESOURCE.001"],
      ["PART1.BMP", "sprites", "sprites", "RESOURCE.001"],
      ["SFX001.SX", "audio", "sound", "RESOURCE.001"],
    ]);
  });

  it("treats a resource that is already loaded as a mix of game versions", () => {
    const error = thrown(() => indexArchive("RESOURCE.002", archive("L1.LEV"), new Set(["L1.LEV"])));
    expect(error.title).toBe("Mixed game versions");
  });

  it("explains a damaged archive and keeps the technical reason", () => {
    const error = thrown(() => indexArchive("RESOURCE.001", archive("TIM.PAL").subarray(0, 18), new Set()));
    expect(error.title).toBe("Couldn't read RESOURCE.001");
    expect(error.detail).toMatch(/Truncated resource TIM.PAL/);
  });
});

describe("checkComplete", () => {
  const index = (...names: string[]) => indexArchive("RESOURCE.001", archive(...names), new Set());

  it("passes with images and palettes", () => {
    const result = checkComplete(index("TIM.PAL", "PART1.BMP", "L1.LEV"));
    expect(result.error).toBeUndefined();
    expect(result.log).toMatch(/ok .*palettes=1 images=1 levels=1/);
  });

  it("lists what is missing when only levels were selected", () => {
    const { error, log } = checkComplete(index("L1.LEV", "L2.LEV"));
    expect(error?.title).toBe("Images or palettes missing");
    expect(error?.requirements.map((r) => [r.label, r.count])).toEqual([
      ["palettes", 0],
      ["image files", 0],
      ["levels", 2],
    ]);
    expect(log).toMatch(/FAIL/);
  });
});

describe("describeContents", () => {
  it("counts resources per group in display order", () => {
    const resources = indexArchive("RESOURCE.001", archive("L1.LEV", "TIM.PAL", "L2.LEV", "X.DAT"), new Set());
    expect(describeContents(resources)).toBe("1 palettes, 2 levels, 1 other");
  });
});
