/** The game files loaded into the lab, and the state of the import that loads them. */

import { ref, shallowRef } from "vue";
import {
  ImportError,
  checkComplete,
  checkSelection,
  describeContents,
  indexArchive,
  sortSelection,
  type Received,
  type Requirement,
  type Resource,
} from "./importer.ts";
import { loadLibrary, removeLibrary, saveLibrary } from "./storage.ts";

export type { Received, Requirement, Resource } from "./importer.ts";
export { canPersist } from "./storage.ts";

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

export type Phase = "empty" | "reading" | "loaded" | "error";

export const phase = ref<Phase>("empty");
export const archives = shallowRef<Archive[]>([]);
export const resources = shallowRef<Resource[]>([]);
export const readSeconds = ref(0);
export const progress = ref<FileProgress[]>([]);
export const foundSoFar = shallowRef<Resource[]>([]);
export const failure = shallowRef<ImportFailure>();
/** The resource selected in Overview and Files. */
export const selected = ref<string>();

let generation = 0;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function read(files: File[], persist: boolean): Promise<void> {
  const run = ++generation;
  const started = performance.now();
  const { archives: inputs, skipped, log } = sortSelection(files);
  // Archives are listed first, followed by the files that were skipped.
  const received: Received[] = [];

  progress.value = inputs.map((f) => ({ name: f.name.toUpperCase(), size: f.size, state: "queued" }));
  foundSoFar.value = [];
  phase.value = "reading";

  const found: Resource[] = [];
  const names = new Set<string>();
  const buffers: { name: string; data: Uint8Array }[] = [];
  try {
    checkSelection(inputs);
    for (const [i, file] of inputs.entries()) {
      const name = file.name.toUpperCase();
      const item = progress.value[i];
      if (item) item.state = "reading";
      await nextFrame();
      if (run !== generation) return;

      const data = new Uint8Array(await file.arrayBuffer());
      if (run !== generation) return;
      let own;
      try {
        own = indexArchive(name, data, names);
      } catch (error) {
        if (error instanceof ImportError && error.detail) {
          received.push({ name, size: file.size, outcome: "failed", detail: error.detail });
          log.push(`[import] ${name.padEnd(13)} FAIL      ${error.detail}`);
        }
        throw error;
      }
      for (const r of own) names.add(r.name);
      found.push(...own);
      buffers.push({ name, data });
      received.push({
        name,
        size: file.size,
        outcome: "read",
        detail: `Read · ${describeContents(own) || "no entries"}`,
      });
      log.push(`[import] ${name.padEnd(13)} index ok  entries=${own.length}`);
      foundSoFar.value = [...found];
      if (item) item.state = "done";
    }

    const check = checkComplete(found);
    log.push(check.log);
    if (check.error) throw check.error;

    if (persist) await saveLibrary(buffers, () => run === generation);
    if (run !== generation) return;
    resources.value = found.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    archives.value = inputs.map((f) => ({ name: f.name.toUpperCase(), size: f.size }));
    readSeconds.value = (performance.now() - started) / 1000;
    if (!found.some((r) => r.name === selected.value)) selected.value = resources.value[0]?.name;
    failure.value = undefined;
    phase.value = "loaded";
  } catch (error) {
    if (run !== generation) return;
    const e = error instanceof ImportError ? error : new ImportError("Import failed", String(error));
    failure.value = {
      title: e.title,
      message: e.message,
      received: [...received, ...skipped],
      requirements: e.requirements,
      log,
    };
    phase.value = "error";
  }
}

/** Imports a new selection of files. The previous library is only replaced when it succeeds. */
export const importFiles = (files: File[]) => read(files, true);

/** Reloads the archives saved by an earlier import, if there are any. */
export async function restore(): Promise<void> {
  const run = generation;
  const files = await loadLibrary();
  if (run === generation && files.length) await read(files, false);
}

/** Stops a running import and goes back to the previous state. */
export function cancel(): void {
  generation++;
  phase.value = resources.value.length ? "loaded" : "empty";
}

/** Leaves the error state. */
export function dismiss(): void {
  failure.value = undefined;
  phase.value = resources.value.length ? "loaded" : "empty";
}

/** Unloads the files and removes them from this browser. */
export async function forget(): Promise<void> {
  generation++;
  resources.value = [];
  archives.value = [];
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
