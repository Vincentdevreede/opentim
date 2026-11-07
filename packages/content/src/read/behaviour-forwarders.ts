/** Proves state preservation for wrappers forwarding the same part argument to scoped helpers. */
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import type { Expression, Predicate } from "./behaviour.ts";
import type { Instruction, Operand } from "./x86.ts";

const register = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && (name === undefined || o.name === name);
const argument = (o: Operand | undefined, offset: number) =>
  o?.kind === "memory" && o.segment === "ss" && o.base.join() === "bp" && o.displacement === offset && o.width === 16;
const writesFirst = (i: Instruction) =>
  i.flow === "next" && !["push", "cmp", "test", "mul", "imul", "div", "idiv"].includes(i.mnemonic);
const evidence = ({ address, bytes, text }: Instruction) => ({ address, bytes, text });

/** The summary fields a forwarder can carry over from its callees; any other one changes how a caller reads a call. */
const PLAIN = new Set([
  "confidence",
  "evidence",
  "assumptions",
  "address",
  "kind",
  "purpose",
  "argumentOffset",
  "argumentKind",
  "writes",
  "returns",
  "calls",
  "returnConvention",
  "footprint",
  "connected",
]);

/**
 * A callee whose part memory footprint is complete, relative to the part it is passed: it writes that part's own fields
 * (directly, never through a second argument), globals, and fields of parts and records reached through ropes, belts or
 * pulleys, which it names. A forwarder that passes its own part to each such callee writes exactly their union.
 */
function composable(callee: EngineSummary) {
  const connected = [...(callee.connected?.partFields ?? []), ...(callee.connected?.recordFields ?? [])];
  return (
    callee.footprint.partMemoryComplete === true &&
    Object.entries(callee).every(([key, value]) => value === undefined || PLAIN.has(key)) &&
    callee.writes.every(
      (write) =>
        !write.selection &&
        !write.separateStorage &&
        (write.root === "global" ||
          (write.root === "argument" &&
            !write.path.length &&
            (write.argumentOffset ?? callee.argumentOffset) === callee.argumentOffset) ||
          (write.root === "unknown" &&
            !write.path.length &&
            connected.some((field) => field.offset === write.offset && field.width === write.width))),
    )
  );
}

/** Each distinct field once. */
const distinct = (fields: { offset: number; width: number }[]) => [
  ...new Map(fields.map(({ offset, width }) => [`${offset}:${width}`, { offset, width }])).values(),
];

/**
 * Proves state preservation for wrappers that forward their part to helpers. When every helper's part memory footprint
 * is complete, the wrapper's footprint is their union; otherwise only the state contract composes, and other part
 * fields, globals and return values remain unknown. With `recompose`, only wrappers already proved are checked again
 * against the callee summaries as they are now, since later proofs can complete a callee's footprint.
 */
export function addStatePreservingForwarders(
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  recompose = false,
) {
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const code of codes.values()) {
      const prior = summaries.get(code.address);
      if (
        code.status !== "complete" ||
        !code.calls.length ||
        (recompose
          ? prior?.kind !== "state-preserving-forwarder"
          : prior?.footprint.preservesPartState && prior.kind !== "state-preserving-forwarder")
      )
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
      const sites: number[] = [];
      const arguments_: Map<number, number>[] = [];
      const callDeltas = new Map<number, number>();
      let invalid = false;
      for (const call of code.calls) {
        const callee = call.target && call.confidence === "checked" ? summaries.get(call.target.address) : undefined;
        const returned = callee?.returnConvention;
        if (
          !callee?.footprint.preservesPartState ||
          callee.partGraph ||
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
        // A number the wrapper passes right after the part, by `mov reg, number; push reg`, binds the callee's next
        // argument.
        const bound = new Map<number, number>();
        const value = previous();
        const load = value?.mnemonic === "push" && register(value.operands[0]) ? previous() : undefined;
        if (
          load?.mnemonic === "mov" &&
          value!.operands[0]?.kind === "register" &&
          register(load.operands[0], value!.operands[0].name) &&
          load.operands[1]?.kind === "immediate"
        )
          bound.set(callee.argumentOffset + 2, load.operands[1].value & 0xffff);
        callDeltas.set(call.instruction, !call.far && returned.kind === "far" ? 2 : 0);
        callees.push(callee);
        sites.push(call.instruction);
        arguments_.push(bound);
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
      const globalEffects = [...new Set(callees.flatMap((c) => c.footprint.unknownGlobalEffects ?? []))];
      // A callee's values and conditions refer to its own arguments, which are not the wrapper's: only where they write
      // carries over.
      const complete = callees.every(composable);
      // A part field a callee writes exactly, as a value of the part and of numbers the wrapper passes, carries over
      // with its value and its condition, but only from a call the wrapper makes on every way to its return, once (no
      // way leads from the call back to it), and when no other call writes that field and no call that may come
      // before it writes a field its value or condition reads: then the test is the callee's test alone, and the
      // fields it reads still hold the wrapper's entry values.
      const reaches = (from: number, to: number) => {
        const pending = [...(outgoing.get(from) ?? [])],
          seen = new Set<number>();
        while (pending.length) {
          const at = pending.pop()!;
          if (at === to) return true;
          if (seen.has(at)) continue;
          seen.add(at);
          pending.push(...(outgoing.get(at) ?? []));
        }
        return false;
      };
      const touches = (callee: EngineSummary, fields: { offset: number; width: number }[]) =>
        callee.writes.some(
          (write) =>
            write.root !== "global" &&
            fields.some((f) => write.offset < f.offset + f.width / 8 && f.offset < write.offset + write.width / 8),
        );
      const carries = (n: number, write: EngineWrite, read: { offset: number; width: number }[]) =>
        returns.every((r) => dominates(sites[n]!, r.address)) &&
        !reaches(sites[n]!, sites[n]!) &&
        callees.every(
          (other, m) =>
            m === n || (!touches(other, [write]) && !(reaches(sites[m]!, sites[n]!) && touches(other, read))),
        );
      const writes: EngineWrite[] = complete
        ? callees.flatMap((callee, n) =>
            callee.writes.map(({ exact, ...write }) => {
              const value = bind(write.value, arguments_[n]!),
                condition = bind(write.condition, arguments_[n]!);
              return write.root === "argument" &&
                !write.path.length &&
                exact &&
                value &&
                condition &&
                carries(n, write, [...partReads(value), ...partReads(condition)])
                ? { ...write, exact, argumentOffset: first, value, condition }
                : {
                    ...write,
                    ...(write.root === "argument" ? { argumentOffset: first } : {}),
                    value: {
                      kind: "unknown",
                      reason: `A helper the wrapper calls writes this field.`,
                      width: write.width,
                    },
                    condition: { kind: "unknown", reason: "The helper writes the field on some of its paths." },
                  };
            }),
          )
        : [];
      const reached = callees.flatMap((c) => (c.connected ? [c.connected] : []));
      const summary: EngineSummary = {
        address: code.address,
        kind: "state-preserving-forwarder",
        argumentKind: "object",
        argumentOffset: first,
        purpose: complete
          ? "Calls the recorded helpers with the same part argument; it writes what they write."
          : "Calls the recorded helpers with the same part argument, preserving its selected state.",
        returnConvention: { kind: first === 6 ? "far" : "near", stackBytes: 0 },
        writes,
        returns: [],
        calls: callees.map((c) => c.address),
        confidence: "inferred",
        evidence: [...code.instructions.map(evidence), ...callees.flatMap((c) => c.evidence)],
        assumptions: [
          ...new Set([
            ...callees.flatMap((c) => c.assumptions),
            "Each object helper receives the same complete part base through the checked C argument and return conventions. SI, DI, BP and DS are preserved across these calls.",
            "The C stack has capacity for the proved balanced pushes and calls; no stack operation overwrites the entry arguments.",
            complete
              ? "The wrapper writes no memory itself, so its footprint is the union of its helpers' complete footprints. It is conditional on the wrapper returning."
              : "This composed contract preserves only the selected state; other part fields, globals and the numeric return remain unresolved. It is conditional on the wrapper returning.",
          ]),
        ],
        footprint: complete
          ? {
              complete: callees.every((c) => c.footprint.complete) && !globalEffects.length,
              partMemoryComplete: true,
              preservesArgumentMemory: callees.every((c) => c.footprint.preservesArgumentMemory),
              preservesPartState: true,
              unknownEffects: unknown,
              unknownPartEffects: [],
              unknownGlobalEffects: globalEffects,
            }
          : {
              complete: false,
              partMemoryComplete: false,
              preservesArgumentMemory: false,
              preservesPartState: true,
              unknownEffects: unknown,
              unknownPartEffects: ["The composed nonstate part-memory footprint is incomplete."],
              unknownGlobalEffects: [
                ...globalEffects,
                "The forwarded helpers' global changes are not composed by this state-only contract.",
              ],
            },
        ...(complete && reached.length
          ? {
              connected: {
                confidence: "inferred" as const,
                evidence: reached.flatMap((c) => c.evidence),
                assumptions: [...new Set(reached.flatMap((c) => c.assumptions))],
                partFields: distinct(reached.flatMap((c) => c.partFields)),
                recordFields: distinct(reached.flatMap((c) => c.recordFields)),
                recordLinks: [...new Set(reached.flatMap((c) => c.recordLinks))],
              },
            }
          : {}),
      };
      // Only a different footprint is a change, so proving the same wrappers again comes to rest.
      if (
        prior?.kind === "state-preserving-forwarder" &&
        JSON.stringify([prior.footprint, prior.calls, prior.writes.map((w) => [w.offset, w.value, w.condition])]) ===
          JSON.stringify([
            summary.footprint,
            summary.calls,
            summary.writes.map((w) => [w.offset, w.value, w.condition]),
          ])
      )
        continue;
      summaries.set(code.address, summary);
      changed = true;
    }
    if (!changed) break;
  }
}

/** The part fields a bound value or test reads. */
function partReads(e: Expression | Predicate): { offset: number; width: number }[] {
  switch (e.kind) {
    case "field":
      return e.object === "part" ? [{ offset: e.offset, width: e.width }] : [];
    case "binary":
    case "compare":
      return [...partReads(e.left), ...partReads(e.right)];
    case "and":
      return e.terms.flatMap(partReads);
    default:
      return [];
  }
}

/** A value or test of the callee's part and its arguments, with the bound arguments put in; undefined otherwise. */
function bind<T extends Expression | Predicate>(e: T, bound: Map<number, number>): T | undefined {
  const go = (x: Expression | Predicate): Expression | Predicate | undefined => {
    switch (x.kind) {
      case "constant":
      case "true":
        return x;
      case "field":
        if (x.object === "part" && !x.unresolved) return x;
        if (x.object !== "argument" || !bound.has(x.offset)) return undefined;
        return { kind: "constant", value: bound.get(x.offset)! & (2 ** x.width - 1), width: x.width };
      case "binary": {
        const [left, right] = [go(x.left), go(x.right)];
        return left && right ? { ...x, left: left as Expression, right: right as Expression } : undefined;
      }
      case "compare": {
        const [left, right] = [go(x.left), go(x.right)];
        return left && right ? { ...x, left: left as Expression, right: right as Expression } : undefined;
      }
      case "and": {
        const terms = x.terms.map(go);
        return terms.every(Boolean) ? { ...x, terms: terms as Predicate[] } : undefined;
      }
      default:
        return undefined;
    }
  };
  return go(e) as T | undefined;
}
