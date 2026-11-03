/** Structural descriptions and bounded side-effect summaries of shared engine routines. */
import type { Confidence, Evidence, Expression, Finding, Predicate } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { Instruction, Operand } from "./x86.ts";
import { discoverAngleGate } from "./behaviour-angle-gate.ts";
import { discoverAngleClassifier } from "./behaviour-angle.ts";
import { discoverContactBounds, type ContactBounds } from "./behaviour-contact-bounds.ts";
import { addContactEffectSummaries, type ContactSearch, type ContactObjectWrite } from "./behaviour-contact-effects.ts";
import { discoverContactScalar } from "./behaviour-contact-scalars.ts";
import { addContactSegmentSummaries, type ContactSegmentTest } from "./behaviour-contact-segment.ts";
import { addContactSelection, type ContactSelection } from "./behaviour-contact-selection.ts";
import { addBufferEffectSummaries } from "./behaviour-buffer-effects.ts";
import { discoverConstructorEffects } from "./behaviour-constructor-effects.ts";
import { addGearSummaries } from "./behaviour-gear.ts";
import { addOwnedConstructors } from "./behaviour-owned-constructors.ts";
import { addSuccessfulConstructors } from "./behaviour-successful-constructors.ts";
import { addStatePreservingForwarders } from "./behaviour-forwarders.ts";
import type { GearPropagationRelation, GearAdvanceRelation } from "./behaviour-gear-model.ts";
import type { ListConsumerCall } from "./behaviour-list-calls.ts";
import type { ExternalListConsumer } from "./behaviour-list-consumers.ts";
import { proveOverlapProducer, type OverlapProducer } from "./behaviour-overlap-producer.ts";
import { discoverConnectionBypass, type ConnectionBypass } from "./behaviour-connection-bypass.ts";
import { addNodePoolSummaries } from "./behaviour-node-pools.ts";

export type EnginePointer =
  | { kind: "argument"; argument: number; path: number[]; displacement?: number }
  | { kind: "global"; segment: number; offset: number; path: number[] }
  | { kind: "constant"; value: number }
  | { kind: "fresh"; name: string }
  | { kind: "unknown" };

export interface EngineWrite extends Finding {
  /** A query selects this object independently of the argument's incoming list head. */
  selection?: "overlap-candidate" | "external-list-member";
  separateStorage?: "outline";
  /** BP-relative argument position, accounting for the routine's actual near or far return convention. */
  argumentOffset?: number;
  /** Dereferences from that argument before writing the named field. */
  path: number[];
  offset: number;
  width: number;
  root: "argument" | "global" | "unknown";
  segment?: number;
  value: Expression;
  condition: Predicate;
  repeated?: { stride: number; countField?: number };
}

export interface EngineReturn extends Finding {
  register: "ax" | "dx";
  value: Expression;
  condition: Predicate;
  pointer?: EnginePointer;
}

export interface EngineSummary extends Finding {
  contactBounds?: ContactBounds;
  contactSearch?: ContactSearch;
  globalObjectWrites?: ContactObjectWrite[];
  contactSegment?: ContactSegmentTest;
  contactSelection?: ContactSelection;
  shortCircuit?: ConnectionBypass;
  listConsumer?: ExternalListConsumer;
  listConsumerScope?: ListConsumerCall;
  overlapProducer?: OverlapProducer;
  address: number;
  kind: string;
  purpose: string;
  argumentOffset: number;
  argumentKind: "object" | "scalar" | "unknown";
  writes: EngineWrite[];
  returns: EngineReturn[];
  calls: number[];
  /** A pointer type fact remains useful even when constructor or driver effects remain unresolved. */
  returnPointerClass?: "nullable-fresh";
  returnConvention?: { kind: "near" | "far"; stackBytes: number };
  allocationSize?: number;
  factory?: {
    typeArgument: number;
    constructorTable: { segment: number; offset: number; stride: number; typeCount: number };
    noConstructorTypes: number[];
    constructors?: (Finding & { type: number; address: number })[];
    ownedConstructors?: (Finding & { type: number; address: number })[];
    alwaysSuccessfulConstructors?: (Finding & { type: number; address: number })[];
    noConstructor: Finding & {
      purpose: string;
      footprint: EngineSummary["footprint"];
      writes: EngineWrite[];
      freshFieldsOnly: true;
      initialState?: { offset: number; value: 0 };
    };
  };
  partGraph?: Finding & {
    propagation?: GearPropagationRelation;
    advancement?: GearAdvanceRelation;
    objectArguments: number[];
    fields: { offset: number; width: number }[];
    recursiveCalls: number[];
    links: number[];
    peer: { routine: number; connectionField: number; endpointFields: number[] };
    preservesNonzeroOwnerField?: number;
    conflict?: {
      accumulatorArgument: number;
      sourceArgument: number;
      targetArgument: number;
      modeArgument: number;
      returnRule: "oneAfterAnyConflictOtherwiseIncoming";
      localConditions: Predicate[];
    };
    stateCases?: { condition: Predicate; value: Expression }[];
  };
  numeric?: {
    operation: "leftShift32" | "arithmeticRightShift32";
    width: 32;
    low: "ax";
    high: "dx";
    count: "cl";
    minimumCount: 0;
    maximumCount: 31;
  };
  list?: {
    headField: number;
    nextField: number;
    excludesArgument: boolean;
    confidence: Confidence;
    evidence: Evidence[];
    assumptions: string[];
  };
  footprint: {
    complete: boolean;
    /** Every possible part store is represented, independently of unresolved driver or resource globals. */
    partMemoryComplete?: boolean;
    preservesArgumentMemory: boolean;
    preservesPartState: boolean;
    unknownEffects: string[];
    unknownPartEffects?: string[];
    unknownGlobalEffects?: string[];
  };
}

const evidence = (i: Instruction): Evidence => ({ address: i.address, bytes: i.bytes, text: i.text });
const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
const unknown = (reason: string, width = 16): Expression => ({ kind: "unknown", reason, width });
const field = (object: string, offset: number, width = 16): Expression => ({ kind: "field", object, offset, width });
const isRegister = (operand: Operand | undefined, name?: string): operand is Extract<Operand, { kind: "register" }> =>
  operand?.kind === "register" && (name === undefined || operand.name === name);
const isMemory = (operand: Operand | undefined, base?: string): operand is Extract<Operand, { kind: "memory" }> =>
  operand?.kind === "memory" && (base === undefined || (operand.base.length === 1 && operand.base[0] === base));
const isImmediate = (
  operand: Operand | undefined,
  value?: number,
): operand is Extract<Operand, { kind: "immediate" }> =>
  operand?.kind === "immediate" && (value === undefined || operand.value === value);
const stackMemory = (
  operand: Operand | undefined,
): operand is Extract<Operand, { kind: "memory" }> & { segment: "ss" } =>
  isMemory(operand, "bp") && operand.segment === "ss";
const explicitWrite = (i: Instruction) =>
  isMemory(i.operands[0]) && !["cmp", "test", "push", "call", "jmp", "mul", "imul", "div", "idiv"].includes(i.mnemonic);
const implicitWrite = (i: Instruction) => /^(movs|stos|ins|enter|pusha|popa|int|into|iret|bound|esc)/.test(i.mnemonic);
const firstArgument = (code: RoutineCode) => (code.instructions.some((i) => i.mnemonic === "retf") ? 6 : 4);
const fact = (items: Instruction[], confidence: Confidence = "inferred", assumptions: string[] = []): Finding => ({
  confidence,
  assumptions,
  evidence: items.map(evidence),
});
const truePredicate: Predicate = { kind: "true" };

interface Binding {
  argument: number;
  path: number[];
  displacement: number;
}

/**
 * This is deliberately a syntactic, over-approximating footprint. It describes explicit stores and rejects unknown
 * bases, implicit stores and unverified call effects. It is not a second callback executor or a model of game memory.
 */
function directFootprint(code: RoutineCode, dataSegment: number): { writes: EngineWrite[]; unknownEffects: string[] } {
  const bindings = new Map<string, Binding>();
  const locals = new Map<number, Binding>();
  const changed = new Set<string>();
  const argumentOffset = firstArgument(code);
  const unknownEffects = new Set<string>();
  const writes: EngineWrite[] = [];
  // A register with several definitions is ambiguous unless every definition has the same syntactic source.
  const definitions = new Map<string, string>();
  for (const i of code.instructions) {
    const [dest, source] = i.operands;
    if (!isRegister(dest) || ["cmp", "test", "push", "pop"].includes(i.mnemonic)) continue;
    const key = JSON.stringify([i.mnemonic, source]);
    const previous = definitions.get(dest.name);
    if (previous !== undefined && previous !== key) changed.add(dest.name);
    definitions.set(dest.name, key);
  }
  for (const i of code.instructions) {
    const [dest, source] = i.operands;
    if (i.mnemonic === "mov" && isRegister(dest)) {
      if (stackMemory(source) && source.displacement >= argumentOffset) {
        bindings.set(dest.name, { argument: source.displacement, path: [], displacement: 0 });
      } else if (stackMemory(source) && locals.has(source.displacement)) {
        bindings.set(dest.name, locals.get(source.displacement)!);
      } else if (isRegister(source) && bindings.has(source.name)) {
        bindings.set(dest.name, bindings.get(source.name)!);
      } else if (isMemory(source) && source.base.length === 1 && bindings.has(source.base[0]!)) {
        const parent = bindings.get(source.base[0]!)!;
        bindings.set(dest.name, {
          ...parent,
          path: [...parent.path, parent.displacement + source.displacement],
          displacement: 0,
        });
      } else bindings.delete(dest.name);
    } else if (["add", "sub"].includes(i.mnemonic) && isRegister(dest) && isImmediate(source)) {
      const parent = bindings.get(dest.name);
      if (parent)
        bindings.set(dest.name, {
          ...parent,
          displacement: parent.displacement + (i.mnemonic === "add" ? source.value : -source.value),
        });
    } else if (isRegister(dest) && !["cmp", "test", "push", "pop"].includes(i.mnemonic)) bindings.delete(dest.name);
    if (i.mnemonic === "mov" && stackMemory(dest) && isRegister(source) && bindings.has(source.name))
      locals.set(dest.displacement, bindings.get(source.name)!);
    if (implicitWrite(i))
      unknownEffects.add(
        `Implicit memory effects at 0x${i.address.toString(16)} (${i.mnemonic}) are not bounded by this summary.`,
      );
    if (!explicitWrite(i)) continue;
    const memory = dest as Extract<Operand, { kind: "memory" }>;
    if (stackMemory(memory)) continue;
    const sourceExpression = isImmediate(source)
      ? constant(source.value, memory.width)
      : stackMemory(source) && source.displacement >= argumentOffset
        ? field("argument", source.displacement, memory.width)
        : unknown(`The value stored at 0x${i.address.toString(16)} requires symbolic analysis.`, memory.width);
    let root: EngineWrite["root"] = "unknown";
    let binding: Binding | undefined;
    if (memory.base.length === 1 && memory.segment === "ds") binding = bindings.get(memory.base[0]!);
    if (binding && !changed.has(memory.base[0]!)) root = "argument";
    else if (memory.direct && memory.segment === "ds") root = "global";
    if (root === "unknown")
      unknownEffects.add(
        `The destination of ${i.text} at 0x${i.address.toString(16)} has an ambiguous or indexed base.`,
      );
    writes.push({
      ...fact([i], root === "unknown" ? "unresolved" : "inferred", [
        "The destination is interpreted under the routine's stack convention; branch conditions are retained as unresolved here.",
      ]),
      root,
      ...(root === "argument" ? { argumentOffset: binding!.argument } : {}),
      path: root === "argument" ? binding!.path : [],
      offset: root === "argument" ? binding!.displacement + memory.displacement : memory.displacement,
      ...(root === "global" ? { segment: dataSegment } : {}),
      width: memory.width,
      value: sourceExpression,
      condition: { kind: "unknown", reason: "This footprint retains writes without selecting a control-flow path." },
    });
  }
  return { writes, unknownEffects: [...unknownEffects] };
}

function privateStackSafe(code: RoutineCode): boolean {
  if (code.instructions.some((i) => isRegister(i.operands[0], "ss") && !["cmp", "test", "push"].includes(i.mnemonic)))
    return false;
  const writes = code.instructions.filter((i) => explicitWrite(i) && stackMemory(i.operands[0]));
  if (!writes.length) return true;
  const [first, second] = code.instructions;
  return (
    first?.mnemonic === "push" &&
    isRegister(first.operands[0], "bp") &&
    second?.mnemonic === "mov" &&
    isRegister(second.operands[0], "bp") &&
    isRegister(second.operands[1], "sp") &&
    !code.instructions.some(
      (i) =>
        isRegister(i.operands[0], "bp") &&
        !["cmp", "test", "push", "pop"].includes(i.mnemonic) &&
        i.address !== second.address,
    )
  );
}

/** Leaf code with no explicit, implicit or call-mediated non-stack writes is a complete memory-preserving fact. */
function memoryPreserving(code: RoutineCode): boolean {
  return (
    code.status === "complete" &&
    privateStackSafe(code) &&
    !code.calls.length &&
    !code.instructions.some((i) => implicitWrite(i) || (explicitWrite(i) && !stackMemory(i.operands[0])))
  );
}

function argumentRegister(code: RoutineCode): string | undefined {
  const offset = firstArgument(code);
  const load = code.instructions.find(
    (i) =>
      i.mnemonic === "mov" &&
      isRegister(i.operands[0]) &&
      stackMemory(i.operands[1]) &&
      i.operands[1].displacement === offset,
  );
  return load && isRegister(load.operands[0]) ? load.operands[0].name : undefined;
}

function linkedInsertion(
  code: RoutineCode,
): { owner: string; node: string; offset: number; instructions: Instruction[] } | undefined {
  const instructions = code.instructions;
  for (let n = 0; n + 2 < instructions.length; n++) {
    const [load, link, head] = instructions.slice(n, n + 3) as [Instruction, Instruction, Instruction];
    if (load.address + load.size !== link.address || link.address + link.size !== head.address) continue;
    if (
      load.mnemonic !== "mov" ||
      !isRegister(load.operands[0], "ax") ||
      !isMemory(load.operands[1]) ||
      load.operands[1].base.length !== 1
    )
      continue;
    const owner = load.operands[1].base[0]!;
    const offset = load.operands[1].displacement;
    if (
      link.mnemonic !== "mov" ||
      !isMemory(link.operands[0]) ||
      link.operands[0].base.length !== 1 ||
      !isRegister(link.operands[1], "ax") ||
      link.operands[0].displacement !== offset
    )
      continue;
    const node = link.operands[0].base[0]!;
    if (
      head.mnemonic !== "mov" ||
      !isMemory(head.operands[0], owner) ||
      head.operands[0].displacement !== offset ||
      !isRegister(head.operands[1], node)
    )
      continue;
    if (
      !instructions.some(
        (i) =>
          i.mnemonic === "mov" &&
          isMemory(i.operands[0], owner) &&
          i.operands[0].displacement === offset &&
          isImmediate(i.operands[1], 0),
      )
    )
      continue;
    return { owner, node, offset, instructions: [load, link, head] };
  }
  return undefined;
}

function doublyLinkedSplice(
  code: RoutineCode,
  owner: string,
): { link: number; back: number; stores: Instruction[] } | undefined {
  if (code.status !== "complete" || code.calls.length || code.instructions.some(implicitWrite)) return undefined;
  for (let n = 0; n + 3 < code.instructions.length; n++) {
    const [read, next, previous, insert] = code.instructions.slice(n, n + 4) as [
      Instruction,
      Instruction,
      Instruction,
      Instruction,
    ];
    if ([read, next, previous].some((i, index) => i.address + i.size !== [next, previous, insert][index]!.address))
      continue;
    if (
      read.mnemonic !== "mov" ||
      !isRegister(read.operands[0], "ax") ||
      !isMemory(read.operands[1]) ||
      read.operands[1].base.length !== 1
    )
      continue;
    const node = read.operands[1].base[0]!;
    const link = read.operands[1].displacement;
    if (
      next.mnemonic !== "mov" ||
      !isMemory(next.operands[0], owner) ||
      next.operands[0].displacement !== link ||
      !isRegister(next.operands[1], "ax")
    )
      continue;
    if (
      previous.mnemonic !== "mov" ||
      !isMemory(previous.operands[0], owner) ||
      !isRegister(previous.operands[1], node)
    )
      continue;
    const back = previous.operands[0].displacement;
    if (
      back === link ||
      insert.mnemonic !== "mov" ||
      !isMemory(insert.operands[0], node) ||
      insert.operands[0].displacement !== link ||
      !isRegister(insert.operands[1], owner)
    )
      continue;
    if (
      !code.instructions.some(
        (i) =>
          i.mnemonic === "mov" &&
          isRegister(i.operands[0], node) &&
          isMemory(i.operands[1], node) &&
          i.operands[1].displacement === link,
      ) ||
      !code.edges.some((e) => e.to !== null && e.to < e.from && e.from < read.address)
    )
      continue;
    const stores = code.instructions.filter((i) => explicitWrite(i) && !stackMemory(i.operands[0]));
    if (
      stores.length < 4 ||
      !stores.every(
        (i) =>
          isMemory(i.operands[0]) &&
          i.operands[0].segment === "ds" &&
          i.operands[0].base.length === 1 &&
          i.operands[0].width === 16 &&
          [link, back].includes(i.operands[0].displacement),
      )
    )
      continue;
    return { link, back, stores };
  }
  return undefined;
}

function excludesOwner(code: RoutineCode, owner: string, node: string, insertion: number): Evidence[] | undefined {
  for (const compare of code.instructions) {
    if (
      compare.mnemonic !== "cmp" ||
      !(
        (isRegister(compare.operands[0], owner) && isRegister(compare.operands[1], node)) ||
        (isRegister(compare.operands[0], node) && isRegister(compare.operands[1], owner))
      )
    )
      continue;
    const branch = code.instructions.find((i) => i.address === compare.address + compare.size);
    if (!branch || !["je", "jne"].includes(branch.mnemonic)) continue;
    const edge = code.edges.find(
      (e) => e.from === branch.address && e.kind === (branch.mnemonic === "je" ? "taken" : "not-taken"),
    );
    if (edge?.to === null || edge?.to === undefined) continue;
    const advance = [...code.calls].sort((a, b) => a.instruction - b.instruction).at(-1)?.instruction;
    const pending = [edge.to];
    const visited = new Set<number>();
    const proof: Evidence[] = [evidence(compare), evidence(branch)];
    let reachedInsertion = false;
    while (pending.length) {
      const at = pending.pop()!;
      if (at === insertion) {
        reachedInsertion = true;
        break;
      }
      if (visited.has(at)) continue;
      visited.add(at);
      const instruction = code.instructions.find((i) => i.address === at);
      if (!instruction) {
        reachedInsertion = true;
        break;
      }
      proof.push(evidence(instruction));
      if (at === advance || instruction.flow === "return") continue;
      pending.push(...code.edges.filter((e) => e.from === at && e.to !== null).map((e) => e.to!));
    }
    if (!reachedInsertion) return proof;
  }
  return undefined;
}

interface ReturnValue {
  expression: Expression;
  pointer?: EnginePointer;
}
interface ReturnPath {
  at: number;
  values: Map<string, ReturnValue>;
  conditions: Predicate[];
  visited: Set<number>;
}
const wordRegister: Record<string, string> = {
  al: "ax",
  ah: "ax",
  bl: "bx",
  bh: "bx",
  cl: "cx",
  ch: "cx",
  dl: "dx",
  dh: "dx",
};
const combine = (operator: string, left: Expression, right: Expression, width = left.width): Expression => ({
  kind: "binary",
  operator,
  left,
  right,
  width,
});
const conjunction = (terms: Predicate[]): Predicate => (terms.length ? { kind: "and", terms } : truePredicate);

/** Retains return alternatives of small read-only helpers as expressions, never choosing one with a fabricated object. */
function readonlyReturns(
  code: RoutineCode,
  summaries: Map<number, EngineSummary>,
  dataSegment: number,
): EngineReturn[] {
  if (code.instructions.length > 80) return [];
  const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  const pending: ReturnPath[] = [{ at: code.address, values: new Map(), conditions: [], visited: new Set() }];
  const result: EngineReturn[] = [];
  const argumentOffset = firstArgument(code);
  let budget = 800;
  const read = (operand: Operand | undefined, values: ReturnPath["values"]): ReturnValue => {
    if (isImmediate(operand))
      return {
        expression: constant(operand.value, operand.width),
        pointer: { kind: "constant", value: operand.value },
      };
    if (isRegister(operand))
      return (
        values.get(operand.name) ?? { expression: unknown(`Register ${operand.name} is unresolved.`, operand.width) }
      );
    if (!isMemory(operand)) return { expression: unknown("The return operand is unresolved.") };
    if (stackMemory(operand) && operand.displacement >= argumentOffset)
      return {
        expression: field("argument", operand.displacement, operand.width),
        pointer: { kind: "argument", argument: operand.displacement, path: [] },
      };
    if (operand.direct && operand.segment === "ds")
      return {
        expression: field("data", operand.displacement, operand.width),
        pointer: { kind: "global", segment: dataSegment, offset: operand.displacement, path: [] },
      };
    if (operand.base.length === 1 && operand.segment === "ds") {
      const pointer = values.get(operand.base[0]!)?.pointer;
      if (pointer?.kind === "argument")
        return {
          expression: field(
            pointer.argument === argumentOffset && !pointer.path.length
              ? "part"
              : `argument:${pointer.argument}:${pointer.path.join("/")}`,
            (pointer.displacement ?? 0) + operand.displacement,
            operand.width,
          ),
          pointer: {
            ...pointer,
            path: [...pointer.path, (pointer.displacement ?? 0) + operand.displacement],
            displacement: 0,
          },
        };
    }
    return { expression: unknown("An indexed or aliased return load is unresolved.", operand.width) };
  };
  while (pending.length && budget-- > 0) {
    const path = pending.pop()!;
    if (path.visited.has(path.at)) continue;
    const i = byAddress.get(path.at);
    if (!i) continue;
    path.visited.add(path.at);
    const [dest, source] = i.operands;
    if (i.mnemonic === "mov" && isRegister(dest)) {
      path.values.set(dest.name, read(source, path.values));
      if (wordRegister[dest.name]) path.values.delete(wordRegister[dest.name]!);
    } else if (["or", "and", "xor", "add", "sub"].includes(i.mnemonic) && isRegister(dest)) {
      const a = read(dest, path.values);
      const b = read(source, path.values);
      const operator = ({ or: "|", and: "&", xor: "^", add: "+", sub: "-" } as Record<string, string>)[i.mnemonic]!;
      path.values.set(
        dest.name,
        i.mnemonic === "xor" && isRegister(source, dest.name)
          ? { expression: constant(0), pointer: { kind: "constant", value: 0 } }
          : { expression: combine(operator, a.expression, b.expression, dest.width) },
      );
    } else if (i.flow === "call") {
      const call = code.calls.find((c) => c.instruction === i.address);
      const callee = call?.target && summaries.get(call.target.address);
      path.values.set("ax", {
        expression: unknown(
          `The result of helper 0x${call?.target?.address.toString(16) ?? "unknown"} depends on its own predicates.`,
        ),
        ...(callee?.kind === "list-head" || callee?.kind === "list-next"
          ? { pointer: { kind: "fresh", name: "list node selected by the helper" } as EnginePointer }
          : {}),
      });
    } else if (isRegister(dest) && !["cmp", "test", "push", "pop", "shl"].includes(i.mnemonic) && i.flow === "next")
      path.values.delete(dest.name);
    if (i.flow === "return") {
      const value = path.values.get("ax") ?? { expression: unknown("The helper does not establish AX.") };
      result.push({
        ...fact(code.instructions, value.expression.kind === "unknown" ? "unresolved" : "inferred", [
          "Each return alternative retains the branch predicates and the routine's calling convention.",
        ]),
        register: "ax",
        value: value.expression,
        condition: conjunction(path.conditions),
        ...(value.pointer ? { pointer: value.pointer } : {}),
      });
      continue;
    }
    const outgoing = code.edges.filter((e) => e.from === i.address && e.to !== null);
    for (const edge of outgoing) {
      const conditions = [...path.conditions];
      if (i.flow === "branch") {
        const previous = code.instructions.find((p) => p.address + p.size === i.address);
        const operators: Record<string, string> = {
          je: "==",
          jne: "!=",
          jl: "<",
          jge: ">=",
          jle: "<=",
          jg: ">",
          jb: "<",
          jae: ">=",
          ja: ">",
          jbe: "<=",
        };
        let operator = operators[i.mnemonic];
        if (operator && previous && ["cmp", "test", "or"].includes(previous.mnemonic)) {
          const a = read(previous.operands[0], path.values).expression;
          const b = read(previous.operands[1], path.values).expression;
          const left = previous.mnemonic === "cmp" ? a : previous.mnemonic === "test" ? combine("&", a, b) : a;
          const right = previous.mnemonic === "cmp" ? b : constant(0);
          if (edge.kind === "not-taken")
            operator = (
              { "==": "!=", "!=": "==", "<": ">=", ">=": "<", "<=": ">", ">": "<=" } as Record<string, string>
            )[operator]!;
          conditions.push({
            kind: "compare",
            operator,
            left,
            right,
            signed: ["jl", "jge", "jle", "jg"].includes(i.mnemonic),
          });
        } else
          conditions.push({ kind: "unknown", reason: `The predicate at 0x${i.address.toString(16)} is unresolved.` });
      }
      pending.push({ at: edge.to!, values: new Map(path.values), conditions, visited: new Set(path.visited) });
    }
  }
  if (pending.length) return [];
  return result;
}

function wideShift(code: RoutineCode): EngineSummary["numeric"] | undefined {
  const i = code.instructions;
  if (
    code.status !== "complete" ||
    i.length !== 15 ||
    code.calls.length ||
    i[0]!.mnemonic !== "cmp" ||
    !isRegister(i[0]!.operands[0], "cl") ||
    !isImmediate(i[0]!.operands[1], 16) ||
    i[1]!.mnemonic !== "jae" ||
    i[1]!.target?.address !== i[10]!.address
  )
    return undefined;
  if (
    ![...i.slice(0, 9), ...i.slice(10, 14)].every((instruction) =>
      i.some((next) => next.address === instruction.address + instruction.size),
    )
  )
    return undefined;
  const operation =
    i[3]!.mnemonic === "shl" ? "leftShift32" : i[3]!.mnemonic === "shr" ? "arithmeticRightShift32" : undefined;
  if (!operation) return undefined;
  const left = operation === "leftShift32";
  const matches = (n: number, mnemonic: string, dest?: string, source?: string | number) =>
    i[n]!.mnemonic === mnemonic &&
    (dest === undefined || isRegister(i[n]!.operands[0], dest)) &&
    (source === undefined ||
      (typeof source === "number" ? isImmediate(i[n]!.operands[1], source) : isRegister(i[n]!.operands[1], source)));
  if (
    !matches(2, "mov", "bx", left ? "ax" : "dx") ||
    !matches(3, left ? "shl" : "shr", "ax", "cl") ||
    !matches(4, left ? "shl" : "sar", "dx", "cl") ||
    !matches(5, "neg", "cl") ||
    !matches(6, "add", "cl", 16) ||
    !matches(7, left ? "shr" : "shl", "bx", "cl") ||
    !matches(8, "or", left ? "dx" : "ax", "bx") ||
    !matches(9, "retf") ||
    !matches(10, "sub", "cl", 16) ||
    !matches(11, "xchg", "ax", "dx") ||
    !(left ? matches(12, "xor", "ax", "ax") : matches(12, "cwd")) ||
    !matches(13, left ? "shl" : "sar", left ? "dx" : "ax", "cl") ||
    !matches(14, "retf")
  )
    return undefined;
  return { operation, width: 32, low: "ax", high: "dx", count: "cl", minimumCount: 0, maximumCount: 31 };
}

function ownerPurpose(offsets: number[], layout: BehaviourLayout | undefined, preservesState: boolean): string {
  const names: Record<string, string> = {
    type: "the type number",
    state: "the state",
    previousState: "the state snapshot",
    olderState: "the older state snapshot",
    stateDelta: "the control value",
    drawingFlags: "drawing flags",
    horizontalExtent: "horizontal extent",
    verticalExtent: "vertical extent",
    frameWidth: "frame width",
    frameHeight: "frame height",
    drawX: "horizontal drawing position",
    drawY: "vertical drawing position",
    positionX: "horizontal position",
    positionY: "vertical position",
    velocityX: "horizontal velocity",
    velocityY: "vertical velocity",
    contextCounter: "a counter",
    baseWidth: "base width",
    baseHeight: "base height",
  };
  const selected = offsets.map((offset) => layout?.fields.find((f) => f.offset === offset && names[f.name]));
  if (selected.some((f) => !f)) return "Updates object fields whose meaning is not established.";
  const keys = selected.map((f) => f!.name);
  let labels = keys.map((key) => names[key]!);
  for (const [a, b, label] of [
    ["velocityX", "velocityY", "horizontal and vertical velocity"],
    ["positionX", "positionY", "position"],
    ["drawX", "drawY", "drawing position"],
    ["frameWidth", "frameHeight", "frame dimensions"],
    ["horizontalExtent", "verticalExtent", "size"],
  ]) {
    if (keys.includes(a!) && keys.includes(b!))
      labels = labels.filter((name) => name !== names[a!] && name !== names[b!]).concat(label!);
  }
  const subject = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0];
  return `Updates ${subject}${preservesState ? " while preserving the state" : ""}.`;
}

function fillsBytes(code: RoutineCode): boolean {
  return (
    code.status === "complete" &&
    code.calls.length === 0 &&
    code.instructions.some((i) => i.mnemonic === "stosb") &&
    code.instructions.some((i) => i.mnemonic === "stosw" && i.prefixes.includes("rep")) &&
    code.instructions.some(
      (i) => i.mnemonic === "mov" && isRegister(i.operands[0], "di") && stackMemory(i.operands[1]),
    ) &&
    code.instructions.some((i) => i.mnemonic === "mov" && isRegister(i.operands[0], "cx") && stackMemory(i.operands[1]))
  );
}

/** Recognizes aligned free-list allocation and the payload address returned after its block header. */
function heapBlockAllocator(code: RoutineCode): boolean {
  if (code.status !== "complete" || code.instructions.length > 160) return false;
  const aligned = code.instructions.some(
    (i) => i.mnemonic === "and" && isRegister(i.operands[0], "ax") && isImmediate(i.operands[1], 0xfffe),
  );
  const allocated = code.instructions.some(
    (i) => i.mnemonic === "inc" && isMemory(i.operands[0], "bx") && i.operands[0].displacement === 0,
  );
  const linked = code.instructions.some(
    (i) =>
      i.mnemonic === "mov" &&
      isRegister(i.operands[0], "bx") &&
      isMemory(i.operands[1], "bx") &&
      i.operands[1].displacement > 0,
  );
  const payload = code.instructions.some(
    (i, index) =>
      i.mnemonic === "mov" &&
      isRegister(i.operands[0], "ax") &&
      isRegister(i.operands[1], "bx") &&
      code.instructions[index + 1]?.mnemonic === "add" &&
      isRegister(code.instructions[index + 1]?.operands[0], "ax") &&
      isImmediate(code.instructions[index + 1]?.operands[1]) &&
      (code.instructions[index + 1]!.operands[1] as Extract<Operand, { kind: "immediate" }>).value > 0,
  );
  return aligned && allocated && linked && payload;
}

function allocationSummary(code: RoutineCode, kind: string, purpose: string, extra: Instruction[]): EngineSummary {
  const returns: EngineReturn[] = [
    {
      ...fact(code.instructions, "inferred", [
        "A nonzero payload is owned by this allocation and remains live on the successful return path.",
      ]),
      register: "ax",
      value: unknown("The allocation's address is determined by the heap, not by static input constants."),
      condition: { kind: "unknown", reason: "The allocation and any construction steps succeeded." },
      pointer: { kind: "fresh", name: "newly allocated part or buffer" },
    },
    {
      ...fact(code.instructions, "checked"),
      register: "ax",
      value: constant(0),
      condition: { kind: "unknown", reason: "Allocation failed, overflowed, or construction rejected the object." },
      pointer: { kind: "constant", value: 0 },
    },
  ];
  return {
    ...fact([...code.instructions, ...extra], "inferred", [
      "The aligned free-list allocation contract returns storage distinct from other live objects; an initialized object's constructor does not free its storage on the successful return path.",
    ]),
    address: code.address,
    kind,
    purpose,
    argumentOffset: firstArgument(code),
    argumentKind: "scalar",
    calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
    writes: [],
    returns,
    returnPointerClass: "nullable-fresh",
    footprint: {
      complete: false,
      preservesArgumentMemory: false,
      preservesPartState: false,
      unknownEffects: [
        "Heap metadata, allocation failure paths and any constructor effects retain their separate unresolved footprints.",
      ],
      unknownPartEffects: ["Constructor or allocation backend aliases to existing parts have not been excluded."],
      unknownGlobalEffects: ["Heap metadata and resource or constructor globals can change."],
    },
  };
}

/** Proves that the callee's null-argument path performs no dereference, store or nested call. */
function nullCleanupProof(code: RoutineCode): Evidence[] | undefined {
  if (code.status !== "complete") return undefined;
  const argument = argumentRegister(code);
  if (!argument) return undefined;
  const test = code.instructions.find(
    (i) =>
      (i.mnemonic === "or" && isRegister(i.operands[0], argument) && isRegister(i.operands[1], argument)) ||
      (i.mnemonic === "cmp" && isRegister(i.operands[0], argument) && isImmediate(i.operands[1], 0)),
  );
  const branch = test && code.instructions.find((i) => i.address === test.address + test.size);
  if (!test || !branch || !["je", "jne"].includes(branch.mnemonic)) return undefined;
  const zero = code.edges.find(
    (e) => e.from === branch.address && e.kind === (branch.mnemonic === "je" ? "taken" : "not-taken"),
  )?.to;
  if (zero === null || zero === undefined) return undefined;
  const prefix = code.instructions.filter((i) => i.address <= branch.address);
  if (
    prefix.some(
      (i) =>
        i.flow === "call" ||
        (i.flow === "branch" && i.address !== branch.address) ||
        i.flow === "jump" ||
        implicitWrite(i) ||
        i.operands.some((o) => isMemory(o) && !stackMemory(o)),
    )
  )
    return undefined;
  const pending = [zero];
  const visited = new Set<number>();
  const proof = prefix.map(evidence);
  while (pending.length) {
    const at = pending.pop()!;
    if (visited.has(at)) continue;
    visited.add(at);
    const instruction = code.instructions.find((i) => i.address === at);
    if (
      !instruction ||
      instruction.flow === "call" ||
      implicitWrite(instruction) ||
      instruction.operands.some((o) => isMemory(o) && !stackMemory(o))
    )
      return undefined;
    proof.push(evidence(instruction));
    if (instruction.flow === "return") continue;
    const edges = code.edges.filter((e) => e.from === at && e.to !== null);
    if (!edges.length) return undefined;
    pending.push(...edges.map((e) => e.to!));
  }
  return proof;
}

/** The proof tracks nullness, a private error flag and certified constructor results; it never supplies or runs an object. */
export function specializeNullConstructor(
  image: Uint8Array,
  code: RoutineCode,
  summary: EngineSummary,
  codes: Map<number, RoutineCode>,
  summaries: Map<number, EngineSummary>,
  table: number | undefined,
  dataSegment: number,
  typeCount: number | undefined,
  stateOffset: number | undefined,
  owned?: Finding & { cleanupAddress: number; resultBranch: number },
): EngineSummary["factory"] | undefined {
  if (
    table === undefined ||
    !Number.isInteger(typeCount) ||
    typeCount! <= 0 ||
    typeCount! > 512 ||
    table + typeCount! * 58 > image.length ||
    summary.allocationSize === undefined ||
    !privateStackSafe(code)
  )
    return undefined;
  const input = argumentRegister(code);
  const constructor = code.calls.filter((c) => c.operand?.kind === "memory" && !c.operand.direct);
  if (!input || constructor.length !== 1) return undefined;
  const constructorCall = constructor[0]!;
  const operand = constructorCall.operand;
  if (!isMemory(operand, "bx") || operand.segment !== "ds" || !constructorCall.far || operand.width !== 32)
    return undefined;
  const previous = new Map(code.instructions.map((i) => [i.address + i.size, i]));
  const dominates = (definition: number, target: number): boolean => {
    const todo = [code.address],
      seen = new Set<number>();
    while (todo.length) {
      const at = todo.pop()!;
      if (at === definition || seen.has(at)) continue;
      if (at === target) return false;
      seen.add(at);
      todo.push(...code.edges.filter((e) => e.from === at && e.to !== null).map((e) => e.to!));
    }
    return true;
  };
  const inputLoad = code.instructions.find(
    (i) =>
      i.mnemonic === "mov" &&
      isRegister(i.operands[0], input) &&
      stackMemory(i.operands[1]) &&
      i.operands[1].displacement === firstArgument(code),
  );
  if (
    !inputLoad ||
    !dominates(inputLoad.address, constructorCall.instruction) ||
    code.instructions.some(
      (i) =>
        isRegister(i.operands[0], input) &&
        !["pop", "push", "cmp", "test"].includes(i.mnemonic) &&
        !(i.mnemonic === "mov" && stackMemory(i.operands[1]) && i.operands[1].displacement === firstArgument(code)),
    )
  )
    return undefined;
  const indexAt = (at: number): { shift: Instruction; count: number } | undefined => {
    const shift = previous.get(at);
    if (shift?.mnemonic !== "shl" || !isRegister(shift.operands[0], "bx")) return undefined;
    let baseLoad = previous.get(shift.address);
    let count: number;
    if (isImmediate(shift.operands[1])) count = shift.operands[1].value;
    else if (isRegister(shift.operands[1], "cl")) {
      const loaded = code.instructions
        .filter(
          (i) =>
            i.address < shift.address &&
            i.mnemonic === "mov" &&
            isRegister(i.operands[0], "cl") &&
            isImmediate(i.operands[1]),
        )
        .at(-1);
      if (!loaded || !isImmediate(loaded.operands[1])) return undefined;
      count = loaded.operands[1].value;
      if (!dominates(loaded.address, shift.address)) return undefined;
      if (baseLoad?.address === loaded.address) baseLoad = previous.get(baseLoad.address);
      if (
        code.instructions.some(
          (i) =>
            i.address > loaded.address &&
            i.address < at &&
            (((isRegister(i.operands[0], "cl") || isRegister(i.operands[0], "cx")) &&
              !["cmp", "test", "push"].includes(i.mnemonic)) ||
              i.flow === "call"),
        )
      )
        return undefined;
    } else return undefined;
    if (
      baseLoad?.mnemonic !== "mov" ||
      !isRegister(baseLoad.operands[0], "bx") ||
      !isRegister(baseLoad.operands[1], input) ||
      count < 2 ||
      count > 8
    )
      return undefined;
    if (!dominates(baseLoad.address, shift.address)) return undefined;
    return { shift, count };
  };
  const constructorIndex = indexAt(constructorCall.instruction);
  if (!constructorIndex) return undefined;
  const stride = 2 ** constructorIndex.count;
  const base = operand.displacement;
  if (
    base < 0 ||
    base + (typeCount! - 1) * stride + 4 > 0x10000 ||
    dataSegment * 16 + base + (typeCount! - 1) * stride + 4 > image.length
  )
    return undefined;
  const pointerOr = code.instructions.find(
    (i) =>
      i.address < constructorCall.instruction &&
      i.mnemonic === "or" &&
      isRegister(i.operands[0], "ax") &&
      isMemory(i.operands[1], "bx") &&
      i.operands[1].segment === "ds" &&
      i.operands[1].displacement === base + 2,
  );
  const pointerLoad = pointerOr && previous.get(pointerOr.address);
  const zeroBranch = pointerOr && code.instructions.find((i) => i.address === pointerOr.address + pointerOr.size);
  if (
    !pointerOr ||
    pointerLoad?.mnemonic !== "mov" ||
    !isRegister(pointerLoad.operands[0], "ax") ||
    !isMemory(pointerLoad.operands[1], "bx") ||
    pointerLoad.operands[1].segment !== "ds" ||
    pointerLoad.operands[1].displacement !== base ||
    zeroBranch?.mnemonic !== "je" ||
    !zeroBranch.target
  )
    return undefined;
  const guardIndex = indexAt(pointerLoad.address);
  if (!guardIndex || guardIndex.count !== constructorIndex.count) return undefined;
  if (
    !dominates(pointerLoad.address, pointerOr.address) ||
    !dominates(pointerOr.address, zeroBranch.address) ||
    !dominates(guardIndex.shift.address, pointerLoad.address)
  )
    return undefined;
  const allocation = code.calls.find(
    (c) => c.target && summaries.get(c.target.address)?.kind === "nullable-allocation",
  );
  if (!allocation?.target) return undefined;
  const copy = code.instructions.find(
    (i) =>
      i.address > allocation.instruction &&
      i.address < allocation.instruction + 16 &&
      i.mnemonic === "mov" &&
      isRegister(i.operands[0]) &&
      isRegister(i.operands[1], "ax"),
  );
  const object = copy && isRegister(copy.operands[0]) ? copy.operands[0].name : undefined;
  const nullTest =
    copy &&
    code.instructions.find(
      (i) =>
        i.address >= copy.address &&
        i.address < copy.address + 10 &&
        i.mnemonic === "or" &&
        isRegister(i.operands[0], "ax") &&
        isRegister(i.operands[1], "ax"),
    );
  const nullBranch = nullTest && code.instructions.find((i) => i.address === nullTest.address + nullTest.size);
  if (!copy || !object || !nullTest || !nullBranch || !["je", "jne"].includes(nullBranch.mnemonic)) return undefined;
  if (
    !dominates(allocation.instruction, copy.address) ||
    !dominates(copy.address, nullTest.address) ||
    !dominates(nullTest.address, nullBranch.address) ||
    code.instructions.some(
      (i) =>
        i.address > allocation.instruction &&
        i.address < nullTest.address &&
        i.address !== copy.address &&
        i.mnemonic !== "nop" &&
        !(i.mnemonic === "pop" && isRegister(i.operands[0], "cx")),
    )
  )
    return undefined;
  if (
    code.instructions.some(
      (i) =>
        isRegister(i.operands[0], object) &&
        !["push", "pop", "cmp", "test"].includes(i.mnemonic) &&
        i.address !== copy.address,
    )
  )
    return undefined;
  // Saved-register restores belong to the epilogue. A restore followed by another
  // pointer or type use would invalidate the stable input and fresh-object roots.
  for (const register of new Set([input, object])) {
    for (const restored of code.instructions.filter(
      (i) => i.mnemonic === "pop" && isRegister(i.operands[0], register),
    )) {
      const pending = code.edges.filter((e) => e.from === restored.address && e.to !== null).map((e) => e.to!);
      const seen = new Set<number>();
      while (pending.length) {
        const at = pending.pop()!;
        if (seen.has(at)) continue;
        seen.add(at);
        const use = code.instructions.find((i) => i.address === at);
        if (use?.operands.some((o) => isRegister(o, register) || (o.kind === "memory" && o.base.includes(register))))
          return undefined;
        pending.push(...code.edges.filter((e) => e.from === at && e.to !== null).map((e) => e.to!));
      }
    }
  }
  let lastArgument = previous.get(allocation.instruction);
  if (lastArgument?.mnemonic === "push" && isRegister(lastArgument.operands[0], "cs"))
    lastArgument = previous.get(lastArgument.address);
  while (lastArgument?.mnemonic === "nop") lastArgument = previous.get(lastArgument.address);
  const count = lastArgument && previous.get(lastArgument.address),
    sizePush = count && previous.get(count.address),
    size = sizePush && previous.get(sizePush.address);
  if (
    lastArgument?.mnemonic !== "push" ||
    !isRegister(lastArgument.operands[0], "ax") ||
    count?.mnemonic !== "mov" ||
    !isRegister(count.operands[0], "ax") ||
    !isImmediate(count.operands[1], 1) ||
    sizePush?.mnemonic !== "push" ||
    !isRegister(sizePush.operands[0], "ax") ||
    size?.mnemonic !== "mov" ||
    !isRegister(size.operands[0], "ax") ||
    !isImmediate(size.operands[1], summary.allocationSize)
  )
    return undefined;
  const flag = code.instructions.find(
    (i) =>
      i.address < allocation.instruction &&
      i.mnemonic === "mov" &&
      stackMemory(i.operands[0]) &&
      i.operands[0].width === 16 &&
      i.operands[0].displacement < 0 &&
      isImmediate(i.operands[1], 0),
  );
  const flagOperand = flag?.operands[0];
  if (!flag || !stackMemory(flagOperand)) return undefined;
  const flagTests = code.instructions.filter(
    (i) =>
      i.mnemonic === "cmp" &&
      JSON.stringify(i.operands[0]) === JSON.stringify(flagOperand) &&
      isImmediate(i.operands[1], 0),
  );
  if (flagTests.length !== 1) return undefined;
  const flagBranch = code.instructions.find((i) => i.address === flagTests[0]!.address + flagTests[0]!.size);
  if (!flagBranch || !["je", "jne"].includes(flagBranch.mnemonic)) return undefined;
  const allocationClosure: RoutineCode[] = [],
    pendingCalls = [allocation.target],
    callSeen = new Set<number>();
  while (pendingCalls.length && allocationClosure.length < 64) {
    const target = pendingCalls.pop()!;
    if (callSeen.has(target.address)) continue;
    callSeen.add(target.address);
    const allocated = codes.get(target.address);
    if (
      !allocated ||
      allocated.status !== "complete" ||
      allocated.calls.some((c) => !c.target || c.confidence !== "checked") ||
      allocated.instructions.some((i) => ["int", "into", "iret"].includes(i.mnemonic))
    )
      return undefined;
    allocationClosure.push(allocated);
    pendingCalls.push(...allocated.calls.map((c) => c.target!));
  }
  if (pendingCalls.length) return undefined;
  const outgoing = new Map<number, { to: number | null; kind: string }[]>();
  for (const edge of code.edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  const instructions = new Map(code.instructions.map((i) => [i.address, i]));
  const todo: { at: number; error?: 0 | 1; nullObject?: boolean; constructorResult?: 0 | 1 }[] = [{ at: code.address }];
  const visited = new Set<string>(),
    proof: Evidence[] = [],
    assumptions = new Set<string>([
      "The initialization table retains its loaded far-pointer values and the caller supplies an in-range type from the checked type table.",
      "The aligned allocator's block headers and free-list metadata are separate from live payloads and immutable type tables; its zero fill affects only the newly allocated payload.",
      "Successful calls follow the decoded C register and stack convention. Heap validation can prevent return on a malformed heap, but it does not dispatch game callbacks or write existing parts.",
    ]);
  let budget = 1024;
  let stateChanged = !!owned;
  if (owned) {
    proof.push(...owned.evidence);
    for (const assumption of owned.assumptions) assumptions.add(assumption);
  }
  while (todo.length && budget-- > 0) {
    const path = todo.pop()!,
      key = `${path.at}:${path.error}:${path.nullObject}:${path.constructorResult}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const instruction = instructions.get(path.at);
    if (
      !instruction ||
      implicitWrite(instruction) ||
      instruction.mnemonic === "lds" ||
      (isRegister(instruction.operands[0], "ds") && !["push", "cmp", "test"].includes(instruction.mnemonic))
    )
      return undefined;
    proof.push(evidence(instruction));
    if (explicitWrite(instruction)) {
      const dest = instruction.operands[0] as Extract<Operand, { kind: "memory" }>;
      if (stackMemory(dest)) {
        if (
          dest.displacement < flagOperand.displacement + 2 &&
          flagOperand.displacement < dest.displacement + dest.width / 8
        ) {
          if (
            instruction.mnemonic !== "mov" ||
            dest.displacement !== flagOperand.displacement ||
            dest.width !== 16 ||
            !isImmediate(instruction.operands[1]) ||
            ![0, 1].includes(instruction.operands[1].value)
          )
            return undefined;
          path.error = instruction.operands[1].value as 0 | 1;
        }
      } else if (
        !isMemory(dest, object) ||
        dest.segment !== "ds" ||
        dest.displacement < 0 ||
        dest.displacement + dest.width / 8 > summary.allocationSize ||
        path.nullObject !== false
      )
        return undefined;
    }
    if (
      explicitWrite(instruction) &&
      isMemory(instruction.operands[0], object) &&
      stateOffset !== undefined &&
      instruction.operands[0].displacement < stateOffset + 2 &&
      stateOffset < instruction.operands[0].displacement + instruction.operands[0].width / 8
    )
      stateChanged = true;
    if (instruction.flow === "call") {
      const call = code.calls.find((c) => c.instruction === instruction.address)!;
      if (instruction.address === constructorCall.instruction) {
        if (!owned || path.nullObject !== false) return undefined;
        const continuations = outgoing.get(instruction.address) ?? [];
        if (continuations.length !== 1 || continuations[0]!.kind !== "next" || continuations[0]!.to === null)
          return undefined;
        for (const constructorResult of [0, 1] as const)
          todo.push({ ...path, at: continuations[0]!.to!, constructorResult });
        continue;
      }
      if (instruction.address !== allocation.instruction) {
        const callee = call.target && summaries.get(call.target.address),
          calleeCode = call.target && codes.get(call.target.address);
        let pushed = previous.get(instruction.address);
        if (pushed?.mnemonic === "push" && isRegister(pushed.operands[0], "cs")) pushed = previous.get(pushed.address);
        while (pushed?.mnemonic === "nop") pushed = previous.get(pushed.address);
        if (
          callee?.footprint.complete &&
          callee.footprint.preservesArgumentMemory &&
          callee.footprint.preservesPartState
        ) {
          for (const assumption of callee.assumptions) assumptions.add(assumption);
          proof.push(...callee.evidence);
        } else if (
          callee?.footprint.complete &&
          callee.footprint.partMemoryComplete &&
          calleeCode &&
          path.nullObject === false &&
          pushed?.mnemonic === "push" &&
          isRegister(pushed.operands[0], object) &&
          callee.writes.every(
            (w) =>
              w.root === "argument" &&
              w.argumentOffset === callee.argumentOffset &&
              !w.path.length &&
              w.offset >= 0 &&
              w.offset + w.width / 8 <= summary.allocationSize!,
          )
        ) {
          if (
            stateOffset !== undefined &&
            callee.writes.some((w) => w.offset < stateOffset + 2 && stateOffset < w.offset + w.width / 8)
          )
            stateChanged = true;
          for (const assumption of callee.assumptions) assumptions.add(assumption);
          proof.push(...callee.evidence);
        } else if (
          owned &&
          calleeCode?.address === owned.cleanupAddress &&
          path.nullObject === false &&
          path.error === 1 &&
          path.constructorResult === 1 &&
          pushed?.mnemonic === "push" &&
          isRegister(pushed.operands[0], object)
        ) {
          proof.push(...owned.evidence);
        } else if (
          calleeCode &&
          path.nullObject === true &&
          pushed?.mnemonic === "push" &&
          isRegister(pushed.operands[0], object)
        ) {
          const inert = nullCleanupProof(calleeCode);
          if (!inert) return undefined;
          proof.push(...inert);
        } else return undefined;
      }
    }
    if (instruction.flow === "return") continue;
    let edges = outgoing.get(instruction.address) ?? [];
    if (instruction.address === zeroBranch.address && !owned) edges = edges.filter((e) => e.kind === "taken");
    if (owned && instruction.address === owned.resultBranch && path.constructorResult !== undefined)
      edges = edges.filter((e) => e.kind === (path.constructorResult === 0 ? "taken" : "not-taken"));
    if (instruction.address === flagBranch.address && path.error !== undefined)
      edges = edges.filter(
        (e) => e.kind === ((path.error === 0) === (flagBranch.mnemonic === "je") ? "taken" : "not-taken"),
      );
    for (const edge of edges) {
      if (edge.to === null) return undefined;
      const next = { ...path, at: edge.to };
      if (instruction.address === nullBranch.address)
        next.nullObject = (edge.kind === "taken") === (nullBranch.mnemonic === "je");
      todo.push(next);
    }
  }
  if (todo.length) return undefined;
  const noConstructorTypes: number[] = [],
    pointerEvidence: Evidence[] = [];
  for (let type = 0; type < typeCount!; type++) {
    const at = dataSegment * 16 + base + type * stride;
    if (image.subarray(at, at + 4).every((byte) => byte === 0)) {
      noConstructorTypes.push(type);
      pointerEvidence.push({
        address: at,
        bytes: Array.from(image.subarray(at, at + 4)),
        text: `Initial far constructor pointer for type ${type}: 0:0`,
      });
    }
  }
  if (!noConstructorTypes.length) return undefined;
  proof.push(...allocationClosure.flatMap((c) => c.instructions.map(evidence)), ...pointerEvidence);
  const stateUntouched =
    !stateChanged &&
    stateOffset !== undefined &&
    summary.allocationSize >= stateOffset + 2 &&
    !summary.writes.some((w) => w.offset < stateOffset + 2 && stateOffset < w.offset + w.width / 8);
  return {
    typeArgument: summary.argumentOffset,
    constructorTable: { segment: dataSegment, offset: base, stride, typeCount: typeCount! },
    noConstructorTypes,
    noConstructor: {
      purpose: "Allocates and initializes a new part without invoking a type constructor, preserving existing parts.",
      confidence: "inferred",
      assumptions: [...assumptions],
      evidence: [...new Map(proof.map((e) => [e.address, e])).values()],
      writes: summary.writes,
      freshFieldsOnly: true,
      ...(stateUntouched ? { initialState: { offset: stateOffset, value: 0 as const } } : {}),
      footprint: {
        complete: false,
        partMemoryComplete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: ["Heap metadata changes remain scoped by the allocator contract."],
        unknownPartEffects: [],
        unknownGlobalEffects: ["Heap block and free-list globals may change; existing live part payloads do not."],
      },
    },
  };
}

/** Discovers helpers from decoded structure and references. Supplied addresses only identify already decoded entries. */
export function discoverEngineSummaries(
  image: Uint8Array,
  codes: Map<number, RoutineCode>,
  layout?: BehaviourLayout,
  table?: number,
  dataSegment = 0,
  typeCount?: number,
): EngineSummary[] {
  const summaries = new Map<number, EngineSummary>();
  const stateOffset = layout?.fields.find((f) => f.name === "state")?.offset;
  const typeOffset = layout?.fields.find((f) => f.name === "type")?.offset;
  const widthOffset = layout?.fields.find((f) => f.name === "frameWidth")?.offset;
  const heightOffset = layout?.fields.find((f) => f.name === "frameHeight")?.offset;
  const drawOffsets = layout?.fields.filter((f) => ["drawX", "drawY"].includes(f.name)).map((f) => f.offset) ?? [];
  for (const code of codes.values()) {
    if (
      code.address < 0 ||
      code.address >= image.length ||
      !code.instructions.length ||
      code.status !== "complete" ||
      !privateStackSafe(code)
    )
      continue;
    const direct = directFootprint(code, dataSegment);
    const argumentOffset = firstArgument(code);
    const owner = argumentRegister(code);
    const nonStackWrites = code.instructions.filter((i) => explicitWrite(i) && !stackMemory(i.operands[0]));
    const preserving = memoryPreserving(code);
    const summary: EngineSummary = {
      ...fact(code.instructions, preserving ? "checked" : "inferred", [
        "Private stack storage is distinct from caller-owned part memory.",
      ]),
      address: code.address,
      kind: preserving ? "read-only" : !nonStackWrites.length && code.calls.length ? "call-wrapper" : "unclassified",
      purpose: preserving
        ? "Reads inputs and returns without modifying non-stack memory."
        : "The complete purpose and side effects remain unresolved.",
      argumentOffset,
      argumentKind: "unknown",
      writes: direct.writes,
      returns: [],
      calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
      footprint: {
        complete: preserving,
        partMemoryComplete: preserving,
        preservesArgumentMemory: preserving,
        preservesPartState: preserving,
        unknownEffects: [...direct.unknownEffects, ...code.uncertainties],
      },
    };
    const numeric = wideShift(code);
    if (numeric) {
      summary.kind = "wide-integer-shift";
      summary.numeric = numeric;
      summary.purpose =
        numeric.operation === "leftShift32"
          ? "Shifts the 32-bit word pair DX:AX left by CL, combining the cross-word bits."
          : "Shifts signed DX:AX right by CL with sign extension and cross-word bits.";
      summary.assumptions.push(
        "The register count CL is in the range 0 through 31. Counts outside that domain retain unknown numeric results.",
      );
    }
    const globalReads = code.instructions.filter(
      (i) =>
        i.mnemonic === "mov" &&
        isRegister(i.operands[0], "ax") &&
        isMemory(i.operands[1]) &&
        i.operands[1].direct &&
        i.operands[1].segment === "ds",
    );
    const masks = code.instructions.filter(
      (i) => i.mnemonic === "test" && isRegister(i.operands[0], owner) && isImmediate(i.operands[1]),
    );
    if (preserving && globalReads.length >= 2 && masks.length >= 2 && owner && nonStackWrites.length === 0) {
      summary.kind = "list-head";
      summary.argumentKind = "scalar";
      summary.purpose = "Selects the first nonempty global list permitted by the caller's bit mask, or returns zero.";
    }
    const splice = owner && doublyLinkedSplice(code, owner);
    if (
      splice &&
      stateOffset !== undefined &&
      [splice.link, splice.back].every((offset) => offset + 2 <= stateOffset || offset >= stateOffset + 2) &&
      code.instructions.some((i) => i.mnemonic === "imul") &&
      code.instructions.filter((i) => i.mnemonic === "cmp").length >= 4
    ) {
      summary.kind = "ordered-part-insertion";
      summary.argumentKind = "object";
      summary.purpose =
        "Inserts the owner into a doubly linked list using comparisons of object fields and type-record data to choose its position.";
      summary.writes = splice.stores.map((i) => ({
        ...fact([i], "inferred"),
        root: "argument",
        argumentOffset: isMemory(i.operands[0], owner) ? argumentOffset : argumentOffset + 2,
        path: isMemory(i.operands[0], owner) ? [] : [-1],
        offset: (i.operands[0] as Extract<Operand, { kind: "memory" }>).displacement,
        width: 16,
        value: unknown("The selected predecessor or successor depends on the ordered-list comparisons."),
        condition: isMemory(i.operands[0], owner)
          ? truePredicate
          : { kind: "unknown", reason: "The selected predecessor or nonnull successor is updated." },
      }));
      summary.footprint = {
        complete: true,
        preservesArgumentMemory: false,
        preservesPartState: true,
        unknownEffects: [],
      };
      summary.assumptions.push(
        "The second argument addresses a list-head slot and every traversed link denotes a complete part object. The finite well-formed list is distinct from state storage; the inserted owner is not already linked into it. Unknown path entries denote selected list neighbors, not negative field offsets.",
      );
    }
    const insertion = linkedInsertion(code);
    const pointBounds =
      insertion &&
      code.instructions.filter(
        (i) =>
          i.mnemonic === "mov" &&
          isRegister(i.operands[0], "al") &&
          isMemory(i.operands[1], insertion.node) &&
          i.operands[1].width === 8,
      ).length >= 2 &&
      code.instructions.filter(
        (i) => i.mnemonic === "add" && isRegister(i.operands[0], "dx") && isRegister(i.operands[1], "ax"),
      ).length >= 2;
    if (
      insertion &&
      !code.instructions.some(implicitWrite) &&
      owner === insertion.owner &&
      nonStackWrites.every(
        (i) =>
          isMemory(i.operands[0]) &&
          i.operands[0].segment === "ds" &&
          i.operands[0].base.length === 1 &&
          [insertion.owner, insertion.node].includes(i.operands[0].base[0]!),
      ) &&
      code.calls.length === 2 &&
      (pointBounds ||
        code.instructions.filter(
          (i) => i.mnemonic === "add" && isRegister(i.operands[0], "ax") && isMemory(i.operands[1], insertion.node),
        ).length >= 2) &&
      code.instructions.filter(
        (i) => i.mnemonic === "cmp" && stackMemory(i.operands[1]) && i.operands[1].displacement > argumentOffset,
      ).length >= 4
    ) {
      summary.kind = "overlap-list";
      summary.argumentKind = "object";
      const exclusion = excludesOwner(code, insertion.owner, insertion.node, insertion.instructions[0]!.address);
      summary.list = {
        headField: insertion.offset,
        nextField: insertion.offset,
        excludesArgument: exclusion !== undefined,
        confidence: exclusion ? "checked" : "unresolved",
        evidence: [...insertion.instructions.map(evidence), ...(exclusion ?? [])],
        assumptions: [
          "The list describes nodes accepted during this query; later writes can change it. A finite acyclic traversal requires a separate list invariant.",
        ],
      };
      summary.purpose = pointBounds
        ? "Builds a linked list of other objects whose tested reference points lie inside the supplied bounds."
        : "Builds a linked list of other objects whose coordinate intervals overlap the supplied bounds.";
      summary.assumptions.push(
        "The coordinate interval arithmetic and comparisons are interpreted as a spatial query; the tested exclusion flags retain their numeric meanings.",
      );
      summary.writes = nonStackWrites.map((i) => {
        const dest = i.operands[0] as Extract<Operand, { kind: "memory" }>;
        const ownerWrite = isMemory(dest, insertion.owner);
        return {
          ...fact([i], "inferred"),
          root: ownerWrite ? "argument" : "unknown",
          ...(!ownerWrite ? { selection: "overlap-candidate" as const } : {}),
          argumentOffset,
          path: [],
          offset: dest.displacement,
          width: dest.width,
          value: isImmediate(i.operands[1])
            ? constant(i.operands[1].value, dest.width)
            : unknown("The query links or annotates a matching candidate.", dest.width),
          condition:
            ownerWrite && isImmediate(i.operands[1], 0)
              ? truePredicate
              : {
                  kind: "unknown",
                  reason: "The candidate must satisfy all coordinate and exclusion gates in the routine.",
                },
        };
      });
    }
    const byteCopies = code.instructions.filter(
      (i) =>
        i.mnemonic === "mov" && isMemory(i.operands[0]) && i.operands[0].width === 8 && isRegister(i.operands[1], "al"),
    );
    const inputBytes = code.instructions.filter(
      (i) =>
        i.mnemonic === "mov" &&
        isRegister(i.operands[0], "al") &&
        stackMemory(i.operands[1]) &&
        i.operands[1].displacement === argumentOffset + 2,
    );
    if (
      owner &&
      byteCopies.length === nonStackWrites.length &&
      byteCopies.length >= 3 &&
      inputBytes.length >= 3 &&
      new Set(byteCopies.map((i) => (i.operands[0] as Extract<Operand, { kind: "memory" }>).displacement)).size === 1
    ) {
      summary.kind = "related-byte-propagation";
      summary.argumentKind = "object";
      summary.purpose =
        "Copies the caller's byte to the owner and connected objects under type, mode and connection gates.";
      summary.writes = byteCopies.map((i) => ({
        ...fact([i], "inferred"),
        root: "argument",
        argumentOffset,
        path: isMemory(i.operands[0], owner) ? [] : [-1],
        offset: (i.operands[0] as Extract<Operand, { kind: "memory" }>).displacement,
        width: 8,
        value: field("argument", argumentOffset + 2, 8),
        condition: {
          kind: "unknown",
          reason: "The code gates the copy by owner type, global mode and connection presence.",
        },
      }));
      summary.assumptions.push(
        "An unknown path entry denotes a connected object whose identity remains unresolved; it is not an offset to dereference.",
      );
      summary.footprint.preservesPartState =
        stateOffset !== undefined && summary.writes.every((w) => w.offset < stateOffset || w.offset >= stateOffset + 2);
      summary.assumptions.push(
        "Connected buffers and their linked objects are separate from the owner's state storage. The callees receive connection pointers, not the owner pointer, and have no hidden alias to its state.",
      );
    }
    const farNodeWrites = nonStackWrites.filter((i) => isMemory(i.operands[0], "bx") && i.operands[0].segment === "es");
    const globals = nonStackWrites.filter(
      (i) => isMemory(i.operands[0]) && i.operands[0].direct && i.operands[0].segment === "ds",
    );
    const globalFarLoad = code.instructions.find(
      (i) =>
        i.mnemonic === "les" &&
        isRegister(i.operands[0], "bx") &&
        isMemory(i.operands[1]) &&
        i.operands[1].direct &&
        i.operands[1].segment === "ds",
    );
    if (
      code.status === "complete" &&
      !code.calls.length &&
      !code.instructions.some(implicitWrite) &&
      nonStackWrites.length >= 12 &&
      farNodeWrites.length + globals.length === nonStackWrites.length &&
      globals.length >= 4 &&
      globalFarLoad &&
      owner &&
      code.instructions.some((i) => i.mnemonic === "sar")
    ) {
      summary.kind = "rectangle-queue";
      summary.argumentKind = "object";
      summary.purpose =
        "Copies coordinate pairs into a node removed from a global far-pointer free list and computes its rectangle bounds.";
      const base = (globalFarLoad.operands[1] as Extract<Operand, { kind: "memory" }>).displacement;
      summary.writes = nonStackWrites.map((i) => {
        const dest = i.operands[0] as Extract<Operand, { kind: "memory" }>;
        return {
          ...fact([i], "inferred"),
          root: "global",
          segment: dataSegment,
          path: dest.segment === "es" ? [base] : [],
          offset: dest.displacement,
          width: dest.width,
          value: unknown("The rectangle queue store depends on copied coordinates and bounds arithmetic.", dest.width),
          condition: { kind: "unknown", reason: "Node availability and rectangle flags select this write." },
        };
      });
      summary.footprint = {
        complete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: [],
      };
      summary.assumptions.push(
        "The global far-pointer rectangle pool and queue globals occupy storage distinct from live part objects. Caller-supplied coordinate pointers are read, never used as store destinations.",
      );
    }
    const indexedTables = code.instructions.filter((i) =>
      i.operands.some((o) => isMemory(o, "bx") && o.segment === "ds" && o.displacement !== 0),
    );
    const scalarBound = code.instructions.filter(
      (i) => i.mnemonic === "cmp" && isRegister(i.operands[0], owner) && isImmediate(i.operands[1]),
    );
    const callTargets = [...new Set(code.calls.flatMap((c) => (c.target ? [c.target.address] : [])))];
    const service = callTargets.length === 1 ? codes.get(callTargets[0]!) : undefined;
    const serviceArgument = service && argumentRegister(service);
    const resourceListService =
      service &&
      serviceArgument &&
      service.instructions.some((i) => i.mnemonic === "les") &&
      service.instructions.filter(
        (i) =>
          i.mnemonic === "mov" && isMemory(i.operands[1]) && i.operands[1].direct && i.operands[1].segment === "ds",
      ).length >= 2 &&
      service.instructions.some(
        (i) =>
          i.mnemonic === "cmp" &&
          isMemory(i.operands[0]) &&
          i.operands[0].segment === "es" &&
          isRegister(i.operands[1], serviceArgument),
      );
    const scalarSwitchService =
      service &&
      serviceArgument &&
      service.instructions.some((i) => i.mnemonic === "idiv") &&
      service.edges.some((e) => e.kind === "jump-table") &&
      service.instructions.filter(
        (i) => i.mnemonic === "cmp" && isRegister(i.operands[0], serviceArgument) && isImmediate(i.operands[1]),
      ).length >= 2;
    const tableMapping =
      indexedTables.length >= 2 &&
      scalarBound.length >= 2 &&
      code.instructions.some(
        (i) => i.mnemonic === "shl" && isRegister(i.operands[0], "bx") && isImmediate(i.operands[1], 1),
      );
    const directIdentifierGate =
      resourceListService &&
      scalarBound.length >= 4 &&
      code.calls.length >= 2 &&
      code.instructions.filter((i) => i.mnemonic === "push" && isRegister(i.operands[0], owner)).length >= 2;
    if (
      (resourceListService || scalarSwitchService) &&
      owner &&
      callTargets.length === 1 &&
      !code.instructions.some(implicitWrite) &&
      nonStackWrites.length === 0 &&
      (tableMapping || directIdentifierGate)
    ) {
      summary.kind = "scalar-resource-service";
      summary.argumentKind = "scalar";
      summary.purpose = tableMapping
        ? "Maps scalar identifiers through tables, checks global gates and invokes a shared resource service."
        : "Checks scalar identifiers against numeric and global gates before invoking a shared resource service.";
      summary.evidence.push(...service!.instructions.map(evidence));
      summary.footprint.preservesArgumentMemory = true;
      summary.footprint.preservesPartState = true;
      summary.footprint.partMemoryComplete = true;
      summary.footprint.unknownEffects.push(
        "The resource service can update resource nodes, global state and driver-owned memory; its full backend footprint is unresolved.",
      );
      summary.assumptions.push(
        "The caller supplies a scalar resource identifier, not a pointer. Resource lists and driver-owned allocations are distinct from live part objects, and the service has no hidden access to any existing live part through another global.",
      );
    }
    const typeComparisons = code.instructions.filter(
      (i) =>
        i.mnemonic === "cmp" &&
        isMemory(i.operands[0], owner) &&
        (typeOffset === undefined || i.operands[0].displacement === typeOffset) &&
        isImmediate(i.operands[1]),
    );
    if (
      owner &&
      typeComparisons.length === 2 &&
      code.calls.length === 3 &&
      nonStackWrites.length === 0 &&
      code.instructions.filter((i) => i.mnemonic === "push" && isRegister(i.operands[0], owner)).length >= 3
    ) {
      summary.kind = "typed-geometry-dispatch";
      summary.argumentKind = "object";
      summary.purpose = "Selects one of three geometry notification helpers according to two owner type comparisons.";
    } else if (
      owner &&
      typeComparisons.length >= 3 &&
      [3, 4].includes(code.calls.length) &&
      nonStackWrites.length === 0 &&
      new Set(
        code.instructions
          .filter((i) => i.mnemonic === "mov" && isRegister(i.operands[0], "ax") && isMemory(i.operands[1], owner))
          .map((i) => (i.operands[1] as Extract<Operand, { kind: "memory" }>).displacement),
      ).size >= 3
    ) {
      summary.kind = "related-geometry-dispatch";
      summary.argumentKind = "object";
      summary.purpose =
        "Calls geometry notification helpers for the owner's related objects under type and global-mode gates.";
    }
    const bufferLoads = code.instructions.filter(
      (i) => i.mnemonic === "mov" && isRegister(i.operands[0], "si") && isMemory(i.operands[1], owner),
    );
    const bufferStores = nonStackWrites.filter((i) => isMemory(i.operands[0], "si"));
    if (
      owner &&
      bufferLoads.length === 1 &&
      bufferStores.length === 2 &&
      bufferStores.length === nonStackWrites.length &&
      bufferStores.every((i) => isRegister(i.operands[1], "dx")) &&
      code.instructions.some(
        (i) => i.mnemonic === "add" && isRegister(i.operands[0], "si") && isImmediate(i.operands[1], 4),
      ) &&
      code.calls.length === 4
    ) {
      const pointerField = (bufferLoads[0]!.operands[1] as Extract<Operand, { kind: "memory" }>).displacement;
      const countLoad = code.instructions.find(
        (i) =>
          i.mnemonic === "mov" &&
          isRegister(i.operands[0], "ax") &&
          isMemory(i.operands[1], owner) &&
          i.operands[1].displacement !== pointerField,
      );
      summary.kind = "geometry-edge-data";
      summary.argumentKind = "object";
      summary.purpose =
        "Updates a word in each four-byte geometry record from adjacent coordinate differences, including the closing edge.";
      summary.writes = bufferStores.map((i) => ({
        ...fact([i], "inferred"),
        root: "argument",
        argumentOffset,
        path: [pointerField],
        offset: (i.operands[0] as Extract<Operand, { kind: "memory" }>).displacement,
        width: 16,
        value: unknown("The edge word is derived from coordinate differences and the shared numeric helper."),
        condition: truePredicate,
        repeated: {
          stride: 4,
          ...(countLoad
            ? { countField: (countLoad.operands[1] as Extract<Operand, { kind: "memory" }>).displacement }
            : {}),
        },
      }));
      summary.footprint.preservesPartState = true;
      summary.footprint.partMemoryComplete = true;
      summary.assumptions.push(
        "The geometry record buffer is separate from the owner's object storage. The coordinate helper receives a private stack rectangle; the numeric helper treats coordinate differences as scalar inputs and cannot mutate part objects.",
      );
    }
    if (
      owner &&
      widthOffset !== undefined &&
      heightOffset !== undefined &&
      nonStackWrites.length &&
      nonStackWrites.every(
        (i) => isMemory(i.operands[0], owner) && [widthOffset, heightOffset].includes(i.operands[0].displacement),
      ) &&
      !code.calls.length
    ) {
      summary.kind = "frame-dimensions";
      summary.argumentKind = "object";
      summary.purpose =
        "Loads the owner's frame dimensions from type data or stored extents according to the current state and flags.";
      summary.footprint.complete = code.status === "complete" && !code.instructions.some(implicitWrite);
      summary.footprint.preservesPartState =
        stateOffset !== undefined &&
        ![widthOffset, heightOffset].some((offset) => offset < stateOffset + 2 && stateOffset < offset + 2);
      summary.footprint.unknownEffects = [];
    }
    if (
      owner &&
      drawOffsets.length === 2 &&
      nonStackWrites.length &&
      nonStackWrites.every((i) => isMemory(i.operands[0], owner) && drawOffsets.includes(i.operands[0].displacement)) &&
      code.calls.length === 1 &&
      (table === undefined ||
        code.instructions.some((i) =>
          i.operands.some((o) => isImmediate(o, table / 16) || isImmediate(o, table - dataSegment * 16)),
        ))
    ) {
      summary.kind = "frame-position";
      summary.argumentKind = "object";
      summary.purpose =
        "Rebuilds drawing coordinates from the owner's position, state, frame offsets and reflection flags.";
    }
    if (summary.kind !== "unclassified") summaries.set(code.address, summary);
  }
  // A small fixed point resolves read-only wrapper chains without rescanning executable bytes or following calls afresh.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const code of codes.values()) {
      const summary = summaries.get(code.address);
      if (!summary || summary.footprint.complete || code.status !== "complete") continue;
      const callees = code.calls.map((c) => c.target && summaries.get(c.target.address));
      if (callees.some((c) => !c || !c.footprint.complete)) continue;
      const directStores = code.instructions.filter((i) => explicitWrite(i) && !stackMemory(i.operands[0]));
      const scalar = summary.argumentKind === "scalar";
      if (
        summary.kind === "overlap-list" &&
        stateOffset !== undefined &&
        summary.writes.every((w) => w.offset + w.width / 8 <= stateOffset || stateOffset + 2 <= w.offset) &&
        callees.every((c) => c!.footprint.preservesArgumentMemory)
      ) {
        summary.footprint.complete = true;
        summary.footprint.preservesPartState = true;
        summary.footprint.unknownEffects = [];
        summary.assumptions.push(
          "The list helpers return object base pointers, so writes to their linked-list and overlap metadata fields do not alias the state field.",
        );
        changed = true;
        continue;
      }
      const noDirect = !directStores.length && !code.instructions.some(implicitWrite);
      const onlyKnownOwner =
        summary.kind === "frame-position" && summary.writes.every((w) => w.root === "argument" && !w.path.length);
      if (
        ((noDirect && callees.every((c) => c!.footprint.preservesArgumentMemory)) || onlyKnownOwner) &&
        callees.every((c) => c!.footprint.preservesPartState)
      ) {
        summary.footprint.complete = true;
        summary.footprint.preservesPartState = true;
        summary.footprint.preservesArgumentMemory =
          noDirect && callees.every((c) => c!.footprint.preservesArgumentMemory);
        summary.footprint.unknownEffects = [];
        for (const callee of callees)
          for (const write of callee!.writes) {
            if (write.root === "global" || (onlyKnownOwner && write.root === "argument" && !write.path.length))
              summary.writes.push(write);
          }
        summary.assumptions.push(...callees.flatMap((c) => c!.assumptions));
        if (scalar) summary.argumentKind = "scalar";
        changed = true;
      }
    }
    if (!changed) break;
  }
  // A complete explicit owner footprint is useful even when values or unrelated backend globals stay unknown.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const code of codes.values()) {
      if (
        summaries.has(code.address) ||
        code.status !== "complete" ||
        !privateStackSafe(code) ||
        code.instructions.some(implicitWrite) ||
        code.instructions.some(
          (i) =>
            i.mnemonic === "lds" || (isRegister(i.operands[0], "ds") && !["push", "cmp", "test"].includes(i.mnemonic)),
        ) ||
        stateOffset === undefined
      )
        continue;
      const owner = argumentRegister(code);
      if (!owner || (code.calls.length > 0 && !["si", "di"].includes(owner))) continue;
      const load = code.instructions.find(
        (i) =>
          i.mnemonic === "mov" &&
          isRegister(i.operands[0], owner) &&
          stackMemory(i.operands[1]) &&
          i.operands[1].displacement === firstArgument(code),
      );
      if (
        !load ||
        code.instructions.some((i) => i.address < load.address && ["branch", "jump", "call"].includes(i.flow))
      )
        continue;
      if (
        code.instructions.some(
          (i) =>
            isRegister(i.operands[0], owner) &&
            !["cmp", "test", "push", "pop"].includes(i.mnemonic) &&
            !(i.mnemonic === "mov" && stackMemory(i.operands[1]) && i.operands[1].displacement === firstArgument(code)),
        )
      )
        continue;
      const stores = code.instructions.filter((i) => explicitWrite(i) && !stackMemory(i.operands[0]));
      if (
        !stores.length ||
        !stores.every(
          (i) => isMemory(i.operands[0], owner) && i.operands[0].segment === "ds" && i.operands[0].width <= 16,
        )
      )
        continue;
      const callees = code.calls.map((call) =>
        call.confidence === "checked" && call.target ? summaries.get(call.target.address) : undefined,
      );
      if (callees.some((callee) => !callee || (!callee.footprint.complete && !callee.footprint.partMemoryComplete)))
        continue;
      let callMappings = true;
      for (let n = 0; n < code.calls.length; n++) {
        const callee = callees[n]!;
        if (callee.footprint.preservesArgumentMemory) continue;
        let previous = code.instructions.find((i) => i.address + i.size === code.calls[n]!.instruction);
        if (previous?.mnemonic === "push" && isRegister(previous.operands[0], "cs"))
          previous = code.instructions.find((i) => i.address + i.size === previous!.address);
        if (
          callee.argumentKind !== "object" ||
          previous?.mnemonic !== "push" ||
          !isRegister(previous.operands[0], owner) ||
          callee.writes.some(
            (w) => w.root === "argument" && (w.argumentOffset !== callee.argumentOffset || w.path.length),
          )
        ) {
          callMappings = false;
          break;
        }
      }
      if (!callMappings) continue;
      const direct = directFootprint(code, dataSegment);
      if (
        direct.unknownEffects.length ||
        direct.writes.some((w) => w.root !== "argument" || w.argumentOffset !== firstArgument(code) || w.path.length)
      )
        continue;
      const fields = [
        ...new Set(stores.map((i) => (i.operands[0] as Extract<Operand, { kind: "memory" }>).displacement)),
      ].sort((a, b) => a - b);
      const summary: EngineSummary = {
        ...fact(code.instructions, "inferred", [
          "The stable argument register denotes a complete part object. Every explicit non-stack store has a fixed checked offset; callee contracts retain their separate assumptions and all mapped state stores remain visible.",
          ...callees.flatMap((c) => c!.assumptions),
        ]),
        address: code.address,
        kind: "owner-field-update",
        argumentOffset: firstArgument(code),
        argumentKind: "object",
        purpose: `Updates owner fields ${fields.map((offset) => `+0x${offset.toString(16)}`).join(", ")}; conditions and any state stores remain explicit.`,
        calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
        writes: direct.writes,
        returns: [],
        footprint: {
          complete: callees.every((c) => c!.footprint.complete),
          partMemoryComplete: callees.every((c) => c!.footprint.complete || c!.footprint.partMemoryComplete),
          preservesArgumentMemory: false,
          preservesPartState: true,
          unknownEffects: callees.flatMap((c) => c!.footprint.unknownEffects),
          unknownPartEffects: [],
          unknownGlobalEffects: callees.flatMap((c) => c!.footprint.unknownGlobalEffects ?? []),
        },
      };
      for (const callee of callees)
        for (const write of callee!.writes) {
          if (write.root === "global") summary.writes.push(write);
          else if (write.root === "argument")
            summary.writes.push({
              ...write,
              argumentOffset: firstArgument(code),
              value: unknown("The nested helper's value depends on its own arguments and predicates.", write.width),
              condition: { kind: "unknown", reason: "The nested helper call and its write path must be reached." },
            });
        }
      summary.footprint.preservesPartState =
        !summary.writes.some(
          (w) => w.root === "argument" && w.offset < stateOffset + 2 && stateOffset < w.offset + w.width / 8,
        ) && callees.every((c) => c!.footprint.preservesPartState);
      summary.purpose = ownerPurpose(
        [...new Set(summary.writes.filter((w) => w.root === "argument" && !w.path.length).map((w) => w.offset))],
        layout,
        summary.footprint.preservesPartState,
      );
      summaries.set(code.address, summary);
      changed = true;
    }
    if (!changed) break;
  }
  for (const code of codes.values()) {
    const summary = summaries.get(code.address);
    if (!summary) continue;
    const calleeSummaries = code.calls.map((c) => c.target && summaries.get(c.target.address));
    if (
      summary.kind === "read-only" &&
      code.calls.length === 0 &&
      argumentRegister(code) &&
      code.instructions.some(
        (i) => i.mnemonic === "cmp" && isMemory(i.operands[0], argumentRegister(code)) && isImmediate(i.operands[1], 0),
      )
    )
      summary.argumentKind = "object";
    if (
      code.calls.length === 1 &&
      calleeSummaries[0]?.kind === "list-head" &&
      !code.instructions.some((i) => explicitWrite(i) && !stackMemory(i.operands[0])) &&
      argumentRegister(code) &&
      code.instructions.some(
        (i) =>
          i.mnemonic === "mov" &&
          isRegister(i.operands[0], "ax") &&
          isMemory(i.operands[1], argumentRegister(code)) &&
          i.operands[1].displacement === 0,
      )
    ) {
      summary.kind = "list-next";
      summary.argumentKind = "object";
      summary.purpose =
        "Returns the object's next link, an eligible next global list head, or zero under numeric list flags.";
      summary.footprint = {
        complete: true,
        preservesArgumentMemory: true,
        preservesPartState: true,
        unknownEffects: [],
      };
    }
    if (["list-head", "list-next"].includes(summary.kind))
      summary.returns = readonlyReturns(code, summaries, dataSegment);
    if (!summary.footprint.complete && !summary.footprint.unknownEffects.length)
      summary.footprint.unknownEffects.push("Transitive helper effects have not all been resolved.");
    if (summary.kind !== "read-only") summary.confidence = "inferred";
    summary.writes = [
      ...new Map(
        summary.writes.map((w) => [
          JSON.stringify([
            w.root,
            w.selection,
            w.argumentOffset,
            w.path,
            w.segment,
            w.offset,
            w.width,
            w.value,
            w.condition,
          ]),
          w,
        ]),
      ).values(),
    ];
    summary.footprint.partMemoryComplete = summary.footprint.complete || summary.footprint.partMemoryComplete === true;
    summary.footprint.unknownPartEffects = summary.footprint.partMemoryComplete
      ? []
      : summary.footprint.unknownEffects.length
        ? [...summary.footprint.unknownEffects]
        : ["The complete footprint on related parts remains unresolved."];
    summary.footprint.unknownGlobalEffects = summary.footprint.complete ? [] : [...summary.footprint.unknownEffects];
    if (summary.kind === "ordered-part-insertion")
      summary.footprint.unknownGlobalEffects.push(
        "The caller-supplied list-head slot can be global and changes during insertion.",
      );
    summary.assumptions = [...new Set(summary.assumptions)];
  }
  addBufferEffectSummaries(codes, summaries);
  const allocators = new Set([...codes.values()].filter(heapBlockAllocator).map((c) => c.address));
  const cleared = new Set<number>();
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const code of codes.values()) {
      if (code.status !== "complete" || allocators.has(code.address)) continue;
      const calls = code.calls
        .flatMap((c) => (c.target ? [codes.get(c.target.address)] : []))
        .filter((c): c is RoutineCode => c !== undefined);
      const returnsArgument = code.instructions.some(
        (i) => i.mnemonic === "mov" && isRegister(i.operands[0], "ax") && isRegister(i.operands[1], "si"),
      );
      const zeroed =
        calls.some(fillsBytes) &&
        calls.some((c) => allocators.has(c.address)) &&
        returnsArgument &&
        code.instructions.some(
          (i) => i.mnemonic === "mov" && isRegister(i.operands[0], "si") && isRegister(i.operands[1], "ax"),
        ) &&
        code.instructions.some(
          (i) => i.mnemonic === "mov" && isRegister(i.operands[0], "al") && isImmediate(i.operands[1], 0),
        );
      const forwarding =
        code.instructions.length < 20 &&
        code.calls.length === 1 &&
        calls.some((c) => allocators.has(c.address)) &&
        !code.instructions.some((i) => explicitWrite(i) && !stackMemory(i.operands[0]));
      if (!zeroed && !forwarding) continue;
      allocators.add(code.address);
      if (zeroed || calls.some((c) => cleared.has(c.address))) cleared.add(code.address);
      const summary = allocationSummary(
        code,
        "nullable-allocation",
        zeroed
          ? "Allocates an aligned block for the requested element count and size, clears it, and returns its payload or zero."
          : "Forwards the caller's allocation arguments and returns the allocation payload or zero.",
        calls.filter((c) => fillsBytes(c) || allocators.has(c.address)).flatMap((c) => c.instructions),
      );
      summaries.set(code.address, summary);
      changed = true;
    }
    if (!changed) break;
  }
  for (const code of codes.values()) {
    if (code.status !== "complete" || typeOffset === undefined) continue;
    const input = argumentRegister(code);
    if (!input) continue;
    const allocationCall = code.calls.find((call) => call.target && cleared.has(call.target.address));
    if (!allocationCall) continue;
    const copied = code.instructions.find(
      (i) =>
        i.address > allocationCall.instruction &&
        i.address < allocationCall.instruction + 16 &&
        i.mnemonic === "mov" &&
        isRegister(i.operands[0]) &&
        isRegister(i.operands[1], "ax"),
    );
    const object = copied && isRegister(copied.operands[0]) ? copied.operands[0].name : undefined;
    if (!object) continue;
    const typeStore = code.instructions.find(
      (i) =>
        i.mnemonic === "mov" &&
        isMemory(i.operands[0], object) &&
        i.operands[0].displacement === typeOffset &&
        isRegister(i.operands[1], input),
    );
    const returnsObject = code.instructions.some(
      (i) => i.mnemonic === "mov" && isRegister(i.operands[0], "ax") && isRegister(i.operands[1], object),
    );
    const zeroReturn = code.instructions.some(
      (i) => i.mnemonic === "xor" && isRegister(i.operands[0], "ax") && isRegister(i.operands[1], "ax"),
    );
    const nullCheck = code.instructions.some(
      (i) =>
        i.address >= copied!.address &&
        i.address < copied!.address + 12 &&
        i.mnemonic === "or" &&
        isRegister(i.operands[0], "ax") &&
        isRegister(i.operands[1], "ax"),
    );
    const constructor = code.calls.some((c) => c.operand?.kind === "memory" && !c.operand.direct);
    if (!typeStore || !returnsObject || !zeroReturn || !nullCheck || !constructor) continue;
    const allocation = summaries.get(allocationCall.target!.address)!;
    const summary = allocationSummary(
      code,
      "part-factory",
      "Allocates a cleared part object, stores the requested type, initializes its fields and invokes a type-selected constructor, returning the new object or zero.",
      codes.get(allocation.address)!.instructions,
    );
    summary.assumptions.push(
      ...allocation.assumptions,
      "The type-selected constructor follows the factory's success/failure convention; its effects on other objects remain unresolved.",
    );
    const sizeLoad = code.instructions
      .filter(
        (i) =>
          i.address < allocationCall.instruction &&
          i.address > allocationCall.instruction - 20 &&
          i.mnemonic === "mov" &&
          isRegister(i.operands[0], "ax") &&
          isImmediate(i.operands[1]) &&
          i.operands[1].value > 1,
      )
      .at(-1);
    if (sizeLoad && isImmediate(sizeLoad.operands[1])) summary.allocationSize = sizeLoad.operands[1].value;
    summary.writes = code.instructions
      .filter((i) => explicitWrite(i) && isMemory(i.operands[0], object))
      .map((i) => ({
        ...fact([i], "inferred", [
          "This destination is a field of the newly allocated object, not a field of the existing owner.",
        ]),
        root: "unknown",
        path: [],
        offset: (i.operands[0] as Extract<Operand, { kind: "memory" }>).displacement,
        width: (i.operands[0] as Extract<Operand, { kind: "memory" }>).width,
        value:
          i === typeStore
            ? field("argument", firstArgument(code))
            : isImmediate(i.operands[1])
              ? constant(i.operands[1].value, (i.operands[0] as Extract<Operand, { kind: "memory" }>).width)
              : unknown("The factory initializes this field from type data or a shared helper."),
        condition: { kind: "unknown", reason: "The allocation succeeded and this initialization path was reached." },
      }));
    summary.factory = specializeNullConstructor(
      image,
      code,
      summary,
      codes,
      summaries,
      table,
      dataSegment,
      typeCount,
      stateOffset,
    );
    summaries.set(code.address, summary);
  }
  addNodePoolSummaries(codes, summaries);
  discoverConstructorEffects(image, codes, summaries, layout, dataSegment);
  for (const summary of summaries.values()) {
    const code = codes.get(summary.address)!;
    const returns = code.instructions.filter((i) => i.flow === "return");
    const convention = (i: Instruction) => ({
      kind: i.mnemonic === "retf" ? ("far" as const) : ("near" as const),
      stackBytes: isImmediate(i.operands[0]) ? i.operands[0].value : 0,
    });
    if (
      returns.length &&
      returns.every((i) => ["ret", "retf"].includes(i.mnemonic)) &&
      returns.every((i) => JSON.stringify(convention(i)) === JSON.stringify(convention(returns[0]!)))
    )
      summary.returnConvention = convention(returns[0]!);
  }
  for (const code of codes.values()) {
    const bypass = discoverConnectionBypass(code, layout);
    if (!bypass) continue;
    const prior = summaries.get(code.address);
    summaries.set(code.address, {
      ...bypass,
      ...prior,
      address: code.address,
      kind: "connection-query",
      argumentOffset: bypass.argumentOffset,
      argumentKind: "object",
      shortCircuit: bypass,
      purpose:
        "Checks two rope connections and may dispatch the peer type's callback; the certified bypasses make no call.",
      calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
      writes: prior?.writes ?? [],
      returns: prior?.returns ?? [],
      returnConvention: { kind: "far", stackBytes: 0 },
      footprint: prior?.footprint ?? {
        complete: false,
        partMemoryComplete: false,
        preservesArgumentMemory: false,
        preservesPartState: false,
        unknownEffects: ["The connected peer callback's effects are unresolved."],
      },
    });
  }
  for (const summary of summaries.values()) {
    const code = codes.get(summary.address);
    if (code) summary.overlapProducer = proveOverlapProducer(code, codes, summary);
  }
  addGearSummaries(codes, summaries, layout);
  addStatePreservingForwarders(codes, summaries);
  addSuccessfulConstructors(image, codes, summaries, layout, dataSegment);
  addOwnedConstructors(image, codes, summaries, layout, table, dataSegment);
  for (const code of codes.values()) {
    const angle = discoverAngleClassifier(code);
    if (angle) summaries.set(code.address, angle);
  }
  for (const code of codes.values()) {
    const gate = discoverAngleGate(code, codes);
    if (gate) summaries.set(code.address, gate);
  }
  for (const code of codes.values()) {
    const bounds = discoverContactBounds(code, codes);
    if (bounds) summaries.set(code.address, bounds);
    const scalar = discoverContactScalar(code);
    if (scalar) summaries.set(code.address, scalar);
  }
  addContactSegmentSummaries(codes, summaries);
  addContactEffectSummaries(codes, summaries, layout);
  addContactSelection(codes, summaries);
  return [...summaries.values()].sort((a, b) => a.address - b.address);
}
