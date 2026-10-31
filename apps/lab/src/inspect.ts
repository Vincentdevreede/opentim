/** Explains a byte of a resource: where it is, and what it means in its chunk. */

import {
  ENTRY_HEADER_SIZE,
  findChunk,
  readChunks,
  readScnCommands,
  type Chunk,
  type ScnCommand,
} from "@opentim/resources";
import type { Resource } from "./importer.ts";
import { hex } from "./ui.ts";

const CHUNK_HEADER = 8;
const COMPRESSION = ["none", "RLE", "LZW"];

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

/** The innermost chunk holding an offset, with its container. */
function chunkAt(chunks: Chunk[], offset: number, parent?: Chunk): { chunk: Chunk; parent?: Chunk } | undefined {
  for (const chunk of chunks) {
    if (offset < chunk.offset || offset >= chunk.offset + CHUNK_HEADER + chunk.data.length) continue;
    return chunkAt(chunk.children, offset, chunk) ?? { chunk, parent };
  }
  return undefined;
}

const u16 = (data: Uint8Array, at: number) => (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
const u32 = (data: Uint8Array, at: number) => (u16(data, at) + u16(data, at + 2) * 65536) >>> 0;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** CSS colour of a palette index, from 8-bit RGB triples. */
const cssColor = (palette: Uint8Array | undefined, index: number) =>
  palette && index * 3 + 2 < palette.length
    ? `rgb(${palette[index * 3]} ${palette[index * 3 + 1]} ${palette[index * 3 + 2]})`
    : undefined;

/**
 * Explains the byte at `offset`. `palette` colours the swatches: the image's palette, or for a palette resource, its
 * own colours.
 */
export function inspectByte(resource: Resource, offset: number, palette?: Uint8Array): ByteInfo {
  const info: ByteInfo = { archiveOffset: resource.offset + ENTRY_HEADER_SIZE + offset };
  const chunks = chunksOf(resource);
  const found = chunkAt(chunks, offset);
  if (!found) return info;
  const { chunk, parent } = found;
  const start = chunk.offset + CHUNK_HEADER;
  const relative = offset - start;
  const swatch = (index: number): Swatch => ({ index, color: cssColor(palette, index) });

  if (relative < 0) {
    const field = offset - chunk.offset;
    info.chunk = { tag: chunk.tag, relative: field, header: true };
    const container = chunk.children.length > 0;
    if (field < 4) {
      info.meaning = `tag ${chunk.tag}`;
      info.range = [chunk.offset, chunk.offset + 4];
    } else {
      info.meaning = `size: ${plural(chunk.data.length, "byte")}`;
      info.detail = container ? "The high bit marks a container of more chunks." : undefined;
      info.range = [chunk.offset + 4, start];
    }
    return info;
  }
  info.chunk = { tag: chunk.tag, relative, header: false };
  const data = chunk.data;
  const field = (size: number) => {
    const at = relative - (relative % size);
    info.range = [start + at, start + at + size];
    return at;
  };

  switch (chunk.tag) {
    case "INF:": {
      const count = u16(data, 0);
      if (relative < 2) {
        field(2);
        info.meaning = `frame count: ${count}`;
      } else {
        const index = (field(2) - 2) / 2;
        const height = index >= count;
        const frame = height ? index - count : index;
        info.frame = frame;
        info.meaning = `${height ? "height" : "width"} of frame ${frame}: ${u16(data, 2 + index * 2)}`;
      }
      break;
    }
    case "DIM:": {
      const at = field(2);
      info.meaning = `${at ? "height" : "width"}: ${u16(data, at)}`;
      break;
    }
    case "OFF:": {
      const frame = field(4) / 4;
      const value = u32(data, frame * 4);
      info.frame = frame;
      const scn = findChunk(chunks, "SCN:");
      info.meaning = `frame ${frame} starts at SCN: + ${hex(value, 4)}`;
      if (scn) info.jump = scn.offset + CHUNK_HEADER + value;
      break;
    }
    case "SCN:":
      Object.assign(info, scnByte(chunks, data, start, relative, swatch));
      break;
    case "BIN:":
    case "VGA:":
      if (parent?.tag === "PAL:") {
        const color = Math.floor(relative / 3);
        const at = color * 3;
        const [r, g, b] = [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
        info.range = [start + at, start + at + 3];
        info.meaning = `colour ${color}: ${["red", "green", "blue"][relative % 3]} of R ${r} G ${g} B ${b}`;
        info.detail = "6 bits per channel, 0–63";
        info.swatches = [swatch(color)];
      } else if (relative === 0) {
        info.meaning = `compression: ${COMPRESSION[data[0]!] ?? "unknown"} (${data[0]})`;
      } else if (relative < 5) {
        info.range = [start + 1, start + 5];
        info.meaning = `unpacked size: ${plural(u32(data, 1), "byte")}`;
      } else {
        info.meaning = `compressed ${chunk.tag === "BIN:" ? "low" : "high"} 4 bits of the pixels`;
        info.detail = `${plural(data.length - 5, "byte")} unpack to ${plural(u32(data, 1), "byte")}`;
      }
      break;
    default:
      info.meaning = "not read by the lab";
  }
  return info;
}

/** Explains a byte of a SCN: chunk: the command it belongs to in its frame. */
function scnByte(
  chunks: Chunk[],
  data: Uint8Array,
  start: number,
  relative: number,
  swatch: (index: number) => Swatch,
): Partial<ByteInfo> {
  const off = findChunk(chunks, "OFF:")?.data;
  const inf = findChunk(chunks, "INF:")?.data;
  if (!off || !inf) return { meaning: "drawing commands" };
  const count = off.length / 4;
  let frame = 0;
  while (frame + 1 < count && u32(off, (frame + 1) * 4) <= relative) frame++;
  const begin = u32(off, frame * 4);
  const end = frame + 1 < count ? u32(off, (frame + 1) * 4) : data.length;
  const commands = readScnCommands(data.subarray(begin, end), u16(inf, 2 + frame * 2));
  const command = commands.find((c) => relative >= begin + c.offset && relative < begin + c.offset + c.length);
  if (!command) return { frame, meaning: `frame ${frame}, after its end command` };
  const range: [number, number] = [start + begin + command.offset, start + begin + command.offset + command.length];
  return { frame, ...scnCommand(frame, command, range, swatch) };
}

function scnCommand(
  frame: number,
  command: ScnCommand,
  range: [number, number],
  swatch: (index: number) => Swatch,
): Partial<ByteInfo> {
  const where = `at x ${command.x}, y ${command.y}`;
  switch (command.type) {
    case "base":
      return { range, meaning: `frame ${frame} · base colour ${command.count}`, detail: "Added to every colour" };
    case "line":
      return {
        range,
        meaning: `frame ${frame} · next line, ${plural(command.count, "pixel")} left`,
        detail: `From x ${command.x}, y ${command.y}`,
      };
    case "skip":
      return { range, meaning: `frame ${frame} · skip ${plural(command.count, "pixel")}`, detail: where };
    case "repeat":
      return {
        range,
        meaning: `frame ${frame} · repeat colour ${command.colors[0]} × ${command.count}`,
        detail: where,
        swatches: command.colors.map(swatch),
      };
    case "copy":
      return {
        range,
        meaning: `frame ${frame} · copy ${plural(command.count, "colour")}`,
        detail: where,
        swatches: command.colors.map(swatch),
      };
    case "end":
      return { range, meaning: `frame ${frame} · end of frame` };
  }
}
