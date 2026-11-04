/** Describes the root gear callback's ordered connection pass without choosing a runtime graph. */
import type { Finding } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import { addGearSummaries } from "./behaviour-gear.ts";
import type { GearAdvanceRelation, GearPropagationRelation } from "./behaviour-gear-model.ts";
import type { EngineSummary } from "./behaviour-helpers.ts";
import { matchHeapRoutine } from "./behaviour-heap-release.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { Operand } from "./x86.ts";

type WordMemory = Extract<Operand, { kind: "memory" }> & { width: 16 };
export interface GearRunContract extends Finding {
  address: number;
  argumentOffset: 6;
  stateField: number;
  deltaField: number;
  flagsField: number;
  visitedMask: 64;
  propagation: number;
  advance: number;
  propagationRelation: GearPropagationRelation;
  advancementRelation: GearAdvanceRelation;
  links: number[];
  fields: { offset: number; width: number }[];
  pass: { order: "increasing-slot"; count: 4; mode: 2; initialConflict: 0; skipNull: true; skipDisabled: false };
  result: { name: "connectionConflict"; width: 16; values: [0, 1]; relation: "ordered-gear-propagation" };
  scan: {
    header: number;
    latch: number;
    exit: number;
    bodyEntry: number;
    counter: WordMemory;
    accumulatorRegister: "di";
    pointerSlot: WordMemory;
    propagationCall: number;
  };
}
const root = `push bp
mov bp,sp
sub sp,#4
push si
push di
mov si,16:ss[bp+6]
cmp 16:ds[si+{delta}],#0
je @done
or 16:ds[si+{flags}],#64
xor di,di
mov 16:ss[bp+-2],#0
jmp @header
body: mov bx,16:ss[bp+-2]
shl bx,#1
mov ax,16:ds[bx+si+{links}]
mov 16:ss[bp+-4],ax
or ax,ax
je @latch
push di
mov ax,#2
push ax
push 16:ss[bp+-4]
push si
{propagationCall}
add sp,#8
mov di,ax
latch: inc 16:ss[bp+-2]
header: cmp 16:ss[bp+-2],#4
jl @body
or di,di
je @advanceCall
mov 16:ds[si+{delta}],#0
advanceCall: push di
push si
{advanceCall}
pop cx
pop cx
done: pop di
pop si
mov sp,bp
pop bp
retf`;
const calls = (name: string) => [
  `push cs\ncall $${name}`,
  `nop\npush cs\ncall $${name}`,
  `callf $${name}`,
  `nop\ncallf $${name}`,
];
const memory = (o: Operand | undefined): o is WordMemory => o?.kind === "memory" && o.width === 16;
const certificate = (s: EngineSummary) =>
  JSON.stringify({
    address: s.address,
    kind: s.kind,
    argumentOffset: s.argumentOffset,
    argumentKind: s.argumentKind,
    convention: s.returnConvention,
    calls: s.calls,
    graph: s.partGraph && {
      fields: s.partGraph.fields,
      objectArguments: s.partGraph.objectArguments,
      recursiveCalls: s.partGraph.recursiveCalls,
      links: s.partGraph.links,
      peer: s.partGraph.peer,
      stateCases: s.partGraph.stateCases,
      preservesNonzeroOwnerField: s.partGraph.preservesNonzeroOwnerField,
      conflict: s.partGraph.conflict,
    },
    footprint: s.footprint,
    writes: s.writes.map(({ root, path, argumentOffset, offset, width, value, condition }) => ({
      root,
      path,
      argumentOffset,
      offset,
      width,
      value,
      condition,
    })),
  });

/** Matches the entire root and independently rechecks its referenced propagation, advance and peer certificates. */
export function discoverGearRun(
  code: RoutineCode,
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  layout: BehaviourLayout,
): GearRunContract | undefined {
  const state = layout.fields.find((f) => f.name === "state"),
    delta = layout.fields.find((f) => f.name === "stateDelta"),
    flags = layout.fields.find((f) => f.name === "drawingFlags");
  if (code.status !== "complete" || !state || !delta || !flags || code.calls.length !== 2) return;
  const entryGate = code.instructions[6];
  if (
    entryGate?.mnemonic !== "cmp" ||
    !memory(entryGate.operands[0]) ||
    entryGate.operands[0].segment !== "ds" ||
    entryGate.operands[0].base.join() !== "si" ||
    entryGate.operands[0].displacement !== delta.offset
  )
    return;
  const initial = new Map([
    ["delta", delta.offset],
    ["flags", flags.offset],
  ]);
  let binding: Map<string, number> | undefined;
  for (const p of calls("propagation"))
    for (const a of calls("advance")) {
      binding ??= matchHeapRoutine(code, root.replace("{propagationCall}", p).replace("{advanceCall}", a), initial);
    }
  if (!binding) return;
  const propagation = summaries.get(binding.get("propagation")!),
    advance = summaries.get(binding.get("advance")!);
  if (
    !propagation?.partGraph ||
    !advance?.partGraph ||
    propagation.kind !== "connected-gear-propagation" ||
    advance.kind !== "connected-gear-advance"
  )
    return;
  const peer = propagation.partGraph.peer.routine;
  if (advance.partGraph.peer.routine !== peer) return;
  const dependencies = [propagation.address, advance.address, peer].map((a) => codes.get(a));
  if (dependencies.some((c) => !c)) return;
  const checked = new Map<number, EngineSummary>();
  addGearSummaries(new Map(dependencies.map((c) => [c!.address, c!])), checked, layout);
  const checkedPropagation = checked.get(propagation.address),
    checkedAdvance = checked.get(advance.address);
  if (
    !checkedPropagation ||
    !checkedAdvance ||
    certificate(propagation) !== certificate(checkedPropagation) ||
    certificate(advance) !== certificate(checkedAdvance)
  )
    return;
  const graph = checkedPropagation.partGraph!,
    other = checkedAdvance.partGraph!;
  if (
    !graph.propagation ||
    !other.advancement ||
    graph.links.length !== 4 ||
    graph.links[0] !== binding.get("links") ||
    JSON.stringify(graph.links) !== JSON.stringify(other.links) ||
    JSON.stringify(graph.peer) !== JSON.stringify(other.peer) ||
    graph.objectArguments.join() !== "6,8" ||
    other.objectArguments.join() !== "6" ||
    graph.conflict?.returnRule !== "oneAfterAnyConflictOtherwiseIncoming" ||
    graph.conflict.sourceArgument !== 6 ||
    graph.conflict.targetArgument !== 8 ||
    graph.conflict.modeArgument !== 10 ||
    graph.conflict.accumulatorArgument !== 12 ||
    [graph.peer.connectionField, ...graph.peer.endpointFields].some((offset) => offset < 0 || offset + 2 > 0x10000)
  )
    return;
  const header = code.instructions.find(
    (i) =>
      i.mnemonic === "cmp" &&
      memory(i.operands[0]) &&
      i.operands[0].segment === "ss" &&
      i.operands[0].base.join() === "bp" &&
      i.operands[0].displacement === -2 &&
      i.operands[1]?.kind === "immediate" &&
      i.operands[1].value === 4,
  );
  if (!header || !memory(header.operands[0])) return;
  const latch = code.instructions.find((i) => i.address === header.address + header.size),
    pointer = code.instructions.find(
      (i) =>
        i.mnemonic === "mov" &&
        memory(i.operands[0]) &&
        i.operands[0].segment === "ss" &&
        i.operands[0].base.join() === "bp" &&
        i.operands[0].displacement === -4,
    );
  if (latch?.mnemonic !== "jl" || !latch.target || !pointer || !memory(pointer.operands[0])) return;
  const fields = [...new Map([...graph.fields, ...other.fields].map((f) => [JSON.stringify(f), f])).values()];
  return {
    address: code.address,
    argumentOffset: 6,
    stateField: state.offset,
    deltaField: delta.offset,
    flagsField: flags.offset,
    visitedMask: 64,
    propagation: propagation.address,
    advance: advance.address,
    propagationRelation: graph.propagation,
    advancementRelation: other.advancement,
    links: [...graph.links],
    fields,
    pass: { order: "increasing-slot", count: 4, mode: 2, initialConflict: 0, skipNull: true, skipDisabled: false },
    result: { name: "connectionConflict", width: 16, values: [0, 1], relation: "ordered-gear-propagation" },
    scan: {
      header: header.address,
      latch: latch.address,
      exit: latch.address + latch.size,
      bodyEntry: latch.target.address,
      counter: header.operands[0],
      accumulatorRegister: "di",
      pointerSlot: pointer.operands[0],
      propagationCall: code.calls.find((c) => c.target?.address === propagation.address)!.instruction,
    },
    confidence: "inferred",
    evidence: [
      ...new Map(
        [
          ...code.instructions.map(({ address, bytes, text }) => ({ address, bytes, text })),
          ...checkedPropagation.evidence,
          ...checkedAdvance.evidence,
        ].map((e) => [JSON.stringify(e), e]),
      ).values(),
    ],
    assumptions: [
      ...new Set([
        ...checkedPropagation.assumptions,
        ...checkedAdvance.assumptions,
        "The root's nonzero-movement path marks the owner before folding the four direct contacts in increasing slot order. Null contacts are skipped, but this initial pass does not test the disabled flag. The root peer is not a fifth initial propagation edge.",
        "Each recursive propagation returns its incoming conflict accumulator or one. With an initial accumulator of zero, the completed root pass has exactly the domain zero or one; its value remains a symbolic relation of the complete input graph.",
        "This metadata does not choose a graph or a conflict result. A result reference must be bound to this complete ordered relation and to the invoking owner's pre-pass field and graph versions, not reused as an unconstrained ordinary part field.",
        "After conflict the root clears its movement before advancing. Advance still normalizes raw state 0xffff to three and four to zero when movement is zero; a blanket hold rule is valid only for states other than those two exceptional words.",
      ]),
    ],
  };
}
