/** Finds separately allocated node pools and bounds routines which only modify those pools. */
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Finding } from "./behaviour.ts";
import type { Instruction, Operand } from "./x86.ts";
import { evidenceOf, isImmediate, isMemory, isRegister, storesToMemory } from "./behaviour-terms.ts";

const contiguous = (sequence: Instruction[]) =>
  sequence.every((i, n) => n === 0 || sequence[n - 1]!.address + sequence[n - 1]!.size === i.address);
/**
 * The new node pushed on a free list right after its allocation: `mov r,ax; mov ax,[head]; mov [r],ax; mov [head],r`,
 * or the same through a local as TIM 1 compiles it, `mov [bp-n],ax; mov r,[bp-n]; mov ax,[head]; mov [r],ax;
 * mov ax,[bp-n]; mov [head],ax`. Returns how many instructions it takes and the head's address.
 */
function freeListPush(code: Instruction[]): { length: number; head: number } | undefined {
  const headLoad = (i: Instruction | undefined) =>
    i?.mnemonic === "mov" &&
    isRegister(i.operands[0], "ax") &&
    isMemory(i.operands[1]) &&
    i.operands[1].segment === "ds" &&
    i.operands[1].direct &&
    i.operands[1].width === 16
      ? i.operands[1].displacement
      : undefined;
  const headStore = (i: Instruction | undefined, head: number, source: string) =>
    i?.mnemonic === "mov" &&
    isMemory(i.operands[0]) &&
    i.operands[0].direct &&
    i.operands[0].segment === "ds" &&
    i.operands[0].displacement === head &&
    isRegister(i.operands[1], source);
  const link = (i: Instruction | undefined, base: string) =>
    i?.mnemonic === "mov" &&
    isMemory(i.operands[0]) &&
    i.operands[0].segment === "ds" &&
    i.operands[0].base.join() === base &&
    i.operands[0].displacement === 0 &&
    i.operands[0].width === 16 &&
    isRegister(i.operands[1], "ax");
  const local = (o: Operand | undefined) =>
    isMemory(o) && o.segment === "ss" && o.base.join() === "bp" && o.displacement < 0 && o.width === 16 ? o : undefined;
  const [first, second, third, fourth, fifth, sixth] = code;
  if (first?.mnemonic === "mov" && isRegister(first.operands[0]) && isRegister(first.operands[1], "ax")) {
    const r = first.operands[0].name,
      head = headLoad(second);
    if (r !== "ax" && head !== undefined && link(third, r) && headStore(fourth, head, r)) return { length: 4, head };
  }
  const slot = first?.mnemonic === "mov" && isRegister(first.operands[1], "ax") ? local(first.operands[0]) : undefined;
  if (!slot || second?.mnemonic !== "mov" || !isRegister(second.operands[0]) || second.operands[0].name === "ax")
    return;
  const r = second.operands[0].name,
    head = headLoad(third),
    reload = local(fifth?.operands[1]);
  if (
    local(second.operands[1])?.displacement === slot.displacement &&
    head !== undefined &&
    link(fourth, r) &&
    fifth?.mnemonic === "mov" &&
    isRegister(fifth.operands[0], "ax") &&
    reload?.displacement === slot.displacement &&
    headStore(sixth, head, "ax")
  )
    return { length: 6, head };
  return undefined;
}
interface Pool extends Finding {
  heads: number[];
  size: number;
  next: number;
  initializer: number;
}

function pools(codes: Map<number, RoutineCode>, summaries: Map<number, EngineSummary>): Pool[] {
  const result: Pool[] = [];
  for (const code of codes.values())
    for (const call of code.calls) {
      const allocator = call.target && summaries.get(call.target.address);
      if (allocator?.kind !== "nullable-allocation" || allocator.returnPointerClass !== "nullable-fresh") continue;
      const before = code.instructions.filter((i) => i.address < call.instruction).slice(-4);
      if (
        before.length !== 4 ||
        before[0]!.mnemonic !== "mov" ||
        !isRegister(before[0]!.operands[0], "ax") ||
        !isImmediate(before[0]!.operands[1]) ||
        before[1]!.mnemonic !== "push" ||
        !isRegister(before[1]!.operands[0], "ax") ||
        before[2]!.mnemonic !== "mov" ||
        !isRegister(before[2]!.operands[0], "ax") ||
        !isImmediate(before[2]!.operands[1]) ||
        before[2]!.operands[1].value !== 1 ||
        before[3]!.mnemonic !== "push" ||
        !isRegister(before[3]!.operands[0], "ax")
      )
        continue;
      const size = before[0]!.operands[1].value;
      if (size < 4 || size > 32) continue;
      const following = code.instructions.filter((i) => i.address > call.instruction).slice(0, 8);
      if (following[0]?.mnemonic !== "pop" || following[1]?.mnemonic !== "pop") continue;
      const push = freeListPush(following.slice(2));
      if (!push) continue;
      const after = following.slice(0, 2 + push.length);
      const callInstruction = code.instructions.find((i) => i.address === call.instruction);
      if (!callInstruction || !contiguous([...before, callInstruction, ...after])) continue;
      const cleared = code.instructions.filter(
        (i, index) =>
          i.address < before[0]!.address &&
          i.mnemonic === "xor" &&
          isRegister(i.operands[0], "ax") &&
          isRegister(i.operands[1], "ax") &&
          code.instructions[index + 1]?.mnemonic === "mov" &&
          code.instructions[index + 2]?.mnemonic === "mov",
      );
      for (const clear of cleared) {
        const n = code.instructions.indexOf(clear),
          initial = code.instructions.slice(n + 1, n + 3);
        if (
          !initial.every(
            (i) =>
              isMemory(i.operands[0]) &&
              i.operands[0].direct &&
              i.operands[0].segment === "ds" &&
              i.operands[0].width === 16 &&
              isRegister(i.operands[1], "ax"),
          )
        )
          continue;
        const heads = initial.map((i) => (i.operands[0] as Extract<Operand, { kind: "memory" }>).displacement);
        if (new Set(heads).size !== 2 || !heads.includes(push.head)) continue;
        const protectedEntries = new Set([...before, callInstruction, ...after].slice(1).map((i) => i.address));
        if (
          code.edges.some(
            (edge) =>
              edge.to !== null &&
              protectedEntries.has(edge.to) &&
              ![...before, callInstruction, ...after].some(
                (i) => i.address === edge.from && i.address + i.size === edge.to,
              ),
          )
        )
          continue;
        const dominates = (definition: number) => {
          const pending = [code.address],
            seen = new Set<number>();
          while (pending.length) {
            const at = pending.pop()!;
            if (at === definition || seen.has(at)) continue;
            if (at === call.instruction) return false;
            seen.add(at);
            pending.push(...code.edges.filter((e) => e.from === at && e.to !== null).map((e) => e.to!));
          }
          return true;
        };
        if (!contiguous([clear, ...initial]) || initial.some((i) => !dominates(i.address))) continue;
        result.push({
          heads,
          size,
          next: 0,
          initializer: code.address,
          confidence: "inferred",
          evidence: [
            evidenceOf(clear),
            ...initial.map(evidenceOf),
            ...before.map(evidenceOf),
            ...call.evidence,
            ...after.map(evidenceOf),
            ...allocator.evidence,
          ],
          assumptions: [
            ...allocator.assumptions,
            "The witnessed initialization completed with successful allocations. These owned nodes form separate storage from live part objects; the two initialized head slots retain this pool ownership.",
          ],
        });
      }
    }
  return result;
}

/** Pool scope is a conditional storage invariant, not a guessed game-object layout or a numeric return summary. */
export function addNodePoolSummaries(codes: Map<number, RoutineCode>, summaries: Map<number, EngineSummary>) {
  const allocated = pools(codes, summaries);
  for (const code of codes.values()) {
    if (code.status !== "complete" || code.calls.length || summaries.get(code.address)?.footprint.partMemoryComplete)
      continue;
    const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
    const [push, frame] = code.instructions;
    if (
      push?.mnemonic !== "push" ||
      !isRegister(push.operands[0], "bp") ||
      frame?.mnemonic !== "mov" ||
      !isRegister(frame.operands[0], "bp") ||
      !isRegister(frame.operands[1], "sp")
    )
      continue;
    for (const pool of allocated) {
      if (
        !code.instructions.some((i) =>
          i.operands.some((o) => isMemory(o) && o.direct && o.segment === "ds" && pool.heads.includes(o.displacement)),
        )
      )
        continue;
      const outgoing = new Map<number, number[]>();
      for (const edge of code.edges)
        if (edge.to !== null) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
      const states = new Map<number, Set<string>>([[code.address, new Set()]]),
        pending = [code.address];
      let budget = code.instructions.length * 24,
        invalid = false,
        nodeWrites = 0;
      while (pending.length && !invalid) {
        if (--budget < 0) {
          invalid = true;
          break;
        }
        const at = pending.pop()!,
          i = byAddress.get(at);
        if (!i) {
          invalid = true;
          break;
        }
        const nodes = new Set(states.get(at)),
          [dest, source] = i.operands;
        if (
          /^(movs|stos|lods|scas|cmps|ins|outs|enter|pusha|popa|int|into|iret|bound|esc|xlat|lahf|aaa|aas|daa|das|aam|aad)/.test(
            i.mnemonic,
          ) ||
          i.mnemonic === "lds" ||
          (isRegister(dest) && ["ss", "ds"].includes(dest.name) && !["push", "cmp", "test"].includes(i.mnemonic)) ||
          (isRegister(dest, "bp") && !["push", "pop", "cmp", "test"].includes(i.mnemonic) && i !== frame) ||
          (i.mnemonic === "pop" && isRegister(dest, "bp") && byAddress.get(i.address + i.size)?.flow !== "return") ||
          (isRegister(dest, "sp") &&
            !["push", "cmp", "test"].includes(i.mnemonic) &&
            !(i.mnemonic === "mov" && isRegister(source, "bp")) &&
            !(["add", "sub"].includes(i.mnemonic) && isImmediate(source)))
        ) {
          invalid = true;
          break;
        }
        if (storesToMemory(i) && isMemory(dest)) {
          const privateSlot = dest.segment === "ss" && dest.base.join() === "bp" && dest.displacement < 0;
          const global =
            dest.segment === "ds" && dest.direct && pool.heads.includes(dest.displacement) && dest.width === 16;
          const node =
            dest.segment === "ds" &&
            dest.base.length === 1 &&
            nodes.has(dest.base[0]!) &&
            dest.displacement >= 0 &&
            dest.displacement + dest.width / 8 <= pool.size;
          if (!privateSlot && !global && !node) {
            invalid = true;
            break;
          }
          if (
            (global || (node && dest.displacement < pool.next + 2 && pool.next < dest.displacement + dest.width / 8)) &&
            !(
              i.mnemonic === "mov" &&
              dest.width === 16 &&
              (global || dest.displacement === pool.next) &&
              ((isRegister(source) && nodes.has(source.name)) || (isImmediate(source) && source.value === 0))
            )
          ) {
            invalid = true;
            break;
          }
          if (node) nodeWrites++;
        }
        if (
          isRegister(dest) &&
          !["push", "cmp", "test"].includes(i.mnemonic) &&
          i.flow !== "branch" &&
          i.flow !== "jump"
        ) {
          const identity = ["or", "and"].includes(i.mnemonic) && isRegister(source, dest.name);
          const pointer =
            i.mnemonic === "mov" &&
            dest.width === 16 &&
            ((isRegister(source) && nodes.has(source.name)) ||
              (isMemory(source) &&
                source.width === 16 &&
                source.segment === "ds" &&
                ((source.direct && pool.heads.includes(source.displacement)) ||
                  (source.base.length === 1 && nodes.has(source.base[0]!) && source.displacement === pool.next))));
          const name =
            (
              { al: "ax", ah: "ax", bl: "bx", bh: "bx", cl: "cx", ch: "cx", dl: "dx", dh: "dx" } as Record<
                string,
                string
              >
            )[dest.name] ?? dest.name;
          if (!identity) {
            nodes.delete(name);
            if (pointer) nodes.add(name);
          }
        }
        if (i.mnemonic === "xchg" && isRegister(source))
          nodes.delete(
            (
              { al: "ax", ah: "ax", bl: "bx", bh: "bx", cl: "cx", ch: "cx", dl: "dx", dh: "dx" } as Record<
                string,
                string
              >
            )[source.name] ?? source.name,
          );
        if (i.mnemonic === "cbw") nodes.delete("ax");
        if (["mul", "imul", "div", "idiv", "cwd"].includes(i.mnemonic)) {
          nodes.delete("ax");
          nodes.delete("dx");
        }
        for (const to of outgoing.get(at) ?? []) {
          const old = states.get(to),
            joined = old ? new Set([...old].filter((name) => nodes.has(name))) : new Set(nodes);
          if (!old || old.size !== joined.size) {
            states.set(to, joined);
            pending.push(to);
          }
        }
      }
      if (invalid || !nodeWrites) continue;
      const assumptions = [
        ...pool.assumptions,
        "Pool next links are zero or bases of nodes in the same finite well-formed pool. Every dereferenced node is nonzero; pool exhaustion and corrupted links are outside this storage contract. Stack frames have valid separate capacity. This proof bounds memory effects and is conditional on return; it does not choose a queue result or prove termination.",
      ];
      summaries.set(code.address, {
        address: code.address,
        kind: "owned-node-pool-update",
        purpose:
          "Updates a separate pool of linked records while preserving the owner's state; outstanding pool-node aliases remain unresolved.",
        argumentOffset: code.instructions.some((i) => i.mnemonic === "retf") ? 6 : 4,
        argumentKind: "unknown",
        calls: [],
        writes: [],
        returns: [],
        nodePool: { nodeSize: pool.size },
        confidence: "inferred",
        assumptions,
        evidence: [...pool.evidence, ...code.instructions.map(evidenceOf)],
        footprint: {
          complete: false,
          partMemoryComplete: false,
          preservesArgumentMemory: false,
          preservesPartState: true,
          unknownEffects: [
            "The selected node, linked-pool globals and return value depend on the search and insertion conditions. Outstanding aliases to mutable pool nodes are not bounded by the caller-side relation.",
          ],
          unknownPartEffects: [
            "Outstanding related-object aliases may denote mutable pool nodes; only owner-state preservation is supplied to callers.",
          ],
          unknownGlobalEffects: ["The owned pool and its head globals may change."],
        },
      });
      break;
    }
  }
}
