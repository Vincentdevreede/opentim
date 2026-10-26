import { ref } from "vue";
import { isVersionFile } from "./edition.ts";

/**
 * Keeps imported game files in the browser's origin private file system (OPFS), so
 * they survive reloads and never leave the machine. Each import is written to a fresh
 * directory and only becomes the active library once it is complete; localStorage points
 * at the active one.
 */

const LEGACY_LIBRARY = "library";
const ACTIVE_LIBRARY = "opentim.lab.library";

/**
 * False when this browser can't keep files, for example outside a secure context (a dev
 * server opened through a network IP) or with site storage blocked. Imports then only
 * last for the current tab.
 */
export const canPersist = ref(true);

/** The active library directory, or null when there is none. */
function activeLibrary(): string | null {
  try {
    // An empty value means the library was removed; don't fall back to the legacy one.
    return localStorage.getItem(ACTIVE_LIBRARY) ?? LEGACY_LIBRARY;
  } catch {
    return null;
  }
}

async function root(): Promise<FileSystemDirectoryHandle | undefined> {
  if (!canPersist.value) return undefined;
  try {
    // Both throw when storage is unavailable or blocked.
    void localStorage.length;
    // Some browsers (Safari before 17) have OPFS but can only write to it from a worker.
    if (!("createWritable" in FileSystemFileHandle.prototype)) throw new Error("OPFS can't be written here");
    return await navigator.storage.getDirectory();
  } catch {
    canPersist.value = false;
    return undefined;
  }
}

/**
 * Saves the files of a successful import as the new library. `isCurrent` returns false
 * once the import was cancelled or replaced, so a stale import never becomes active.
 */
export async function saveLibrary(
  buffers: { name: string; data: Uint8Array }[],
  isCurrent: () => boolean,
): Promise<void> {
  const opfs = await root();
  if (!opfs || !isCurrent()) return;
  const staging = `${LEGACY_LIBRARY}-${crypto.randomUUID()}`;
  let committed = false;
  try {
    const dir = await opfs.getDirectoryHandle(staging, { create: true });
    for (const { name, data } of buffers) {
      if (!isCurrent()) return;
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      try {
        await writable.write(data as Uint8Array<ArrayBuffer>);
        if (!isCurrent()) {
          await writable.abort();
          return;
        }
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
    }
    if (!isCurrent()) return;
    const previous = activeLibrary();
    // Publishing the completed directory is synchronous, so cancellation cannot
    // interleave between the check above and switching the active library.
    localStorage.setItem(ACTIVE_LIBRARY, staging);
    committed = true;
    if (previous) void opfs.removeEntry(previous, { recursive: true }).catch(() => {});
  } finally {
    if (!committed) await opfs.removeEntry(staging, { recursive: true }).catch(() => {});
  }
}

/** The files of the active library, or none when nothing was saved. */
export async function loadLibrary(): Promise<File[]> {
  const opfs = await root();
  const name = activeLibrary();
  if (!opfs || !name) return [];
  try {
    const dir = await opfs.getDirectoryHandle(name);
    const files: File[] = [];
    for await (const [entry, handle] of dir.entries()) {
      if (handle.kind === "file" && isVersionFile(entry)) files.push(await (handle as FileSystemFileHandle).getFile());
    }
    return files;
  } catch {
    return [];
  }
}

/** Removes the saved library from this browser. */
export async function removeLibrary(): Promise<void> {
  const previous = activeLibrary();
  try {
    localStorage.setItem(ACTIVE_LIBRARY, "");
  } catch {
    // Storage is blocked, so there is nothing saved to remove either.
  }
  const opfs = await root();
  if (opfs && previous) await opfs.removeEntry(previous, { recursive: true }).catch(() => {});
}
