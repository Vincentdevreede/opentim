/**
 * The fields of a resource: what each run of bytes means, as the decoders read it. The Files page draws them under the
 * hex view and explains the selected byte with them. Files without a decoder are read as little-endian words, with
 * runs of letters kept as text, so their numbers can still be read.
 */

import { readLevel, type LevelField, type LevelLayout } from "@opentim/content";
import { findChunk, readChunks, readScnCommands, type Chunk, type ScnCommand } from "@opentim/resources";
import type { Resource } from "./importer.ts";

const CHUNK_HEADER = 8;
const NONE = 0xffff;
const COMPRESSION = ["none", "RLE", "LZW"];
/** Runs of at least this many letters read as text where no decoder knows the bytes. */
const MIN_TEXT = 4;

/** What a field holds, which sets its colour. */
export type FieldKind = "id" | "text" | "setting" | "size" | "position" | "flags" | "link" | "colour" | "data" | "word";

export interface Field {
  offset: number;
  /** In bytes. */
  size: number;
  /** Short name drawn under the bytes, like `width`. */
  label: string;
  /** Full name for the side panel, like `width of frame 3`. */
  name: string;
  /** The value as read, like `32`, `0x102` or a quoted text. */
  value: string;
  kind: FieldKind;
  /** How the bytes are read, like `u16 LE`. */
  type: string;
  /** What the field belongs to, like `part #3 · static · Wood incline` or `frame 2`. */
  group?: string;
  detail?: string;
  /** Palette indexes the field holds or draws. */
  colors?: number[];
  /** The frame of an image the field belongs to. */
  frame?: number;
  /** An offset in the resource the field points to. */
  jump?: number;
}

export interface FieldOptions {
  layout?: LevelLayout;
  /** Names a part by its number. */
  nameOf?: (type: number) => string;
}

const u16 = (data: Uint8Array, at: number) => (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
const u32 = (data: Uint8Array, at: number) => (u16(data, at) + u16(data, at + 2) * 65536) >>> 0;
const hex = (n: number, width: number) => "0x" + n.toString(16).toUpperCase().padStart(width, "0");
const printable = (v: number | undefined) => v !== undefined && v >= 0x20 && v < 0x7f;
const quote = (text: string) => `“${text}”`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Reads `data[start, end)` as little-endian u16 words, from `start`. Runs of letters stay text, cut to a whole number
 * of words so the words after them keep their alignment.
 */
export function wordFields(data: Uint8Array, start = 0, end = data.length): Field[] {
  const out: Field[] = [];
  let at = start;
  while (at < end) {
    let run = at;
    while (run < end && printable(data[run])) run++;
    const letters = (run - at) & ~1;
    if (letters >= MIN_TEXT) {
      const text = String.fromCharCode(...data.subarray(at, at + letters));
      out.push({
        offset: at,
        size: letters,
        label: "text",
        name: "text",
        value: quote(text),
        kind: "text",
        type: "letters",
      });
      at += letters;
    } else if (at + 1 < end) {
      out.push({
        offset: at,
        size: 2,
        label: "",
        name: "word",
        value: String(u16(data, at)),
        kind: "word",
        type: "u16 LE",
      });
      at += 2;
    } else {
      out.push({ offset: at, size: 1, label: "", name: "byte", value: String(data[at]), kind: "word", type: "u8" });
      at += 1;
    }
  }
  return out;
}

// Levels

/** Short labels for level keys, where the last part of the key alone would be unclear. */
const LEVEL_LABELS: Record<string, string> = {
  "bonus.0": "bonus 1",
  "bonus.1": "bonus 2",
  airPressure: "air",
  "scroll.x": "scroll x",
  "scroll.y": "scroll y",
  "size2.width": "width2",
  "size2.height": "height2",
  "belt.width": "belt w",
  outline: "points",
};
const SIGNED = /^(state\.\d|position\.[xy]|extra|scroll\.[xy])$/;

function levelLabel(key: string): string {
  if (LEVEL_LABELS[key]) return LEVEL_LABELS[key];
  const parts = key.split(".").filter((p) => !/^\d+$/.test(p));
  if (parts[0] === "ropes") parts[0] = "rope";
  if (parts[0] === "links" || parts[0] === "plugs") return parts[0].slice(0, -1);
  if (parts.length > 1 && (parts.at(-1) === "x" || parts.at(-1) === "y") && parts[0] !== "position")
    return parts[0] === "outline" ? parts.at(-1)! : `${parts[0]} ${parts.at(-1)}`;
  if (parts.at(-1) === "parts") return `${parts[0]} part`;
  return parts.at(-1) ?? key;
}

function levelKind(key: string): FieldKind {
  if (key === "magic" || key === "version" || key === "type") return "id";
  if (key === "title" || key === "goal") return "text";
  if (key.startsWith("flags.")) return "flags";
  if (/^(size2?\.|belt\.width)/.test(key)) return "size";
  if (/^position\.|\.at\.[xy]$|^outline\.\d/.test(key)) return "position";
  if (/^(belt|ropes\.\d)$|parts\.\d$|^(links|plugs)\.\d$|^(pulley|tunnel)$/.test(key)) return "link";
  return "setting";
}

function levelField(field: LevelField, group?: string): Field {
  const { key, offset, size, value } = field;
  const kind = levelKind(key);
  const out: Field = {
    offset,
    size,
    label: levelLabel(key),
    name: key,
    value: String(value),
    kind,
    type: "u16 LE",
    group,
  };
  if (typeof value === "string") {
    out.value = quote(value);
    out.type = "text, ends with a zero byte";
  } else if (size === 1) out.type = "u8";
  else if (SIGNED.test(key)) out.type = "i16 LE";
  if (typeof value !== "number") return out;
  if (key === "magic") out.value = hex(value, 4).slice(2);
  else if (key === "version") out.value = hex(value, 3);
  else if (kind === "flags") out.value = hex(value, 4).slice(2);
  else if (kind === "link" && size === 2) {
    if (/^(belt|ropes\.\d)$/.test(key)) {
      out.value = value ? "yes" : "no";
      out.type = "u16, 0 = none";
    } else {
      out.value = value === NONE ? "none" : `#${value}`;
      out.type = "u16, FFFF = none";
    }
  }
  return out;
}

const GROUP_NAMES = { static: "static", moving: "moving", bin: "parts bin" };

function levelFields(resource: Resource, options: FieldOptions): Field[] | undefined {
  let level;
  try {
    level = readLevel(resource.data, { layout: options.layout, name: resource.name });
  } catch {
    return undefined;
  }
  const out = level.fields.map((f) => levelField(f));
  for (const part of level.parts) {
    const name = options.nameOf?.(part.type);
    const group = [`part #${part.index}`, GROUP_NAMES[part.group], name].filter(Boolean).join(" · ");
    out.push(...part.fields.map((f) => levelField(f, group)));
  }
  return out.sort((a, b) => a.offset - b.offset);
}

// Chunks

function chunkFields(all: Chunk[], chunks: Chunk[], parent?: Chunk): Field[] {
  return chunks.flatMap((chunk) => {
    const container = chunk.children.length > 0;
    const header: Field[] = [
      {
        offset: chunk.offset,
        size: 4,
        label: "tag",
        name: "chunk tag",
        value: chunk.tag,
        kind: "id",
        type: "4 letters",
      },
      {
        offset: chunk.offset + 4,
        size: 4,
        label: "size",
        name: "chunk size",
        value: String(chunk.data.length),
        kind: "size",
        type: "u32 LE, high bit = container",
        detail: container ? "The high bit marks a container of more chunks." : undefined,
      },
    ];
    return [...header, ...(container ? chunkFields(all, chunk.children, chunk) : dataFields(all, chunk, parent))];
  });
}

function dataFields(all: Chunk[], chunk: Chunk, parent?: Chunk): Field[] {
  const start = chunk.offset + CHUNK_HEADER;
  const data = chunk.data;
  const at = (relative: number) => start + relative;
  const words = () => wordFields(chunk.data, 0).map((f) => ({ ...f, offset: at(f.offset) }));

  switch (chunk.tag) {
    case "INF:": {
      if (parent?.tag === "SND:") return words();
      const count = u16(data, 0);
      if (data.length !== 2 + count * 4) return words();
      const out: Field[] = [
        {
          offset: start,
          size: 2,
          label: "count",
          name: "frame count",
          value: String(count),
          kind: "setting",
          type: "u16 LE",
        },
      ];
      for (const [i, dimension] of ["width", "height"].entries())
        for (let frame = 0; frame < count; frame++) {
          const relative = 2 + (i * count + frame) * 2;
          out.push({
            offset: at(relative),
            size: 2,
            label: dimension,
            name: `${dimension} of frame ${frame}`,
            value: String(u16(data, relative)),
            kind: "size",
            type: "u16 LE",
            group: `frame ${frame}`,
            frame,
          });
        }
      return out;
    }
    case "DIM:":
      if (data.length !== 4) return words();
      return ["width", "height"].map((dimension, i) => ({
        offset: at(i * 2),
        size: 2,
        label: dimension,
        name: dimension,
        value: String(u16(data, i * 2)),
        kind: "size" as const,
        type: "u16 LE",
      }));
    case "OFF:": {
      const scn = findChunk(all, "SCN:");
      return Array.from({ length: Math.floor(data.length / 4) }, (_, frame) => {
        const value = u32(data, frame * 4);
        return {
          offset: at(frame * 4),
          size: 4,
          label: "start",
          name: `start of frame ${frame}`,
          value: hex(value, 4),
          kind: "position" as const,
          type: "u32 LE, from the start of SCN:",
          group: `frame ${frame}`,
          frame,
          jump: scn ? scn.offset + CHUNK_HEADER + value : undefined,
        };
      });
    }
    case "SCN:":
      return scnFields(all, chunk) ?? [blob(start, data.length, "commands", "drawing commands")];
    case "BIN:":
    case "VGA:":
      if (parent?.tag === "PAL:") return colourFields(start, data);
      return pixelFields(chunk);
    case "DAT:":
      if (parent?.tag !== "SND:" || data.length < 4) return words();
      return [
        {
          offset: start,
          size: 2,
          label: "id",
          name: "sound id",
          value: String(u16(data, 0)),
          kind: "id",
          type: "u16 LE",
        },
        {
          offset: start + 2,
          size: 2,
          label: "",
          name: "unknown",
          value: String(u16(data, 2)),
          kind: "word",
          type: "u16 LE",
        },
        blob(start + 4, data.length - 4, "sound", "the sound, packed as type 3"),
      ];
    case "TAG:":
      return parent?.tag === "SND:" ? (tagFields(start, data) ?? words()) : words();
    default:
      return words();
  }
}

const blob = (offset: number, size: number, label: string, name: string): Field => ({
  offset,
  size,
  label,
  name,
  value: plural(size, "byte"),
  kind: "data",
  type: "bytes",
});

function colourFields(start: number, data: Uint8Array): Field[] {
  return Array.from({ length: Math.floor(data.length / 3) }, (_, color) => ({
    offset: start + color * 3,
    size: 3,
    label: `colour ${color}`,
    name: `colour ${color}`,
    value: `${data[color * 3]} ${data[color * 3 + 1]} ${data[color * 3 + 2]}`,
    kind: "colour" as const,
    type: "R G B, 6 bits each",
    detail: "6 bits per channel, 0–63",
    colors: [color],
  }));
}

function pixelFields(chunk: Chunk): Field[] {
  const start = chunk.offset + CHUNK_HEADER;
  const data = chunk.data;
  if (data.length < 5) return wordFields(data).map((f) => ({ ...f, offset: start + f.offset }));
  const unpacked = u32(data, 1);
  return [
    {
      offset: start,
      size: 1,
      label: "packing",
      name: "compression",
      value: `${COMPRESSION[data[0]!] ?? "unknown"}`,
      kind: "setting",
      type: "u8: 0 none, 1 RLE, 2 LZW",
    },
    {
      offset: start + 1,
      size: 4,
      label: "unpacked",
      name: "unpacked size",
      value: String(unpacked),
      kind: "size",
      type: "u32 LE",
    },
    {
      ...blob(
        start + 5,
        data.length - 5,
        "pixels",
        `compressed ${chunk.tag === "BIN:" ? "low" : "high"} 4 bits of the pixels`,
      ),
      detail: `${plural(data.length - 5, "byte")} unpack to ${plural(unpacked, "byte")}`,
    },
  ];
}

/** The `TAG:` chunk of a sound bank: a u16 count, then per sound its u16 id and a name that ends with a zero byte. */
function tagFields(start: number, data: Uint8Array): Field[] | undefined {
  const count = u16(data, 0);
  const out: Field[] = [
    {
      offset: start,
      size: 2,
      label: "count",
      name: "name count",
      value: String(count),
      kind: "setting",
      type: "u16 LE",
    },
  ];
  let at = 2;
  for (let i = 0; i < count; i++) {
    const end = data.indexOf(0, at + 2);
    if (end < 0) return undefined;
    const name = String.fromCharCode(...data.subarray(at + 2, end));
    out.push(
      {
        offset: start + at,
        size: 2,
        label: "id",
        name: "sound id",
        value: String(u16(data, at)),
        kind: "id",
        type: "u16 LE",
      },
      {
        offset: start + at + 2,
        size: end + 1 - at - 2,
        label: "name",
        name: "sound name",
        value: quote(name),
        kind: "text",
        type: "text, ends with a zero byte",
      },
    );
    at = end + 1;
  }
  return at === data.length ? out : undefined;
}

/** Line and skip commands are often one byte wide, too narrow for their names. */
const SCN_LABELS: Partial<Record<ScnCommand["type"], string>> = { line: "↵", skip: "→" };

const SCN_KINDS: Record<ScnCommand["type"], FieldKind> = {
  base: "setting",
  line: "position",
  skip: "position",
  repeat: "colour",
  copy: "colour",
  end: "id",
};

function scnValue(command: ScnCommand): string {
  switch (command.type) {
    case "repeat":
      return `${command.colors[0]} × ${command.count}`;
    case "end":
      return "";
    default:
      return String(command.count);
  }
}

function scnName(command: ScnCommand): string {
  switch (command.type) {
    case "base":
      return "base colour, added to every colour";
    case "line":
      return "next line, pixels left on the line";
    case "skip":
      return "skip pixels";
    case "repeat":
      return "repeat a colour";
    case "copy":
      return "copy colours";
    case "end":
      return "end of frame";
  }
}

/** The commands of every frame in `SCN:`, found through `OFF:` and the widths in `INF:`. */
function scnFields(all: Chunk[], scn: Chunk): Field[] | undefined {
  const off = findChunk(all, "OFF:")?.data;
  const inf = findChunk(all, "INF:")?.data;
  if (!off || !inf) return undefined;
  const start = scn.offset + CHUNK_HEADER;
  const count = Math.floor(off.length / 4);
  const out: Field[] = [];
  for (let frame = 0; frame < count; frame++) {
    const begin = u32(off, frame * 4);
    const end = frame + 1 < count ? u32(off, (frame + 1) * 4) : scn.data.length;
    if (begin > end || end > scn.data.length) return undefined;
    for (const command of readScnCommands(scn.data.subarray(begin, end), u16(inf, 2 + frame * 2)))
      out.push({
        offset: start + begin + command.offset,
        size: command.length,
        label: SCN_LABELS[command.type] ?? command.type,
        name: scnName(command),
        value: scnValue(command),
        kind: SCN_KINDS[command.type],
        type: "SCN command",
        group: `frame ${frame}`,
        detail: command.type === "base" ? undefined : `at x ${command.x}, y ${command.y}`,
        colors: command.colors.length ? command.colors : undefined,
        frame,
      });
  }
  return out;
}

/** Every field of a resource that the lab can read, sorted by offset and not overlapping. Gaps are bytes no one read. */
export function fieldsOf(resource: Resource, options: FieldOptions = {}): Field[] {
  const data = resource.data;
  if (resource.group === "level" || resource.group === "scene") {
    const level = levelFields(resource, options);
    if (level) return level;
  }
  if (resource.group === "sound" && /\.RAW$/i.test(resource.name)) return [blob(0, data.length, "samples", "samples")];
  let chunks: Chunk[] | undefined;
  try {
    chunks = readChunks(data);
  } catch {
    chunks = undefined;
  }
  return chunks?.length ? chunkFields(chunks, chunks) : wordFields(data);
}

/** The field holding the byte at `offset`, found by halving the sorted list. */
export function fieldAt(fields: readonly Field[], offset: number): Field | undefined {
  let low = 0;
  let high = fields.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const field = fields[mid]!;
    if (offset < field.offset) high = mid - 1;
    else if (offset >= field.offset + field.size) low = mid + 1;
    else return field;
  }
  return undefined;
}

/** The index of the first field that ends after `offset`, to start drawing a row from. */
export function firstFieldFrom(fields: readonly Field[], offset: number): number {
  let low = 0;
  let high = fields.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (fields[mid]!.offset + fields[mid]!.size <= offset) low = mid + 1;
    else high = mid;
  }
  return low;
}
