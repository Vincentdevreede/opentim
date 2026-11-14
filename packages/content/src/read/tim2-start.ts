/**
 * What TIM2.EXE does when a puzzle starts, as `puzzleStart` follows it for TIM 2: the order of its parts lists, which
 * decides the order its puzzle start walks the parts in, and the order of its bin.
 *
 * Both orders come from one insertion routine (file offset `0x221e2` in the CD build's code, `0x1a31:0x2a58`), which
 * puts a part on a list before the first part it should come before:
 *
 * - on the bin (`0x6855` in the CD build) by a table of types in the data (`0x422b:0x1f0`, ended by -1, read by
 *   `0x541d:0x154`): a part goes before the first part of its own type, or of a type that comes later in the table. A
 *   type the table doesn't have comes after all that it has, before the first part of its own type. So the bin holds
 *   the types in the table's order, and a type's parts in the reverse of the order they were put there;
 * - on the moving and the fixed list by the word at 0x38 of the type's own record (the near pointers at `0x4ba` in the
 *   data segment), lowest first. A part goes before the first part with a higher word; among parts with the same word,
 *   before the first that stands higher on the screen (a smaller y at 0xa6), or as high and further left (a smaller x
 *   at 0xa4), so the lowest come first; type 11 the other way up. The rope, type 49 and type 76 go before the first
 *   part of their word. The loader passes 1 for the routine's last word, so a part with bit 0x1000 of its third flag
 *   word goes after every part. The routine tests that bit in the record (0x0e), which the loader fills before it
 *   (`tim2Third`), so a bit 0x1000 only the file has doesn't count.
 */
import { readToonsMemory } from "./toons-drawing.ts";
import type { Level, LevelPart } from "./level.ts";

/** The type table and the bin's order table of TIM2.EXE, as `readTim2StartTables` finds them. */
export interface Tim2StartTables {
  /** Each type's word the parts lists are sorted by. */
  listKeys: Map<number, number>;
  /** Each type's place in the bin's order; a type without one comes after all that have one. */
  binRank: Map<number, number>;
  /** Each type's own bits of the third flag word, which the loader puts with the file's bits 0x140. */
  third: Map<number, number>;
}

const u16 = (m: Uint8Array, at: number) => m[at]! | (m[at + 1]! << 8);
const s16 = (v: number) => (v >= 0x8000 ? v - 0x10000 : v);

/** Finds a byte pattern, `-1` for any byte. */
function find(m: Uint8Array, pattern: number[], from = 0): number {
  outer: for (let at = from; at + pattern.length <= m.length; at++) {
    for (let k = 0; k < pattern.length; k++) if (pattern[k]! >= 0 && m[at + k] !== pattern[k]) continue outer;
    return at;
  }
  return -1;
}

const ANY = -1;

/**
 * Reads the two tables from TIM2.EXE: the bin's from the routine that compares two types by it
 * (`mov word [bp-2], segment; mov word [bp-4], table; jmp; les bx, [bp-4]; cmp es:[bx], dx`), the lists' from the
 * insertion routine (`mov bx, [bx + types]; mov ax, [bx + key]; mov bx, [bp-2]; add bx, bx; mov bx, [bx + types];
 * cmp ax, [bx + key]`). Undefined when either isn't found.
 */
export function readTim2StartTables(exe: Uint8Array): Tim2StartTables | undefined {
  const program = readToonsMemory(exe);
  const m = program.memory;
  const data = program.dataSegment * 16;
  const bin = find(m, [
    0xc7,
    0x46,
    0xfe,
    ANY,
    ANY,
    0xc7,
    0x46,
    0xfc,
    ANY,
    ANY,
    0xeb,
    ANY,
    0xc4,
    0x5e,
    0xfc,
    0x26,
    0x39,
    0x17,
  ]);
  // prettier-ignore
  const list = find(m, [0x8b, 0x9f, ANY, ANY, 0x8b, 0x47, ANY, 0x8b, 0x5e, 0xfe, 0x03, 0xdb, 0x8b, 0x9f, ANY, ANY, 0x3b, 0x47]);
  // The loader's `mov ax, [bx + third]; or ax, [bp-0x0e]; mov bx, [bp+8]; mov es:[bx+0x0e], ax`.
  const own = find(m, [0x8b, 0x47, ANY, 0x0b, 0x46, 0xf2, 0x8b, 0x5e, 0x08, 0x26, 0x89, 0x47, 0x0e]);
  if (bin < 0 || list < 0 || own < 0) return undefined;
  const binRank = new Map<number, number>();
  const table = u16(m, bin + 3) * 16 + u16(m, bin + 8);
  for (let k = 0, at = table; u16(m, at) !== 0xffff && k < 1000; k++, at += 2)
    if (!binRank.has(u16(m, at))) binRank.set(u16(m, at), k);
  const types = u16(m, list + 2);
  const key = m[list + 6]!;
  const listKeys = new Map<number, number>();
  const third = new Map<number, number>();
  // The loader takes the type's own bits for the types below 0x119.
  for (let type = 0; type < 0x119; type++) {
    const record = u16(m, data + types + 2 * type);
    if (!record) continue;
    listKeys.set(type, s16(u16(m, data + record + key)));
    third.set(type, u16(m, data + record + m[own + 2]!));
  }
  return { listKeys, binRank, third };
}

/** The rope and the two other types the insertion routine puts first among the parts of their word. */
const FIRST_OF_THEIR_WORD = [49, 10, 76];
/** The one type the routine sorts the other way up. */
const UPWARD = 11;
/** Bit 0x1000 of the third flag word: the loader puts the part after every other part of its list. */
const LAST = 0x1000;

/** A level's moving or fixed list in TIM2.EXE's order, as level part indices. */
export function tim2ListOrder(level: Level, group: "moving" | "static", tables: Tim2StartTables): number[] {
  const list: LevelPart[] = [];
  const key = (p: LevelPart) => tables.listKeys.get(p.type) ?? 0;
  for (const part of level.parts.filter((p) => p.group === group)) {
    let at = list.length;
    if (!(tim2Third(part, tables) & LAST))
      for (let k = 0; k < list.length; k++) {
        const cur = list[k]!;
        if (key(part) !== key(cur)) {
          if (key(part) < key(cur)) {
            at = k;
            break;
          }
          continue;
        }
        if (FIRST_OF_THEIR_WORD.includes(part.type)) {
          at = k;
          break;
        }
        const [y, x, cy, cx] = [part.position.y, part.position.x, cur.position.y, cur.position.x];
        const goesBefore =
          part.type === UPWARD && cur.type === UPWARD ? cy > y || (cy === y && cx < x) : cy < y || (cy === y && cx < x);
        if (goesBefore) {
          at = k;
          break;
        }
      }
    list.splice(at, 0, part);
  }
  return list.map((p) => p.index);
}

/** Puts `index` on the bin as TIM2.EXE's insertion routine does. */
export function tim2BinInsert(bin: number[], index: number, level: Level, tables: Tim2StartTables): void {
  const type = level.parts[index]!.type;
  const rank = (t: number) => tables.binRank.get(t) ?? Infinity;
  const at = bin.findIndex((other) => {
    const t = level.parts[other]!.type;
    return t === type || rank(type) < rank(t);
  });
  bin.splice(at < 0 ? bin.length : at, 0, index);
}

/** Bits 0x40 and 0x100 of the third flag word: the part stays on the board; it stays in the bin for the solution. */
const FIXED = 0x40;
const NOT_IN_SOLUTION = 0x100;

/** A part's third flag word as TIM2.EXE's loader keeps it: the type's own bits, and the file's bits 0x140. */
export function tim2Third(part: LevelPart, tables: Tim2StartTables): number {
  return (tables.third.get(part.type) ?? 0) | ((part.flags[2] ?? 0) & (FIXED | NOT_IN_SOLUTION));
}

/** Where TIM2.EXE's puzzle start leaves the parts, and what it changes on the board. */
export interface Tim2PuzzleStart {
  /** The bin in TIM2.EXE's order. */
  bin: number[];
  /** Explosives taken off with their remote control. */
  gone: Set<number>;
  /** States it changes on the board. */
  states: Map<number, number>;
  /** Plugs it changes on the board: each part's two plugs after the start. */
  plugs: Map<number, [number | null, number | null]>;
  /** Rope places it unties on the board: a part's index and the place. */
  untied: [number, number][];
  /** Board parts it takes a belt off. */
  unbelted: number[];
}

const PULLEY = 7;
const BELT = 8;
/** The electric switch and the electrical outlet keep bit 4 of their state (on or off). */
const KEEPS_BIT_4 = [21, 120];
/** The generator and the solar panel. */
const PLUG_BITS = [26, 38];
/** The laser-activated plug: seven states for each way its places are taken. */
const LASER_PLUG = 96;

/**
 * The state a part on the board takes when the start pulls a plug out of it. The routine that pulls a plug out
 * (file offset `0x21b4f` in the CD build) clears both plug words and calls the type routine at 0x08 of the type's
 * record for both parts, and keeps the state as the one the part starts from (0xa8). The routines of the types the
 * shipped levels unplug, read from TIM2.EXE (in the CD build):
 *
 * - the electric switch (`2354:0x28b8`) and the electrical outlet (`2354:0xb119`): bit 4 of the state stays, 1 for a
 *   plug in the first place, 2 for one in the second;
 * - the generator (`2354:0x2f6c`) and the solar panel (`2354:0x4f9b`): 1 and 2 for the two places, nothing else;
 * - the laser-activated plug (`2354:0x9fcd`): the state's remainder by 7, 7 more for a plug in the first place and 14
 *   more for one in the second.
 *
 * Another type's routine isn't read, so its state is left as the file has it.
 */
function unpluggedState(part: LevelPart, plugs: [number | null, number | null]): number {
  const state = part.state[0];
  const first = plugs[0] !== null ? 1 : 0;
  const second = plugs[1] !== null ? 1 : 0;
  if (KEEPS_BIT_4.includes(part.type)) return (state & 4) | first | (second << 1);
  if (PLUG_BITS.includes(part.type)) return first | (second << 1);
  if (part.type === LASER_PLUG) return (state % 7) + 7 * first + 14 * second;
  return state;
}
/** The rope, the rope end and the steel cable: each keeps the record of what it ties. */
const ROPES = [10, 49, 76];
const REMOTE_CONTROL = 22;
const EXPLOSIVES = 55;

/**
 * TIM2.EXE's puzzle start (file offset `0x68817` in the CD build): it walks the moving list and then the fixed list in
 * their order and puts each part without bit 0x40 in the bin; for the designer's solution (mode 9) only those with
 * bit 0x100 too. A part that goes to the bin takes with it the belt round it and the ropes tied to it, which are untied
 * from the parts on the board, and pulls out the plugs of the parts plugged into it, whose type's routine sets their
 * state again (`unpluggedState`). A pulley takes the rope over it first. The explosives of a remote control are taken
 * off, and the remote control goes to the bin, when either of the two goes.
 */
export function tim2PuzzleStart(level: Level, tables: Tim2StartTables, solution = false): Tim2PuzzleStart {
  const parts = level.parts;
  const bin: number[] = [];
  const inBin = new Set<number>();
  const gone = new Set<number>();
  const states = new Map<number, number>();
  const plugs = new Map(parts.map((p) => [p.index, [...(p.plugs ?? [null, null])] as [number | null, number | null]]));
  const changed = new Set<number>();
  const untied: [number, number][] = [];
  const unbelted = new Set<number>();
  const put = (index: number) => {
    if (inBin.has(index) || gone.has(index)) return false;
    inBin.add(index);
    tim2BinInsert(bin, index, level, tables);
    return true;
  };
  const ropesOf = (index: number) =>
    parts.filter((r) => ROPES.includes(r.type) && r.ropes[0].rope?.parts.includes(index)).map((r) => r.index);
  const beltOf = (index: number) =>
    parts.filter((b) => b.type === BELT && b.belt.parts?.includes(index)).map((b) => b.index);
  const untie = (rope: number) => {
    const record = parts[rope]!.ropes[0].rope;
    record?.parts.forEach((end, k) => {
      if (end !== null) untied.push([end, record.slots[k]!]);
    });
    // A pulley keeps the rope over it at its second rope place, when the loader read the rope first.
    for (const pulley of parts)
      if (pulley.type === PULLEY && pulley.pulley === rope && rope < pulley.index) untied.push([pulley.index, 1]);
  };
  const binPart = (index: number) => {
    const part = parts[index]!;
    if (part.type === EXPLOSIVES || part.type === REMOTE_CONTROL) {
      const remote = part.type === REMOTE_CONTROL ? index : part.links[1];
      const explosives = part.type === REMOTE_CONTROL ? part.links[1] : index;
      if (explosives !== null && explosives !== undefined) gone.add(explosives);
      if (remote !== null && remote !== undefined) put(remote);
      return;
    }
    // A pulley takes the rope over it to the bin first.
    if (part.type === PULLEY && part.pulley !== null && part.pulley !== undefined && !inBin.has(index))
      if (put(part.pulley)) untie(part.pulley);
    if (!put(index)) return;
    for (const other of plugs.get(index)!) {
      const own = other === null ? undefined : plugs.get(other);
      if (other === null || !own?.includes(index)) continue;
      own.forEach((p, k) => p === index && (own[k] = null));
      changed.add(other);
      states.set(other, unpluggedState(parts[other]!, own));
    }
    if (part.type === BELT) {
      for (const end of part.belt.parts ?? []) if (end !== null) unbelted.add(end);
    } else
      for (const belt of beltOf(index)) {
        for (const end of parts[belt]!.belt.parts ?? []) if (end !== null) unbelted.add(end);
        put(belt);
      }
    if (ROPES.includes(part.type)) untie(index);
    else for (const rope of ropesOf(index)) if (put(rope)) untie(rope);
  };
  const order = [...tim2ListOrder(level, "moving", tables), ...tim2ListOrder(level, "static", tables)];
  for (const index of order) {
    const third = tim2Third(parts[index]!, tables);
    if (third & FIXED) continue;
    if (solution && !(third & NOT_IN_SOLUTION)) continue;
    binPart(index);
  }
  const board = (index: number) => !inBin.has(index) && !gone.has(index);
  return {
    bin,
    gone,
    states: new Map([...states].filter(([i, state]) => board(i) && state !== parts[i]!.state[0])),
    plugs: new Map(
      [...changed]
        .filter(board)
        .sort((a, b) => a - b)
        .map((i) => [i, plugs.get(i)!]),
    ),
    untied: untied.filter(([i]) => board(i)).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    unbelted: [...unbelted].filter(board).sort((a, b) => a - b),
  };
}
