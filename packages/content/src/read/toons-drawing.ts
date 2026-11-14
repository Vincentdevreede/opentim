/**
 * How TOONS.EXE draws the parts that have drawing code of their own: the conveyor belt, the timer, the counter, the
 * thumpulator and the message machine, and Al and Sid. Much of that code is in the program's overlays, so this file
 * also lays the overlays out after the load image, as the overlay manager would load them.
 *
 * TOONS.EXE draws a part through one routine (file offset `0x1e310` in the English build) that draws a part with bit
 * 0x40 of its first flag word as tiles, and else picks its drawing code by type from a table of ten types: the belt
 * and the rope (in the main program), the conveyor belt, the timer, the counter, the thumpulator and the message
 * machine (each in its own overlay), Al and Sid (who first load the sheet of what they are doing), and type 76, which
 * isn't drawn. Every other type is drawn from its frames.
 */
import { loadImage } from "./toons.ts";

const u16 = (data: Uint8Array, at: number) => (at >= 0 && at + 1 < data.length ? data[at]! | (data[at + 1]! << 8) : 0);
const u32 = (data: Uint8Array, at: number) => u16(data, at) + u16(data, at + 2) * 0x10000;
const s8 = (b: number) => (b > 127 ? b - 256 : b);

/** The program as it runs with every overlay loaded. */
export interface ToonsMemory {
  /** The load image, then each overlay's code at a segment of its own, with its segment fixups applied. */
  memory: Uint8Array;
  /** The program's data segment, which its start-up code loads first. */
  dataSegment: number;
  /** The code segments of the load image, from the segment table the overlay data points to. */
  codeSegments: number[];
  /** Where a far pointer leads: a pointer into an overlay's stub leads to the overlay's routine. */
  resolve(segment: number, offset: number): { segment: number; offset: number };
  /** The offset in TOONS.EXE of an address of `memory`. */
  fileOffset(address: number): number;
}

/** Borland's overlay data after the load image: `FBOV`, its size, where the segment table is and how many entries. */
const FBOV = [0x46, 0x42, 0x4f, 0x56];
/** A stub segment of the overlay manager: `int 3Fh`, then the overlay's place, size and fixups. */
const STUB_FLAGS = 3;

/**
 * Lays TOONS.EXE out with its overlays. The overlay data follows the load image: a segment table names each segment of
 * the program, and a stub segment for each overlay gives where its code is in the overlay data, its size and its
 * fixups. A fixup is a place in the code where a segment goes; the code keeps 8 times the segment's entry in the table
 * there. A stub's routines are `int 3Fh` and the routine's offset in the overlay, 5 bytes each from 0x20.
 */
export function readToonsMemory(exe: Uint8Array): ToonsMemory {
  const image = loadImage(exe);
  const header = u16(exe, 8) * 16;
  const entry = u16(exe, 0x16) * 16 + u16(exe, 0x14);
  const dataSegment = image[entry] === 0xba ? u16(image, entry + 1) : 0;
  const end = header + image.length;
  const parts: Uint8Array[] = [image];
  const stubs = new Map<number, { segment: number; file: number; size: number }>();
  const codeSegments: number[] = [];
  let length = image.length;
  if (FBOV.every((b, i) => exe[end + i] === b)) {
    const table = u32(exe, end + 8);
    const count = u32(exe, end + 12);
    if (table + 8 * count > exe.length)
      throw new Error("TOONS.EXE's overlay segment table runs past the end of the file");
    const segments = Array.from({ length: count }, (_, i) => u16(exe, table + 8 * i));
    const base = end + 16;
    for (let i = 0; i < count; i++) {
      const segment = segments[i]!;
      const flags = u16(exe, table + 8 * i + 4);
      if (flags === 1 && !codeSegments.includes(segment)) codeSegments.push(segment);
      if (flags !== STUB_FLAGS || stubs.has(segment)) continue;
      const stub = segment * 16;
      const file = base + u32(image, stub + 4);
      const size = u16(image, stub + 8);
      const fixups = u16(image, stub + 10);
      if (file + size + fixups > exe.length)
        throw new Error("TOONS.EXE's overlay or its fixups run past the end of the file");
      const code = Uint8Array.from(exe.subarray(file, file + size));
      for (let k = 0; k < fixups / 2; k++) {
        const at = u16(exe, file + size + 2 * k);
        const value = segments[u16(code, at) >> 3] ?? 0;
        code[at] = value & 0xff;
        code[at + 1] = value >> 8;
      }
      length = Math.ceil(length / 16) * 16;
      parts.push(new Uint8Array(length - parts.reduce((n, p) => n + p.length, 0)), code);
      stubs.set(segment, { segment: length / 16, file, size });
      length += code.length;
    }
  }
  const memory = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    memory.set(p, at);
    at += p.length;
  }
  return {
    memory,
    dataSegment,
    codeSegments: codeSegments.sort((a, b) => a - b),
    resolve(segment, offset) {
      const stub = stubs.get(segment);
      const place = segment * 16 + offset;
      if (!stub || image[place] !== 0xcd || image[place + 1] !== 0x3f) return { segment, offset };
      return { segment: stub.segment, offset: u16(image, place + 2) };
    },
    fileOffset(address) {
      for (const stub of stubs.values())
        if (address >= stub.segment * 16 && address < stub.segment * 16 + stub.size)
          return stub.file + address - stub.segment * 16;
      return header + address;
    },
  };
}

/** The tables a drawing routine reads, in the order it reads them: `mov al, es:[bx + table]` after loading `es`. */
function tablesRead(memory: Uint8Array, start: number, length = 0x300): number[] {
  const out: number[] = [];
  for (let at = start; at < start + length && at + 5 <= memory.length; at++) {
    if (memory[at] !== 0x26 || memory[at + 1] !== 0x8a || memory[at + 2] !== 0x87) continue;
    // The segment goes into ax or dx a few bytes before: `mov ax, segment` or `mov dx, segment`.
    for (let back = at - 3; back >= at - 12 && back >= start; back--)
      if (memory[back] === 0xb8 || memory[back] === 0xba) {
        out.push(u16(memory, back + 1) * 16 + u16(memory, at + 3));
        break;
      }
  }
  return out;
}

export interface ToonsDrawing {
  /** Where the routine that picks a part's drawing code is, as a file offset of TOONS.EXE. */
  dispatcher: number;
  /** The types with drawing code of their own, and where that code is (a file offset). */
  routines: Map<number, number>;
  /**
   * The conveyor belt's tiles by state: the sprite of the first tile, the last and the ones between. In the middle,
   * sprite 4 takes turns with 5, and sprite 6 every other tile moves 1 pixel down.
   */
  conveyor?: { first: number[]; last: number[]; middle: number[] };
  /** Where the counter puts each digit, 0 to 9, the ones and the tens: x and y from the part's position. */
  counter?: { ones: [number, number][]; tens: [number, number][] };
  /**
   * The thumpulator's sections take turns with three pieces, each a sprite at a place in the section, and the piece
   * moves across by `shift` of the frame the section shows.
   */
  thumpulator?: { pieces: { x: number; y: number; sprite: number }[]; shift: number[] };
}

const CONVEYOR = 0;
const COUNTER = 39;
const THUMPULATOR = 40;
const DIGITS = 10;
const THUMPULATOR_PIECES = 3;
const THUMPULATOR_FRAMES = 8;
/** `mov cx, 10; mov bx, table; mov ax, cs:[bx]`: the search through the ten types with drawing code of their own. */
const SWITCH = [0xb9, 0x0a, 0x00, 0xbb];

/**
 * Reads where TOONS.EXE's drawing code for each type is and the tables it draws with. Undefined when the routine that
 * picks the drawing code isn't found.
 */
export function readToonsDrawing(exe: Uint8Array): ToonsDrawing | undefined {
  const program = readToonsMemory(exe);
  const { memory } = program;
  const segmentOf = (at: number) => program.codeSegments.filter((s) => s * 16 <= at).at(-1);
  for (let at = 0; at + 9 < memory.length; at++) {
    if (!SWITCH.every((b, i) => memory[at + i] === b)) continue;
    if (memory[at + 6] !== 0x2e || memory[at + 7] !== 0x8b || memory[at + 8] !== 0x07) continue;
    const segment = segmentOf(at);
    if (segment === undefined) continue;
    const table = segment * 16 + u16(memory, at + 4);
    const routines = new Map<number, number>();
    const starts = new Map<number, number>();
    for (let k = 0; k < 10; k++) {
      const type = u16(memory, table + 2 * k);
      const handler = segment * 16 + u16(memory, table + 20 + 2 * k);
      // The case loads the type's sheet and calls the drawing code: the last call before it jumps on, a far one or
      // `push cs; call` to a routine of the same segment.
      let start: number | undefined;
      for (let p = handler; p < handler + 0x30 && memory[p] !== 0xeb && memory[p] !== 0xe9; p++)
        if (memory[p] === 0x9a) {
          const target = program.resolve(u16(memory, p + 3), u16(memory, p + 1));
          start = target.segment * 16 + target.offset;
          p += 4;
        } else if (memory[p] === 0x0e && memory[p + 1] === 0xe8) {
          start = segment * 16 + ((p + 4 - segment * 16 + u16(memory, p + 2)) & 0xffff);
          p += 3;
        }
      if (start === undefined) continue;
      starts.set(type, start);
      routines.set(type, program.fileOffset(start));
    }
    // Other code searches ten words too; the drawing switch is the one whose cases call drawing code.
    if (routines.size < 5) continue;
    const drawing: ToonsDrawing = { dispatcher: program.fileOffset(at), routines };
    const conveyor = starts.has(CONVEYOR) ? tablesRead(memory, starts.get(CONVEYOR)!) : [];
    if (conveyor.length >= 3) {
      const states = (t: number) => Array.from(memory.subarray(t, t + 6));
      drawing.conveyor = { first: states(conveyor[0]!), last: states(conveyor[1]!), middle: states(conveyor[2]!) };
    }
    const counter = starts.has(COUNTER) ? tablesRead(memory, starts.get(COUNTER)!) : [];
    if (counter.length >= 4) {
      const places = (t: number) =>
        Array.from({ length: DIGITS }, (_, d): [number, number] => [memory[t + 2 * d]!, memory[t + 2 * d + 1]!]);
      drawing.counter = { ones: places(counter[0]!), tens: places(counter[2]!) };
    }
    const thumpulator = starts.has(THUMPULATOR) ? tablesRead(memory, starts.get(THUMPULATOR)!) : [];
    if (thumpulator.length >= 2) {
      const t = thumpulator[1]!;
      drawing.thumpulator = {
        pieces: Array.from({ length: THUMPULATOR_PIECES }, (_, k) => ({
          x: s8(memory[t + 3 * k]!),
          y: s8(memory[t + 3 * k + 1]!),
          sprite: memory[t + 3 * k + 2]!,
        })),
        shift: Array.from(memory.subarray(thumpulator[0]!, thumpulator[0]! + THUMPULATOR_FRAMES), s8),
      };
    }
    return drawing;
  }
  return undefined;
}
