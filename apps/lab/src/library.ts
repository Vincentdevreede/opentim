import { ref } from "vue";

/**
 * Original game files loaded by the user. They are kept in the browser's
 * origin private file system (OPFS), so they survive reloads and never leave
 * the machine or end up in the repository.
 */
export interface LibraryFile {
  path: string;
  size: number;
}

export const files = ref<LibraryFile[]>([]);

async function root(): Promise<FileSystemDirectoryHandle> {
  const opfs = await navigator.storage.getDirectory();
  return opfs.getDirectoryHandle("library", { create: true });
}

async function locate(path: string, create: boolean) {
  const parts = path.split("/");
  const name = parts.pop() ?? path;
  let dir = await root();
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return { dir, name };
}

async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: LibraryFile[]) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix + name;
    if (handle.kind === "directory") {
      await walk(handle as FileSystemDirectoryHandle, `${path}/`, out);
    } else {
      const file = await (handle as FileSystemFileHandle).getFile();
      out.push({ path, size: file.size });
    }
  }
}

export async function refresh(): Promise<void> {
  const out: LibraryFile[] = [];
  await walk(await root(), "", out);
  files.value = out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function importFiles(input: Iterable<File>): Promise<void> {
  for (const file of input) {
    const { dir, name } = await locate(file.webkitRelativePath || file.name, true);
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await writable.write(file);
    await writable.close();
  }
  await refresh();
}

export async function readFile(path: string): Promise<Uint8Array> {
  const { dir, name } = await locate(path, false);
  const file = await (await dir.getFileHandle(name)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

export async function clearLibrary(): Promise<void> {
  const opfs = await navigator.storage.getDirectory();
  await opfs.removeEntry("library", { recursive: true });
  files.value = [];
}
