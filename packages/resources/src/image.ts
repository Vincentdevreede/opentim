import { FormatError, findChunk, readChunks, type Chunk } from "./chunk.ts";

/** One picture of a sprite sheet or screen, as palette indexes. */
export interface Frame {
  width: number;
  height: number;
  /** A palette index per pixel, row by row. */
  pixels: Uint8Array;
  /** 1 where a pixel is drawn, 0 where it is transparent. */
  mask: Uint8Array;
}

export interface Image {
  frames: Frame[];
  /** How the pixels are stored, e.g. `SCN` or `BIN · LZW + VGA`. */
  encoding: string;
}

/** Limit on decoded pixels and bytes, so damaged sizes can't exhaust memory. */
const MAX_PIXELS = 16 * 1024 * 1024;

const CHUNK_HEADER = 8;
const BIN_HEADER = 5;
const COMPRESSION = ["none", "RLE", "LZW"];

/** Runs a decoder on part of a resource that starts at `start`, so its errors point into the whole resource. */
function within<T>(start: number, decode: () => T): T {
  try {
    return decode();
  } catch (error) {
    if (error instanceof FormatError) throw new FormatError(error.message, start + (error.offset ?? 0));
    throw error;
  }
}

/** Where a chunk's data starts in the resource. */
const dataStart = (chunk: Chunk) => chunk.offset + CHUNK_HEADER;

/**
 * Decodes a sprite sheet (`.BMP`) or screen (`.SCR`). A sprite sheet lists the size of each frame in its `INF:` chunk;
 * a screen has one frame, sized by its `DIM:` chunk. The pixels are either in a `SCN:` chunk of drawing commands, or
 * in a compressed `BIN:` chunk of 4-bit pixels with an optional `VGA:` chunk holding the high 4 bits.
 *
 * Errors are {@link FormatError}s with the offset in `data` where decoding stopped.
 *
 * Format knowledge from the ModdingWiki pages on the TIM image format and the Stellar 7 RES format.
 */
export function decodeImage(data: Uint8Array): Image {
  const chunks = readChunks(data);
  const { sizes, chunk: sized } = frameSizes(chunks);
  if (sizes.some((s) => !s.width || !s.height)) throw new FormatError("A frame has no width or height", sized.offset);
  if (sizes.reduce((sum, s) => sum + s.width * s.height, 0) > MAX_PIXELS)
    throw new FormatError("The frames are too large", sized.offset);

  const scn = findChunk(chunks, "SCN:");
  if (scn) {
    const off = findChunk(chunks, "OFF:");
    if (!off || off.data.length !== sizes.length * 4)
      throw new FormatError("No OFF: chunk with an offset per frame", off?.offset);
    const view = new DataView(off.data.buffer, off.data.byteOffset, off.data.byteLength);
    const frames = sizes.map(({ width, height }, i) => {
      const start = view.getUint32(i * 4, true);
      const end = i + 1 < sizes.length ? view.getUint32((i + 1) * 4, true) : scn.data.length;
      if (start > end || end > scn.data.length)
        throw new FormatError(`Frame ${i} is outside the SCN: chunk`, dataStart(off) + i * 4);
      return within(dataStart(scn) + start, () => decodeScn(scn.data.subarray(start, end), width, height));
    });
    return { frames, encoding: "SCN" };
  }

  const bin = findChunk(chunks, "BIN:");
  if (!bin) throw new FormatError("No SCN: or BIN: chunk with pixels");
  const low = within(dataStart(bin), () => decodeBin(bin.data));
  const vga = findChunk(chunks, "VGA:");
  const high = vga ? within(dataStart(vga), () => decodeBin(vga.data)) : undefined;
  if (high && high.length !== low.length)
    throw new FormatError("The VGA: and BIN: chunks have different sizes", vga?.offset);
  // Index 0 is transparent in sprites; a screen covers everything.
  const transparent = !findChunk(chunks, "DIM:");
  let offset = 0;
  const frames = sizes.map(({ width, height }, i) => {
    const stride = Math.ceil(width / 2);
    if (offset + stride * height > low.length)
      throw new FormatError(`Frame ${i} is outside the BIN: chunk`, bin.offset);
    const pixels = new Uint8Array(width * height);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = offset + y * stride + (x >> 1);
        const shift = x % 2 ? 0 : 4;
        const value = ((low[at]! >> shift) & 15) | (high ? ((high[at]! >> shift) & 15) << 4 : 0);
        pixels[y * width + x] = value;
        mask[y * width + x] = transparent && value === 0 ? 0 : 1;
      }
    }
    offset += stride * height;
    return { width, height, pixels, mask };
  });
  if (offset !== low.length)
    throw new FormatError(`${low.length - offset} unused bytes after the last frame`, bin.offset);
  return { frames, encoding: `BIN · ${COMPRESSION[bin.data[0]!]}${high ? " + VGA" : ""}` };
}

function frameSizes(chunks: Chunk[]): { sizes: { width: number; height: number }[]; chunk: Chunk } {
  const dim = findChunk(chunks, "DIM:");
  if (dim) {
    if (dim.data.length !== 4) throw new FormatError("The DIM: chunk isn't 4 bytes", dim.offset);
    const view = new DataView(dim.data.buffer, dim.data.byteOffset, dim.data.byteLength);
    return { sizes: [{ width: view.getUint16(0, true), height: view.getUint16(2, true) }], chunk: dim };
  }
  // INF: holds a u16 frame count, then all widths, then all heights.
  const inf = findChunk(chunks, "INF:");
  if (!inf || inf.data.length < 2) throw new FormatError("No INF: or DIM: chunk with the frame sizes", inf?.offset);
  const view = new DataView(inf.data.buffer, inf.data.byteOffset, inf.data.byteLength);
  const count = view.getUint16(0, true);
  if (!count || inf.data.length !== 2 + count * 4)
    throw new FormatError("The INF: chunk doesn't match its frame count", inf.offset);
  const sizes = Array.from({ length: count }, (_, i) => ({
    width: view.getUint16(2 + i * 2, true),
    height: view.getUint16(2 + count * 2 + i * 2, true),
  }));
  return { sizes, chunk: inf };
}

/**
 * Draws one frame from SCN commands. The first byte is added to every colour. Then each command byte has a 2-bit type
 * and a 6-bit count:
 *
 * - 0: move down one line and `count` pixels left. When the next byte is 1–63, it holds the high bits of the count.
 *   `0x00` moves straight down.
 * - 1: skip `count` transparent pixels. `0x40`, with a count of 0, ends the frame.
 * - 2: repeat the colour in the next byte `count` times.
 * - 3: copy `count` colours, two 4-bit colours per byte.
 *
 * Errors point at the command that failed.
 */
export function decodeScn(data: Uint8Array, width: number, height: number): Frame {
  const size = width * height;
  const pixels = new Uint8Array(size);
  const mask = new Uint8Array(size);
  if (!data.length) throw new FormatError("Empty SCN frame", 0);
  const base = data[0]!;
  let input = 1;
  let output = 0;
  let command = 0;
  const next = () => {
    if (input >= data.length) throw new FormatError("Truncated SCN frame", command);
    return data[input++]!;
  };
  const put = (color: number) => {
    if (output >= size) throw new FormatError("SCN pixels run past the frame", command);
    if (color + base > 255) throw new FormatError(`SCN colour ${color + base} is outside the palette`, command);
    pixels[output] = color + base;
    mask[output++] = 1;
  };
  while (input < data.length) {
    command = input;
    const code = data[input++]!;
    if (code === 0x40) return { width, height, pixels, mask };
    let count = code & 63;
    switch (code >> 6) {
      case 0:
        if (input < data.length && data[input]! > 0 && data[input]! < 64) count |= data[input++]! << 6;
        output += width - count;
        break;
      case 1:
        output += count;
        break;
      case 2: {
        const color = next();
        if (color > 15) throw new FormatError(`SCN colour ${color} is above 15`, command);
        for (let i = 0; i < count; i++) put(color);
        break;
      }
      case 3:
        for (let i = 0; i < count; i += 2) {
          const pair = next();
          put(pair >> 4);
          if (i + 1 < count) put(pair & 15);
        }
        break;
    }
    // The last line move may point just past the frame, before the end command.
    if (output > size + width) throw new FormatError("SCN moves past the frame", command);
  }
  throw new FormatError("SCN frame doesn't end with 0x40", data.length);
}

export interface ScnCommand {
  /** Position of the command in the frame's data; the first byte is the base colour. */
  offset: number;
  /** Bytes the command takes, with its data. */
  length: number;
  type: "base" | "line" | "skip" | "repeat" | "copy" | "end";
  /** The base colour, or the pixels the command moves, skips or draws. */
  count: number;
  /** The colours drawn, with the base colour added. */
  colors: number[];
  /** Where in the frame the command starts. */
  x: number;
  y: number;
}

/**
 * Lists the commands of a SCN frame, as {@link decodeScn} reads them, to explain its bytes. Stops at the end command
 * or the end of the data, without checking the frame's bounds.
 */
export function readScnCommands(data: Uint8Array, width: number): ScnCommand[] {
  if (!data.length) return [];
  const base = data[0]!;
  const commands: ScnCommand[] = [{ offset: 0, length: 1, type: "base", count: base, colors: [], x: 0, y: 0 }];
  let input = 1;
  let output = 0;
  while (input < data.length) {
    const offset = input;
    const code = data[input++]!;
    const x = output % width;
    const y = Math.floor(output / width);
    const command = (type: ScnCommand["type"], count: number, colors: number[] = []) =>
      commands.push({ offset, length: input - offset, type, count, colors, x, y });
    if (code === 0x40) {
      command("end", 0);
      break;
    }
    let count = code & 63;
    switch (code >> 6) {
      case 0:
        if (input < data.length && data[input]! > 0 && data[input]! < 64) count |= data[input++]! << 6;
        output += width - count;
        command("line", count);
        break;
      case 1:
        output += count;
        command("skip", count);
        break;
      case 2: {
        const color = input < data.length ? data[input++]! + base : base;
        output += count;
        command("repeat", count, [color]);
        break;
      }
      case 3: {
        const colors: number[] = [];
        for (let i = 0; i < count && input < data.length; i += 2) {
          const pair = data[input++]!;
          colors.push((pair >> 4) + base);
          if (i + 1 < count) colors.push((pair & 15) + base);
        }
        output += count;
        command("copy", count, colors);
        break;
      }
    }
  }
  return commands;
}

/**
 * Unpacks a `BIN:` or `VGA:` chunk: a compression type byte (0 none, 1 RLE, 2 LZW), the u32 unpacked size, then the
 * data. Errors point at the byte where unpacking stopped.
 */
export function decodeBin(data: Uint8Array): Uint8Array {
  if (data.length < BIN_HEADER) throw new FormatError("Truncated BIN header", 0);
  const size = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, true);
  if (size > MAX_PIXELS) throw new FormatError("The unpacked BIN data is too large", 1);
  const input = data.subarray(BIN_HEADER);
  switch (data[0]) {
    case 0:
      if (input.length !== size) throw new FormatError("Uncompressed BIN data has the wrong size", 1);
      return input.slice();
    case 1:
      return within(BIN_HEADER, () => decodeRle(input, size));
    case 2:
      return within(BIN_HEADER, () => decodeLzw(input, size));
    default:
      throw new FormatError(`Unknown BIN compression type ${data[0]}`, 0);
  }
}

/** Run-length: a byte with the high bit repeats the next byte; without it, that many bytes follow as they are. */
function decodeRle(input: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  let written = 0;
  while (written < size) {
    if (at >= input.length) throw new FormatError("Truncated RLE data", at);
    const start = at;
    const code = input[at++]!;
    const count = code & 127;
    if (!count || written + count > size) throw new FormatError(`Invalid RLE count ${count}`, start);
    if (code & 128) {
      if (at >= input.length) throw new FormatError("Truncated RLE data", start);
      out.fill(input[at++]!, written, written + count);
    } else {
      if (at + count > input.length) throw new FormatError("Truncated RLE data", start);
      out.set(input.subarray(at, at + count), written);
      at += count;
    }
    written += count;
  }
  return out;
}

const LZW_RESET = 256;
const LZW_FIRST = 257;
const LZW_MAX_BITS = 12;
const LZW_SIZE = 1 << LZW_MAX_BITS;

/**
 * LZW with 9- to 12-bit codes, least significant bit first. Code 256 resets the dictionary; the codes after it are
 * skipped up to a multiple of 8 codes since the last width change, as the game reads them in groups of 8.
 */
function decodeLzw(input: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  // Each entry is an earlier entry plus one byte, so it is written backwards from its last byte.
  const prefix = new Int16Array(LZW_SIZE);
  const suffix = new Uint8Array(LZW_SIZE);
  const first = new Uint8Array(LZW_SIZE);
  const length = new Uint16Array(LZW_SIZE);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    first[i] = i;
    length[i] = 1;
  }
  let bit = 0;
  let bits = 9;
  let next = LZW_FIRST;
  let previous = -1;
  let group = 0;
  let written = 0;

  const read = () => {
    if (bit + bits > input.length * 8) throw new FormatError("Truncated LZW data", bit >> 3);
    let value = 0;
    for (let i = 0; i < bits; i++, bit++) value |= ((input[bit >> 3]! >> (bit & 7)) & 1) << i;
    group++;
    return value;
  };
  const write = (code: number) => {
    const n = length[code]!;
    if (written + n > size) throw new FormatError("LZW data runs past its size", (bit - 1) >> 3);
    for (let i = n - 1, c = code; i >= 0; i--, c = prefix[c]!) out[written + i] = suffix[c]!;
    written += n;
  };

  while (written < size) {
    const code = read();
    if (code === LZW_RESET) {
      while (group % 8) read();
      bits = 9;
      next = LZW_FIRST;
      previous = -1;
      group = 0;
      continue;
    }
    let head: number;
    if (code < next) {
      write(code);
      head = first[code]!;
    } else if (code === next && previous >= 0) {
      // The code being defined: the previous entry plus its own first byte.
      head = first[previous]!;
      write(previous);
      if (written >= size) throw new FormatError("LZW data runs past its size", (bit - 1) >> 3);
      out[written++] = head;
    } else {
      throw new FormatError(`Invalid LZW code ${code}`, (bit - bits) >> 3);
    }
    if (previous >= 0 && next < LZW_SIZE) {
      prefix[next] = previous;
      suffix[next] = head;
      first[next] = first[previous]!;
      length[next] = length[previous]! + 1;
      next++;
      if (next === 1 << bits && bits < LZW_MAX_BITS) {
        bits++;
        group = 0;
      }
    }
    previous = code;
  }
  return out;
}

/** Colours a frame with a palette of 8-bit RGB triples, as RGBA for a canvas. Transparent pixels stay clear. */
export function frameToRgba(frame: Frame, palette: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(frame.pixels.length * 4);
  for (let i = 0; i < frame.pixels.length; i++) {
    if (!frame.mask[i]) continue;
    const color = frame.pixels[i]! * 3;
    rgba[i * 4] = palette[color] ?? 0;
    rgba[i * 4 + 1] = palette[color + 1] ?? 0;
    rgba[i * 4 + 2] = palette[color + 2] ?? 0;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
