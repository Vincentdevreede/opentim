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

export type Confidence = "checked" | "inferred" | "unresolved";
export interface Evidence {
  address: number;
  bytes: number[];
  text: string;
}
export type Expression =
  | { kind: "constant"; value: number; width: number }
  | { kind: "field"; object: string; offset: number; width: number }
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
  objectPointer: Finding & { argumentOffset: number; registers: string[] };
  writes: FieldWrite[];
  transitions: Transition[];
  comparisons: (Finding & { predicate: Predicate })[];
  /** True when an unsupported effect, a loop, or an unresolved call can affect a field. */
  uncertainEffects: boolean;
}
export interface PartBehaviour {
  id: string;
  type: number;
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
                          : undefined;
    if (result !== undefined) return constant(unsigned(result, width), width);
  }
  if (["+", "-", "|", "^"].includes(operator) && right.kind === "constant" && right.value === 0) return left;
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
}
type Value = Expression | Pointer | { kind: "stack"; displacement: number; width: number };
interface Tracked {
  value: Value;
  evidence: Evidence[];
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
  /** Summaries of callees already found by following code references. */
  summaries?: Map<number, RoutineAnalysis>;
}
const memoryKey = (l: Location) => `${l.object}:${l.offset}:${l.width}`;
const tracked = (value: Value, evidence: Evidence[] = []): Tracked => ({ value, evidence });
const asExpression = (value: Value): Expression =>
  value.kind === "pointer" || value.kind === "stack" ? unknown("An address is used as a number", value.width) : value;
const clone = (s: AbstractState): AbstractState => ({
  ...s,
  registers: new Map(s.registers),
  memory: new Map(s.memory),
  stack: [...s.stack],
  conditions: [...s.conditions],
  evidence: [...s.evidence],
  visited: new Set(s.visited),
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
  const code = readRoutineCode(image, entry, options.dataSegment ?? 0);
  const stateOffset = options.stateOffset ?? 0x0c;
  const argumentOffset = options.argumentOffset ?? 6;
  const writes: FieldWrite[] = [];
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
    if (parent) s.registers.delete(parent);
    else for (const [child, whole] of Object.entries(wordOfByte)) if (whole === name) s.registers.delete(child);
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
    const pointer = base.find((v) => v.value.kind === "pointer");
    if (
      pointer &&
      pointer.value.kind === "pointer" &&
      base.filter((v) => v !== pointer).every((v) => v.value.kind === "constant")
    ) {
      const seg = registerRead(operand.segment, s).value;
      const validSegment =
        operand.segment === "ds" && seg.kind === "constant" && seg.value === (options.dataSegment ?? 0);
      // LES/LDS explicitly associates the segment register with the same far pointer.
      const paired = seg.kind === "pointer" && seg.object === pointer.value.object;
      if (!validSegment && !paired) return undefined;
      return {
        object: pointer.value.object,
        offset:
          pointer.value.displacement +
          operand.displacement +
          base.filter((v) => v !== pointer).reduce((n, v) => n + (v.value.kind === "constant" ? v.value.value : 0), 0),
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
      if (ref.object !== "stack" && ref.object !== "data")
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
    if (cached) return cached;
    if (l?.object === "stack") {
      // PUSH BP; MOV BP,SP makes BP entry-SP minus two. A far return occupies four bytes.
      const frameOffset = l.offset + 2;
      if (frameOffset === argumentOffset)
        return tracked({ kind: "pointer", object: "part", displacement: 0, width: 16 }, l.evidence);
      if (frameOffset > 0) return tracked(field("argument", frameOffset, operand.width), l.evidence);
    }
    if (l) {
      return tracked(
        s.havoc && l.object !== "stack"
          ? unknown(`Field ${l.object}+${hex(l.offset)} may have changed in a call`, l.width)
          : field(l.object, l.offset, l.width),
        l.evidence,
      );
    }
    const seg = registerRead(operand.segment, s).value;
    const base = operand.base.map((r) => registerRead(r, s));
    if (seg.kind === "constant" && base.every((v) => v.value.kind !== "pointer" && v.value.kind !== "stack")) {
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
      const [object, at, width] = key.split(":");
      if (object === l.object && +at! < l.offset + l.width / 8 && l.offset < +at! + +width! / 8) s.memory.delete(key);
    }
    s.memory.set(memoryKey(l), tracked(value.value, uniqueEvidence([...e, ...l.evidence])));
    if (l.object === "part" && l.offset === stateOffset) {
      s.stateWritten = true;
      s.evidence.push(...e);
    }
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
  const unresolvedExit = (s: AbstractState, i: Instruction | undefined, reason: string) => {
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
  const finish = (s: AbstractState, i: Instruction) => {
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
    const transition = { ...f, from, to, condition, routine: entry.address };
    const key = JSON.stringify([from, to, condition]);
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
    if (s.visited.has(i.address)) {
      uncertainEffects = true;
      diagnostics.add(`Back edge to ${hex(i.address)} requires a loop invariant; its effects remain unresolved`);
      unresolvedExit(s, i, `Loop invariant at ${hex(i.address)} is unresolved`);
      continue;
    }
    s.visited.add(i.address);
    s.registers.set("cs", tracked(constant(i.segment)));
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
      flagResult = binary(
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
      if (
        ["add", "sub"].includes(i.mnemonic) &&
        (a.value.kind === "pointer" || a.value.kind === "stack") &&
        bv.kind === "constant"
      )
        write(
          dest,
          tracked(
            { ...a.value, displacement: a.value.displacement + (i.mnemonic === "add" ? bv.value : -bv.value) },
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
        tracked(unknown("Sign extension of AL", 16), registerRead("al", s).evidence),
        s,
        i,
      );
    } else if (i.mnemonic === "cwd") {
      write({ kind: "register", name: "dx", width: 16 }, tracked(unknown("Sign extension of AX"), e), s, i);
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
      }
      const argument = args.at(-1)?.value;
      const passesPart = argument?.kind === "pointer" && argument.object === "part" && argument.displacement === 0;
      if (!summary || summary.uncertainEffects) {
        uncertainEffects = true;
        s.uncertain = true;
        s.havoc = true;
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
  if (queue.length) {
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
        result[a] = {
          ...left,
          condition: conjunction(lt.filter((p) => p !== x)),
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

/** Reads behaviour from an unmodified packed program and its searched type table. No game-specific address is used. */
export function readBehaviour(program: Uint8Array, list: ProgramParts): BehaviourReport {
  const image = unpackLzexe(program);
  for (const record of list.records) {
    if (!record.bytes.every((byte, index) => image[record.at + index] === byte))
      throw new Error(`Type record ${record.type} does not belong to this program at ${hex(record.at)}`);
  }
  const layout = discoverBehaviourLayout(image, list.table);
  if (
    layout.callbacks.length !== 6 ||
    layout.objectArgument.offset === undefined ||
    !layout.fields.some((f) => f.name === "state" && f.confidence === "checked")
  )
    throw new Error(
      `Cannot establish callback dispatch, object argument and state field: ${layout.diagnostics.join("; ") || "incomplete structural evidence"}`,
    );
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
  const summaries = new Map<number, RoutineAnalysis>();
  const active = new Set<number>();
  const summarise = (address: number): RoutineAnalysis => {
    const existing = summaries.get(address);
    if (existing) return existing;
    const entry = entries.get(address)!;
    const code = codes.get(address);
    active.add(address);
    for (const call of code?.calls ?? [])
      if (call.target && entries.has(call.target.address) && !active.has(call.target.address))
        summarise(call.target.address);
    active.delete(address);
    const returnKinds = new Set(code?.instructions.filter((i) => i.flow === "return").map((i) => i.mnemonic));
    const argumentOffset = counts.has(address)
      ? layout.objectArgument.offset
      : returnKinds.size === 1 && returnKinds.has("ret")
        ? 4
        : 6;
    const routine = analyseRoutine(image, entry, {
      dataSegment: list.dataSegment,
      stateOffset,
      argumentOffset,
      summaries,
      maxVisits: counts.has(address) ? 4000 : 800,
    });
    summaries.set(address, routine);
    return routine;
  };
  for (const callbacks of references.values()) for (const callback of callbacks) summarise(callback.address);
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
            w.value.left.offset === w.offset,
        )
        .map((w) => w.offset),
    );
    const counters: Counter[] = [...counterOffsets].map((offset) => {
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
          "The field acts as a counter because it is updated arithmetically and compared; its physical meaning is not assumed.",
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
