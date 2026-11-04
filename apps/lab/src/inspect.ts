/** Explains a byte of a resource: where it is, and what it means, from the fields the decoders read. */

import { ENTRY_HEADER_SIZE, readChunks, type Chunk } from "@opentim/resources";
import { fieldAt, type Field } from "./fields.ts";
import type { Resource } from "./importer.ts";

const CHUNK_HEADER = 8;

export interface Swatch {
  index: number;
  /** CSS colour, or undefined without a palette. */
  color?: string;
}

export interface ByteInfo {
  /** Where the byte is in its RESOURCE archive file. */
  archiveOffset: number;
  /** The innermost chunk holding the byte, and the byte's position in that chunk's data. */
  chunk?: { tag: string; relative: number; header: boolean };
  /** What the byte means, e.g. "width of frame 3: 32". */
  meaning?: string;
  /** What the field belongs to, e.g. a part of a level or a frame of an image. */
  group?: string;
  /** How the field's bytes are read, e.g. "u16 LE". */
  type?: string;
  /** More about it, e.g. where a command starts drawing. */
  detail?: string;
  swatches?: Swatch[];
  /** The frame of the image the byte belongs to. */
  frame?: number;
  /** An offset the byte points to, to jump to. */
  jump?: number;
  /** The bytes that belong together with this one, like a u16 or a SCN command. */
  range?: [start: number, end: number];
}

const chunkCache = new WeakMap<Resource, Chunk[]>();

function chunksOf(resource: Resource): Chunk[] {
  let chunks = chunkCache.get(resource);
  if (!chunks) {
    try {
      chunks = readChunks(resource.data);
    } catch {
      chunks = [];
    }
    chunkCache.set(resource, chunks);
  }
  return chunks;
}

/** The innermost chunk holding an offset. */
function chunkAt(chunks: Chunk[], offset: number): Chunk | undefined {
  for (const chunk of chunks) {
    if (offset < chunk.offset || offset >= chunk.offset + CHUNK_HEADER + chunk.data.length) continue;
    return chunkAt(chunk.children, offset) ?? chunk;
  }
  return undefined;
}

/** CSS colour of a palette index, from 8-bit RGB triples. */
export const cssColor = (palette: Uint8Array | undefined, index: number) =>
  palette && index * 3 + 2 < palette.length
    ? `rgb(${palette[index * 3]} ${palette[index * 3 + 1]} ${palette[index * 3 + 2]})`
    : undefined;

/**
 * Explains the byte at `offset` with the resource's `fields`. `palette` colours the swatches: the image's palette, or
 * for a palette resource, its own colours.
 */
export function inspectByte(
  resource: Resource,
  offset: number,
  fields: readonly Field[],
  palette?: Uint8Array,
): ByteInfo {
  const info: ByteInfo = { archiveOffset: resource.offset + ENTRY_HEADER_SIZE + offset };
  const chunk = chunkAt(chunksOf(resource), offset);
  if (chunk) {
    const relative = offset - chunk.offset - CHUNK_HEADER;
    info.chunk =
      relative < 0
        ? { tag: chunk.tag, relative: offset - chunk.offset, header: true }
        : { tag: chunk.tag, relative, header: false };
  }
  const field = fieldAt(fields, offset);
  if (!field) {
    if (chunk) info.meaning = "not read by the lab";
    return info;
  }
  info.range = [field.offset, field.offset + field.size];
  info.meaning = field.value ? `${field.name}: ${field.value}` : field.name;
  info.type = field.type;
  if (field.group) info.group = field.group;
  if (field.detail) info.detail = field.detail;
  if (field.colors) info.swatches = field.colors.map((index) => ({ index, color: cssColor(palette, index) }));
  if (field.frame !== undefined) info.frame = field.frame;
  if (field.jump !== undefined) info.jump = field.jump;
  return info;
}
