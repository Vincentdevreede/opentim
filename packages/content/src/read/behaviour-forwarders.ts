/** Proves state preservation for wrappers forwarding the same part argument to scoped helpers. */
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Instruction, Operand } from "./x86.ts";

const register = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && (name === undefined || o.name === name);
const argument = (o: Operand | undefined, offset: number) =>
  o?.kind === "memory" && o.segment === "ss" && o.base.join() === "bp" && o.displacement === offset && o.width === 16;
const writesFirst = (i: Instruction) =>
  i.flow === "next" && !["push", "cmp", "test", "mul", "imul", "div", "idiv"].includes(i.mnemonic);
const evidence = ({ address, bytes, text }: Instruction) => ({ address, bytes, text });

/** Only the state contract composes here; unresolved nonstate storage and return values remain unknown. */
export function addStatePreservingForwarders(codes: Map<number, RoutineCode>, summaries: Map<number, EngineSummary>) {
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const code of codes.values()) {
      if (code.status !== "complete" || !code.calls.length || summaries.get(code.address)?.footprint.preservesPartState)
        continue;
      const [push, move] = code.instructions;
      const returns = code.instructions.filter((i) => i.flow === "return");
      if (
        push?.mnemonic !== "push" ||
        !register(push.operands[0], "bp") ||
        move?.mnemonic !== "mov" ||
        !register(move.operands[0], "bp") ||
        !register(move.operands[1], "sp") ||
        !returns.length ||
        returns.some(
          (i) => !["ret", "retf"].includes(i.mnemonic) || i.mnemonic !== returns[0]!.mnemonic || i.operands.length,
        )
      )
        continue;
      if (
        code.instructions.some(
          (i) =>
            /^(movs|stos|lods|scas|cmps|ins|outs|int|into|iret|enter|leave|pusha|popa|esc|xchg)/.test(i.mnemonic) ||
            (writesFirst(i) && i.operands[0]?.kind === "memory") ||
            (writesFirst(i) && register(i.operands[0]) && ["ds", "ss"].includes(i.operands[0].name)) ||
            (writesFirst(i) &&
              register(i.operands[0], "bp") &&
              i !== move &&
              !(i.mnemonic === "pop" && returns.some((r) => r.address === i.address + i.size))) ||
            (writesFirst(i) &&
              register(i.operands[0], "sp") &&
              !(i.mnemonic === "mov" && register(i.operands[1], "bp")) &&
              !(["add", "sub"].includes(i.mnemonic) && i.operands[1]?.kind === "immediate")),
        )
      )
        continue;
      const lastCall = Math.max(...code.calls.map((call) => call.instruction));
      if (
        code.instructions.some(
          (i) =>
            writesFirst(i) &&
            register(i.operands[0], "sp") &&
            !(i.mnemonic === "mov" && register(i.operands[1], "bp") && i.address > lastCall),
        )
      )
        continue;
      const first = returns[0]!.mnemonic === "retf" ? 6 : 4;
      const outgoing = new Map<number, number[]>(),
        incoming = new Map<number, number[]>();
      for (const edge of code.edges)
        if (edge.to !== null) {
          outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
          incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
        }
      const dominates = (definition: number, target: number) => {
        const pending = [code.address],
          seen = new Set<number>();
        while (pending.length) {
          const at = pending.pop()!;
          if (at === definition || seen.has(at)) continue;
          if (at === target) return false;
          seen.add(at);
          pending.push(...(outgoing.get(at) ?? []));
        }
        return true;
      };
      const ownerLoad = code.instructions.find(
        (i) =>
          i.mnemonic === "mov" &&
          register(i.operands[0]) &&
          ["si", "di"].includes(i.operands[0].name) &&
          argument(i.operands[1], first) &&
          code.calls.every((call) => dominates(i.address, call.instruction)) &&
          !code.instructions.some(
            (later) =>
              later.address > i.address &&
              later.address <= lastCall &&
              writesFirst(later) &&
              register(later.operands[0], i.operands[0]!.kind === "register" ? i.operands[0]!.name : undefined),
          ),
      );
      if (!ownerLoad || !register(ownerLoad.operands[0])) continue;
      const owner = ownerLoad.operands[0].name;
      const byEnd = new Map(code.instructions.map((i) => [i.address + i.size, i]));
      const callees: EngineSummary[] = [];
      const callDeltas = new Map<number, number>();
      let invalid = false;
      for (const call of code.calls) {
        const callee = call.target && call.confidence === "checked" ? summaries.get(call.target.address) : undefined;
        const returned = callee?.returnConvention;
        if (
          !callee?.footprint.preservesPartState ||
          callee.argumentKind !== "object" ||
          !returned ||
          returned.stackBytes ||
          callee.argumentOffset !== (returned.kind === "far" ? 6 : 4) ||
          (call.far && returned.kind !== "far")
        ) {
          invalid = true;
          break;
        }
        let at = call.instruction;
        const previous = () => {
          const i = byEnd.get(at),
            predecessors = incoming.get(at);
          if (!i || i.flow !== "next" || predecessors?.length !== 1 || predecessors[0] !== i.address) return;
          at = i.address;
          return i;
        };
        let pushed = previous();
        while (pushed?.mnemonic === "nop") pushed = previous();
        if (!call.far && returned.kind === "far") {
          if (pushed?.mnemonic !== "push" || !register(pushed.operands[0], "cs")) {
            invalid = true;
            break;
          }
          pushed = previous();
          while (pushed?.mnemonic === "nop") pushed = previous();
        }
        if (
          pushed?.mnemonic !== "push" ||
          !(register(pushed.operands[0], owner) || argument(pushed.operands[0], first))
        ) {
          invalid = true;
          break;
        }
        callDeltas.set(call.instruction, !call.far && returned.kind === "far" ? 2 : 0);
        callees.push(callee);
      }
      if (invalid) continue;
      const instructions = new Map(code.instructions.map((i) => [i.address, i]));
      const stackAt = new Map([[code.address, 0]]),
        pending = [code.address];
      while (pending.length && !invalid) {
        const at = pending.pop()!,
          i = instructions.get(at)!;
        let delta = stackAt.get(at)!;
        if (i.mnemonic === "push") delta -= 2;
        if (i.mnemonic === "pop") delta += 2;
        if (i.mnemonic === "mov" && register(i.operands[0], "sp")) delta = -2;
        delta += callDeltas.get(at) ?? 0;
        if (delta > 0 || delta < -0x7fff || (i.flow === "call" && delta > -2) || (i.flow === "return" && delta !== 0)) {
          invalid = true;
          break;
        }
        for (const next of outgoing.get(at) ?? []) {
          const previous = stackAt.get(next);
          if (previous !== undefined && previous !== delta) {
            invalid = true;
            break;
          }
          if (previous === undefined) {
            stackAt.set(next, delta);
            pending.push(next);
          }
        }
      }
      if (invalid) continue;
      const unknown = [...new Set(callees.flatMap((c) => c.footprint.unknownEffects))];
      summaries.set(code.address, {
        address: code.address,
        kind: "state-preserving-forwarder",
        argumentKind: "object",
        argumentOffset: first,
        purpose: "Calls the recorded helpers with the same part argument, preserving its selected state.",
        returnConvention: { kind: first === 6 ? "far" : "near", stackBytes: 0 },
        writes: [],
        returns: [],
        calls: callees.map((c) => c.address),
        confidence: "inferred",
        evidence: [...code.instructions.map(evidence), ...callees.flatMap((c) => c.evidence)],
        assumptions: [
          ...new Set([
            ...callees.flatMap((c) => c.assumptions),
            "Each object helper receives the same complete part base through the checked C argument and return conventions. SI, DI, BP and DS are preserved across these calls.",
            "The C stack has capacity for the proved balanced pushes and calls; no stack operation overwrites the entry arguments.",
            "This composed contract preserves only the selected state; other part fields, globals and the numeric return remain unresolved. It is conditional on the wrapper returning.",
          ]),
        ],
        footprint: {
          complete: false,
          partMemoryComplete: false,
          preservesArgumentMemory: false,
          preservesPartState: true,
          unknownEffects: unknown,
          unknownPartEffects: ["The composed nonstate part-memory footprint is incomplete."],
          unknownGlobalEffects: [
            ...new Set([
              ...callees.flatMap((c) => c.footprint.unknownGlobalEffects ?? []),
              "The forwarded helpers' global changes are not composed by this state-only contract.",
            ]),
          ],
        },
      });
      changed = true;
    }
    if (!changed) break;
  }
}
