/**
 * Recognises which version of a game the imported files are, by their SHA-256 hashes. The known versions are in
 * `version-catalog.json`; add a version there in a pull request, with the entry the start screen copies for you.
 */

import catalog from "./version-catalog.json";

export interface Profile {
  /** Stable id of the version, like `tim1-en`. */
  id: string;
  name: string;
  /** Language codes, like `en`. A version with several has all of them installed. */
  languages: string[];
  /** The id of the version's part list in `@opentim/content`, like `tim1`, when there is one. */
  parts?: string;
  /** Every file that counts for recognition, with upper-case names. */
  files: FileHash[];
  /** True for installation media, whose files still have to be unpacked. */
  requiresExtraction?: boolean;
}

export interface FileHash {
  name: string;
  sha256: string;
}

export type Edition =
  /** The files are exactly those of a known version. */
  | { status: "recognized"; profile: Profile }
  /** The files belong to known versions, but some of their files are missing. */
  | { status: "incomplete"; candidates: { profile: Profile; missing: string[] }[] }
  | { status: "unknown" };

export const PROFILES: Profile[] = catalog.profiles;

/** Names of the language codes in the catalog. */
export const LANGUAGES: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish" };

/**
 * True for the files that count for recognition: every RESOURCE file except the settings in `RESOURCE.CFG`, and the
 * language files.
 */
export const isVersionFile = (name: string) =>
  (/^RESOURCE\./i.test(name) && !/\.CFG$/i.test(name)) || /^(ENGLISH|FRENCH|GERMAN|SPANISH)\.(DAT|RES)$/i.test(name);

/**
 * Finds the version with exactly these files: the same names and hashes, none missing and none extra. Without one,
 * lists the versions that have all these files and more.
 */
export function detectEdition(files: readonly FileHash[], profiles = PROFILES): Edition {
  const hashes = new Map(files.filter((f) => isVersionFile(f.name)).map((f) => [f.name.toUpperCase(), f.sha256]));
  if (!hashes.size) return { status: "unknown" };
  const has = (profile: Profile) =>
    [...hashes].every(([name, sha256]) => profile.files.some((f) => f.name === name && f.sha256 === sha256));
  const candidates = profiles
    .filter(has)
    .map((profile) => ({ profile, missing: profile.files.map((f) => f.name).filter((name) => !hashes.has(name)) }));
  const exact = candidates.find((c) => !c.missing.length);
  if (exact) return { status: "recognized", profile: exact.profile };
  return candidates.length ? { status: "incomplete", candidates } : { status: "unknown" };
}

/** The name of the version, for display. */
export const editionName = (e: Edition) => (e.status === "recognized" ? e.profile.name : "Unknown version");

/** The languages of a recognised version, like "French, German". */
export const editionLanguages = (e: Edition) =>
  e.status === "recognized" ? e.profile.languages.map((code) => LANGUAGES[code] ?? code).join(", ") : "";

/** The SHA-256 of a file, as lowercase hex. */
export async function sha256(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A profile for `version-catalog.json` with these files, to fill in and add in a pull request. */
export function catalogEntry(files: readonly FileHash[]): string {
  const counted = files.filter((f) => isVersionFile(f.name));
  const entry: Profile = {
    id: "TODO-game-language",
    name: "TODO Game name (Edition)",
    languages: [],
    files: counted
      .map((f) => ({ name: f.name.toUpperCase(), sha256: f.sha256 }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  if (counted.some((f) => /\.RES$/i.test(f.name))) entry.requiresExtraction = true;
  return JSON.stringify(entry, null, 2);
}

/** How the version was recognised, for a tooltip. */
export const editionHint = (e: Edition) =>
  e.status === "recognized"
    ? "Recognised by the SHA-256 hashes of the game files"
    : "Not a version in the catalog. The files can still be inspected.";
