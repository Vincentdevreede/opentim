import { MAP_NAME, isArchiveName, kindOf, readArchive, readMap, type ResourceKind } from "@opentim/resources";
import { isVersionFile } from "./edition.ts";
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

/**
 * Splits a selection into the game files that are read (sorted by name) and the files that are skipped. Game files are
 * the RESOURCE archives, plus `RESOURCE.MAP` and the language files that tell which version it is.
 */
export function sortSelection<T extends NamedFile>(files: T[]): { files: T[]; skipped: Received[]; log: string[] } {
  const read: T[] = [];
  const skipped: Received[] = [];
  const log: string[] = [];
  for (const file of files) {
    const name = file.name.toUpperCase();
    if (isVersionFile(name)) {
      read.push(file);
    } else if (name === "RESOURCE.CFG") {
      skipped.push({ name, outcome: "skipped", detail: "Skipped — the game’s settings aren’t needed." });
      log.push(`[import] ${name.padEnd(13)} skipped   reason=settings`);
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
  read.sort((a, b) => a.name.localeCompare(b.name));
  return { files: read, skipped, log };
}

/** Rejects a selection without archives, or with the same file twice. */
export function checkSelection(files: NamedFile[]): void {
  if (!files.some((f) => isArchiveName(f.name))) {
    throw new ImportError(
      "No RESOURCE files found",
      "Select the RESOURCE.001, RESOURCE.002 … files from the game folder. ZIP archives have to be unzipped first.",
    );
  }
  const names = new Set<string>();
  for (const { name } of files) {
    const upper = name.toUpperCase();
    if (names.has(upper))
      throw new ImportError(
        "Duplicate file",
        `${upper} was selected twice. Select the game first, then add an add-on’s files in a second step.`,
      );
    names.add(upper);
  }
}

/** Lists the resources in one archive. */
export function indexArchive(name: string, data: Uint8Array): Resource[] {
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
    const kind = kindOf(entry.name);
    return { ...entry, kind, group: groupOf(kind) };
  });
}

/**
 * Adds files to the ones read before. A file replaces one with the same name, like an add-on that is installed over
 * the game.
 */
export function mergeFiles<T extends NamedFile>(current: T[], added: T[]): T[] {
  const names = new Set(added.map((a) => a.name));
  return [...current.filter((a) => !names.has(a.name)), ...added].sort((a, b) => a.name.localeCompare(b.name));
}

/** The resources of all archives. A resource in a later archive replaces one with the same name in an earlier one. */
export function combineResources(archives: { name: string; resources: Resource[] }[]): {
  resources: Resource[];
  replaced: Resource[];
} {
  const byName = new Map<string, Resource>();
  const replaced: Resource[] = [];
  for (const archive of archives) {
    for (const r of archive.resources) {
      const previous = byName.get(r.name);
      if (previous) replaced.push(previous);
      byName.set(r.name, r);
    }
  }
  const resources = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return { resources, replaced };
}

export interface MapCheck {
  /** Archives that `RESOURCE.MAP` lists resources in, but that weren't selected. */
  missing: string[];
  /** Other ways the archives don't match the map. */
  problems: string[];
  log: string;
}

/**
 * Checks the archives against `RESOURCE.MAP`, the game's own index of them: every archive it lists resources in has to
 * be there, with an entry at each offset it names, and no others. Archives from different versions don't match.
 */
export function checkMap(map: Uint8Array, archives: { name: string; resources: Resource[] }[]): MapCheck {
  let listed;
  try {
    listed = readMap(map);
  } catch (error) {
    const reason = (error as Error).message;
    return {
      missing: [],
      problems: [`${MAP_NAME} can’t be read: ${reason}.`],
      log: `[import] map           FAIL      ${reason}`,
    };
  }
  const byName = new Map(archives.map((a) => [a.name, a]));
  const missing: string[] = [];
  const problems: string[] = [];
  for (const { name, offsets } of listed) {
    const archive = byName.get(name);
    if (!archive) {
      if (offsets.length) missing.push(name);
      continue;
    }
    const entries = new Set(archive.resources.map((r) => r.offset));
    if (offsets.length !== entries.size || !offsets.every((o) => entries.has(o))) {
      problems.push(`${name} doesn’t match ${MAP_NAME}. Are they from the same version?`);
    }
  }
  for (const { name } of archives) {
    if (!listed.some((a) => a.name === name)) problems.push(`${name} isn’t listed in ${MAP_NAME}.`);
  }
  const ok = !missing.length && !problems.length;
  const log = `[import] map           ${ok ? "ok  " : "FAIL"}      archives=${listed.length} missing=${missing.length} problems=${problems.length}`;
  return { missing, problems, log };
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
