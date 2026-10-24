import { isArchiveName, kindOf, readArchive, type ResourceKind } from "@opentim/resources";
import { GROUPS, groupOf, type KindGroup } from "./kinds.ts";

/** The checks and messages of an import. Pure functions, so they can be tested without a browser. */

export interface Resource {
  name: string;
  kind: ResourceKind;
  group: KindGroup;
  archive: string;
  offset: number;
  data: Uint8Array;
}

export interface Received {
  name: string;
  size?: number;
  outcome: "read" | "rejected" | "skipped" | "failed";
  detail: string;
}

export interface Requirement {
  label: string;
  count: number;
  /** Text after the count. Parts between backticks are file names. */
  hint: string;
}

/** A problem that stops an import, explained for the user. */
export class ImportError extends Error {
  constructor(
    readonly title: string,
    message: string,
    readonly requirements: Requirement[] = [],
    /** Technical reason, shown next to the file that caused it. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

interface NamedFile {
  name: string;
  size: number;
}

/** Splits a selection into RESOURCE archives (sorted by name) and the files that are skipped. */
export function sortSelection<T extends NamedFile>(files: T[]): { archives: T[]; skipped: Received[]; log: string[] } {
  const archives: T[] = [];
  const skipped: Received[] = [];
  const log: string[] = [];
  for (const file of files) {
    const name = file.name.toUpperCase();
    if (isArchiveName(name)) {
      archives.push(file);
    } else if (name.endsWith(".ZIP")) {
      skipped.push({
        name,
        size: file.size,
        outcome: "rejected",
        detail: "ZIP archives aren’t read. Unzip it and select the RESOURCE files inside.",
      });
      log.push(`[import] ${name.padEnd(13)} rejected  reason=zip-archive`);
    } else if (/\.(EXE|COM|OVL)$/.test(name)) {
      skipped.push({ name, outcome: "skipped", detail: "Skipped — the executable isn’t needed." });
      log.push(`[import] ${name.padEnd(13)} skipped   reason=executable`);
    } else {
      skipped.push({ name, size: file.size, outcome: "skipped", detail: "Skipped — not a RESOURCE archive." });
      log.push(`[import] ${name.padEnd(13)} skipped   reason=not-an-archive`);
    }
  }
  archives.sort((a, b) => a.name.localeCompare(b.name));
  return { archives, skipped, log };
}

/** Rejects a selection without archives, or with the same archive twice. */
export function checkSelection(archives: NamedFile[]): void {
  if (!archives.length) {
    throw new ImportError(
      "No RESOURCE files found",
      "Select the RESOURCE.001, RESOURCE.002 … files from the game folder. ZIP archives have to be unzipped first.",
    );
  }
  const names = new Set<string>();
  for (const { name } of archives) {
    const upper = name.toUpperCase();
    if (names.has(upper))
      throw new ImportError("Duplicate archive", `${upper} was selected twice. Import one game version at a time.`);
    names.add(upper);
  }
}

/** Lists the resources in one archive. Names already found in other archives mean mixed game versions. */
export function indexArchive(name: string, data: Uint8Array, found: ReadonlySet<string>): Resource[] {
  let entries;
  try {
    entries = readArchive(data, name);
  } catch (error) {
    throw new ImportError(
      `Couldn't read ${name}`,
      "This file doesn't look like a RESOURCE archive of the original DOS game, or it is damaged.",
      [],
      (error as Error).message,
    );
  }
  return entries.map((entry) => {
    if (found.has(entry.name)) {
      throw new ImportError(
        "Mixed game versions",
        `${entry.name} appears in more than one archive. Select the RESOURCE files of one game version only.`,
      );
    }
    const kind = kindOf(entry.name);
    return { ...entry, kind, group: groupOf(kind) };
  });
}

/** Checks that the archives together hold the images and palettes the lab needs. */
export function checkComplete(found: Resource[]): { log: string; error?: ImportError } {
  const palettes = found.filter((r) => r.group === "palette").length;
  const images = found.filter((r) => r.group === "sprites" || r.group === "screen").length;
  const levels = found.filter((r) => r.group === "level").length;
  const ok = palettes > 0 && images > 0;
  const log = `[import] check         ${ok ? "ok  " : "FAIL"}      palettes=${palettes} images=${images} levels=${levels}`;
  if (ok) return { log };
  return {
    log,
    error: new ImportError(
      "Images or palettes missing",
      "Only part of the game was selected. Select all RESOURCE files of this version together. Sprites and palettes live in other files than the levels.",
      [
        {
          label: "palettes",
          count: palettes,
          hint: palettes ? "found" : "expected `TIM.PAL`, plus `SIERRA.PAL` and `DYNAMIX.PAL`",
        },
        { label: "image files", count: images, hint: images ? "found" : "sprite sheets and screens" },
        { label: "levels", count: levels, hint: levels ? "found" : "`L1.LEV` and up" },
      ],
    ),
  };
}

/** Summarises resources per group, e.g. "41 levels, 4 scenes". */
export const describeContents = (list: Resource[]) =>
  GROUPS.map((g) => [g, list.filter((r) => r.group === g.id).length] as const)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${n} ${g.label.toLowerCase()}`)
    .join(", ");
