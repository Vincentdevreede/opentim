/**
 * Static visual behaviour of TIM 1 and Even More. The decoder builds a control flow graph; the analysis propagates
 * symbolic expressions through that graph. It never creates a live game object or executes an instruction. A field
 * is an input variable, and loops and unknown calls lose information rather than being run with invented inputs.
 */

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
import { discoverListLoops, type ListLoopSummary } from "./behaviour-list-loops.ts";
import { discoverCreationDefaults, type CreationDefault } from "./behaviour-creation.ts";
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
  objectPointer: Finding & { argumentOffset: number; argumentBase?: number; registers: string[] };
  writes: FieldWrite[];
  transitions: Transition[];
  comparisons: (Finding & { predicate: Predicate })[];
  outcomes?: RoutineOutcome[];
  iterationOutcomes?: IterationOutcome[];
  /** Every decoded path has a recorded return relation; memory effects may still be unresolved. */
  returnPathsComplete?: boolean;
  engineCalls?: (Finding & { instruction: number; summary: number; purpose: string })[];
  loops?: LoopSummary[];
  listLoops?: ListLoopSummary[];
  /** True when an unsupported effect, a loop, or an unresolved call can affect a field. */
  uncertainEffects: boolean;
}
export interface PartBehaviour {
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
const stateCountOf = (part: { states?: unknown[]; frames?: unknown[] }) => (part.states ?? part.frames ?? []).length;
const uniqueEvidence = (items: Evidence[]) => [...new Map(items.map((i) => [i.address, i])).values()];
const unsigned = (n: number, width: number) => ((n % 2 ** width) + 2 ** width) % 2 ** width;
const signed = (n: number, width: number) => {
  const u = unsigned(n, width);
  return u >= 2 ** (width - 1) ? u - 2 ** width : u;
};

/** Constant folding is algebra on expressions, independent of an instruction stream or a game object. */
const expressionSizes = new WeakMap<object, number>();
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
function possible(predicate: Predicate, state?: number, stateOffset = 0x0c): boolean {
  if (predicate.kind === "and") {
    if (!predicate.terms.every((p) => possible(p, state, stateOffset))) return false;
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
}
interface Flags {
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
  visited: Set<number>;
  stateWritten: boolean;
  uncertain: boolean;
  havoc: boolean;
  havocAt?: number;
  globalHavocAt?: number;
  partMemoryHavocAt?: number;
  observationOnly?: boolean;
  observationHeader?: number;
  observationExit?: number;
  observationObject?: string;
  observationGuard?: Predicate;
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

/**
 * Analyses a routine as a graph of symbolic transfer functions. Each acyclic path is retained; a back edge is a
 * loss of information, not an invitation to run the loop. The finite path budget is reported whenever reached.
 */
export function analyseRoutine(image: Uint8Array, entry: CodeAddress, options: RoutineOptions = {}): RoutineAnalysis {
  const code = options.code ?? readRoutineCode(image, entry, options.dataSegment ?? 0);
  const stateOffset = options.stateOffset ?? 0x0c;
  const argumentOffset = options.argumentOffset ?? 6;
  const writes: FieldWrite[] = [];
  const outcomes: RoutineOutcome[] = [];
  const iterationOutcomes: IterationOutcome[] = [];
  const engineCalls: NonNullable<RoutineAnalysis["engineCalls"]> = [];
  const provenLoops = discoverCountedLoops(code, options.engineSummaries ?? new Map(), stateOffset);
  const loopsByHeader = new Map(provenLoops.map((loop) => [loop.header, loop]));
  const usedLoops: LoopSummary[] = [];
  const firstArgumentOffset = code.instructions.some((instruction) => instruction.mnemonic === "retf") ? 6 : 4;
  const listLoopsByHeader = new Map(
    (options.objectArgument !== "collider" && argumentOffset === firstArgumentOffset
      ? discoverListLoops(code, options.engineSummaries ?? new Map(), stateOffset)
      : []
    ).map((loop) => [loop.header, loop]),
  );
  const usedListLoops: ListLoopSummary[] = [];
  const transitions: Transition[] = [];
  const comparisons: RoutineAnalysis["comparisons"] = [];
  const diagnostics = new Set(code.uncertainties);
  const pointerEvidence: Evidence[] = [];
  const pointerRegisters = new Set<string>();
  let uncertainEffects = code.status !== "complete";
  const instructions = new Map(code.instructions.map((i) => [i.address, i]));
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
      const sibling = s.registers.get(other);
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
      if (value.kind === "field" && value.object !== "stack")
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
      if (ref.object !== "stack")
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
  const read = (operand: Operand | undefined, s: AbstractState): Tracked => {
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
  const finding = (value: Expression, condition: Predicate, s: AbstractState, extra: Evidence[]): Finding => ({
    confidence: containsUnknown(value) || uncertainPredicate(condition) || s.uncertain ? "unresolved" : "inferred",
    assumptions: [
      "The stack argument identified by the dispatch is the part object.",
      "Memory not written on this path retains its input value.",
      ...s.assumptions,
    ],
    evidence: uniqueEvidence([...s.evidence, ...extra]),
  });
  const write = (operand: Operand | undefined, value: Tracked, s: AbstractState, i: Instruction) => {
    if (!operand) return;
    const e = uniqueEvidence([...value.evidence, evidenceOf(i)]);
    if (operand.kind === "register") {
      registerWrite(operand.name, tracked(value.value, e), s);
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
    s.memory.set(memoryKey(l), tracked(value.value, uniqueEvidence([...e, ...l.evidence]), i.address));
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
  const applyEngine = (engine: EngineSummary, args: Tracked[], s: AbstractState, i: Instruction): boolean => {
    const passed = args.at(-1)?.value;
    const completeMember =
      s.observationOnly &&
      passed?.kind === "pointer" &&
      passed.object === s.observationObject &&
      passed.displacement === 0 &&
      engine.footprint.partMemoryComplete === true;
    if (!engine.footprint.preservesPartState && !engine.footprint.preservesArgumentMemory && !completeMember)
      return false;
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
    s.evidence.push(evidenceOf(i));
    engineCalls.push({
      instruction: i.address,
      summary: engine.address,
      purpose: engine.purpose,
      confidence: engine.confidence,
      assumptions: engine.assumptions,
      evidence: [evidenceOf(i), ...engine.evidence.slice(0, 1)],
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
    for (const effect of engine.writes) {
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
    if (!engine.footprint.preservesArgumentMemory && engine.footprint.partMemoryComplete !== true) {
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
      s.partMemoryHavocAt = i.address;
      uncertainEffects = true;
      s.assumptions = [
        ...new Set([
          ...s.assumptions,
          "This helper proves state preservation but not a complete non-state footprint; other object fields are read as new unresolved values.",
        ]),
      ];
    }
    for (const effect of pending) {
      const temporary = "__engine_pointer";
      s.registers.set(temporary, effect.pointer);
      const before = memoryAt(effect.pointer, effect.offset, effect.width, s);
      const value =
        effect.certain || same(before.value, effect.value.value)
          ? effect.value
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
        tracked(value.value, uniqueEvidence([...value.evidence, ...effect.evidence, evidenceOf(i)])),
        s,
        i,
      );
      s.registers.delete(temporary);
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
    return true;
  };
  const flagPredicate = (i: Instruction, s: AbstractState, taken: boolean): Predicate => {
    const flags = s.flags;
    if (!flags) return { kind: "unknown", reason: `Flags reaching ${hex(i.address)} are not resolved` };
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
  const queue: { at: number; state: AbstractState }[] = [{ at: entry.address, state: initial }];
  let visits = 0;
  const maxVisits = options.maxVisits ?? 4000;
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
      if (["stack", "data"].includes(object)) continue;
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
      });
    }
    const returned = registerRead("ax", s);
    outcomes.push({
      effectsComplete: !s.uncertain && s.partMemoryHavocAt === undefined,
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
  while (queue.length && visits++ < maxVisits) {
    const item = queue.pop()!;
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
    const list = !s.observationOnly && listLoopsByHeader.get(i.address);
    if (list) {
      const node = registerRead(list.nodeRegister, s);
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
        queue.push({ at: list.bodyEntry, state: observed });
      // The proven relation covers the complete finite scan; the observational branch only records per-node effects.
      s.assumptions = [...new Set([...s.assumptions, ...list.assumptions])];
      s.evidence.push(...list.evidence);
      for (const effect of list.possibleFields) {
        if (effect.object === "stack" && effect.operand) {
          const locationOfField = location(effect.operand, s);
          if (locationOfField)
            s.memory.set(
              memoryKey(locationOfField),
              tracked(
                unknown("The complete list scan may update this private field", effect.width),
                list.evidence,
                i.address,
              ),
            );
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
      usedListLoops.push(list);
      queue.push({ at: list.exit, state: s });
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
          // The monotone variant and balanced stack prove this transfer; no loop body is unrolled.
          s.assumptions = [...new Set([...s.assumptions, ...counted.assumptions])];
          s.evidence.push(...counted.evidence);
          for (const effect of counted.possibleFields) {
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
              // Related-object aliases can change a field of the owner, but the invariant excludes the state.
              for (const [key] of s.memory) {
                const parts = key.split(":");
                const width = Number(parts.pop());
                const offset = Number(parts.pop());
                const object = parts.join(":");
                if (
                  object !== "stack" &&
                  offset < effect.offset + effect.width / 8 &&
                  effect.offset < offset + width / 8
                )
                  s.memory.set(
                    key,
                    tracked(unknown(`A bounded loop may change field ${hex(effect.offset)}`, width), counted.evidence),
                  );
              }
              s.memory.set(
                `part:${effect.offset}:${effect.width}`,
                tracked(
                  unknown(`A bounded loop may change field ${hex(effect.offset)}`, effect.width),
                  counted.evidence,
                ),
              );
            }
          }
          for (const name of counted.writtenRegisters)
            registerWrite(name, tracked(unknown("A bounded loop changes this register"), counted.evidence), s);
          write(counted.counter, tracked(constant(unsigned(end, 16)), counted.evidence), s, i);
          s.flags = undefined;
          usedLoops.push(counted);
          queue.push({ at: counted.exit, state: s });
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
        if (
          possible(conjunction(branch.conditions)) &&
          (!options.stateCount ||
            Array.from({ length: options.stateCount }, (_, n) => n).some((n) =>
              possible(conjunction(branch.conditions), n, stateOffset),
            ))
        )
          queue.push({ at: edge.to!, state: branch });
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
      if (possible(conjunction(fallback.conditions))) queue.push({ at: search.defaultTarget, state: fallback });
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
      ["add", "sub", "and", "or", "xor", "shl", "sal", "shr", "sar", "inc", "dec", "neg", "not"].includes(i.mnemonic)
    ) {
      const operator = (
        {
          add: "+",
          sub: "-",
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
      s.flags = undefined;
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
    } else if (i.flow === "call") {
      const summary = i.target && options.summaries?.get(i.target.address);
      // A PUSH CS immediately before a near CALL supplies the far return frame, not an argument.
      const args = [...s.stack];
      const last = code.instructions.find((p) => p.address + p.size === i.address);
      if (
        !i.far &&
        last?.mnemonic === "push" &&
        last.operands[0]?.kind === "register" &&
        last.operands[0].name === "cs"
      ) {
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
      const preciseMemberRelations = !!(
        passesObservedMember &&
        summary &&
        !summary.uncertainEffects &&
        summary.outcomes?.length &&
        summary.outcomes.length <= 24 &&
        summary.outcomes.every((outcome) => outcome.fields.every((effect) => effect.object === "part"))
      );
      let engine = i.target && options.engineSummaries?.get(i.target.address);
      if (engine?.factory) {
        const type = args.at(-1 - (engine.factory.typeArgument - engine.argumentOffset) / 2)?.value;
        if (type?.kind === "constant" && engine.factory.noConstructorTypes.includes(unsigned(type.value, 16))) {
          const specialized = engine.factory.noConstructor;
          engine = {
            ...engine,
            ...specialized,
            assumptions: [
              ...new Set([
                ...engine.assumptions.filter(
                  (assumption) => !assumption.includes("effects on other objects remain unresolved"),
                ),
                ...specialized.assumptions,
                "The actual constant type argument selects an initial null constructor entry in the structurally discovered table.",
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
      if (engine && !pureReturnRelations && !preciseMemberRelations && applyEngine(engine, args, s, i)) {
        returnedStack(s);
        const next = i.segment * 16 + ((i.offset + i.size) & 0xffff);
        queue.push({ at: next, state: s });
        continue;
      }
      if (
        summary &&
        !summary.uncertainEffects &&
        (passesPart || pureReturnRelations || passesObservedMember) &&
        summary.outcomes?.length &&
        summary.outcomes.length <= 24 &&
        summary.outcomes.every((outcome) => outcome.fields.every((effect) => effect.object === "part"))
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
          branch.registers.set("__summary_owner", ownerArgument!);
          for (const item of mapped)
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
          branch.registers.delete("__summary_owner");
          for (const name of ["ax", "bx", "cx", "dx", "es"])
            registerWrite(
              name,
              tracked(unknown(`Volatile register returned by ${hex(summary.address)}`), [evidenceOf(i)]),
              branch,
            );
          registerWrite("ax", tracked(returned.value, uniqueEvidence([...returned.evidence, evidenceOf(i)])), branch);
          branch.flags = undefined;
          returnedStack(branch);
          queue.push({ at: next, state: branch });
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
    } else if (
      i.flow === "next" &&
      !["nop", "leave", "cld", "std", "cli", "sti", "clc", "stc", "cmc", "wait"].includes(i.mnemonic)
    ) {
      diagnostics.add(`Symbolic transfer for ${i.mnemonic} at ${hex(i.address)} is unresolved`);
      uncertainEffects = true;
      s.uncertain = true;
      s.flags = undefined;
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
        s.havocAt = i.address;
        s.partMemoryHavocAt = undefined;
        s.globalHavocAt = i.address;
        s.stateWritten = true;
      }
    }
    if (flagResult && i.mnemonic !== "not")
      s.flags = { operation: i.mnemonic, left: av, right: bv, result: flagResult, evidence: e };
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
        branch.evidence.push(...(s.flags?.evidence ?? []), evidenceOf(i));
        if (
          possible(conjunction(branch.conditions)) &&
          (!options.stateCount ||
            Array.from({ length: options.stateCount }, (_, n) => n).some((n) =>
              possible(conjunction(branch.conditions), n, stateOffset),
            ))
        )
          queue.push({ at: taken ? i.target!.address : next, state: branch });
      }
    } else if (i.flow === "jump") {
      if (i.target) queue.push({ at: i.target.address, state: s });
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
          queue.push({ at: edge.to!, state: branch });
        }
      }
    } else queue.push({ at: next, state: s });
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
  const dedup = <T>(items: T[]) => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
  return {
    ...code,
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
    engineCalls: dedup(engineCalls),
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
  const creation = discoverCreationDefaults(image, helpers, layout, list.dataSegment);
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
    const routine = analyseRoutine(image, entry, {
      dataSegment: list.dataSegment,
      stateOffset,
      argumentOffset,
      summaries,
      maxVisits: counts.has(address) ? 4000 : 800,
      code,
      engineSummaries,
      ...(callbackSlots.get(address)?.size === 1 &&
      callbackSlots.get(address)!.has(0) &&
      layout.callbacks[0]?.objectSource?.path.length === 1
        ? { objectArgument: "collider" as const, ownerLink: layout.callbacks[0].objectSource.path[0] }
        : {}),
    });
    summaries.set(address, routine);
    return routine;
  };
  for (const callbacks of references.values()) for (const callback of callbacks) summarise(callback.address);
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
    return {
      id: part.id,
      type: part.type,
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
      uncertainties: [...new Set(owned.flatMap((r) => r.uncertainties))],
    };
  });
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
  return {
    listId: list.list.id,
    imageLength: image.length,
    dataSegment: list.dataSegment,
    layout,
    timing,
    helpers,
    lifecycle,
    creation,
    parts,
    relatedObjectEffects,
    routines: [...summaries.values()].sort((a, b) => a.address - b.address),
    assumptions: [
      "All addresses are relative to the unpacked load image, with the DOS relocation load base removed.",
      "Slot names, object field meanings and callback frequency have separate evidence and must not be promoted from a v25 lead alone.",
      "A transition describes the final symbolic state along one acyclic control flow path. Loops, aliasing and unsupported effects remain unresolved.",
      "Calls are analysed using static summaries. No instruction, callback or fake part is executed.",
      ...(pending.length ? ["The call graph routine budget was reached; omitted callees remain unresolved."] : []),
    ],
  };
}
