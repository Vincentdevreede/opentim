/**
 * Which parts lists a search walks. Every overlap search starts at the list head routine (`0x682f` in Even More, English
 * floppy) and goes on with the list next routine (`0x686f`), and both take a mask: the head routine returns the first
 * nonempty global list whose bit the mask has (`0x2000` the fixed list, `0x1000` the moving list, `0x0800` a third
 * one), and the next routine, at the end of a list, goes on with the head routine or the third list by the mask it is
 * given. The search passes on its caller's mask, or a mask of its own (`0x448e` passes `0x3000`), so the lists a call
 * walks follow from what the call pushes.
 */
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Expression, Predicate } from "./behaviour.ts";
import { writesRegister } from "./behaviour-terms.ts";
import type { Instruction, Operand } from "./x86.ts";

/** Where a mask comes from: the search's argument at a frame offset, kept to the bits of `and`, or a constant. */
export type ListMask = { argument: number; and?: number } | { constant: number };

const isRegister = (o: Operand | undefined): o is Extract<Operand, { kind: "register" }> => o?.kind === "register";
const frameArgument = (o: Operand | undefined) =>
  o?.kind === "memory" && o.segment === "ss" && o.base.join() === "bp" && o.displacement > 0 && o.width === 16
    ? o.displacement
    : undefined;

/**
 * The word a call pushes as its argument number `index` (0 the last pushed, at the callee's first argument), when it
 * is one of the forms the searches use: an argument of the routine, a constant, a register just loaded with either
 * (and maybe masked with a constant), or a register the routine loads once from an argument.
 */
export function pushedWord(code: RoutineCode, call: number, index: number): ListMask | undefined {
  const order = code.instructions;
  const at = order.findIndex((i) => i.address === call);
  // Nothing may jump into the instructions read before the call.
  const before = new Map(order.map((i, n) => [i.address, order[n - 1]?.address]));
  const entered = (from: number) =>
    code.edges.some((e) => e.to !== null && e.to > order[from]!.address && e.to <= call && e.from !== before.get(e.to));
  let k = at - 1;
  const skipped = (i: Instruction) => {
    const o = i.operands[0];
    return i.mnemonic === "nop" || (i.mnemonic === "push" && isRegister(o) && o.name === "cs");
  };
  while (k >= 0 && skipped(order[k]!)) k--;
  for (let pushes = 0; k >= 0; k--, pushes++) {
    if (order[k]!.mnemonic !== "push") return undefined;
    if (pushes === index) break;
  }
  if (k < 0 || entered(k)) return undefined;
  const pushed = order[k]!.operands[0];
  const argument = frameArgument(pushed);
  if (argument !== undefined) return { argument };
  if (pushed?.kind === "immediate") return { constant: pushed.value & 0xffff };
  if (!isRegister(pushed) || pushed.width !== 16) return undefined;
  const name = pushed.name;
  // `mov r, imm` or `mov r, [bp+x]`, maybe followed by `and r, imm`, right before the push.
  let j = k - 1;
  let and: number | undefined;
  const masked = order[j];
  if (masked?.mnemonic === "and" && isRegister(masked.operands[0]) && masked.operands[0].name === name) {
    if (masked.operands[1]?.kind !== "immediate") return undefined;
    and = masked.operands[1].value & 0xffff;
    j--;
  }
  const load = order[j];
  if (load?.mnemonic === "mov" && isRegister(load.operands[0]) && load.operands[0].name === name && !entered(j)) {
    const from = load.operands[1];
    if (from?.kind === "immediate") return { constant: from.value & (and ?? 0xffff) & 0xffff };
    const loaded = frameArgument(from);
    if (loaded !== undefined) return and === undefined ? { argument: loaded } : { argument: loaded, and };
    return undefined;
  }
  if (and !== undefined) return undefined;
  // A register the routine loads from an argument on every way to the push, with no other write of it on a way from
  // there to the push, like the next routine's mask in `di`.
  const push = order[k]!.address;
  const reaches = (from: number[], to: number, avoiding: number) => {
    const seen = new Set<number>();
    const pending = [...from];
    while (pending.length) {
      const at = pending.pop()!;
      if (at === to) return true;
      if (at === avoiding || seen.has(at)) continue;
      seen.add(at);
      for (const e of code.edges) if (e.from === at && e.to !== null) pending.push(e.to);
    }
    return false;
  };
  const after = (i: Instruction) => code.edges.flatMap((e) => (e.from === i.address && e.to !== null ? [e.to] : []));
  const loads = order.filter(
    (i) => writesRegister(i, name) && i.mnemonic === "mov" && frameArgument(i.operands[1]) !== undefined,
  );
  if (loads.length !== 1) return undefined;
  const only = loads[0]!;
  const others = order.filter((i) => i !== only && writesRegister(i, name));
  if (reaches([order[0]!.address], push, only.address)) return undefined;
  if (others.some((w) => reaches(after(w), push, only.address))) return undefined;
  return { argument: frameArgument(only.operands[1])! };
}

/** The one call of a routine to a helper of the kind, or undefined when there are none or several. */
function onlyCall(code: RoutineCode, summaries: Map<number, EngineSummary>, kind: EngineSummary["kind"]) {
  const calls = code.calls.filter((c) => c.target && summaries.get(c.target.address)?.kind === kind);
  return calls.length === 1 ? calls[0]! : undefined;
}

/**
 * Gives each overlap search that calls the list head and the list next routine once each the masks it passes them,
 * and the list next routine the mask it passes the list head routine.
 */
export function addListMasks(codes: Map<number, RoutineCode>, summaries: Map<number, EngineSummary>): void {
  for (const summary of summaries.values()) {
    const code = codes.get(summary.address);
    if (!code) continue;
    if (summary.kind === "list-next") {
      const call = onlyCall(code, summaries, "list-head");
      const head = call && pushedWord(code, call.instruction, 0);
      if (head) summary.listNext = { head, address: call.target!.address };
    }
    if (summary.kind !== "overlap-list" || !summary.list) continue;
    const headCall = onlyCall(code, summaries, "list-head");
    const nextCall = onlyCall(code, summaries, "list-next");
    if (!headCall || !nextCall) continue;
    const head = pushedWord(code, headCall.instruction, 0);
    const next = pushedWord(code, nextCall.instruction, 1);
    if (head && next)
      summary.list.masks = { head, next, headRoutine: headCall.target!.address, nextRoutine: nextCall.target!.address };
  }
}

/** A mask's value at a call, from the constants the call passes, or undefined when it isn't a constant. */
export function maskValue(mask: ListMask, passed: (argument: number) => number | undefined): number | undefined {
  if ("constant" in mask) return mask.constant;
  const value = passed(mask.argument);
  return value === undefined ? undefined : value & (mask.and ?? 0xffff) & 0xffff;
}

/** `x & bit != 0` with `x` the field of `object` at `offset`: the bit, or undefined. */
function bitSet(term: Predicate, object: string, offset: number): number | undefined {
  if (term.kind !== "compare" || term.operator !== "!=") return undefined;
  const { left, right } = term;
  if (right.kind !== "constant" || right.value !== 0 || left.kind !== "binary" || left.operator !== "&")
    return undefined;
  const of: Expression = left.left;
  if (of.kind !== "field" || of.object !== object || of.offset !== offset || left.right.kind !== "constant")
    return undefined;
  return left.right.value;
}

/**
 * The global lists a helper's returns pick by the mask in its argument at `offset`: each return of a global list head
 * whose condition needs one bit of the mask, with that bit. Undefined when a return of a list isn't read that way.
 */
function listsByBit(summary: EngineSummary, offset: number): { bit: number; head: number }[] | undefined {
  const lists: { bit: number; head: number }[] = [];
  for (const r of summary.returns) {
    if (r.pointer?.kind !== "global") continue;
    const terms = r.condition?.kind === "and" ? r.condition.terms : r.condition ? [r.condition] : [];
    const bits = terms.flatMap((t) => bitSet(t, "argument", offset) ?? []);
    if (bits.length !== 1) return undefined;
    lists.push({ bit: bits[0]!, head: r.pointer.offset });
  }
  return lists;
}

/**
 * The heads of the global lists a search's call walks, given the masks the call gives the list head and list next
 * routines (`EngineCall.listMasks`): the lists the head routine picks by its mask, and those the next routine goes on to
 * by its mask. Undefined when a routine's lists aren't read.
 */
export function searchedLists(
  helpers: readonly EngineSummary[],
  search: EngineSummary,
  passed: { head: number; next: number },
): number[] | undefined {
  const masks = search.list?.masks;
  if (!masks) return undefined;
  const head = helpers.find((h) => h.address === masks.headRoutine && h.kind === "list-head");
  const next = helpers.find((h) => h.address === masks.nextRoutine && h.kind === "list-next");
  if (!head || !next?.listNext) return undefined;
  // The next routine passes the head routine its own mask, its argument after the part.
  const through = next.listNext;
  if (!("argument" in through.head) || through.head.and !== undefined || through.address !== head.address)
    return undefined;
  const byHead = listsByBit(head, head.argumentOffset ?? 6);
  const byNext = listsByBit(next, through.head.argument);
  if (!byHead || !byNext) return undefined;
  const heads = new Set<number>();
  for (const mask of [passed.head, passed.next]) for (const list of byHead) if (mask & list.bit) heads.add(list.head);
  for (const list of byNext) if (passed.next & list.bit) heads.add(list.head);
  return [...heads].sort((a, b) => a - b);
}

/**
 * The global lists the list head routine picks by a bit of its mask (`byHead`), and those the list next routine goes on
 * to by a bit of its own (`byNext`, the third list in Even More, English floppy). Undefined when they aren't read.
 */
export function globalLists(
  helpers: readonly EngineSummary[],
): { byHead: { bit: number; head: number }[]; byNext: { bit: number; head: number }[] } | undefined {
  const nexts = helpers.filter((h) => h.kind === "list-next" && h.listNext && "argument" in h.listNext.head);
  if (nexts.length !== 1) return undefined;
  const next = nexts[0]!;
  const through = next.listNext!;
  const head = helpers.find((h) => h.address === through.address && h.kind === "list-head");
  if (!head || !("argument" in through.head)) return undefined;
  const byHead = listsByBit(head, head.argumentOffset ?? 6);
  const byNext = listsByBit(next, through.head.argument);
  return byHead && byNext ? { byHead, byNext } : undefined;
}

/**
 * The part types part code makes with the part factory and links into the global list `head` itself, with the list
 * insertion: a call that pushes the list's head as a constant and, as the part, a register loaded from the factory's
 * return just after a call that pushes the type as a constant. In Even More (English floppy) the rope ends, pinballs and
 * bullets go into the moving list and the explosions into the fixed list. `unknown` counts the links into the list
 * whose part isn't read that way, like the explosion's wall split, which links copies of the wall it splits.
 */
export function typesLinkedInto(
  routines: readonly (RoutineCode & { engineCalls?: { instruction: number; summary: number }[] })[],
  helpers: readonly EngineSummary[],
  head: number,
): { types: Set<number>; unknown: number } {
  const kinds = new Map(helpers.map((h) => [h.address, h.kind]));
  const types = new Set<number>();
  let unknown = 0;
  for (const code of routines)
    for (const call of code.engineCalls ?? []) {
      if (kinds.get(call.summary) !== "ordered-part-insertion") continue;
      const list = pushedWord(code, call.instruction, 1);
      if (!list || !("constant" in list) || list.constant !== head) continue;
      const type = madePartType(code, call.instruction, kinds);
      if (type === undefined) unknown++;
      else types.add(type);
    }
  return { types, unknown };
}

/** The type the part pushed first before `call` was made with, when it comes straight from a part factory call. */
function madePartType(
  code: RoutineCode & { engineCalls?: { instruction: number; summary: number }[] },
  call: number,
  kinds: Map<number, string>,
): number | undefined {
  const order = code.instructions;
  const at = order.findIndex((i) => i.address === call);
  // The part is the last push before the call: `push ax` (the list) then `push si` (the part).
  let k = at - 1;
  const skipped = (i: Instruction) =>
    i.mnemonic === "nop" || (i.mnemonic === "push" && isRegister(i.operands[0]) && i.operands[0].name === "cs");
  while (k >= 0 && skipped(order[k]!)) k--;
  if (order[k]?.mnemonic !== "push") return undefined;
  const pushed = order[k]?.operands[0];
  if (!isRegister(pushed)) return undefined;
  // Its register was last set by `mov reg, ax`, with the factory's call at most three instructions before.
  for (k--; k >= 0 && !writesRegister(order[k]!, pushed.name); k--);
  const set = order[k];
  if (!set || set.mnemonic !== "mov" || !isRegister(set.operands[1]) || set.operands[1].name !== "ax") return undefined;
  // Nothing may jump into the instructions after the factory's call up to the insertion from outside them.
  const entered = (from: number) => {
    const start = order[from]!.address;
    return code.edges.some((e) => e.to !== null && e.to > start && e.to <= call && (e.from < start || e.from > call));
  };
  for (let j = k - 1; j >= Math.max(0, k - 3); j--) {
    const instruction = order[j]!;
    if (instruction.flow !== "call") continue;
    if (entered(j)) return undefined;
    const made = code.engineCalls?.find((c) => c.instruction === instruction.address);
    if (!made || kinds.get(made.summary) !== "part-factory") return undefined;
    const type = pushedWord(code, instruction.address, 0);
    return type && "constant" in type ? type.constant : undefined;
  }
  return undefined;
}
