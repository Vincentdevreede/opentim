/** Proves the null branch of a bounded connection loop without interpreting its body. */
import type { Finding } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { LoopSummary } from "./behaviour-loops.ts";
import type { Instruction, Operand } from "./x86.ts";

type Memory = Extract<Operand, { kind: "memory" }>;

export interface EmptyConnections extends Finding {
  fields: number[];
  localPointer: Memory;
  zeroRegisters: ["ax"];
  scratchRegisters: ["bx"];
}

const register = (operand: Operand | undefined, name?: string): operand is Extract<Operand, { kind: "register" }> =>
  operand?.kind === "register" && operand.width === 16 && (name === undefined || operand.name === name);
const memory = (operand: Operand | undefined): operand is Memory => operand?.kind === "memory";
const immediate = (operand: Operand | undefined, value: number) =>
  operand?.kind === "immediate" && operand.value === value;
const same = (a: Operand | undefined, b: Operand | undefined) => JSON.stringify(a) === JSON.stringify(b);
const local = (operand: Operand | undefined): operand is Memory =>
  memory(operand) &&
  operand.width === 16 &&
  operand.segment === "ss" &&
  operand.base.join() === "bp" &&
  operand.displacement < -1;
const is = (i: Instruction | undefined, mnemonic: string, ...operands: (Operand | undefined)[]) =>
  i?.mnemonic === mnemonic && i.operands.length === operands.length && operands.every((o, n) => same(o, i.operands[n]));
const evidence = ({ address, bytes, text }: Instruction) => ({ address, bytes, text });

/** The certificate requires an active iteration and nonnegative counter when its transfer is applied. */
export function proveEmptyConnections(
  code: RoutineCode,
  loop: LoopSummary,
  propagation: EngineSummary,
): EmptyConnections | undefined {
  const graph = propagation.partGraph;
  if (
    code.status !== "complete" ||
    propagation.kind !== "connected-gear-propagation" ||
    !graph ||
    graph.objectArguments.join() !== "6,8" ||
    propagation.argumentOffset !== 6 ||
    propagation.argumentKind !== "object" ||
    propagation.returnConvention?.kind !== "far" ||
    propagation.returnConvention.stackBytes !== 0 ||
    !propagation.footprint.partMemoryComplete ||
    !propagation.footprint.preservesPartState ||
    loop.step !== 1 ||
    loop.relation !== "<" ||
    loop.minimumCounter !== 0 ||
    !Number.isInteger(loop.limit) ||
    loop.limit <= 0 ||
    loop.limit > graph.links.length ||
    !local(loop.counter) ||
    !loop.proof.singleEntry ||
    !loop.proof.acyclicBody ||
    !loop.proof.updateDominatesLatch
  )
    return undefined;
  const fields = graph.links.slice(0, loop.limit);
  if (fields.some((offset, n) => offset !== fields[0]! + n * 2 || offset < 0 || offset + 2 > 65536)) return undefined;
  const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  const pushFrame = byAddress.get(code.address),
    setFrame = pushFrame && byAddress.get(pushFrame.address + pushFrame.size),
    reserve = setFrame && byAddress.get(setFrame.address + setFrame.size);
  const reservation = reserve?.operands[1];
  if (
    pushFrame?.mnemonic !== "push" ||
    !register(pushFrame.operands[0], "bp") ||
    setFrame?.mnemonic !== "mov" ||
    !register(setFrame.operands[0], "bp") ||
    !register(setFrame.operands[1], "sp") ||
    reserve?.mnemonic !== "sub" ||
    !register(reserve.operands[0], "sp") ||
    reservation?.kind !== "immediate" ||
    reservation.value < -loop.counter.displacement ||
    reservation.value > 0x7ffe
  )
    return undefined;
  const body = loop.body.map((at) => byAddress.get(at)).sort((a, b) => (a?.address ?? 0) - (b?.address ?? 0));
  if (body.some((i) => !i) || body[0]?.address !== loop.bodyEntry) return undefined;
  const instructions = body as Instruction[];
  // NOPs on the nonnull call bridge are harmless, but their CFG edges are checked below too.
  const meaningful = instructions.filter((i) => i.mnemonic !== "nop");
  const [index, shift, load, store, test, guard] = meaningful;
  const indexed = load?.operands[1],
    slot = store?.operands[0];
  if (
    index?.mnemonic !== "mov" ||
    !register(index.operands[0], "bx") ||
    !same(index.operands[1], loop.counter) ||
    shift?.mnemonic !== "shl" ||
    !register(shift.operands[0], "bx") ||
    !immediate(shift.operands[1], 1) ||
    load?.mnemonic !== "mov" ||
    !register(load.operands[0], "ax") ||
    !memory(indexed) ||
    indexed.width !== 16 ||
    indexed.segment !== "ds" ||
    indexed.base.length !== 2 ||
    !indexed.base.includes("bx") ||
    indexed.displacement !== fields[0] ||
    store?.mnemonic !== "mov" ||
    !local(slot) ||
    !register(store.operands[1], "ax") ||
    -slot.displacement > reservation.value ||
    Math.abs(slot.displacement - loop.counter.displacement) < 2 ||
    test?.mnemonic !== "or" ||
    !register(test.operands[0], "ax") ||
    !register(test.operands[1], "ax") ||
    guard?.mnemonic !== "je" ||
    guard.flow !== "branch" ||
    guard.target?.address !== loop.proof.update
  )
    return undefined;
  const owner = indexed.base.find((name) => name !== "bx");
  if (owner !== "si" && owner !== "di") return undefined;
  let n = 6;
  const pushAccumulator = meaningful[n++],
    setMode = meaningful[n++],
    pushMode = meaningful[n++],
    pushTarget = meaningful[n++],
    pushOwner = meaningful[n++];
  const accumulator = pushAccumulator?.operands[0];
  if (
    pushAccumulator?.mnemonic !== "push" ||
    !register(accumulator) ||
    !["si", "di"].includes(accumulator.name) ||
    accumulator.name === owner ||
    setMode?.mnemonic !== "mov" ||
    !register(setMode.operands[0], "ax") ||
    !immediate(setMode.operands[1], 2) ||
    pushMode?.mnemonic !== "push" ||
    !register(pushMode.operands[0], "ax") ||
    !is(pushTarget, "push", slot) ||
    pushOwner?.mnemonic !== "push" ||
    !register(pushOwner.operands[0], owner)
  )
    return undefined;
  let segmentPush: Instruction | undefined;
  if (meaningful[n]?.mnemonic === "push" && register(meaningful[n]?.operands[0], "cs")) segmentPush = meaningful[n++];
  const call = meaningful[n++],
    cleanup = meaningful[n++],
    saveReturn = meaningful[n++],
    update = meaningful[n++];
  const target = call && code.calls.find((c) => c.instruction === call.address);
  if (
    n !== meaningful.length ||
    call?.flow !== "call" ||
    target?.target?.address !== propagation.address ||
    target.confidence !== "checked" ||
    (target.far ? !!segmentPush : !segmentPush) ||
    (segmentPush && instructions[instructions.indexOf(call) - 1]?.address !== segmentPush.address) ||
    cleanup?.mnemonic !== "add" ||
    !register(cleanup.operands[0], "sp") ||
    !immediate(cleanup.operands[1], 8) ||
    saveReturn?.mnemonic !== "mov" ||
    !same(saveReturn.operands[0], accumulator) ||
    !register(saveReturn.operands[1], "ax") ||
    update?.mnemonic !== "inc" ||
    update.address !== loop.proof.update ||
    !same(update.operands[0], loop.counter)
  )
    return undefined;
  const header = byAddress.get(loop.header),
    latch = byAddress.get(loop.latch);
  if (
    header?.mnemonic !== "cmp" ||
    !same(header.operands[0], loop.counter) ||
    !immediate(header.operands[1], loop.limit) ||
    latch?.mnemonic !== (loop.signed ? "jl" : "jb") ||
    latch.target?.address !== loop.bodyEntry
  )
    return undefined;
  const edgesMatch = (at: number, expected: [string, number][]) => {
    const actual = code.edges.filter((e) => e.from === at);
    return (
      actual.length === expected.length &&
      expected.every(([kind, to]) => actual.some((e) => e.kind === kind && e.to === to))
    );
  };
  const incoming = new Map<number, number[]>();
  for (const edge of code.edges)
    if (edge.to !== null) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  for (let k = 0; k < instructions.length; k++) {
    const i = instructions[k]!,
      next = instructions[k + 1]?.address ?? loop.header;
    if (
      i.address + i.size !== next ||
      !edgesMatch(
        i.address,
        i === guard
          ? [
              ["taken", update.address],
              ["not-taken", next],
            ]
          : [["next", next]],
      ) ||
      (incoming.get(i.address) ?? []).some((from) => !loop.body.includes(from) && !(k === 0 && from === loop.latch))
    )
      return undefined;
  }
  if (
    !edgesMatch(loop.header, [["next", loop.latch]]) ||
    !edgesMatch(loop.latch, [
      ["taken", loop.bodyEntry],
      ["not-taken", loop.exit],
    ]) ||
    (incoming.get(loop.latch) ?? []).some((from) => from !== loop.header)
  )
    return undefined;
  // A single dominating argument load establishes the stable owner. Reject competing definitions and calls
  // on paths leading to this loop, apart from the already certified propagation call.
  const ancestors = new Set<number>(),
    pending = [loop.bodyEntry];
  while (pending.length) {
    const at = pending.pop()!;
    if (ancestors.has(at)) continue;
    ancestors.add(at);
    pending.push(...(incoming.get(at) ?? []));
  }
  const mutatesRegister = (i: Instruction, names: string[]) => {
    if (["cmp", "test", "push"].includes(i.mnemonic)) return false;
    if (i.mnemonic === "xchg") return i.operands.some((o) => register(o) && names.includes(o.name));
    return i.flow === "next" && register(i.operands[0]) && names.includes(i.operands[0].name);
  };
  if (
    code.instructions.some(
      (i) =>
        ancestors.has(i.address) &&
        (mutatesRegister(i, ["ds", "ss"]) ||
          (i.address !== setFrame.address && mutatesRegister(i, ["bp"])) ||
          ["lds", "leave", "int", "into", "bound", "esc"].includes(i.mnemonic) ||
          (i.mnemonic === "xchg" && mutatesRegister(i, [owner]))),
    )
  )
    return undefined;
  const definitions = code.instructions.filter(
    (i) =>
      ancestors.has(i.address) &&
      i.flow === "next" &&
      !["cmp", "test", "push"].includes(i.mnemonic) &&
      register(i.operands[0], owner),
  );
  const definition = definitions[0];
  const argument = definition?.operands[1];
  if (
    definitions.length !== 1 ||
    definition?.mnemonic !== "mov" ||
    !memory(argument) ||
    argument.width !== 16 ||
    argument.segment !== "ss" ||
    argument.base.join() !== "bp" ||
    argument.displacement !== 6 ||
    code.instructions.some((i) => ancestors.has(i.address) && i.flow === "call" && i.address !== call.address) ||
    code.instructions.some(
      (i) => ancestors.has(i.address) && /^(movs|lods|stos|cmps|scas|ins|outs|popa|pusha|enter)/.test(i.mnemonic),
    )
  )
    return undefined;
  // The argument load must dominate the body even in an untrusted supplied CFG.
  const reachable = [code.address],
    seen = new Set<number>();
  while (reachable.length) {
    const at = reachable.pop()!;
    if (at === definition.address || seen.has(at)) continue;
    if (at === loop.bodyEntry) return undefined;
    seen.add(at);
    reachable.push(...code.edges.filter((e) => e.from === at && e.to !== null).map((e) => e.to!));
  }
  return {
    fields,
    localPointer: slot,
    zeroRegisters: ["ax"],
    scratchRegisters: ["bx"],
    confidence: "inferred",
    evidence: [pushFrame, setFrame, reserve, definition, ...instructions, header, latch].map(evidence),
    assumptions: [
      ...loop.assumptions,
      "The existing counted-loop entry proof establishes an active iteration and a nonnegative counter. Every examined owner connection word is zero and the complete part and private stack occupy separate valid storage.",
      "The null test jumps directly to the sole counter increment. Only AX, BX, the private pointer word and the counter change; no call or argument-stack operation occurs on this branch.",
    ],
  };
}
