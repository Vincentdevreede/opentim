/**
 * Loops that walk a list until one member is found, act once, and stop: the cat looking through the parts it found
 * for a mouse. A pass that moves on to the next member must change nothing but private locals and registers; every
 * write and every call that changes memory must lie on a path that ends the walk by clearing the member pointer. Then
 * the loop either finds no member and changes nothing, or acts once for one member, whichever it is, and stops. The
 * analysis follows those two cases instead of the passes one by one. This is checked on the code, never assumed.
 */
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Evidence } from "./behaviour.ts";
import type { Instruction, Operand } from "./x86.ts";
import { evidenceOf, implicitRegisterWrites } from "./behaviour-terms.ts";

export interface FindFirstLoop {
  /** The null test of the member pointer at the loop head. */
  header: number;
  /** The jump after it, which the walk leaves by. */
  branch: number;
  exit: number;
  node: string;
  /** Registers a pass may change, which are unknown after the loop and at the start of a pass for any member. */
  registers: string[];
  /** Private locals a pass may write. */
  locals: Extract<Operand, { kind: "memory" }>[];
  /** True when a pass may call something that changes global storage. */
  globals: boolean;
  /** Writes a pass that goes on may make, by the register holding the object: the owner or the member. */
  passWrites: { register: string; offset: number; width: number }[];
  /** Calls a pass that goes on may make that change their argument, with the register passed. */
  passCalls: { register: string; callee: EngineSummary }[];
  /** True when every path to the list's first member crosses a search that leaves out the owner. */
  excludesOwner: boolean;
  /** The field the loop follows from member to member, which is also the list head the search fills. */
  nextField: number;
  evidence: Evidence[];
}

export const FIND_FIRST_ASSUMPTION =
  "The list the loop walks ends. A pass that moves on to the next member changes only the fields the check found, never the owner's state, so after any number of such passes the loop either stops or acts once for one member and stops.";

const VOLATILE = ["ax", "bx", "cx", "dx", "es"];
const WHOLE: Record<string, string> = {
  al: "ax",
  ah: "ax",
  bl: "bx",
  bh: "bx",
  cl: "cx",
  ch: "cx",
  dl: "dx",
  dh: "dx",
};
const NOT_WRITING = ["cmp", "test", "push", "nop", "cld", "std", "clc", "stc", "cmc"];
const writes = (i: Instruction) => i.flow === "next" && !NOT_WRITING.includes(i.mnemonic) && i.operands.length > 0;
const local = (op: Operand | undefined): boolean =>
  op?.kind === "memory" && op.segment === "ss" && op.base.join() === "bp" && op.displacement < 0;

/** A callee that changes no part and no record: it may only read, or write globals. */
function pure(summary: EngineSummary | undefined): boolean {
  return (
    !!summary &&
    summary.footprint.partMemoryComplete === true &&
    summary.footprint.preservesArgumentMemory === true &&
    summary.footprint.preservesPartState === true &&
    !summary.connected &&
    !summary.list &&
    !summary.footprint.unknownPartEffects?.length &&
    summary.writes.every((write) => write.root === "global")
  );
}

export function discoverFindFirstLoops(
  code: RoutineCode,
  helpers: Map<number, EngineSummary>,
): Map<number, FindFirstLoop> {
  const loops = new Map<number, FindFirstLoop>();
  if (code.status !== "complete") return loops;
  const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  const next = new Map<number, number[]>(),
    previous = new Map<number, number[]>();
  for (const e of code.edges)
    if (e.to !== null) {
      next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
      previous.set(e.to, [...(previous.get(e.to) ?? []), e.from]);
    }
  const reach = (start: number[], edges: Map<number, number[]>, stop: number) => {
    const seen = new Set<number>(),
      pending = [...start];
    while (pending.length) {
      const at = pending.pop()!;
      if (at === stop || seen.has(at)) continue;
      seen.add(at);
      pending.push(...(edges.get(at) ?? []));
    }
    return seen;
  };
  for (const guard of code.instructions) {
    const [a, b] = guard.operands;
    if (a?.kind !== "register" || a.width !== 16 || ["si", "bp", "sp"].includes(a.name)) continue;
    const tests =
      (["or", "test"].includes(guard.mnemonic) && b?.kind === "register" && b.name === a.name) ||
      (guard.mnemonic === "cmp" && b?.kind === "immediate" && b.value === 0);
    const branch = byAddress.get(guard.address + guard.size);
    if (!tests || !branch?.target || !["je", "jne"].includes(branch.mnemonic)) continue;
    const exit = branch.mnemonic === "je" ? branch.target.address : branch.address + branch.size;
    // The loop: what the head reaches without leaving by the exit, and what reaches the head back.
    const forward = reach(
      (next.get(branch.address) ?? []).filter((at) => at !== exit),
      next,
      guard.address,
    );
    const backward = reach(previous.get(guard.address) ?? [], previous, guard.address);
    const body = new Set([...forward].filter((at) => backward.has(at)));
    if (!body.size || body.has(exit)) continue;
    const node = a.name;
    const instructions = [...body].map((at) => byAddress.get(at)!).filter(Boolean);
    if (instructions.length !== body.size) continue;
    // The member pointer only moves to the next member, or is cleared to stop.
    const advances = instructions.filter(
      (i) =>
        i.mnemonic === "mov" &&
        i.operands[0]?.kind === "register" &&
        i.operands[0].name === node &&
        i.operands[1]?.kind === "memory" &&
        i.operands[1].base.join() === node,
    );
    const clears = (i: Instruction) =>
      i.operands[0]?.kind === "register" &&
      i.operands[0].name === node &&
      ((["xor", "sub"].includes(i.mnemonic) && i.operands[1]?.kind === "register" && i.operands[1].name === node) ||
        (i.mnemonic === "mov" && i.operands[1]?.kind === "immediate" && i.operands[1].value === 0));
    if (advances.length !== 1) continue;
    const advance = advances[0]!;
    if (
      instructions.some(
        (i) =>
          writes(i) &&
          i.operands[0]?.kind === "register" &&
          (i.operands[0].name === node || WHOLE[i.operands[0].name] === node) &&
          i !== advance &&
          !clears(i),
      ) ||
      instructions.some((i) => implicitRegisterWrites(i).includes(node)) ||
      instructions.some(
        (i) =>
          i.mnemonic === "xchg" ||
          /^(movs|stos|lods|scas|cmps|ins|outs|int|iret|enter|leave|pusha|popa|les|lds)/.test(i.mnemonic),
      )
    )
      continue;
    // What a pass that goes on to the next member may change. Everything else must be unable to reach the advance:
    // only a pass that stops may do it.
    let globals = false,
      valid = true;
    const registers = new Set<string>(),
      locals: Extract<Operand, { kind: "memory" }>[] = [],
      passWrites: FindFirstLoop["passWrites"] = [],
      passCalls: FindFirstLoop["passCalls"] = [];
    const before = new Map(code.instructions.map((i) => [i.address + i.size, i]));
    for (const i of instructions) {
      const passes = reach([i.address], next, guard.address).has(advance.address);
      if (i.flow === "call") {
        const call = code.calls.find((c) => c.instruction === i.address);
        const callee = call?.target && helpers.get(call.target.address);
        for (const name of VOLATILE) registers.add(name);
        if (pure(callee)) {
          globals ||= !!callee!.footprint.unknownGlobalEffects?.length || callee!.writes.length > 0;
          continue;
        }
        if (!passes) continue;
        let push = before.get(i.address);
        while (
          push?.mnemonic === "nop" ||
          (push?.mnemonic === "push" && push.operands[0]?.kind === "register" && push.operands[0].name === "cs")
        )
          push = before.get(push.address);
        const argument = push?.mnemonic === "push" ? push.operands[0] : undefined;
        const argumentOwn =
          !!callee &&
          callee.footprint.partMemoryComplete === true &&
          !callee.connected &&
          !callee.list &&
          !callee.footprint.unknownPartEffects?.length &&
          callee.writes.every(
            (write) =>
              write.root === "global" ||
              (write.root === "argument" && !write.path.length && write.argumentOffset === callee.argumentOffset),
          );
        if (argument?.kind !== "register" || !argumentOwn) {
          valid = false;
          break;
        }
        globals ||= !!callee.footprint.unknownGlobalEffects?.length || callee.writes.some((w) => w.root === "global");
        passCalls.push({ register: argument.name, callee });
        continue;
      }
      for (const name of implicitRegisterWrites(i)) registers.add(name);
      if (writes(i)) {
        const dest = i.operands[0];
        if (dest?.kind === "register") registers.add(WHOLE[dest.name] ?? dest.name);
        else if (dest?.kind === "memory") {
          if (local(dest)) locals.push(dest);
          else if (!passes) continue;
          else if (dest.segment === "ds" && dest.base.length === 1 && !dest.direct)
            passWrites.push({ register: dest.base[0]!, offset: dest.displacement, width: dest.width });
          else {
            valid = false;
            break;
          }
        }
      }
    }
    if (!valid) continue;
    // A pass may only write through registers it never changes, so they hold the same object on every pass.
    if ([...passWrites, ...passCalls].some((w) => w.register !== node && registers.has(w.register))) continue;
    const nextField = (advance.operands[1] as Extract<Operand, { kind: "memory" }>).displacement;
    const excludesOwner = searchesFirst(code, helpers, guard.address, body, node, nextField, next, previous);
    registers.delete(node);
    loops.set(guard.address, {
      header: guard.address,
      branch: branch.address,
      exit,
      node,
      registers: [...registers],
      locals,
      globals,
      passWrites,
      passCalls,
      excludesOwner,
      nextField,
      evidence: [evidenceOf(guard), evidenceOf(branch), evidenceOf(advance)],
    });
  }
  return loops;
}

/**
 * Whether the list's first member is loaded only after a search that leaves out the owner: the one load of the member
 * pointer that leads to the loop, from the field the loop follows, with such a search on every path to it.
 */
function searchesFirst(
  code: RoutineCode,
  helpers: Map<number, EngineSummary>,
  header: number,
  body: Set<number>,
  node: string,
  nextField: number,
  next: Map<number, number[]>,
  previous: Map<number, number[]>,
): boolean {
  const leadsToLoop = (from: number) => {
    const seen = new Set<number>(),
      pending = [...(next.get(from) ?? [])];
    while (pending.length) {
      const at = pending.pop()!;
      if (at === header) return true;
      if (seen.has(at) || body.has(at)) continue;
      seen.add(at);
      pending.push(...(next.get(at) ?? []));
    }
    return false;
  };
  const loads = code.instructions.filter(
    (i) =>
      !body.has(i.address) &&
      i.address !== header &&
      i.mnemonic === "mov" &&
      i.operands[0]?.kind === "register" &&
      i.operands[0].name === node &&
      i.operands[1]?.kind === "memory" &&
      i.operands[1].displacement === nextField &&
      i.operands[1].base.length === 1 &&
      i.operands[1].base[0] !== node &&
      leadsToLoop(i.address),
  );
  if (loads.length !== 1) return false;
  const searches = new Set(
    code.calls
      .filter((call) => {
        const list = call.target && helpers.get(call.target.address)?.list;
        return !!list && list.excludesArgument && list.headField === nextField && list.nextField === nextField;
      })
      .map((call) => call.instruction),
  );
  if (!searches.size) return false;
  // Walk back from the load: no way back to the routine's start may avoid a search.
  const seen = new Set<number>(),
    pending = [...(previous.get(loads[0]!.address) ?? [])];
  while (pending.length) {
    const at = pending.pop()!;
    if (searches.has(at) || seen.has(at)) continue;
    if (at === code.address) return false;
    seen.add(at);
    pending.push(...(previous.get(at) ?? []));
  }
  return true;
}
