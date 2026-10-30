import { writeArchive, writeMap } from "@opentim/resources";
import { describe, expect, it } from "vitest";
import {
  ImportError,
  checkComplete,
  checkMap,
  checkSelection,
  combineResources,
  describeContents,
  indexArchive,
  mergeFiles,
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
  it("keeps the game files sorted and explains every skipped file", () => {
    const { files, skipped, log } = sortSelection([
      file("resource.002"),
      file("TIM_DOS.ZIP", 5000),
      file("RESOURCE.MAP"),
      file("RESOURCE.001"),
      file("RESOURCE.CFG"),
      file("FRENCH.RES"),
      file("TIM.EXE"),
      file("INSTALL.EXE"),
      file("README.TXT"),
    ]);
    expect(files.map((f) => f.name)).toEqual(["FRENCH.RES", "RESOURCE.001", "resource.002", "RESOURCE.MAP", "TIM.EXE"]);
    expect(skipped.map((r) => [r.name, r.outcome])).toEqual([
      ["TIM_DOS.ZIP", "rejected"],
      ["RESOURCE.CFG", "skipped"],
      ["INSTALL.EXE", "skipped"],
      ["README.TXT", "skipped"],
    ]);
    expect(skipped[2]?.size).toBeUndefined();
    expect(log).toHaveLength(4);
  });
});

describe("checkSelection", () => {
  it("needs at least one archive", () => {
    expect(thrown(() => checkSelection([])).title).toBe("No RESOURCE files found");
    expect(thrown(() => checkSelection([file("RESOURCE.MAP")])).title).toBe("No RESOURCE files found");
    expect(() => checkSelection([file("RESOURCE.MAP")], false)).not.toThrow();
  });

  it("rejects the same file twice, ignoring case", () => {
    expect(thrown(() => checkSelection([file("RESOURCE.001"), file("resource.001")])).title).toBe("Duplicate file");
  });
});

describe("indexArchive", () => {
  it("lists every resource with its kind and group", () => {
    const resources = indexArchive("RESOURCE.001", archive("TIM.PAL", "PART1.BMP", "SFX001.SX"));
    expect(resources.map((r) => [r.name, r.kind, r.group, r.archive])).toEqual([
      ["TIM.PAL", "palette", "palette", "RESOURCE.001"],
      ["PART1.BMP", "sprites", "sprites", "RESOURCE.001"],
      ["SFX001.SX", "audio", "sound", "RESOURCE.001"],
    ]);
  });

  it("explains a damaged archive and keeps the technical reason", () => {
    const error = thrown(() => indexArchive("RESOURCE.001", archive("TIM.PAL").subarray(0, 18)));
    expect(error.title).toBe("Couldn't read RESOURCE.001");
    expect(error.detail).toMatch(/Truncated resource TIM.PAL/);
  });
});

describe("mergeFiles", () => {
  it("adds files and replaces those with the same name", () => {
    const merged = mergeFiles(
      [file("RESOURCE.001", 1), file("RESOURCE.002", 2)],
      [file("RESOURCE.003", 3), file("RESOURCE.001", 4)],
    );
    expect(merged).toEqual([file("RESOURCE.001", 4), file("RESOURCE.002", 2), file("RESOURCE.003", 3)]);
  });
});

describe("combineResources", () => {
  it("takes a resource from the last archive that has it", () => {
    const { resources, replaced } = combineResources([
      { name: "RESOURCE.001", resources: indexArchive("RESOURCE.001", archive("L1.LEV", "TIM.PAL")) },
      { name: "RESOURCE.002", resources: indexArchive("RESOURCE.002", archive("L1.LEV", "L2.LEV")) },
    ]);
    expect(resources.map((r) => [r.name, r.archive])).toEqual([
      ["L1.LEV", "RESOURCE.002"],
      ["L2.LEV", "RESOURCE.002"],
      ["TIM.PAL", "RESOURCE.001"],
    ]);
    expect(replaced.map((r) => [r.name, r.archive])).toEqual([["L1.LEV", "RESOURCE.001"]]);
  });
});

describe("checkMap", () => {
  // Entries of two bytes take 19 bytes each, so they start at offsets 0 and 19.
  const archives = [
    { name: "RESOURCE.001", resources: indexArchive("RESOURCE.001", archive("TIM.PAL", "L1.LEV")) },
    { name: "RESOURCE.002", resources: indexArchive("RESOURCE.002", archive("PART1.BMP")) },
  ];

  it("passes when every archive has an entry at each offset in the map", () => {
    const map = writeMap([
      { name: "RESOURCE.001", offsets: [19, 0] },
      { name: "RESOURCE.002", offsets: [0] },
      { name: "RESOURCE.004", offsets: [] },
    ]);
    expect(checkMap(map, archives)).toMatchObject({ missing: [], problems: [] });
  });

  it("lists archives the map needs that weren't selected", () => {
    const map = writeMap([
      { name: "RESOURCE.001", offsets: [0, 19] },
      { name: "RESOURCE.002", offsets: [0] },
      { name: "RESOURCE.003", offsets: [0] },
    ]);
    expect(checkMap(map, archives)).toMatchObject({ missing: ["RESOURCE.003"], problems: [] });
  });

  it("explains archives that don't match the map", () => {
    const map = writeMap([{ name: "RESOURCE.001", offsets: [0, 20] }]);
    expect(checkMap(map, archives).problems).toEqual([
      "RESOURCE.001 doesn’t match RESOURCE.MAP. Are they from the same version?",
      "RESOURCE.002 isn’t listed in RESOURCE.MAP.",
    ]);
  });

  it("explains a map it can't read", () => {
    expect(checkMap(Uint8Array.of(0, 1), archives).problems).toEqual([
      "RESOURCE.MAP can’t be read: Truncated map at offset 0.",
    ]);
  });
});

describe("checkComplete", () => {
  const index = (...names: string[]) => indexArchive("RESOURCE.001", archive(...names));

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
    const resources = indexArchive("RESOURCE.001", archive("L1.LEV", "TIM.PAL", "L2.LEV", "X.DAT"));
    expect(describeContents(resources)).toBe("1 palettes, 2 levels, 1 other");
  });
});
