/** Marks the bytes of a resource that a decoder read: its chunks or fields, and where decoding stopped. */

import { LevelError, readLevel, type LevelLayout, type PartGroup } from "@opentim/content";
import { FormatError, readChunks, readPalette, readSoundBank, type Chunk } from "@opentim/resources";
import type { Resource } from "./importer.ts";
import { decode, isImage } from "./sprites.ts";

const CHUNK_HEADER = 8;

export interface Marker {
  /** Where the marker starts, or undefined when the decoder couldn't tell. */
  offset?: number;
  /** The end of the bytes the marker covers, for chunks. */
  end?: number;
  /** A chunk's tag, like `INF:`, or "Stopped" where a decoder stopped. */
  label: string;
  detail: string;
  /** How deep a chunk is nested in containers. */
  depth: number;
  error?: boolean;
  /** Set for chunks, whose first 8 bytes are a header to tint. */
  chunk?: boolean;
}

export interface Markers {
  markers: Marker[];
  /** Explains a resource without markers. */
  note?: string;
}

/** What each chunk holds, by tag. */
function holds(chunk: Chunk, parent?: Chunk): string {
  switch (chunk.tag) {
    case "BMP:":
      return "sprite sheet";
    case "SCR:":
      return "screen";
    case "PAL:":
      return "palette";
    case "INF:":
      return parent?.tag === "SND:" ? "sound ids and where their DAT: chunks start" : "frame count, widths and heights";
    case "SND:":
      return "sound bank";
    case "DAT:":
      return "a sound: its id, two unknown bytes, then the sound packed as type 3";
    case "TAG:":
      return "the names of the sounds";
    case "OFF:":
      return "where each frame starts in SCN:";
    case "SCN:":
      return "drawing commands for every frame";
    case "DIM:":
      return "screen width and height";
    case "BIN:":
      return "pixels, low 4 bits";
    case "VGA:":
      return parent?.tag === "PAL:" ? "256 colours, 6 bits per channel" : "pixels, high 4 bits";
    default:
      return "not read by the lab";
  }
}

function chunkMarkers(chunks: Chunk[], depth = 0, parent?: Chunk): Marker[] {
  return chunks.flatMap((chunk) => [
    {
      offset: chunk.offset,
      end: chunk.offset + CHUNK_HEADER + chunk.data.length,
      label: chunk.tag,
      detail: `${holds(chunk, parent)} · ${chunk.data.length.toLocaleString("en-US")} B`,
      depth,
      chunk: true,
    },
    ...chunkMarkers(chunk.children, depth + 1, chunk),
  ]);
}

const stopped = (message: string, offset?: number): Marker => ({
  offset,
  label: "Stopped",
  detail: message,
  depth: 0,
  error: true,
});

const GROUPS: Record<PartGroup, string> = { static: "Static parts", moving: "Moving parts", bin: "Parts bin" };

/**
 * The markers of a level or scene: its header with every field, then each group of parts with every part. `nameOf`
 * names a part by its number.
 */
function levelMarkers(resource: Resource, layout: LevelLayout, nameOf: (type: number) => string): Markers {
  let level;
  try {
    level = readLevel(resource.data, { layout, name: resource.name });
  } catch (e) {
    return { markers: [stopped((e as Error).message, e instanceof LevelError ? e.offset : undefined)] };
  }
  const first = level.parts[0]?.offset ?? level.length;
  const header = level.fields.filter((f) => f.offset < first);
  const markers: Marker[] = [
    { offset: 0, end: first, label: "Header", detail: `${header.length} fields · ${first} B`, depth: 0 },
    ...header.map((f) => ({
      offset: f.offset,
      end: f.offset + f.size,
      label: f.key,
      detail:
        typeof f.value === "string"
          ? `“${f.value}”`
          : f.key === "magic" || f.key === "version"
            ? `0x${f.value.toString(16).toUpperCase()}`
            : String(f.value),
      depth: 1,
    })),
  ];
  // Fields between the groups, like binFlag before the parts bin, are marked once, with the group they come before.
  let from = first;
  for (const group of ["static", "moving", "bin"] as const) {
    const parts = level.parts.filter((p) => p.group === group);
    if (!parts.length && group !== "bin") continue;
    const until = parts[0]?.offset ?? level.length;
    const later = level.fields.filter((f) => f.offset >= from && f.offset < until);
    for (const f of later)
      markers.push({ offset: f.offset, end: f.offset + f.size, label: f.key, detail: String(f.value), depth: 0 });
    from = until;
    if (!parts.length) continue;
    const start = parts[0]!.offset;
    const end = parts.at(-1)!.offset + parts.at(-1)!.length;
    markers.push({
      offset: start,
      end,
      label: GROUPS[group],
      detail: `${parts.length} parts · ${end - start} B`,
      depth: 0,
    });
    for (const p of parts)
      markers.push({
        offset: p.offset,
        end: p.offset + p.length,
        label: `#${p.index}`,
        detail: `${nameOf(p.type)} at ${p.position.x}, ${p.position.y} · ${p.length} B`,
        depth: 1,
      });
  }
  return {
    markers,
    note: "Markers come from the level reader, which accounts for every byte. Click one to jump to it.",
  };
}

/** The markers of a resource, from the decoders the lab has for its kind. */
export function markersOf(
  resource: Resource,
  {
    layout = "tim",
    nameOf = (type) => `type ${type}`,
  }: { layout?: LevelLayout; nameOf?: (type: number) => string } = {},
): Markers {
  if (resource.group === "level" || resource.group === "scene") return levelMarkers(resource, layout, nameOf);
  const image = isImage(resource);
  const bank = resource.group === "sound" && resource.name.endsWith(".SX");
  if (resource.group === "sound" && resource.name.endsWith(".RAW"))
    return { markers: [], note: "A .RAW file has no header or chunks: every byte is one sample." };
  if (!image && !bank && resource.group !== "palette")
    return { markers: [], note: "No decoder reads this kind of file yet, so no bytes are marked." };

  let error: Marker | undefined;
  if (bank) {
    try {
      readSoundBank(resource.data);
    } catch (e) {
      error = stopped((e as Error).message, e instanceof FormatError ? e.offset : undefined);
    }
  } else if (image) {
    const result = decode(resource);
    if (result.status === "text") return { markers: [], note: "This file is text, so the image decoder skipped it." };
    if (result.status === "error") error = stopped(result.message, result.offset);
  } else {
    try {
      readPalette(resource.data);
    } catch (e) {
      error = stopped((e as Error).message, e instanceof FormatError ? e.offset : undefined);
    }
  }

  let chunks: Marker[] = [];
  try {
    chunks = chunkMarkers(readChunks(resource.data));
  } catch {
    // The decoder failed on the chunks themselves; its error marker says where.
  }
  return { markers: error ? [error, ...chunks] : chunks };
}

/** The innermost chunk marker that holds this byte. */
export const markerAt = (markers: Marker[], offset: number) =>
  markers.findLast((m) => m.end !== undefined && m.offset !== undefined && offset >= m.offset && offset < m.end);

/** The bytes of chunk headers, to tint in the hex view. */
export function headerBytes(markers: Marker[]): Set<number> {
  const bytes = new Set<number>();
  for (const { offset, end, chunk } of markers) {
    if (!chunk || offset === undefined || end === undefined) continue;
    for (let i = 0; i < CHUNK_HEADER; i++) bytes.add(offset + i);
  }
  return bytes;
}
