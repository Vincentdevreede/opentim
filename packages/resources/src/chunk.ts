export interface Chunk {
  /** Three characters and a colon, e.g. `BMP:`. */
  tag: string;
  /** Position of the chunk's header in the resource. Its data starts 8 bytes later. */
  offset: number;
  data: Uint8Array;
  /** The chunks inside a container chunk; none for others. */
  children: Chunk[];
}

const HEADER_SIZE = 8;
const MAX_DEPTH = 16;
const CONTAINER = 0x80000000;

/** A damaged resource. */
export class FormatError extends Error {
  /** Where in the resource's data reading stopped, when that is known. */
  readonly offset?: number;

  constructor(message: string, offset?: number) {
    super(message);
    this.offset = offset;
  }
}

/**
 * Reads the chunks of a Dynamix resource, like a sprite sheet or palette. Each chunk has a 4-byte tag, a little-endian
 * u32 size, then its data. The high bit of the size marks a container, whose data holds more chunks.
 */
export function readChunks(data: Uint8Array, depth = 0, base = 0): Chunk[] {
  if (depth > MAX_DEPTH) throw new FormatError("Chunks are nested too deep", base);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunks: Chunk[] = [];
  let offset = 0;
  while (offset < data.length) {
    const at = base + offset;
    if (data.length - offset < HEADER_SIZE) throw new FormatError(`Truncated chunk header at offset ${at}`, at);
    const tag = String.fromCharCode(...data.subarray(offset, offset + 4));
    if (!/^[A-Z0-9_ ]{3}:$/.test(tag)) throw new FormatError(`No chunk at offset ${at}`, at);
    const field = view.getUint32(offset + 4, true);
    const size = field & ~CONTAINER;
    if (size > data.length - offset - HEADER_SIZE) throw new FormatError(`Truncated ${tag} chunk at offset ${at}`, at);
    const body = data.subarray(offset + HEADER_SIZE, offset + HEADER_SIZE + size);
    const children = field & CONTAINER ? readChunks(body, depth + 1, at + HEADER_SIZE) : [];
    chunks.push({ tag, offset: at, data: body, children });
    offset += HEADER_SIZE + size;
  }
  return chunks;
}

/** Finds the first chunk with this tag, searching inside containers too. */
export function findChunk(chunks: Chunk[], tag: string): Chunk | undefined {
  for (const chunk of chunks) {
    if (chunk.tag === tag) return chunk;
    const nested = findChunk(chunk.children, tag);
    if (nested) return nested;
  }
  return undefined;
}

/** Builds chunks; the inverse of {@link readChunks}. Used by tests and tools. */
export function writeChunk(tag: string, content: Uint8Array | Uint8Array[]): Uint8Array<ArrayBuffer> {
  const container = Array.isArray(content);
  const body = container ? concat(content) : content;
  const out = new Uint8Array(HEADER_SIZE + body.length);
  out.set(
    Array.from(tag, (c) => c.charCodeAt(0)),
    0,
  );
  new DataView(out.buffer).setUint32(4, (body.length | (container ? CONTAINER : 0)) >>> 0, true);
  out.set(body, HEADER_SIZE);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
