/** Bounds constructor writes to a fresh part and its separately allocated outline storage. */
import { readRoutineCode, type RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { Evidence, Finding } from "./behaviour.ts";
import type { Operand } from "./x86.ts";

type Root = "owner" | "buffer";
const register = (o: Operand | undefined): o is Extract<Operand, { kind: "register" }> => o?.kind === "register";
const memory = (o: Operand | undefined): o is Extract<Operand, { kind: "memory" }> => o?.kind === "memory";
const local = (o: Operand | undefined) =>
  memory(o) && o.segment === "ss" && o.base.join() === "bp" && o.displacement < 0;
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

/** This is a scope proof over all CFG edges, with no constructor inputs or numeric game state selected. */
export function discoverConstructorEffects(
  image: Uint8Array,
  sourceCodes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  layout: BehaviourLayout | undefined,
  dataSegment: number,
) {
  const codes = new Map(sourceCodes);
  const buffers = new Set(layout?.fields.filter((f) => f.name === "outlinePoints").map((f) => f.offset));
  for (const summary of summaries.values())
    if (summary.kind === "geometry-edge-data")
      for (const write of summary.writes) if (write.path.length === 1 && write.repeated) buffers.add(write.path[0]!);
  for (const factory of summaries.values()) {
    const metadata = factory.factory;
    if (!metadata) continue;
    const allocationProof = new Set(metadata.noConstructor.evidence.map((e) => e.address));
    const memo = new Map<number, Finding | undefined>(),
      active = new Set<number>();
    const prove = (code: RoutineCode, depth: number): Finding | undefined => {
      if (memo.has(code.address)) return memo.get(code.address);
      if (depth > 8 || active.has(code.address) || code.status !== "complete") return;
      active.add(code.address);
      const fail = () => {
        active.delete(code.address);
        memo.set(code.address, undefined);
        return undefined;
      };
      const [push, move] = code.instructions;
      if (
        push?.mnemonic !== "push" ||
        !register(push.operands[0]) ||
        push.operands[0].name !== "bp" ||
        move?.mnemonic !== "mov" ||
        !register(move.operands[0]) ||
        move.operands[0].name !== "bp" ||
        !register(move.operands[1]) ||
        move.operands[1].name !== "sp"
      )
        return fail();
      if (
        code.instructions.some(
          (i) =>
            i.mnemonic === "pop" &&
            register(i.operands[0]) &&
            i.operands[0].name === "bp" &&
            code.instructions.find((next) => next.address === i.address + i.size)?.flow !== "return",
        )
      )
        return fail();
      const returns = code.instructions.filter((i) => i.flow === "return");
      if (
        !returns.length ||
        returns.some((i) => !["ret", "retf"].includes(i.mnemonic)) ||
        returns.some((i) => i.mnemonic !== returns[0]!.mnemonic) ||
        (depth === 0 && returns[0]!.mnemonic !== "retf")
      )
        return fail();
      const first = returns[0]!.mnemonic === "retf" ? 6 : 4;
      const instructions = new Map(code.instructions.map((i) => [i.address, i])),
        outgoing = new Map<number, number[]>();
      for (const edge of code.edges)
        if (edge.to !== null) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
      const before = new Map(code.instructions.map((i) => [i.address + i.size, i]));
      const states = new Map<number, Map<string, Root>>([[code.address, new Map()]]),
        pending = [code.address];
      const evidence = new Map<number, Evidence>(
        code.instructions.map((i) => [i.address, { address: i.address, bytes: i.bytes, text: i.text }]),
      );
      const assumptions = new Set<string>();
      let budget = code.instructions.length * 32;
      while (pending.length) {
        if (--budget < 0) return fail();
        const at = pending.pop()!,
          i = instructions.get(at);
        if (!i) return fail();
        const state = new Map(states.get(at)),
          [dest, source] = i.operands;
        if (
          /^(movs|stos|lods|scas|cmps|ins|outs|enter|pusha|popa|int|into|iret|bound|esc)/.test(i.mnemonic) ||
          i.mnemonic === "lds" ||
          (register(dest) && ["ss", "ds"].includes(dest.name) && !["push", "cmp", "test"].includes(i.mnemonic)) ||
          (register(dest) &&
            dest.name === "sp" &&
            !["push", "cmp", "test"].includes(i.mnemonic) &&
            !(i.mnemonic === "mov" && register(source) && source.name === "bp") &&
            !(["add", "sub"].includes(i.mnemonic) && source?.kind === "immediate")) ||
          (register(dest) && dest.name === "bp" && !["push", "pop", "cmp", "test"].includes(i.mnemonic) && i !== move)
        )
          return fail();
        const store =
          memory(dest) && !["cmp", "test", "push", "call", "jmp", "mul", "imul", "div", "idiv"].includes(i.mnemonic);
        if (store && memory(dest) && local(dest)) {
          for (const key of state.keys())
            if (key.startsWith("stack:")) {
              const offset = Number(key.slice(6));
              if (offset < dest.displacement + dest.width / 8 && dest.displacement < offset + 2) state.delete(key);
            }
          const root = register(source) ? state.get(source.name) : undefined;
          if (dest.width === 16 && root) state.set(`stack:${dest.displacement}`, root);
        }
        if (store && memory(dest) && !local(dest)) {
          if (dest.segment !== "ds" || dest.base.length !== 1 || !state.has(dest.base[0]!)) return fail();
        }
        if (i.flow === "call") {
          const call = code.calls.find((c) => c.instruction === at);
          if (!call?.target || call.confidence !== "checked") return fail();
          const callee = summaries.get(call.target.address);
          let target = codes.get(call.target.address);
          if (!target) {
            target = readRoutineCode(image, call.target, dataSegment);
            codes.set(target.address, target);
          }
          const returnInstructions = target.instructions.filter((i) => i.flow === "return");
          if (
            !returnInstructions.length ||
            returnInstructions.some(
              (i) => !["ret", "retf"].includes(i.mnemonic) || i.mnemonic !== returnInstructions[0]!.mnemonic,
            )
          )
            return fail();
          const farReturn = returnInstructions[0]!.mnemonic === "retf";
          if (call.far && !farReturn) return fail();
          let push = before.get(at);
          if (!call.far && farReturn) {
            if (push?.mnemonic !== "push" || !register(push.operands[0]) || push.operands[0].name !== "cs")
              return fail();
            push = before.get(push.address);
          }
          while (push?.mnemonic === "nop") push = before.get(push.address);
          const owner =
            push?.mnemonic === "push" && register(push.operands[0]) && state.get(push.operands[0].name) === "owner";
          const allocated = callee?.kind === "nullable-allocation" && allocationProof.has(callee.address);
          const readonly =
            callee?.footprint.preservesArgumentMemory &&
            (callee.footprint.complete || callee.footprint.partMemoryComplete);
          const scoped =
            owner &&
            callee?.footprint.partMemoryComplete &&
            callee.writes.every(
              (write) =>
                write.root === "argument" &&
                (write.argumentOffset ?? callee.argumentOffset) === callee.argumentOffset &&
                (!write.path.length || (write.path.length === 1 && buffers.has(write.path[0]!))),
            );
          let nested: Finding | undefined;
          if (!allocated && !readonly && !scoped) {
            if (!owner) return fail();
            nested = prove(target, depth + 1);
            if (!nested) return fail();
          }
          for (const finding of [callee, nested])
            if (finding) {
              for (const item of finding.evidence) evidence.set(item.address, item);
              for (const item of finding.assumptions) assumptions.add(item);
            }
          for (const name of ["ax", "bx", "cx", "dx", "es"]) state.delete(name);
          if (allocated) state.set("ax", "buffer");
        } else if (
          register(dest) &&
          !["push", "cmp", "test"].includes(i.mnemonic) &&
          i.flow !== "branch" &&
          i.flow !== "jump" &&
          !(["or", "and"].includes(i.mnemonic) && register(source) && source.name === dest.name)
        ) {
          const name = aliases[dest.name] ?? dest.name;
          let root: Root | undefined;
          if (i.mnemonic === "mov" && dest.width === 16) {
            if (register(source)) root = state.get(source.name);
            else if (
              memory(source) &&
              source.segment === "ss" &&
              source.base.join() === "bp" &&
              source.displacement === first
            )
              root = "owner";
            else if (memory(source) && source.width === 16 && local(source))
              root = state.get(`stack:${source.displacement}`);
            else if (
              memory(source) &&
              source.segment === "ds" &&
              source.base.length === 1 &&
              state.get(source.base[0]!) === "owner" &&
              buffers.has(source.displacement)
            )
              root = "buffer";
          } else if (
            i.mnemonic === "add" &&
            source?.kind === "immediate" &&
            source.value >= 0 &&
            source.value <= 256 &&
            state.get(name) === "buffer"
          )
            root = "buffer";
          state.delete(name);
          if (root) state.set(name, root);
        }
        if (i.mnemonic === "xchg" && register(source)) state.delete(aliases[source.name] ?? source.name);
        if (["mul", "imul", "div", "idiv", "cwd"].includes(i.mnemonic)) {
          state.delete("ax");
          state.delete("dx");
        }
        if (["cbw", "lahf", "lodsb", "lodsw", "aaa", "aas", "daa", "das", "aam", "aad", "xlat"].includes(i.mnemonic))
          state.delete("ax");
        if (i.mnemonic.startsWith("loop")) state.delete("cx");
        for (const to of outgoing.get(at) ?? []) {
          const old = states.get(to),
            joined = old ? new Map([...old].filter(([name, root]) => state.get(name) === root)) : new Map(state);
          if (!old || old.size !== joined.size || [...old].some(([name, root]) => joined.get(name) !== root)) {
            states.set(to, joined);
            pending.push(to);
          }
        }
      }
      active.delete(code.address);
      assumptions.add(
        "The constructor argument is the factory's fresh object, distinct from existing parts. Outline buffers are separate valid allocations, and their indexed accesses remain within those buffers without address wrap.",
      );
      assumptions.add(
        "A valid private C stack has capacity for the decoded frames. The C calling convention preserves SI, DI, BP and DS. This proof bounds part-memory effects; it does not establish loop termination, numeric return values or heap/resource global effects.",
      );
      assumptions.add(
        "This scopes only the constructor body. A factory's failure cleanup remains a separate obligation and this result alone cannot preserve the factory caller's fields.",
      );
      const result: Finding = {
        confidence: "inferred",
        evidence: [...evidence.values()],
        assumptions: [...assumptions],
      };
      memo.set(code.address, result);
      return result;
    };
    metadata.constructors = [];
    const { segment, offset, stride, typeCount } = metadata.constructorTable;
    for (let type = 0; type < typeCount; type++) {
      const at = segment * 16 + offset + stride * type;
      if (at < 0 || at + 4 > image.length) continue;
      const targetOffset = image[at]! | (image[at + 1]! << 8),
        targetSegment = image[at + 2]! | (image[at + 3]! << 8),
        address = targetSegment * 16 + targetOffset;
      if (!address || address >= image.length) continue;
      let code = codes.get(address);
      if (!code) {
        code = readRoutineCode(image, { address, segment: targetSegment, offset: targetOffset }, dataSegment);
        codes.set(address, code);
      }
      const proof = prove(code, 0);
      if (proof)
        metadata.constructors.push({
          ...proof,
          type,
          address,
          evidence: [
            {
              address: at,
              bytes: Array.from(image.subarray(at, at + 4)),
              text: `Initial constructor reference for type ${type}`,
            },
            ...proof.evidence,
          ],
        });
    }
  }
}
