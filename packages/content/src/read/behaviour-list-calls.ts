/** Proves that a caller supplies a fresh, owner-excluding list to a conditional consumer. */
import type { Finding } from "./behaviour.ts";
import type { RoutineCode, RoutineCall } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import { evidenceOf, isWordRegister } from "./behaviour-terms.ts";

export interface ListConsumerCall extends Finding {
  instruction: number;
  consumer: number;
  producers: number[];
  ownerRegister: string;
  headField: number;
  nextField: number;
}

/** No capability crosses a possible object store or another call. Alternative fresh producers must cover every path. */
export function discoverListConsumerCalls(code: RoutineCode, helpers: Map<number, EngineSummary>): ListConsumerCall[] {
  if (code.status !== "complete") return [];
  const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  const before = new Map(code.instructions.map((i) => [i.address + i.size, i]));
  const incoming = new Map<number, number[]>(),
    outgoing = new Map<number, number[]>();
  for (const e of code.edges)
    if (e.to !== null) {
      incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
      outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
    }
  const ownerPush = (call: RoutineCall, kind: "near" | "far") => {
    let i = before.get(call.instruction);
    while (i?.mnemonic === "nop") i = before.get(i.address);
    const pushedSegment = i?.mnemonic === "push" && isWordRegister(i.operands[0], "cs");
    if (kind === "far" ? (call.far ? pushedSegment : !pushedSegment) : call.far || pushedSegment) return;
    if (pushedSegment) i = before.get(i!.address);
    while (i?.mnemonic === "nop") i = before.get(i.address);
    if (!i) return;
    let cursor = i.address;
    while (cursor !== call.instruction) {
      const instruction = byAddress.get(cursor);
      if (!instruction) return;
      const next = cursor + instruction.size,
        parents = incoming.get(next) ?? [];
      if (parents.length !== 1 || parents[0] !== cursor) return;
      cursor = next;
    }
    return i.mnemonic === "push" && isWordRegister(i.operands[0]) && ["si", "di"].includes(i.operands[0].name)
      ? i
      : undefined;
  };
  const result: ListConsumerCall[] = [];
  for (const call of code.calls) {
    if (!call.target || call.confidence !== "checked") continue;
    const callee = helpers.get(call.target.address),
      consumer = callee?.listConsumer;
    if (
      !consumer ||
      consumer.argumentOffset !== (consumer.returnConvention.kind === "far" ? 6 : 4) ||
      consumer.returnConvention.stackBytes
    )
      continue;
    const pushed = ownerPush(call, consumer.returnConvention.kind);
    if (!pushed || !isWordRegister(pushed.operands[0])) continue;
    const owner = pushed.operands[0].name;
    const queries = new Map(
      code.calls.flatMap((q) => {
        const helper = q.target && q.confidence === "checked" ? helpers.get(q.target.address) : undefined;
        const proof = helper?.overlapProducer;
        const p =
          proof &&
          helper?.returnConvention?.kind === "far" &&
          !helper.returnConvention.stackBytes &&
          helper.argumentOffset === proof.ownerArgument
            ? ownerPush(q, "far")
            : undefined;
        return proof &&
          proof.conditionalOnNormalReturn &&
          proof.excludesOwner &&
          proof.finite &&
          proof.acyclic &&
          proof.headField === consumer.headField &&
          proof.nextField === consumer.nextField &&
          p &&
          isWordRegister(p.operands[0], owner)
          ? [[q.instruction, { call: q, helper: helper!, push: p }] as const]
          : [];
      }),
    );
    if (!queries.size) continue;
    const uncovered = [code.address],
      seen = new Set<number>();
    let invalid = false;
    while (uncovered.length) {
      const at = uncovered.pop()!;
      if (queries.has(at) || seen.has(at)) continue;
      if (at === call.instruction) {
        invalid = true;
        break;
      }
      seen.add(at);
      uncovered.push(...(outgoing.get(at) ?? []));
    }
    if (invalid) continue;
    const pending = [...(incoming.get(call.instruction) ?? [])],
      between = new Set<number>(),
      used = new Set<number>();
    while (pending.length) {
      const at = pending.pop()!;
      if (queries.has(at)) {
        used.add(at);
        continue;
      }
      if (between.has(at)) continue;
      between.add(at);
      pending.push(...(incoming.get(at) ?? []));
    }
    if (!used.size) continue;
    for (const at of between) {
      const i = byAddress.get(at);
      if (
        !i ||
        i.flow === "call" ||
        /^(movs|stos|lods|scas|cmps|ins|outs|int|into|iret|enter|leave|pusha|popa|esc|bound|lds|xchg|in$|out$)/.test(
          i.mnemonic,
        )
      ) {
        invalid = true;
        break;
      }
      const dest = i.operands[0];
      const writes = !["cmp", "test", "push", "nop"].includes(i.mnemonic) && i.flow === "next";
      if (
        writes &&
        isWordRegister(dest, "sp") &&
        !(["add", "sub"].includes(i.mnemonic) && i.operands[1]?.kind === "immediate" && i.operands[1].value % 2 === 0)
      ) {
        invalid = true;
        break;
      }
      if (
        writes &&
        (dest?.kind === "memory" || (isWordRegister(dest) && [owner, "bp", "ds", "ss"].includes(dest.name)))
      ) {
        invalid = true;
        break;
      }
    }
    if (invalid) continue;
    const proofs = [...used].map((at) => queries.get(at)!);
    result.push({
      instruction: call.instruction,
      consumer: consumer.address,
      producers: [...used].sort((a, b) => a - b),
      ownerRegister: owner,
      headField: consumer.headField,
      nextField: consumer.nextField,
      confidence: "inferred",
      evidence: [
        ...consumer.evidence,
        ...proofs.flatMap((p) => [...p.helper.overlapProducer!.evidence, ...p.call.evidence, evidenceOf(p.push)]),
        ...[...between].map((at) => evidenceOf(byAddress.get(at)!)),
        ...call.evidence,
        evidenceOf(pushed),
      ],
      assumptions: [
        ...new Set([
          ...consumer.assumptions,
          ...proofs.flatMap((p) => p.helper.overlapProducer!.assumptions),
          "Every path to this consumer crosses a normally returned matching producer on the same preserved register. No intervening call, object store, frame mutation or owner-register replacement can change that list.",
          "The actual consumer argument must also be established as the analysed owner's complete base. This certificate alone does not discharge that object identity.",
        ]),
      ],
    });
  }
  return result;
}
