import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  PROFILES,
  catalogEntry,
  detectEdition,
  editionLanguages,
  editionName,
  isVersionFile,
  sha256,
} from "../src/edition.ts";
import catalog from "../src/version-catalog.json";

/** The files of a version in the catalog, as if they were imported. */
const filesOf = (id: string) => PROFILES.find((p) => p.id === id)!.files.map((f) => ({ ...f }));

describe("isVersionFile", () => {
  it("counts the RESOURCE files and language files", () => {
    for (const name of ["RESOURCE.001", "resource.map", "RESOURCE.F03", "FRENCH.RES", "ENGLISH.DAT"]) {
      expect(isVersionFile(name), name).toBe(true);
    }
  });

  it("leaves out the settings and other files", () => {
    for (const name of ["RESOURCE.CFG", "TIM.EXE", "README.TXT", "DUTCH.DAT"]) {
      expect(isVersionFile(name), name).toBe(false);
    }
  });
});

describe("detectEdition", () => {
  it("recognises a version by the names and hashes of all its files", () => {
    const edition = detectEdition(filesOf("tim1-en"));
    expect(edition.status === "recognized" && edition.profile.id).toBe("tim1-en");
  });

  it("tells apart versions that share files", () => {
    // Even More! on floppy has the same RESOURCE.001 and .002 as The Incredible Machine.
    const edition = detectEdition(filesOf("evenmore-en-floppy"));
    expect(edition.status === "recognized" && edition.profile.id).toBe("evenmore-en-floppy");
  });

  it("ignores the case of names, the settings and other files", () => {
    const files = filesOf("tim1-en-demo").map((f) => ({ ...f, name: f.name.toLowerCase() }));
    files.push({ name: "RESOURCE.CFG", sha256: "0".repeat(64) }, { name: "TIM.EXE", sha256: "1".repeat(64) });
    expect(detectEdition(files).status).toBe("recognized");
  });

  it("lists what is missing when files of a version are left out", () => {
    expect(detectEdition(filesOf("tim1-en").filter((f) => f.name !== "RESOURCE.MAP"))).toEqual({
      status: "incomplete",
      candidates: [{ profile: PROFILES.find((p) => p.id === "tim1-en"), missing: ["RESOURCE.MAP"] }],
    });
  });

  it("points at the base game when only the Add-On Disk is selected", () => {
    const addOn = filesOf("tim1-addon-en").filter((f) => !["RESOURCE.001", "RESOURCE.002"].includes(f.name));
    const edition = detectEdition(addOn);
    expect(edition.status === "incomplete" && edition.candidates.map((c) => [c.profile.id, c.missing])).toEqual([
      ["tim1-addon-en", ["RESOURCE.001", "RESOURCE.002"]],
    ]);
  });

  it("doesn't recognise a version with an extra or changed file", () => {
    const extra = [...filesOf("tim1-en"), { name: "RESOURCE.005", sha256: "0".repeat(64) }];
    expect(detectEdition(extra).status).toBe("unknown");
    const changed = filesOf("tim1-en").map((f, i) => (i ? f : { ...f, sha256: "0".repeat(64) }));
    expect(detectEdition(changed).status).toBe("unknown");
    expect(detectEdition([]).status).toBe("unknown");
  });
});

describe("editionName and editionLanguages", () => {
  it("name a recognised version and its languages", () => {
    const edition = detectEdition(filesOf("tim2-multilingual-cd"));
    expect(editionName(edition)).toBe("The Incredible Machine 2 (CD)");
    expect(editionLanguages(edition)).toBe("English, French, German, Spanish");
  });

  it("call anything else an unknown version", () => {
    expect(editionName({ status: "unknown" })).toBe("Unknown version");
    expect(editionLanguages({ status: "unknown" })).toBe("");
  });
});

describe("version-catalog.json", () => {
  it("has the format the lab reads", () => {
    expect(catalog.schemaVersion).toBe(2);
  });

  it.each(PROFILES.map((p) => [p.id, p] as const))("%s is well formed", (_, profile) => {
    expect(profile.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(profile.name.trim()).not.toBe("");
    expect(profile.languages.length).toBeGreaterThan(0);
    for (const code of profile.languages) expect(Object.keys(LANGUAGES)).toContain(code);
    expect(profile.files.length).toBeGreaterThan(0);
    for (const file of profile.files) {
      expect(file.name).toBe(file.name.toUpperCase());
      expect(isVersionFile(file.name), file.name).toBe(true);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(profile.files.map((f) => f.name)).size).toBe(profile.files.length);
  });

  it("has unique ids and no two versions with the same files", () => {
    expect(new Set(PROFILES.map((p) => p.id)).size).toBe(PROFILES.length);
    const sets = PROFILES.map((p) =>
      p.files
        .map((f) => `${f.name}=${f.sha256}`)
        .sort()
        .join(","),
    );
    expect(new Set(sets).size).toBe(PROFILES.length);
  });
});

describe("catalogEntry", () => {
  it("lists the counted files sorted by name, for a pull request", () => {
    const entry = JSON.parse(
      catalogEntry([
        { name: "resource.map", sha256: "b".repeat(64) },
        { name: "RESOURCE.CFG", sha256: "c".repeat(64) },
        { name: "RESOURCE.001", sha256: "a".repeat(64) },
      ]),
    );
    expect(entry.files).toEqual([
      { name: "RESOURCE.001", sha256: "a".repeat(64) },
      { name: "RESOURCE.MAP", sha256: "b".repeat(64) },
    ]);
    expect(entry.requiresExtraction).toBeUndefined();
  });

  it("marks installation media", () => {
    const entry = JSON.parse(catalogEntry([{ name: "FRENCH.RES", sha256: "a".repeat(64) }]));
    expect(entry.requiresExtraction).toBe(true);
  });
});

describe("sha256", () => {
  it("hashes bytes as lowercase hex", async () => {
    expect(await sha256(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
