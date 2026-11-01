/** Finds separately allocated node pools and bounds routines which only modify those pools. */
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Evidence, Finding } from "./behaviour.ts";
import type { Instruction, Operand } from "./x86.ts";

const reg = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && (name === undefined || o.name === name);
const mem = (o: Operand | undefined): o is Extract<Operand, { kind: "memory" }> => o?.kind === "memory";
const imm = (o: Operand | undefined): o is Extract<Operand, { kind: "immediate" }> => o?.kind === "immediate";
const ev = (i: Instruction): Evidence => ({ address: i.address, bytes: i.bytes, text: i.text });
const stores = (i: Instruction) =>
  mem(i.operands[0]) && !["cmp", "test", "push", "call", "jmp", "mul", "imul", "div", "idiv"].includes(i.mnemonic);
const contiguous = (sequence: Instruction[]) =>
  sequence.every((i, n) => n === 0 || sequence[n - 1]!.address + sequence[n - 1]!.size === i.address);
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
        !reg(before[0]!.operands[0], "ax") ||
        !imm(before[0]!.operands[1]) ||
        before[1]!.mnemonic !== "push" ||
        !reg(before[1]!.operands[0], "ax") ||
        before[2]!.mnemonic !== "mov" ||
        !reg(before[2]!.operands[0], "ax") ||
        !imm(before[2]!.operands[1]) ||
        before[2]!.operands[1].value !== 1 ||
        before[3]!.mnemonic !== "push" ||
        !reg(before[3]!.operands[0], "ax")
      )
        continue;
      const size = before[0]!.operands[1].value;
      if (size < 4 || size > 32) continue;
      const after = code.instructions.filter((i) => i.address > call.instruction).slice(0, 6);
      if (after.length !== 6 || after[0]!.mnemonic !== "pop" || after[1]!.mnemonic !== "pop") continue;
      const callInstruction = code.instructions.find((i) => i.address === call.instruction);
      if (!callInstruction || !contiguous([...before, callInstruction, ...after])) continue;
      const [capture, load, link, head] = after.slice(2);
      if (
        capture?.mnemonic !== "mov" ||
        !reg(capture.operands[0]) ||
        !reg(capture.operands[1], "ax") ||
        load?.mnemonic !== "mov" ||
        !reg(load.operands[0], "ax") ||
        !mem(load.operands[1]) ||
        load.operands[1].segment !== "ds" ||
        !load.operands[1].direct ||
        link?.mnemonic !== "mov" ||
        !mem(link.operands[0]) ||
        link.operands[0].segment !== "ds" ||
        link.operands[0].base.join() !== capture.operands[0].name ||
        link.operands[0].displacement !== 0 ||
        link.operands[0].width !== 16 ||
        !reg(link.operands[1], "ax") ||
        head?.mnemonic !== "mov" ||
        !mem(head.operands[0]) ||
        !head.operands[0].direct ||
        head.operands[0].segment !== "ds" ||
        head.operands[0].displacement !== load.operands[1].displacement ||
        !reg(head.operands[1], capture.operands[0].name)
      )
        continue;
      const cleared = code.instructions.filter(
        (i, index) =>
          i.address < before[0]!.address &&
          i.mnemonic === "xor" &&
          reg(i.operands[0], "ax") &&
          reg(i.operands[1], "ax") &&
          code.instructions[index + 1]?.mnemonic === "mov" &&
          code.instructions[index + 2]?.mnemonic === "mov",
      );
      for (const clear of cleared) {
        const n = code.instructions.indexOf(clear),
          initial = code.instructions.slice(n + 1, n + 3);
        if (
          !initial.every(
            (i) =>
              mem(i.operands[0]) &&
              i.operands[0].direct &&
              i.operands[0].segment === "ds" &&
              i.operands[0].width === 16 &&
              reg(i.operands[1], "ax"),
          )
        )
          continue;
        const heads = initial.map((i) => (i.operands[0] as Extract<Operand, { kind: "memory" }>).displacement);
        if (new Set(heads).size !== 2 || !heads.includes(load.operands[1].displacement)) continue;
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
            ev(clear),
            ...initial.map(ev),
            ...before.map(ev),
            ...call.evidence,
            ...after.map(ev),
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
      !reg(push.operands[0], "bp") ||
      frame?.mnemonic !== "mov" ||
      !reg(frame.operands[0], "bp") ||
      !reg(frame.operands[1], "sp")
    )
      continue;
    for (const pool of allocated) {
      if (
        !code.instructions.some((i) =>
          i.operands.some((o) => mem(o) && o.direct && o.segment === "ds" && pool.heads.includes(o.displacement)),
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
          (reg(dest) && ["ss", "ds"].includes(dest.name) && !["push", "cmp", "test"].includes(i.mnemonic)) ||
          (reg(dest, "bp") && !["push", "pop", "cmp", "test"].includes(i.mnemonic) && i !== frame) ||
          (i.mnemonic === "pop" && reg(dest, "bp") && byAddress.get(i.address + i.size)?.flow !== "return") ||
          (reg(dest, "sp") &&
            !["push", "cmp", "test"].includes(i.mnemonic) &&
            !(i.mnemonic === "mov" && reg(source, "bp")) &&
            !(["add", "sub"].includes(i.mnemonic) && imm(source)))
        ) {
          invalid = true;
          break;
        }
        if (stores(i) && mem(dest)) {
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
              ((reg(source) && nodes.has(source.name)) || (imm(source) && source.value === 0))
            )
          ) {
            invalid = true;
            break;
          }
          if (node) nodeWrites++;
        }
        if (reg(dest) && !["push", "cmp", "test"].includes(i.mnemonic) && i.flow !== "branch" && i.flow !== "jump") {
          const identity = ["or", "and"].includes(i.mnemonic) && reg(source, dest.name);
          const pointer =
            i.mnemonic === "mov" &&
            dest.width === 16 &&
            ((reg(source) && nodes.has(source.name)) ||
              (mem(source) &&
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
        if (i.mnemonic === "xchg" && reg(source))
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
        confidence: "inferred",
        assumptions,
        evidence: [...pool.evidence, ...code.instructions.map(ev)],
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
