/**
 * Static visual behaviour of TIM 1 and Even More. The decoder builds a control flow graph; the analysis propagates
 * symbolic expressions through that graph. It never creates a live game object or executes an instruction. A field
 * is an input variable, and loops and unknown calls lose information rather than being run with invented inputs.
 */

import { discoverCollisionDispatch, type CollisionDispatch } from "./behaviour-collision-dispatch.ts";
import { ropeCallbackWrites, ropeDispatchSummary } from "./behaviour-rope-dispatch.ts";
import { discoverGearConnections, type GearConnections } from "./behaviour-gear-connections.ts";
import { discoverGearRun, type GearRunContract } from "./behaviour-gear-run.ts";
import { discoverGearScheduling, type GearScheduling } from "./behaviour-gear-scheduling.ts";
import type { GearConflictValue } from "./behaviour-gear-model.ts";
import type { BehaviourLayout } from "./behaviour-layout.ts";
import type { ProgramParts } from "./parts.ts";
import { unpackLzexe } from "./lzexe.ts";
import { type CodeAddress, type Instruction, type Operand } from "./x86.ts";
import { readRoutineCode, type RoutineCode } from "./behaviour-code.ts";
import { findBehaviourTiming } from "./behaviour-timing.ts";
import { discoverBehaviourLayout } from "./behaviour-layout.ts";
import { discoverEngineSummaries, type EngineSummary, type EnginePointer } from "./behaviour-helpers.ts";
import {
  discoverBehaviourLifecycle,
  discoverLifecycleFieldRoles,
  type BehaviourLifecycle,
} from "./behaviour-lifecycle.ts";
import { discoverExternalListConsumers } from "./behaviour-list-consumers.ts";
import { discoverListConsumerCalls, type ListConsumerCall } from "./behaviour-list-calls.ts";
import { discoverListLoops, type ListLoopSummary } from "./behaviour-list-loops.ts";
import { discoverFindFirstLoops, FIND_FIRST_ASSUMPTION } from "./behaviour-find-first-loops.ts";
import { discoverCreationDefaults, type CreationDefault } from "./behaviour-creation.ts";
import { compileScalarStep, pureScalarFrame, type ScalarStep } from "./behaviour-scalars.ts";
import { privateStackOutputs } from "./behaviour-buffer-effects.ts";
import { engineFromObjectRelation } from "./behaviour-geometry-relations.ts";
import { discoverCountedLoops, type LoopSummary } from "./behaviour-loops.ts";

export type Confidence = "checked" | "inferred" | "unresolved";
export interface Evidence {
  address: number;
  bytes: number[];
  text: string;
}
export type Expression =
  | { kind: "constant"; value: number; width: number }
  | { kind: "field"; object: string; offset: number; width: number; unresolved?: boolean }
  | { kind: "binary"; operator: string; left: Expression; right: Expression; width: number }
  | { kind: "table"; segment: number; offset: number; index: Expression; width: number }
  | { kind: "unknown"; reason: string; width: number };
export type Predicate =
  | { kind: "true" }
  | { kind: "compare"; operator: string; left: Expression; right: Expression; signed: boolean }
  | { kind: "and"; terms: Predicate[] }
  | { kind: "unknown"; reason: string };
export interface Finding {
  confidence: Confidence;
  assumptions: string[];
  evidence: Evidence[];
}
export interface FieldWrite extends Finding {
  object: string;
  offset: number;
  width: number;
  value: Expression;
  condition: Predicate;
  routine: number;
  /** When the speed setter wrote the field: the speed it was given, which the field's value doesn't show. */
  directedSpeed?: DirectedSpeed;
}
/** A velocity field the speed setter wrote, with the speed the caller passed it. */
export interface DirectedSpeed {
  /** The speed setter, and the call that reached it. */
  routine: number;
  call: number;
  /** The length of the new velocity, before each part is rounded by the shift. */
  speed: Expression;
  axis: "horizontal" | "vertical";
  /** When the angle the setter was given is the centre angle's answer: the velocity points along that line. */
  direction?: CentreLine;
}
/** The line from one part's centre to another's, as the centre angle was given it, by the parts' names. */
export interface CentreLine {
  /** The centre angle, and the call that reached it. */
  routine: number;
  call: number;
  from: string;
  to: string;
}
export interface Transition extends Finding {
  /** Candidate states at entry. Null means that the source state was not bounded by the available states. */
  from: number[] | null;
  /** The final state at a return, including consecutive writes in the same invocation. */
  to: Expression;
  condition: Predicate;
  routine: number;
  /** Final object fields, expressed in terms of the invocation inputs. */
  updates?: FieldWrite[];
}
export interface RoutineOutcome extends Finding {
  /** No untracked object write or call can replace these final fields on this path. */
  effectsComplete?: boolean;
  /**
   * The effects are incomplete only because a helper kept the part's state without a complete footprint of its other
   * fields: the final state is exact, and every other part field may have changed.
   */
  keepsState?: true;
  condition: Predicate;
  fields: FieldWrite[];
  returnValue: Expression;
  returnConfidence?: Confidence;
  returnPointer?: { object: string; displacement: number };
}
export interface IterationOutcome extends Finding {
  scope: "one overlap-list member";
  header: number;
  object: string;
  condition: Predicate;
  fields: FieldWrite[];
  effectsComplete: boolean;
}

export interface Counter extends Finding {
  offset: number;
  updates: FieldWrite[];
  comparisons: Predicate[];
  unit: string;
}
export interface Trigger extends Finding {
  name: string;
  routine: number;
  condition?: Predicate;
  field?: number;
  source?: number;
  write?: FieldWrite;
  targetType?: number;
}
export interface CallbackReference extends Finding, CodeAddress {
  slot: number;
  field: number;
  shared: boolean;
  sharedDefault: boolean;
  role: string;
}
export interface RoutineAnalysis extends RoutineCode {
  gearRun?: GearRunContract;
  derivedValues?: GearConflictValue[];
  analysisWork?: { visits: number; limit: number; pendingPaths: number };
  objectPointer: Finding & { argumentOffset: number; argumentBase?: number; registers: string[] };
  writes: FieldWrite[];
  transitions: Transition[];
  comparisons: (Finding & { predicate: Predicate })[];
  outcomes?: RoutineOutcome[];
  iterationOutcomes?: IterationOutcome[];
  /** Every decoded path has a recorded return relation; memory effects may still be unresolved. */
  returnPathsComplete?: boolean;
  engineCalls?: (Finding & { instruction: number; summary: number; purpose: string; listContext?: ListConsumerCall })[];
  controlFlowJoins?: (Finding & { address: number; liveRegisters: string[]; conditions: Predicate[][] })[];
  loops?: LoopSummary[];
  listLoops?: ListLoopSummary[];
  /** True when an unsupported effect, a loop, or an unresolved call can affect a field. */
  uncertainEffects: boolean;
}
export interface PartBehaviour {
  gearConnections?: GearConnections;
  gearRun?: GearRunContract;
  derivedValues?: GearConflictValue[];
  id: string;
  type: number;
  frameCount?: number;
  routines: CallbackReference[];
  stateWrites: FieldWrite[];
  transitions: Transition[];
  counters: Counter[];
  reset: FieldWrite[];
  visibleEffects: FieldWrite[];
  triggers: Trigger[];
  uncertainties: string[];
}
export interface BehaviourReport {
  collisionDispatch?: CollisionDispatch[];
  gearScheduling?: GearScheduling[];
  listId: string;
  imageLength: number;
  dataSegment: number;
  layout: ReturnType<typeof discoverBehaviourLayout>;
  timing: ReturnType<typeof findBehaviourTiming>;
  helpers?: EngineSummary[];
  lifecycle?: BehaviourLifecycle;
  creation?: CreationDefault[];
  parts: PartBehaviour[];
  relatedObjectEffects: (Finding & {
    sourceType: number;
    sourcePart: string;
    write: FieldWrite;
    targetType?: number;
  })[];
  routines: RoutineAnalysis[];
  assumptions: string[];
  /**
   * The words of each type record as the program holds them, at `address` in the unpacked image, `stride` bytes per
   * type. A table read the analysis keeps, like a type's mass, can be looked up here for a known type.
   */
  typeTable?: { address: number; stride: number; words: number[][] };
}

const hex = (n: number) => `0x${n.toString(16)}`;
const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
const unknown = (reason: string, width = 16): Expression => ({ kind: "unknown", reason, width });
const field = (object: string, offset: number, width = 16): Expression => ({ kind: "field", object, offset, width });
/** The JSON text of each expression, predicate and state list, kept because they are never changed once made. */
const texts = new WeakMap<object, string>();
const textOf = (value: unknown) => {
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  let text = texts.get(value);
  if (text === undefined) texts.set(value, (text = JSON.stringify(value)));
  return text;
};
const same = (a: unknown, b: unknown) => textOf(a) === textOf(b);
const evidenceOf = (i: Instruction): Evidence => ({ address: i.address, bytes: i.bytes, text: i.text });
/** The named part fields the asking part keeps: those its own rope callback can't write when a question comes back. */
const askingKeeps = (connected: NonNullable<EngineSummary["connected"]>) =>
  connected.partFields
    .filter(
      (field) =>
        !(connected.askingFields ?? []).some(
          (asking) => field.offset < asking.offset + asking.width / 8 && asking.offset < field.offset + field.width / 8,
        ),
    )
    .map((field) => field.offset);
/**
 * A private local or register a list scan or find-first loop left behind, or a pure query's answer. It is one value for
 * conditions, but it may point to any part, the owner included, so it never becomes the address of an object of its own.
 */
const scanLocal = (object: string) =>
  /^(local after (list scan|find-first loop)|answer of the query|part after the query) at /.test(object);
const stateCountOf = (part: { states?: unknown[]; frames?: unknown[] }) => (part.states ?? part.frames ?? []).length;
const uniqueEvidence = (items: Evidence[]) => [...new Map(items.map((i) => [i.address, i])).values()];
const unsigned = (n: number, width: number) => ((n % 2 ** width) + 2 ** width) % 2 ** width;
const signed = (n: number, width: number) => {
  const u = unsigned(n, width);
  return u >= 2 ** (width - 1) ? u - 2 ** width : u;
};

/** Constant folding is algebra on expressions, independent of an instruction stream or a game object. */
const expressionSizes = new WeakMap<object, number>();
const scalarSteps = new WeakMap<object, ScalarStep>();
function expressionSize(expression: Expression): number {
  const cached = expressionSizes.get(expression);
  if (cached !== undefined) return cached;
  const size =
    expression.kind === "binary"
      ? 1 + expressionSize(expression.left) + expressionSize(expression.right)
      : expression.kind === "table"
        ? 1 + expressionSize(expression.index)
        : 1;
  expressionSizes.set(expression, size);
  return size;
}
export function binary(operator: string, left: Expression, right: Expression, width = left.width): Expression {
  if (left.kind === "unknown" || right.kind === "unknown") return unknown(`Unresolved operand in ${operator}`, width);
  if (expressionSize(left) + expressionSize(right) > 96)
    return unknown("Symbolic expression size budget reached", width);
  if (left.kind === "constant" && right.kind === "constant") {
    const a = unsigned(left.value, left.width);
    const b = unsigned(right.value, right.width);
    const result =
      operator === "+"
        ? a + b
        : operator === "-"
          ? a - b
          : operator === "*"
            ? a * b
            : operator === "&"
              ? a & b
              : operator === "|"
                ? a | b
                : operator === "^"
                  ? a ^ b
                  : operator === "<<"
                    ? a << b
                    : operator === ">>>"
                      ? a >>> b
                      : operator === ">>"
                        ? signed(a, left.width) >> b
                        : operator === "%" && b !== 0
                          ? a % b
                          : operator === "/" && b !== 0
                            ? Math.trunc(a / b)
                            : operator === "s/" && signed(b, right.width) !== 0
                              ? Math.trunc(signed(a, left.width) / signed(b, right.width))
                              : operator === "s%" && signed(b, right.width) !== 0
                                ? signed(a, left.width) % signed(b, right.width)
                                : undefined;
    if (["==", "!=", "<", "<=", ">", ">="].includes(operator)) {
      const rhs = unsigned(right.value, left.width);
      return constant(
        Number(
          operator === "=="
            ? a === rhs
            : operator === "!="
              ? a !== rhs
              : operator === "<"
                ? a < rhs
                : operator === "<="
                  ? a <= rhs
                  : operator === ">"
                    ? a > rhs
                    : a >= rhs,
        ),
        width,
      );
    }
    if (result !== undefined) return constant(unsigned(result, width), width);
  }
  if (["+", "-", "|", "^"].includes(operator) && right.kind === "constant" && right.value === 0) return left;
  if (["|", "&"].includes(operator) && same(left, right)) return left;
  if (operator === "-" && same(left, right)) return constant(0, width);
  if (operator === "^" && same(left, right)) return constant(0, width);
  return { kind: "binary", operator, left, right, width };
}

function substitute(expression: Expression, state: number, stateOffset = 0x0c): Expression {
  if (expression.kind === "field" && expression.object === "part" && expression.offset === stateOffset)
    return constant(state, expression.width);
  if (expression.kind === "binary")
    return binary(
      expression.operator,
      substitute(expression.left, state, stateOffset),
      substitute(expression.right, state, stateOffset),
      expression.width,
    );
  return expression;
}
function compareConstants(predicate: Extract<Predicate, { kind: "compare" }>): boolean | undefined {
  const { left, right, operator } = predicate;
  if (left.kind !== "constant" || right.kind !== "constant") return undefined;
  const a = predicate.signed ? signed(left.value, left.width) : unsigned(left.value, left.width);
  const b = predicate.signed ? signed(right.value, left.width) : unsigned(right.value, left.width);
  return operator === "=="
    ? a === b
    : operator === "!="
      ? a !== b
      : operator === "<"
        ? a < b
        : operator === "<="
          ? a <= b
          : operator === ">"
            ? a > b
            : operator === ">="
              ? a >= b
              : undefined;
}
function scalarInExpression(e: Expression): ScalarStep | undefined {
  const step = scalarSteps.get(e);
  if (step) return step;
  if (e.kind === "binary") return scalarInExpression(e.left) ?? scalarInExpression(e.right);
  if (e.kind === "table") return scalarInExpression(e.index);
}
function scalarInPredicate(p: Predicate): ScalarStep | undefined {
  if (p.kind === "compare") return scalarInExpression(p.left) ?? scalarInExpression(p.right);
  if (p.kind === "and")
    for (const term of p.terms) {
      const step = scalarInPredicate(term);
      if (step) return step;
    }
}
function bindScalar(e: Expression, root: Expression, value: Expression): Expression {
  if (e === root) return value;
  if (e.kind === "binary") {
    const left = bindScalar(e.left, root, value),
      right = bindScalar(e.right, root, value);
    return left === e.left && right === e.right ? e : binary(e.operator, left, right, e.width);
  }
  if (e.kind === "table") {
    const index = bindScalar(e.index, root, value);
    return index === e.index ? e : { ...e, index };
  }
  return e;
}
function bindScalarPredicate(p: Predicate, root: Expression, value: Expression): Predicate {
  if (p.kind === "compare")
    return { ...p, left: bindScalar(p.left, root, value), right: bindScalar(p.right, root, value) };
  if (p.kind === "and") return { ...p, terms: p.terms.map((t) => bindScalarPredicate(t, root, value)) };
  return p;
}
function possible(predicate: Predicate, state?: number, stateOffset = 0x0c, scalarWork = { remaining: 64 }): boolean {
  const step = scalarInPredicate(predicate);
  if (step) {
    if (scalarWork.remaining <= 0) return true;
    for (const interval of step.intervals) {
      if (--scalarWork.remaining < 0) return true;
      const terms: Predicate[] = [
        bindScalarPredicate(predicate, step.expression, constant(interval.value, step.width)),
      ];
      const inputWidth = step.input.width;
      const low = step.signed ? -(2 ** (inputWidth - 1)) : 0,
        high = step.signed ? 2 ** (inputWidth - 1) - 1 : 2 ** inputWidth - 1;
      if (interval.low > low)
        terms.push({
          kind: "compare",
          operator: ">=",
          left: step.input,
          right: constant(interval.low, inputWidth),
          signed: step.signed,
        });
      if (interval.high < high)
        terms.push({
          kind: "compare",
          operator: "<=",
          left: step.input,
          right: constant(interval.high, inputWidth),
          signed: step.signed,
        });
      if (possible(conjunction(terms), state, stateOffset, scalarWork)) return true;
    }
    return false;
  }
  if (predicate.kind === "and") {
    if (!predicate.terms.every((p) => possible(p, state, stateOffset, scalarWork))) return false;
    const ranges = new Map<string, { low: number; high: number; excluded: Set<number> }>();
    for (const p of predicate.terms) {
      if (p.kind !== "compare" || p.right.kind !== "constant" || p.left.kind === "unknown") continue;
      const key = JSON.stringify([p.left, p.signed]);
      const limit = 2 ** p.left.width;
      const range = ranges.get(key) ?? {
        low: p.signed ? -limit / 2 : 0,
        high: p.signed ? limit / 2 - 1 : limit - 1,
        excluded: new Set<number>(),
      };
      const n = p.signed ? signed(p.right.value, p.left.width) : unsigned(p.right.value, p.left.width);
      if (p.operator === "==") {
        range.low = Math.max(range.low, n);
        range.high = Math.min(range.high, n);
      } else if (p.operator === "!=") range.excluded.add(n);
      else if (p.operator === "<") range.high = Math.min(range.high, n - 1);
      else if (p.operator === "<=") range.high = Math.min(range.high, n);
      else if (p.operator === ">") range.low = Math.max(range.low, n + 1);
      else if (p.operator === ">=") range.low = Math.max(range.low, n);
      if (range.low > range.high || (range.low === range.high && range.excluded.has(range.low))) return false;
      ranges.set(key, range);
    }
    return true;
  }
  if (predicate.kind !== "compare") return true;
  return (
    compareConstants(
      state === undefined
        ? predicate
        : {
            ...predicate,
            left: substitute(predicate.left, state, stateOffset),
            right: substitute(predicate.right, state, stateOffset),
          },
    ) !== false
  );
}
function conjunction(terms: Predicate[]): Predicate {
  const flat = terms.flatMap((p) => (p.kind === "and" ? p.terms : p.kind === "true" ? [] : [p]));
  return flat.length
    ? { kind: "and", terms: [...new Map(flat.map((p) => [JSON.stringify(p), p])).values()] }
    : { kind: "true" };
}
function containsUnknown(expression: Expression): boolean {
  return (
    expression.kind === "unknown" ||
    (expression.kind === "field" && expression.unresolved === true) ||
    (expression.kind === "binary" && (containsUnknown(expression.left) || containsUnknown(expression.right))) ||
    (expression.kind === "table" && containsUnknown(expression.index))
  );
}
function uncertainPredicate(predicate: Predicate): boolean {
  return (
    predicate.kind === "unknown" ||
    (predicate.kind === "and" && predicate.terms.some(uncertainPredicate)) ||
    (predicate.kind === "compare" && (containsUnknown(predicate.left) || containsUnknown(predicate.right)))
  );
}

interface Pointer {
  kind: "pointer";
  object: string;
  displacement: number;
  width: number;
  addressValue?: Expression;
}
type Value = Expression | Pointer | { kind: "stack"; displacement: number; width: number };
interface Tracked {
  value: Value;
  evidence: Evidence[];
  writtenAt?: number;
  /** Kept with a field the speed setter wrote, until something else writes it. */
  directedSpeed?: DirectedSpeed;
  /** Kept with the answer of the centre angle: the parts whose centres it is of. */
  centreAngle?: CentreLine;
}
/** The object, offset and width of a memory key `object:offset:width`; the object name may itself contain colons. */
function keyParts(key: string) {
  const parts = key.split(":"),
    width = Number(parts.pop()),
    offset = Number(parts.pop());
  return { object: parts.join(":"), offset, width };
}
/**
 * The pool a node pool update changes, when the caller can keep everything but the node's bytes on objects other than
 * its own part. A field of another object written before the call might be in a node, and the update could change it
 * where the caller can't see, so then the update keeps its general summary.
 */
function poolNodeEffect(engine: EngineSummary, memory: Map<string, Tracked>) {
  if (engine.kind !== "owned-node-pool-update" || !engine.nodePool) return undefined;
  const { nodeSize } = engine.nodePool;
  for (const [key, cell] of memory) {
    const { object, offset } = keyParts(key);
    if (cell.writtenAt !== undefined && !["stack", "data", "part"].includes(object) && offset < nodeSize)
      return undefined;
  }
  return engine.nodePool;
}
interface Flags {
  carryOverridden?: boolean;
  operation: string;
  left: Expression;
  right: Expression;
  result: Expression;
  evidence: Evidence[];
}
interface AbstractState {
  registers: Map<string, Tracked>;
  memory: Map<string, Tracked>;
  stack: Tracked[];
  conditions: Predicate[];
  evidence: Evidence[];
  flags?: Flags;
  carry?: Tracked;
  visited: Set<number>;
  stateWritten: boolean;
  uncertain: boolean;
  havoc: boolean;
  havocAt?: number;
  globalHavocAt?: number;
  partMemoryHavocAt?: number;
  fieldHavoc?: { offset: number; width: number; address: number; exceptOwner: boolean; ownerOnly?: boolean }[];
  observationOnly?: boolean;
  observationHeader?: number;
  observationExit?: number;
  observationObject?: string;
  observationGuard?: Predicate;
  /** The heads of find-first walks this path follows for any member. */
  findFirst?: Set<number>;
  assumptions: string[];
}
interface Location {
  object: string;
  offset: number;
  width: number;
  uncertain: boolean;
  evidence: Evidence[];
}
export interface RoutineOptions {
  codes?: Map<number, RoutineCode>;
  layout?: BehaviourLayout;
  dataSegment?: number;
  stateCount?: number;
  /** Inferred from an actual callback dispatch or a caller passing an object, never from its type number. */
  argumentOffset?: number;
  stateOffset?: number;
  maxVisits?: number;
  code?: RoutineCode;
  engineSummaries?: Map<number, EngineSummary>;
  objectArgument?: "part" | "collider";
  ownerLink?: number;
  /** Summaries of callees already found by following code references. */
  summaries?: Map<number, RoutineAnalysis>;
}
const memoryKey = (l: Location) => `${l.object}:${l.offset}:${l.width}`;
const tracked = (value: Value, evidence: Evidence[] = [], writtenAt?: number): Tracked => ({
  value,
  evidence,
  ...(writtenAt === undefined ? {} : { writtenAt }),
});
const asExpression = (value: Value): Expression =>
  value.kind === "pointer"
    ? (value.addressValue ??
      binary("+", field(`address of ${value.object}`, 0, value.width), constant(value.displacement), value.width))
    : value.kind === "stack"
      ? unknown("A private stack address is used as a number", value.width)
      : value;
const clone = (s: AbstractState): AbstractState => ({
  ...s,
  registers: new Map(s.registers),
  memory: new Map(s.memory),
  stack: [...s.stack],
  conditions: [...s.conditions],
  evidence: [...s.evidence],
  visited: new Set(s.visited),
  assumptions: [...s.assumptions],
  fieldHavoc: s.fieldHavoc && [...s.fieldHavoc],
  findFirst: s.findFirst && new Set(s.findFirst),
});
const wordOfByte: Record<string, string> = {
  al: "ax",
  ah: "ax",
  bl: "bx",
  bh: "bx",
  cl: "cx",
  ch: "cx",
  dl: "dx",
  dh: "dx",
};

/** Carry expressions are needed only where a later instruction consumes CF before its next definition. */
function liveCarryOutputs(code: RoutineCode): Set<number> {
  const byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  const next = new Map<number, number[]>(),
    previous = new Map<number, number[]>();
  for (const edge of code.edges)
    if (edge.to !== null) {
      next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
      previous.set(edge.to, [...(previous.get(edge.to) ?? []), edge.from]);
    }
  const live = new Set<number>(),
    pending = code.instructions.map((i) => i.address),
    queued = new Set(pending);
  while (pending.length) {
    const at = pending.pop()!;
    queued.delete(at);
    const i = byAddress.get(at);
    if (!i) continue;
    const use = ["adc", "sbb", "cmc", "jb", "jae", "jbe", "ja"].includes(i.mnemonic);
    const define =
      i.flow === "call" ||
      [
        "add",
        "adc",
        "sub",
        "sbb",
        "cmp",
        "and",
        "or",
        "xor",
        "test",
        "neg",
        "mul",
        "imul",
        "div",
        "idiv",
        "clc",
        "stc",
        "cmc",
      ].includes(i.mnemonic);
    if (!live.has(at) && (use || (!define && (next.get(at) ?? []).some((to) => live.has(to))))) {
      live.add(at);
      for (const from of previous.get(at) ?? [])
        if (!queued.has(from)) {
          pending.push(from);
          queued.add(from);
        }
    }
  }
  return new Set(
    code.instructions.filter((i) => (next.get(i.address) ?? []).some((at) => live.has(at))).map((i) => i.address),
  );
}

/** A reverse postorder lets sibling paths meet before their common continuation is analysed. */
function joinOrder(code: RoutineCode): Map<number, number> {
  const next = new Map<number, number[]>();
  for (const e of code.edges) if (e.to !== null) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const pending = [{ at: code.address, exit: false }],
    seen = new Set<number>(),
    order: number[] = [];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.exit) {
      order.push(item.at);
      continue;
    }
    if (seen.has(item.at)) continue;
    seen.add(item.at);
    pending.push({ at: item.at, exit: true });
    for (const to of next.get(item.at) ?? []) if (!seen.has(to)) pending.push({ at: to, exit: false });
  }
  return new Map(order.reverse().map((at, rank) => [at, rank]));
}

/** Straight-line return tails can finish pending paths when a larger branch consumes most of the visit budget. */
function returnTails(code: RoutineCode): Set<number> {
  const previous = new Map<number, number[]>(),
    next = new Map<number, number[]>();
  const instructions = new Map(code.instructions.map((i) => [i.address, i]));
  for (const edge of code.edges)
    if (edge.to !== null) {
      previous.set(edge.to, [...(previous.get(edge.to) ?? []), edge.from]);
      next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
    }
  const tails = new Set(code.instructions.filter((i) => ["ret", "retf"].includes(i.mnemonic)).map((i) => i.address));
  const pending = [...tails];
  while (pending.length)
    for (const at of previous.get(pending.pop()!) ?? []) {
      if (tails.has(at) || instructions.get(at)?.flow !== "next" || next.get(at)?.length !== 1) continue;
      tails.add(at);
      pending.push(at);
    }
  return tails;
}

/** Byte writes do not kill the other byte; calls conservatively consume registers as well as stacked arguments. */
function liveRegisters(code: RoutineCode): Map<number, Set<string>> {
  const parent = (name: string) => wordOfByte[name] ?? name,
    byAddress = new Map(code.instructions.map((i) => [i.address, i]));
  const next = new Map<number, number[]>(),
    previous = new Map<number, number[]>();
  for (const edge of code.edges)
    if (edge.to !== null) {
      next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
      previous.set(edge.to, [...(previous.get(edge.to) ?? []), edge.from]);
    }
  const lives = new Map<number, Set<string>>(),
    pending = code.instructions.map((i) => i.address),
    queued = new Set(pending);
  while (pending.length) {
    const at = pending.pop()!;
    queued.delete(at);
    const i = byAddress.get(at);
    if (!i) continue;
    const values = new Set((next.get(at) ?? []).flatMap((to) => [...(lives.get(to) ?? [])]));
    const [dest, source] = i.operands;
    const kill = (o: Operand | undefined) => {
      if (o?.kind === "register" && o.width === 16) values.delete(parent(o.name));
    };
    const use = (o: Operand | undefined) => {
      if (o?.kind === "register") values.add(parent(o.name));
      else if (o?.kind === "memory") {
        for (const base of o.base) values.add(base);
        values.add(o.segment);
      }
    };
    if (i.flow === "call")
      for (const name of ["ax", "bx", "cx", "dx", "si", "di", "bp", "sp", "ds", "es"]) values.add(name);
    else {
      if (!["cmp", "test", "push"].includes(i.mnemonic) && i.flow === "next") kill(dest);
      if (i.mnemonic === "xchg") kill(source);
      if (["mul", "imul", "div", "idiv"].includes(i.mnemonic)) {
        values.add("ax");
        values.add("dx");
      }
      if (["cwd", "cbw"].includes(i.mnemonic)) values.add("ax");
      if (i.flow === "return") values.add("ax");
      if (i.mnemonic.startsWith("loop") || i.mnemonic === "jcxz") values.add("cx");
      use(source);
      if (!["mov", "lea", "pop"].includes(i.mnemonic) || dest?.kind === "memory") use(dest);
      if (i.mnemonic === "push" || i.mnemonic === "pop" || i.flow === "return") values.add("sp");
    }
    const old = lives.get(at);
    if (!old || values.size !== old.size || [...values].some((name) => !old.has(name))) {
      lives.set(at, values);
      for (const from of previous.get(at) ?? [])
        if (!queued.has(from)) {
          pending.push(from);
          queued.add(from);
        }
    }
  }
  return lives;
}

/**
 * Analyses a routine as a graph of symbolic transfer functions. Each acyclic path is retained; a back edge is a
 * loss of information, not an invitation to run the loop. The finite path budget is reported whenever reached.
 */
export function analyseRoutine(image: Uint8Array, entry: CodeAddress, options: RoutineOptions = {}): RoutineAnalysis {
  const code = options.code ?? readRoutineCode(image, entry, options.dataSegment ?? 0);
  const carryNeeded = liveCarryOutputs(code);
  const stateOffset = options.stateOffset ?? 0x0c;
  const argumentOffset = options.argumentOffset ?? 6;
  const gearRun =
    options.codes && options.layout && options.objectArgument !== "collider" && argumentOffset === 6
      ? discoverGearRun(code, options.codes, options.engineSummaries ?? new Map(), options.layout)
      : undefined;
  const derivedValues: GearConflictValue[] = [];
  const writes: FieldWrite[] = [];
  const outcomes: RoutineOutcome[] = [];
  const iterationOutcomes: IterationOutcome[] = [];
  const engineCalls: NonNullable<RoutineAnalysis["engineCalls"]> = [];
  const controlFlowJoins: NonNullable<RoutineAnalysis["controlFlowJoins"]> = [];
  const provenLoops = discoverCountedLoops(code, options.engineSummaries ?? new Map(), stateOffset);
  const loopsByHeader = new Map(provenLoops.map((loop) => [loop.header, loop]));
  const findFirstLoops = discoverFindFirstLoops(code, options.engineSummaries ?? new Map());
  const usedLoops: LoopSummary[] = [];
  const firstArgumentOffset = code.instructions.some((instruction) => instruction.mnemonic === "retf") ? 6 : 4;
  const listLoopsByHeader = new Map(
    (options.objectArgument !== "collider" && argumentOffset === firstArgumentOffset
      ? discoverListLoops(code, options.engineSummaries ?? new Map(), stateOffset)
      : []
    ).map((loop) => [loop.header, loop]),
  );
  if (options.objectArgument !== "collider" && argumentOffset === firstArgumentOffset)
    for (const loop of discoverListLoops(code, options.engineSummaries ?? new Map(), stateOffset, true))
      if (!listLoopsByHeader.has(loop.header)) listLoopsByHeader.set(loop.header, loop);
  const usedListLoops: ListLoopSummary[] = [];
  const listConsumerCalls = new Map(
    discoverListConsumerCalls(code, options.engineSummaries ?? new Map()).map((c) => [c.instruction, c]),
  );
  const transitions: Transition[] = [];
  const comparisons: RoutineAnalysis["comparisons"] = [];
  const diagnostics = new Set(code.uncertainties);
  const pointerEvidence: Evidence[] = [];
  const pointerRegisters = new Set<string>();
  let uncertainEffects = code.status !== "complete";
  const instructions = new Map(code.instructions.map((i) => [i.address, i]));
  const precedingByEnd = new Map(code.instructions.map((i) => [i.address + i.size, i]));
  const incomingEdges = new Map<number, typeof code.edges>();
  for (const edge of code.edges) {
    if (edge.to == null) continue;
    const edges = incomingEdges.get(edge.to) ?? [];
    edges.push(edge);
    incomingEdges.set(edge.to, edges);
  }
  const farBridges = new Set(
    code.instructions
      .filter((i) => {
        const previous = precedingByEnd.get(i.address);
        const incoming = incomingEdges.get(i.address) ?? [];
        return (
          previous?.mnemonic === "push" &&
          previous.operands[0]?.kind === "register" &&
          previous.operands[0].name === "cs" &&
          previous.flow === "next" &&
          incoming.length === 1 &&
          incoming[0]?.from === previous.address
        );
      })
      .map((i) => i.address),
  );
  const sparseSwitches = new Map(
    code.edges
      .filter((edge) => edge.search)
      .map((edge) => [
        edge.search!.entry,
        code.edges.filter((candidate) => candidate.from === edge.from && candidate.search),
      ]),
  );
  const initial: AbstractState = {
    registers: new Map(),
    memory: new Map(),
    stack: [],
    conditions: [],
    evidence: [],
    visited: new Set(),
    stateWritten: false,
    uncertain: false,
    havoc: false,
    assumptions: [],
  };
  initial.registers.set("ds", tracked(constant(options.dataSegment ?? 0)));
  initial.registers.set("cs", tracked(constant(entry.segment)));
  initial.registers.set("sp", tracked({ kind: "stack", displacement: 0, width: 16 }));

  const registerRead = (name: string, s: AbstractState): Tracked => {
    const exact = s.registers.get(name);
    if (exact) return exact;
    const parent = wordOfByte[name];
    if (parent) {
      const whole = s.registers.get(parent);
      if (whole)
        return tracked(
          binary(
            "&",
            name.endsWith("h") ? binary(">>>", asExpression(whole.value), constant(8)) : asExpression(whole.value),
            constant(255),
            8,
          ),
          whole.evidence,
        );
    }
    return tracked(
      unknown(`Register ${name} has no established value`, name.length === 2 && /[lh]$/.test(name) ? 8 : 16),
    );
  };
  const registerWrite = (name: string, value: Tracked, s: AbstractState) => {
    s.registers.set(name, value);
    const parent = wordOfByte[name];
    if (parent) {
      const other = name[0] + (name.endsWith("h") ? "l" : "h");
      const sibling = s.registers.get(other) ?? (s.registers.has(parent) ? registerRead(other, s) : undefined);
      if (sibling && sibling.value.kind !== "pointer" && sibling.value.kind !== "stack") {
        const low = name.endsWith("l") ? asExpression(value.value) : asExpression(sibling.value);
        const high = name.endsWith("h") ? asExpression(value.value) : asExpression(sibling.value);
        s.registers.set(
          parent,
          tracked(
            binary("|", binary("&", low, constant(255)), binary("<<", high, constant(8), 16), 16),
            uniqueEvidence([...value.evidence, ...sibling.evidence]),
          ),
        );
      } else s.registers.delete(parent);
    } else for (const [child, whole] of Object.entries(wordOfByte)) if (whole === name) s.registers.delete(child);
    if (value.value.kind === "pointer") {
      pointerRegisters.add(name);
      pointerEvidence.push(...value.evidence);
    }
  };
  const location = (operand: Extract<Operand, { kind: "memory" }>, s: AbstractState): Location | undefined => {
    const base = operand.base.map((r) => registerRead(r, s));
    // A BP-relative stack argument is only recognised while BP still denotes the entry stack frame.
    if (operand.segment === "ss" && operand.base.length === 1 && base[0]?.value.kind === "stack")
      return {
        object: "stack",
        offset: operand.displacement + base[0].value.displacement,
        width: operand.width,
        uncertain: false,
        evidence: base[0].evidence,
      };
    const addressView = (value: Value): Pointer | undefined => {
      if (value.kind === "pointer") return value;
      if (value.kind === "table")
        return {
          kind: "pointer",
          object: `pointer loaded from table ${hex(value.segment)}+${hex(value.offset)} indexed by ${textOf(value.index)}`,
          displacement: 0,
          width: 16,
          addressValue: value,
        };
      if (value.kind === "field" && value.object !== "stack" && !scanLocal(value.object))
        return {
          kind: "pointer",
          object: `referenced-by(${value.object}+${hex(value.offset)})`,
          displacement: 0,
          width: 16,
          addressValue: value,
        };
      if (value.kind === "binary" && ["+", "-"].includes(value.operator) && value.right.kind === "constant") {
        const source = addressView(value.left);
        if (source)
          return {
            ...source,
            displacement: source.displacement + (value.operator === "+" ? value.right.value : -value.right.value),
            addressValue: value,
          };
      }
      return undefined;
    };
    const addressBases = base.map((value) => {
      const pointer = addressView(value.value);
      return pointer ? { ...value, value: pointer } : value;
    });
    const pointer = addressBases.find((v) => v.value.kind === "pointer");
    if (
      pointer &&
      pointer.value.kind === "pointer" &&
      addressBases.filter((v) => v !== pointer).every((v) => v.value.kind === "constant")
    ) {
      const seg = registerRead(operand.segment, s).value;
      const validSegment =
        operand.segment === "ds" && seg.kind === "constant" && seg.value === (options.dataSegment ?? 0);
      // LES/LDS explicitly associates the segment register with the same far pointer.
      const paired = seg.kind === "pointer" && seg.object === pointer.value.object;
      if (!validSegment && !paired) return undefined;
      return {
        object: pointer.value.object,
        offset: unsigned(
          pointer.value.displacement +
            operand.displacement +
            addressBases
              .filter((v) => v !== pointer)
              .reduce((n, v) => n + (v.value.kind === "constant" ? v.value.value : 0), 0),
          16,
        ),
        width: operand.width,
        uncertain: pointer.value.object !== "part",
        evidence: base.flatMap((v) => v.evidence),
      };
    }
    const currentSegment = registerRead(operand.segment, s).value;
    const normalData =
      operand.segment === "ds" &&
      currentSegment.kind === "constant" &&
      currentSegment.value === (options.dataSegment ?? 0);
    if (normalData && base.length === 1 && base[0]?.value.kind === "field") {
      const ref = base[0].value;
      if (ref.object !== "stack" && !scanLocal(ref.object))
        return {
          object: `referenced-by(${ref.object}+${hex(ref.offset)})`,
          offset: operand.displacement,
          width: operand.width,
          uncertain: true,
          evidence: base[0].evidence,
        };
    }
    if (!base.length && normalData)
      return { object: "data", offset: operand.displacement, width: operand.width, uncertain: false, evidence: [] };
    return undefined;
  };
  const readUnrefined = (operand: Operand | undefined, s: AbstractState): Tracked => {
    if (!operand) return tracked(unknown("Missing operand"));
    if (operand.kind === "register") return registerRead(operand.name, s);
    if (operand.kind === "immediate") return tracked(constant(unsigned(operand.value, operand.width), operand.width));
    if (operand.kind === "address") return tracked(constant(operand.address));
    const l = location(operand, s);
    const cached = l && s.memory.get(memoryKey(l));
    if (cached) {
      if (cached.value.kind === "unknown" && l && l.object !== "stack") {
        // The value is unresolved, but repeated reads still denote the same post-write storage value.
        return tracked(
          {
            ...field(
              `${l.object} after unresolved write at ${hex(cached.writtenAt ?? s.havocAt ?? entry.address)}`,
              l.offset,
              l.width,
            ),
            unresolved: true,
          } as Expression,
          cached.evidence,
        );
      }
      return cached;
    }
    if (
      l &&
      !["stack", "data"].includes(l.object) &&
      (s.havoc ||
        s.partMemoryHavocAt !== undefined ||
        s.fieldHavoc?.some((f) => l.offset < f.offset + f.width / 8 && f.offset < l.offset + l.width / 8))
    ) {
      // A partial store supersedes an earlier field version even when no exact-width cell remains cached.
      for (const [key, cell] of [...s.memory].reverse()) {
        const parts = key.split(":"),
          width = Number(parts.pop()),
          offset = Number(parts.pop()),
          object = parts.join(":");
        if (
          object !== l.object ||
          cell.writtenAt === undefined ||
          offset >= l.offset + l.width / 8 ||
          l.offset >= offset + width / 8
        )
          continue;
        if (offset <= l.offset && offset + width / 8 >= l.offset + l.width / 8 && cell.value.kind === "constant")
          return tracked(
            constant(unsigned(cell.value.value >>> ((l.offset - offset) * 8), l.width), l.width),
            cell.evidence,
          );
        return tracked(
          {
            ...field(`${l.object} after overlapping write at ${hex(cell.writtenAt)}`, l.offset, l.width),
            unresolved: true,
          } as Expression,
          cell.evidence,
        );
      }
    }
    if (l?.object === "stack") {
      // PUSH BP; MOV BP,SP makes BP entry-SP minus two. A far return occupies four bytes.
      const frameOffset = l.offset + 2;
      if (frameOffset === argumentOffset)
        return tracked(
          { kind: "pointer", object: options.objectArgument ?? "part", displacement: 0, width: 16 },
          l.evidence,
        );
      if (frameOffset > 0) return tracked(field("argument", frameOffset, operand.width), l.evidence);
    }
    if (l) {
      const scoped =
        !["stack", "data"].includes(l.object) &&
        [...(s.fieldHavoc ?? [])]
          .reverse()
          .find(
            (effect) =>
              !(effect.exceptOwner && l.object === "part") &&
              (!effect.ownerOnly ||
                (l.object === "part" && l.offset >= stateOffset && l.offset + l.width / 8 <= stateOffset + 2)) &&
              l.offset < effect.offset + effect.width / 8 &&
              effect.offset < l.offset + l.width / 8,
          );
      if (scoped)
        return tracked(
          {
            ...field(`${l.object} after field effect at ${hex(scoped.address)}`, l.offset, l.width),
            unresolved: true,
          } as Expression,
          l.evidence,
        );
      if (l.object === "collider" && l.offset === options.ownerLink)
        return tracked({ kind: "pointer", object: "part", displacement: 0, width: 16 }, l.evidence);
      return tracked(
        l.object !== "stack" &&
          (s.havoc ||
            (l.object === "data" && s.globalHavocAt !== undefined) ||
            (l.object !== "data" &&
              s.partMemoryHavocAt !== undefined &&
              !(l.object === "part" && l.offset >= stateOffset && l.offset + l.width / 8 <= stateOffset + 2)))
          ? ({
              ...field(
                `${l.object} after unresolved effect at ${hex(l.object === "data" ? (s.globalHavocAt ?? s.havocAt ?? entry.address) : (s.partMemoryHavocAt ?? s.havocAt ?? entry.address))}`,
                l.offset,
                l.width,
              ),
              unresolved: true,
            } as Expression)
          : field(l.object, l.offset, l.width),
        l.evidence,
      );
    }
    const seg = registerRead(operand.segment, s).value;
    const base = operand.base.map((r) => registerRead(r, s));
    if (seg.kind === "constant" && base.every((v) => v.value.kind !== "stack")) {
      const index = base.reduce<Expression>((a, b) => binary("+", a, asExpression(b.value)), constant(0));
      if (operand.segment === "cs" && index.kind === "constant") {
        const at = seg.value * 16 + unsigned(index.value + operand.displacement, 16);
        if (operand.width <= 16 && at + operand.width / 8 <= image.length) {
          const value = image[at]! | (operand.width === 16 ? image[at + 1]! << 8 : 0);
          return tracked(constant(value, operand.width), [
            ...base.flatMap((v) => v.evidence),
            {
              address: at,
              bytes: [...image.slice(at, at + operand.width / 8)],
              text: `constant table entry used by ${operand.segment} load`,
            },
          ]);
        }
      }
      return tracked(
        { kind: "table", segment: seg.value, offset: operand.displacement, index, width: operand.width },
        base.flatMap((v) => v.evidence),
      );
    }
    return tracked(
      unknown(
        `Cannot resolve ${operand.segment}:[${operand.base.join("+")}+${hex(operand.displacement)}]`,
        operand.width,
      ),
      base.flatMap((v) => v.evidence),
    );
  };
  /**
   * A path's evidence without repeats, kept per path list and extended as the path grows, so the findings along a long
   * path don't each go through the whole list again. A path only ever appends to its list.
   */
  const pathEvidence = new WeakMap<Evidence[], { length: number; byAddress: Map<number, Evidence> }>();
  const evidenceOfPath = (list: Evidence[], extra: Evidence[]): Evidence[] => {
    let cached = pathEvidence.get(list);
    if (!cached || cached.length > list.length) {
      cached = { length: 0, byAddress: new Map() };
      pathEvidence.set(list, cached);
    }
    for (let n = cached.length; n < list.length; n++) cached.byAddress.set(list[n]!.address, list[n]!);
    cached.length = list.length;
    if (!extra.length) return [...cached.byAddress.values()];
    const byAddress = new Map(cached.byAddress);
    for (const item of extra) byAddress.set(item.address, item);
    return [...byAddress.values()];
  };
  const finding = (value: Expression, condition: Predicate, s: AbstractState, extra: Evidence[]): Finding => ({
    confidence: containsUnknown(value) || uncertainPredicate(condition) || s.uncertain ? "unresolved" : "inferred",
    assumptions: [
      "The stack argument identified by the dispatch is the part object.",
      "Memory not written on this path retains its input value.",
      ...s.assumptions,
    ],
    evidence: evidenceOfPath(s.evidence, extra),
  });
  const equalities = new WeakMap<Predicate[], { length: number; values: Map<string, Expression> }>();
  const fieldIdentity = (value: Extract<Expression, { kind: "field" }>) =>
    JSON.stringify([value.object, value.offset, value.width, value.unresolved === true]);
  const read = (operand: Operand | undefined, s: AbstractState): Tracked => {
    const result = readUnrefined(operand, s);
    if (result.value.kind === "pointer" || result.value.kind === "stack" || !s.conditions.length) return result;
    let bindings = equalities.get(s.conditions);
    if (!bindings || bindings.length !== s.conditions.length) {
      const values = new Map<string, Expression>();
      const terms = conjunction(s.conditions);
      for (const term of terms.kind === "and" ? terms.terms : []) {
        if (term.kind !== "compare" || term.operator !== "==") continue;
        const field = term.left.kind === "field" ? term.left : term.right.kind === "field" ? term.right : undefined;
        const literal =
          term.left.kind === "constant" ? term.left : term.right.kind === "constant" ? term.right : undefined;
        if (!field || !literal) continue;
        const key = fieldIdentity(field),
          value = constant(unsigned(literal.value, field.width), field.width),
          before = values.get(key);
        values.set(key, before && !same(before, value) ? unknown("Contradictory path equalities", field.width) : value);
      }
      bindings = { length: s.conditions.length, values };
      equalities.set(s.conditions, bindings);
    }
    if (!bindings.values.size) return result;
    const refine = (value: Expression): Expression => {
      if (value.kind === "field") return bindings!.values.get(fieldIdentity(value)) ?? value;
      if (value.kind === "binary") {
        const left = refine(value.left),
          right = refine(value.right);
        return left === value.left && right === value.right ? value : binary(value.operator, left, right, value.width);
      }
      if (value.kind === "table") {
        const index = refine(value.index);
        return index === value.index ? value : { ...value, index };
      }
      return value;
    };
    const value = refine(result.value);
    if (value !== result.value)
      s.assumptions = [
        ...new Set([
          ...s.assumptions,
          "Exact field equalities from earlier compares substitute only the same symbolic input or post-write storage version; later stores do not retroactively change that earlier value.",
        ]),
      ];
    return value === result.value ? result : { ...result, value };
  };
  const write = (operand: Operand | undefined, value: Tracked, s: AbstractState, i: Instruction) => {
    if (!operand) return;
    const e = uniqueEvidence([...value.evidence, evidenceOf(i)]);
    // What a value is known to be beyond its expression goes with it when it is copied whole.
    const kept = {
      ...(value.directedSpeed ? { directedSpeed: value.directedSpeed } : {}),
      ...(value.centreAngle ? { centreAngle: value.centreAngle } : {}),
    };
    if (operand.kind === "register") {
      // A velocity copied out of a field is no longer the field the setter wrote.
      registerWrite(
        operand.name,
        { ...tracked(value.value, e), ...(kept.centreAngle ? { centreAngle: kept.centreAngle } : {}) },
        s,
      );
      return;
    }
    if (operand.kind !== "memory") return;
    let l = location(operand, s);
    if (!l) {
      l = { object: "unknown", offset: operand.displacement, width: operand.width, uncertain: true, evidence: [] };
      diagnostics.add(`Object pointer is lost at ${hex(i.address)}: ${i.text}`);
      s.uncertain = true;
      uncertainEffects = true;
      // An untracked address may alias the owner; stale field values cannot constrain later branches.
      for (const key of s.memory.keys()) if (!key.startsWith("stack:")) s.memory.delete(key);
      s.memory.set(
        `part:${stateOffset}:16`,
        tracked(unknown(`A store through an untracked pointer at ${hex(i.address)} may change the state`), [
          evidenceOf(i),
        ]),
      );
      s.stateWritten = true;
      s.havoc = true;
      s.fieldHavoc = undefined;
      s.havocAt = i.address;
      s.partMemoryHavocAt = undefined;
      s.globalHavocAt = i.address;
    }
    const condition = conjunction(s.conditions);
    const expr = asExpression(value.value);
    const f = finding(expr, condition, s, [...e, ...l.evidence]);
    if (l.uncertain) f.confidence = "unresolved";
    if (!["stack", "data"].includes(l.object))
      writes.push({
        ...f,
        object: l.object,
        offset: l.offset,
        width: l.width,
        value: expr,
        condition,
        routine: entry.address,
      });
    // Invalidate overlapping cached fields, including writes through a byte alias.
    for (const [key] of s.memory) {
      const split = key.lastIndexOf(":"),
        before = key.slice(0, split),
        separator = before.lastIndexOf(":");
      const object = before.slice(0, separator),
        at = Number(before.slice(separator + 1)),
        width = Number(key.slice(split + 1));
      if (object === l.object && at < l.offset + l.width / 8 && l.offset < at + width / 8) s.memory.delete(key);
    }
    s.memory.set(memoryKey(l), { ...tracked(value.value, uniqueEvidence([...e, ...l.evidence]), i.address), ...kept });
    if (l.object === "part" && l.offset === stateOffset) {
      s.stateWritten = true;
      s.evidence.push(...e);
    }
  };
  const negate = (predicate: Predicate): Predicate => {
    if (predicate.kind !== "compare")
      return { kind: "unknown", reason: "The predicate's complement is not represented" };
    return {
      ...predicate,
      operator: ({ "==": "!=", "!=": "==", "<": ">=", ">=": "<", "<=": ">", ">": "<=" } as Record<string, string>)[
        predicate.operator
      ]!,
    };
  };
  const entails = (predicate: Predicate, s: AbstractState): boolean => {
    if (predicate.kind === "true") return true;
    if (predicate.kind === "unknown") return false;
    if (predicate.kind === "and") return predicate.terms.every((term) => entails(term, s));
    return compareConstants(predicate) === true || !possible(conjunction([...s.conditions, negate(predicate)]));
  };
  const memoryAt = (pointer: Tracked, offset: number, width: number, s: AbstractState): Tracked => {
    const temporary = "__formal_pointer";
    const previous = s.registers.get(temporary);
    s.registers.set(temporary, pointer);
    const result = read(
      {
        kind: "memory",
        segment: "ds",
        base: [temporary],
        displacement: offset,
        direct: false,
        width: width === 8 ? 8 : 16,
      },
      s,
    );
    if (previous) s.registers.set(temporary, previous);
    else s.registers.delete(temporary);
    return result;
  };
  const formalArgument = (args: Tracked[], base: number, offset: number): Tracked =>
    args.at(-1 - (offset - base) / 2) ?? tracked(unknown(`Argument at frame offset ${offset} was not passed`));
  const formalObject = (
    object: string,
    args: Tracked[],
    base: number,
    s: AbstractState,
    ownerOffset = base,
  ): Tracked => {
    if (object === "part") return formalArgument(args, base, ownerOffset);
    const nested = /^referenced-by\((.*)\+0x([0-9a-f]+)\)$/.exec(object);
    if (nested) return memoryAt(formalObject(nested[1]!, args, base, s, ownerOffset), parseInt(nested[2]!, 16), 16, s);
    return tracked(unknown(`Object identity ${object} is not mapped in the caller`));
  };
  const formalValue = (
    expression: Expression,
    args: Tracked[],
    base: number,
    s: AbstractState,
    ownerOffset = base,
  ): Tracked => {
    if (expression.kind === "constant" || expression.kind === "unknown") return tracked(expression);
    const stepHint = scalarSteps.get(expression);
    if (stepHint) {
      const input = formalValue(stepHint.input, args, base, s, ownerOffset),
        value = asExpression(input.value);
      if (value.kind === "constant") {
        const n = stepHint.signed
          ? signed(value.value, stepHint.input.width)
          : unsigned(value.value, stepHint.input.width);
        const interval = stepHint.intervals.find((p) => n >= p.low && n <= p.high);
        if (interval) return tracked(constant(interval.value, stepHint.width), input.evidence);
      }
      const low = stepHint.signed ? -(2 ** (value.width - 1)) : 0,
        high = stepHint.signed ? 2 ** (value.width - 1) - 1 : 2 ** value.width - 1;
      const mapped = compileScalarStep(
        stepHint.intervals.map((p) => ({
          value: constant(p.value, stepHint.width),
          condition: conjunction([
            ...(p.low > low
              ? [
                  {
                    kind: "compare" as const,
                    operator: ">=",
                    left: value,
                    right: constant(p.low, value.width),
                    signed: stepHint.signed,
                  },
                ]
              : []),
            ...(p.high < high
              ? [
                  {
                    kind: "compare" as const,
                    operator: "<=",
                    left: value,
                    right: constant(p.high, value.width),
                    signed: stepHint.signed,
                  },
                ]
              : []),
          ]),
        })),
        binary,
      );
      if (mapped) {
        if (mapped.expression.kind !== "constant") scalarSteps.set(mapped.expression, mapped);
        return tracked(mapped.expression, input.evidence);
      }
    }

    if (expression.kind === "field") {
      if (expression.object.startsWith("address of ")) {
        const pointer = formalObject(expression.object.slice("address of ".length), args, base, s, ownerOffset);
        return tracked(asExpression(pointer.value), pointer.evidence);
      }
      if (expression.object === "argument") return formalArgument(args, base, expression.offset);
      if (expression.object === "data")
        return read(
          {
            kind: "memory",
            segment: "ds",
            base: [],
            displacement: expression.offset,
            direct: true,
            width: expression.width === 8 ? 8 : 16,
          },
          s,
        );
      return memoryAt(
        formalObject(expression.object, args, base, s, ownerOffset),
        expression.offset,
        expression.width,
        s,
      );
    }
    if (expression.kind === "binary") {
      const left = formalValue(expression.left, args, base, s, ownerOffset);
      const right = formalValue(expression.right, args, base, s, ownerOffset);
      return tracked(
        binary(expression.operator, asExpression(left.value), asExpression(right.value), expression.width),
        uniqueEvidence([...left.evidence, ...right.evidence]),
      );
    }
    const index = formalValue(expression.index, args, base, s, ownerOffset);
    return tracked({ ...expression, index: asExpression(index.value) }, index.evidence);
  };
  const formalPredicate = (
    predicate: Predicate,
    args: Tracked[],
    base: number,
    s: AbstractState,
    ownerOffset = base,
  ): Predicate => {
    if (predicate.kind === "compare")
      return {
        ...predicate,
        left: asExpression(formalValue(predicate.left, args, base, s, ownerOffset).value),
        right: asExpression(formalValue(predicate.right, args, base, s, ownerOffset).value),
      };
    if (predicate.kind === "and")
      return conjunction(predicate.terms.map((p) => formalPredicate(p, args, base, s, ownerOffset)));
    return predicate;
  };
  const pointerResult = (
    pointer: EnginePointer,
    args: Tracked[],
    base: number,
    s: AbstractState,
    i: Instruction,
  ): Tracked => {
    if (pointer.kind === "constant") return tracked(constant(pointer.value));
    if (pointer.kind === "argument") {
      let value = formalArgument(args, base, pointer.argument);
      for (const offset of pointer.path) value = memoryAt(value, offset, 16, s);
      if (pointer.displacement) {
        if (value.value.kind === "pointer")
          value = tracked(
            { ...value.value, displacement: value.value.displacement + pointer.displacement },
            value.evidence,
          );
        else value = tracked(unknown("An indexed returned pointer has no established base"), value.evidence);
      }
      return value;
    }
    if (pointer.kind === "global")
      return tracked({
        kind: "pointer",
        object: `related part returned at ${hex(i.address)}`,
        displacement: 0,
        width: 16,
        addressValue: field("data", pointer.offset),
      });
    if (pointer.kind === "fresh")
      return tracked({
        kind: "pointer",
        object: `${pointer.name} returned at ${hex(i.address)}`,
        displacement: 0,
        width: 16,
        addressValue: field(`result of ${pointer.name} at ${hex(i.address)}`, 0),
      });
    return tracked(unknown("The engine routine's returned pointer remains unresolved"));
  };
  const privateOutputsByCall = new Map<number, ReturnType<typeof privateStackOutputs>>();
  const scalarDefinitions = new Map<RoutineAnalysis, ScalarStep | null>();
  const scalarDefinition = (routine: RoutineAnalysis) => {
    if (scalarDefinitions.has(routine)) return scalarDefinitions.get(routine);
    const step =
      pureScalarFrame(routine) && routine.outcomes?.every((o) => !o.returnPointer)
        ? compileScalarStep(
            routine.outcomes.map((o) => ({ condition: o.condition, value: o.returnValue })),
            binary,
          )
        : undefined;
    scalarDefinitions.set(routine, step ?? null);
    if (step && step.expression.kind !== "constant") scalarSteps.set(step.expression, step);
    return step;
  };
  const invalidateSelectedPartFields = (
    fields: { offset: number; width: number }[],
    s: AbstractState,
    i: Instruction,
    proof: Evidence[],
    preserveOwner: Set<number> = new Set(),
    selectedObject = "a connected part",
    selectedCondition?: Predicate,
  ) => {
    for (const effect of fields) {
      const exceptOwner = preserveOwner.has(effect.offset);
      s.fieldHavoc = [...(s.fieldHavoc ?? []), { ...effect, address: i.address, exceptOwner }];
      for (const key of s.memory.keys()) {
        const parts = key.split(":"),
          width = Number(parts.pop()),
          offset = Number(parts.pop()),
          object = parts.join(":");
        if (
          !["stack", "data"].includes(object) &&
          !(exceptOwner && object === "part") &&
          offset < effect.offset + effect.width / 8 &&
          effect.offset < offset + width / 8
        )
          s.memory.delete(key);
      }
      if (!exceptOwner)
        s.memory.set(
          `part:${effect.offset}:${effect.width}`,
          tracked(
            unknown(
              selectedObject === "a connected part"
                ? "A connected part may alias the owner"
                : "A selected related object may alias the owner",
              effect.width,
            ),
            proof,
            i.address,
          ),
        );
      const name = selectedObject;
      s.registers.set("__graph_pointer", tracked({ kind: "pointer", object: name, displacement: 0, width: 16 }, proof));
      if (selectedCondition) s.conditions.push(selectedCondition);
      write(
        {
          kind: "memory",
          segment: "ds",
          base: ["__graph_pointer"],
          displacement: effect.offset,
          direct: false,
          width: effect.width === 8 ? 8 : 16,
        },
        tracked(
          unknown(
            selectedObject === "a connected part"
              ? "A connected part may change this field"
              : "A selected related object may change this field",
            effect.width,
          ),
          proof,
          i.address,
        ),
        s,
        i,
      );
      if (selectedCondition) s.conditions.pop();
      s.registers.delete("__graph_pointer");
    }
  };
  const angleFrameMatches = (engine: EngineSummary | undefined, i: Instruction): boolean => {
    if (
      !engine ||
      (!engine.contactResponse &&
        !engine.contactRotation &&
        !engine.rotationScalar &&
        !engine.contactResponseFirst &&
        !engine.contactResponsePair &&
        !engine.numeric &&
        !["angle-sector", "saved-angle-gate", "contact-motion-angle"].includes(engine.kind))
    )
      return true;
    const previous = precedingByEnd.get(i.address);
    const segmentPush =
      previous?.mnemonic === "push" && previous.operands[0]?.kind === "register" && previous.operands[0].name === "cs";
    const farBridge = farBridges.has(i.address);
    const convention = engine.returnConvention;
    return (
      !!convention &&
      !convention.stackBytes &&
      (convention.kind === "far" ? !!(i.far || farBridge) : !i.far && !segmentPush)
    );
  };
  const applyEngine = (engine: EngineSummary, args: Tracked[], s: AbstractState, i: Instruction): boolean => {
    if (!angleFrameMatches(engine, i)) return false;
    const passed = args.at(-1)?.value;
    const completeMember =
      s.observationOnly &&
      passed?.kind === "pointer" &&
      passed.object === s.observationObject &&
      passed.displacement === 0 &&
      engine.footprint.partMemoryComplete === true;
    if (engine.partGraph) {
      const owner = formalArgument(args, engine.argumentOffset, engine.partGraph.objectArguments[0]!).value;
      if (owner.kind !== "pointer" || owner.object !== "part" || owner.displacement !== 0) return false;
      for (const argument of engine.partGraph.objectArguments.slice(1)) {
        const value = formalArgument(args, engine.argumentOffset, argument).value;
        if (
          !(value.kind === "pointer" && value.displacement === 0) &&
          !(value.kind === "field" && value.object === "part" && engine.partGraph.links.includes(value.offset))
        )
          return false;
      }
    }
    const call = code.calls.find((call) => call.instruction === i.address);
    if (engine.kind === "argument-buffer-update" && call && !privateOutputsByCall.has(i.address))
      privateOutputsByCall.set(i.address, privateStackOutputs(code, call, engine));
    const privateOutput = engine.kind === "argument-buffer-update" ? privateOutputsByCall.get(i.address) : undefined;
    if (
      !engine.footprint.preservesPartState &&
      !engine.footprint.preservesArgumentMemory &&
      !completeMember &&
      !engine.partGraph?.stateCases &&
      !privateOutput
    )
      return false;
    if (privateOutput) {
      s.assumptions = [...new Set([...s.assumptions, ...privateOutput.assumptions])];
      for (const output of privateOutput.outputs)
        write(
          {
            kind: "memory",
            segment: "ss",
            base: ["bp"],
            displacement: output.offset,
            direct: false,
            width: output.width === 8 ? 8 : 16,
          },
          tracked(
            unknown("The helper may update this private output; its numeric relation is unresolved", output.width),
            privateOutput.evidence,
          ),
          s,
          i,
        );
    }
    const first = args.at(-1)?.value;
    if (!engine.numeric && engine.argumentKind === "scalar" && (first?.kind === "pointer" || first?.kind === "stack"))
      return false;
    let numericResult: { low: Tracked; high: Tracked } | undefined;
    if (engine.numeric) {
      const count = registerRead(engine.numeric.count, s);
      if (
        count.value.kind === "constant" &&
        count.value.value >= engine.numeric.minimumCount &&
        count.value.value <= engine.numeric.maximumCount
      ) {
        const low = registerRead(engine.numeric.low, s),
          high = registerRead(engine.numeric.high, s);
        const combined = binary(
          "|",
          binary("<<", asExpression(high.value), constant(16), 32),
          asExpression(low.value),
          32,
        );
        const shifted = binary(
          engine.numeric.operation === "leftShift32" ? "<<" : ">>",
          combined,
          constant(count.value.value),
          32,
        );
        const proof = uniqueEvidence([
          ...low.evidence,
          ...high.evidence,
          ...count.evidence,
          evidenceOf(i),
          ...engine.evidence,
        ]);
        numericResult = {
          low: tracked(binary("&", shifted, constant(0xffff), 16), proof),
          high: tracked(binary("&", binary(">>>", shifted, constant(16), 32), constant(0xffff), 16), proof),
        };
      }
    }
    s.assumptions = [...new Set([...s.assumptions, ...engine.assumptions])];
    s.evidence.push(evidenceOf(i), ...(engine.listConsumerScope?.evidence ?? []));
    engineCalls.push({
      instruction: i.address,
      summary: engine.address,
      purpose: engine.purpose,
      confidence: engine.confidence,
      assumptions: engine.assumptions,
      evidence: [evidenceOf(i), ...(engine.listConsumerScope ? engine.evidence : engine.evidence.slice(0, 1))],
      ...(engine.listConsumerScope ? { listContext: engine.listConsumerScope } : {}),
    });
    const globals = engine.writes
      .filter(
        (effect) =>
          effect.root === "global" && (effect.segment === undefined || effect.segment === (options.dataSegment ?? 0)),
      )
      .map((effect) => ({
        effect,
        condition: formalPredicate(effect.condition, args, engine.argumentOffset, s),
        value: formalValue(effect.value, args, engine.argumentOffset, s),
      }));
    const pending: {
      pointer: Tracked;
      offset: number;
      width: number;
      value: Tracked;
      evidence: Evidence[];
      condition: Predicate;
      certain: boolean;
    }[] = [];
    for (const effect of privateOutput ? [] : engine.writes) {
      if (effect.root !== "argument" || effect.path.some((offset) => offset < 0) || effect.repeated) continue;
      let pointer = formalArgument(args, engine.argumentOffset, effect.argumentOffset ?? engine.argumentOffset);
      for (const offset of effect.path) pointer = memoryAt(pointer, offset, 16, s);
      const condition = formalPredicate(effect.condition, args, engine.argumentOffset, s);
      if (!possible(conjunction([...s.conditions, condition]))) continue;
      const value = formalValue(effect.value, args, engine.argumentOffset, s);
      pending.push({
        pointer,
        offset: effect.offset,
        width: effect.width,
        value,
        evidence: effect.evidence,
        condition,
        certain: entails(condition, s),
      });
    }
    if ((engine.contactResponseFirst || engine.contactResponsePair) && engine.footprint.partMemoryComplete) {
      // Either participant can alias an already tracked part. Invalidate the complete possible footprint first.
      const fields = new Map(
        engine.writes
          .filter((effect) => effect.root === "argument")
          .map((effect) => [`${effect.offset}:${effect.width}`, { offset: effect.offset, width: effect.width }]),
      );
      invalidateSelectedPartFields(
        [...fields.values()],
        s,
        i,
        engine.evidence,
        new Set(),
        `an object written by a contact response at ${hex(i.address)}`,
      );
    }
    if (engine.partGraph) {
      const preserve = new Set<number>();
      const offset = engine.partGraph.preservesNonzeroOwnerField;
      if (
        offset !== undefined &&
        entails(
          {
            kind: "compare",
            operator: "!=",
            left: asExpression(
              memoryAt(formalArgument(args, engine.argumentOffset, engine.argumentOffset), offset, 16, s).value,
            ),
            right: constant(0),
            signed: false,
          },
          s,
        )
      )
        preserve.add(offset);
      invalidateSelectedPartFields(engine.partGraph.fields, s, i, engine.evidence, preserve);
    }
    if (engine.connected) {
      // Parts reached through ropes, belts or pulleys may be the owner itself, so their fields are forgotten everywhere.
      // A part that passed itself as the asking argument keeps the fields a question that comes back can't change.
      const asking =
        engine.connected.exceptArgument === undefined
          ? undefined
          : formalArgument(args, engine.argumentOffset, engine.connected.exceptArgument).value;
      const askingIsOwner = asking?.kind === "pointer" && asking.object === "part" && asking.displacement === 0;
      invalidateSelectedPartFields(
        engine.connected.partFields,
        s,
        i,
        engine.connected.evidence,
        new Set(askingIsOwner ? askingKeeps(engine.connected) : []),
        `a part reached through a rope, belt or pulley at ${hex(i.address)}`,
      );
      // A field a question that comes back may change holds one value after the call, which the walks can name.
      if (askingIsOwner)
        for (const asked of engine.connected.askingFields ?? [])
          s.memory.set(
            `part:${asked.offset}:${asked.width}`,
            tracked(
              {
                ...field(`part after the query at ${hex(i.address)}`, asked.offset, asked.width),
                unresolved: true,
              } as Expression,
              [evidenceOf(i)],
              i.address,
            ),
          );
      // Rope, belt and pulley records are separate allocations; only objects reached through those links can be one.
      const link = new RegExp(
        `\\+0x(${engine.connected.recordLinks.map((offset) => offset.toString(16)).join("|")})\\)$`,
      );
      for (const key of [...s.memory.keys()]) {
        const parts = key.split(":"),
          width = Number(parts.pop()),
          offset = Number(parts.pop()),
          object = parts.join(":");
        if (
          link.test(object) &&
          engine.connected.recordFields.some(
            (field) => offset < field.offset + field.width / 8 && field.offset < offset + width / 8,
          )
        )
          s.memory.delete(key);
      }
      s.assumptions = [...new Set([...s.assumptions, ...engine.connected.assumptions])];
    }
    if (engine.globalObjectWrites?.length) {
      invalidateSelectedPartFields(
        engine.globalObjectWrites,
        s,
        i,
        engine.evidence,
        new Set(),
        `the contact subject selected through engine globals at ${hex(i.address)}`,
      );
    }
    const poolNode = poolNodeEffect(engine, s.memory);
    if (poolNode) {
      // The pool's nodes are separate storage, so they are never the owner. Any other object the caller holds might be
      // a node, and forgets the node's bytes: the pool update can change nothing else.
      for (const key of [...s.memory.keys()]) {
        const { object, offset } = keyParts(key);
        if (!["stack", "data", "part"].includes(object) && offset < poolNode.nodeSize) s.memory.delete(key);
      }
      for (let offset = 0; offset < poolNode.nodeSize; offset += 2)
        s.fieldHavoc = [...(s.fieldHavoc ?? []), { offset, width: 16, address: i.address, exceptOwner: true }];
      s.assumptions = [
        ...new Set([
          ...s.assumptions,
          "The owner is a live part, never a node of the pool, and every pointer to a node points to its start.",
        ]),
      ];
    } else if (!engine.footprint.preservesArgumentMemory && engine.footprint.partMemoryComplete !== true) {
      for (const key of s.memory.keys()) {
        const split = key.lastIndexOf(":"),
          before = key.slice(0, split),
          separator = before.lastIndexOf(":");
        const object = before.slice(0, separator),
          offset = Number(before.slice(separator + 1)),
          width = Number(key.slice(split + 1));
        if (
          !["stack", "data"].includes(object) &&
          !(object === "part" && offset >= stateOffset && offset + width / 8 <= stateOffset + 2)
        )
          s.memory.delete(key);
      }
      s.fieldHavoc = s.fieldHavoc
        ?.filter((f) => !f.exceptOwner && f.offset < stateOffset + 2 && stateOffset < f.offset + f.width / 8)
        .map((f) => ({ ...f, ownerOnly: true }));
      s.partMemoryHavocAt = i.address;
      uncertainEffects = true;
      s.assumptions = [
        ...new Set([
          ...s.assumptions,
          "This helper proves state preservation but not a complete non-state footprint; other object fields are read as new unresolved values.",
        ]),
      ];
    }
    // The speed setter's velocity keeps the speed the caller passed, which its value can't show.
    const directed = engine.directedVelocity;
    const speed = directed && formalArgument(args, engine.argumentOffset, directed.arguments.speed);
    const angle = directed && formalArgument(args, engine.argumentOffset, directed.arguments.angle);
    for (const effect of pending) {
      const temporary = "__engine_pointer";
      s.registers.set(temporary, effect.pointer);
      const before = memoryAt(effect.pointer, effect.offset, effect.width, s);
      const store = directed?.stores.find((item) => item.field === effect.offset && effect.width === 16);
      const value =
        effect.certain || same(before.value, effect.value.value)
          ? store && speed && effect.certain
            ? {
                ...effect.value,
                directedSpeed: {
                  routine: engine.address,
                  call: i.address,
                  speed: asExpression(speed.value),
                  axis: store.coefficient,
                  ...(angle?.centreAngle ? { direction: angle.centreAngle } : {}),
                },
              }
            : effect.value
          : tracked(
              unknown(`Conditional ${engine.kind} effect on field ${hex(effect.offset)}`, effect.width),
              effect.evidence,
            );
      write(
        {
          kind: "memory",
          segment: "ds",
          base: [temporary],
          displacement: effect.offset,
          direct: false,
          width: effect.width === 8 ? 8 : 16,
        },
        {
          ...tracked(value.value, uniqueEvidence([...value.evidence, ...effect.evidence, evidenceOf(i)])),
          ...(value.directedSpeed ? { directedSpeed: value.directedSpeed } : {}),
        },
        s,
        i,
      );
      s.registers.delete(temporary);
    }
    // Candidate stores address newly selected list members, never the argument's incoming head.
    if (engine.kind === "overlap-list" && engine.list) {
      // A query that skips its argument never selects the owner when the owner asks, so the owner keeps those fields.
      const asking = formalArgument(args, engine.argumentOffset, engine.argumentOffset).value;
      const skipsOwner =
        engine.list.excludesArgument &&
        asking.kind === "pointer" &&
        asking.object === "part" &&
        asking.displacement === 0;
      for (const effect of engine.writes) {
        if (effect.root !== "unknown" || effect.selection !== "overlap-candidate" || effect.path.length) continue;
        const condition = formalPredicate(effect.condition, args, engine.argumentOffset, s);
        if (!possible(conjunction([...s.conditions, condition]))) continue;
        invalidateSelectedPartFields(
          [effect],
          s,
          i,
          skipsOwner ? uniqueEvidence([...effect.evidence, ...engine.list.evidence]) : effect.evidence,
          new Set(skipsOwner ? [effect.offset] : []),
          `a candidate selected by the overlap query at ${hex(i.address)}`,
          condition,
        );
      }
    }
    if (engine.listConsumerScope && engine.listConsumer) {
      for (const effect of engine.writes) {
        if (effect.root !== "unknown" || effect.selection !== "external-list-member" || effect.path.length) continue;
        invalidateSelectedPartFields(
          [effect],
          s,
          i,
          effect.evidence,
          new Set([effect.offset]),
          effect.separateStorage === "outline"
            ? `outline storage of a listed part at ${hex(i.address)}`
            : `a listed part at ${hex(i.address)}`,
          { kind: "unknown", reason: "A reached list member passes the consumer's type and geometric gates." },
        );
      }
    }
    for (const item of globals) {
      if (!possible(conjunction([...s.conditions, item.condition]))) continue;
      write(
        {
          kind: "memory",
          segment: "ds",
          base: [],
          displacement: item.effect.offset,
          direct: true,
          width: item.effect.width === 8 ? 8 : 16,
        },
        tracked(
          entails(item.condition, s)
            ? item.value.value
            : unknown(`Conditional global effect of ${engine.kind}`, item.effect.width),
          uniqueEvidence([...item.value.evidence, ...item.effect.evidence, evidenceOf(i)]),
        ),
        s,
        i,
      );
    }
    if (engine.footprint.unknownGlobalEffects?.length) {
      for (const key of s.memory.keys()) if (key.startsWith("data:")) s.memory.delete(key);
      s.globalHavocAt = i.address;
      s.assumptions = [
        ...new Set([
          ...s.assumptions,
          "Unbounded global effects invalidate cached globals while the proved owner-memory contract is retained.",
        ]),
      ];
    }
    for (const name of ["ax", "bx", "cx", "dx", "es"])
      registerWrite(name, tracked(unknown(`Unspecified ${engine.kind} return register ${name}`), [evidenceOf(i)]), s);
    for (const name of ["ax", "dx"] as const) {
      const candidates = engine.returns.filter(
        (item) =>
          item.register === name &&
          possible(conjunction([...s.conditions, formalPredicate(item.condition, args, engine.argumentOffset, s)])),
      );
      const mapped = candidates.map((item) => ({
        item,
        condition: formalPredicate(item.condition, args, engine.argumentOffset, s),
        value: item.pointer
          ? pointerResult(item.pointer, args, engine.argumentOffset, s, i)
          : formalValue(item.value, args, engine.argumentOffset, s),
      }));
      const certain = mapped.find((item) => entails(item.condition, s));
      const result =
        certain?.value ??
        (mapped.length && mapped.every((item) => same(item.value.value, mapped[0]!.value.value))
          ? mapped[0]!.value
          : undefined);
      if (result)
        registerWrite(
          name,
          tracked(
            result.value,
            uniqueEvidence([...result.evidence, evidenceOf(i), ...candidates.flatMap((c) => c.evidence)]),
          ),
          s,
        );
    }
    if (numericResult) {
      registerWrite("ax", numericResult.low, s);
      registerWrite("dx", numericResult.high, s);
      s.assumptions = [
        ...new Set([
          ...s.assumptions,
          "The proved 32-bit helper relation is used only for a constant shift count inside its decoded domain.",
        ]),
      ];
    }
    const generic = options.summaries?.get(engine.address);
    if (!numericResult && !engine.returns.length && generic && !generic.uncertainEffects && generic.outcomes?.length) {
      const alternatives = generic.outcomes
        .map((outcome) => ({
          outcome,
          condition: formalPredicate(
            outcome.condition,
            args,
            generic.objectPointer.argumentBase ?? generic.objectPointer.argumentOffset,
            s,
            generic.objectPointer.argumentOffset,
          ),
        }))
        .filter((item) => possible(conjunction([...s.conditions, item.condition])));
      const values = alternatives.map((item) =>
        formalValue(
          item.outcome.returnValue,
          args,
          generic.objectPointer.argumentBase ?? generic.objectPointer.argumentOffset,
          s,
          generic.objectPointer.argumentOffset,
        ),
      );
      if (values.length && values.every((value) => same(value.value, values[0]!.value)))
        registerWrite(
          "ax",
          tracked(values[0]!.value, uniqueEvidence([evidenceOf(i), ...values.flatMap((value) => value.evidence)])),
          s,
        );
    }
    if (
      (["private-buffer-query", "connection-query"].includes(engine.kind) || poolNode) &&
      registerRead("ax", s).value.kind === "unknown"
    )
      // A query that changes nothing but its own stack answers with one value, like whether a spot is blocked. It is
      // unknown, but one value: a condition on it can be decided as a run value. The rope connection query's answer,
      // what the parts at the other end of the ropes said, is one value in the same way, whatever those parts change,
      // and so is a pool update's answer, like whether it added a node.
      registerWrite(
        "ax",
        tracked({ ...field(`answer of the query at ${hex(i.address)}`, 0, 16), unresolved: true } as Expression, [
          evidenceOf(i),
        ]),
        s,
      );
    if (
      ["list-head", "list-next"].includes(engine.kind) &&
      registerRead("ax", s).value.kind === "unknown" &&
      engine.returns.length
    ) {
      // A nullable list result keeps its proven pointer class even when the selected list depends on globals.
      const resultObject = `part returned by ${engine.kind} at ${hex(i.address)}`;
      registerWrite(
        "ax",
        tracked(
          {
            kind: "pointer",
            object: resultObject,
            displacement: 0,
            width: 16,
            addressValue: field(`result of ${engine.kind} at ${hex(i.address)}`, 0),
          },
          [evidenceOf(i)],
        ),
        s,
      );
    }
    if (engine.returnPointerClass === "nullable-fresh" && registerRead("ax", s).value.kind === "unknown") {
      registerWrite(
        "ax",
        tracked(
          {
            kind: "pointer",
            object: `nullable allocation returned at ${hex(i.address)}`,
            displacement: 0,
            width: 16,
            addressValue: field(`nullable allocation result at ${hex(i.address)}`, 0),
          },
          uniqueEvidence([evidenceOf(i), ...engine.returns.flatMap((result) => result.evidence)]),
        ),
        s,
      );
    }
    s.flags = undefined;
    s.carry = undefined;
    return true;
  };
  const flagPredicate = (i: Instruction, s: AbstractState, taken: boolean): Predicate => {
    const flags = s.flags;
    if (["jb", "jae"].includes(i.mnemonic) && s.carry && (flags?.operation !== "cmp" || flags.carryOverridden))
      return {
        kind: "compare",
        operator: (i.mnemonic === "jb") === taken ? "!=" : "==",
        left: asExpression(s.carry.value),
        right: constant(0, 1),
        signed: false,
      };
    if (!flags) return { kind: "unknown", reason: `Flags reaching ${hex(i.address)} are not resolved` };
    if (flags.carryOverridden && ["jbe", "ja"].includes(i.mnemonic))
      return {
        kind: "unknown",
        reason: `${i.mnemonic} at ${hex(i.address)} combines a separately changed carry with the earlier zero flag.`,
      };
    const operators: Record<string, string> = {
      je: "==",
      jne: "!=",
      jl: "<",
      jge: ">=",
      jle: "<=",
      jg: ">",
      jb: "<",
      jae: ">=",
      jbe: "<=",
      ja: ">",
    };
    let operator = operators[i.mnemonic];
    let left = flags.operation === "cmp" ? flags.left : flags.result;
    let right = flags.operation === "cmp" ? flags.right : constant(0, flags.result.width);
    let isSigned = ["jl", "jge", "jle", "jg"].includes(i.mnemonic);
    if (["js", "jns"].includes(i.mnemonic)) {
      operator = i.mnemonic === "js" ? "<" : ">=";
      left = flags.result;
      right = constant(0);
      isSigned = true;
    }
    if (
      !operator ||
      (!["cmp", "test", "and", "or", "xor"].includes(flags.operation) &&
        !["je", "jne", "js", "jns"].includes(i.mnemonic))
    )
      return {
        kind: "unknown",
        reason: `${i.mnemonic} at ${hex(i.address)} depends on ${flags.operation} flags not represented as a predicate`,
      };
    if (!taken)
      operator = ({ "==": "!=", "!=": "==", "<": ">=", ">=": "<", "<=": ">", ">": "<=" } as Record<string, string>)[
        operator
      ]!;
    return { kind: "compare", operator, left, right, signed: isSigned };
  };
  const queue: { at: number; state: AbstractState; joinSignature?: string }[] = [];
  const ranks = joinOrder(code),
    live = liveRegisters(code);
  const incomingCounts = new Map<number, number>();
  for (const edge of code.edges)
    if (edge.to !== null) incomingCounts.set(edge.to, (incomingCounts.get(edge.to) ?? 0) + 1);
  const joins = new Set([...incomingCounts].filter(([, count]) => count > 1).map(([at]) => at));
  const enqueue = (item: { at: number; state: AbstractState; joinSignature?: string }) => {
    const active = live.get(item.at) ?? new Set<string>();
    if (joins.has(item.at) && !item.state.observationOnly) {
      const s = item.state;
      const value = (tracked: Tracked) => [
        tracked.value,
        tracked.value.kind === "unknown" ? tracked.writtenAt : undefined,
      ];
      item.joinSignature = JSON.stringify([
        [...s.registers]
          .filter(([name]) => active.has(wordOfByte[name] ?? name))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, v]) => [name, value(v)]),
        [...s.memory].sort(([a], [b]) => a.localeCompare(b)).map(([name, v]) => [name, value(v)]),
        s.stack.map(value),
        s.flags && [s.flags.operation, s.flags.left, s.flags.right, s.flags.result, s.flags.carryOverridden],
        s.carry?.value,
        s.stateWritten,
        s.uncertain,
        s.havoc,
        s.havocAt,
        s.globalHavocAt,
        s.partMemoryHavocAt,
        s.fieldHavoc,
      ]);
      for (const queued of queue.filter((q) => q.at === item.at && q.joinSignature === item.joinSignature)) {
        const terms = (state: AbstractState) => {
          const c = conjunction(state.conditions);
          return c.kind === "and" ? c.terms : [];
        };
        const left = terms(queued.state),
          right = terms(s),
          leftIds = new Set(left.map(textOf)),
          rightIds = new Set(right.map(textOf));
        const onlyLeft = left.filter((t) => !rightIds.has(textOf(t))),
          onlyRight = right.filter((t) => !leftIds.has(textOf(t)));
        const a = onlyLeft[0],
          b = onlyRight[0];
        if (
          onlyLeft.length !== 1 ||
          onlyRight.length !== 1 ||
          a?.kind !== "compare" ||
          b?.kind !== "compare" ||
          a.signed !== b.signed ||
          !same(a.left, b.left) ||
          !same(a.right, b.right) ||
          ({ "==": "!=", "!=": "==", "<": ">=", ">=": "<", "<=": ">", ">": "<=" } as Record<string, string>)[
            a.operator
          ] !== b.operator
        )
          continue;
        const merged = queued.state;
        merged.conditions = left.filter((t) => rightIds.has(textOf(t)));
        merged.visited = new Set([...merged.visited, ...s.visited]);
        const joinEvidence = uniqueEvidence(
          [...merged.visited, item.at].flatMap((at) => {
            const i = instructions.get(at);
            return i ? [evidenceOf(i)] : [];
          }),
        );
        merged.evidence = uniqueEvidence([...merged.evidence, ...s.evidence, ...joinEvidence]);
        merged.assumptions = [
          ...new Set([
            ...merged.assumptions,
            ...s.assumptions,
            "Complementary paths have equal live register expressions, memory effects, flags and stacked arguments at this join. Dead register values are forgotten before continuing.",
          ]),
        ];
        for (const [name, v] of merged.registers)
          if (!active.has(wordOfByte[name] ?? name)) merged.registers.delete(name);
          else {
            const other = s.registers.get(name);
            if (other)
              merged.registers.set(name, { ...v, evidence: uniqueEvidence([...v.evidence, ...other.evidence]) });
          }
        for (const [name, v] of merged.memory) {
          const other = s.memory.get(name);
          if (other) merged.memory.set(name, { ...v, evidence: uniqueEvidence([...v.evidence, ...other.evidence]) });
        }
        merged.stack = merged.stack.map((v, index) => ({
          ...v,
          evidence: uniqueEvidence([...v.evidence, ...s.stack[index]!.evidence]),
        }));
        if (merged.flags && s.flags)
          merged.flags = { ...merged.flags, evidence: uniqueEvidence([...merged.flags.evidence, ...s.flags.evidence]) };
        if (merged.carry && s.carry)
          merged.carry = { ...merged.carry, evidence: uniqueEvidence([...merged.carry.evidence, ...s.carry.evidence]) };
        controlFlowJoins.push({
          address: item.at,
          liveRegisters: [...active].sort(),
          conditions: [left, right],
          confidence: "inferred",
          assumptions: [
            "The branch predicates are exact complements with identical remaining conditions. Their live abstract environments and side-effect versions agree; discarded register values have no future use before redefinition.",
          ],
          evidence: joinEvidence,
        });
        return;
      }
    }
    const rank = ranks.get(item.at) ?? Number.MAX_SAFE_INTEGER;
    let low = 0,
      high = queue.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((ranks.get(queue[mid]!.at) ?? Number.MAX_SAFE_INTEGER) > rank) low = mid + 1;
      else high = mid;
    }
    queue.splice(low, 0, item);
  };
  enqueue({ at: entry.address, state: initial });
  let visits = 0;
  const maxVisits = options.maxVisits ?? 4000;
  const tails = returnTails(code);
  let returnPathsComplete = code.status === "complete";
  const unresolvedExit = (s: AbstractState, i: Instruction | undefined, reason: string) => {
    if (s.observationOnly) return;
    returnPathsComplete = false;
    const condition = conjunction(s.conditions);
    const from = options.stateCount
      ? Array.from({ length: options.stateCount }, (_, n) => n).filter((n) => possible(condition, n, stateOffset))
      : null;
    if (from?.length === 0) return;
    transitions.push({
      from,
      to: unknown(reason),
      condition,
      routine: entry.address,
      confidence: "unresolved",
      assumptions: ["The graph loses information at this boundary; no destination state is asserted."],
      evidence: uniqueEvidence([
        ...s.evidence,
        ...(i
          ? [evidenceOf(i)]
          : [
              {
                address: entry.address,
                bytes: [...image.slice(entry.address, entry.address + 1)],
                text: "Undecoded routine entry",
              },
            ]),
      ]),
    });
  };
  const outputs = new Set<string>();
  const recordIteration = (s: AbstractState, i: Instruction) => {
    if (s.observationHeader === undefined || !s.observationObject) return;
    const condition = conjunction(s.conditions.filter((predicate) => predicate !== s.observationGuard));
    if (!possible(condition)) return;
    const fields: FieldWrite[] = [];
    for (const [key, final] of s.memory) {
      const split = key.lastIndexOf(":"),
        before = key.slice(0, split),
        separator = before.lastIndexOf(":");
      const object = before.slice(0, separator),
        offset = Number(before.slice(separator + 1)),
        width = Number(key.slice(split + 1));
      // An iteration outcome says what happens to the listed member; the owner's fields are in the routine's outcomes.
      if (object !== s.observationObject) continue;
      const value = asExpression(final.value);
      fields.push({
        object,
        offset,
        width,
        value,
        condition,
        routine: entry.address,
        ...finding(value, condition, s, uniqueEvidence([...final.evidence, evidenceOf(i)])),
        ...(object === "unknown" ? { confidence: "unresolved" as const } : {}),
        ...(final.directedSpeed ? { directedSpeed: final.directedSpeed } : {}),
      });
    }
    iterationOutcomes.push({
      scope: "one overlap-list member",
      header: s.observationHeader,
      object: s.observationObject,
      condition,
      fields,
      effectsComplete: !s.uncertain && s.partMemoryHavocAt === undefined,
      ...finding(constant(0), condition, s, [evidenceOf(i)]),
    });
  };
  const finish = (s: AbstractState, i: Instruction) => {
    if (s.observationOnly) return;
    const value = s.memory.get(`part:${stateOffset}:16`);
    const to = value
      ? asExpression(value.value)
      : s.stateWritten
        ? unknown("A byte write or an unknown alias invalidated the final state")
        : field("part", stateOffset);
    const condition = conjunction(s.conditions);
    const from = options.stateCount
      ? Array.from({ length: options.stateCount }, (_, n) => n).filter((n) => possible(condition, n, stateOffset))
      : null;
    if (from?.length === 0 || !possible(condition)) return;
    const f = finding(to, condition, s, [...(value?.evidence ?? []), evidenceOf(i)]);
    const updates: FieldWrite[] = [];
    for (const [key, final] of s.memory) {
      const split = key.lastIndexOf(":");
      const before = key.slice(0, split);
      const separator = before.lastIndexOf(":");
      const object = before.slice(0, separator);
      const offset = Number(before.slice(separator + 1));
      const width = Number(key.slice(split + 1));
      if (object === "stack" || object === "data") continue;
      const expression = asExpression(final.value);
      updates.push({
        object,
        offset,
        width,
        value: expression,
        condition,
        routine: entry.address,
        ...finding(expression, condition, s, [...final.evidence, evidenceOf(i)]),
        ...(final.directedSpeed ? { directedSpeed: final.directedSpeed } : {}),
      });
    }
    const returned = registerRead("ax", s);
    outcomes.push({
      effectsComplete: !s.uncertain && s.partMemoryHavocAt === undefined,
      ...(!s.uncertain && s.partMemoryHavocAt !== undefined ? { keepsState: true as const } : {}),
      condition,
      fields: updates,
      returnValue: asExpression(returned.value),
      ...(returned.value.kind === "pointer"
        ? { returnPointer: { object: returned.value.object, displacement: returned.value.displacement } }
        : {}),
      ...finding(constant(0), condition, s, [...returned.evidence, evidenceOf(i)]),
      returnConfidence: containsUnknown(asExpression(returned.value)) ? "unresolved" : "inferred",
    });
    const transition = { ...f, from, to, condition, routine: entry.address, updates };
    const key = JSON.stringify([from, to, condition, updates.map((u) => [u.object, u.offset, u.width, u.value])]);
    if (!outputs.has(key)) {
      outputs.add(key);
      transitions.push(transition);
    }
  };
  const splitKey = (key: string): [string, number, number] => {
    const parts = key.split(":"),
      width = Number(parts.pop()),
      offset = Number(parts.pop());
    return [parts.join(":"), offset, width];
  };
  /**
   * The fields a pass that goes on may change, split into the owner's and the member's, or undefined when one could be
   * the owner's state, or the member could be the owner.
   */
  const findFirstFields = (loop: NonNullable<ReturnType<typeof findFirstLoops.get>>, s: AbstractState) => {
    const owner: { offset: number; width: number }[] = [],
      member: { offset: number; width: number }[] = [];
    const isOwner = (register: string) => {
      const value = registerRead(register, s).value;
      return value.kind === "pointer" && value.object === "part" && value.displacement === 0;
    };
    const add = (register: string, offset: number, width: number) => {
      if (register === loop.node) member.push({ offset, width });
      else if (isOwner(register) && (offset + width / 8 <= stateOffset || offset >= stateOffset + 2))
        owner.push({ offset, width });
      else return false;
      return true;
    };
    for (const write of loop.passWrites) if (!add(write.register, write.offset, write.width)) return undefined;
    for (const call of loop.passCalls)
      for (const write of call.callee.writes)
        if (write.root === "argument" && !add(call.register, write.offset, write.width)) return undefined;
    if (member.length && !loop.excludesOwner) return undefined;
    return { owner, member };
  };
  while (queue.length && visits++ < maxVisits) {
    const readyTail = visits > maxVisits * 0.75 ? queue.findIndex((item) => tails.has(item.at)) : -1;
    const item = readyTail < 0 ? queue.pop()! : queue.splice(readyTail, 1)[0]!;
    const s = item.state;
    const i = instructions.get(item.at);
    if (!i) {
      uncertainEffects = true;
      diagnostics.add(`No decoded instruction at ${hex(item.at)}`);
      unresolvedExit(s, code.instructions.at(-1) ?? code.instructions[0]!, `Undecoded path at ${hex(item.at)}`);
      continue;
    }
    if (s.observationOnly && i.address === s.observationExit) {
      recordIteration(s, i);
      continue;
    }
    const findFirst = findFirstLoops.get(i.address);
    if (findFirst && s.visited.has(i.address) && s.findFirst?.has(i.address) && !s.observationOnly) {
      const node = registerRead(findFirst.node, s).value;
      // A pass that moved on changed nothing; the walk for any member already covers what follows.
      if (!(node.kind === "constant" && node.value === 0)) continue;
      // A pass that stops cleared the pointer: the test at the head now leaves the loop.
      s.visited.delete(findFirst.header);
      s.visited.delete(findFirst.branch);
    }
    if (s.visited.has(i.address)) {
      if (s.observationOnly) {
        if (i.address === s.observationHeader) recordIteration(s, i);
        continue;
      }
      uncertainEffects = true;
      diagnostics.add(`Back edge to ${hex(i.address)} requires a loop invariant; its effects remain unresolved`);
      unresolvedExit(s, i, `Loop invariant at ${hex(i.address)} is unresolved`);
      continue;
    }
    s.visited.add(i.address);
    s.registers.set("cs", tracked(constant(i.segment)));
    const candidateList = !s.observationOnly && listLoopsByHeader.get(i.address);
    const list =
      candidateList &&
      (!candidateList.condition ||
        entails(
          {
            kind: "compare",
            operator: "!=",
            left: asExpression(
              memoryAt(tracked({ kind: "pointer", object: "part", displacement: 0, width: 16 }), stateOffset, 16, s)
                .value,
            ),
            right: constant(0),
            signed: false,
          },
          s,
        ))
        ? candidateList
        : undefined;
    if (list) {
      const node = registerRead(list.nodeRegister, s);
      if (list.source !== "global-list") {
        const observed = clone(s);
        observed.observationOnly = true;
        observed.observationHeader = list.header;
        observed.observationExit = list.exit;
        observed.observationObject = `overlap candidate at ${hex(list.header)}`;
        observed.assumptions = [...new Set([...observed.assumptions, ...list.assumptions])];
        observed.evidence.push(...list.evidence);
        observed.observationGuard = {
          kind: "compare",
          operator: "!=",
          left: asExpression(node.value),
          right: constant(0),
          signed: false,
        };
        observed.conditions.push(observed.observationGuard);
        registerWrite(
          list.nodeRegister,
          tracked(
            {
              kind: "pointer",
              object: `overlap candidate at ${hex(list.header)}`,
              displacement: 0,
              width: 16,
              addressValue: asExpression(node.value),
            },
            uniqueEvidence([...node.evidence, ...list.evidence]),
          ),
          observed,
        );
        if (!(node.value.kind === "constant" && node.value.value === 0))
          enqueue({ at: list.bodyEntry, state: observed });
      }
      // The proven relation covers the complete finite scan; the observational branch only records per-node effects.
      s.assumptions = [...new Set([...s.assumptions, ...list.assumptions])];
      s.evidence.push(...list.evidence);
      for (const effect of list.possibleFields) {
        if (s.fieldHavoc?.length && !["stack", "data", "buffer"].includes(effect.object))
          s.fieldHavoc.push({ offset: effect.offset, width: effect.width, address: i.address, exceptOwner: false });
        if (effect.object === "stack" && effect.operand) {
          if (
            list.possibleFields.indexOf(effect) !==
            list.possibleFields.findIndex(
              (field) => field.object === "stack" && field.offset === effect.offset && field.width === effect.width,
            )
          )
            continue;
          const locationOfField = location(effect.operand, s);
          if (locationOfField) {
            const previous = s.memory.get(memoryKey(locationOfField));
            const selectedMember =
              effect.width === 16 &&
              previous?.value.kind === "constant" &&
              previous.value.value === 0 &&
              list.possibleFields
                .filter(
                  (field) =>
                    field.object === "stack" &&
                    field.offset < effect.offset + 2 &&
                    effect.offset < field.offset + field.width / 8,
                )
                .every((field) => field.offset === effect.offset && field.width === 16 && field.nullableMember);
            write(
              effect.operand,
              tracked(
                selectedMember
                  ? {
                      kind: "pointer",
                      object: `part selected by list scan at ${hex(list.header)}`,
                      displacement: 0,
                      width: 16,
                      addressValue: field(`nullable list selection at ${hex(list.header)}`, effect.offset),
                    }
                  : // One value the scan leaves behind, like the nearest part it found: unknown, but the same on
                    // every later read until the routine writes it again, so a condition can be decided on it.
                    ({
                      ...field(`local after list scan at ${hex(list.header)}`, effect.offset, effect.width),
                      unresolved: true,
                    } as Expression),
                list.evidence,
                i.address,
              ),
              s,
              i,
            );
          }
          continue;
        }
        for (const [key] of s.memory) {
          const parts = key.split(":"),
            width = Number(parts.pop()),
            offset = Number(parts.pop()),
            object = parts.join(":");
          const affected =
            effect.object === "part"
              ? object === "part"
              : effect.object === "data"
                ? object === "data"
                : !["part", "stack", "data"].includes(object);
          if (affected && offset < effect.offset + effect.width / 8 && effect.offset < offset + width / 8)
            s.memory.set(
              key,
              tracked(
                unknown(`The complete list scan may change field ${hex(effect.offset)}`, width),
                list.evidence,
                i.address,
              ),
            );
        }
        if (effect.object === "part" || effect.object === "data")
          s.memory.set(
            `${effect.object}:${effect.offset}:${effect.width}`,
            tracked(
              unknown(`The complete list scan may change field ${hex(effect.offset)}`, effect.width),
              list.evidence,
              i.address,
            ),
          );
      }
      if (list.unknownGlobals) {
        for (const key of s.memory.keys()) if (key.startsWith("data:")) s.memory.delete(key);
        s.globalHavocAt = i.address;
      }
      for (const name of list.writtenRegisters)
        registerWrite(name, tracked(unknown("The complete list scan changes this register"), list.evidence), s);
      registerWrite(
        list.nodeRegister,
        tracked(
          list.exitOnNullOnly ? constant(0) : unknown("The list scan may stop before reaching a null node"),
          list.evidence,
        ),
        s,
      );
      s.flags = undefined;
      s.carry = undefined;
      usedListLoops.push(list);
      enqueue({ at: list.exit, state: s });
      continue;
    }
    const passFields =
      findFirst && !s.observationOnly && !s.findFirst?.has(i.address) ? findFirstFields(findFirst, s) : undefined;
    if (findFirst && passFields) {
      // Either the passes that go on change only these fields and no member is acted on, or one member, any of them,
      // is acted on once after them.
      const forget = (target: AbstractState) => {
        // The owner's fields a pass may change: later reads give the one value they have after the loop.
        for (const field of passFields.owner) {
          for (const key of [...target.memory.keys()]) {
            const [object, offset, width] = splitKey(key);
            if (object === "part" && offset < field.offset + field.width / 8 && field.offset < offset + width / 8)
              target.memory.delete(key);
          }
          target.fieldHavoc = [
            ...(target.fieldHavoc ?? []),
            { offset: field.offset, width: field.width, address: i.address, exceptOwner: false },
          ];
        }
        for (const field of passFields.member) {
          for (const key of [...target.memory.keys()]) {
            const [object, offset, width] = splitKey(key);
            if (
              !["part", "stack", "data"].includes(object) &&
              offset < field.offset + field.width / 8 &&
              field.offset < offset + width / 8
            )
              target.memory.delete(key);
          }
          target.fieldHavoc = [
            ...(target.fieldHavoc ?? []),
            { offset: field.offset, width: field.width, address: i.address, exceptOwner: true },
          ];
        }
        // Registers and locals a pass may change hold one value each after the loop, never used as an address.
        const loopValue = (what: string, offset: number, width: number) =>
          tracked({
            ...field(`local after find-first loop at ${hex(i.address)}: ${what}`, offset, width),
            unresolved: true,
          } as Expression);
        for (const name of findFirst.registers) registerWrite(name, loopValue(`register ${name}`, 0, 16), target);
        for (const operand of findFirst.locals)
          write(operand, loopValue("local", operand.displacement, operand.width), target, i);
        if (findFirst.globals) {
          for (const key of [...target.memory.keys()]) if (key.startsWith("data:")) target.memory.delete(key);
          target.globalHavocAt = i.address;
        }
        target.flags = undefined;
        target.carry = undefined;
        target.assumptions = [...new Set([...target.assumptions, FIND_FIRST_ASSUMPTION])];
        target.evidence.push(...findFirst.evidence);
      };
      const none = clone(s);
      forget(none);
      registerWrite(findFirst.node, tracked(constant(0), findFirst.evidence), none);
      enqueue({ at: findFirst.exit, state: none });
      const member = clone(s);
      forget(member);
      const name = `member found by the loop at ${hex(i.address)}`;
      registerWrite(
        findFirst.node,
        tracked(
          {
            kind: "pointer",
            object: name,
            displacement: 0,
            width: 16,
            addressValue: { ...field(`${name} link`, 0), unresolved: true } as Expression,
          },
          findFirst.evidence,
        ),
        member,
      );
      member.visited.delete(i.address);
      member.findFirst = new Set([...(member.findFirst ?? []), i.address]);
      enqueue({ at: i.address, state: member });
      continue;
    }
    const counted = loopsByHeader.get(i.address);
    if (counted) {
      const input = read(counted.counter, s).value;
      if (input.kind === "constant") {
        const start = counted.signed ? signed(input.value, 16) : unsigned(input.value, 16);
        const inclusive = counted.relation === "<=" || counted.relation === ">=";
        const end = counted.limit + (inclusive ? counted.step : 0);
        const active =
          counted.step === 1
            ? inclusive
              ? start <= counted.limit
              : start < counted.limit
            : inclusive
              ? start >= counted.limit
              : start > counted.limit;
        const safe = counted.signed
          ? start >= -0x8000 && end >= -0x8000 && end <= 0x7fff
          : start >= 0 && end >= 0 && end <= 0xffff;
        if (active && safe && (counted.minimumCounter === undefined || start >= counted.minimumCounter)) {
          let gearConflict: GearConflictValue | undefined;
          if (
            gearRun &&
            start === 0 &&
            counted.header === gearRun.scan.header &&
            counted.exit === gearRun.scan.exit &&
            counted.limit === 4 &&
            counted.step === 1
          ) {
            const owner = registerRead("si", s);
            const movement = memoryAt(owner, gearRun.deltaField, 16, s);
            if (
              owner.value.kind === "pointer" &&
              owner.value.object === "part" &&
              owner.value.displacement === 0 &&
              entails(
                {
                  kind: "compare",
                  operator: "!=",
                  left: asExpression(movement.value),
                  right: constant(0),
                  signed: false,
                },
                s,
              )
            ) {
              const links = gearRun.links.map((offset) => memoryAt(owner, offset, 16, s));
              gearConflict = {
                value: {
                  kind: "field",
                  object: `gear connection conflict at ${hex(code.address)}`,
                  offset: 0,
                  width: 16,
                },
                routine: code.address,
                instruction: counted.header,
                snapshot: "beforeRootConnectionScan",
                owner: "part",
                ownerMovement: asExpression(movement.value),
                ownerMarkedBeforeScan: true,
                rootSlots: [...gearRun.links],
                rootMode: 2,
                rootSkipsBlocked: false,
                initialAccumulator: 0,
                values: [0, 1],
                relation: gearRun.propagationRelation,
                confidence: "inferred",
                evidence: uniqueEvidence([
                  ...gearRun.evidence,
                  ...movement.evidence,
                  ...links.flatMap((link) => link.evidence),
                ]),
                assumptions: [
                  ...gearRun.assumptions,
                  "This symbolic register result is defined by the certified ordered connection relation on the heap before the scan. It is not an independently assignable part field or an assumed external trigger.",
                ],
              };
            }
          }
          const empty = counted.emptyConnections;
          if (empty) {
            let gate = constant(1);
            for (const offset of empty.fields)
              gate = binary(
                "&",
                gate,
                binary(
                  "==",
                  asExpression(
                    memoryAt(tracked({ kind: "pointer", object: "part", displacement: 0, width: 16 }), offset, 16, s)
                      .value,
                  ),
                  constant(0),
                  16,
                ),
                16,
              );
            const condition: Predicate = {
              kind: "compare",
              operator: "==",
              left: gate,
              right: constant(1),
              signed: false,
            };
            if (possible(conjunction([...s.conditions, condition]))) {
              const branch = clone(s);
              branch.conditions.push(condition);
              branch.assumptions = [...new Set([...branch.assumptions, ...empty.assumptions])];
              branch.evidence.push(...empty.evidence);
              for (const name of empty.zeroRegisters) registerWrite(name, tracked(constant(0), empty.evidence), branch);
              for (const name of empty.scratchRegisters)
                registerWrite(
                  name,
                  tracked(unknown("The bounded slot index changes this scratch register"), empty.evidence),
                  branch,
                );
              write(empty.localPointer, tracked(constant(0), empty.evidence), branch, i);
              write(counted.counter, tracked(constant(unsigned(end, 16)), empty.evidence), branch, i);
              branch.flags = undefined;
              branch.carry = undefined;
              usedLoops.push(counted);
              enqueue({ at: counted.exit, state: branch });
            }
            s.conditions.push({ kind: "compare", operator: "==", left: gate, right: constant(0), signed: false });
            if (!possible(conjunction(s.conditions))) continue;
          }
          // The monotone variant and balanced stack prove this transfer; no loop body is unrolled.
          s.assumptions = [...new Set([...s.assumptions, ...counted.assumptions])];
          s.evidence.push(...counted.evidence);
          for (const effect of counted.possibleFields) {
            if (effect.partGraph) {
              const preserved =
                (gearConflict !== undefined && effect.offset === gearRun!.flagsField) ||
                (effect.preservesNonzeroOwner &&
                  entails(
                    {
                      kind: "compare",
                      operator: "!=",
                      left: asExpression(
                        memoryAt(
                          tracked({ kind: "pointer", object: "part", displacement: 0, width: 16 }),
                          effect.offset,
                          effect.width,
                          s,
                        ).value,
                      ),
                      right: constant(0),
                      signed: false,
                    },
                    s,
                  ));
              invalidateSelectedPartFields([effect], s, i, counted.evidence, new Set(preserved ? [effect.offset] : []));
              continue;
            }
            if (effect.object === "stack" && effect.operand) {
              const l = location(effect.operand, s);
              if (l)
                s.memory.set(
                  memoryKey(l),
                  tracked(unknown(`A bounded loop updates this private field`, effect.width), counted.evidence),
                );
            } else if (effect.object === "buffer") {
              // The proven outline storage class is separate from the owner and its private stack.
              for (const [key] of s.memory) {
                const parts = key.split(":");
                parts.pop();
                parts.pop();
                if (!["part", "stack", "data"].includes(parts.join(":"))) s.memory.delete(key);
              }
            } else if (effect.object !== "data") {
              if (s.fieldHavoc?.length)
                s.fieldHavoc.push({
                  offset: effect.offset,
                  width: effect.width,
                  address: i.address,
                  exceptOwner: effect.preservesOwnerValue ?? false,
                });
              // Related-object aliases can change a field of the owner, but the invariant excludes the state.
              for (const [key] of s.memory) {
                const parts = key.split(":");
                const width = Number(parts.pop());
                const offset = Number(parts.pop());
                const object = parts.join(":");
                if (
                  object !== "stack" &&
                  !(object === "part" && effect.preservesOwnerValue) &&
                  offset < effect.offset + effect.width / 8 &&
                  effect.offset < offset + width / 8
                )
                  s.memory.set(
                    key,
                    tracked(
                      unknown(`A bounded loop may change field ${hex(effect.offset)}`, width),
                      counted.evidence,
                      i.address,
                    ),
                  );
              }
              if (!effect.preservesOwnerValue)
                s.memory.set(
                  `part:${effect.offset}:${effect.width}`,
                  tracked(
                    unknown(`A bounded loop may change field ${hex(effect.offset)}`, effect.width),
                    counted.evidence,
                    i.address,
                  ),
                );
            }
          }
          for (const name of counted.writtenRegisters)
            registerWrite(name, tracked(unknown("A bounded loop changes this register"), counted.evidence), s);
          write(counted.counter, tracked(constant(unsigned(end, 16)), counted.evidence), s, i);
          if (gearConflict) {
            registerWrite(gearRun!.scan.accumulatorRegister, tracked(gearConflict.value, gearConflict.evidence), s);
            s.conditions.push({
              kind: "compare",
              operator: "<=",
              left: gearConflict.value,
              right: constant(1),
              signed: false,
            });
            s.assumptions = [...new Set([...s.assumptions, ...gearConflict.assumptions])];
            s.evidence.push(...gearConflict.evidence);
            derivedValues.push(gearConflict);
          }
          s.flags = undefined;
          s.carry = undefined;
          usedLoops.push(counted);
          enqueue({ at: counted.exit, state: s });
          continue;
        }
      }
    }
    const sparse = sparseSwitches.get(i.address);
    if (sparse?.length) {
      const first = sparse[0]!;
      const search = first.search!;
      const selector = read(first.selector, s);
      // The bounded key search is replaced by its proven cases, not by iterating its instructions.
      for (const edge of sparse) {
        const branch = clone(s);
        branch.conditions.push({
          kind: "compare",
          operator: "==",
          left: asExpression(selector.value),
          right: constant(edge.caseValue!),
          signed: false,
        });
        branch.evidence.push(...selector.evidence, ...(edge.evidence ?? []));
        registerWrite(search.keyRegister, tracked(constant(edge.caseValue!), edge.evidence), branch);
        registerWrite(
          search.indexRegister,
          tracked(constant(search.tableBase + 2 * edge.tableIndex!), edge.evidence),
          branch,
        );
        registerWrite("cx", tracked(constant(search.count - edge.tableIndex!), edge.evidence), branch);
        branch.flags = undefined;
        branch.carry = undefined;
        if (
          possible(conjunction(branch.conditions)) &&
          (!options.stateCount ||
            Array.from({ length: options.stateCount }, (_, n) => n).some((n) =>
              possible(conjunction(branch.conditions), n, stateOffset),
            ))
        )
          enqueue({ at: edge.to!, state: branch });
      }
      const fallback = clone(s);
      for (const edge of sparse)
        fallback.conditions.push({
          kind: "compare",
          operator: "!=",
          left: asExpression(selector.value),
          right: constant(edge.caseValue!),
          signed: false,
        });
      fallback.evidence.push(...selector.evidence, ...(first.evidence ?? []));
      registerWrite(search.keyRegister, tracked(unknown("Last examined sparse switch key"), first.evidence), fallback);
      registerWrite(
        search.indexRegister,
        tracked(constant(search.tableBase + 2 * search.count), first.evidence),
        fallback,
      );
      registerWrite("cx", tracked(constant(0), first.evidence), fallback);
      fallback.flags = undefined;
      fallback.carry = undefined;
      if (possible(conjunction(fallback.conditions))) enqueue({ at: search.defaultTarget, state: fallback });
      continue;
    }
    const [dest, source] = i.operands;
    const a = read(dest, s);
    const b = read(source, s);
    const av = asExpression(a.value);
    const bv = asExpression(b.value);
    const e = uniqueEvidence([...a.evidence, ...b.evidence, evidenceOf(i)]);
    let flagResult: Expression | undefined;
    if (i.mnemonic === "mov") write(dest, b, s, i);
    else if (i.mnemonic === "lea" && source?.kind === "memory") {
      const l = location(source, s);
      write(
        dest,
        l
          ? tracked({ kind: "pointer", object: l.object, displacement: l.offset, width: 16 }, [
              ...l.evidence,
              evidenceOf(i),
            ])
          : tracked(unknown("LEA address is not established")),
        s,
        i,
      );
    } else if (["les", "lds"].includes(i.mnemonic) && source?.kind === "memory") {
      const l = location(source, s);
      const object =
        l?.object === "stack" && l.offset + 2 === argumentOffset
          ? "part"
          : l
            ? `referenced-by(${l.object}+${hex(l.offset)})`
            : undefined;
      const ptr = object
        ? tracked({ kind: "pointer", object, displacement: 0, width: 16 } as Pointer, [
            ...(l?.evidence ?? []),
            evidenceOf(i),
          ])
        : tracked(unknown("Far object pointer is not established"));
      write(dest, ptr, s, i);
      registerWrite(i.mnemonic === "les" ? "es" : "ds", ptr, s);
    } else if (i.mnemonic === "push") {
      s.stack.push(a);
      const sp = registerRead("sp", s).value;
      if (sp.kind === "stack") registerWrite("sp", tracked({ ...sp, displacement: sp.displacement - 2 }, e), s);
    } else if (i.mnemonic === "pop") {
      write(dest, s.stack.pop() ?? tracked(unknown("Untracked stack value")), s, i);
      const sp = registerRead("sp", s).value;
      if (sp.kind === "stack") registerWrite("sp", tracked({ ...sp, displacement: sp.displacement + 2 }, e), s);
    } else if (i.mnemonic === "xchg") {
      write(dest, b, s, i);
      write(source, a, s, i);
    } else if (["cmp", "test"].includes(i.mnemonic)) {
      flagResult = binary(i.mnemonic === "cmp" ? "-" : "&", av, bv);
      const predicate: Predicate = {
        kind: "compare",
        operator: "==",
        left: i.mnemonic === "test" ? flagResult : av,
        right: i.mnemonic === "test" ? constant(0) : bv,
        signed: false,
      };
      if (JSON.stringify(predicate).includes('"object":"part"'))
        comparisons.push({ predicate, ...finding(av, conjunction(s.conditions), s, e) });
    } else if (
      ["add", "adc", "sub", "sbb", "and", "or", "xor", "shl", "sal", "shr", "sar", "inc", "dec", "neg", "not"].includes(
        i.mnemonic,
      )
    ) {
      const operator = (
        {
          add: "+",
          adc: "+",
          sub: "-",
          sbb: "-",
          and: "&",
          or: "|",
          xor: "^",
          shl: "<<",
          sal: "<<",
          shr: ">>>",
          sar: ">>",
          inc: "+",
          dec: "-",
          neg: "-",
          not: "^",
        } as Record<string, string>
      )[i.mnemonic]!;
      const sameRegister = dest?.kind === "register" && source?.kind === "register" && dest.name === source.name;
      flagResult =
        sameRegister && ["xor", "sub"].includes(i.mnemonic)
          ? constant(0, av.width)
          : binary(
              operator,
              i.mnemonic === "neg" ? constant(0) : av,
              ["inc", "dec"].includes(i.mnemonic)
                ? constant(1)
                : i.mnemonic === "neg"
                  ? av
                  : i.mnemonic === "not"
                    ? constant(2 ** av.width - 1)
                    : bv,
              av.width,
            );
      if (["adc", "sbb"].includes(i.mnemonic)) {
        const carry = s.carry ?? tracked(unknown(`Carry reaching ${hex(i.address)} is unresolved`, 1), [evidenceOf(i)]);
        e.push(...carry.evidence);
        flagResult =
          carry.value.kind === "unknown"
            ? unknown(carry.value.reason, av.width)
            : binary(operator, flagResult, asExpression(carry.value), av.width);
      }
      if (sameRegister && ["and", "or"].includes(i.mnemonic)) write(dest, a, s, i);
      else if (
        ["add", "sub"].includes(i.mnemonic) &&
        (a.value.kind === "pointer" || a.value.kind === "stack") &&
        bv.kind === "constant"
      )
        write(
          dest,
          tracked(
            {
              ...a.value,
              displacement: a.value.displacement + (i.mnemonic === "add" ? bv.value : -bv.value),
              ...(a.value.kind === "pointer"
                ? { addressValue: binary(i.mnemonic === "add" ? "+" : "-", asExpression(a.value), bv, 16) }
                : {}),
            },
            e,
          ),
          s,
          i,
        );
      else write(dest, tracked(flagResult, e), s, i);
      if (dest?.kind === "register" && dest.name === "sp" && bv.kind === "constant" && i.mnemonic === "add")
        s.stack.splice(Math.max(0, s.stack.length - bv.value / 2));
    } else if (["clc", "stc", "cmc"].includes(i.mnemonic)) {
      if (s.flags) s.flags = { ...s.flags, carryOverridden: true };
      s.carry = tracked(
        i.mnemonic === "clc"
          ? constant(0, 1)
          : i.mnemonic === "stc"
            ? constant(1, 1)
            : binary(
                "^",
                s.carry ? asExpression(s.carry.value) : unknown(`Carry reaching ${hex(i.address)} is unresolved`, 1),
                constant(1, 1),
                1,
              ),
        uniqueEvidence([...(s.carry?.evidence ?? []), evidenceOf(i)]),
      );
    } else if (i.mnemonic === "cbw") {
      write(
        { kind: "register", name: "ax", width: 16 },
        tracked(
          binary(">>", binary("<<", asExpression(registerRead("al", s).value), constant(8), 16), constant(8), 16),
          registerRead("al", s).evidence,
        ),
        s,
        i,
      );
    } else if (i.mnemonic === "cwd") {
      write(
        { kind: "register", name: "dx", width: 16 },
        tracked(
          binary(">>", asExpression(registerRead("ax", s).value), constant(15), 16),
          uniqueEvidence([...registerRead("ax", s).evidence, ...e]),
        ),
        s,
        i,
      );
    } else if (i.mnemonic === "div" || i.mnemonic === "idiv") {
      const operandWidth = dest?.kind === "register" || dest?.kind === "memory" ? dest.width : 0;
      const low = registerRead("ax", s),
        high = registerRead("dx", s);
      const lowValue = asExpression(low.value),
        highValue = asExpression(high.value);
      const proof = uniqueEvidence([...e, ...low.evidence, ...(operandWidth === 16 ? high.evidence : [])]);
      const signedDivision = i.mnemonic === "idiv";
      let numerator: Expression | undefined;
      let divisor: Expression | undefined;
      let trap: string | undefined;
      if ((operandWidth === 8 || operandWidth === 16) && av.kind === "constant") {
        const denominator = signedDivision ? signed(av.value, operandWidth) : unsigned(av.value, operandWidth);
        if (!denominator) trap = "The divisor is zero";
        else if (lowValue.kind === "constant" && (operandWidth === 8 || highValue.kind === "constant")) {
          const raw =
            operandWidth === 8
              ? unsigned(lowValue.value, 16)
              : unsigned((highValue as Extract<Expression, { kind: "constant" }>).value, 16) * 0x10000 +
                unsigned(lowValue.value, 16);
          const dividend = signedDivision ? signed(raw, operandWidth * 2) : raw;
          const quotient = Math.trunc(dividend / denominator);
          const minimum = signedDivision ? -(2 ** (operandWidth - 1)) : 0;
          const maximum = signedDivision ? 2 ** (operandWidth - 1) - 1 : 2 ** operandWidth - 1;
          if (quotient < minimum || quotient > maximum) trap = "The quotient overflows its destination register";
          else {
            numerator = constant(raw, operandWidth * 2);
            divisor = constant(av.value, operandWidth);
          }
        } else if (
          operandWidth === 16 &&
          signedDivision &&
          lowValue.kind !== "unknown" &&
          highValue.kind !== "unknown" &&
          same(highValue, binary(">>", lowValue, constant(15), 16)) &&
          (denominator >= 1 || denominator <= -2)
        ) {
          // CWD establishes a signed word dividend. Every quotient in this constant-divisor domain fits a word.
          numerator = lowValue;
          divisor = constant(av.value, 16);
        } else if (operandWidth === 16 && !signedDivision && highValue.kind === "constant" && highValue.value === 0) {
          numerator = lowValue;
          divisor = constant(av.value, 16);
        }
      }
      s.flags = undefined;
      s.carry = undefined;
      if (trap) {
        diagnostics.add(`${i.mnemonic} at ${hex(i.address)} cannot return normally: ${trap}`);
        uncertainEffects = true;
        unresolvedExit(s, i, `${trap} at ${hex(i.address)}; the division exception is not followed`);
        continue;
      }
      if (!numerator || !divisor) {
        diagnostics.add(`Division safety at ${hex(i.address)} is unresolved: ${i.text}`);
        uncertainEffects = true;
        s.uncertain = true;
        unresolvedExit(s, i, `The divisor or quotient range at ${hex(i.address)} is not established`);
        registerWrite("ax", tracked(unknown(`Unresolved ${i.mnemonic} quotient and remainder`), proof), s);
        if (operandWidth === 16) registerWrite("dx", tracked(unknown(`Unresolved ${i.mnemonic} remainder`), proof), s);
      } else {
        const quotient = binary(signedDivision ? "s/" : "/", numerator, divisor, operandWidth);
        const remainder = binary(signedDivision ? "s%" : "%", numerator, divisor, operandWidth);
        registerWrite(operandWidth === 8 ? "al" : "ax", tracked(quotient, proof), s);
        registerWrite(operandWidth === 8 ? "ah" : "dx", tracked(remainder, proof), s);
        s.evidence.push(...proof);
      }
    } else if (i.mnemonic === "imul" || i.mnemonic === "mul") {
      if (i.operands.length > 1) {
        const third = read(i.operands[2], s);
        write(dest, tracked(binary("*", bv, asExpression(third.value)), [...e, ...third.evidence]), s, i);
      } else {
        const ax = registerRead(
          dest?.kind === "memory" || dest?.kind === "register" ? (dest.width === 8 ? "al" : "ax") : "ax",
          s,
        );
        write(
          { kind: "register", name: "ax", width: 16 },
          tracked(binary("*", asExpression(ax.value), av, 16), [...ax.evidence, ...e]),
          s,
          i,
        );
        registerWrite("dx", tracked(unknown("High half of product"), e), s);
      }
      s.flags = undefined;
      s.carry = undefined;
    } else if (i.flow === "call") {
      const angleEngine = i.target ? options.engineSummaries?.get(i.target.address) : undefined;
      if (!angleFrameMatches(angleEngine, i)) {
        const reason = `${angleEngine?.contactResponse || angleEngine?.contactResponseFirst || angleEngine?.contactResponsePair || angleEngine?.contactRotation ? "Contact response" : "Scalar"} helper return frame at ${hex(i.address)} is not established`;
        uncertainEffects = true;
        diagnostics.add(reason);
        unresolvedExit(s, i, reason);
        continue;
      }
      const summary = i.target && options.summaries?.get(i.target.address);
      // A PUSH CS immediately before a near CALL supplies the far return frame, not an argument.
      const args = [...s.stack];
      const last = precedingByEnd.get(i.address);
      const nearFarBridge = farBridges.has(i.address);
      if (!i.far && nearFarBridge) {
        args.pop();
        s.stack.pop();
        const sp = registerRead("sp", s).value;
        if (sp.kind === "stack") registerWrite("sp", tracked({ ...sp, displacement: sp.displacement + 2 }), s);
      }
      const outcomeReturn = (outcome: RoutineOutcome): Tracked => {
        if (outcome.returnPointer) {
          const pointer = formalObject(
            outcome.returnPointer.object,
            args,
            summary!.objectPointer.argumentBase ?? summary!.objectPointer.argumentOffset,
            s,
            summary!.objectPointer.argumentOffset,
          );
          const displacement = outcome.returnPointer.displacement;
          return tracked(
            pointer.value.kind === "pointer"
              ? {
                  ...pointer.value,
                  displacement: unsigned(pointer.value.displacement + displacement, 16),
                  addressValue: binary("+", asExpression(pointer.value), constant(displacement), 16),
                }
              : displacement
                ? binary("+", asExpression(pointer.value), constant(displacement), 16)
                : pointer.value,
            uniqueEvidence([...pointer.evidence, ...outcome.evidence, evidenceOf(i)]),
          );
        }
        const returned = formalValue(
          outcome.returnValue,
          args,
          summary!.objectPointer.argumentBase ?? summary!.objectPointer.argumentOffset,
          s,
          summary!.objectPointer.argumentOffset,
        );
        return tracked(returned.value, uniqueEvidence([...returned.evidence, ...outcome.evidence, evidenceOf(i)]));
      };
      const mappedReturns =
        summary &&
        (summary.returnPathsComplete ?? !summary.uncertainEffects) &&
        summary.outcomes?.length &&
        summary.outcomes.length <= 24
          ? summary.outcomes
              .filter((outcome) =>
                possible(
                  conjunction([
                    ...s.conditions,
                    formalPredicate(
                      outcome.condition,
                      args,
                      summary.objectPointer.argumentBase ?? summary.objectPointer.argumentOffset,
                      s,
                      summary.objectPointer.argumentOffset,
                    ),
                  ]),
                ),
              )
              .map(outcomeReturn)
          : [];
      const commonReturn =
        mappedReturns.length && mappedReturns.every((item) => same(item.value, mappedReturns[0]!.value))
          ? mappedReturns[0]
          : undefined;
      const ownerArgument = summary
        ? formalArgument(
            args,
            summary.objectPointer.argumentBase ?? summary.objectPointer.argumentOffset,
            summary.objectPointer.argumentOffset,
          )
        : args.at(-1);
      const argument = ownerArgument?.value;
      const passesPart = argument?.kind === "pointer" && argument.object === "part" && argument.displacement === 0;
      const passesObservedMember = !!(
        s.observationOnly &&
        argument?.kind === "pointer" &&
        argument.object === s.observationObject &&
        argument.displacement === 0
      );
      const engineBefore = i.target && options.engineSummaries?.get(i.target.address);
      const composableObject = (object: string) =>
        object === "part" ||
        (engineBefore?.kind === "owner-and-outline-relation" &&
          engineBefore.writes.some(
            (write) => write.separateStorage === "outline" && object === `referenced-by(part+${hex(write.path[0]!)})`,
          ));
      const preciseMemberRelations = !!(
        passesObservedMember &&
        summary &&
        !summary.uncertainEffects &&
        summary.outcomes?.length &&
        summary.outcomes.length <= 24 &&
        summary.outcomes.every((outcome) => outcome.fields.every((effect) => composableObject(effect.object)))
      );
      let engine = i.target && options.engineSummaries?.get(i.target.address);
      const listScope = listConsumerCalls.get(i.address);
      const listOwner = engine?.listConsumer
        ? formalArgument(args, engine.listConsumer.argumentOffset, engine.listConsumer.argumentOffset).value
        : undefined;
      if (
        engine?.listConsumer &&
        listScope &&
        listOwner?.kind === "pointer" &&
        listOwner.object === "part" &&
        listOwner.displacement === 0
      ) {
        const contract = engine.listConsumer;
        engine = {
          ...engine,
          ...listScope,
          address: engine.address,
          listConsumerScope: listScope,
          kind: "fresh-overlap-list-consumer",
          purpose:
            "Applies the typed list consumer to a fresh owner-excluding overlap list; only listed parts and their outline storage may change.",
          argumentOffset: contract.argumentOffset,
          argumentKind: "object",
          returns: [],
          writes: contract.fields.map((f) => ({
            ...contract,
            root: "unknown" as const,
            selection: "external-list-member" as const,
            path: [],
            ...(f.root === "outline" ? { separateStorage: "outline" as const } : {}),
            offset: f.offset,
            width: f.width,
            value: unknown(
              "The selected member's final value depends on its type, geometry and helper conditions",
              f.width,
            ),
            condition: {
              kind: "unknown" as const,
              reason: "A reached list member satisfies the consumer's branch conditions.",
            },
          })),
          footprint: {
            complete: !contract.unknownGlobals,
            partMemoryComplete: true,
            preservesArgumentMemory: false,
            preservesPartState: true,
            unknownEffects: contract.unknownGlobals
              ? ["The member helpers may change unresolved backend globals."]
              : [],
            unknownPartEffects: [],
            unknownGlobalEffects: contract.unknownGlobals
              ? ["The member helpers may change unresolved backend globals."]
              : [],
          },
        };
      }
      if (engine?.factory) {
        const type = args.at(-1 - (engine.factory.typeArgument - engine.argumentOffset) / 2)?.value;
        const successful =
          type?.kind === "constant"
            ? [
                ...(engine.factory.alwaysSuccessfulConstructors ?? []),
                ...(engine.factory.ownedConstructors ?? []),
              ].find((ctor) => ctor.type === unsigned(type.value, 16))
            : undefined;
        if (
          type?.kind === "constant" &&
          (engine.factory.noConstructorTypes.includes(unsigned(type.value, 16)) || successful)
        ) {
          const specialized = engine.factory.noConstructor;
          engine = {
            ...engine,
            ...specialized,
            ...(successful
              ? {
                  evidence: uniqueEvidence([...specialized.evidence, ...successful.evidence]),
                  purpose:
                    "Allocates a fresh part with a checked constructor and cleanup ownership, preserving existing parts.",
                }
              : {}),
            assumptions: [
              ...new Set([
                ...engine.assumptions.filter(
                  (assumption) => !assumption.includes("effects on other objects remain unresolved"),
                ),
                ...specialized.assumptions,
                ...(successful
                  ? successful.assumptions
                  : [
                      "The actual constant type argument selects an initial null constructor entry in the structurally discovered table.",
                    ]),
              ]),
            ],
          };
        }
      }
      const pureReturnRelations = !!(
        engine &&
        engine.footprint.complete &&
        engine.footprint.preservesArgumentMemory &&
        !engine.writes.length &&
        !engine.globalObjectWrites?.length &&
        !engine.returns.length &&
        !engine.numeric &&
        summary &&
        !summary.uncertainEffects &&
        summary.outcomes?.length &&
        summary.outcomes.length <= 24 &&
        summary.outcomes.every((outcome) => outcome.fields.length === 0)
      );
      const ownReturns = summary?.instructions.filter((instruction) => instruction.flow === "return") ?? [];
      const returnKinds = new Set(ownReturns.map((instruction) => instruction.mnemonic));
      const cleanupValues = new Set(
        ownReturns.map((instruction) =>
          instruction.operands[0]?.kind === "immediate" ? instruction.operands[0].value : 0,
        ),
      );
      const stackBytes =
        engine?.returnConvention?.stackBytes ??
        (ownReturns.length && returnKinds.size === 1 && cleanupValues.size === 1 ? [...cleanupValues][0] : undefined);
      const returnedStack = (state: AbstractState) => {
        if (stackBytes === undefined || stackBytes === 0) return;
        if (stackBytes % 2) {
          state.stack = [];
          registerWrite(
            "sp",
            tracked(unknown("Odd-byte callee stack cleanup is not word-aligned"), [evidenceOf(i)]),
            state,
          );
          diagnostics.add(`Callee stack cleanup at ${hex(i.address)} is not word-aligned`);
          return;
        }
        state.stack.splice(Math.max(0, state.stack.length - stackBytes / 2));
        const sp = registerRead("sp", state).value;
        if (sp.kind === "stack")
          registerWrite("sp", tracked({ ...sp, displacement: sp.displacement + stackBytes }, [evidenceOf(i)]), state);
      };
      const checkedFarFrame = !!i.far || nearFarBridge;
      const membership = engine?.contactSmall;
      if (
        engine &&
        membership?.kind === "typed-list-membership" &&
        checkedFarFrame &&
        engine.returnConvention?.kind === "far" &&
        engine.returnConvention.stackBytes === 0
      ) {
        const ownerField = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
        const wrongType = formalPredicate(
          {
            kind: "compare",
            operator: "!=",
            left: ownerField(membership.typeField),
            right: constant(membership.requiredType),
            signed: false,
          },
          args,
          engine.argumentOffset,
          s,
          membership.ownerArgument,
        );
        const emptyList = formalPredicate(
          {
            kind: "compare",
            operator: "==",
            left: ownerField(membership.headField),
            right: constant(0),
            signed: false,
          },
          args,
          engine.argumentOffset,
          s,
          membership.ownerArgument,
        );
        if (entails(wrongType, s) || entails(emptyList, s)) {
          const selected: EngineSummary = {
            ...engine,
            kind: "empty-contact-membership",
            purpose: "Returns zero because the owner has another type or its selected contact list is empty.",
            returns: [
              {
                confidence: engine.confidence,
                evidence: engine.evidence,
                assumptions: engine.assumptions,
                register: "ax",
                value: constant(0),
                condition: { kind: "true" },
              },
            ],
          };
          if (applyEngine(selected, args, s, i)) {
            returnedStack(s);
            enqueue({ at: i.segment * 16 + ((i.offset + i.size) & 0xffff), state: s });
            continue;
          }
        }
      }
      const outline = engine?.contactOutline;
      if (
        engine &&
        outline &&
        engine.returnConvention?.kind === "far" &&
        engine.returnConvention.stackBytes === 0 &&
        checkedFarFrame
      ) {
        const still = entails(formalPredicate(outline.zeroMovementCondition, args, engine.argumentOffset, s), s);
        const probe = entails(formalPredicate(outline.probeCondition, args, engine.argumentOffset, s), s);
        if (still || probe) {
          const selected: EngineSummary = {
            ...engine,
            ...outline,
            contactOutline: undefined,
            contactSearch: undefined,
            globalObjectWrites: undefined,
            kind: still ? "stationary-outline-search" : "outline-search-probe",
            purpose: still
              ? "Returns zero without nonprivate writes because both recorded movement words are zero."
              : "Tests the outlines in probe mode, preserving nonprivate memory; the contact result still depends on the recorded geometry.",
            writes: [],
            returns: still ? [{ ...outline, register: "ax", value: constant(0), condition: { kind: "true" } }] : [],
            calls: still
              ? [outline.helpers.classifier]
              : [outline.helpers.classifier, outline.helpers.extend, outline.helpers.segment],
            assumptions: [
              ...outline.assumptions,
              still
                ? "The caller already establishes zero displacement in both contact-context words. No commit can refresh those words, so zero is invariant until a normal return."
                : "The caller already establishes a nonzero probe argument. Every reached success returns before any nonprivate commit; earlier geometric helper outputs stay in the private frame.",
            ],
            footprint: {
              complete: true,
              partMemoryComplete: true,
              preservesArgumentMemory: true,
              preservesPartState: true,
              unknownEffects: [],
            },
          };
          if (applyEngine(selected, args, s, i)) {
            returnedStack(s);
            enqueue({ at: i.segment * 16 + ((i.offset + i.size) & 0xffff), state: s });
            continue;
          }
        }
      }
      const emptyContact = engine?.contactSearch?.emptyReturn;
      if (
        engine &&
        emptyContact &&
        engine.returnConvention?.kind === "far" &&
        engine.returnConvention.stackBytes === 0 &&
        checkedFarFrame
      ) {
        const condition = formalPredicate(
          {
            kind: "compare",
            operator: "==",
            left: { kind: "field", object: "part", offset: emptyContact.outlineField, width: 16 },
            right: constant(0),
            signed: false,
          },
          args,
          emptyContact.argumentOffset,
          s,
        );
        if (entails(condition, s)) {
          const selected: EngineSummary = {
            ...engine,
            ...emptyContact,
            kind: "empty-contact-search",
            contactSearch: undefined,
            globalObjectWrites: undefined,
            purpose:
              "Stores the passed part as the engine contact subject and returns zero because it has no outline pointer.",
            calls: [],
            writes: [
              {
                ...emptyContact,
                root: "global",
                path: [],
                offset: emptyContact.subjectGlobal,
                width: 16,
                value: { kind: "field", object: "argument", offset: emptyContact.argumentOffset, width: 16 },
                condition: { kind: "true" },
              },
            ],
            returns: [{ ...emptyContact, register: "ax", value: constant(0), condition: { kind: "true" } }],
            footprint: {
              complete: true,
              partMemoryComplete: true,
              preservesArgumentMemory: true,
              preservesPartState: true,
              unknownEffects: [],
            },
          };
          if (applyEngine(selected, args, s, i)) {
            returnedStack(s);
            enqueue({ at: i.segment * 16 + ((i.offset + i.size) & 0xffff), state: s });
            continue;
          }
        }
      }
      const bypass = engine?.shortCircuit;
      if (
        engine &&
        bypass &&
        engine.returnConvention?.kind === "far" &&
        engine.returnConvention.stackBytes === 0 &&
        checkedFarFrame
      ) {
        const selected = bypass.cases.find((c) =>
          entails(formalPredicate(c.condition, args, bypass.argumentOffset, s, bypass.ownerArgument), s),
        );
        if (selected) {
          const condition = formalPredicate(selected.condition, args, bypass.argumentOffset, s, bypass.ownerArgument);
          s.conditions.push(condition);
          const specialized: EngineSummary = {
            ...engine,
            ...bypass,
            shortCircuit: undefined,
            kind: "connection-query-bypass",
            purpose: "Returns through a certified connection-query bypass without invoking a peer callback.",
            writes: [],
            returns: [{ ...bypass, register: "ax", value: selected.value, condition: { kind: "true" } }],
            footprint: {
              complete: true,
              partMemoryComplete: true,
              preservesArgumentMemory: true,
              preservesPartState: true,
              unknownEffects: [],
            },
          };
          if (applyEngine(specialized, args, s, i)) {
            returnedStack(s);
            enqueue({ at: i.segment * 16 + ((i.offset + i.size) & 0xffff), state: s });
            continue;
          }
        }
      }
      if (engine?.partGraph?.stateCases && passesPart) {
        // Only take the specialised path when every possible case applies; otherwise the call is handled generically.
        const branches: AbstractState[] = [];
        let declined = false;
        for (const stateCase of engine.partGraph.stateCases) {
          const condition = formalPredicate(stateCase.condition, args, engine.argumentOffset, s);
          if (!possible(conjunction([...s.conditions, condition]))) continue;
          const branch = clone(s);
          branch.conditions.push(condition);
          const selected: EngineSummary = {
            ...engine,
            writes: [
              ...engine.writes,
              {
                ...engine,
                root: "argument",
                argumentOffset: engine.argumentOffset,
                path: [],
                offset: stateOffset,
                width: 16,
                value: stateCase.value,
                condition: { kind: "true" },
              },
            ],
          };
          if (!applyEngine(selected, args, branch, i)) {
            declined = true;
            break;
          }
          returnedStack(branch);
          branches.push(branch);
        }
        if (!declined) {
          for (const branch of branches)
            enqueue({ at: i.segment * 16 + ((i.offset + i.size) & 0xffff), state: branch });
          continue;
        }
      }
      const pushedCodeSegment =
        last?.mnemonic === "push" && last.operands[0]?.kind === "register" && last.operands[0].name === "cs";
      const scalarFarReturn = summary?.instructions.at(-1)?.mnemonic === "retf";
      const scalarFrameMatches = scalarFarReturn ? i.far || pushedCodeSegment : !i.far && !pushedCodeSegment;
      if (pureReturnRelations && summary?.returnPathsComplete === true && scalarFrameMatches) {
        const definition = scalarDefinition(summary);
        const returned =
          definition &&
          formalValue(
            definition.expression,
            args,
            summary.objectPointer.argumentBase ?? summary.objectPointer.argumentOffset,
            s,
            summary.objectPointer.argumentOffset,
          );
        if (returned && (returned.value.kind === "constant" || scalarSteps.has(returned.value))) {
          for (const name of ["ax", "bx", "cx", "dx", "es"])
            registerWrite(name, tracked(unknown(`Unspecified scalar helper register ${name}`), [evidenceOf(i)]), s);
          const proof = uniqueEvidence([
            evidenceOf(i),
            ...summary.outcomes!.flatMap((o) => o.evidence),
            ...returned.evidence,
          ]);
          registerWrite("ax", tracked(returned.value, proof), s);
          s.flags = undefined;
          s.carry = undefined;
          engineCalls.push({
            instruction: i.address,
            summary: summary.address,
            purpose: "Selects a scalar constant from the recorded consecutive input ranges.",
            confidence: "inferred",
            evidence: proof,
            assumptions: summary.outcomes!.flatMap((o) => o.assumptions),
          });
          s.evidence.push(...proof);
          s.assumptions = [
            ...new Set([
              ...s.assumptions,
              ...summary.outcomes!.flatMap((o) => o.assumptions),
              "The leaf helper has a complete constant return relation, preserves its nonvolatile frame and arguments, and has no non-private memory writes. Private stack storage is valid, nonwrapping and separate from part and program data. Disjoint intervals cover the full input domain; ordinary guarded arithmetic retains the exact scalar function without splitting the caller.",
            ]),
          ];
          returnedStack(s);
          enqueue({ at: i.segment * 16 + ((i.offset + i.size) & 0xffff), state: s });
          continue;
        }
      }
      if (engine && !pureReturnRelations && !preciseMemberRelations && applyEngine(engine, args, s, i)) {
        returnedStack(s);
        const next = i.segment * 16 + ((i.offset + i.size) & 0xffff);
        enqueue({ at: next, state: s });
        continue;
      }
      if (
        summary &&
        !summary.uncertainEffects &&
        (passesPart || pureReturnRelations || passesObservedMember) &&
        summary.outcomes?.length &&
        summary.outcomes.length <= 24 &&
        summary.outcomes.every((outcome) => outcome.fields.every((effect) => composableObject(effect.object)))
      ) {
        // Compose return relations. This substitutes symbolic inputs; it never invokes the callee's instructions.
        const next = i.segment * 16 + ((i.offset + i.size) & 0xffff);
        for (const outcome of summary.outcomes) {
          const condition = formalPredicate(
            outcome.condition,
            args,
            summary.objectPointer.argumentBase ?? summary.objectPointer.argumentOffset,
            s,
            summary.objectPointer.argumentOffset,
          );
          if (!possible(conjunction([...s.conditions, condition]))) continue;
          const mapped = outcome.fields.map((effect) => ({
            effect,
            pointer: formalObject(
              effect.object,
              args,
              summary.objectPointer.argumentBase ?? summary.objectPointer.argumentOffset,
              s,
              summary.objectPointer.argumentOffset,
            ),
            value: formalValue(
              effect.value,
              args,
              summary.objectPointer.argumentBase ?? summary.objectPointer.argumentOffset,
              s,
              summary.objectPointer.argumentOffset,
            ),
          }));
          const returned = outcomeReturn(outcome);
          const branch = clone(s);
          branch.conditions.push(condition);
          branch.assumptions = [...new Set([...branch.assumptions, ...outcome.assumptions])];
          branch.evidence.push(evidenceOf(i), ...outcome.evidence);
          for (const item of mapped) {
            branch.registers.set("__summary_owner", item.pointer);
            write(
              {
                kind: "memory",
                segment: "ds",
                base: ["__summary_owner"],
                displacement: item.effect.offset,
                direct: false,
                width: item.effect.width === 8 ? 8 : 16,
              },
              tracked(
                item.value.value,
                uniqueEvidence([...item.value.evidence, ...item.effect.evidence, evidenceOf(i)]),
              ),
              branch,
              i,
            );
          }
          branch.registers.delete("__summary_owner");
          for (const name of ["ax", "bx", "cx", "dx", "es"])
            registerWrite(
              name,
              tracked(unknown(`Volatile register returned by ${hex(summary.address)}`), [evidenceOf(i)]),
              branch,
            );
          registerWrite("ax", tracked(returned.value, uniqueEvidence([...returned.evidence, evidenceOf(i)])), branch);
          // The centre angle's answer keeps which parts' centres it is of, when both are parts the caller names.
          const centre = engine?.centreAngle;
          const from = centre && formalArgument(args, 6, centre.arguments.from).value,
            to = centre && formalArgument(args, 6, centre.arguments.to).value;
          if (from?.kind === "pointer" && to?.kind === "pointer" && !from.displacement && !to.displacement)
            registerWrite(
              "ax",
              {
                ...registerRead("ax", branch),
                centreAngle: { routine: centre!.routine, call: i.address, from: from.object, to: to.object },
              },
              branch,
            );
          branch.flags = undefined;
          branch.carry = undefined;
          returnedStack(branch);
          enqueue({ at: next, state: branch });
        }
        continue;
      }
      if (
        passesObservedMember &&
        summary &&
        !summary.uncertainEffects &&
        summary.writes.some((effect) => !["stack", "data"].includes(effect.object))
      ) {
        s.uncertain = true;
        uncertainEffects = true;
        diagnostics.add(`Effects of call at ${hex(i.address)} on an observed overlap member are not fully composed`);
      }
      if (!summary || summary.uncertainEffects) {
        uncertainEffects = true;
        s.uncertain = true;
        s.havoc = true;
        s.fieldHavoc = undefined;
        s.havocAt = i.address;
        s.partMemoryHavocAt = undefined;
        s.globalHavocAt = i.address;
        for (const key of s.memory.keys()) if (!key.startsWith("stack:")) s.memory.delete(key);
        s.memory.set(
          `part:${stateOffset}:16`,
          tracked(unknown(`Unresolved call side effects at ${hex(i.address)}`), [evidenceOf(i)]),
        );
        s.stateWritten = true;
        diagnostics.add(
          `Effects of call at ${hex(i.address)} to ${i.target ? hex(i.target.address) : "an indirect target"} are not fully resolved`,
        );
      }
      if (summary && passesPart) {
        const possibleWrites = summary.writes.filter((w) => w.object === "part");
        for (const offset of new Set(possibleWrites.map((w) => w.offset))) {
          const effects = possibleWrites.filter((w) => w.offset === offset);
          if (effects.length === 1 && effects[0]!.condition.kind === "true" && effects[0]!.value.kind === "constant") {
            const w = effects[0]!;
            const op: Operand = {
              kind: "memory",
              segment: "ds",
              base: [],
              displacement: offset,
              direct: true,
              width: w.width === 8 ? 8 : 16,
            };
            const ptrName = "__summary_part";
            s.registers.set(ptrName, tracked({ kind: "pointer", object: "part", displacement: 0, width: 16 }));
            write({ ...op, base: [ptrName], direct: false }, tracked(w.value, [...w.evidence, evidenceOf(i)]), s, i);
            s.registers.delete(ptrName);
          } else {
            s.memory.set(
              `part:${offset}:16`,
              tracked(unknown(`Conditional effects of helper ${hex(summary.address)} on field ${hex(offset)}`), [
                evidenceOf(i),
                ...effects.flatMap((w) => w.evidence),
              ]),
            );
            if (offset === stateOffset) s.stateWritten = true;
          }
        }
      } else if (!summary || summary.writes.some((w) => w.object !== "data" && w.object !== "stack")) {
        // The aliasing relation is unknown: retain a symbolic unknown rather than claiming the state survived.
        if (passesPart || !summary) {
          s.memory.set(
            `part:${stateOffset}:16`,
            tracked(unknown(`Unresolved side effects of call at ${hex(i.address)}`), [evidenceOf(i)]),
          );
          s.stateWritten = true;
        }
      }
      for (const name of ["ax", "bx", "cx", "dx", "es"])
        registerWrite(
          name,
          tracked(unknown(`Value returned or clobbered by call at ${hex(i.address)}`), [evidenceOf(i)]),
          s,
        );
      if (commonReturn) registerWrite("ax", commonReturn, s);
      if (engine && "returnPointerClass" in engine && engine.returnPointerClass === "nullable-fresh") {
        registerWrite(
          "ax",
          tracked(
            {
              kind: "pointer",
              object: `fresh object returned at ${hex(i.address)}`,
              displacement: 0,
              width: 16,
              addressValue: field(`nullable allocation result at ${hex(i.address)}`, 0),
            },
            uniqueEvidence([evidenceOf(i), ...engine.returns.flatMap((returned) => returned.evidence)]),
          ),
          s,
        );
        s.assumptions = [
          ...new Set([
            ...s.assumptions,
            "The factory's proved nullable fresh return retains an address identity; its constructor and memory side effects remain unresolved.",
          ]),
        ];
      }
      returnedStack(s);
      s.flags = undefined;
      s.carry = undefined;
    } else if (
      i.flow === "next" &&
      !["nop", "leave", "cld", "std", "cli", "sti", "clc", "stc", "cmc", "wait"].includes(i.mnemonic)
    ) {
      diagnostics.add(`Symbolic transfer for ${i.mnemonic} at ${hex(i.address)} is unresolved`);
      uncertainEffects = true;
      s.uncertain = true;
      s.flags = undefined;
      s.carry = undefined;
      if (["div", "idiv", "aam", "aad", "aaa", "aas", "daa", "das"].includes(i.mnemonic)) {
        registerWrite("ax", tracked(unknown(`Unresolved ${i.mnemonic}`), e), s);
        registerWrite("dx", tracked(unknown(`Unresolved ${i.mnemonic}`), e), s);
      } else if (dest?.kind === "register" || dest?.kind === "memory")
        write(dest, tracked(unknown(`Unresolved ${i.mnemonic}`), e), s, i);
      else if (/^(rep |movs|stos|lods|scas|cmps|ins|outs|popa|pusha)/.test(i.mnemonic)) {
        for (const name of ["ax", "bx", "cx", "dx", "si", "di"])
          registerWrite(name, tracked(unknown(`Unresolved ${i.mnemonic}`), e), s);
        s.memory.clear();
        s.havoc = true;
        s.fieldHavoc = undefined;
        s.havocAt = i.address;
        s.partMemoryHavocAt = undefined;
        s.globalHavocAt = i.address;
        s.stateWritten = true;
      }
    }
    if (flagResult && i.mnemonic !== "not") {
      if (!carryNeeded.has(i.address)) s.carry = undefined;
      else if (["and", "or", "xor", "test"].includes(i.mnemonic)) s.carry = tracked(constant(0, 1), e);
      else if (["add", "adc", "sub", "sbb", "cmp", "neg"].includes(i.mnemonic)) {
        const left = i.mnemonic === "neg" ? constant(0, av.width) : av;
        const right = i.mnemonic === "neg" ? av : bv;
        const operator = ["add", "adc"].includes(i.mnemonic) ? "+" : "-";
        let wide = binary(operator, left, right, av.width + 1);
        if (["adc", "sbb"].includes(i.mnemonic))
          wide = binary(
            operator,
            wide,
            s.carry ? asExpression(s.carry.value) : unknown(`Carry reaching ${hex(i.address)} is unresolved`, 1),
            av.width + 1,
          );
        s.carry = tracked(
          binary("&", binary(">>>", wide, constant(av.width), av.width + 1), constant(1, 1), 1),
          uniqueEvidence(e),
        );
      } else if (!["inc", "dec"].includes(i.mnemonic)) s.carry = undefined;
      s.flags = { operation: i.mnemonic, left: av, right: bv, result: flagResult, evidence: uniqueEvidence(e) };
    }
    if (i.flow === "return") {
      finish(s, i);
      continue;
    }
    if (i.flow === "stop") {
      uncertainEffects = true;
      diagnostics.add(`Path ends at ${i.text} at ${hex(i.address)}`);
      unresolvedExit(s, i, "Stopped path has no proved return");
      continue;
    }
    const next = i.segment * 16 + ((i.offset + i.size) & 0xffff);
    if (i.flow === "branch") {
      for (const taken of [false, true]) {
        const branch = clone(s);
        const predicate = flagPredicate(i, branch, taken);
        branch.conditions.push(predicate);
        branch.evidence.push(...(s.flags?.evidence ?? []), ...(s.carry?.evidence ?? []), evidenceOf(i));
        if (
          possible(conjunction(branch.conditions)) &&
          (!options.stateCount ||
            Array.from({ length: options.stateCount }, (_, n) => n).some((n) =>
              possible(conjunction(branch.conditions), n, stateOffset),
            ))
        )
          enqueue({ at: taken ? i.target!.address : next, state: branch });
      }
    } else if (i.flow === "jump") {
      if (i.target) enqueue({ at: i.target.address, state: s });
      else {
        const edges = code.edges.filter((edge) => edge.from === i.address && edge.to !== null);
        if (!edges.length) {
          uncertainEffects = true;
          diagnostics.add(`Indirect jump at ${hex(i.address)} has no resolved destination`);
          unresolvedExit(s, i, "Indirect destination is unresolved");
        }
        for (const edge of edges) {
          const branch = clone(s);
          if (edge.selector && edge.caseValue !== undefined) {
            const selector = read(edge.selector, branch);
            // Dense table indices have been shifted to word offsets by the dispatch sequence.
            const expected = edge.caseValue * (edge.selectorScale ?? 1);
            branch.conditions.push({
              kind: "compare",
              operator: "==",
              left: asExpression(selector.value),
              right: constant(expected),
              signed: false,
            });
            branch.evidence.push(...selector.evidence, ...(edge.evidence ?? []));
          } else
            branch.conditions.push({
              kind: "unknown",
              reason: `Jump-table selector at ${hex(i.address)} for destination ${hex(edge.to!)}`,
            });
          enqueue({ at: edge.to!, state: branch });
        }
      }
    } else enqueue({ at: next, state: s });
  }
  if (queue.some((pending) => !pending.state.observationOnly)) {
    diagnostics.add(
      `Symbolic path budget (${maxVisits}) reached at ${hex(entry.address)}; remaining paths are unresolved`,
    );
    uncertainEffects = true;
    if (queue.length <= 64)
      for (const pending of queue)
        unresolvedExit(
          pending.state,
          instructions.get(pending.at) ?? code.instructions[0]!,
          "Symbolic path budget reached",
        );
    else
      unresolvedExit(
        initial,
        code.instructions[0]!,
        "Symbolic path budget reached; remaining path conditions are unresolved",
      );
  }
  // Findings that say the same thing are duplicates whichever path proved them; one path's evidence is enough.
  const key = (item: unknown) =>
    JSON.stringify(item, (name, value: unknown) => (name === "evidence" ? undefined : value));
  const dedup = <T>(items: T[]) => [...new Map(items.map((item) => [key(item), item])).values()];
  return {
    ...code,
    ...(gearRun ? { gearRun } : {}),
    ...(derivedValues.length ? { derivedValues: dedup(derivedValues) } : {}),
    status: code.status === "error" ? "error" : uncertainEffects ? "partial" : code.status,
    uncertainties: [...diagnostics],
    objectPointer: {
      argumentOffset,
      argumentBase: code.instructions.some((instruction) => instruction.mnemonic === "retf") ? 6 : 4,
      registers: [...pointerRegisters],
      confidence: pointerRegisters.size ? "inferred" : "unresolved",
      assumptions: [
        `The first argument is a near part pointer at frame offset ${argumentOffset}, conditional on the caller passing that pointer.`,
        "Callees preserve SI, DI, BP and DS; volatile registers are discarded.",
      ],
      evidence: uniqueEvidence(pointerEvidence),
    },
    writes: dedup(writes),
    transitions: mergeTransitions(dedup(transitions)),
    comparisons: dedup(comparisons),
    outcomes: dedup(outcomes),
    iterationOutcomes: dedup(iterationOutcomes),
    returnPathsComplete,
    analysisWork: {
      visits: Math.min(visits, maxVisits),
      limit: maxVisits,
      pendingPaths: queue.filter((p) => !p.state.observationOnly).length,
    },
    engineCalls: dedup(engineCalls),
    controlFlowJoins: dedup(controlFlowJoins),
    loops: dedup(usedLoops),
    listLoops: dedup(usedListLoops),
    uncertainEffects,
  };
}

/** Eliminates a branch only when both complementary outcomes have exactly the same final state expression. */
function mergeTransitions(input: Transition[]): Transition[] {
  const result = [...input];
  const inverse: Record<string, string> = { "==": "!=", "!=": "==", "<": ">=", ">=": "<", "<=": ">", ">": "<=" };
  const terms = (p: Predicate) => (p.kind === "and" ? p.terms : p.kind === "true" ? [] : [p]);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < result.length; a++)
      for (let b = a + 1; b < result.length; b++) {
        const left = result[a]!;
        const right = result[b]!;
        if (left.confidence !== right.confidence || !same(left.to, right.to) || !same(left.from, right.from)) continue;
        const lt = terms(left.condition);
        const rt = terms(right.condition);
        if (lt.length !== rt.length) continue;
        const onlyLeft = lt.filter((p) => !rt.some((q) => same(p, q)));
        const onlyRight = rt.filter((p) => !lt.some((q) => same(p, q)));
        if (onlyLeft.length !== 1 || onlyRight.length !== 1) continue;
        const x = onlyLeft[0]!;
        const y = onlyRight[0]!;
        if (x.kind !== "compare" || y.kind !== "compare" || !same({ ...x, operator: inverse[x.operator] }, y)) continue;
        const condition = conjunction(lt.filter((p) => p !== x));
        const updates: FieldWrite[] = [];
        const leftFields = new Map((left.updates ?? []).map((u) => [`${u.object}:${u.offset}:${u.width}`, u]));
        const rightFields = new Map((right.updates ?? []).map((u) => [`${u.object}:${u.offset}:${u.width}`, u]));
        for (const key of new Set([...leftFields.keys(), ...rightFields.keys()])) {
          const l = leftFields.get(key);
          const r = rightFields.get(key);
          const exemplar = l ?? r!;
          const lv = l?.value ?? field(exemplar.object, exemplar.offset, exemplar.width);
          const rv = r?.value ?? field(exemplar.object, exemplar.offset, exemplar.width);
          const value = same(lv, rv)
            ? lv
            : unknown(`Field ${hex(exemplar.offset)} differs on complementary paths`, exemplar.width);
          updates.push({
            ...exemplar,
            condition,
            value,
            confidence: containsUnknown(value) ? "unresolved" : exemplar.confidence,
            evidence: uniqueEvidence([...(l?.evidence ?? []), ...(r?.evidence ?? [])]),
          });
        }
        result[a] = {
          ...left,
          condition,
          ...(left.updates || right.updates ? { updates } : {}),
          assumptions: [...new Set([...left.assumptions, ...right.assumptions])],
          evidence: uniqueEvidence([...left.evidence, ...right.evidence]),
        };
        result.splice(b, 1);
        changed = true;
        break outer;
      }
  }
  return result;
}

const u16 = (bytes: Uint8Array, at: number) => {
  if (at < 0 || at + 2 > bytes.length) throw new Error(`Word at ${hex(at)} is outside the program image`);
  return bytes[at]! | (bytes[at + 1]! << 8);
};

/** Derives the owner's stack position from pushes and the object used by a checked far-table dispatch. */
export function inferDispatchedObjectArgument(
  code: RoutineCode,
  site: number,
  typeOffset: number,
): (Finding & { offset: number }) | undefined {
  const callIndex = code.instructions.findIndex((instruction) => instruction.address === site);
  if (callIndex < 0 || !code.instructions[callIndex]!.far) return undefined;
  const writes = (instruction: Instruction, name: string) =>
    instruction.operands[0]?.kind === "register" &&
    instruction.operands[0].name === name &&
    !["cmp", "test", "push"].includes(instruction.mnemonic);
  for (let typeIndex = callIndex - 1; typeIndex >= Math.max(0, callIndex - 12); typeIndex--) {
    const load = code.instructions[typeIndex]!,
      memory = load.operands[1];
    if (
      load.mnemonic !== "mov" ||
      load.operands[0]?.kind !== "register" ||
      load.operands[0].name !== "ax" ||
      memory?.kind !== "memory" ||
      memory.segment !== "ds" ||
      memory.base.length !== 1 ||
      memory.displacement !== typeOffset
    )
      continue;
    const owner = memory.base[0]!;
    let origin: Operand | undefined;
    for (let at = typeIndex - 1; at >= Math.max(0, typeIndex - 4); at--) {
      const previous = code.instructions[at]!;
      if (!writes(previous, owner)) continue;
      if (previous.mnemonic === "mov") origin = previous.operands[1];
      break;
    }
    for (let pushed = typeIndex - 1; pushed >= Math.max(0, typeIndex - 20); pushed--) {
      const instruction = code.instructions[pushed]!,
        source = instruction.operands[0];
      if (instruction.mnemonic !== "push" || !source) continue;
      const sequence = code.instructions.slice(pushed, callIndex + 1);
      if (
        !sequence.every((item, n) => n === 0 || sequence[n - 1]!.address + sequence[n - 1]!.size === item.address) ||
        sequence.slice(0, -1).some((item) => item.flow !== "next")
      )
        continue;
      let matches =
        source.kind === "register" &&
        source.name === owner &&
        !code.instructions.slice(pushed + 1, typeIndex).some((item) => writes(item, owner));
      if (!matches && origin && same(source, origin)) {
        matches =
          source.kind === "register"
            ? !code.instructions.slice(pushed + 1, typeIndex).some((item) => writes(item, source.name))
            : source.kind === "memory" &&
              !code.instructions
                .slice(pushed + 1, typeIndex)
                .some(
                  (item) =>
                    item.operands[0]?.kind === "memory" &&
                    same(item.operands[0], source) &&
                    !["cmp", "test", "push"].includes(item.mnemonic),
                );
      }
      if (!matches) continue;
      const after = sequence.slice(1, -1).filter((item) => item.mnemonic === "push").length;
      return {
        offset: 6 + 2 * after,
        confidence: "inferred",
        evidence: sequence.map(evidenceOf),
        assumptions: [
          "The checked dispatch makes a far call with word arguments pushed from right to left.",
          "The matched pushed value is the object whose type selects the callback record; intervening argument setup preserves that value.",
        ],
      };
    }
    break;
  }
  return undefined;
}

/** Reads behaviour from an unmodified packed program and its searched type table. No game-specific address is used. */
export function readBehaviour(program: Uint8Array, list: ProgramParts): BehaviourReport {
  const image = unpackLzexe(program);
  for (const record of list.records) {
    if (!record.bytes.every((byte, index) => image[record.at + index] === byte))
      throw new Error(`Type record ${record.type} does not belong to this program at ${hex(record.at)}`);
  }
  const layout = discoverBehaviourLayout(image, list.table, list.records.length);
  if (
    layout.callbacks.length !== 6 ||
    layout.objectArgument.offset === undefined ||
    !layout.fields.some((f) => f.name === "state" && f.confidence === "checked")
  )
    throw new Error(
      `Cannot establish callback dispatch, object argument and state field: ${layout.diagnostics.join("; ") || "incomplete structural evidence"}`,
    );
  if (!layout.callbacks.find((callback) => callback.role === "bounce")?.objectSource)
    throw new Error("Cannot establish which object owns the bounce callback from its dispatch instructions");
  const stateOffset = layout.fields.find((f) => f.name === "state")!.offset;
  const callbackFields = layout.callbacks.map((c) => c.field).sort((a, b) => a - b);
  const timing = findBehaviourTiming(image, layout.callbacks.find((c) => c.role === "run")?.sites);
  const references = new Map<number, CallbackReference[]>();
  const entries = new Map<number, CodeAddress>();
  for (const record of list.records) {
    const callbacks = Array.from({ length: 6 }, (_, slot): CallbackReference => {
      const at = callbackFields[slot]!;
      const offset = u16(record.bytes, at);
      const segment = u16(record.bytes, at + 2);
      const address = segment * 16 + offset;
      if (address >= image.length)
        throw new Error(
          `Type ${record.type} callback ${hex(at)} points outside the image: ${hex(segment)}:${hex(offset)}`,
        );
      entries.set(address, { address, segment, offset });
      return {
        slot,
        field: at,
        address,
        segment,
        offset,
        shared: false,
        sharedDefault: false,
        role: `${layout.callbacks.find((c) => c.field === at)!.role} callback candidate`,
        confidence: "inferred",
        assumptions: layout.callbacks.find((c) => c.field === at)!.assumptions,
        evidence: layout.callbacks.find((c) => c.field === at)!.evidence,
      };
    });
    references.set(record.type, callbacks);
  }
  const counts = new Map<number, number>();
  for (const callbacks of references.values())
    for (const c of callbacks) counts.set(c.address, (counts.get(c.address) ?? 0) + 1);
  const codes = new Map<number, RoutineCode>();
  const pending = [...entries.values()];
  // Following static call references builds summaries of shared helpers without invoking any callback.
  while (pending.length && codes.size < 1800) {
    const entry = pending.pop()!;
    if (codes.has(entry.address)) continue;
    const code = readRoutineCode(image, entry, list.dataSegment);
    codes.set(entry.address, code);
    for (const call of code.calls)
      if (call.target && call.target.address < image.length && !codes.has(call.target.address)) {
        entries.set(call.target.address, call.target);
        pending.push(call.target);
      }
  }
  for (const callback of layout.callbacks)
    if (!callback.objectSource) {
      const mappings = callback.sites.map((site) => {
        const code = [...codes.values()].find((candidate) =>
          candidate.instructions.some((instruction) => instruction.address === site),
        );
        return (
          code &&
          inferDispatchedObjectArgument(code, site, layout.fields.find((field) => field.name === "type")!.offset)
        );
      });
      if (mappings.length && mappings.every((mapping) => mapping && mapping.offset === mappings[0]!.offset))
        callback.objectSource = {
          argumentOffset: mappings[0]!.offset,
          path: [],
          argumentRole: "owner",
          confidence: "inferred",
          evidence: uniqueEvidence(mappings.flatMap((mapping) => mapping!.evidence)),
          assumptions: [...new Set(mappings.flatMap((mapping) => mapping!.assumptions))],
        };
    }
  const helpers = discoverEngineSummaries(image, codes, layout, list.table, list.dataSegment, list.records.length);
  const lifecycle = discoverBehaviourLifecycle(image, codes, layout);
  for (const field of discoverLifecycleFieldRoles(lifecycle, layout))
    if (!layout.fields.some((known) => known.offset === field.offset)) layout.fields.push(field);
  const engineSummaries = new Map(helpers.map((helper) => [helper.address, helper]));
  const callbackSlots = new Map<number, Set<number>>();
  for (const callbacks of references.values())
    for (const callback of callbacks) {
      const slots = callbackSlots.get(callback.address) ?? new Set<number>();
      slots.add(callback.slot);
      callbackSlots.set(callback.address, slots);
    }
  const summaries = new Map<number, RoutineAnalysis>();
  const active = new Set<number>();
  const summarise = (address: number): RoutineAnalysis => {
    const existing = summaries.get(address);
    if (existing) return existing;
    const entry = entries.get(address)!;
    const code = codes.get(address);
    const engine = engineSummaries.get(address);
    if (
      code &&
      engine &&
      !counts.has(address) &&
      !["unclassified", "call-wrapper", "read-only"].includes(engine.kind) &&
      engine.footprint.preservesPartState
    ) {
      const writes: FieldWrite[] = engine.writes.map((effect) => {
        let object =
          effect.root === "argument"
            ? effect.argumentOffset === engine.argumentOffset
              ? "part"
              : `argument at ${effect.argumentOffset}`
            : effect.root === "global"
              ? "data"
              : "unknown";
        for (const offset of effect.path) object = `referenced-by(${object}+${hex(offset)})`;
        return { ...effect, object, routine: address };
      });
      const summary: RoutineAnalysis = {
        ...code,
        status: engine.footprint.complete ? code.status : "partial",
        uncertainties: [...code.uncertainties, ...engine.footprint.unknownEffects],
        objectPointer: {
          argumentOffset: engine.argumentOffset,
          registers: [],
          confidence: engine.argumentKind === "object" ? "inferred" : "unresolved",
          assumptions: engine.assumptions,
          evidence: engine.evidence,
        },
        writes,
        comparisons: [],
        transitions: [],
        outcomes: [],
        engineCalls: [],
        uncertainEffects: !engine.footprint.complete,
      };
      summaries.set(address, summary);
      return summary;
    }
    active.add(address);
    for (const call of code?.calls ?? [])
      if (call.target && entries.has(call.target.address) && !active.has(call.target.address))
        summarise(call.target.address);
    active.delete(address);
    const returnKinds = new Set(code?.instructions.filter((i) => i.flow === "return").map((i) => i.mnemonic));
    const callbackArguments = [...(callbackSlots.get(address) ?? [])].map(
      (slot) => layout.callbacks[slot]?.objectSource?.argumentOffset ?? layout.objectArgument.offset!,
    );
    const argumentOffset = counts.has(address)
      ? callbackArguments.length && callbackArguments.every((offset) => offset === callbackArguments[0])
        ? callbackArguments[0]!
        : layout.objectArgument.offset
      : returnKinds.size === 1 && returnKinds.has("ret")
        ? 4
        : 6;
    if (code && !counts.has(address)) {
      const consumers = discoverExternalListConsumers(code, engineSummaries, stateOffset);
      if (consumers.length === 1) {
        const contract = consumers[0]!;
        const prior = engineSummaries.get(address);
        const conditional: EngineSummary = {
          ...contract,
          ...prior,
          address,
          kind: "conditional-list-consumer",
          argumentOffset: contract.argumentOffset,
          argumentKind: "object",
          purpose:
            "Consumes an externally supplied list; its scoped effects require a fresh, owner-excluding producer in the caller.",
          listConsumer: contract,
          writes: prior?.writes ?? [],
          returns: prior?.returns ?? [],
          calls: code.calls.flatMap((c) => (c.target ? [c.target.address] : [])),
          returnConvention: contract.returnConvention,
          footprint: {
            complete: false,
            partMemoryComplete: false,
            preservesArgumentMemory: false,
            preservesPartState: false,
            unknownEffects: ["The external list preconditions have not been established at an arbitrary entry."],
          },
        };
        engineSummaries.set(address, conditional);
        const at = helpers.findIndex((h) => h.address === address);
        if (at < 0) helpers.push(conditional);
        else helpers[at] = conditional;
      }
    }
    const routine = analyseRoutine(image, entry, {
      dataSegment: list.dataSegment,
      stateOffset,
      argumentOffset,
      summaries,
      maxVisits: counts.has(address) ? 12_000 : 800,
      code,
      engineSummaries,
      codes,
      layout,
      ...(callbackSlots.get(address)?.size === 1 &&
      callbackSlots.get(address)!.has(0) &&
      layout.callbacks[0]?.objectSource?.path.length === 1
        ? { objectArgument: "collider" as const, ownerLink: layout.callbacks[0].objectSource.path[0] }
        : {}),
    });
    summaries.set(address, routine);
    if (!engineSummaries.get(address)?.footprint.partMemoryComplete) {
      const relation = engineFromObjectRelation(routine, layout, engineSummaries);
      if (relation) {
        engineSummaries.set(address, relation);
        const at = helpers.findIndex((helper) => helper.address === address);
        if (at < 0) helpers.push(relation);
        else helpers[at] = relation;
      }
    }
    return routine;
  };
  addRopeDispatch();
  for (const callbacks of references.values()) for (const callback of callbacks) summarise(callback.address);

  /**
   * Bounds the rope connection query by what the rope callbacks it can reach write, read from the type table slot it
   * calls. A callback that itself asks along a rope makes this recursive, so the bound is repeated until it is stable;
   * every round must classify every callback, or the query keeps its unbounded summary.
   */
  function addRopeDispatch() {
    for (const query of [...engineSummaries.values()].filter((summary) => summary.kind === "connection-query")) {
      const code = codes.get(query.address);
      const dispatch = code?.instructions.find((i) => i.flow === "call" && !i.target && i.far);
      const operand = dispatch?.operands[0];
      // The table is in the segment the call uses: one loaded into ES just before it, or the data segment. Either way
      // its start, the displacement less the rope slot's field, must be the program's type table.
      const before = code?.instructions.filter((i) => dispatch && i.address < dispatch.address) ?? [];
      const loadEs = before.findLast(
        (i) => i.mnemonic === "mov" && i.operands[0]?.kind === "register" && i.operands[0].name === "es",
      );
      const loadDx =
        loadEs &&
        before
          .filter((i) => i.address < loadEs.address)
          .findLast((i) => i.mnemonic === "mov" && i.operands[0]?.kind === "register" && i.operands[0].name === "dx");
      const ropeField = layout.callbacks.find((callback) => callback.role === "rope")?.field;
      if (!code || operand?.kind !== "memory" || ropeField === undefined) continue;
      const base =
        operand.segment === "ds"
          ? list.dataSegment * 16
          : operand.segment === "es" && loadEs?.operands[1]?.kind === "register" && loadEs.operands[1].name === "dx"
            ? loadDx?.operands[1]?.kind === "immediate"
              ? loadDx.operands[1].value * 16
              : undefined
            : undefined;
      if (base === undefined || base + operand.displacement - ropeField !== list.table) continue;
      const word = (at: number) => image[at]! | (image[at + 1]! << 8);
      const ropeCallbackAt = (type: number) => {
        const at = list.table + type * 58 + ropeField;
        return word(at + 2) * 16 + word(at);
      };
      const targets = [...new Set(list.records.map((record) => ropeCallbackAt(record.type)))];
      if (!targets.every((target) => entries.has(target))) continue;
      // A question can come back to the part that asked, and then that part's own rope callback runs on it. The parts
      // that ask are the parts of the routines that call the query. When each is named directly by the type table and
      // called by nothing else, its part is of the types that name it, so only their rope callbacks can change it.
      // Otherwise every callback can.
      const callers = [...codes.values()].filter((caller) =>
        caller.calls.some((call) => call.target?.address === query.address),
      );
      const calledDirectly = (address: number) =>
        [...codes.values()].some((caller) => caller.calls.some((call) => call.target?.address === address));
      const asking = callers.every((caller) => counts.has(caller.address) && !calledDirectly(caller.address))
        ? list.records
            .filter((record) =>
              references.get(record.type)!.some((callback) => callers.some((c) => c.address === callback.address)),
            )
            .map((record) => targets.indexOf(ropeCallbackAt(record.type)))
        : undefined;
      const original = query;
      type Fields = NonNullable<ReturnType<typeof ropeCallbackWrites>>;
      const fieldsOf = (lists: Fields[], pick: (fields: Fields) => Fields["partFields"]) => [
        ...new Map(lists.flatMap(pick).map((f) => [`${f.offset}:${f.width}`, f])).values(),
      ];
      const merge = (lists: Fields[]): Fields => ({
        partFields: fieldsOf(lists, (l) => l.partFields),
        ownFields: fieldsOf(lists, (l) => l.ownFields),
        recordFields: fieldsOf(lists, (l) => l.recordFields),
        globals: lists.some((l) => l.globals),
      });
      const key = (fields: Fields) =>
        JSON.stringify(
          [fields.partFields, fields.ownFields, fields.recordFields].map((items) =>
            items.map((f) => `${f.offset}:${f.width}`).sort(),
          ),
        );
      // `ownFields` here holds what a question that comes back can change on the part that asks.
      let fields: Fields = { partFields: [], ownFields: [], recordFields: [], globals: false };
      let accepted = false;
      for (let round = 0; round < 5; round++) {
        summaries.clear();
        const analyses = targets.map((target) => summarise(target));
        const each = analyses.map((analysis) => ropeCallbackWrites([analysis]));
        const union = merge([fields, ...each.filter((item): item is Fields => !!item)]);
        union.ownFields = asking
          ? fieldsOf([fields, ...asking.flatMap((at) => each[at] ?? [])], (l) => l.ownFields)
          : union.partFields;
        if (round > 0 && each.every(Boolean) && key(union) === key(fields)) {
          accepted = true;
          break;
        }
        fields = union;
        engineSummaries.set(query.address, ropeDispatchSummary(original, fields, analyses, 8, fields.ownFields));
      }
      if (!accepted) engineSummaries.set(query.address, original);
      const at = helpers.findIndex((helper) => helper.address === query.address);
      if (at >= 0) helpers[at] = engineSummaries.get(query.address)!;
    }
    summaries.clear();
  }
  for (const [address, code] of codes)
    if (!summaries.has(address))
      summaries.set(address, {
        ...code,
        status: code.status === "error" ? "error" : "partial",
        uncertainties: [
          ...code.uncertainties,
          "The enclosing engine summary bounds this callee; no independent part-effect outcome was computed.",
        ],
        objectPointer: {
          argumentOffset: code.instructions.some((i) => i.mnemonic === "retf") ? 6 : 4,
          registers: [],
          confidence: "unresolved",
          assumptions: [],
          evidence: [],
        },
        writes: [],
        transitions: [],
        comparisons: [],
        outcomes: [],
        engineCalls: [],
        uncertainEffects: true,
      });
  const parts = list.list.parts.map((part): PartBehaviour => {
    const callbacks = references.get(part.type)!;
    const routines = callbacks.map((callback) => {
      const routine = summaries.get(callback.address)!;
      const trivial =
        routine.status !== "error" &&
        routine.instructions.every((i) => ["ret", "retf", "nop", "mov", "xor"].includes(i.mnemonic)) &&
        !routine.writes.length &&
        !routine.calls.length &&
        !routine.edges.some((e) => ["taken", "not-taken"].includes(e.kind));
      return {
        ...callback,
        shared: counts.get(callback.address)! > 1,
        sharedDefault: counts.get(callback.address)! > 1 && trivial,
        evidence: uniqueEvidence([...callback.evidence, ...routine.instructions.slice(0, 5).map(evidenceOf)]),
      };
    });
    const owned = [...new Set(callbacks.map((c) => c.address))].map((address) => summaries.get(address)!);
    const allWrites = owned.flatMap((r) => r.writes);
    const stateWrites = allWrites.filter(
      (w) => w.offset === stateOffset && w.object !== "data" && w.object !== "stack",
    );
    const transitions = owned
      .flatMap((r) => r.transitions)
      .map((t) => ({
        ...t,
        from: stateCountOf(part)
          ? Array.from({ length: stateCountOf(part) }, (_, n) => n).filter((n) => possible(t.condition, n, stateOffset))
          : t.from,
      }));
    const counterOffsets = new Set(
      allWrites
        .filter(
          (w) =>
            w.object === "part" &&
            w.value.kind === "binary" &&
            ["+", "-"].includes(w.value.operator) &&
            w.value.left.kind === "field" &&
            w.value.left.offset === w.offset &&
            w.value.right.kind === "constant" &&
            w.value.right.value !== 0 &&
            w.offset !== stateOffset &&
            !layout.fields.some(
              (field) =>
                field.offset === w.offset &&
                [
                  "positionX",
                  "positionY",
                  "drawX",
                  "drawY",
                  "velocityX",
                  "velocityY",
                  "frameWidth",
                  "frameHeight",
                  "baseWidth",
                  "baseHeight",
                  "horizontalExtent",
                  "verticalExtent",
                ].includes(field.name),
            ),
        )
        .map((w) => w.offset),
    );
    const counters: Counter[] = [...counterOffsets]
      .filter((offset) =>
        owned.some((r) => r.comparisons.some((c) => JSON.stringify(c.predicate).includes(`"offset":${offset},`))),
      )
      .map((offset) => {
        const updates = allWrites.filter((w) => w.object === "part" && w.offset === offset);
        const comparisons = owned
          .flatMap((r) => r.comparisons)
          .filter((c) => JSON.stringify(c.predicate).includes(`"offset":${offset},`));
        return {
          offset,
          updates,
          comparisons: comparisons.map((c) => c.predicate),
          unit: "invocations of the routine containing the update; dispatch frequency remains conditional",
          confidence: "inferred",
          assumptions: [
            "A fixed amount changes this field and the routine compares it. This identifies a counter candidate, not a duration or a physical quantity.",
          ],
          evidence: uniqueEvidence([...updates.flatMap((w) => w.evidence), ...comparisons.flatMap((c) => c.evidence)]),
        };
      });
    const resetAddress = callbacks[2]!.address;
    const triggers: Trigger[] = routines.map((r) => ({
      name: r.role,
      routine: r.address,
      confidence: r.confidence,
      assumptions: r.assumptions,
      evidence: r.evidence,
    }));
    for (const write of stateWrites) {
      const text = JSON.stringify(write.condition);
      const deltaOffset = layout.fields.find((f) => f.name === "stateDelta")?.offset;
      if (deltaOffset !== undefined && text.includes(`"offset":${deltaOffset},`))
        triggers.push({
          name: `Field ${hex(deltaOffset)} gates a state change`,
          field: deltaOffset,
          routine: write.routine,
          condition: write.condition,
          confidence: write.confidence,
          assumptions: ["The code proves a gate; the producer of this field may be external to these callbacks."],
          evidence: write.evidence,
        });
    }
    const gearRun = owned.find((routine) => routine.gearRun)?.gearRun;
    const resetCode = codes.get(resetAddress);
    const gearConnections =
      gearRun && resetCode ? discoverGearConnections(resetCode, codes, gearRun, layout) : undefined;
    return {
      id: part.id,
      type: part.type,
      ...(gearRun ? { gearRun } : {}),
      ...(gearConnections ? { gearConnections } : {}),
      ...(owned.some((routine) => routine.derivedValues?.length)
        ? { derivedValues: owned.flatMap((routine) => routine.derivedValues ?? []) }
        : {}),
      frameCount: stateCountOf(part),
      routines,
      stateWrites,
      transitions,
      counters,
      reset: allWrites.filter((w) => w.routine === resetAddress),
      visibleEffects: allWrites.filter(
        (w) =>
          w.object === "part" &&
          layout.fields
            .filter((f) => !["previousState", "stateDelta"].includes(f.name))
            .some((f) => f.offset === w.offset),
      ),
      triggers,
      uncertainties: [
        ...new Set([
          ...owned.flatMap((r) => r.uncertainties),
          ...(gearRun && !gearConnections
            ? [
                "The gear run relation is certified, but the reset-time direct connection builder was not found with a complete proof.",
              ]
            : []),
        ]),
      ],
    };
  });
  const gearScheduling = discoverGearScheduling(
    image,
    codes,
    layout,
    parts.flatMap((part) => (part.gearRun ? [part.gearRun] : [])),
  );
  for (const part of parts)
    if (part.gearRun && !gearScheduling.some((finding) => finding.gearRun === part.gearRun!.address))
      part.uncertainties.push(
        "The gear callback is certified, but its engine scheduling regions were not found with a complete proof.",
      );
  const relatedObjectEffects: BehaviourReport["relatedObjectEffects"] = [];
  const predicates = (p: Predicate): Predicate[] => (p.kind === "and" ? p.terms.flatMap(predicates) : [p]);
  for (const source of parts)
    for (const callback of source.routines) {
      const analysis = summaries.get(callback.address)!;
      for (const write of analysis.writes.filter((w) => w.object.startsWith("referenced-by"))) {
        const typePredicates = predicates(write.condition).filter(
          (p): p is Extract<Predicate, { kind: "compare" }> =>
            p.kind === "compare" &&
            p.operator === "==" &&
            p.left.kind === "field" &&
            p.left.object === write.object &&
            p.left.offset === layout.fields.find((f) => f.name === "type")?.offset &&
            p.right.kind === "constant",
        );
        const targetType = typePredicates[0]?.right.kind === "constant" ? typePredicates[0].right.value : undefined;
        const effect = {
          sourceType: source.type,
          sourcePart: source.id,
          write,
          ...(targetType === undefined ? {} : { targetType }),
          confidence: write.confidence,
          assumptions: [
            "The referenced object's type field is inferred from the dispatcher's type-index load; unresolved aliases are retained.",
          ],
          evidence: write.evidence,
        };
        relatedObjectEffects.push(effect);
        const target = parts.find((p) => p.type === targetType);
        if (target)
          target.triggers.push({
            name: `Field ${hex(write.offset)} written by ${source.id}`,
            routine: write.routine,
            field: write.offset,
            source: source.type,
            targetType,
            write,
            condition: write.condition,
            confidence: write.confidence,
            assumptions: effect.assumptions,
            evidence: write.evidence,
          });
      }
    }
  const collisionDispatch = discoverCollisionDispatch(image, codes, layout, list, engineSummaries);
  if (!collisionDispatch.length)
    for (const part of parts)
      part.uncertainties.push(
        "The complete contact-processing region was not found; callback selection and response routing remain unresolved.",
      );
  return {
    listId: list.list.id,
    ...(gearScheduling.length ? { gearScheduling } : {}),
    collisionDispatch,
    imageLength: image.length,
    dataSegment: list.dataSegment,
    layout,
    timing,
    helpers: helpers.sort((a, b) => a.address - b.address),
    lifecycle,
    creation: discoverCreationDefaults(image, helpers, layout, list.dataSegment),
    parts,
    relatedObjectEffects,
    routines: [...summaries.values()].sort((a, b) => a.address - b.address),
    typeTable: {
      address: list.table,
      stride: 58,
      words: list.records.map((record) =>
        Array.from(
          { length: record.bytes.length >> 1 },
          (_, n) => record.bytes[n * 2]! | (record.bytes[n * 2 + 1]! << 8),
        ),
      ),
    },
    assumptions: [
      "All addresses are relative to the unpacked load image, with the DOS relocation load base removed.",
      "Slot names, object field meanings and callback frequency have separate evidence and must not be promoted from a v25 lead alone.",
      "A transition describes the final symbolic state along one acyclic control flow path. Loops, aliasing and unsupported effects remain unresolved.",
      "Calls are analysed using static summaries. No instruction, callback or fake part is executed.",
      ...(pending.length ? ["The call graph routine budget was reached; omitted callees remain unresolved."] : []),
    ],
  };
}
