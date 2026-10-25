export interface MapArchive {
  /** Upper-case archive name, e.g. `RESOURCE.001`. */
  name: string;
  /** Offsets of the entry headers inside the archive, in the order of the map. */
  offsets: number[];
}

const HEADER_SIZE = 4;
const NAME_SIZE = 13;
const ENTRY_SIZE = 8;

export const MAP_NAME = "RESOURCE.MAP";

/**
 * Reads `RESOURCE.MAP`, the index the game uses to find resources in the archives. After a 4-byte header comes a
 * little-endian u16 archive count. Each archive has a 13-byte NUL-padded name, a u16 entry count, then 8 bytes per
 * entry: a u32 hash of the resource name and the u32 offset of its entry header.
 */
export function readMap(data: Uint8Array): MapArchive[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const need = (offset: number, size: number) => {
    if (offset + size > data.length) throw new Error(`Truncated map at offset ${offset}`);
  };
  need(0, HEADER_SIZE + 2);
  const count = view.getUint16(HEADER_SIZE, true);
  const archives: MapArchive[] = [];
  let offset = HEADER_SIZE + 2;
  for (let i = 0; i < count; i++) {
    need(offset, NAME_SIZE + 2);
    const field = data.subarray(offset, offset + NAME_SIZE);
    const end = field.indexOf(0);
    if (end < 1) throw new Error(`Invalid archive name at offset ${offset}`);
    const name = String.fromCharCode(...field.subarray(0, end)).toUpperCase();
    const entries = view.getUint16(offset + NAME_SIZE, true);
    offset += NAME_SIZE + 2;
    need(offset, entries * ENTRY_SIZE);
    const offsets = Array.from({ length: entries }, (_, j) => view.getUint32(offset + j * ENTRY_SIZE + 4, true));
    archives.push({ name, offsets });
    offset += entries * ENTRY_SIZE;
  }
  if (offset !== data.length) throw new Error(`${data.length - offset} unexpected bytes after the last archive`);
  return archives;
}

/** Builds a `RESOURCE.MAP`; the inverse of {@link readMap}, with zero hashes. Used by tests and tools. */
export function writeMap(archives: MapArchive[]): Uint8Array<ArrayBuffer> {
  const size = archives.reduce((sum, a) => sum + NAME_SIZE + 2 + a.offsets.length * ENTRY_SIZE, HEADER_SIZE + 2);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint16(HEADER_SIZE, archives.length, true);
  let offset = HEADER_SIZE + 2;
  for (const { name, offsets } of archives) {
    out.set(
      Array.from(name, (c) => c.charCodeAt(0)),
      offset,
    );
    view.setUint16(offset + NAME_SIZE, offsets.length, true);
    offset += NAME_SIZE + 2;
    for (const entry of offsets) {
      view.setUint32(offset + 4, entry, true);
      offset += ENTRY_SIZE;
    }
  }
  return out;
}
