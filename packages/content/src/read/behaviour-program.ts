/**
 * What differs between the programs the behaviour reader reads: TIM.EXE of TIM 1 and Even More, TIM2.EXE and
 * TOONS.EXE. A profile per game holds the differences the reader takes as given (how the program is stored, the size of
 * a type record, how the code finds a record and how a routine gets its part); everything else it still finds in the
 * code. See docs/research/behaviour/tim2-and-toons.md.
 */
import { TIM2_FIELD_FORMS, TOONS_FIELD_FORMS, type FieldForm } from "./behaviour-field-forms.ts";
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
  /**
   * Whether the part keeps TIM.EXE's history of its state, so that a field the code copies the state into again and
   * again is the previous state. In TOONS.EXE the word it copies the state into (0x0c) is also counted up and set to
   * other numbers by many parts' own code, and Al and Sid read it as what they are doing, so it isn't named there.
   * TOONS.EXE's previous state is 0x10, which its history update names (`fieldForms`).
   */
  stateHistory: boolean;
  /**
   * Whether a helper whose first argument the code shows to be a number (only compared or passed on to a resource
   * service) is read as taking no part. Off for TIM.EXE, whose results were checked with every helper's first argument
   * taken for a part.
   */
  numberArguments: boolean;
  /**
   * How many steps the reader may take through a helper (a routine that isn't a callback). TIM2.EXE's helpers switch
   * over many types in one routine, like the frame size helper, and need more than TIM.EXE's.
   */
  helperPaths: number;
  /**
   * The types whose own bounce the contact dispatch also calls when a part of the type touches a part, or "every" type.
   * It passes the touching part, so the bounce runs with that part as the one that touches and the part it touches in
   * its owner's place, and it doesn't use what that call returns. TIM2.EXE's dispatcher (`0x511f5` in the CD build)
   * does it for the cupid, Mel Schlemming, the super ball and the blimp (types 33, 54, 59 and 109), TOONS.EXE's
   * (`0x2281`) for every type, both when bits 0x06 of the touching part's flags are set. TIM.EXE's dispatcher has no
   * call of this form; Even More's call of Mel's own bounce is read from its dispatcher instead (`specialSelfCall`).
   */
  selfBounce: number[] | "every";
  /**
   * Routines of the program whose code shows what part fields are (`behaviour-field-forms.ts`). TIM.EXE's fields are
   * named from its frame drawing and its helpers instead; TIM2.EXE and TOONS.EXE write those routines in forms the
   * layout doesn't read, so their own forms name the fields there.
   */
  fieldForms: readonly FieldForm[];
  /**
   * Words of a part and of a type record that the descriptions know by their place in TIM.EXE's records, from TIM.EXE's
   * own routines rather than the layout (the routines are named where the descriptions use them). Only TIM.EXE's profile
   * has them: TIM2.EXE and TOONS.EXE keep their records otherwise, so for them the descriptions say nothing about these
   * words instead of reading another game's record with TIM.EXE's offsets.
   */
  partWords?: PartWords;
}

/** TIM.EXE's words the descriptions know by place, as `partWords` above. */
export interface PartWords {
  /** The list flags, with the list bits, the contact flags and the bits `PART_FLAGS` names. */
  listFlags: number;
  /** The drawing flags whose single bits `PART_FLAGS` names (the out-of-play flag and the ran-this-step mark). */
  drawingFlags: number;
  /** The word with the goal marks and the lightable mark. */
  marks: number;
  /** The contact search's two side bytes. */
  contactSides: number[];
  /** The rope links, which hold the parts a rope ties. */
  ropeLinks: number[];
  /** The rope slots' places, a byte pair each. */
  ropePlaces: number[];
  /** The rope links to the rope records. */
  ropeRecords: number[];
  /** The link to the belt's record. */
  beltRecord: number;
  /** The plugs: the parts plugged into the part's two sockets. */
  plugs: number[];
  /** The words a rope helper moves the rope ends with. */
  ropeEnds: number[];
  /** The value a relay passes along the parts its ropes, belt or pulleys reach. */
  relay: number;
  /** The link of an overlap search's found list. */
  foundLink: number;
  /** The speed limit's word in a type record. */
  speedLimit: number;
}

/** TIM.EXE's, for TIM 1 and Even More. */
export const TIM_PART_WORDS: PartWords = {
  listFlags: 0x06,
  drawingFlags: 0x08,
  marks: 0x0a,
  contactSides: [0x86, 0x87],
  ropeLinks: [0x5a, 0x5c, 0x5e, 0x60],
  ropePlaces: [0x6a, 0x6c],
  ropeRecords: [0x66, 0x68],
  beltRecord: 0x54,
  plugs: [0x62, 0x64],
  ropeEnds: [0x96, 0x9c],
  relay: 0x14,
  foundLink: 0x78,
  speedLimit: 0x0a,
};

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
  stateHistory: true,
  numberArguments: false,
  helperPaths: 800,
  selfBounce: [],
  fieldForms: [],
  partWords: TIM_PART_WORDS,
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
    stateHistory: true,
    numberArguments: true,
    helperPaths: 4000,
    selfBounce: [33, 54, 59, 109],
    fieldForms: TIM2_FIELD_FORMS,
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
    stateHistory: false,
    numberArguments: true,
    helperPaths: 4000,
    selfBounce: "every",
    fieldForms: TOONS_FIELD_FORMS,
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
