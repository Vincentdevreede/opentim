/** Proves fixed argument-buffer writes and calls whose outputs stay inside a private stack frame. */
import type { RoutineCode, RoutineCall } from "./behaviour-code.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import type { Instruction, Operand } from "./x86.ts";

const register = (operand: Operand | undefined, name?: string): operand is Extract<Operand, { kind: "register" }> =>
  operand?.kind === "register" && (name === undefined || operand.name === name);
const stack = (operand: Operand | undefined): operand is Extract<Operand, { kind: "memory" }> =>
  operand?.kind === "memory" && operand.segment === "ss" && operand.base.join() === "bp";
const stores = (i: Instruction) =>
  i.operands[0]?.kind === "memory" &&
  !["cmp", "test", "push", "call", "jmp", "mul", "imul", "div", "idiv"].includes(i.mnemonic);
const implicit = (i: Instruction) => /^(movs|stos|ins|enter|pusha|popa|int|into|iret|bound|esc)/.test(i.mnemonic);
const evidence = (i: Instruction) => ({ address: i.address, bytes: i.bytes, text: i.text });
const byteParent: Record<string, string> = {
  al: "ax",
  ah: "ax",
  bl: "bx",
  bh: "bx",
  cl: "cx",
  ch: "cx",
  dl: "dx",
  dh: "dx",
};
const convention = (code: RoutineCode) => {
  const returns = code.instructions.filter((i) => i.flow === "return");
  if (!returns.length || returns.some((i) => !["ret", "retf"].includes(i.mnemonic))) return;
  const kind = returns[0]!.mnemonic === "retf" ? ("far" as const) : ("near" as const);
  const bytes = (i: Instruction) => (i.operands[0]?.kind === "immediate" ? i.operands[0].value : 0);
  if (returns.some((i) => (i.mnemonic === "retf") !== (kind === "far") || bytes(i) !== bytes(returns[0]!))) return;
  return { kind, stackBytes: bytes(returns[0]!) };
};

/** Only identical argument identities on every predecessor are retained. Calls clobber volatile registers. */
function argumentBases(code: RoutineCode, first: number): Map<number, Map<string, number>> | undefined {
  const instructions = new Map(code.instructions.map((i) => [i.address, i]));
  const outgoing = new Map<number, number[]>();
  for (const edge of code.edges)
    if (edge.to !== null) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const states = new Map<number, Map<string, number>>([[code.address, new Map()]]);
  const pending = [code.address];
  let budget = code.instructions.length * 32;
  while (pending.length) {
    if (--budget < 0) return;
    const address = pending.pop()!,
      i = instructions.get(address);
    if (!i) return;
    const state = new Map(states.get(address));
    const [dest, source] = i.operands;
    if (i.flow === "call") for (const name of ["ax", "bx", "cx", "dx", "es"]) state.delete(name);
    else if (i.mnemonic === "xchg") {
      if (register(dest)) state.delete(byteParent[dest.name] ?? dest.name);
      if (register(source)) state.delete(byteParent[source.name] ?? source.name);
    } else if (
      register(dest) &&
      !["cmp", "test", "push"].includes(i.mnemonic) &&
      !(["or", "and"].includes(i.mnemonic) && register(source, dest.name))
    ) {
      const input =
        i.mnemonic === "mov" &&
        stack(source) &&
        source.width === 16 &&
        source.displacement >= first &&
        (source.displacement - first) % 2 === 0
          ? source.displacement
          : i.mnemonic === "mov" && register(source)
            ? state.get(source.name)
            : undefined;
      const aliases: Record<string, string> = {
        al: "ax",
        ah: "ax",
        bl: "bx",
        bh: "bx",
        cl: "cx",
        ch: "cx",
        dl: "dx",
        dh: "dx",
      };
      const name = aliases[dest.name] ?? dest.name;
      if (input === undefined || dest.width !== 16) state.delete(name);
      else state.set(name, input);
    }
    for (const next of outgoing.get(address) ?? []) {
      const before = states.get(next);
      const joined =
        before === undefined ? state : new Map([...before].filter(([name, value]) => state.get(name) === value));
      if (
        before === undefined ||
        before.size !== joined.size ||
        [...before].some(([name, value]) => joined.get(name) !== value)
      ) {
        states.set(next, new Map(joined));
        pending.push(next);
      }
    }
  }
  return states;
}

/** Rejects frame changes and stores through an unclassified address before proving any private output. */
function frameSize(code: RoutineCode): number | undefined {
  const [push, move, reserve] = code.instructions;
  if (
    push?.mnemonic !== "push" ||
    !register(push.operands[0], "bp") ||
    move?.mnemonic !== "mov" ||
    !register(move.operands[0], "bp") ||
    !register(move.operands[1], "sp")
  )
    return;
  if (
    code.instructions.some(
      (i) =>
        i.mnemonic === "pop" &&
        register(i.operands[0], "bp") &&
        code.instructions.find((next) => next.address === i.address + i.size)?.flow !== "return",
    )
  )
    return;
  if (
    code.instructions.some(
      (i) =>
        implicit(i) ||
        /^(lods|scas|cmps|outs|xlat|lahf|aaa|aas|daa|das|aam|aad)/.test(i.mnemonic) ||
        i.mnemonic === "lds" ||
        (register(i.operands[0], "sp") &&
          !["cmp", "test", "push"].includes(i.mnemonic) &&
          !(i.mnemonic === "mov" && register(i.operands[1], "bp")) &&
          !(["add", "sub"].includes(i.mnemonic) && i.operands[1]?.kind === "immediate")) ||
        (register(i.operands[0], "bp") && !["cmp", "test", "push", "pop"].includes(i.mnemonic) && i !== move) ||
        (register(i.operands[0], "ds") && !["cmp", "test", "push"].includes(i.mnemonic)) ||
        (register(i.operands[0], "ss") && !["cmp", "test", "push"].includes(i.mnemonic)),
    )
  )
    return;
  const size =
    reserve?.mnemonic === "sub" && register(reserve.operands[0], "sp") && reserve.operands[1]?.kind === "immediate"
      ? reserve.operands[1].value
      : 0;
  if (
    size < 0 ||
    size > 0x7fff ||
    code.instructions.some(
      (i) =>
        stores(i) &&
        stack(i.operands[0]) &&
        (i.operands[0].displacement < -size || i.operands[0].displacement + i.operands[0].width / 8 > 0),
    )
  )
    return;
  return size;
}

function privateOutputs(
  code: RoutineCode,
  call: RoutineCall,
  callee: EngineSummary,
  size: number,
): { offset: number; width: number }[] | undefined {
  if (!callee.footprint.complete || callee.writes.some((w) => w.root !== "argument" || w.path.length || w.repeated))
    return undefined;
  if (!callee.writes.length) return callee.footprint.preservesArgumentMemory ? [] : undefined;
  const returned = callee.returnConvention;
  if (!returned || (call.far && returned.kind !== "far")) return undefined;
  const byEnd = new Map(code.instructions.map((i) => [i.address + i.size, i]));
  const incoming = new Map<number, number[]>();
  for (const edge of code.edges)
    if (edge.to !== null) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  let at = call.instruction;
  const previous = () => {
    const i = byEnd.get(at),
      predecessors = incoming.get(at);
    if (!i || predecessors?.length !== 1 || predecessors[0] !== i.address || i.flow !== "next") return;
    at = i.address;
    return i;
  };
  const setup: Instruction[] = [];
  let first = true,
    argument = callee.argumentOffset;
  const required = Math.max(...callee.writes.map((w) => w.argumentOffset ?? callee.argumentOffset));
  const pointers = new Map<number, number>();
  for (let n = 0; n < 64 && argument <= required; n++) {
    const i = previous();
    if (!i) return undefined;
    if (i.mnemonic === "nop") continue;
    if (first && !call.far && returned.kind === "far") {
      first = false;
      if (i.mnemonic !== "push" || !register(i.operands[0], "cs")) return undefined;
      continue;
    }
    first = false;
    if (i.mnemonic === "push") {
      const value = i.operands[0];
      if (
        register(value) &&
        callee.writes.some((write) => (write.argumentOffset ?? callee.argumentOffset) === argument)
      ) {
        const definition = previous();
        if (!definition) return undefined;
        if (
          definition.mnemonic === "lea" &&
          register(definition.operands[0], value.name) &&
          stack(definition.operands[1])
        )
          pointers.set(argument, definition.operands[1].displacement);
        else return undefined;
      }
      argument += 2;
    } else if (!(i.mnemonic === "lea" && register(i.operands[0]) && stack(i.operands[1]))) setup.push(i);
  }
  if (argument <= required || setup.length) return undefined;
  const outputs: { offset: number; width: number }[] = [];
  for (const write of callee.writes) {
    const base = pointers.get(write.argumentOffset ?? callee.argumentOffset);
    if (base === undefined || base + write.offset < -size || base + write.offset + write.width / 8 > 0) return;
    outputs.push({ offset: base + write.offset, width: write.width });
  }
  return outputs;
}

/** Maps all helper stores into the caller's checked private frame, including outputs after read-only inputs. */
export function privateStackOutputs(code: RoutineCode, call: RoutineCall, callee: EngineSummary) {
  const size = frameSize(code);
  if (size === undefined) return;
  const outputs = privateOutputs(code, call, callee, size);
  if (!outputs) return;
  return {
    outputs,
    confidence: "inferred" as const,
    evidence: [...code.instructions.map(evidence), ...callee.evidence],
    assumptions: [
      ...callee.assumptions,
      "Every helper store is mapped to a bounded private stack local through an unambiguous argument setup. Other pushed inputs are not written through.",
      "The decoded near-pointer C convention makes passed stack-local offsets valid in the callee's data segment; private locals are separate from complete part objects.",
    ],
  };
}

/** A buffer contract gives addresses and widths, never fabricated contents or a guessed return value. */
export function addBufferEffectSummaries(codes: Map<number, RoutineCode>, summaries: Map<number, EngineSummary>) {
  for (const summary of summaries.values()) {
    const code = codes.get(summary.address);
    if (code && !summary.returnConvention) summary.returnConvention = convention(code);
  }
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const code of codes.values()) {
      if (code.status !== "complete" || summaries.get(code.address)?.footprint.complete) continue;
      const size = frameSize(code),
        returned = convention(code);
      if (size === undefined || !returned) continue;
      const first = returned.kind === "far" ? 6 : 4;
      const callees = code.calls.map((call) =>
        call.target && call.confidence === "checked" ? summaries.get(call.target.address) : undefined,
      );
      if (
        callees.some(
          (callee, index) =>
            !callee ||
            !callee.footprint.complete ||
            (!callee.footprint.preservesArgumentMemory && !privateOutputs(code, code.calls[index]!, callee, size)),
        )
      )
        continue;
      if (callees.some((callee) => callee!.writes.some((write) => write.root === "global"))) continue;
      const external = code.instructions.filter((i) => stores(i) && !stack(i.operands[0]));
      const bases = external.length ? argumentBases(code, first) : undefined;
      if (
        external.length &&
        (!bases ||
          external.some((i) => {
            const dest = i.operands[0];
            return (
              dest?.kind !== "memory" ||
              dest.segment !== "ds" ||
              dest.base.length !== 1 ||
              dest.width > 16 ||
              bases.get(i.address)?.get(dest.base[0]!) === undefined
            );
          }))
      )
        continue;
      const writes: EngineWrite[] = external.map((i) => {
        const dest = i.operands[0] as Extract<Operand, { kind: "memory" }>;
        return {
          root: "argument",
          argumentOffset: bases!.get(i.address)!.get(dest.base[0]!)!,
          path: [],
          offset: dest.displacement,
          width: dest.width,
          value: {
            kind: "unknown",
            width: dest.width,
            reason: "The buffer value requires a separate numeric or conditional relation.",
          },
          condition: { kind: "unknown", reason: "The recorded path must reach this buffer store." },
          confidence: "inferred",
          evidence: [evidence(i)],
          assumptions: [],
        };
      });
      const assumptions = [
        ...new Set([
          "The checked private stack frame is distinct from non-stack argument storage; the C convention preserves SI, DI, BP and DS across these calls.",
          "The valid C stack has capacity for the decoded frames and call arguments.",
          "The continuation is conditional on the helper returning. This footprint proves memory preservation, not loop termination or a numeric return predicate.",
          ...callees.flatMap((c) => c!.assumptions),
        ]),
      ];
      summaries.set(code.address, {
        address: code.address,
        kind: writes.length ? "argument-buffer-update" : "private-buffer-query",
        purpose: writes.length
          ? "Writes the recorded output buffer fields; their numeric values and the return result remain separate."
          : "Reads inputs, with intermediate writes confined to its private stack frame.",
        argumentOffset: first,
        argumentKind: "unknown",
        writes,
        returns: [],
        returnConvention: returned,
        calls: code.calls.map((c) => c.target!.address),
        confidence: "inferred",
        evidence: [...code.instructions.map(evidence), ...callees.flatMap((c) => c!.evidence)],
        assumptions,
        footprint: {
          complete: true,
          partMemoryComplete: true,
          preservesArgumentMemory: !writes.length,
          preservesPartState: !writes.length,
          unknownEffects: [],
          unknownPartEffects: [],
          unknownGlobalEffects: [],
        },
      });
      changed = true;
    }
    if (!changed) break;
  }
}
