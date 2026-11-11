/**
 * The routine that works out every type's speed limit, the word at +0x0a of its type record (`0x369c` in Even More,
 * English floppy; `0x2af1` in TIM 1, French). It walks the type records in a loop and stores, for each type, a number
 * for a few types and `0x2600` minus a value of the level's air pressure for the rest. The level loader calls it after
 * it reads the air pressure, and so does the control panel when the player sets a new one.
 *
 * The routine is found by its structure: a loop over the type numbers that points at the record of the type with
 * `type × stride + table`, and stores to +0x0a through that pointer. Each way through the loop's body is followed with
 * the tests of the type number on it, so a type whose every way stores the same number has that limit in every level.
 */
import { readRoutineCode, type RoutineCode } from "./behaviour-code.ts";
import type { Evidence, Finding } from "./behaviour.ts";
import type { Instruction, Operand } from "./x86.ts";
import { evidenceOf, isRegister, sameOperand, wordAt } from "./behaviour-terms.ts";

export interface SpeedLimitSetup extends Finding {
  /** The routine's address in the unpacked image. */
  routine: number;
  /** Where the program calls it: the level loader and the control panel. */
  callers: number[];
  /** The types whose limit is the same number whatever the level's air pressure, like the bullet's 12288. */
  fixed: { type: number; limit: number }[];
  /** Every other type's limit is this number minus a value of the air pressure, when the routine says so. */
  base?: number;
  /**
   * The value of the air pressure (the word at `address` in the data segment) the routine takes from `base`: the air
   * pressure shifted right by `below` when it is below `split` (signed), else shifted left by `above`.
   */
  air?: { address: number; split: number; below: number; above: number };
}

/** The speed limit's word in a type record. */
const LIMIT = 0x0a;
/** How far before the store the routine's `push bp; mov bp,sp` may be. */
const REACH = 512;
/** How many ways through the loop's body are followed before giving up. */
const MAX_WAYS = 256;

const immediate = (o: Operand | undefined) => (o?.kind === "immediate" ? o.value & 0xffff : undefined);
/** A local of the routine's frame: a word below `bp`. */
const isLocal = (o: Operand | undefined): o is Extract<Operand, { kind: "memory" }> =>
  o?.kind === "memory" && o.segment === "ss" && o.base.join() === "bp" && o.displacement < 0;
/** Instructions that leave their first operand as it was. */
const READS_ONLY = new Set(["cmp", "test", "push"]);
/** Instructions that write ax and dx whatever their operands say. */
const WRITES_AX_DX = new Set(["mul", "imul", "div", "idiv", "cwd", "cbw"]);

/** Whether the instruction may change the register (or one sharing its bits) or the memory operand. */
function writes(i: Instruction, target: Operand): boolean {
  if (i.flow === "call") return target.kind === "register" && ["ax", "bx", "cx", "dx", "es"].includes(target.name);
  if (target.kind === "register") {
    const shares = (o: Operand | undefined) =>
      isRegister(o) &&
      (o.name === target.name ||
        (/^[abcd]x$/.test(target.name) && o.name[0] === target.name[0] && /^[abcd][xlh]$/.test(o.name)));
    if (WRITES_AX_DX.has(i.mnemonic) && ["ax", "dx"].includes(target.name)) return true;
    if (["les", "lds"].includes(i.mnemonic) && target.name === (i.mnemonic === "les" ? "es" : "ds")) return true;
    if (["pop", "xchg"].includes(i.mnemonic) && i.operands.some(shares)) return true;
    return shares(i.operands[0]) && !READS_ONLY.has(i.mnemonic);
  }
  const store = i.operands[0];
  if (READS_ONLY.has(i.mnemonic) || store?.kind !== "memory") return false;
  // A local is changed by a store to any of its bytes, whatever the store's width.
  if (isLocal(target) && isLocal(store))
    return (
      store.displacement < target.displacement + target.width / 8 &&
      target.displacement < store.displacement + store.width / 8
    );
  return sameOperand(store, target);
}

/** The far calls to the routine, by their `call far seg:offset` bytes. */
function farCallers(image: Uint8Array, entry: number): { at: number; segment: number }[] {
  const callers = [];
  for (let at = 0; at + 5 <= image.length; at++)
    if (image[at] === 0x9a && wordAt(image, at + 3) * 16 + wordAt(image, at + 1) === entry)
      callers.push({ at, segment: wordAt(image, at + 3) });
  return callers;
}

/** Where the loop keeps a record's place: the counter it reads it from, and the pointer it puts it in. */
interface RecordPlace {
  k: number;
  counter: Operand;
  address: number;
  pointer: Operand;
  /** The last instruction that sets the pointer. */
  last: number;
}

interface Way {
  /** The type numbers the way's tests say the counter equals, and those they say it doesn't. */
  equals: number[];
  differs: number[];
  /** The last store to the speed limit word on the way: a number, `base - x`, or a value not read. */
  limit?: { value: number } | { base: number; minus: Operand } | { open: true };
}

/**
 * Reads the speed limit routine of a program, or gives undefined when no routine has the structure. `table` is the
 * type records' address in the unpacked image, their size and how many there are.
 */
export function findSpeedLimitSetup(
  image: Uint8Array,
  table: { address: number; stride: number; count: number },
  dataSegment: number,
): SpeedLimitSetup | undefined {
  // The routine computes a record's place with `mov dx,stride; imul dx` and stores a number at +0x0a, maybe through es.
  const multiply = [0xba, table.stride & 0xff, table.stride >> 8, 0xf7, 0xea];
  const entries = new Set<number>();
  for (let at = 0; at + 6 <= image.length; at++) {
    const op = image[at] === 0x26 ? at + 1 : at;
    if (image[op] !== 0xc7 || (image[op + 1]! & 0xf8) !== 0x40 || image[op + 2] !== LIMIT) continue;
    let entry = at;
    while (
      entry > at - REACH &&
      entry > 0 &&
      !(image[entry] === 0x55 && image[entry + 1] === 0x8b && image[entry + 2] === 0xec)
    )
      entry--;
    if (entry <= at - REACH || entry <= 0) continue;
    const between = image.subarray(entry, at);
    if (between.some((_, n) => multiply.every((b, k) => between[n + k] === b))) entries.add(entry);
  }
  const found: SpeedLimitSetup[] = [];
  for (const entry of entries) {
    const callers = farCallers(image, entry);
    const segments = new Set(callers.map((c) => c.segment));
    if (segments.size !== 1) continue;
    const segment = [...segments][0]!;
    const code = readRoutineCode(image, { segment, offset: entry - segment * 16, address: entry }, dataSegment);
    const setup = readSetup(code, table, dataSegment);
    if (setup) found.push({ ...setup, callers: callers.map((c) => c.at) });
  }
  return found.length === 1 ? found[0] : undefined;
}

function readSetup(
  code: RoutineCode,
  table: { address: number; stride: number; count: number },
  dataSegment: number,
): Omit<SpeedLimitSetup, "callers"> | undefined {
  if (code.status !== "complete") return;
  const list = code.instructions;
  const at = new Map(list.map((i, n) => [i.address, n]));
  // `mov ax,counter; mov dx,stride; imul dx; add ax,table`, then the pointer: a far one in two locals, or a register.
  const places = list.flatMap((i, k): RecordPlace[] => {
    const load = list[k - 2],
      size = list[k - 1],
      add = list[k + 1];
    if (i.mnemonic !== "imul" || !isRegister(i.operands[0], "dx")) return [];
    if (load?.mnemonic !== "mov" || !isRegister(load.operands[0], "ax")) return [];
    const counter = load.operands[1];
    if (!(isRegister(counter) && counter.width === 16) && !isLocal(counter)) return [];
    if (size?.mnemonic !== "mov" || !isRegister(size.operands[0], "dx") || immediate(size.operands[1]) !== table.stride)
      return [];
    if (add?.mnemonic !== "add" || !isRegister(add.operands[0], "ax") || immediate(add.operands[1]) === undefined)
      return [];
    const offset = immediate(add.operands[1])!;
    const [high, low] = [list[k + 2], list[k + 3]];
    // Far: `mov [bp+P+2],segment; mov [bp+P],ax`, read back with `les bx,[bp+P]`.
    if (
      high?.mnemonic === "mov" &&
      low?.mnemonic === "mov" &&
      isLocal(high.operands[0]) &&
      isLocal(low.operands[0]) &&
      high.operands[0].displacement === low.operands[0].displacement + 2 &&
      immediate(high.operands[1]) !== undefined &&
      isRegister(low.operands[1], "ax")
    )
      return [
        {
          k,
          counter,
          address: immediate(high.operands[1])! * 16 + offset,
          pointer: { ...low.operands[0], width: 32 },
          last: k + 3,
        },
      ];
    // Near: `mov r,ax`, a record in the data segment.
    if (high?.mnemonic === "mov" && isRegister(high.operands[0]) && isRegister(high.operands[1], "ax"))
      return [{ k, counter, address: dataSegment * 16 + offset, pointer: high.operands[0], last: k + 2 }];
    return [];
  });
  if (places.length !== 1) return;
  const place = places[0]!;
  if (place.address !== table.address) return;
  const { counter, pointer } = place;
  const head = list[place.k - 2]!.address;
  // The loop: `inc counter`, then `cmp counter,count` that leaves it, and a jump back to the head.
  const step = list.findIndex((i) => i.mnemonic === "inc" && sameOperand(i.operands[0], counter));
  if (step < 0 || list.filter((i) => i.mnemonic === "inc" && sameOperand(i.operands[0], counter)).length !== 1) return;
  const bound = list.find(
    (i) => i.mnemonic === "cmp" && sameOperand(i.operands[0], counter) && immediate(i.operands[1]) === table.count,
  );
  if (!bound || !code.edges.some((e) => e.to === head && at.get(e.from)! > place.k)) return;
  const nearPointer = pointer.kind === "register";
  const evidence: Evidence[] = [];

  // Every way from the head to the step, with the counter's tests on it.
  const ways: Way[] = [];
  let failed = false;
  const follow = (n: number, way: Way, seen: Set<number>, record: boolean) => {
    if (failed) return;
    if (ways.length >= MAX_WAYS || seen.has(n) || n < 0 || n >= list.length) {
      failed = true;
      return;
    }
    if (n === step) {
      ways.push(way);
      return;
    }
    const i = list[n]!;
    seen = new Set(seen).add(n);
    evidence.push(evidenceOf(i));
    // Nothing on the way may change the counter, and the pointer only where it is set.
    if (writes(i, counter) || (n > place.last && writes(i, pointer))) {
      failed = true;
      return;
    }
    // For a far pointer, bx holds the record after `les bx,pointer` until something else writes bx.
    if (!nearPointer) {
      if (i.mnemonic === "les" && isRegister(i.operands[0], "bx") && sameOperand(i.operands[1], pointer)) record = true;
      else if (
        writes(i, { kind: "register", name: "bx", width: 16 }) ||
        writes(i, { kind: "register", name: "es", width: 16 })
      )
        record = false;
    }
    const target = i.operands[0];
    const throughRecord =
      target?.kind === "memory" &&
      (nearPointer
        ? target.segment === "ds" && target.base.join() === (pointer as { name: string }).name
        : record && target.segment === "es" && target.base.join() === "bx");
    if (throughRecord && !READS_ONLY.has(i.mnemonic)) {
      const bytes = target.width / 8;
      const touches = target.displacement < LIMIT + 2 && target.displacement + bytes > LIMIT;
      if (touches) {
        if (i.mnemonic !== "mov" || target.width !== 16 || target.displacement !== LIMIT) {
          failed = true;
          return;
        }
        const value = immediate(i.operands[1]);
        let limit: Way["limit"] = value !== undefined ? { value } : { open: true };
        // `mov ax,base; sub ax,x; mov [record+0x0a],ax`.
        const [load, sub] = [list[n - 2], list[n - 1]];
        if (
          value === undefined &&
          isRegister(i.operands[1], "ax") &&
          load?.mnemonic === "mov" &&
          isRegister(load.operands[0], "ax") &&
          immediate(load.operands[1]) !== undefined &&
          sub?.mnemonic === "sub" &&
          isRegister(sub.operands[0], "ax") &&
          seen.has(n - 1) &&
          seen.has(n - 2)
        )
          limit = { base: immediate(load.operands[1])!, minus: sub.operands[1]! };
        way = { ...way, limit };
      }
    } else if (target?.kind === "memory" && !READS_ONLY.has(i.mnemonic) && !isLocal(target)) {
      // A store the analysis can't place may be to the record.
      failed = true;
      return;
    }
    const out = code.edges.filter((e) => e.from === i.address);
    if (out.some((e) => e.to === null || !at.has(e.to))) {
      failed = true;
      return;
    }
    // A test of the counter: `cmp counter,number` right before `je` or `jne`.
    const before = list[n - 1];
    const tested =
      i.flow === "branch" &&
      ["je", "jne"].includes(i.mnemonic) &&
      before?.mnemonic === "cmp" &&
      sameOperand(before.operands[0], counter) &&
      immediate(before.operands[1]) !== undefined
        ? immediate(before.operands[1])!
        : undefined;
    for (const edge of out) {
      let next = way;
      if (tested !== undefined) {
        const equal = (edge.kind === "taken") === (i.mnemonic === "je");
        next = equal ? { ...way, equals: [...way.equals, tested] } : { ...way, differs: [...way.differs, tested] };
      }
      follow(at.get(edge.to!)!, next, seen, record);
    }
  };
  follow(place.k - 2, { equals: [], differs: [] }, new Set(), false);
  if (failed || !ways.length) return;

  const fixed: SpeedLimitSetup["fixed"] = [];
  for (let type = 0; type < table.count; type++) {
    const taken = ways.filter((w) => w.equals.every((v) => v === type) && !w.differs.includes(type));
    const limits = new Set(taken.map((w) => (w.limit && "value" in w.limit ? w.limit.value : undefined)));
    const [limit] = [...limits];
    if (taken.length && limits.size === 1 && limit !== undefined) fixed.push({ type, limit });
  }
  const based = ways.flatMap((w) => (w.limit && "base" in w.limit ? [w.limit] : []));
  const bases = new Set(based.map((w) => w.base));
  const minus = new Set(based.map((w) => JSON.stringify(w.minus)));
  const air = minus.size === 1 ? airValue(list, based[0]!.minus, evidence) : undefined;
  const unique = [...new Map(evidence.map((e) => [e.address, e])).values()].sort((a, b) => a.address - b.address);
  return {
    confidence: "inferred",
    routine: code.address,
    fixed,
    ...(bases.size === 1 ? { base: [...bases][0]! } : {}),
    ...(air ? { air } : {}),
    evidence: unique,
    assumptions: [speedLimitSetupAssumption(code.address)],
  };
}

/**
 * How the routine works out the local it takes from the base: `mov ax,[air]; mov local,ax; cmp local,split; jge;
 * sar local,1; jmp; mov cl,n; shl local,cl`, the only instructions in the routine that write the local.
 */
function airValue(list: Instruction[], local: Operand, evidence: Evidence[]): SpeedLimitSetup["air"] {
  if (!isLocal(local)) return;
  const writers = list.flatMap((i, n) => (writes(i, local) ? [n] : []));
  if (writers.length !== 3) return;
  const [store, half, scale] = writers.map((n) => list[n]!);
  const n = writers[0]!;
  const [load, compare, branch, skip] = [list[n - 1], list[n + 1], list[n + 2], list[n + 4]];
  const count = list[writers[2]! - 1];
  const air = load?.operands[1];
  if (
    load?.mnemonic !== "mov" ||
    !isRegister(load.operands[0], "ax") ||
    air?.kind !== "memory" ||
    air.segment !== "ds" ||
    air.base.length ||
    air.width !== 16 ||
    store!.mnemonic !== "mov" ||
    !isRegister(store!.operands[1], "ax") ||
    compare?.mnemonic !== "cmp" ||
    !sameOperand(compare.operands[0], local) ||
    immediate(compare.operands[1]) === undefined ||
    branch?.mnemonic !== "jge" ||
    writers[1] !== n + 3 ||
    half!.mnemonic !== "sar" ||
    immediate(half!.operands[1]) === undefined ||
    skip?.flow !== "jump" ||
    branch.target?.address !== count?.address ||
    count?.mnemonic !== "mov" ||
    !isRegister(count.operands[0], "cl") ||
    immediate(count.operands[1]) === undefined ||
    writers[2] !== n + 6 ||
    scale!.mnemonic !== "shl" ||
    !isRegister(scale!.operands[1], "cl") ||
    skip.target?.address !== list[n + 7]?.address
  )
    return;
  evidence.push(...[load, store!, compare, branch, half!, skip, count, scale!].map(evidenceOf));
  const split = immediate(compare.operands[1])!;
  return {
    address: air.displacement,
    split: split & 0x8000 ? split - 0x10000 : split,
    below: immediate(half!.operands[1])!,
    above: immediate(count.operands[1])!,
  };
}

/** The speed limit the routine gives a type of the rest for an air pressure, as a signed word. */
export function limitForAir(setup: SpeedLimitSetup, air: number): number | undefined {
  if (setup.base === undefined || !setup.air) return undefined;
  const signed = (n: number) => ((n & 0xffff) ^ 0x8000) - 0x8000;
  const value = signed(air) < setup.air.split ? signed(air) >> setup.air.below : (air << setup.air.above) & 0xffff;
  return signed(setup.base - value);
}

/** What taking the routine's numbers as the limits needs. */
const speedLimitSetupAssumption = (routine: number) =>
  `The game works out every type's speed limit with the routine at 0x${routine.toString(16)} before any part moves: the level loader calls it after reading the air pressure, and the control panel after the player sets a new one. No other code writes a type record's speed limit, and the calls it makes (long multiplication and division) don't write the type records.`;
