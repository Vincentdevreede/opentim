/** The game files loaded into the lab, and the state of the import that loads them. */

import { MAP_NAME, installLanguage, isArchiveName, isLanguagePackageName } from "@opentim/resources";
import { ref, shallowRef } from "vue";
import { detectEdition, isProgramName, sha256, type Edition } from "./edition.ts";
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
  type MapCheck,
  type Received,
  type Requirement,
  type Resource,
} from "./importer.ts";
import { loadLibrary, removeLibrary, saveLibrary } from "./storage.ts";

export type { Edition } from "./edition.ts";
export type { MapCheck, Received, Requirement, Resource } from "./importer.ts";
export { canPersist } from "./storage.ts";

/** A file of the game: a RESOURCE archive, `RESOURCE.MAP` or a language file. */
export interface Archive {
  name: string;
  size: number;
}

export interface FileProgress extends Archive {
  state: "queued" | "reading" | "done";
}

export interface ImportFailure {
  title: string;
  message: string;
  received: Received[];
  requirements: Requirement[];
  log: string[];
}

export interface GameFile extends Archive {
  data: Uint8Array;
  sha256: string;
  /** The resources inside a RESOURCE archive; none for other files. */
  resources: Resource[];
}

/** Files that were read, waiting for the user to continue. More files can still be added. */
export interface Staging {
  /** The files as they were selected. */
  selected: GameFile[];
  /** Language packages on installation media, like `FRENCH`. One has to be installed before continuing. */
  languages: string[];
  /** The installed language package, one of `languages`. */
  language?: string;
  /** The files that are loaded: the selected ones, with the language installed. */
  files: GameFile[];
  resources: Resource[];
  /** Resources replaced by one with the same name in a later archive. */
  replaced: Resource[];
  edition: Edition;
  /** The check of the archives against `RESOURCE.MAP`. Undefined without one. */
  map?: MapCheck;
  /** Set when the archives miss images or palettes, so they can't be loaded yet. */
  error?: ImportError;
  seconds: number;
  /** The log of reading the selected files, before they were staged. */
  readLog: string[];
  log: string[];
}

export type Phase = "empty" | "reading" | "staged" | "loaded" | "error";

/** The version the Add-On Disk is installed over: The Incredible Machine 1.00 in English. */
const ADD_ON_BASE = "tim1-en";

/** True when the staged files are the version the Add-On Disk is installed over. */
export const offersAddOn = (staged: Staging) =>
  staged.edition.status === "recognized" && staged.edition.profile.id === ADD_ON_BASE;

/** True when a language has to be chosen before continuing. */
export const needsLanguage = (staged: Staging) => staged.languages.length > 0 && !staged.language;

/** True when the archives don't match `RESOURCE.MAP`: some are missing, or they are from another version. */
export const mapHasProblems = (staged: Staging) =>
  !!staged.map && (staged.map.missing.length > 0 || staged.map.problems.length > 0);

/** True when files can be added to the staged ones: to complete them, or to add the Add-On. */
export const canAddFiles = (staged: Staging) =>
  !!staged.error || staged.edition.status !== "recognized" || offersAddOn(staged);

export const phase = ref<Phase>("empty");
export const archives = shallowRef<Archive[]>([]);
export const resources = shallowRef<Resource[]>([]);
export const readSeconds = ref(0);
export const progress = ref<FileProgress[]>([]);
export const foundSoFar = shallowRef<Resource[]>([]);
export const failure = shallowRef<ImportFailure>();
export const staging = shallowRef<Staging>();
/** True while the staged archives are saved before they are loaded. */
export const saving = ref(false);
/** The version of the game the loaded files are. */
export const edition = shallowRef<Edition>();
/** The game's program, like `TIM.EXE`, when it was loaded with the archives. */
export const program = shallowRef<{ name: string; data: Uint8Array }>();
/** The resource selected in Overview and Files. */
export const selected = ref<string>();

let generation = 0;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** The phase to go back to when nothing is being read. */
const idle = (): Phase => (staging.value ? "staged" : resources.value.length ? "loaded" : "empty");

function fail(error: unknown, received: Received[], log: string[]): void {
  const e = error instanceof ImportError ? error : new ImportError("Import failed", String(error));
  failure.value = { title: e.title, message: e.message, received, requirements: e.requirements, log };
  phase.value = "error";
}

/** Hashes a file and lists the resources inside, when it is a RESOURCE archive. */
async function prepare(name: string, data: Uint8Array): Promise<GameFile> {
  const resources = isArchiveName(name) ? indexArchive(name, data) : [];
  return { name, size: data.length, data, sha256: await sha256(data), resources };
}

/**
 * Reads, hashes and indexes the game files in a selection. Files added to a staged selection don't need an archive of
 * their own. Undefined when it failed or was cancelled.
 */
async function read(
  files: File[],
  adding = false,
): Promise<{ files: GameFile[]; seconds: number; log: string[] } | undefined> {
  const run = ++generation;
  // Reading new files stops a save that is still running.
  saving.value = false;
  const started = performance.now();
  const { files: inputs, skipped, log } = sortSelection(files);
  // Game files are listed first, followed by the files that were skipped.
  const received: Received[] = [];

  progress.value = inputs.map((f) => ({ name: f.name.toUpperCase(), size: f.size, state: "queued" }));
  foundSoFar.value = [];
  phase.value = "reading";

  const done: GameFile[] = [];
  try {
    checkSelection(inputs, !adding);
    for (const [i, file] of inputs.entries()) {
      const name = file.name.toUpperCase();
      const item = progress.value[i];
      if (item) item.state = "reading";
      await nextFrame();
      if (run !== generation) return;

      const data = new Uint8Array(await file.arrayBuffer());
      if (run !== generation) return;
      let read;
      try {
        read = await prepare(name, data);
      } catch (error) {
        if (error instanceof ImportError && error.detail) {
          received.push({ name, size: file.size, outcome: "failed", detail: error.detail });
          log.push(`[import] ${name.padEnd(13)} FAIL      ${error.detail}`);
        }
        throw error;
      }
      if (run !== generation) return;
      done.push(read);
      const archive = isArchiveName(name);
      received.push({
        name,
        size: file.size,
        outcome: "read",
        detail: archive
          ? `Read · ${describeContents(read.resources) || "no entries"}`
          : isProgramName(name)
            ? "Read · the game’s program"
            : "Read · tells the version",
      });
      log.push(
        `[import] ${name.padEnd(13)} ${archive ? `index ok  entries=${read.resources.length}` : "read ok  "} sha256=${read.sha256.slice(0, 12)}`,
      );
      foundSoFar.value = done.flatMap((a) => a.resources);
      if (item) item.state = "done";
    }
    return { files: done, seconds: (performance.now() - started) / 1000, log };
  } catch (error) {
    if (run === generation) fail(error, [...received, ...skipped], log);
    return undefined;
  }
}

/** Installs a language from the installation media. Files that don't change are kept as they were read. */
async function install(selected: GameFile[], language: string, log: string[]): Promise<GameFile[]> {
  const name = `${language}.RES`;
  let installed;
  try {
    installed = installLanguage(selected, language);
  } catch (error) {
    throw new ImportError(
      `Couldn't unpack ${name}`,
      "This language package is damaged, or it isn't one from the game's disks.",
      [],
      (error as Error).message,
    );
  }
  log.push(`[import] ${name.padEnd(13)} installed ${installed.map((f) => f.name).join(" ")}`);
  const kept = new Set<unknown>(selected);
  return Promise.all(installed.map((f) => (kept.has(f) ? (f as GameFile) : prepare(f.name, f.data))));
}

/** Combines the selected files into what the user sees before continuing. */
async function stage(
  selected: GameFile[],
  language: string | undefined,
  seconds: number,
  readLog: string[],
): Promise<Staging> {
  checkSelection(selected);
  const log = [...readLog];
  const languages = selected.filter((f) => isLanguagePackageName(f.name)).map((f) => f.name.replace(/\.RES$/, ""));
  if (language && !languages.includes(language)) language = undefined;
  const files = language ? await install(selected, language, log) : selected;
  const archives = files.filter((f) => isArchiveName(f.name));
  const { resources, replaced } = combineResources(archives);
  for (const r of replaced) log.push(`[import] ${r.name.padEnd(13)} replaced  by a later archive than ${r.archive}`);
  // Installation media only hold all images and palettes once a language is installed.
  const waiting = languages.length > 0 && !language;
  const check = waiting ? undefined : checkComplete(resources);
  log.push(check?.log ?? "[import] check         waiting   for a language to be chosen");
  const mapFile = files.find((f) => f.name === MAP_NAME);
  const map = mapFile ? checkMap(mapFile.data, archives) : undefined;
  if (map) log.push(map.log);
  const edition = detectEdition(files);
  log.push(
    `[import] version       ${edition.status.padEnd(9)} ${edition.status === "recognized" ? edition.profile.id : ""}`.trimEnd(),
  );
  return {
    selected,
    languages,
    language,
    files,
    resources,
    replaced,
    edition,
    map,
    error: check?.error,
    seconds,
    readLog,
    log,
  };
}

function load(staged: Staging): void {
  resources.value = staged.resources;
  archives.value = staged.files.map(({ name, size }) => ({ name, size }));
  edition.value = staged.edition;
  const exe = staged.files.find((f) => isProgramName(f.name));
  program.value = exe && { name: exe.name, data: exe.data };
  readSeconds.value = staged.seconds;
  if (!staged.resources.some((r) => r.name === selected.value)) selected.value = staged.resources[0]?.name;
  failure.value = undefined;
  staging.value = undefined;
  phase.value = "loaded";
}

/**
 * Reads a selection of files and stages it. When files can be added to the staged ones, they are merged and files
 * with the same name are replaced; otherwise the selection replaces them. Nothing is loaded until the user continues.
 */
export async function importFiles(files: File[]): Promise<void> {
  const result = await read(files, !!staging.value && canAddFiles(staging.value));
  if (!result) return;
  const run = generation;
  const previous = staging.value && canAddFiles(staging.value) ? staging.value : undefined;
  let next;
  try {
    next = await stage(
      mergeFiles(previous?.selected ?? [], result.files),
      previous?.language,
      (previous?.seconds ?? 0) + result.seconds,
      [...(previous?.readLog ?? []), ...result.log],
    );
  } catch (error) {
    if (run === generation) fail(error, [], result.log);
    return;
  }
  if (run !== generation) return;
  staging.value = next;
  failure.value = undefined;
  phase.value = "staged";
}

/** Installs a language from the staged installation media, or switches to another one. */
export async function chooseLanguage(language: string): Promise<void> {
  const staged = staging.value;
  if (!staged || staged.language === language) return;
  const run = ++generation;
  saving.value = false;
  try {
    const next = await stage(staged.selected, language, staged.seconds, staged.readLog);
    if (run === generation) staging.value = next;
  } catch (error) {
    if (run === generation) fail(error, [], staged.log);
  }
}

/** Loads the staged archives and saves them in this browser for next time. */
export async function confirmImport(): Promise<void> {
  const staged = staging.value;
  if (!staged || staged.error || needsLanguage(staged) || mapHasProblems(staged)) return;
  const run = ++generation;
  saving.value = true;
  try {
    await saveLibrary(staged.files, () => run === generation);
  } catch (error) {
    if (run === generation) fail(error, [], staged.log);
    return;
  } finally {
    if (run === generation) saving.value = false;
  }
  if (run === generation) load(staged);
}

/** Reloads the archives saved by an earlier import, if there are any. */
export async function restore(): Promise<void> {
  const run = generation;
  const files = await loadLibrary();
  if (run !== generation || !files.length) return;
  const result = await read(files);
  if (!result) return;
  const current = generation;
  let staged;
  try {
    staged = await stage(result.files, undefined, result.seconds, result.log);
  } catch (error) {
    if (current === generation) fail(error, [], result.log);
    return;
  }
  if (current !== generation) return;
  if (staged.error) fail(staged.error, [], staged.log);
  else load(staged);
}

/** Stops reading or saving and goes back to the previous state. */
export function cancel(): void {
  generation++;
  saving.value = false;
  phase.value = idle();
}

/** Drops the staged archives without loading them. */
export function discard(): void {
  cancel();
  staging.value = undefined;
  phase.value = idle();
}

/** Leaves the error state. */
export function dismiss(): void {
  failure.value = undefined;
  phase.value = idle();
}

/** Unloads the files and removes them from this browser. */
export async function forget(): Promise<void> {
  generation++;
  resources.value = [];
  archives.value = [];
  edition.value = undefined;
  program.value = undefined;
  staging.value = undefined;
  saving.value = false;
  selected.value = undefined;
  phase.value = "empty";
  await removeLibrary();
}

/** Opens the browser's file picker and imports the chosen files. */
export function pickFiles(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = () => {
    if (input.files?.length) void importFiles([...input.files]);
  };
  input.click();
}
