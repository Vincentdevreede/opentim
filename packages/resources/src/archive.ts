export interface ArchiveEntry {
  /** Upper-case resource name, e.g. `PART1.BMP`. */
  name: string;
  /** Archive the entry was read from, e.g. `RESOURCE.001`. */
  archive: string;
  /** Offset of the entry header inside the archive. */
  offset: number;
  /** The entry's bytes, as a view into the archive buffer. */
  data: Uint8Array;
}

const HEADER_SIZE = 17;
const NAME_SIZE = 13;
const MAX_ARCHIVE_SIZE = 64 * 1024 * 1024;

export const isArchiveName = (name: string) => /^RESOURCE\.\d{3}$/i.test(name);

/**
 * Reads a `RESOURCE.00x` archive of the original DOS game. The archive is a plain
 * sequence of entries: a 13-byte NUL-padded name, a little-endian u32 size, then the data.
 */
export function readArchive(data: Uint8Array, archive: string): ArchiveEntry[] {
  if (data.length > MAX_ARCHIVE_SIZE) throw new Error(`${archive} exceeds the 64 MiB limit`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (offset < data.length) {
    if (data.length - offset < HEADER_SIZE) throw new Error(`Truncated entry header at offset ${offset}`);
    const field = data.subarray(offset, offset + NAME_SIZE);
    const end = field.indexOf(0);
    if (end < 1) throw new Error(`Invalid resource name at offset ${offset}`);
    const name = String.fromCharCode(...field.subarray(0, end));
    if (!/^[A-Za-z0-9_!.-]+$/.test(name) || name.includes("..")) {
      throw new Error(`Unsafe resource name at offset ${offset}`);
    }
    const size = view.getUint32(offset + NAME_SIZE, true);
    if (size > data.length - offset - HEADER_SIZE) throw new Error(`Truncated resource ${name} at offset ${offset}`);
    const start = offset + HEADER_SIZE;
    entries.push({ name: name.toUpperCase(), archive, offset, data: data.subarray(start, start + size) });
    offset = start + size;
  }
  return entries;
}

/** Builds a `RESOURCE.00x` archive from entries; the inverse of {@link readArchive}. Used by tests and tools. */
export function writeArchive(entries: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(entries.reduce((sum, e) => sum + HEADER_SIZE + e.data.length, 0));
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const { name, data } of entries) {
    if (name.length < 1 || name.length >= NAME_SIZE || !/^[A-Za-z0-9_!.-]+$/.test(name) || name.includes("..")) {
      throw new Error(`Invalid resource name: ${name}`);
    }
    out.set(
      Array.from(name, (c) => c.charCodeAt(0)),
      offset,
    );
    view.setUint32(offset + NAME_SIZE, data.length, true);
    out.set(data, offset + HEADER_SIZE);
    offset += HEADER_SIZE + data.length;
  }
  return out;
}
