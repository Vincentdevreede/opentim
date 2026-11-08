/**
 * Resets that copy their outline from data tables by a loop the table reader in `behaviour-outline-tables.ts` doesn't
 * match: a table picked from a list by the frame, one picked by a test of the drawing flags, corners four bytes apart
 * in the table, or a loop that picks its table per corner. The routine is run once for every frame it is given and
 * for every value of the drawing flag bits it tests, on a small 16-bit processor that knows only what such a copy
 * needs. A run gives up at anything else: an instruction it doesn't know, a read of a part field other than the frame,
 * the outline pointer or a tested drawing flag, a write to the data segment, or a call before the outline is set.
 *
 * Each run ends at the first call or return. The part's outline is then what the run wrote through the outline
 * pointer, and every corner byte must have been read from the data segment, so a reset that writes numbers or sizes
 * (which the field analysis already describes) gives nothing here.
 */
import type { Evidence } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import { OUTLINE_TABLE_ASSUMPTION, type OutlineTableChoice, type OutlineTables } from "./behaviour-outline-tables.ts";
import type { Instruction, Operand } from "./x86.ts";

/** Where the run puts the part and its outline records in the data segment: far above the tables a program keeps. */
const PART = 0xfe00;
const OUTLINE = 0xfc00;
const STACK = 0xf000;
const STEPS = 4000;

type Memory = Extract<Operand, { kind: "memory" }>;
const WORDS = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"];
const BYTES: Record<string, [string, number]> = {
  al: ["ax", 0],
  cl: ["cx", 0],
  dl: ["dx", 0],
  bl: ["bx", 0],
  ah: ["ax", 8],
  ch: ["cx", 8],
  dh: ["dx", 8],
  bh: ["bx", 8],
};
const signed = (value: number, width: number) => (value & (1 << (width - 1)) ? value - (1 << width) : value);
const mask = (width: number) => (width === 8 ? 0xff : 0xffff);

class GiveUp extends Error {}
const fail = (): never => {
  throw new GiveUp();
};

interface Fields {
  outline: number;
  state: number;
  /** The drawing flags field and its known bits, when the layout found it. */
  flags?: number;
}

interface Run {
  /** The bytes written through the outline pointer, by offset, with the data segment address each was read from. */
  outline: Map<number, { value: number; source?: number }>;
  /** The drawing flag bits a `test` read. */
  tested: Set<number>;
  readsFrame: boolean;
  /** The data segment bytes read. */
  reads: Set<number>;
  executed: Set<Instruction>;
}

/** Runs the routine for one frame and drawing flags value. */
function run(
  code: RoutineCode,
  byAddress: Map<number, Instruction>,
  image: Uint8Array,
  dataSegment: number,
  fields: Fields,
  frame: number,
  flags: number,
): Run {
  const result: Run = {
    outline: new Map(),
    tested: new Set(),
    readsFrame: false,
    reads: new Set(),
    executed: new Set(),
  };
  const registers: Record<string, number> = { ax: 0, cx: 0, dx: 0, bx: 0, sp: STACK, bp: 0, si: 0, di: 0 };
  // Where an 8-bit register's value was read from, while it is unchanged.
  const sources = new Map<string, number>();
  const stack = new Map<number, number>();
  // The far call's return address and the part argument.
  const push = (value: number) => {
    registers.sp = (registers.sp! - 2) & 0xffff;
    stack.set(registers.sp, value & 0xff);
    stack.set(registers.sp + 1, (value >> 8) & 0xff);
  };
  push(PART);
  push(0);
  push(0);
  let compare: { a: number; b: number; width: number; full: boolean } | undefined;

  const clearSources = (name: string) => {
    if (name in BYTES) sources.delete(name);
    else for (const [byte, [word]] of Object.entries(BYTES)) if (word === name) sources.delete(byte);
  };
  const getRegister = (name: string): number => {
    if (name in BYTES) {
      const [word, shift] = BYTES[name]!;
      return (registers[word]! >> shift) & 0xff;
    }
    if (!WORDS.includes(name)) fail();
    return registers[name]!;
  };
  const setRegister = (name: string, value: number) => {
    clearSources(name);
    if (name in BYTES) {
      const [word, shift] = BYTES[name]!;
      registers[word] = (registers[word]! & ~(0xff << shift)) | ((value & 0xff) << shift);
    } else if (WORDS.includes(name)) registers[name] = value & 0xffff;
    else fail();
  };
  const address = (operand: Memory) =>
    (operand.base.reduce((sum, name) => sum + getRegister(name), 0) + operand.displacement) & 0xffff;
  const onStack = (operand: Memory) =>
    operand.segment === "ss" || (operand.base.includes("bp") && operand.segment !== "ds" && operand.segment !== "es");
  const dataByte = (at: number) => {
    if (at >= STACK) fail();
    result.reads.add(at);
    const value = image[dataSegment * 16 + at];
    return value === undefined ? fail() : value;
  };
  const partRead = (at: number, width: number): number => {
    const field = at - PART;
    if (width === 16 && field === fields.state) {
      result.readsFrame = true;
      return frame & 0xffff;
    }
    if (width === 16 && field === fields.outline) return OUTLINE;
    return fail();
  };
  const read = (operand: Operand, width: number, test?: number): { value: number; source?: number } => {
    if (operand.kind === "immediate") return { value: operand.value & mask(width) };
    if (operand.kind === "register") {
      const source = sources.get(operand.name);
      return { value: getRegister(operand.name), ...(source === undefined ? {} : { source }) };
    }
    if (operand.kind !== "memory") return fail();
    if (operand.segment === "es" || operand.segment === "cs") fail();
    const at = address(operand);
    if (onStack(operand)) {
      const low = stack.get(at) ?? fail();
      return { value: width === 8 ? low : low | ((stack.get(at + 1) ?? fail()) << 8) };
    }
    if (at >= PART && at < PART + 0x100) {
      const field = at - PART;
      if (test !== undefined && fields.flags !== undefined && field === fields.flags && width === 16) {
        for (let bit = 1; bit <= 0x8000; bit <<= 1) if (test & bit) result.tested.add(bit);
        return { value: flags & test };
      }
      return { value: partRead(at, width) };
    }
    if (at >= OUTLINE && at < OUTLINE + 0x200) return fail();
    if (width === 8) return { value: dataByte(at), source: at };
    return { value: dataByte(at) | (dataByte((at + 1) & 0xffff) << 8) };
  };
  const write = (operand: Operand, width: number, value: number, source?: number) => {
    if (operand.kind === "register") {
      setRegister(operand.name, value);
      if (source !== undefined && width === 8) sources.set(operand.name, source);
      return;
    }
    if (operand.kind !== "memory" || operand.segment === "es" || operand.segment === "cs") return fail();
    const at = address(operand);
    if (onStack(operand)) {
      stack.set(at, value & 0xff);
      if (width === 16) stack.set(at + 1, (value >> 8) & 0xff);
      return;
    }
    if (at >= PART && at < PART + 0x100) {
      // Other fields the reset sets don't change the outline, unless they are the ones the copy reads.
      const field = at - PART;
      const touches = (offset: number) => field <= offset + 1 && field + width / 8 > offset;
      if (touches(fields.state) || touches(fields.outline) || (fields.flags !== undefined && touches(fields.flags)))
        fail();
      return;
    }
    if (at >= OUTLINE && at < OUTLINE + 0x200) {
      result.outline.set(at - OUTLINE, {
        value: value & 0xff,
        ...(width === 8 && source !== undefined ? { source } : {}),
      });
      if (width === 16) result.outline.set(at - OUTLINE + 1, { value: (value >> 8) & 0xff });
      return;
    }
    fail();
  };
  const widthOf = (instruction: Instruction) => {
    const sized = instruction.operands.find((o) => o.kind === "register" || o.kind === "memory") as
      { width: number } | undefined;
    const width = sized?.width ?? 16;
    return width === 8 || width === 16 ? width : fail();
  };
  const condition = (mnemonic: string): boolean => {
    if (!compare) return fail();
    const { a, b, width, full } = compare;
    const sa = signed(a, width);
    const sb = signed(b, width);
    if (mnemonic === "je") return a === b;
    if (mnemonic === "jne") return a !== b;
    if (!full) return fail();
    if (mnemonic === "jl") return sa < sb;
    if (mnemonic === "jge") return sa >= sb;
    if (mnemonic === "jg") return sa > sb;
    if (mnemonic === "jle") return sa <= sb;
    if (mnemonic === "jb") return a < b;
    if (mnemonic === "jae") return a >= b;
    if (mnemonic === "ja") return a > b;
    if (mnemonic === "jbe") return a <= b;
    return fail();
  };

  let instruction = byAddress.get(code.address);
  for (let step = 0; ; step++) {
    if (!instruction || step > STEPS) fail();
    const i = instruction!;
    result.executed.add(i);
    if (i.prefixes.length) fail();
    const [first, second] = i.operands;
    const width = widthOf(i);
    let next = i.address + i.size;
    switch (i.mnemonic) {
      case "push": {
        if (!first || first.kind === "address") fail();
        push(read(first!, 16).value);
        break;
      }
      case "pop": {
        const at = registers.sp!;
        write(first!, 16, (stack.get(at) ?? fail()) | ((stack.get(at + 1) ?? fail()) << 8));
        registers.sp = (at + 2) & 0xffff;
        break;
      }
      case "mov": {
        const value = read(second!, width);
        write(first!, width, value.value, value.source);
        break;
      }
      case "add":
      case "sub":
      case "and":
      case "or":
      case "xor": {
        const a = read(first!, width).value;
        const b = read(second!, width).value;
        const value =
          i.mnemonic === "add"
            ? a + b
            : i.mnemonic === "sub"
              ? a - b
              : i.mnemonic === "and"
                ? a & b
                : i.mnemonic === "or"
                  ? a | b
                  : a ^ b;
        write(first!, width, value);
        compare = { a: value & mask(width), b: 0, width, full: ["and", "or", "xor"].includes(i.mnemonic) };
        break;
      }
      case "inc":
      case "dec": {
        const value = read(first!, width).value + (i.mnemonic === "inc" ? 1 : -1);
        write(first!, width, value);
        compare = { a: value & mask(width), b: 0, width, full: false };
        break;
      }
      case "shl": {
        const count = read(second!, 8).value;
        const value = read(first!, width).value << count;
        write(first!, width, value);
        compare = { a: value & mask(width), b: 0, width, full: false };
        break;
      }
      case "cmp": {
        compare = { a: read(first!, width).value, b: read(second!, width).value, width, full: true };
        break;
      }
      case "test": {
        const b = read(second!, width).value;
        const a = read(first!, width, second?.kind === "immediate" ? b : undefined).value;
        compare = { a: a & b, b: 0, width, full: true };
        break;
      }
      case "jmp": {
        if (i.flow !== "jump" || !i.target) fail();
        next = i.target!.address;
        break;
      }
      case "call":
      case "ret":
      case "retf":
        return result;
      default: {
        if (i.flow !== "branch" || !i.target) fail();
        if (condition(i.mnemonic)) next = i.target!.address;
      }
    }
    instruction = byAddress.get(next);
  }
}

/** The corners a run wrote, or undefined unless it wrote whole corners from the data segment and nothing else. */
function cornersOf(outline: Run["outline"]): { corners: [number, number][]; sources: number[] } | undefined {
  const count = Math.max(0, ...[...outline.keys()].map((offset) => (offset >> 2) + 1));
  if (!count) return undefined;
  const corners: [number, number][] = [];
  const sources: number[] = [];
  for (let k = 0; k < count; k++) {
    const x = outline.get(4 * k);
    const y = outline.get(4 * k + 1);
    if (x?.source === undefined || y?.source === undefined) return undefined;
    corners.push([x.value, y.value]);
    sources.push(x.source, y.source);
  }
  // The edge bytes are the geometry helper's; a copy that writes them isn't a plain table copy.
  if ([...outline.keys()].some((offset) => offset % 4 > 1)) return undefined;
  return { corners, sources };
}

/**
 * Runs a routine that copies the outline from tables, for every frame of the part and every value of the drawing flag
 * bits it tests. `written` are the data segment addresses some instruction writes by address; a table among them
 * isn't trusted. Undefined unless every run copies whole corners from the data segment.
 */
export function runOutlineTables(
  code: RoutineCode,
  image: Uint8Array,
  dataSegment: number,
  fields: Fields,
  /** The frames the part can be on: its frame list's, or, for a part the program draws, the decided ones. */
  frames: readonly number[],
  written: ReadonlySet<number>,
): OutlineTables | undefined {
  if (code.status !== "complete") return undefined;
  // Only a routine that loads its outline pointer can copy into it.
  if (
    !code.instructions.some(
      (i) => i.mnemonic === "mov" && i.operands[1]?.kind === "memory" && i.operands[1].displacement === fields.outline,
    )
  )
    return undefined;
  const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  const runs: { frame: number; flags: number; run: Run }[] = [];
  try {
    // Every frame and every value of the tested bits, also when only another run reads the frame or tests a bit.
    let readsFrame = false;
    let bits: number[] = [];
    for (let round = 0; ; round++) {
      if (round > 3 || bits.length > 2 || (readsFrame && !frames.length)) return undefined;
      runs.length = 0;
      for (const frame of readsFrame ? frames : [0])
        for (let choice = 0; choice < 1 << bits.length; choice++) {
          const flags = bits.reduce((sum, bit, k) => (choice & (1 << k) ? sum | bit : sum), 0);
          runs.push({ frame, flags, run: run(code, byAddress, image, dataSegment, fields, frame, flags) });
        }
      const all = [...new Set(runs.flatMap(({ run }) => [...run.tested]))];
      const framed = runs.some(({ run }) => run.readsFrame);
      if (all.length === bits.length && framed === readsFrame) break;
      bits = all;
      readsFrame = framed;
    }
    const tested = bits.sort((a, b) => a - b);
    const tables = new Map<string, OutlineTableChoice>();
    for (const { frame, flags, run: one } of runs) {
      const copy = cornersOf(one.outline);
      if (!copy || copy.sources.some((at) => written.has(at))) return undefined;
      const key = JSON.stringify(copy.corners);
      const when = [
        ...(readsFrame ? [`frame == ${frame}`] : []),
        ...tested.map((bit) => `flags & 0x${bit.toString(16)} ${flags & bit ? "!=" : "=="} 0`),
      ];
      const prior = tables.get(key);
      if (prior) prior.when.push(when);
      else tables.set(key, { when: [when], address: copy.sources[0]!, corners: copy.corners });
    }
    const counts = new Set([...tables.values()].map((table) => table.corners.length));
    if (counts.size !== 1) return undefined;
    // A frame whose outline doesn't depend on a flag needs no flag test.
    for (const table of tables.values()) {
      const byFrame = new Map<string, string[][]>();
      for (const when of table.when) {
        const frame = when.find((test) => test.startsWith("frame")) ?? "";
        byFrame.set(frame, [...(byFrame.get(frame) ?? []), when]);
      }
      table.when = [...byFrame].flatMap(([frame, list]) =>
        list.length === 1 << tested.length && tested.length ? [frame ? [frame] : []] : list,
      );
    }
    const executed = [...new Set(runs.flatMap(({ run }) => [...run.executed]))].sort((a, b) => a.address - b.address);
    const evidence: Evidence[] = executed.map(({ address, bytes, text }) => ({ address, bytes, text }));
    return {
      routine: code.address,
      tables: [...tables.values()],
      confidence: "inferred",
      assumptions: [OUTLINE_TABLE_ASSUMPTION],
      evidence,
    };
  } catch (error) {
    if (error instanceof GiveUp) return undefined;
    throw error;
  }
}
