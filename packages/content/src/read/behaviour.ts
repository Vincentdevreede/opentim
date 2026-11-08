/**
 * Static visual behaviour of TIM 1 and Even More. The decoder builds a control flow graph; the analysis propagates
 * symbolic expressions through that graph. It never creates a live game object or executes an instruction. A field
 * is an input variable, and loops and unknown calls lose information rather than being run with invented inputs.
 */

import { maskValue } from "./behaviour-list-masks.ts";
import { readOutlineTables, type OutlineTables } from "./behaviour-outline-tables.ts";
import { discoverCollisionDispatch, type CollisionDispatch } from "./behaviour-collision-dispatch.ts";
import { settleRopeDispatch } from "./behaviour-rope-dispatch.ts";
import { FLIP_BELT_ASSUMPTION, ROPE_HOLDER_ASSUMPTION } from "./behaviour-connection-relay.ts";
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
import { frameDrawingForType, proveFrameDrawing } from "./behaviour-frame-drawing.ts";
import { TYPE_TABLE_ASSUMPTION } from "./describe-effects.ts";
import { frameListWord, proveSheetFrameList, sheetFrameSizeForType } from "./behaviour-sheet-frames.ts";
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
import { findCreatedParts, type CreatedPart } from "./behaviour-created-parts.ts";
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
  /**
   * Set on a conditional rule: its condition or next frame tests values found during the run, like a query's answer
   * or the part a loop found, and nothing else is unknown in them. These are the values it tests.
   */
  runValues?: string[];
  /**
   * Set when the path's effects are incomplete (a call kept the part's state without a complete footprint of its other
   * fields, or a store went through an untracked pointer): a field the rule doesn't list may still have changed.
   */
  effectsIncomplete?: true;
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
  /** A member of a list this routine hands to a consumer at `call`, which does this to it. */
  listConsumer?: { address: number; call: number };
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
  /**
   * The same loops analysed once for each type a found part can have, when some generic way stays unresolved: with the
   * type known, the words of its type record are numbers, so a value picked by its mass or a test of its type folds.
   * A field of these ways holds when its way does: its own condition is left `true`, and its evidence is a few
   * instructions, as is the way's.
   */
  iterationOutcomesByType?: Record<number, IterationOutcome[]>;
  /** Every decoded path has a recorded return relation; memory effects may still be unresolved. */
  returnPathsComplete?: boolean;
  engineCalls?: (Finding & {
    instruction: number;
    summary: number;
    purpose: string;
    listContext?: ListConsumerCall;
    /** For an overlap search: the masks the call gives the list routines, which pick the lists it walks. */
    listMasks?: { head: number; next: number };
  })[];
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
  /** Callbacks that copy their outline from tables in the data segment, by routine. */
  outlineTables?: OutlineTables[];
  gearScheduling?: GearScheduling[];
  listId: string;
  imageLength: number;
  dataSegment: number;
  layout: ReturnType<typeof discoverBehaviourLayout>;
  timing: ReturnType<typeof findBehaviourTiming>;
  helpers?: EngineSummary[];
  lifecycle?: BehaviourLifecycle;
  creation?: CreationDefault[];
  /** The parts a routine makes with the part factory, where the type it passes is a number. */
  createdParts?: CreatedPart[];
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
/** How large a proved frame drawing value may grow when a caller puts its own fields in. */
const FRAME_DRAWING_BUDGET = 1024;
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
/**
 * The owner's field after a call that writes parts it selects while the game runs, when the owner may be one of them:
 * unchanged unless the call selected the owner. It names the call, so within one run it is one value, the same an
 * uncached read after that call gives.
 */
const afterEffect = (effect: { offset: number; width: number }, i: Instruction): Expression =>
  ({
    ...field(`part after field effect at ${hex(i.address)}`, effect.offset, effect.width),
    unresolved: true,
  }) as Expression;
/** The value a call writes in a field of a part it selects while the game runs, when its summary doesn't give it. */
const selectedWrite = (effect: { offset: number; width: number }, i: Instruction): Expression =>
  ({
    ...field(`value the call at ${hex(i.address)} writes to a selected part`, effect.offset, effect.width),
    unresolved: true,
  }) as Expression;
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
export function binary(
  operator: string,
  left: Expression,
  right: Expression,
  width = left.width,
  budget = 96,
): Expression {
  if (left.kind === "unknown" || right.kind === "unknown") return unknown(`Unresolved operand in ${operator}`, width);
  if (expressionSize(left) + expressionSize(right) > budget) return unknown(SIZE_BUDGET_REACHED, width);
  if (left.kind === "constant" && right.kind === "constant") {
    const a = unsigned(left.value, left.width);
    const b = unsigned(right.value, right.width);
    const result =
      operator === "+"
        ? a + b
        : operator === "-"
          ? a - b
          : operator === "*"
            ? // Exact in every width: two 32-bit words multiply past what a double keeps.
              Number((BigInt(a) * BigInt(b)) % 2n ** BigInt(width))
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

type Comparison = Extract<Predicate, { kind: "compare" }>;
export const OPPOSITE: Record<string, string> = { "==": "!=", "!=": "==", "<": ">=", ">=": "<", "<=": ">", ">": "<=" };
const ORDER = ["<", "<=", ">", ">="];
/**
 * A test as a value, 1 when it holds and 0 when it doesn't. The value operators compare as unsigned numbers, so a
 * signed order test compares both sides with their sign bit turned round, which orders them the same way.
 */
function testValue(test: Comparison, width: number, budget: number): Expression {
  const bits = test.left.width;
  const side = (e: Expression) =>
    test.signed && ORDER.includes(test.operator) ? binary("^", e, constant(2 ** (bits - 1), bits), bits, budget) : e;
  return binary(test.operator, side(test.left), side(test.right), width, budget);
}
/**
 * The value `then` where the test holds and `otherwise` where it doesn't, as `(test) * then + (opposite) * otherwise`
 * with each test 0 or 1. Exactly one of the two tests holds, so the value is exact. When a value or a side of the test
 * is unknown, the choice is that unknown, with its own reason.
 */
export function choose(
  test: Comparison,
  then: Expression,
  otherwise: Expression,
  width = then.width,
  budget = FRAME_DRAWING_BUDGET,
): Expression {
  if (same(then, otherwise)) return then;
  for (const value of [then, otherwise, test.left, test.right])
    if (value.kind === "unknown") return { ...value, width };
  const opposite = { ...test, operator: OPPOSITE[test.operator]! };
  return binary(
    "+",
    binary("*", testValue(test, width, budget), then, width, budget),
    binary("*", testValue(opposite, width, budget), otherwise, width, budget),
    width,
    budget,
  );
}
/**
 * The test and the two values of a value `choose` made, or undefined for any other value. A signed order test is
 * given back with its sides as they were.
 */
export function choiceOf(e: Expression): { test: Comparison; then: Expression; otherwise: Expression } | undefined {
  if (e.kind !== "binary" || e.operator !== "+" || e.left.kind !== "binary" || e.right.kind !== "binary") return;
  const [a, b] = [e.left, e.right];
  if (a.operator !== "*" || b.operator !== "*" || a.left.kind !== "binary" || b.left.kind !== "binary") return;
  const [x, y] = [a.left, b.left];
  if (OPPOSITE[x.operator] === undefined || OPPOSITE[x.operator] !== y.operator) return;
  if (!same(x.left, y.left) || !same(x.right, y.right)) return;
  const sign = (side: Expression) => 2 ** (side.width - 1);
  // A side of a signed order test: the value with its sign bit turned round, or a constant that was folded so.
  const unflip = (side: Expression) =>
    side.kind === "binary" && side.operator === "^" && side.right.kind === "constant" && side.right.value === sign(side)
      ? side.left
      : side.kind === "constant"
        ? constant(unsigned(side.value ^ sign(side), side.width), side.width)
        : undefined;
  const [left, right] = [unflip(x.left), unflip(x.right)];
  const signed =
    ORDER.includes(x.operator) && !!left && !!right && (x.left.kind !== "constant" || x.right.kind !== "constant");
  const test: Comparison = signed
    ? { kind: "compare", operator: x.operator, left: left!, right: right!, signed: true }
    : { kind: "compare", operator: x.operator, left: x.left, right: x.right, signed: false };
  return { test, then: a.right, otherwise: b.right };
}
/**
 * One value from the ways through a routine, each with its tests and its value, when the ways split like a tree: some
 * test is on every way, as itself or as its opposite, and so on down to one way. Undefined when they don't, when a
 * side is empty, or when a test isn't a comparison: then a way the tests allow may be missing.
 */
export function chooseByTests(
  ways: { tests: Predicate[]; value: Expression }[],
  width: number,
): Expression | undefined {
  if (!ways.length || ways.some((way) => way.tests.some((test) => test.kind !== "compare"))) return undefined;
  if (ways.length === 1) return ways[0]!.tests.length ? undefined : ways[0]!.value;
  const test = ways[0]!.tests[0] as Comparison | undefined;
  if (!test) return undefined;
  const opposite: Comparison = { ...test, operator: OPPOSITE[test.operator]! };
  const holds = ways.filter((way) => way.tests.some((t) => same(t, test)));
  const fails = ways.filter((way) => way.tests.some((t) => same(t, opposite)));
  if (!holds.length || !fails.length || holds.length + fails.length !== ways.length) return undefined;
  const without = (list: typeof ways, drop: Predicate) =>
    list.map((way) => ({ ...way, tests: way.tests.filter((t) => !same(t, drop)) }));
  const then = chooseByTests(without(holds, test), width);
  const otherwise = then && chooseByTests(without(fails, opposite), width);
  return otherwise && choose(test, then, otherwise, width);
}
/**
 * The speed and the limit of a value the speed limit made: `limit if speed > limit, else -limit if speed < -limit,
 * else speed`, signed. Undefined for any other value.
 */
export function speedLimitOf(e: Expression): { speed: Expression; limit: Expression } | undefined {
  const upper = choiceOf(e);
  if (!upper || upper.test.operator !== ">" || !upper.test.signed || !same(upper.test.right, upper.then)) return;
  const lower = choiceOf(upper.otherwise);
  const [speed, limit] = [upper.test.left, upper.then];
  if (!lower || lower.test.operator !== "<" || !lower.test.signed || !same(lower.test.left, speed)) return;
  if (!same(lower.test.right, lower.then) || !same(lower.otherwise, speed)) return;
  const negative = lower.then;
  if (negative.kind !== "binary" || negative.operator !== "-" || !same(negative.right, limit)) return;
  if (negative.left.kind !== "constant" || negative.left.value !== 0) return;
  return { speed, limit };
}

/**
 * A value with the owner's type put in for its type field, folded where a test or a product becomes a number. A part's
 * own rules run on a part of its type.
 */
export function withOwnType(e: Expression, type: number, typeOffset: number): Expression {
  if (e.kind === "field")
    return e.object === "part" && e.offset === typeOffset && e.width === 16 && !e.unresolved ? constant(type) : e;
  if (e.kind === "table") {
    const index = withOwnType(e.index, type, typeOffset);
    return index === e.index ? e : { ...e, index };
  }
  if (e.kind !== "binary") return e;
  const left = withOwnType(e.left, type, typeOffset),
    right = withOwnType(e.right, type, typeOffset);
  if (left === e.left && right === e.right) return e;
  const zero = (x: Expression) => x.kind === "constant" && unsigned(x.value, x.width) === 0;
  const one = (x: Expression) => x.kind === "constant" && unsigned(x.value, x.width) === 1;
  if (e.operator === "*" && (zero(left) || zero(right))) return constant(0, e.width);
  if (e.operator === "*" && one(left) && right.width === e.width) return right;
  if (e.operator === "*" && one(right) && left.width === e.width) return left;
  if (e.operator === "+" && zero(left) && right.width === e.width) return right;
  return binary(e.operator, left, right, e.width, Infinity);
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
/** Why a value the analysis gave up on, because it grew too large, is unknown. */
export const SIZE_BUDGET_REACHED = "Symbolic expression size budget reached";
/** Whether a value or test has a value the analysis gave up on because it grew too large. */
const outgrown = (x: Expression | Predicate): boolean =>
  x.kind === "unknown"
    ? x.reason === SIZE_BUDGET_REACHED
    : x.kind === "and"
      ? x.terms.some(outgrown)
      : x.kind === "compare" || x.kind === "binary"
        ? outgrown(x.left) || outgrown(x.right)
        : x.kind === "table" && outgrown(x.index);
/**
 * Whether a loop's way reads a word of the type record of the part it found: a table read in the type table (`table`,
 * `stride` bytes a record) whose index reads that part's type field.
 */
function readsTypeRecordOf(
  outcome: IterationOutcome,
  member: string,
  typeField: number,
  table: number,
  stride: number,
): boolean {
  const ofType = (e: Expression): boolean =>
    e.kind === "field"
      ? e.object === member && e.offset === typeField
      : e.kind === "binary"
        ? ofType(e.left) || ofType(e.right)
        : e.kind === "table" && ofType(e.index);
  const reads = (e: Expression): boolean => {
    if (e.kind === "table") {
      const at = e.segment * 16 + e.offset;
      return (at >= table && at < table + stride && ofType(e.index)) || reads(e.index);
    }
    return e.kind === "binary" && (reads(e.left) || reads(e.right));
  };
  const test = (p: Predicate): boolean =>
    p.kind === "and" ? p.terms.some(test) : p.kind === "compare" && (reads(p.left) || reads(p.right));
  return test(outcome.condition) || outcome.fields.some((f) => reads(f.value) || test(f.condition));
}
/** The overlap an overlap search stores in a part it finds, read where the loop over its finds reads it. */
const STORED_OVERLAP = /^overlap[XY] the query at 0x[0-9a-f]+ found for /;

/** What leaves a loop's way open, by the call that makes it so. */
export interface OpenCalls {
  /**
   * The contact search the routine runs on the part (engine summary kind `contact-search`): what it changes there,
   * like the part's place, contact record and list flags, and a value read from those after it.
   */
  contactSearch: boolean;
  /**
   * A connection query the routine makes (kind `connection-query`), like the teeter-totter pulling its ropes: what the
   * part at the other end answers, and a field of the source or the part read after it.
   */
  connectionQuery: boolean;
  /** Anything else the analysis doesn't know. */
  other: boolean;
}
/**
 * Which calls leave these values open, given the kind of engine summary each call instruction of the routine calls.
 * A stored overlap is known (see `onlyStoredOverlapsOpen`).
 */
export function openCalls(
  values: readonly (Expression | Predicate)[],
  kindAt: (instruction: number) => string | undefined,
): OpenCalls {
  const open: OpenCalls = { contactSearch: false, connectionQuery: false, other: false };
  const at = (object: string, pattern: RegExp) => {
    const match = pattern.exec(object);
    return match ? kindAt(Number(match[1])) : undefined;
  };
  const visit = (v: Expression | Predicate): void => {
    if (v.kind === "unknown") {
      if (/^Conditional contact-search effect on field /.test(v.reason)) open.contactSearch = true;
      else open.other = true;
    } else if (v.kind === "field") {
      if (!v.unresolved || STORED_OVERLAP.test(v.object)) return;
      if (at(v.object, / after unresolved write at (0x[0-9a-f]+)$/) === "contact-search") open.contactSearch = true;
      else if (
        at(v.object, /^answer of the query at (0x[0-9a-f]+)$/) === "connection-query" ||
        at(v.object, /^part after the query at (0x[0-9a-f]+)$/) === "connection-query" ||
        at(v.object, / after field effect at (0x[0-9a-f]+)$/) === "connection-query"
      )
        open.connectionQuery = true;
      else open.other = true;
    } else if (v.kind === "binary" || v.kind === "compare") {
      visit(v.left);
      visit(v.right);
    } else if (v.kind === "table") visit(v.index);
    else if (v.kind === "and") v.terms.forEach(visit);
  };
  values.forEach(visit);
  return open;
}
/** The kind of engine summary each call instruction of a routine calls, like `contact-search`. */
export function callKinds(
  report: Pick<BehaviourReport, "routines" | "helpers">,
  routine: number,
): (instruction: number) => string | undefined {
  const helpers = new Map((report.helpers ?? []).map((h) => [h.address, h.kind]));
  const kinds = new Map(
    (report.routines.find((r) => r.address === routine)?.engineCalls ?? []).map((c) => [
      c.instruction,
      helpers.get(c.summary),
    ]),
  );
  return (instruction) => kinds.get(instruction);
}
/** Whether a value has an unknown other than the overlap a search stored in the part it found. */
function unknownBesidesOverlaps(e: Expression): boolean {
  return (
    e.kind === "unknown" ||
    (e.kind === "field" && e.unresolved === true && !STORED_OVERLAP.test(e.object)) ||
    (e.kind === "binary" && (unknownBesidesOverlaps(e.left) || unknownBesidesOverlaps(e.right))) ||
    (e.kind === "table" && unknownBesidesOverlaps(e.index))
  );
}
function predicateUnknownBesidesOverlaps(p: Predicate): boolean {
  return (
    p.kind === "unknown" ||
    (p.kind === "and" && p.terms.some(predicateUnknownBesidesOverlaps)) ||
    (p.kind === "compare" && (unknownBesidesOverlaps(p.left) || unknownBesidesOverlaps(p.right)))
  );
}
/**
 * Whether a loop's way over a found part is unresolved only because it reads the overlap the search stored in that
 * part, like the vacuum cleaner's pull, harder the less the part overlaps it: the part holds that overlap in its own
 * fields, so the way is as known as the part.
 */
export function onlyStoredOverlapsOpen(outcome: IterationOutcome): boolean {
  return (
    outcome.effectsComplete &&
    !predicateUnknownBesidesOverlaps(outcome.condition) &&
    outcome.fields.every((f) => !unknownBesidesOverlaps(f.value) && !predicateUnknownBesidesOverlaps(f.condition))
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
  fieldHavoc?: {
    offset: number;
    width: number;
    address: number;
    exceptOwner: boolean;
    ownerOnly?: boolean;
    /** What the helper stores there, when it is a value of its own, like an overlap search's overlap. */
    named?: string;
  }[];
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
/**
 * The words of a type record the game writes while it runs (Even More, English floppy: the acceleration at +0x08 and
 * the speed limit at +0x0a at 0x369c, the frame list at +0x14 at 0x107dc), so the program's word isn't theirs.
 */
const TYPE_RECORD_WRITTEN = [0x08, 0x0a, 0x14];
/** The parts a loop finds: the overlap query's candidates and the members a list loop walks. */
const FOUND_PART = /^(overlap candidate at|member found by the loop at) 0x[0-9a-f]+$/;

export interface RoutineOptions {
  /**
   * Analyse the loops over found parts as if every found part had this type: its type field reads as the type, and a
   * word of its type record that the game never writes while it runs reads as the program's.
   */
  foundType?: { type: number; typeOffset: number; table: number; stride: number; records: number; written: number[] };
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
  /**
   * Reads through a far pointer kept on the stack whose segment word is a constant, and through a word read from a
   * table, as table reads at that address, like the code does. Used for helpers that only read such tables.
   */
  tableReads?: boolean;
  /** A list the caller hands in, read like the routine's own list: its members' outcomes become iteration outcomes. */
  externalList?: ListLoopSummary;
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
  if (options.externalList && !listLoopsByHeader.has(options.externalList.header))
    listLoopsByHeader.set(options.externalList.header, options.externalList);
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
      if (value.kind === "table" && !options.tableReads)
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
      const found = options.foundType;
      if (found && l.offset === found.typeOffset && l.width === 16 && FOUND_PART.test(l.object))
        return tracked(constant(found.type), l.evidence);
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
            ...field(
              scoped.named && scoped.offset === l.offset && scoped.width === l.width
                ? `${scoped.named} the query at ${hex(scoped.address)} found for ${l.object}`
                : `${l.object} after field effect at ${hex(scoped.address)}`,
              l.offset,
              l.width,
            ),
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
      const word = typeRecordWord(seg.value, operand.displacement, index, operand.width);
      if (word) return tracked(word.value, [...base.flatMap((v) => v.evidence), ...word.evidence]);
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
  /** While a list consumer's member outcomes are mapped into this routine: the member, which keeps its name. */
  let consumerMember: string | undefined;
  const formalObject = (
    object: string,
    args: Tracked[],
    base: number,
    s: AbstractState,
    ownerOffset = base,
  ): Tracked => {
    if (object === "part") return formalArgument(args, base, ownerOffset);
    if (object === consumerMember) return tracked({ kind: "pointer", object, displacement: 0, width: 16 });
    const nested = /^referenced-by\((.*)\+0x([0-9a-f]+)\)$/.exec(object);
    if (nested) return memoryAt(formalObject(nested[1]!, args, base, s, ownerOffset), parseInt(nested[2]!, 16), 16, s);
    return tracked(unknown(`Object identity ${object} is not mapped in the caller`));
  };
  /**
   * A word of a type record read for a known type, in a loop read for one found part type: the program's word, unless
   * the game writes it while it runs.
   */
  const typeRecordWord = (
    segment: number,
    displacement: number,
    index: Expression,
    width: number,
  ): { value: Expression; evidence: Evidence[] } | undefined => {
    const found = options.foundType;
    if (!found || index.kind !== "constant" || width !== 16) return undefined;
    const at = segment * 16 + unsigned(index.value + displacement, 16);
    const within = at - found.table;
    if (
      within < 0 ||
      within % 2 !== 0 ||
      within >= found.records * found.stride ||
      found.written.includes(within % found.stride)
    )
      return undefined;
    return {
      value: constant(image[at]! | (image[at + 1]! << 8), 16),
      evidence: [
        {
          address: at,
          bytes: [image[at]!, image[at + 1]!],
          text: `type record word at +0x${(within % found.stride).toString(16)} of type ${Math.floor(within / found.stride)}`,
        },
      ],
    };
  };
  const formalValue = (
    expression: Expression,
    args: Tracked[],
    base: number,
    s: AbstractState,
    ownerOffset = base,
    budget = 96,
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
      // A consumer's member is read as it is when the consumer gets it.
      if (expression.object === consumerMember) return tracked(expression);
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
      const left = formalValue(expression.left, args, base, s, ownerOffset, budget);
      const right = formalValue(expression.right, args, base, s, ownerOffset, budget);
      return tracked(
        binary(expression.operator, asExpression(left.value), asExpression(right.value), expression.width, budget),
        uniqueEvidence([...left.evidence, ...right.evidence]),
      );
    }
    const index = formalValue(expression.index, args, base, s, ownerOffset, budget);
    const word = typeRecordWord(expression.segment, expression.offset, asExpression(index.value), expression.width);
    if (word) return tracked(word.value, [...index.evidence, ...word.evidence]);
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
  /**
   * The speed limit's writes as one exact value per speed. Its two cases for a speed never both hold: above the limit
   * the speed becomes the limit, else below minus the limit it becomes minus the limit, else it stays. Undefined for
   * any other helper, or when a test can't be put as a comparison.
   */
  const speedLimitWrites = (engine: EngineSummary, args: Tracked[], s: AbstractState) => {
    const limiter = engine.contactResponse;
    if (limiter?.kind !== "velocity-limit") return undefined;
    const pointer = formalArgument(args, engine.argumentOffset, limiter.ownerArgument);
    const pick = (test: Predicate, then: Expression, otherwise: Expression) =>
      entails(test, s)
        ? then
        : !possible(conjunction([...s.conditions, test]))
          ? otherwise
          : test.kind === "compare"
            ? choose(test, then, otherwise, 16)
            : undefined;
    const out = [];
    for (const offset of limiter.fields) {
      const [upper, lower] = limiter.cases.filter((item) => item.field === offset);
      const below = lower?.condition.kind === "and" ? lower.condition.terms[1] : undefined;
      if (!upper || !lower || !below) return undefined;
      const before = memoryAt(pointer, offset, 16, s);
      const high = formalValue(upper.value, args, engine.argumentOffset, s),
        low = formalValue(lower.value, args, engine.argumentOffset, s);
      const kept = pick(
        formalPredicate(below, args, engine.argumentOffset, s),
        asExpression(low.value),
        asExpression(before.value),
      );
      const value =
        kept && pick(formalPredicate(upper.condition, args, engine.argumentOffset, s), asExpression(high.value), kept);
      if (!value) return undefined;
      const evidence = uniqueEvidence([...before.evidence, ...high.evidence, ...low.evidence, ...engine.evidence]);
      out.push({
        pointer,
        offset,
        width: 16,
        value: tracked(value, evidence),
        evidence: engine.evidence,
        condition: { kind: "true" } as Predicate,
        certain: true,
      });
    }
    return out;
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
    /** What the helper writes in a field of the parts it selects, when its summary names it. */
    selectedValue?: (effect: { offset: number; width: number }) => Expression | undefined,
    /** The name of what the helper stores in a field of the parts it selects, by offset. */
    named?: (offset: number) => string | undefined,
  ) => {
    for (const effect of fields) {
      const exceptOwner = preserveOwner.has(effect.offset);
      const storedName = named?.(effect.offset);
      s.fieldHavoc = [
        ...(s.fieldHavoc ?? []),
        { ...effect, address: i.address, exceptOwner, ...(storedName ? { named: storedName } : {}) },
      ];
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
      // The owner may be one of the selected parts: its field holds one value after the call, unchanged unless the call
      // selected the owner too. An uncached read after the call names the same value.
      if (!exceptOwner)
        s.memory.set(`part:${effect.offset}:${effect.width}`, tracked(afterEffect(effect, i), proof, i.address));
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
        tracked(selectedValue?.(effect) ?? selectedWrite(effect, i), proof, i.address),
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
        !engine.arithmetic &&
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
      convention.stackBytes === (engine.arithmetic?.stackBytes ?? 0) &&
      (convention.kind === "far" ? !!(i.far || farBridge) : !i.far && !segmentPush)
    );
  };
  /**
   * The 32-bit value of a low and a high word. Words split from one 32-bit value, `x & 0xffff` and
   * `(x >>> 16) & 0xffff`, give that value back, so a value passed from one 32-bit helper to the next keeps its size.
   */
  const joinWords = (low: Expression, high: Expression): Expression => {
    const halfOf = (word: Expression) =>
      word.kind === "binary" && word.operator === "&" && word.right.kind === "constant" && word.right.value === 0xffff
        ? word.left
        : undefined;
    const whole = halfOf(low),
      upper = halfOf(high);
    if (
      whole?.width === 32 &&
      upper?.kind === "binary" &&
      upper.operator === ">>>" &&
      upper.right.kind === "constant" &&
      upper.right.value === 16 &&
      same(upper.left, whole)
    )
      return whole;
    return binary("|", binary("<<", high, constant(16), 32), low, 32);
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
    if (
      !engine.numeric &&
      !engine.arithmetic &&
      engine.argumentKind === "scalar" &&
      (first?.kind === "pointer" || first?.kind === "stack")
    )
      return false;
    let numericResult: { low: Tracked; high: Tracked } | undefined;
    if (engine.arithmetic) {
      // The caller pushes the high word first, so the low word of each 32-bit value is nearer the top.
      const words = args.slice(-(engine.arithmetic.operation === "multiply16" ? 2 : 4)).reverse();
      const sign = (word: Tracked) =>
        binary("-", binary("^", asExpression(word.value), constant(0x8000), 32), constant(0x8000), 32);
      const pair = (low: Tracked, high: Tracked) => joinWords(asExpression(low.value), asExpression(high.value));
      let result: Expression | undefined;
      if (engine.arithmetic.operation === "multiply16" && words.length === 2)
        result = binary("*", sign(words[0]!), sign(words[1]!), 32);
      else if (engine.arithmetic.operation === "divide32" && words.length === 4) {
        const { signed, remainder } = engine.arithmetic;
        result = binary(
          `${signed ? "s" : ""}${remainder ? "%" : "/"}`,
          pair(words[0]!, words[1]!),
          pair(words[2]!, words[3]!),
          32,
        );
      }
      if (result && result.kind !== "unknown") {
        const proof = uniqueEvidence([...words.flatMap((w) => w.evidence), evidenceOf(i), ...engine.evidence]);
        numericResult = {
          low: tracked(binary("&", result, constant(0xffff), 16), proof),
          high: tracked(binary("&", binary(">>>", result, constant(16), 32), constant(0xffff), 16), proof),
        };
      }
    }
    if (engine.numeric) {
      const count = registerRead(engine.numeric.count, s);
      if (
        count.value.kind === "constant" &&
        count.value.value >= engine.numeric.minimumCount &&
        count.value.value <= engine.numeric.maximumCount
      ) {
        const low = registerRead(engine.numeric.low, s),
          high = registerRead(engine.numeric.high, s);
        const combined = joinWords(asExpression(low.value), asExpression(high.value));
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
    const masks = engine.list?.masks;
    const passedWord = (offset: number) => {
      const value = formalArgument(args, engine.argumentOffset, offset).value;
      return value.kind === "constant" ? value.value & 0xffff : undefined;
    };
    const headMask = masks && maskValue(masks.head, passedWord);
    const nextMask = masks && maskValue(masks.next, passedWord);
    engineCalls.push({
      instruction: i.address,
      summary: engine.address,
      purpose: engine.purpose,
      confidence: engine.confidence,
      assumptions: engine.assumptions,
      evidence: [evidenceOf(i), ...(engine.listConsumerScope ? engine.evidence : engine.evidence.slice(0, 1))],
      ...(engine.listConsumerScope ? { listContext: engine.listConsumerScope } : {}),
      ...(headMask !== undefined && nextMask !== undefined ? { listMasks: { head: headMask, next: nextMask } } : {}),
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
      exact?: true;
    }[] = [];
    for (const effect of privateOutput ? [] : engine.writes) {
      if (effect.root !== "argument" || effect.path.some((offset) => offset < 0) || effect.repeated) continue;
      let pointer = formalArgument(args, engine.argumentOffset, effect.argumentOffset ?? engine.argumentOffset);
      for (const offset of effect.path) pointer = memoryAt(pointer, offset, 16, s);
      const condition = formalPredicate(effect.condition, args, engine.argumentOffset, s);
      if (!possible(conjunction([...s.conditions, condition]))) continue;
      // A proved frame drawing value is larger than other expressions; it is kept whole up to a wider bound.
      const budget = engine.frameDrawing ? FRAME_DRAWING_BUDGET : undefined;
      const links = engine.orderedLinks;
      const link =
        links && !effect.path.length && effect.width === 16
          ? effect.offset === links.next
            ? "next"
            : effect.offset === links.previous
              ? "previous"
              : undefined
          : undefined;
      // The ordered insertion links its part between neighbours its comparisons pick: only the run knows which.
      const value = link
        ? tracked(
            {
              ...field(`${link} in the ordered list after the insertion at ${hex(i.address)}`, effect.offset, 16),
              unresolved: true,
            } as Expression,
            effect.evidence,
          )
        : formalValue(effect.value, args, engine.argumentOffset, s, engine.argumentOffset, budget);
      pending.push({
        pointer,
        offset: effect.offset,
        width: effect.width,
        value,
        evidence: effect.evidence,
        condition,
        certain: entails(condition, s),
        ...(effect.exact ? { exact: true } : {}),
      });
    }
    const limited = speedLimitWrites(engine, args, s);
    if (limited) pending.splice(0, pending.length, ...limited);
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
      // The owner keeps the fields a decided assumption about the routine's callers gives it, when it is the argument.
      const argument = formalArgument(args, engine.argumentOffset, engine.argumentOffset).value;
      const ownerKeeps =
        argument.kind === "pointer" && argument.object === "part" && argument.displacement === 0
          ? (engine.connected.ownerKeeps ?? []).filter((field) => field.callers.includes(code.address))
          : [];
      if (ownerKeeps.length)
        s.assumptions = [...new Set([...s.assumptions, ...ownerKeeps.map((field) => field.assumption)])];
      invalidateSelectedPartFields(
        engine.connected.partFields,
        s,
        i,
        engine.connected.evidence,
        new Set([...(askingIsOwner ? askingKeeps(engine.connected) : []), ...ownerKeeps.map((field) => field.offset)]),
        `a part reached through a rope, belt or pulley at ${hex(i.address)}`,
        undefined,
        // A field whose new value the summary fixes, like the byte the relay passes along, gets that value.
        (effect) => {
          const fixed = engine.connected!.values?.find(
            (item) => item.offset === effect.offset && item.width === effect.width,
          );
          return fixed && asExpression(formalValue(fixed.value, args, engine.argumentOffset, s).value);
        },
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
    // An overlap query starts its found list empty and puts each part it finds at the head: after the query the head
    // field holds the part it found last, or 0 when it found none. Which part that is, only the run knows.
    const foundHead = (effect: (typeof pending)[number]) =>
      engine.kind === "overlap-list" &&
      !!engine.list &&
      engine.list.confidence === "checked" &&
      effect.offset === engine.list.headField &&
      effect.width === 16;
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
          : effect.exact &&
              !uncertainPredicate(effect.condition) &&
              (effect.condition.kind === "compare" ||
                (effect.condition.kind === "and" && effect.condition.terms.every((term) => term.kind === "compare")))
            ? // A write made exactly when its tests hold: the new value then, the old one otherwise.
              tracked(
                (effect.condition.kind === "and" ? effect.condition.terms : [effect.condition]).reduceRight(
                  (then, test) => choose(test as Comparison, then, asExpression(before.value), effect.width),
                  asExpression(effect.value.value),
                ),
                uniqueEvidence([...effect.value.evidence, ...before.evidence]),
              )
            : foundHead(effect)
              ? tracked(
                  {
                    ...field(`found list after the query at ${hex(i.address)}`, effect.offset, effect.width),
                    unresolved: true,
                  } as Expression,
                  uniqueEvidence([...effect.evidence, ...engine.list!.evidence]),
                )
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
      const asksOwner = asking.kind === "pointer" && asking.object === "part" && asking.displacement === 0;
      const skipsOwner = engine.list.excludesArgument && asksOwner;
      // A query that may list the owner links it first and then makes it the head, so the head stays the head.
      const keepsHead = asksOwner && engine.list.confidence === "checked";
      for (const effect of engine.writes) {
        if (effect.root !== "unknown" || effect.selection !== "overlap-candidate" || effect.path.length) continue;
        const condition = formalPredicate(effect.condition, args, engine.argumentOffset, s);
        if (!possible(conjunction([...s.conditions, condition]))) continue;
        invalidateSelectedPartFields(
          [effect],
          s,
          i,
          skipsOwner ? uniqueEvidence([...effect.evidence, ...engine.list.evidence]) : effect.evidence,
          new Set(skipsOwner || (keepsHead && effect.offset === engine.list.headField) ? [effect.offset] : []),
          `a candidate selected by the overlap query at ${hex(i.address)}`,
          condition,
          // A found part's link gets the head it pushed down: the next part in the found list, or 0 for the first
          // part found. The query's other stores fill in a value it works out for that part.
          ({ offset, width }) =>
            ({
              ...field(
                offset === engine.list!.nextField && width === 16 && engine.list!.confidence === "checked"
                  ? `next in the found list of the query at ${hex(i.address)}`
                  : `value the query at ${hex(i.address)} writes to a found part`,
                offset,
                width,
              ),
              unresolved: true,
            }) as Expression,
          // Its other stores, besides the link, are the overlap it works out for that part.
          (offset) =>
            offset === engine.list!.nextField
              ? undefined
              : `overlap${engine.list!.overlaps?.find((o) => o.offset === offset)?.axis ?? ""}`,
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
      effectsIncomplete: true,
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
    // A field of the part an effect may have changed, with no store after it, ends with the one value the run gives it
    // after that effect, as a read would name it: a path that leaves it out would claim it unchanged.
    for (const effect of [...(s.fieldHavoc ?? [])].reverse()) {
      if (
        effect.exceptOwner ||
        effect.ownerOnly ||
        (effect.offset < stateOffset + 2 && stateOffset < effect.offset + effect.width / 8) ||
        Array.from({ length: effect.width / 8 }, (_, n) => effect.offset + n).every((byte) =>
          updates.some((u) => u.object === "part" && u.offset <= byte && byte < u.offset + u.width / 8),
        )
      )
        continue;
      const value = {
        ...field(`part after field effect at ${hex(effect.address)}`, effect.offset, effect.width),
        unresolved: true,
      } as Expression;
      updates.unshift({
        object: "part",
        offset: effect.offset,
        width: effect.width,
        value,
        condition,
        routine: entry.address,
        ...finding(value, condition, s, [evidenceOf(i)]),
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
    const incomplete = s.uncertain || s.partMemoryHavocAt !== undefined;
    const transition = {
      ...f,
      from,
      to,
      condition,
      routine: entry.address,
      updates,
      ...(incomplete ? { effectsIncomplete: true as const } : {}),
    };
    const key = JSON.stringify([
      from,
      to,
      condition,
      updates.map((u) => [u.object, u.offset, u.width, u.value]),
      incomplete,
    ]);
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
        // A listed member's field is never the owner's: the scan's summary lists every field it may write on the owner
        // as the owner's own (a query that may list the owner, or a global list), and otherwise the owner is not on the
        // list (the query's checked test against the part that asks, or the external list's contract).
        if (s.fieldHavoc?.length && !["stack", "data", "buffer"].includes(effect.object))
          s.fieldHavoc.push({
            offset: effect.offset,
            width: effect.width,
            address: i.address,
            exceptOwner: effect.object !== "part",
          });
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
                object === "data"
                  ? unknown(`The complete list scan may change field ${hex(effect.offset)}`, width)
                  : // Another part's field holds one value after the scan, which the run gives it.
                    ({
                      ...field(`value after the list scan at ${hex(list.header)} in ${object}`, offset, width),
                      unresolved: true,
                    } as Expression),
                list.evidence,
                i.address,
              ),
            );
        }
        if (effect.object === "part" || effect.object === "data")
          s.memory.set(
            `${effect.object}:${effect.offset}:${effect.width}`,
            tracked(
              effect.object === "part"
                ? // The owner's field holds one value after the scan, like a local the scan leaves behind.
                  ({
                    ...field(`part after list scan at ${hex(list.header)}`, effect.offset, effect.width),
                    unresolved: true,
                  } as Expression)
                : unknown(`The complete list scan may change field ${hex(effect.offset)}`, effect.width),
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
      const segmentWord =
        options.tableReads && l?.object === "stack"
          ? read({ ...source, displacement: source.displacement + 2, width: 16 }, s)
          : undefined;
      const object =
        l?.object === "stack" && l.offset + 2 === argumentOffset
          ? "part"
          : l
            ? `referenced-by(${l.object}+${hex(l.offset)})`
            : undefined;
      // A far pointer with a constant segment addresses a table there: the register gets its offset word.
      const ptr =
        segmentWord?.value.kind === "constant"
          ? segmentWord
          : object
            ? tracked({ kind: "pointer", object, displacement: 0, width: 16 } as Pointer, [
                ...(l?.evidence ?? []),
                evidenceOf(i),
              ])
            : tracked(unknown("Far object pointer is not established"));
      write(dest, segmentWord?.value.kind === "constant" ? read({ ...source, width: 16 }, s) : ptr, s, i);
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
      // A bounce callback's argument, the part that touched it (`collider`).
      const passesCollider =
        options.objectArgument === "collider" &&
        argument?.kind === "pointer" &&
        argument.object === "collider" &&
        argument.displacement === 0;
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
        // What the consumer does to each member, read path by path from the consumer itself, with this call's
        // arguments and this part's fields put in.
        if (!s.observationOnly)
          for (const member of contract.memberOutcomes ?? []) {
            consumerMember = member.object;
            const mapped = formalPredicate(member.condition, args, contract.argumentOffset, s);
            const fields = member.fields.map((f) => ({
              ...f,
              value: asExpression(formalValue(f.value, args, contract.argumentOffset, s).value),
            }));
            consumerMember = undefined;
            const kept: Predicate[] = [];
            let reached = true;
            for (const term of mapped.kind === "and" ? mapped.terms : [mapped]) {
              const decided = term.kind === "compare" ? compareConstants(term) : undefined;
              if (decided === false) reached = false;
              else if (decided === undefined) kept.push(term);
            }
            // The member's tests and values are of its fields as the consumer gets it. This part's own tests on the way
            // to the call are the source's business, as for its own list, and are left out.
            const condition = conjunction(kept);
            if (!fields.length || !reached || !possible(conjunction([...s.conditions, condition]))) continue;
            const proof = finding(constant(0), condition, { ...s, uncertain: false }, [
              evidenceOf(i),
              ...member.evidence,
            ]);
            iterationOutcomes.push({
              ...member,
              condition,
              fields: fields.map((f) => ({ ...f, condition, routine: entry.address })),
              listConsumer: { address: contract.address, call: i.address },
              ...proof,
              confidence:
                member.confidence === "unresolved" || proof.confidence === "unresolved" ? "unresolved" : "inferred",
              assumptions: [...new Set([...proof.assumptions, ...member.assumptions, ...listScope.assumptions])],
            });
          }
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
        !engine.arithmetic &&
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
      // A helper that picks what it stores by tests of its part's fields, like the mouse motor's start, splits the pass
      // on a member the loop observes by those tests, so each outcome knows the values stored on the member. A bounce
      // splits the same way on the part that touched it, like the gear's pushes.
      if (engine?.kind === "owner-field-update" && (passesObservedMember || passesCollider) && !pureReturnRelations) {
        const splits = new Map<string, Extract<Predicate, { kind: "compare" }>>();
        for (const effect of engine.writes) {
          if (effect.root !== "argument" || effect.path.length || effect.argumentOffset !== engine.argumentOffset)
            continue;
          for (const term of effect.condition.kind === "and" ? effect.condition.terms : [effect.condition]) {
            if (term.kind !== "compare") continue;
            const mapped = formalPredicate(term, args, engine.argumentOffset, s) as Extract<
              Predicate,
              { kind: "compare" }
            >;
            if (entails(mapped, s) || !possible(conjunction([...s.conditions, mapped]))) continue;
            const other = negate(mapped) as Extract<Predicate, { kind: "compare" }>;
            const [a, b] = [JSON.stringify(mapped), JSON.stringify(other)];
            splits.set(a < b ? a : b, a < b ? mapped : other);
          }
        }
        if (splits.size && splits.size <= 2) {
          const branches: AbstractState[] = [];
          let declined = false;
          for (let choice = 0; choice < 2 ** splits.size && !declined; choice++) {
            const branch = clone(s);
            [...splits.values()].forEach((test, n) => branch.conditions.push(choice & (2 ** n) ? negate(test) : test));
            if (!possible(conjunction(branch.conditions))) continue;
            if (!applyEngine(engine, args, branch, i)) declined = true;
            else {
              returnedStack(branch);
              branches.push(branch);
            }
          }
          if (!declined) {
            for (const branch of branches)
              enqueue({ at: i.segment * 16 + ((i.offset + i.size) & 0xffff), state: branch });
            continue;
          }
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
            // A drawing field the helper set through the frame drawing helper is as large as that helper's value.
            value: formalValue(
              effect.value,
              args,
              summary.objectPointer.argumentBase ?? summary.objectPointer.argumentOffset,
              s,
              summary.objectPointer.argumentOffset,
              FRAME_DRAWING_BUDGET,
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
          if (from?.kind === "pointer" && to?.kind === "pointer" && !from.displacement && !to.displacement) {
            // An angle the summary can't give as a formula is named after the call: one value of the run, which the
            // centre angle works out from the two parts' centres.
            const answer = registerRead("ax", branch);
            registerWrite(
              "ax",
              {
                ...answer,
                ...(containsUnknown(asExpression(answer.value))
                  ? {
                      value: {
                        ...field(`centre angle answer at ${hex(i.address)}`, 0, 16),
                        unresolved: true,
                      } as Expression,
                    }
                  : {}),
                centreAngle: { routine: centre!.routine, call: i.address, from: from.object, to: to.object },
              },
              branch,
            );
          }
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
        // The helper's relation may give a field the one value every way through the helper leaves in it, as a value of
        // the part's fields when the helper starts: worked out before any of the helper's writes go in.
        const relation =
          engine && /relation$/.test(engine.kind) && engine.argumentOffset === summary.objectPointer.argumentOffset
            ? engine
            : undefined;
        const finals = new Map<number, { value: Tracked; width: number }>();
        for (const offset of new Set(possibleWrites.map((w) => w.offset))) {
          const exact = relation?.writes.filter((w) => w.root === "argument" && !w.path.length && w.offset === offset);
          if (exact?.length !== 1 || exact[0]!.condition.kind !== "true") continue;
          const value = formalValue(exact[0]!.value, args, relation!.argumentOffset, s);
          if (!containsUnknown(asExpression(value.value))) finals.set(offset, { value, width: exact[0]!.width });
        }
        for (const offset of new Set(possibleWrites.map((w) => w.offset))) {
          const effects = possibleWrites.filter((w) => w.offset === offset);
          const final = finals.get(offset);
          if (final) {
            s.registers.set("__summary_part", tracked({ kind: "pointer", object: "part", displacement: 0, width: 16 }));
            write(
              {
                kind: "memory",
                segment: "ds",
                base: ["__summary_part"],
                displacement: offset,
                direct: false,
                width: final.width === 8 ? 8 : 16,
              },
              tracked(final.value.value, uniqueEvidence([...final.value.evidence, evidenceOf(i)])),
              s,
              i,
            );
            s.registers.delete("__summary_part");
          } else if (
            effects.length === 1 &&
            effects[0]!.condition.kind === "true" &&
            effects[0]!.value.kind === "constant"
          ) {
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
    transitions: markConditional(mergeTransitions(dedup(transitions), !uncertainEffects), !uncertainEffects),
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

/**
 * Names of values a run finds itself: a query's answer, a part a loop found, what a list scan leaves behind, a search's
 * found list, what a call writes to parts it selects, the part's own field after such a call, the neighbours an
 * ordered insertion links a part between, or the angle between two parts' centres.
 */
const RUN_VALUE =
  /^(answer of the query|overlap[XY]? the query|member found by the loop|part after the query|local after list scan|local after find-first loop|part after list scan|nullable list selection|found list after the query|next in the found list of the query|value the (query|call)|value after the list scan|part after field effect|(next|previous) in the ordered list after the insertion|centre angle answer) at /;
/** The run values an expression or predicate tests, or undefined when it holds any other unknown. */
function runValuesIn(value: Expression | Predicate, found = new Set<string>()): Set<string> | undefined {
  switch (value.kind) {
    case "unknown":
      return undefined;
    case "field":
      if (!value.unresolved) return found;
      if (!RUN_VALUE.test(value.object)) return undefined;
      found.add(value.object);
      return found;
    case "binary":
      return runValuesIn(value.left, found) && runValuesIn(value.right, found);
    case "table":
      return runValuesIn(value.index, found);
    case "compare":
      return runValuesIn(value.left, found) && runValuesIn(value.right, found);
    case "and":
      return value.terms.every((term) => runValuesIn(term, found)) ? found : undefined;
    default:
      return found;
  }
}
/**
 * A rule that is unresolved only because it tests values found during the run is conditional: for each value the run
 * finds, it says what happens. That needs every path of the routine to have kept track of its effects.
 */
function markConditional(transitions: Transition[], pathsCertain: boolean): Transition[] {
  if (!pathsCertain) return transitions;
  return transitions.map((transition) => {
    if (transition.confidence !== "unresolved") return transition;
    const values = runValuesIn(transition.condition);
    if (!values || !runValuesIn(transition.to, values) || !values.size) return transition;
    return { ...transition, runValues: [...values].sort() };
  });
}

/**
 * Run values that only say a call, a query or a list scan may have written the field: the value it writes isn't
 * followed, so such a name tells no more than an unknown would, only where the write comes from.
 */
const CALL_WRITTEN =
  /^(value the (query|call)|part after field effect|part after list scan|value after the list scan|part after the query) at /;
/**
 * Counts a part's rules: unresolved ones, conditional ones (they test only values found during the run) and, apart from
 * both, three groups by what they write. Rules with unknown writes write a value nobody named (an unknown, or a value
 * read again after one). Rules with call-written values write no such value, but at least one value only says that a
 * call may have written the field (`CALL_WRITTEN`), which is no more than an unknown. Rules with named run values write
 * only known values and run values whose identity is known, like a search's answer or found list, and at least one.
 */
export function transitionCounts(transitions: Transition[]) {
  const anonymous = (t: Transition) => t.updates?.some((update) => !runValuesIn(update.value)) ?? false;
  const written = (t: Transition) =>
    t.updates?.flatMap((update) => [...(runValuesIn(update.value) ?? [])]) ?? ([] as string[]);
  return {
    unresolved: transitions.filter((t) => t.confidence === "unresolved" && !t.runValues).length,
    conditional: transitions.filter((t) => t.runValues).length,
    unknownWrites: transitions.filter(anonymous).length,
    callWritten: transitions.filter((t) => !anonymous(t) && written(t).some((name) => CALL_WRITTEN.test(name))).length,
    namedRunValues: transitions.filter(
      (t) => !anonymous(t) && written(t).length > 0 && !written(t).some((name) => CALL_WRITTEN.test(name)),
    ).length,
  };
}

/**
 * Eliminates a branch only when both complementary outcomes have exactly the same final state expression. When no path
 * of the routine lost track of its effects, a pair that was unresolved only through the dropped test, like a query's
 * answer, has a resolved state path once merged: both answers lead to the same state. A field the two set differently
 * keeps both values, chosen by the dropped test.
 */
function mergeTransitions(input: Transition[], pathsCertain = false): Transition[] {
  const result = [...input];
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
        if (x.kind !== "compare" || y.kind !== "compare" || !same({ ...x, operator: OPPOSITE[x.operator] }, y))
          continue;
        const condition = conjunction(lt.filter((p) => p !== x));
        const updates: FieldWrite[] = [];
        const leftFields = new Map((left.updates ?? []).map((u) => [`${u.object}:${u.offset}:${u.width}`, u]));
        const rightFields = new Map((right.updates ?? []).map((u) => [`${u.object}:${u.offset}:${u.width}`, u]));
        // A field one rule leaves out keeps its old value there only when that path's effects are complete; otherwise
        // the field may have changed on that path too, so the two rules stay apart.
        if (
          (left.effectsIncomplete && [...rightFields.keys()].some((key) => !leftFields.has(key))) ||
          (right.effectsIncomplete && [...leftFields.keys()].some((key) => !rightFields.has(key)))
        )
          continue;
        for (const key of new Set([...leftFields.keys(), ...rightFields.keys()])) {
          const l = leftFields.get(key);
          const r = rightFields.get(key);
          const exemplar = l ?? r!;
          const lv = l?.value ?? field(exemplar.object, exemplar.offset, exemplar.width);
          const rv = r?.value ?? field(exemplar.object, exemplar.offset, exemplar.width);
          // A field the two paths set differently keeps both values, with the test that picks one.
          const value = choose(x, lv, rv, exemplar.width);
          updates.push({
            ...exemplar,
            condition,
            value,
            confidence: containsUnknown(value) ? "unresolved" : exemplar.confidence,
            evidence: uniqueEvidence([...(l?.evidence ?? []), ...(r?.evidence ?? [])]),
          });
        }
        const settled =
          pathsCertain &&
          left.confidence === "unresolved" &&
          !containsUnknown(left.to) &&
          !uncertainPredicate(condition);
        result[a] = {
          ...left,
          ...(settled ? { confidence: "inferred" as const } : {}),
          condition,
          ...(left.updates || right.updates ? { updates } : {}),
          ...(left.effectsIncomplete || right.effectsIncomplete ? { effectsIncomplete: true as const } : {}),
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
/**
 * Reads the parts' behaviour from the program. Reading the loops over found parts once for each type a found part can
 * have takes most of the time, so it is a step of its own, which `readBehaviour` takes at once and the Lab after the
 * rest is on the page.
 */
export function readBehaviour(program: Uint8Array, list: ProgramParts): BehaviourReport {
  const { report, readLoopsPerType } = readBehaviourInSteps(program, list);
  readLoopsPerType();
  return report;
}

/**
 * The report without the loops read per type, and the step that adds them to its routines: every type, or only the
 * types given.
 */
export function readBehaviourInSteps(
  program: Uint8Array,
  list: ProgramParts,
): { report: BehaviourReport; readLoopsPerType(only?: number[]): void } {
  /** The loops over found parts to read once for each type, after the rest. */
  const loopsPerType: ((only?: number[]) => void)[] = [];
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
    let externalList: ListLoopSummary | undefined;
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
        externalList = contract.loop;
        const at = helpers.findIndex((h) => h.address === address);
        if (at < 0) helpers.push(conditional);
        else helpers[at] = conditional;
      }
    }
    const routineOptions: RoutineOptions = {
      dataSegment: list.dataSegment,
      stateOffset,
      argumentOffset,
      summaries,
      maxVisits: counts.has(address) ? 12_000 : 800,
      code,
      engineSummaries,
      codes,
      layout,
      ...(externalList ? { externalList } : {}),
      ...(callbackSlots.get(address)?.size === 1 &&
      callbackSlots.get(address)!.has(0) &&
      layout.callbacks[0]?.objectSource?.path.length === 1
        ? { objectArgument: "collider" as const, ownerLink: layout.callbacks[0].objectSource.path[0] }
        : {}),
    };
    const routine = analyseRoutine(image, entry, routineOptions);
    // A part's loop over the parts it finds is read again for each type the found part can have when its unresolved
    // ways read a word of the found part's type record and have values the analysis gave up on for their size, like
    // the vacuum cleaner's pull, picked by the found part's mass. With the type known, that word is a number and such
    // a value stays small. Only those: that is all the reading per type adds, and it is slow.
    const typeField = layout.fields.find((f) => f.name === "type")?.offset;
    const ways = routine.iterationOutcomes?.filter((o) => o.confidence === "unresolved") ?? [];
    if (
      counts.has(address) &&
      typeField !== undefined &&
      ways.some((o) => readsTypeRecordOf(o, o.object, typeField, list.table, 58)) &&
      ways.some((o) => outgrown(o.condition) || o.fields.some((f) => outgrown(f.value) || outgrown(f.condition)))
    )
      loopsPerType.push((only) => {
        const byType: Record<number, IterationOutcome[]> = {};
        for (let type = 0; type < list.records.length; type++) {
          if (!list.records[type]!.bytes.length) continue;
          if (only && !only.includes(type)) continue;
          const typed = analyseRoutine(image, entry, {
            ...routineOptions,
            foundType: {
              type,
              typeOffset: typeField,
              table: list.table,
              stride: 58,
              records: list.records.length,
              written: TYPE_RECORD_WRITTEN,
            },
          });
          // The ways this type resolves, with a few instructions as their evidence. A way left unresolved for a known
          // type says nothing the generic one doesn't, so each loop keeps one such way, with the fields it writes and
          // nothing else, to say there is one.
          const ways: IterationOutcome[] = [];
          const open = new Map<string, IterationOutcome>();
          for (const o of typed.iterationOutcomes ?? []) {
            if (o.confidence !== "unresolved" || onlyStoredOverlapsOpen(o)) {
              // Each field holds when the way does, so its own copy of the way's condition is left out.
              ways.push({
                ...o,
                fields: o.fields.map((f) => ({ ...f, condition: { kind: "true" }, evidence: f.evidence.slice(0, 4) })),
                assumptions: [...new Set([...o.assumptions, TYPE_TABLE_ASSUMPTION])],
                evidence: o.evidence.slice(0, 8),
              });
              continue;
            }
            // The found part's own tests stay, so a pair the part's flags rule out stays ruled out.
            const own = (o.condition.kind === "and" ? o.condition.terms : [o.condition]).filter(
              (t) =>
                t.kind === "compare" &&
                !predicateUnknownBesidesOverlaps(t) &&
                !JSON.stringify(t).includes('"unresolved":true') &&
                [...JSON.stringify(t).matchAll(/"object":"([^"]+)"/g)].every((m) => m[1] === o.object),
            );
            const key = `${o.header}:${o.object}:${o.listConsumer?.call}:${JSON.stringify(own)}`;
            const kept = open.get(key);
            const fields = new Map((kept?.fields ?? []).map((f) => [`${f.offset}:${f.width}`, f]));
            for (const f of o.fields)
              fields.set(`${f.offset}:${f.width}`, {
                object: f.object,
                offset: f.offset,
                width: f.width,
                value: unknown("A value of a way left unresolved for this type", f.width),
                condition: { kind: "true" },
                routine: f.routine,
                confidence: "unresolved",
                assumptions: [],
                evidence: f.evidence.slice(0, 2),
              });
            open.set(key, {
              scope: o.scope,
              header: o.header,
              object: o.object,
              condition: conjunction(own),
              fields: [...fields.values()],
              effectsComplete: (kept?.effectsComplete ?? true) && o.effectsComplete,
              ...(o.listConsumer ? { listConsumer: o.listConsumer } : {}),
              confidence: "unresolved",
              assumptions: [],
              evidence: kept?.evidence ?? o.evidence.slice(0, 8),
            });
          }
          byType[type] = [...ways, ...open.values()];
        }
        routine.iterationOutcomesByType = byType;
      });
    summaries.set(address, routine);
    // A consumer's member outcomes count only when its analysis went over every path within its budget, and they
    // write every member field its footprint has: a member path the analysis lost would leave one out.
    const consumer = externalList && engineSummaries.get(address)?.listConsumer;
    const members = (routine.iterationOutcomes ?? []).filter((o) => o.header === externalList?.header);
    const written = new Set(members.flatMap((o) => o.fields.map((f) => f.offset)));
    if (
      consumer &&
      routine.analysisWork &&
      routine.analysisWork.visits < routine.analysisWork.limit &&
      !routine.analysisWork.pendingPaths &&
      consumer.fields.every((f) => f.root !== "member" || written.has(f.offset))
    )
      consumer.memberOutcomes = members;
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
  const frameFields = Object.fromEntries(
    ["drawX", "drawY", "frameWidth", "frameHeight"].map((name) => [
      name,
      layout.fields.find((f) => f.name === name)?.offset,
    ]),
  );
  if (Object.values(frameFields).every((offset) => offset !== undefined))
    proveFrameDrawing(
      engineSummaries,
      frameFields as { drawX: number; drawY: number; frameWidth: number; frameHeight: number },
      (engine) =>
        analyseRoutine(image, entries.get(engine.address)!, {
          dataSegment: list.dataSegment,
          stateOffset,
          argumentOffset: engine.argumentOffset,
          summaries: new Map(),
          maxVisits: 800,
          code: codes.get(engine.address),
          engineSummaries,
          codes,
          layout,
          tableReads: true,
        }),
      (operator, left, right, width) => binary(operator, left, right, width, Infinity),
    );
  addRelayOwnerKeeps();
  addRopeDispatch();
  for (const callbacks of references.values()) for (const callback of callbacks) summarise(callback.address);

  /**
   * The fields the byte relay's owner keeps, by decided assumptions about the parts that call it. A routine that calls
   * the relay, is named directly by the type table and is called by nothing else runs on a part of the types that name
   * it. When none of those is a rope piece or a pulley, the owner never holds a rope record, so the rope geometry update
   * never writes its rope ends (decided assumption 19). When it is named only as a flip callback, the editor never flips
   * the part while its belt has a loose end, so the belt end check changes no links (decided assumption 20). Other
   * callers keep nothing.
   */
  function addRelayOwnerKeeps() {
    const ids = new Map(list.list.parts.map((part) => [part.type, part.id]));
    const ropeTypes = [...ids].filter(([, id]) => id === "rope" || id === "pulley").map(([type]) => type);
    const flipField = layout.callbacks.find((callback) => callback.role === "flip")?.field;
    const calledDirectly = (address: number) =>
      [...codes.values()].some((caller) => caller.calls.some((call) => call.target?.address === address));
    for (const relay of [...engineSummaries.values()].filter(
      (summary) => summary.kind === "related-byte-propagation" && summary.connected,
    )) {
      const callers = [...codes.values()]
        .filter((caller) => caller.calls.some((call) => call.target?.address === relay.address))
        .filter((caller) => counts.has(caller.address) && !calledDirectly(caller.address));
      const holderCallers: number[] = [];
      const flipCallers: number[] = [];
      for (const caller of callers) {
        const naming = list.records.filter((record) =>
          references.get(record.type)!.some((callback) => callback.address === caller.address),
        );
        if (
          ropeTypes.length === 2 &&
          naming.every((record) => ids.has(record.type) && !ropeTypes.includes(record.type))
        )
          holderCallers.push(caller.address);
        if (
          flipField !== undefined &&
          naming.every((record) =>
            references
              .get(record.type)!
              .every((callback) => callback.address !== caller.address || callback.field === flipField),
          )
        )
          flipCallers.push(caller.address);
      }
      const keeps = [
        ...(holderCallers.length ? (relay.connected!.ropeHolderFields ?? []) : []).map((field) => ({
          ...field,
          assumption: ROPE_HOLDER_ASSUMPTION,
          callers: holderCallers,
        })),
        ...(flipCallers.length ? (relay.connected!.beltEndFields ?? []) : []).map((field) => ({
          ...field,
          assumption: FLIP_BELT_ASSUMPTION,
          callers: flipCallers,
        })),
      ];
      if (!keeps.length) continue;
      const kept: EngineSummary = { ...relay, connected: { ...relay.connected!, ownerKeeps: keeps } };
      engineSummaries.set(relay.address, kept);
      const at = helpers.findIndex((helper) => helper.address === relay.address);
      if (at >= 0) helpers[at] = kept;
    }
  }

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
      settleRopeDispatch(query, targets, asking, summarise, engineSummaries, helpers, () => summaries.clear());
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
  const typeTable = {
    address: list.table,
    stride: 58,
    words: list.records.map((record) =>
      Array.from(
        { length: record.bytes.length >> 1 },
        (_, n) => record.bytes[n * 2]! | (record.bytes[n * 2 + 1]! << 8),
      ),
    ),
  };
  // A part's own rules run on a part of its type, so a drawing field it writes is worked out for that type.
  const typeOffset = layout.fields.find((f) => f.name === "type")?.offset;
  const frameOffsets = Object.values(frameFields) as number[];
  const sheetList = list.sheetFrames?.size ? proveSheetFrameList(image, list.dataSegment, list.table) : undefined;
  const frameWriteForType = (write: FieldWrite, type: number): FieldWrite => {
    if (typeOffset === undefined || write.object !== "part" || !frameOffsets.includes(write.offset)) return write;
    const used = { table: false };
    const value = frameDrawingForType(
      write.value,
      type,
      typeOffset,
      typeTable,
      (operator, left, right, width) => binary(operator, left, right, width, Infinity),
      used,
    );
    // With the part's sheet, a frame's size from the list the game loaded from it is the sheet's.
    const frames = sheetList && list.sheetFrames?.get(type);
    const sheet = { sheet: false };
    const sized = frames
      ? sheetFrameSizeForType(
          value,
          frameListWord(list.table, type),
          list.dataSegment,
          frames,
          (operator, left, right, width) => binary(operator, left, right, width, Infinity),
          sheet,
        )
      : value;
    if (sized === write.value) return write;
    const assumptions = [
      ...(used.table ? [TYPE_TABLE_ASSUMPTION] : []),
      ...(sheet.sheet ? sheetList!.assumptions : []),
    ];
    return {
      ...write,
      value: sized,
      ...(assumptions.length ? { assumptions: [...new Set([...write.assumptions, ...assumptions])] } : {}),
      ...(sheet.sheet ? { evidence: [...write.evidence, ...sheetList!.evidence] } : {}),
    };
  };
  // A value that tests the owner's type, like whether the relay gives the owner its byte, is decided for the type.
  const ownTypeWrite = (write: FieldWrite, type: number): FieldWrite => {
    if (typeOffset === undefined) return write;
    const value = withOwnType(write.value, type, typeOffset);
    return value === write.value ? write : { ...write, value };
  };
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
      }))
      .map((t) => {
        const updates = t.updates?.map((write) => ownTypeWrite(frameWriteForType(write, part.type), part.type));
        return updates?.some((write, n) => write !== t.updates![n])
          ? {
              ...t,
              updates,
              assumptions: [...new Set([...t.assumptions, ...updates.flatMap((write) => write.assumptions)])],
            }
          : t;
      });
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
      reset: allWrites.filter((w) => w.routine === resetAddress).map((w) => frameWriteForType(w, part.type)),
      visibleEffects: allWrites
        .filter(
          (w) =>
            w.object === "part" &&
            layout.fields
              .filter((f) => !["previousState", "stateDelta"].includes(f.name))
              .some((f) => f.offset === w.offset),
        )
        .map((w) => frameWriteForType(w, part.type)),
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
  const outlineField = layout.fields.find((f) => f.name === "outlinePoints")?.offset;
  const outlineTables =
    outlineField === undefined
      ? []
      : [...new Set(parts.flatMap((part) => part.routines.map((routine) => routine.address)))].flatMap((address) => {
          const code = codes.get(address);
          const tables =
            code &&
            readOutlineTables(
              code,
              image,
              list.dataSegment,
              { outline: outlineField, state: stateOffset },
              codes.values(),
            );
          return tables ? [tables] : [];
        });
  if (!collisionDispatch.length)
    for (const part of parts)
      part.uncertainties.push(
        "The complete contact-processing region was not found; callback selection and response routing remain unresolved.",
      );
  const report: BehaviourReport = {
    listId: list.list.id,
    ...(gearScheduling.length ? { gearScheduling } : {}),
    collisionDispatch,
    ...(outlineTables.length ? { outlineTables } : {}),
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
    createdParts: findCreatedParts(
      [...summaries.values()],
      helpers,
      layout.fields.find((field) => field.name === "type")?.offset ?? 4,
    ),
    typeTable,
    assumptions: [
      "All addresses are relative to the unpacked load image, with the DOS relocation load base removed.",
      "Slot names, object field meanings and callback frequency have separate evidence and must not be promoted from a v25 lead alone.",
      "A transition describes the final symbolic state along one acyclic control flow path. Loops, aliasing and unsupported effects remain unresolved.",
      "Calls are analysed using static summaries. No instruction, callback or fake part is executed.",
      ...(pending.length ? ["The call graph routine budget was reached; omitted callees remain unresolved."] : []),
    ],
  };
  // `only` limits the types read, to look at a few of them quickly.
  return { report, readLoopsPerType: (only) => loopsPerType.splice(0).forEach((read) => read(only)) };
}
