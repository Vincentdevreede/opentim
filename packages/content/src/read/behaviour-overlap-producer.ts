/** Certifies overlap-list shape on normal return without assuming the source enumeration terminates. */
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import type { Finding } from "./behaviour.ts";
import type { Instruction, Operand } from "./x86.ts";

export interface OverlapProducer extends Finding {
  headField: number;
  nextField: number;
  ownerArgument: 6;
  sourceNextField: number;
  classFlagsField: number;
  globalHeads: number[];
  conditionalOnNormalReturn: true;
  finite: true;
  acyclic: true;
  excludesOwner: true;
}

const headPattern = `push bp
mov bp,sp
mov dx,16:ss[bp+6]
cmp 16:ds[{first}],#0
je @second
test dx,#8192
je @second
mov ax,16:ds[{first}]
jmp @done
second: cmp 16:ds[{second}],#0
je @third
test dx,#4096
je @third
mov ax,16:ds[{second}]
jmp @done
third: cmp 16:ds[{third}],#0
je @zero
test dx,#2048
je @zero
mov ax,16:ds[{third}]
jmp @done
zero: xor ax,ax
done: pop bp
retf`;
const nextPattern = `push bp
mov bp,sp
push si
push di
mov si,16:ss[bp+6]
mov di,16:ss[bp+8]
cmp 16:ds[si+{sourceNext}],#0
je @tail
mov ax,16:ds[si+{sourceNext}]
jmp @done
tail: test 16:ds[si+{classFlags}],#8192
je @second
push di
push cs
call $head
pop cx
jmp @done
second: test 16:ds[si+{classFlags}],#4096
je @zero
test di,#2048
je @zero
mov ax,16:ds[{third}]
jmp @done
zero: xor ax,ax
done: pop di
pop si
pop bp
retf`;
const shared = (pattern: string) => {
  let first = true;
  return pattern
    .replaceAll("jmp @done", () => (first ? ((first = false), "bridge: jmp @done") : "jmp @bridge"))
    .replace("zero: xor ax,ax\ndone:", "zero: xor ax,ax\njmp @bridge\ndone:");
};
const register = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && o.width === 16 && (name === undefined || o.name === name);
const memory = (o: Operand | undefined, base?: string): o is Extract<Operand, { kind: "memory" }> =>
  o?.kind === "memory" && (base === undefined || o.base.join() === base);
const immediate = (o: Operand | undefined, value?: number): o is Extract<Operand, { kind: "immediate" }> =>
  o?.kind === "immediate" && (value === undefined || o.value === value);
const stack = (o: Operand | undefined, offset?: number) =>
  memory(o, "bp") && o.width === 16 && o.segment === "ss" && (offset === undefined || o.displacement === offset);
const part = (o: Operand | undefined, base: string, offset?: number) =>
  memory(o, base) && o.width === 16 && o.segment === "ds" && (offset === undefined || o.displacement === offset);
const overlaps = (a: number, width: number, b: number) => a < b + 2 && b < a + width / 8;
const writes = (i: Instruction) => i.flow === "next" && !["push", "cmp", "test", "cwd", "nop"].includes(i.mnemonic);
const evidence = ({ address, bytes, text }: Instruction) => ({ address, bytes, text });

/** The certificate makes no unconditional claim that a malformed global chain returns. */
export function proveOverlapProducer(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  summary: EngineSummary,
): OverlapProducer | undefined {
  const list = summary.list;
  if (
    code.status !== "complete" ||
    summary.address !== code.address ||
    summary.kind !== "overlap-list" ||
    !list ||
    code.calls.length !== 2 ||
    list.headField !== list.nextField
  )
    return;
  const instructions = code.instructions,
    byAddress = new Map(instructions.map((i) => [i.address, i]));
  if (instructions[0]?.address !== code.address) return;
  const outgoing = new Map<number, number[]>(),
    incoming = new Map<number, number[]>();
  for (let n = 0; n < instructions.length; n++) {
    const i = instructions[n]!,
      next = instructions[n + 1]?.address;
    if (i.prefixes.length || (["next", "call", "branch"].includes(i.flow) && next !== i.address + i.size)) return;
    const expected =
      i.flow === "return"
        ? [["return", null]]
        : i.flow === "branch"
          ? [
              ["taken", i.target?.address],
              ["not-taken", next],
            ]
          : i.flow === "jump"
            ? [["jump", i.target?.address]]
            : [["next", next]];
    const edges = code.edges.filter((e) => e.from === i.address);
    if (
      expected.some(([, to]) => to === undefined) ||
      edges.length !== expected.length ||
      expected.some(([kind, to]) => !edges.some((e) => e.kind === kind && e.to === to))
    )
      return;
    for (const e of edges)
      if (e.to !== null) {
        if (!byAddress.has(e.to)) return;
        outgoing.set(i.address, [...(outgoing.get(i.address) ?? []), e.to]);
        incoming.set(e.to, [...(incoming.get(e.to) ?? []), i.address]);
      }
  }
  if (code.edges.some((e) => !byAddress.has(e.from))) return;
  const [headCall, nextCall] = [...code.calls].sort((a, b) => a.instruction - b.instruction);
  const headCode = headCall?.target && codes.get(headCall.target.address),
    nextCode = nextCall?.target && codes.get(nextCall.target.address);
  if (!headCode || !nextCode) return;
  const heads =
    matchHeapRoutine(headCode, headPattern, new Map()) ?? matchHeapRoutine(headCode, shared(headPattern), new Map());
  const bound = heads && new Map([...heads, ["head", headCode.address]]);
  const enumeration =
    bound && (matchHeapRoutine(nextCode, nextPattern, bound) ?? matchHeapRoutine(nextCode, shared(nextPattern), bound));
  if (!enumeration) return;
  const sourceNext = enumeration.get("sourceNext")!,
    classFlags = enumeration.get("classFlags")!,
    globalHeads = ["first", "second", "third"].map((key) => enumeration.get(key)!);
  const field = list.headField;
  if (
    [field, sourceNext, classFlags, ...globalHeads].some((n) => n < 0 || n + 2 > 65536) ||
    overlaps(field, 16, sourceNext) ||
    overlaps(field, 16, classFlags) ||
    overlaps(sourceNext, 16, classFlags) ||
    globalHeads.some((a, n) => globalHeads.some((b, m) => n !== m && overlaps(a, 16, b)))
  )
    return;
  const [pushBP, frame, reserve, pushSI, pushDI, owner, clear] = instructions;
  if (
    pushBP?.mnemonic !== "push" ||
    !register(pushBP.operands[0], "bp") ||
    frame?.mnemonic !== "mov" ||
    !register(frame.operands[0], "bp") ||
    !register(frame.operands[1], "sp") ||
    reserve?.mnemonic !== "sub" ||
    !register(reserve.operands[0], "sp") ||
    !immediate(reserve.operands[1]) ||
    reserve.operands[1].value < 0 ||
    reserve.operands[1].value % 2 !== 0 ||
    reserve.operands[1].value > 0x7ffe ||
    pushSI?.mnemonic !== "push" ||
    !register(pushSI.operands[0], "si") ||
    pushDI?.mnemonic !== "push" ||
    !register(pushDI.operands[0], "di") ||
    owner?.mnemonic !== "mov" ||
    !register(owner.operands[0], "di") ||
    !stack(owner.operands[1], 6) ||
    clear?.mnemonic !== "mov" ||
    !part(clear.operands[0], "di", field) ||
    !immediate(clear.operands[1], 0)
  )
    return;
  const frameSize = reserve.operands[1].value;
  const epilogue = instructions.slice(-5),
    [popDI, popSI, restore, popBP, ret] = epilogue;
  if (
    popDI?.mnemonic !== "pop" ||
    !register(popDI.operands[0], "di") ||
    popSI?.mnemonic !== "pop" ||
    !register(popSI.operands[0], "si") ||
    restore?.mnemonic !== "mov" ||
    !register(restore.operands[0], "sp") ||
    !register(restore.operands[1], "bp") ||
    popBP?.mnemonic !== "pop" ||
    !register(popBP.operands[0], "bp") ||
    ret?.mnemonic !== "retf" ||
    ret.operands.length !== 0 ||
    instructions.filter((i) => i.flow === "return").length !== 1
  )
    return;
  const gateways = instructions.filter(
    (i) => i.mnemonic === "mov" && register(i.operands[0], "si") && register(i.operands[1], "ax"),
  );
  if (gateways.length !== 1) return;
  const gateway = gateways[0]!,
    gatewayIndex = instructions.indexOf(gateway),
    guard = instructions[gatewayIndex + 1],
    branch = instructions[gatewayIndex + 2];
  if (
    guard?.mnemonic !== "or" ||
    !register(guard.operands[0], "si") ||
    !register(guard.operands[1], "si") ||
    !branch ||
    !["je", "jne"].includes(branch.mnemonic)
  )
    return;
  const bodyEntry = branch.mnemonic === "jne" ? branch.target?.address : instructions[gatewayIndex + 3]?.address;
  const nullEntry = branch.mnemonic === "je" ? branch.target?.address : instructions[gatewayIndex + 3]?.address;
  if (bodyEntry === undefined || nullEntry === undefined) return;
  const before = new Map(instructions.map((i) => [i.address + i.size, i]));
  const bridgeBefore = (at: number) => {
    const tail: Instruction[] = [];
    let i = before.get(at);
    while (i?.mnemonic === "nop" || (i?.mnemonic === "push" && register(i.operands[0], "cs"))) {
      tail.unshift(i);
      i = before.get(i.address);
    }
    return { tail, previous: i };
  };
  const headBridge = bridgeBefore(headCall!.instruction),
    headPush = headBridge.previous;
  const nextBridge = bridgeBefore(nextCall!.instruction),
    nodePush = nextBridge.previous,
    maskPush = nodePush && before.get(nodePush.address),
    maskDefinition = maskPush && before.get(maskPush.address),
    loadMask = maskDefinition && before.get(maskDefinition.address);
  const headFromArgument = headPush?.mnemonic === "push" && stack(headPush.operands[0], 8);
  const headDefinition = headPush && before.get(headPush.address);
  const headFromConstant =
    headPush?.mnemonic === "push" &&
    register(headPush.operands[0], "ax") &&
    headDefinition?.mnemonic === "mov" &&
    register(headDefinition.operands[0], "ax") &&
    immediate(headDefinition.operands[1]) &&
    headDefinition.operands[1].value >= 0 &&
    headDefinition.operands[1].value <= 0xffff;
  const nextFromConstant =
    maskDefinition?.mnemonic === "mov" &&
    register(maskDefinition.operands[0], "ax") &&
    immediate(maskDefinition.operands[1]) &&
    maskDefinition.operands[1].value >= 0 &&
    maskDefinition.operands[1].value <= 0xffff;
  const nextFromArgument =
    maskDefinition?.mnemonic === "and" &&
    register(maskDefinition.operands[0], "ax") &&
    immediate(maskDefinition.operands[1], 4096) &&
    loadMask?.mnemonic === "mov" &&
    register(loadMask.operands[0], "ax") &&
    stack(loadMask.operands[1], 8);
  if (
    (!headFromArgument && !headFromConstant) ||
    nodePush?.mnemonic !== "push" ||
    !register(nodePush.operands[0], "si") ||
    maskPush?.mnemonic !== "push" ||
    !register(maskPush.operands[0], "ax") ||
    (!nextFromConstant && !nextFromArgument)
  )
    return;
  const maskSetup = nextFromConstant ? [maskDefinition!] : [loadMask!, maskDefinition!];
  const advance = maskSetup[0]!.address;
  // Argument eight is immutable only when it supplies an enumeration mask. Constant-mask queries use it as a coordinate.
  const usesMaskArgument = headFromArgument || nextFromArgument;
  for (const [call, bridge] of [
    [headCall!, headBridge.tail],
    [nextCall!, nextBridge.tail],
  ] as const) {
    const i = byAddress.get(call.instruction),
      segments = bridge.filter((p) => p.mnemonic === "push");
    if (
      i?.flow !== "call" ||
      i.target?.address !== call.target?.address ||
      call.confidence !== "checked" ||
      (call.far
        ? segments.length !== 0
        : segments.length !== 1 || before.get(i.address)?.address !== segments[0]!.address)
    )
      return;
  }
  const linear = (start: number, stop: number, allowed: (i: Instruction) => boolean) => {
    const seen = new Set<number>();
    let at = start;
    while (at !== stop) {
      const i = byAddress.get(at);
      if (!i || seen.has(at) || !allowed(i) || (outgoing.get(at)?.length ?? 0) !== 1) return false;
      seen.add(at);
      at = outgoing.get(at)![0]!;
    }
    return true;
  };
  if (!linear(nullEntry, popDI.address, (i) => i.mnemonic === "jmp" || i.mnemonic === "nop")) return;
  const cleanup = (call: Instruction, pops: number) => {
    let count = 0;
    return (
      linear(call.address + call.size, gateway.address, (i) => {
        if (i.mnemonic === "pop" && register(i.operands[0], "cx")) {
          count++;
          return count <= pops;
        }
        return i.mnemonic === "jmp" || i.mnemonic === "nop";
      }) && count === pops
    );
  };
  if (!cleanup(byAddress.get(headCall!.instruction)!, 1) || !cleanup(byAddress.get(nextCall!.instruction)!, 2)) return;
  if (!linear(code.address, headCall!.instruction, (i) => i.flow === "next")) return;
  const region = new Set<number>(),
    active = new Set<number>();
  const acyclic = (at: number): boolean => {
    if (at === advance) return true;
    if (active.has(at)) return false;
    if (region.has(at)) return true;
    const i = byAddress.get(at);
    if (
      !i ||
      [gateway.address, headCall!.instruction, nextCall!.instruction, popDI.address].includes(at) ||
      i.flow === "return"
    )
      return false;
    active.add(at);
    const successors = outgoing.get(at) ?? [];
    if (!successors.length || !successors.every(acyclic)) return false;
    active.delete(at);
    region.add(at);
    return true;
  };
  if (!acyclic(bodyEntry)) return;
  const advanceNodes = [...maskSetup, maskPush, nodePush, ...nextBridge.tail, byAddress.get(nextCall!.instruction)!];
  if (
    advanceNodes.some(
      (i, n) =>
        n > 0 &&
        (incoming.get(i.address)?.length !== 1 || incoming.get(i.address)![0] !== advanceNodes[n - 1]!.address),
    )
  )
    return;
  const insertions = instructions.filter(
    (i, n) =>
      i.mnemonic === "mov" &&
      register(i.operands[0], "ax") &&
      part(i.operands[1], "di", field) &&
      instructions[n + 1]?.mnemonic === "mov" &&
      part(instructions[n + 1]?.operands[0], "si", field) &&
      register(instructions[n + 1]?.operands[1], "ax") &&
      instructions[n + 2]?.mnemonic === "mov" &&
      part(instructions[n + 2]?.operands[0], "di", field) &&
      register(instructions[n + 2]?.operands[1], "si"),
  );
  if (insertions.length !== 1) return;
  const insertion = insertions[0]!,
    insertIndex = instructions.indexOf(insertion),
    linkStore = instructions[insertIndex + 1]!,
    headStore = instructions[insertIndex + 2]!;
  if (
    ![insertion, linkStore, headStore].every((i) => region.has(i.address)) ||
    [linkStore, headStore].some(
      (i, n) =>
        incoming.get(i.address)?.length !== 1 || incoming.get(i.address)![0] !== instructions[insertIndex + n]!.address,
    )
  )
    return;
  const reaches = (start: number, target: number, stop?: number) => {
    const pending = [start],
      seen = new Set<number>();
    while (pending.length) {
      const at = pending.pop()!;
      if (at === stop || seen.has(at)) continue;
      if (at === target) return true;
      seen.add(at);
      pending.push(...(outgoing.get(at) ?? []));
    }
    return false;
  };
  const exclusion = instructions.find((i, n) => {
    if (
      i.mnemonic !== "cmp" ||
      !(
        (register(i.operands[0], "di") && register(i.operands[1], "si")) ||
        (register(i.operands[0], "si") && register(i.operands[1], "di"))
      )
    )
      return false;
    const b = instructions[n + 1];
    if (!b || !["je", "jne"].includes(b.mnemonic) || !region.has(b.address)) return false;
    const equal = code.edges.find(
      (e) => e.from === b.address && e.kind === (b.mnemonic === "je" ? "taken" : "not-taken"),
    )?.to;
    return (
      equal !== undefined &&
      equal !== null &&
      !reaches(bodyEntry, insertion.address, i.address) &&
      !reaches(equal, insertion.address, advance)
    );
  });
  if (!exclusion) return;
  const allowed = new Set([
    "mov",
    "add",
    "sub",
    "and",
    "or",
    "xor",
    "cmp",
    "test",
    "cwd",
    "neg",
    "shl",
    "shr",
    "sar",
    "inc",
    "dec",
    "push",
    "pop",
    "nop",
    "call",
    "jmp",
    "je",
    "jne",
    "jl",
    "jle",
    "jg",
    "jge",
    "jb",
    "jbe",
    "ja",
    "jae",
    "retf",
  ]);
  for (const i of instructions) {
    if (!allowed.has(i.mnemonic)) return;
    if (!writes(i)) continue;
    const dest = i.operands[0];
    if (register(dest)) {
      if (
        (dest.name === "di" && i !== owner && i !== popDI) ||
        (dest.name === "si" && i !== gateway && i !== guard && i !== popSI) ||
        (dest.name === "bp" && i !== frame && i !== popBP) ||
        (dest.name === "sp" && i !== reserve && i !== restore) ||
        ["ds", "ss", "es"].includes(dest.name)
      )
        return;
    } else if (memory(dest)) {
      if (dest.segment === "ss" && dest.base.join() === "bp") {
        if (
          (dest.displacement < 0
            ? dest.displacement < -frameSize || dest.displacement + dest.width / 8 > 0
            : dest.displacement < (usesMaskArgument ? 10 : 8)) ||
          overlaps(dest.displacement, dest.width, 6) ||
          (usesMaskArgument && overlaps(dest.displacement, dest.width, 8))
        )
          return;
      } else if (
        dest.segment !== "ds" ||
        dest.base.length !== 1 ||
        dest.displacement < 0 ||
        dest.displacement + dest.width / 8 > 65536 ||
        (dest.base[0] === "di"
          ? i !== clear && i !== headStore
          : dest.base[0] !== "si" ||
            !region.has(i.address) ||
            (overlaps(dest.displacement, dest.width, field) && i !== linkStore) ||
            overlaps(dest.displacement, dest.width, sourceNext) ||
            overlaps(dest.displacement, dest.width, classFlags))
      )
        return;
    }
  }
  // No second entry may skip the reset or one of the per-iteration setup chains.
  const permitted = new Set<number>([...region, ...advanceNodes.map((i) => i.address)]);
  for (const at of region)
    if ((incoming.get(at) ?? []).some((from) => !region.has(from) && !(at === bodyEntry && from === branch.address)))
      return;
  for (const i of instructions) if (i.address !== code.address && !incoming.has(i.address)) return;
  if (
    reaches(code.address, gateway.address, clear.address) ||
    reaches(code.address, gateway.address, headCall!.instruction) ||
    [...permitted].some((at) => reaches(at, clear.address, gateway.address))
  )
    return;
  const deltas = new Map<number, number>([[code.address, 0]]),
    pending = [code.address];
  while (pending.length) {
    const at = pending.pop()!,
      i = byAddress.get(at)!,
      old = deltas.get(at)!;
    let value = old + (i.mnemonic === "push" ? -2 : i.mnemonic === "pop" ? 2 : 0);
    if (i === reserve) value -= frameSize;
    if (i === restore) value = -2;
    if (i.flow === "call" && !code.calls.find((c) => c.instruction === at)!.far) value += 2;
    if (i.flow === "return" && value !== 0) return;
    for (const next of outgoing.get(at) ?? []) {
      if (deltas.has(next) && deltas.get(next) !== value) return;
      if (!deltas.has(next)) {
        deltas.set(next, value);
        pending.push(next);
      }
    }
  }
  return {
    headField: field,
    nextField: field,
    ownerArgument: 6,
    sourceNextField: sourceNext,
    classFlagsField: classFlags,
    globalHeads,
    conditionalOnNormalReturn: true,
    finite: true,
    acyclic: true,
    excludesOwner: true,
    confidence: "inferred",
    evidence: [code, headCode, nextCode].flatMap((c) => c.instructions.map(evidence)),
    assumptions: [
      "The owner and every nonzero enumerated pointer are complete nonwrapping part bases. Distinct parts occupy disjoint storage; global head words and valid private stack storage are separate from every part.",
      "Global head words, primary next fields and class flags remain stable during the query. The verified query and its read-only enumerator helpers cannot change them under the storage separation assumption; no external writer intervenes.",
      "The head and successor mask bridges are exact decoded argument or constant setups. When a mask reads argument eight, that word is unchanged; constant-mask variants may instead use that argument for coordinate arithmetic. Each candidate has the same successor on every visit.",
      "This is a normal-return postcondition, not a termination claim. A repeated candidate would have the same deterministic stable successor forever and could not reach the sole null exit. Therefore a returning query enumerates no candidate twice, and prepending each accepted non-owner candidate to the initially empty output yields a finite acyclic owner-excluding list.",
    ],
  };
}
