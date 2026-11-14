/**
 * What differs between the programs the behaviour reader reads: TIM.EXE of TIM 1 and Even More, TIM2.EXE and
 * TOONS.EXE. A profile per game holds the differences the reader takes as given (how the program is stored, the size of
 * a type record, how the code finds a record and how a routine gets its part); everything else it still finds in the
 * code. See docs/research/behaviour/tim2-and-toons.md.
 */
import { unpackLzexe } from "./lzexe.ts";
import type { ListId } from "./parts.ts";
import { loadImage } from "./toons.ts";
import { readToonsMemory } from "./toons-drawing.ts";
import type { CodeAddress } from "./x86.ts";

export interface BehaviourProfile {
  /** How the program file holds its code: packed with LZEXE, or unpacked with its routines partly in overlays. */
  storage: "lzexe" | "overlays";
  /** The bytes of one type record. */
  recordSize: number;
  /**
   * How the code finds a type's record before it calls one of the record's routines: the type times the record size
   * from the table's start, or the type's entry in a table of near pointers to the records.
   */
  recordLookup: "multiply" | "pointer-table";
  /** How a routine gets its part: a near pointer into the data segment, or a far pointer (offset, then segment). */
  partPointer: "near" | "far";
  /**
   * The record's far pointers to routines that follow TIM.EXE's six callbacks, by what they do. The reader reads the
   * six callbacks only.
   */
  otherRoutines: string[];
  /**
   * Whether the reader stops at a call to the program's start (0:0 in all four programs) instead of reading the whole
   * program as the callee. TIM.EXE has such calls too (through code pointers that are still 0 when the program
   * starts), but its results were checked with them followed, so it keeps following them until that is decided.
   */
  stopAtProgramStart: boolean;
  /**
   * Whether the reader goes past a loop that changes only registers and private locals, forgetting what they hold,
   * instead of leaving the routine unresolved there. Off for TIM.EXE, whose results were checked without it.
   */
  confinedLoops: boolean;
  /**
   * Whether a routine that takes one number and only reads files, allocates and fills its own data (an animation
   * loader in TIM2.EXE) is read as a resource service that keeps the parts as they are. Off for TIM.EXE, whose own
   * resource service is recognised by its form.
   */
  scalarLoaders: boolean;
}

/** TIM.EXE of TIM 1 and Even More. */
export const TIM_PROFILE: BehaviourProfile = {
  storage: "lzexe",
  recordSize: 58,
  recordLookup: "multiply",
  partPointer: "near",
  otherRoutines: [],
  stopAtProgramStart: false,
  confinedLoops: false,
  scalarLoaders: false,
};

export const BEHAVIOUR_PROFILES: Record<ListId, BehaviourProfile> = {
  tim1: TIM_PROFILE,
  evenmore: TIM_PROFILE,
  tim2: {
    storage: "overlays",
    recordSize: 72,
    recordLookup: "pointer-table",
    partPointer: "far",
    otherRoutines: ["draw", "set-up"],
    stopAtProgramStart: true,
    confinedLoops: true,
    scalarLoaders: true,
  },
  toons: {
    storage: "overlays",
    recordSize: 70,
    recordLookup: "multiply",
    partPointer: "near",
    otherRoutines: [],
    stopAtProgramStart: true,
    confinedLoops: true,
    scalarLoaders: true,
  },
};

/** The profile of a part list's game; TIM.EXE's for a list of another id, as the reader read every program before. */
export const behaviourProfile = (list: string): BehaviourProfile =>
  Object.hasOwn(BEHAVIOUR_PROFILES, list) ? BEHAVIOUR_PROFILES[list as ListId] : TIM_PROFILE;

/** A program as the reader reads it. */
export interface BehaviourImage {
  /** The code and data as they run, with every overlay in memory. */
  image: Uint8Array;
  /** The load image as the file holds it, which the type records are read from. */
  loadImage: Uint8Array;
  /** Where a far pointer to a routine leads: through an overlay's stub to the routine itself. */
  routine(segment: number, offset: number): CodeAddress;
  /** Where the program starts, in the image: a call there runs the whole program again, so the reader doesn't follow it. */
  entry: number;
}

const u16 = (data: Uint8Array, at: number) => (at >= 0 && at + 1 < data.length ? data[at]! | (data[at + 1]! << 8) : 0);
const u32 = (data: Uint8Array, at: number) => u16(data, at) + u16(data, at + 2) * 0x10000;
/** `call far` and `jmp far` with the address in the instruction. */
const FAR_CALL = 0x9a;
const FAR_JUMP = 0xea;
const STUB_FLAGS = 3;
/** A stub's routines: `int 3Fh` and the routine's offset in the overlay, 5 bytes each from 0x20. */
const STUB_ENTRIES = 0x20;
const STUB_ENTRY_SIZE = 5;
const CODE_FLAGS = 1;
const FBOV = [0x46, 0x42, 0x4f, 0x56];

/** The places of the load image where the program keeps a segment, from the EXE header's relocation table. */
function relocations(exe: Uint8Array): number[] {
  const count = u16(exe, 6);
  const table = u16(exe, 0x18);
  return Array.from({ length: count }, (_, i) => u16(exe, table + 4 * i + 2) * 16 + u16(exe, table + 4 * i));
}

/** The segments of the overlay data's segment table, with their flags, or none for a program without overlays. */
function segmentTable(exe: Uint8Array, image: Uint8Array): { segment: number; flags: number }[] {
  const end = u16(exe, 8) * 16 + image.length;
  if (!FBOV.every((b, i) => exe[end + i] === b)) return [];
  const table = u32(exe, end + 8);
  const count = u32(exe, end + 12);
  return Array.from({ length: count }, (_, i) => ({
    segment: u16(exe, table + 8 * i),
    flags: u16(exe, table + 8 * i + 4),
  }));
}

/** The code segments of the load image, each up to the next segment of the table or the end of the image. */
function codeRanges(
  segments: { segment: number; flags: number }[],
  image: Uint8Array,
): { start: number; end: number }[] {
  const starts = [...new Set(segments.map((s) => s.segment))].sort((a, b) => a - b);
  return segments
    .filter((s) => s.flags === CODE_FLAGS)
    .map(({ segment }) => ({
      start: segment * 16,
      end: Math.min(image.length, (starts.find((s) => s > segment) ?? image.length) * 16),
    }));
}

/**
 * Lays out a program with overlays as it runs once every overlay is loaded. `readToonsMemory` puts each overlay after
 * the load image. Then each far call and far jump to a stub's entry goes straight to the routine: in the load image
 * the places come from the relocation table (only in code segments, so a far pointer in the data stays as it is), in
 * an overlay from its far calls and jumps. Last, every stub entry becomes a far jump to its routine, as the overlay
 * manager writes when it loads the overlay, for a pointer the code builds while it runs.
 */
export function loadOverlaidProgram(exe: Uint8Array): BehaviourImage {
  const plain = loadImage(exe);
  const program = readToonsMemory(exe);
  const image = Uint8Array.from(program.memory);
  const write = (at: number, value: number) => {
    image[at] = value & 0xff;
    image[at + 1] = value >> 8;
  };
  const isStubEntry = (segment: number, offset: number) => {
    const target = program.resolve(segment, offset);
    return target.segment !== segment || target.offset !== offset ? target : undefined;
  };
  const redirect = (opcode: number) => {
    if (image[opcode] !== FAR_CALL && image[opcode] !== FAR_JUMP) return;
    const target = isStubEntry(u16(image, opcode + 3), u16(image, opcode + 1));
    if (!target) return;
    write(opcode + 1, target.offset);
    write(opcode + 3, target.segment);
  };
  const segments = segmentTable(exe, plain);
  const code = codeRanges(segments, plain);
  for (const at of relocations(exe))
    if (code.some((range) => at - 3 >= range.start && at + 2 <= range.end)) redirect(at - 3);
  for (let at = plain.length; at + 5 <= image.length; at++) redirect(at);
  for (const { segment } of segments.filter((s) => s.flags === STUB_FLAGS))
    for (let offset = STUB_ENTRIES; ; offset += STUB_ENTRY_SIZE) {
      const target = isStubEntry(segment, offset);
      if (!target) break;
      const at = segment * 16 + offset;
      image[at] = FAR_JUMP;
      write(at + 1, target.offset);
      write(at + 3, target.segment);
    }
  return {
    image,
    loadImage: plain,
    entry: u16(exe, 0x16) * 16 + u16(exe, 0x14),
    routine(segment, offset) {
      const target = program.resolve(segment, offset);
      return { ...target, address: target.segment * 16 + target.offset };
    },
  };
}

/** Reads a program the way its profile says it is stored. */
export function loadBehaviourImage(program: Uint8Array, profile: BehaviourProfile): BehaviourImage {
  if (profile.storage === "overlays") return loadOverlaidProgram(program);
  const image = unpackLzexe(program);
  // LZEXE's unpacking code keeps the program's own start in its first words.
  const stub = u16(program, 8) * 16 + u16(program, 0x16) * 16;
  return {
    image,
    loadImage: image,
    entry: u16(program, stub + 2) * 16 + u16(program, stub),
    routine: (segment, offset) => ({ segment, offset, address: segment * 16 + offset }),
  };
}
