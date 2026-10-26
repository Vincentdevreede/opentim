/** Marks the bytes of a resource that a decoder read: its chunks, and where decoding stopped. */

import { FormatError, readChunks, readPalette, type Chunk } from "@opentim/resources";
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
      return "frame count, widths and heights";
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

/** The markers of a resource, from the decoders the lab has for its kind. */
export function markersOf(resource: Resource): Markers {
  const image = isImage(resource);
  if (!image && resource.group !== "palette")
    return { markers: [], note: "No decoder reads this kind of file yet, so no bytes are marked." };

  let error: Marker | undefined;
  if (image) {
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
  for (const { offset, end } of markers) {
    if (offset === undefined || end === undefined) continue;
    for (let i = 0; i < CHUNK_HEADER; i++) bytes.add(offset + i);
  }
  return bytes;
}
