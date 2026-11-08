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
import type { Instruction, Operand } from "./x86.ts";

/** Where a mask comes from: the search's argument at a frame offset, kept to the bits of `and`, or a constant. */
export type ListMask = { argument: number; and?: number } | { constant: number };

const isRegister = (o: Operand | undefined): o is Extract<Operand, { kind: "register" }> => o?.kind === "register";
const frameArgument = (o: Operand | undefined) =>
  o?.kind === "memory" && o.segment === "ss" && o.base.join() === "bp" && o.displacement > 0 && o.width === 16
    ? o.displacement
    : undefined;
/** Whether two register names share bits, like `ax` and `al`. */
const overlaps = (a: string, b: string) =>
  a === b ||
  (/^[abcd][xlh]$/.test(a) &&
    /^[abcd][xlh]$/.test(b) &&
    a[0] === b[0] &&
    (a[1] === "x" || b[1] === "x" || a[1] === b[1]));
const writes = (i: Instruction, name: string) =>
  (isRegister(i.operands[0]) && overlaps(i.operands[0].name, name) && !["cmp", "test", "push"].includes(i.mnemonic)) ||
  (["pop", "xchg"].includes(i.mnemonic) && i.operands.some((o) => isRegister(o) && overlaps(o.name, name))) ||
  (["mul", "imul", "div", "idiv", "cwd", "cbw", "lodsw", "lodsb", "in"].includes(i.mnemonic) &&
    ["ax", "dx", "al", "ah", "dl", "dh"].includes(name));

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
    (i) => writes(i, name) && i.mnemonic === "mov" && frameArgument(i.operands[1]) !== undefined,
  );
  if (loads.length !== 1) return undefined;
  const only = loads[0]!;
  const others = order.filter((i) => i !== only && writes(i, name));
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
