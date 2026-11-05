/** Builds descriptions and frame walks from extracted rules. No instruction stream is interpreted here. */
import { describeCollisionDispatch } from "./behaviour-collision-dispatch.ts";
import { CONTROL_VALUES, IMPOSSIBLE_STATES, LEVEL_FRAMES } from "./behaviour-saved-frames.ts";
import { describeGear, type GearDescription } from "./describe-gear.ts";
import type {
  BehaviourReport,
  Confidence,
  Evidence,
  Expression,
  FieldWrite,
  Finding,
  PartBehaviour,
  Predicate,
  RoutineAnalysis,
  Transition,
} from "./behaviour.ts";

export interface KnownField extends Finding {
  object: string;
  offset: number;
  width: number;
  value: number;
  /** Bits established by the instructions. Other bits are unknown, rather than zero. */
  knownMask: number;
}

export interface FrameVisit extends Finding {
  state: number;
  frame?: number;
  atRun: number;
  /** A count of extracted run rules, not a wall-clock duration. */
  runCalls: number;
  gameSteps?: number;
}

export interface BehaviourWalk extends Finding {
  /** `joins` ends a branch that reaches a state another branch of the same walk already follows from there on. */
  status: "rest" | "loop" | "unresolved" | "limit" | "joins";
  states: number[];
  /** A proved identity rule can hold an unspecified input frame without selecting a number for it. */
  parameterised?:
    | { kind: "hold"; state: Expression; allowedStates?: number[] }
    | {
        kind: "cycle";
        state: Expression;
        period: number;
        direction: 1 | -1;
        minimumBase: number;
        maximumBase: number;
      };
  frames: FrameVisit[];
  runCalls: number;
  loopStart?: number;
  fields: KnownField[];
  reason?: string;
  stop?: {
    kind: "condition" | "state" | "effects" | "ambiguity" | "coverage";
    description: string;
    evidence: Evidence[];
    fields?: { object: string; offset: number; width: number }[];
    /**
     * When an unknown input decides between rules, the walk that follows each of them, under that rule's own
     * condition. The input is not chosen: every branch stays conditional, and the walk itself stays unresolved.
     */
    branches?: {
      condition: Predicate;
      /** When several rules lead to the same next fields: what else each of them tests, of which one holds. */
      alternatives?: Predicate[];
      walk: BehaviourWalk;
    }[];
    /**
     * For a stop on a field's value: the writes to that field the analysis found, with their routines and values.
     * They say where the value can come from; they are not proved to be every writer.
     */
    producers?: (Finding & {
      source: string;
      routine?: number;
      offset: number;
      value: Expression;
      condition?: Predicate;
    })[];
  };
  timingReason: string;
}

export interface RestDescription extends Finding {
  status: "known" | "unresolved";
  description: string;
  state?: number;
  frame?: number;
  fields: KnownField[];
  reason?: string;
}

export interface AnimationTrigger extends Finding {
  effectsComplete?: boolean;
  scope?: "one overlap-list member";
  kind: "run" | "callback" | "related-write" | "input-case";
  name: string;
  description?: string;
  routine: number;
  condition: Predicate;
  writes: FieldWrite[];
  sourceType?: number;
}

export interface StableStateDescription extends Finding {
  state: number;
  frame?: number;
  fields: KnownField[];
  origins: { condition: Predicate; evidence: Evidence[] }[];
}

export interface AnimationDescription extends Finding {
  id: string;
  initial: "reset" | "documented-rest" | "run-guard" | "creation";
  inputCondition?: Predicate;
  /** Conditions before the earlier run outcome that established a documented stable state. */
  prerequisites: { condition: Predicate; evidence: Evidence[] }[];
  trigger: AnimationTrigger;
  initialFields?: KnownField[];
  description?: string;
  walk: BehaviourWalk;
}

export interface DescribedEffect extends Finding {
  kind: "drawing" | "counter" | "related-object" | "helper";
  description: string;
  condition?: Predicate;
  field?: number;
  routine?: number;
}

export interface PartBehaviourDescription extends Finding {
  contact?: NonNullable<ReturnType<typeof describeCollisionDispatch>>;
  gear?: GearDescription;
  type: number;
  id: string;
  summary: string;
  rest: RestDescription;
  creation?: RestDescription;
  stableStates: StableStateDescription[];
  effects: DescribedEffect[];
  rules: (Finding & { description: string; condition: Predicate; nextState: Expression })[];
  animations: AnimationDescription[];
  triggers: { name: string; condition?: Predicate; evidence: Evidence[]; confidence: Confidence }[];
  uncertainties: string[];
}

export interface BehaviourDescription extends Finding {
  listId: string;
  parts: PartBehaviourDescription[];
}

interface RuleOutcome extends Finding {
  effectsComplete?: boolean;
  condition: Predicate;
  fields: FieldWrite[];
  returnValue?: Expression;
}
type WithOutcomes = RoutineAnalysis & { outcomes?: RuleOutcome[] };
type WithUpdates = Transition & { updates?: FieldWrite[] };
type WithFrameCount = PartBehaviour & { frameCount?: number };
interface Bits {
  value: number;
  mask: number;
  width: number;
}
type Bindings = Map<string, Bits>;
const full = (width: number) => 2 ** width - 1;
const wrap = (value: number, width: number) => ((value % 2 ** width) + 2 ** width) % 2 ** width;
const signed = (value: number, width: number) => (value >= 2 ** (width - 1) ? value - 2 ** width : value);
const bits = (value: number, mask: number, width: number): Bits => ({
  value: wrap(value, width) & mask,
  mask: mask & full(width),
  width,
});
const unknownBits = (width: number): Bits => bits(0, 0, width);
const known = (value: Bits) => value.mask === full(value.width);
const key = (object: string, offset: number) => `${object}:${offset}`;
const evidence = (...items: Evidence[][]): Evidence[] => [
  ...new Map(items.flat().map((item) => [item.address, item])).values(),
];
const confidence = (...values: Confidence[]): Confidence =>
  values.includes("unresolved") ? "unresolved" : values.includes("inferred") ? "inferred" : "checked";
const finding = (items: Finding[], extra: string[] = []): Finding => ({
  confidence: confidence(...items.map((item) => item.confidence)),
  assumptions: [...new Set([...items.flatMap((item) => item.assumptions), ...extra])],
  evidence: evidence(...items.map((item) => item.evidence)),
});

function readField(bindings: Bindings, object: string, offset: number, width: number): Bits {
  let value = 0;
  let mask = 0;
  for (let byte = 0; byte < width / 8; byte++) {
    const item = bindings.get(key(object, offset + byte));
    if (item) {
      value += item.value * 2 ** (8 * byte);
      mask += item.mask * 2 ** (8 * byte);
    }
  }
  return bits(value, mask, width);
}
function writeField(bindings: Bindings, object: string, offset: number, value: Bits) {
  for (let byte = 0; byte < value.width / 8; byte++)
    bindings.set(key(object, offset + byte), bits(value.value >>> (8 * byte), value.mask >>> (8 * byte), 8));
}
function bindingsOf(fields: Pick<KnownField, "object" | "offset" | "width" | "value" | "knownMask">[]): Bindings {
  const bindings: Bindings = new Map();
  for (const item of fields)
    writeField(bindings, item.object, item.offset, bits(item.value, item.knownMask, item.width));
  return bindings;
}

/** Partial bits allow a proved flag clear or set without inventing the remaining flags. */
function valueOf(expression: Expression, bindings: Bindings): Bits {
  const width = expression.width;
  if (expression.kind === "constant") return bits(expression.value, full(width), width);
  if (expression.kind === "field")
    return expression.unresolved
      ? unknownBits(width)
      : readField(bindings, expression.object, expression.offset, width);
  if (expression.kind !== "binary") return unknownBits(width);
  const left = valueOf(expression.left, bindings);
  const right = valueOf(expression.right, bindings);
  if (expression.operator === "&") {
    const zero = (left.mask & ~left.value) | (right.mask & ~right.value);
    const one = left.mask & right.mask & left.value & right.value;
    return bits(one, zero | one, width);
  }
  if (expression.operator === "|") {
    const one = (left.mask & left.value) | (right.mask & right.value);
    const zero = left.mask & right.mask & ~left.value & ~right.value;
    return bits(one, zero | one, width);
  }
  if (expression.operator === "^") return bits(left.value ^ right.value, left.mask & right.mask, width);
  if (!known(left) || !known(right)) return unknownBits(width);
  if (["==", "!=", "<", "<=", ">", ">="].includes(expression.operator)) {
    const a = wrap(left.value, expression.left.width),
      b = wrap(right.value, expression.left.width),
      op = expression.operator;
    return bits(
      Number(
        op === "=="
          ? a === b
          : op === "!="
            ? a !== b
            : op === "<"
              ? a < b
              : op === "<="
                ? a <= b
                : op === ">"
                  ? a > b
                  : a >= b,
      ),
      full(width),
      width,
    );
  }
  let value: number;
  switch (expression.operator) {
    case "+":
      value = left.value + right.value;
      break;
    case "-":
      value = left.value - right.value;
      break;
    case "*":
      value = left.value * right.value;
      break;
    case "%":
      if (!right.value) return unknownBits(width);
      value = left.value % right.value;
      break;
    case "/":
      if (!right.value) return unknownBits(width);
      value = Math.trunc(left.value / right.value);
      break;
    case "s/":
    case "s%": {
      const denominator = signed(right.value, right.width);
      if (!denominator) return unknownBits(width);
      const dividend = signed(left.value, left.width);
      value = expression.operator === "s/" ? Math.trunc(dividend / denominator) : dividend % denominator;
      break;
    }
    case "<<":
      value = left.value << right.value;
      break;
    case ">>>":
      value = left.value >>> right.value;
      break;
    case ">>":
      value = signed(left.value, left.width) >> right.value;
      break;
    default:
      return unknownBits(width);
  }
  return bits(value, full(width), width);
}
function predicateWithoutConstraints(predicate: Predicate, bindings: Bindings): boolean | undefined {
  if (predicate.kind === "true") return true;
  if (predicate.kind === "unknown") return undefined;
  if (predicate.kind === "and") {
    const values = predicate.terms.map((term) => predicateWithoutConstraints(term, bindings));
    return values.includes(false) ? false : values.includes(undefined) ? undefined : true;
  }
  const left = valueOf(predicate.left, bindings);
  const right = valueOf(predicate.right, bindings);
  const width = predicate.left.width;
  if (
    (predicate.operator === "==" || predicate.operator === "!=") &&
    (left.value ^ right.value) & left.mask & right.mask
  )
    return predicate.operator === "!=";
  if (!known(left) || !known(right)) return undefined;
  const a = predicate.signed ? signed(wrap(left.value, width), width) : wrap(left.value, width);
  const b = predicate.signed ? signed(wrap(right.value, width), width) : wrap(right.value, width);
  return predicate.operator === "=="
    ? a === b
    : predicate.operator === "!="
      ? a !== b
      : predicate.operator === "<"
        ? a < b
        : predicate.operator === "<="
          ? a <= b
          : predicate.operator === ">"
            ? a > b
            : predicate.operator === ">="
              ? a >= b
              : undefined;
}

const predicateTerms = (predicate: Predicate): Predicate[] =>
  predicate.kind === "and" ? predicate.terms.flatMap(predicateTerms) : predicate.kind === "true" ? [] : [predicate];
/** The text of an expression or condition, kept per object: the walks compare the same ones many times. */
const texts = new WeakMap<object, string>();
const textOf = (value: Expression | Predicate): string => {
  let text = texts.get(value);
  if (text === undefined) texts.set(value, (text = JSON.stringify(value)));
  return text;
};
const sameExpression = (left: Expression, right: Expression) => left === right || textOf(left) === textOf(right);
const inverseComparison: Record<string, string> = {
  "==": "!=",
  "!=": "==",
  "<": ">=",
  "<=": ">",
  ">": "<=",
  ">=": "<",
};
function predicateOf(predicate: Predicate, bindings: Bindings, constraints: Predicate[] = []): boolean | undefined {
  const direct = predicateWithoutConstraints(predicate, bindings);
  if (direct !== undefined) return direct;
  if (predicate.kind === "and") {
    const values = predicate.terms.map((term) => predicateOf(term, bindings, constraints));
    return values.includes(false) ? false : values.includes(undefined) ? undefined : true;
  }
  if (predicate.kind !== "compare") return undefined;
  const compatible = constraints.filter(
    (term): term is Extract<Predicate, { kind: "compare" }> =>
      term.kind === "compare" && term.signed === predicate.signed && sameExpression(term.left, predicate.left),
  );
  for (const term of compatible)
    if (sameExpression(term.right, predicate.right)) {
      if (term.operator === predicate.operator) return true;
      if (term.operator === inverseComparison[predicate.operator]) return false;
    }
  if (predicate.right.kind !== "constant") return undefined;
  let low = predicate.signed ? -(2 ** (predicate.left.width - 1)) : 0;
  let high = predicate.signed ? 2 ** (predicate.left.width - 1) - 1 : full(predicate.left.width);
  const excluded = new Set<number>();
  for (const term of compatible) {
    if (term.right.kind !== "constant") continue;
    const value = term.signed
      ? signed(wrap(term.right.value, term.left.width), term.left.width)
      : wrap(term.right.value, term.left.width);
    if (term.operator === "==") {
      low = Math.max(low, value);
      high = Math.min(high, value);
    } else if (term.operator === "!=") excluded.add(value);
    else if (term.operator === "<") high = Math.min(high, value - 1);
    else if (term.operator === "<=") high = Math.min(high, value);
    else if (term.operator === ">") low = Math.max(low, value + 1);
    else if (term.operator === ">=") low = Math.max(low, value);
  }
  const value = predicate.signed
    ? signed(wrap(predicate.right.value, predicate.left.width), predicate.left.width)
    : wrap(predicate.right.value, predicate.left.width);
  if (predicate.operator === "==")
    return value < low || value > high || excluded.has(value)
      ? false
      : low === high && low === value
        ? true
        : undefined;
  if (predicate.operator === "!=")
    return value < low || value > high || excluded.has(value)
      ? true
      : low === high && low === value
        ? false
        : undefined;
  if (predicate.operator === "<") return high < value ? true : low >= value ? false : undefined;
  if (predicate.operator === "<=") return high <= value ? true : low > value ? false : undefined;
  if (predicate.operator === ">") return low > value ? true : high <= value ? false : undefined;
  if (predicate.operator === ">=") return low >= value ? true : high < value ? false : undefined;
  return undefined;
}
/** A related object's identity depends on every pointer traversed to reach it. */
function pointerFields(object: string): { object: string; offset: number; width: number }[] {
  if (object.startsWith("address of ")) return pointerFields(object.slice(11));
  const match = /^referenced-by\((.*)\+0x([0-9a-f]+)\)$/.exec(object);
  return match ? [{ object: match[1]!, offset: parseInt(match[2]!, 16), width: 16 }, ...pointerFields(match[1]!)] : [];
}
function expressionFields(expression: Expression): { object: string; offset: number; width: number }[] {
  if (expression.kind === "field") return [expression, ...pointerFields(expression.object)];
  if (expression.kind === "binary")
    return [...expressionFields(expression.left), ...expressionFields(expression.right)];
  return [];
}
function inputPredicate(predicate: Predicate): boolean {
  if (predicate.kind !== "compare") return false;
  const stableObject = (object: string): boolean => {
    if (object === "part") return true;
    if (object.startsWith("address of ")) return stableObject(object.slice(11));
    const match = /^referenced-by\((.*)\+0x[0-9a-f]+\)$/.exec(object);
    return !!match && stableObject(match[1]!);
  };
  const valid = (expression: Expression): boolean =>
    expression.kind === "constant" ||
    (expression.kind === "field" && stableObject(expression.object) && !expression.unresolved) ||
    (expression.kind === "binary" && valid(expression.left) && valid(expression.right));
  return valid(predicate.left) && valid(predicate.right);
}
function retainConstraints(
  constraints: Predicate[],
  writes: FieldWrite[],
  stateOffset: number,
  destination: Expression,
): Predicate[] {
  const changed = writes.filter(
    (write) =>
      !(
        write.value.kind === "field" &&
        write.value.object === write.object &&
        write.value.offset === write.offset &&
        write.value.width === write.width
      ),
  );
  if (!(destination.kind === "field" && destination.object === "part" && destination.offset === stateOffset))
    changed.push({ object: "part", offset: stateOffset, width: 16 } as FieldWrite);
  return constraints.filter(
    (constraint) =>
      constraint.kind === "compare" &&
      ![...expressionFields(constraint.left), ...expressionFields(constraint.right)].some((field) =>
        changed.some(
          (write) =>
            (write.object === field.object ||
              (write.object === "part" && field.object.startsWith("referenced-by(")) ||
              (field.object === "part" && write.object.startsWith("referenced-by(")) ||
              (write.object.startsWith("referenced-by(") && field.object.startsWith("referenced-by("))) &&
            write.offset < field.offset + field.width / 8 &&
            field.offset < write.offset + write.width / 8,
        ),
      ),
  );
}

/** Tests a graph condition against supplied field knowledge, without applying any executable instructions. */
export function evaluateBehaviourCondition(
  condition: Predicate,
  fields: Pick<KnownField, "object" | "offset" | "width" | "value" | "knownMask">[],
): boolean | undefined {
  return predicateOf(condition, bindingsOf(fields));
}

/** The finding of each set of rules a part's walks take a step under, by the rules' places in its transitions. */
const stepFindings = new WeakMap<PartBehaviour, { index: Map<unknown, number>; steps: Map<string, Finding> }>();
/** The fields each part's walks track, worked out once per part; callers get their own copy to add to. */
const definitionsOf = new WeakMap<PartBehaviour, { object: string; offset: number; width: number }[]>();
function fieldDefinitions(
  report: BehaviourReport,
  part: PartBehaviour,
): { object: string; offset: number; width: number }[] {
  const cached = definitionsOf.get(part);
  if (cached) return [...cached];
  const fields = new Map<string, { object: string; offset: number; width: number }>();
  const add = (object: string, offset: number, width: number) =>
    fields.set(`${object}:${offset}:${width}`, { object, offset, width });
  for (const item of [
    ...part.reset,
    ...part.stateWrites,
    ...part.visibleEffects,
    ...part.counters.flatMap((counter) => counter.updates),
  ])
    add(item.object, item.offset, item.width);
  for (const item of report.layout.fields) add("part", item.offset, 16);
  for (const transition of part.transitions as WithUpdates[])
    for (const item of transition.updates ?? []) add(item.object, item.offset, item.width);
  definitionsOf.set(part, [...fields.values()]);
  return [...fields.values()];
}
/**
 * The bindings with each part field a condition tests for one number set to that number, or the same bindings when it
 * sets none. Only plain fields of the part count, whose value the walk doesn't know yet.
 */
function withEqualities(bindings: Bindings, condition: Predicate): Bindings {
  let result = bindings;
  for (const term of predicateTerms(condition)) {
    if (term.kind !== "compare" || term.operator !== "==") continue;
    const [field, number] =
      term.left.kind === "field" && term.right.kind === "constant"
        ? [term.left, term.right]
        : term.right.kind === "field" && term.left.kind === "constant"
          ? [term.right, term.left]
          : [];
    if (!field || !number || field.kind !== "field" || number.kind !== "constant") continue;
    if (field.object !== "part" || field.unresolved || ![8, 16].includes(field.width)) continue;
    if (known(readField(result, "part", field.offset, field.width))) continue;
    if (result === bindings) result = new Map(bindings);
    writeField(result, "part", field.offset, bits(number.value & full(field.width), full(field.width), field.width));
  }
  return result;
}
/** The terms every list has. */
const shared = (lists: Predicate[][]) =>
  lists[0]!.filter((term) => lists.every((list) => list.some((other) => textOf(other) === textOf(term))));
/** The field bits several bindings agree on; a field they set differently is left out. */
function agreedBindings(list: Bindings[]): Bindings {
  const [first, ...rest] = list;
  const agreed: Bindings = new Map();
  for (const [key, bits] of first!) {
    let mask = bits.mask;
    for (const other of rest) {
      const item = other.get(key);
      mask = item && item.width === bits.width ? mask & item.mask & ~(item.value ^ bits.value) : 0;
      if (!mask) break;
    }
    if (mask) agreed.set(key, { value: bits.value & mask, mask, width: bits.width });
  }
  return agreed;
}
function fieldsOf(
  bindings: Bindings,
  definitions: { object: string; offset: number; width: number }[],
  proof: Finding,
): KnownField[] {
  return definitions.flatMap((definition) => {
    const value = readField(bindings, definition.object, definition.offset, definition.width);
    return value.mask ? [{ ...definition, value: value.value, knownMask: value.mask, ...proof }] : [];
  });
}
function applyWrites(bindings: Bindings, writes: FieldWrite[]): Bindings {
  const next = new Map(bindings);
  for (const write of writes) writeField(next, write.object, write.offset, valueOf(write.value, bindings));
  return next;
}
/**
 * True when an expression or predicate contains an unknown value, or, unless `fields` is false, a reference to a field
 * whose value an earlier unresolved write in the same routine replaced.
 */
function containsUnknown(value: Expression | Predicate, fields = true): boolean {
  switch (value.kind) {
    case "unknown":
      return true;
    case "field":
      return fields && !!value.unresolved;
    case "binary":
      return containsUnknown(value.left, fields) || containsUnknown(value.right, fields);
    case "table":
      return containsUnknown(value.index, fields);
    case "compare":
      return containsUnknown(value.left, fields) || containsUnknown(value.right, fields);
    case "and":
      return value.terms.some((term) => containsUnknown(term, fields));
    default:
      return false;
  }
}
/**
 * A part the run found itself, like the member a find-first loop stopped at, or a value the run worked out from other
 * parts, like whether a gear's train is blocked. Its fields are read during that run.
 */
const runObject = (object: string) =>
  /^(member found by the loop|part returned by list-(head|next)|gear connection conflict) at /.test(object);
const mentionsRunObject = (value: Expression): boolean =>
  (value.kind === "field" && runObject(value.object)) ||
  (value.kind === "binary" && (mentionsRunObject(value.left) || mentionsRunObject(value.right)));
/**
 * A comparison whose only unknowns are values of the same run: fields it rewrote, like the result of a contact scan, a
 * query's answer, or fields of a part it found, like the type of the part a cat looks at.
 */
const runValuePredicate = (predicate: Predicate) =>
  predicate.kind === "compare" &&
  !containsUnknown(predicate, false) &&
  (containsUnknown(predicate) || mentionsRunObject(predicate.left) || mentionsRunObject(predicate.right));
function completeRuleEffects(rule: WithUpdates, routine?: RoutineAnalysis): boolean {
  if (routine?.uncertainEffects !== true) return true;
  const matching = routine?.outcomes?.filter((outcome) => textOf(outcome.condition) === textOf(rule.condition)) ?? [];
  return (
    (matching.length > 0 && matching.every((outcome) => outcome.effectsComplete === true)) ||
    (!!routine?.outcomes?.length && routine.outcomes.every((outcome) => outcome.effectsComplete === true))
  );
}
function ruleBindings(rule: WithUpdates, initial: Bindings, routine?: RoutineAnalysis): Bindings {
  const complete = completeRuleEffects(rule, routine);
  if (rule.updates) {
    const next = complete ? new Map(initial) : new Map<string, Bits>();
    for (const write of rule.updates) writeField(next, write.object, write.offset, valueOf(write.value, initial));
    return next;
  }
  const next = new Map(initial);
  for (const write of routine?.writes ?? [])
    if (write.object === "part") writeField(next, write.object, write.offset, unknownBits(write.width));
  return next;
}
/** What the branches of one walk have followed: by known fields, the frame and the tests known there. */
interface Explored {
  states: Map<string, { frame: number; tests: Set<string> }[]>;
  /** How many states the tree has followed: once it reaches the budget, no further branch is opened. */
  size: number;
}
/**
 * How deep branches may nest, and how many states one tree of branches may follow. A branch that reaches a state the
 * tree already follows ends there, so most trees close by themselves; these only bound the ones that don't.
 */
const BRANCH_DEPTH = 24;
const BRANCH_BUDGET = 400;
/** How many ways one step may split into. */
const BRANCH_WAYS = 8;
/** The decided assumption that rules out a part's state with these fields, when one does. */
function impossibleState(part: PartBehaviour, stateOffset: number, bindings: Bindings): string | undefined {
  const state = readField(bindings, "part", stateOffset, 16);
  if (!known(state)) return undefined;
  return IMPOSSIBLE_STATES.get(part.id)?.find((rule) => {
    const field = readField(bindings, "part", rule.field.offset, rule.field.width);
    return rule.frames.includes(state.value) && known(field) && field.value === rule.field.value;
  })?.assumption;
}
/** The only numbers a decided assumption allows this unknown field, like a jack-in-the-box's control value. */
function decidedValues(part: PartBehaviour, field: { object: string; offset: number; width: number }) {
  const decided = CONTROL_VALUES.get(part.id);
  return decided && field.object === "part" && field.offset === decided.offset && field.width === decided.width
    ? decided
    : undefined;
}
/** These fields know every bit the others know, with the same value. */
function knowsAll(fields: Bindings, others: Bindings): boolean {
  return [...others].every(([name, value]) => {
    const other = fields.get(name);
    return (
      !value.mask || (!!other && (value.mask & ~other.mask) === 0 && ((value.value ^ other.value) & value.mask) === 0)
    );
  });
}
function signature(bindings: Bindings) {
  return JSON.stringify([...bindings].filter(([, value]) => value.mask).sort(([a], [b]) => a.localeCompare(b)));
}
function intersect(bindings: Bindings[]): Bindings {
  const result: Bindings = new Map();
  for (const [name, first] of bindings[0] ?? []) {
    let mask = first.mask;
    for (const item of bindings.slice(1)) {
      const other = item.get(name) ?? unknownBits(8);
      mask &= other.mask & ~(first.value ^ other.value);
    }
    if (mask) result.set(name, bits(first.value, mask, 8));
  }
  return result;
}
const stateOffsetOf = (report: BehaviourReport) => report.layout.fields.find((field) => field.name === "state")?.offset;
const frameOf = (part: WithFrameCount, state: number) => (part.frameCount === 0 ? undefined : state);
function metadataFields(report: BehaviourReport, part: PartBehaviour): KnownField[] {
  const type = report.layout.fields.find((field) => field.name === "type");
  return type
    ? [
        {
          object: "part",
          offset: type.offset,
          width: 16,
          value: part.type,
          knownMask: full(16),
          confidence: type.confidence,
          evidence: type.evidence,
          assumptions: ["The selected part identifies its type-table entry."],
        },
      ]
    : [];
}

function restOf(report: BehaviourReport, part: PartBehaviour): RestDescription {
  const callback = part.routines.find((item) => item.slot === 2);
  const routine = report.routines.find((item) => item.address === callback?.address) as WithOutcomes | undefined;
  const metadata = metadataFields(report, part);
  const initial = bindingsOf(metadata);
  const outcomes = routine?.outcomes?.filter((outcome) => predicateOf(outcome.condition, initial) !== false) ?? [];
  const stateOffset = stateOffsetOf(report);
  const savedRest = report.lifecycle?.reset.find((context) => context.stateSource !== undefined);
  const unknownRest = savedRest
    ? "The level reset restores the frame saved in the level; its numeric value is not supplied by TIM.EXE alone."
    : "The reset code does not establish a fixed rest frame.";
  if (!outcomes.length || stateOffset === undefined)
    return {
      status: "unresolved",
      description: unknownRest,
      fields: metadata,
      confidence: "unresolved",
      assumptions: [],
      evidence: callback?.evidence ?? [],
      reason:
        stateOffset === undefined
          ? "The state field was not established."
          : "The reset callback has no final-field summary. No rest state is assumed.",
    };
  const proof = finding(outcomes);
  const bindings = intersect(outcomes.map((outcome) => applyWrites(initial, outcome.fields)));
  const state = readField(bindings, "part", stateOffset, 16);
  const fields = fieldsOf(bindings, fieldDefinitions(report, part), proof);
  if (!known(state) || outcomes.some((outcome) => outcome.confidence === "unresolved"))
    return {
      status: "unresolved",
      description: savedRest
        ? unknownRest
        : "The reset paths leave the state dependent on fields whose values have not been established.",
      fields,
      ...proof,
      confidence: "unresolved",
      reason: "The reset paths do not establish one rest state with resolved effects.",
    };
  return {
    status: "known",
    description: `The reset paths establish state ${state.value}.`,
    state: state.value,
    frame: frameOf(part, state.value),
    fields,
    ...proof,
  };
}

function visits(states: number[], proofs: Finding[], part: PartBehaviour): FrameVisit[] {
  const result: FrameVisit[] = [];
  states.forEach((state, index) => {
    const prior = result.at(-1);
    if (prior?.state === state) {
      prior.runCalls += index === states.length - 1 ? 0 : 1;
      prior.evidence = evidence(prior.evidence, proofs[index]?.evidence ?? []);
      prior.confidence = confidence(prior.confidence, proofs[index]?.confidence ?? "checked");
    } else
      result.push({
        state,
        frame: frameOf(part, state),
        atRun: index,
        runCalls: index === states.length - 1 ? 0 : 1,
        ...(proofs[index] ?? { confidence: "checked", evidence: [], assumptions: [] }),
      });
  });
  return result;
}

function guardCoverage(
  rules: Transition[],
  bindings: Bindings,
  constraints: Predicate[],
  routine?: RoutineAnalysis,
): boolean {
  if (rules.some((rule) => predicateOf(rule.condition, bindings, constraints) === true)) return true;
  if (routine?.returnPathsComplete === true) return true;
  const unknown = rules.map((rule) =>
    predicateTerms(rule.condition).filter((term) => predicateOf(term, bindings, constraints) === undefined),
  );
  return unknown.some(
    (left, index) =>
      left.length === 1 &&
      left[0]!.kind === "compare" &&
      unknown.slice(index + 1).some((right) => {
        const a = left[0]!,
          b = right[0];
        return (
          right.length === 1 &&
          a.kind === "compare" &&
          b?.kind === "compare" &&
          a.signed === b.signed &&
          a.operator === inverseComparison[b.operator] &&
          sameExpression(a.left, b.left) &&
          sameExpression(a.right, b.right)
        );
      }),
  );
}
function unknownWords(
  expression: Expression,
  report: BehaviourReport,
  part: PartBehaviour,
  bindings: Bindings,
): string {
  if (expression.kind === "unknown")
    return /call|helper|return/i.test(expression.reason)
      ? "a helper result"
      : /pointer|alias|address/i.test(expression.reason)
        ? "an object reference"
        : /loop|budget/i.test(expression.reason)
          ? "a loop result"
          : "a calculated value";
  if (expression.kind === "table") return "a data-table selection";
  if (expression.kind === "binary") {
    if (!known(valueOf(expression.left, bindings))) return unknownWords(expression.left, report, part, bindings);
    return unknownWords(expression.right, report, part, bindings);
  }
  if (expression.kind === "field") {
    if (expression.object !== "part")
      return expression.object === "data" ? "a shared engine value" : "a value from another part";
    const name = report.layout.fields.find((field) => field.offset === expression.offset)?.name;
    if (name === "stateDelta") return "the state-control value";
    if (name === "drawingFlags") return "a drawing flag";
    if (name === "previousState" || name === "olderState") return "the previous-state snapshot";
    if (name === "contactPart" || name === "contactAngle" || name === "contactEdge") return "contact information";
    if (name === "contextCounter" || part.counters.some((counter) => counter.offset === expression.offset))
      return "a part-specific counter";
    if (name && /width|height|extent|position|draw/i.test(name)) return "a position or size value";
  }
  return "a part-specific field";
}
/**
 * The writes the analysis found to a part's own fields: by its routines, at creation, and by other parts through a
 * link. Each keeps its routine, value, condition and proof. This lists sources; it does not prove there are no others.
 */
function producersOf(
  report: BehaviourReport,
  part: PartBehaviour,
  fields: { object: string; offset: number; width: number }[],
): NonNullable<NonNullable<BehaviourWalk["stop"]>["producers"]> {
  const offsets = new Set(fields.filter((field) => field.object === "part").map((field) => field.offset));
  const found = new Map<string, NonNullable<NonNullable<BehaviourWalk["stop"]>["producers"]>[number]>();
  const add = (item: NonNullable<NonNullable<BehaviourWalk["stop"]>["producers"]>[number]) => {
    const key = JSON.stringify([item.source, item.offset, item.value, item.condition]);
    if (!found.has(key)) found.set(key, item);
  };
  for (const callback of part.routines) {
    const routine = report.routines.find((item) => item.address === callback.address);
    const role = callback.role.replace(/ callback candidate$/, "");
    for (const outcome of routine?.outcomes ?? [])
      for (const write of outcome.fields)
        if (write.object === "part" && offsets.has(write.offset))
          add({
            source: role,
            routine: callback.address,
            offset: write.offset,
            value: write.value,
            condition: outcome.condition,
            confidence: write.confidence,
            evidence: write.evidence,
            assumptions: write.assumptions,
          });
  }
  for (const creation of (report.creation ?? []).filter((item) => item.partType === part.type))
    for (const field of creation.fields)
      if (offsets.has(field.offset))
        add({
          source: "creation",
          routine: creation.routine,
          offset: field.offset,
          value: { kind: "constant", value: field.value, width: field.width },
          confidence: field.confidence,
          evidence: field.evidence,
          assumptions: field.assumptions,
        });
  for (const effect of report.relatedObjectEffects ?? [])
    if ((effect.targetType === undefined || effect.targetType === part.type) && offsets.has(effect.write.offset))
      add({
        source: effect.sourcePart,
        routine: effect.write.routine,
        offset: effect.write.offset,
        value: effect.write.value,
        condition: effect.write.condition,
        confidence: effect.confidence,
        evidence: effect.evidence,
        assumptions: effect.assumptions,
      });
  return [...found.values()];
}
function unknownFields(
  expressions: Expression[],
  bindings: Bindings,
): { object: string; offset: number; width: number }[] {
  const fields = new Map<string, { object: string; offset: number; width: number }>();
  const visit = (expression: Expression) => {
    if (expression.kind === "field" && !expression.unresolved && !known(valueOf(expression, bindings)))
      fields.set(`${expression.object}:${expression.offset}:${expression.width}`, expression);
    if (expression.kind === "binary") {
      visit(expression.left);
      visit(expression.right);
    }
  };
  expressions.forEach(visit);
  return [...fields.values()];
}
function stoppingEvidence(rules: Transition[], expressions: Expression[] = []): Evidence[] {
  const all = evidence(...rules.map((rule) => rule.evidence));
  const addresses = new Set<number>();
  const scan = (expression: Expression) => {
    if (expression.kind === "unknown")
      for (const match of expression.reason.matchAll(/0x([0-9a-f]+)/gi)) addresses.add(Number.parseInt(match[1]!, 16));
    if (expression.kind === "binary") {
      scan(expression.left);
      scan(expression.right);
    }
  };
  expressions.forEach(scan);
  const specific = all.filter((item) => addresses.has(item.address));
  return specific.length ? specific : all.filter((item) => /^(call|cmp|test|j[a-z]+|loop)/.test(item.text));
}

/**
 * Applies only the extracted return rules to known field expressions. Inputs must be backed by their own
 * findings. Unknown guards, unknown destinations and incompatible outcomes stop the walk immediately.
 */
export function walkBehaviourRules(
  report: BehaviourReport,
  partType: number,
  seed: KnownField[],
  options: {
    maxRunCalls?: number;
    condition?: Predicate;
    branchDepth?: number;
    /**
     * The states the walks of one tree have followed, shared by its branches: by known fields, the frame each was at
     * and the tests it knew there.
     */
    explored?: Explored;
    /** A starting frame a level can save: it shows its own path, so it doesn't join another branch at its start. */
    levelStart?: boolean;
    /** A case in the middle of a run, like an input case: it can start on any frame the part shows, not only a level's. */
    midRun?: boolean;
  } = {},
): BehaviourWalk {
  const explored: Explored = options.explored ?? { states: new Map(), size: 0 };
  const part = report.parts.find((item) => item.type === partType);
  if (!part) throw new Error(`No behaviour for part type ${partType}`);
  const stateOffset = stateOffsetOf(report);
  const callback = part.routines.find((item) => item.slot === 1);
  const routine = report.routines.find((item) => item.address === callback?.address);
  const rules = (part.transitions as WithUpdates[]).filter((item) => item.routine === callback?.address);
  const definitions = fieldDefinitions(report, part);
  for (const field of seed)
    if (
      !definitions.some(
        (item) => item.object === field.object && item.offset === field.offset && item.width === field.width,
      )
    )
      definitions.push(field);
  let bindings = bindingsOf(seed);
  let constraints = options.condition ? predicateTerms(options.condition).filter(inputPredicate) : [];
  const states: number[] = [];
  const proofs: Finding[] = [finding(seed)];
  let proof = finding(seed, ["No external field write or other callback occurs between these run invocations."]);
  const base = (status: BehaviourWalk["status"], reason?: string, loopStart?: number): BehaviourWalk => ({
    status,
    states,
    frames: visits(states, proofs, part),
    runCalls: Math.max(0, states.length - 1),
    fields: fieldsOf(bindings, definitions, proof),
    ...proof,
    ...(reason ? { reason } : {}),
    ...(loopStart === undefined ? {} : { loopStart }),
    timingReason:
      "Run invocations are counted. One run invocation per game step has not been proved, so gameSteps is absent.",
  });
  if (stateOffset === undefined)
    return { ...base("unresolved", "The state field was not established."), confidence: "unresolved" };
  /**
   * The starting states a seed allows, each walked as its own case; no value is preferred. When the seed fixes all
   * but at most three bits, they are those bits' combinations that have a frame. When it fixes none, and the part
   * shows its state as one of at most 32 frames, they are its frames. When it fixes some bits of such a part's
   * state, they are the frames whose number has those bits.
   */
  const possibleStates = (partial: Bits): { condition: Predicate; walk: BehaviourWalk }[] | undefined => {
    const depth = explored.size >= BRANCH_BUDGET ? 0 : (options.branchDepth ?? BRANCH_DEPTH);
    const open = ~partial.mask & 0xffff;
    const openBits = [...Array(16).keys()].filter((bit) => open & (1 << bit));
    const frameCount = (part as WithFrameCount).frameCount;
    if (!openBits.length || depth <= 0) return undefined;
    // A part drawn by its own code has no frame list; a decided assumption can give the frames a level starts it on.
    const levelFrames = !partial.mask && !frameCount ? LEVEL_FRAMES.get(part.id) : undefined;
    // A part with a few frames can only be on one of them: each one whose number has the known bits is followed.
    const framed = frameCount !== undefined && frameCount > 1 && frameCount <= 32;
    if (!framed && !levelFrames && (!partial.mask || openBits.length > 3)) return undefined;
    const values = levelFrames
      ? options.midRun
        ? (levelFrames.shown ?? levelFrames.frames)
        : levelFrames.frames
      : framed
        ? [...Array(frameCount).keys()].filter((value) => (value & partial.mask) === (partial.value & partial.mask))
        : [...Array(1 << openBits.length).keys()]
            .map((choice) =>
              openBits.reduce(
                (value, bit, n) => (choice & (1 << n) ? value | (1 << bit) : value),
                partial.value & partial.mask,
              ),
            )
            .filter((value) => frameCount === undefined || frameCount === 0 || value < frameCount);
    // A decided assumption can rule out some starting states, like the monkey bike's pedalling frames.
    const seededWith = (value: number) => {
      const seeded = new Map(bindings);
      writeField(seeded, "part", stateOffset, bits(value, 0xffff, 16));
      return seeded;
    };
    const excluded = [
      ...new Set(values.flatMap((value) => impossibleState(part, stateOffset, seededWith(value)) ?? [])),
    ];
    // A frame the walk's own condition rules out, like a callback's test of the frame, isn't followed either. When
    // that leaves one frame, it is still followed as the one way.
    const possible = values.filter(
      (value) => predicateOf({ kind: "and", terms: constraints }, seededWith(value)) !== false,
    );
    const allowed = possible.filter((value) => !impossibleState(part, stateOffset, seededWith(value)));
    if (allowed.length < (possible.length < values.length ? 1 : 2)) return undefined;
    if (excluded.length || levelFrames)
      proof = finding([proof], [...excluded, ...(levelFrames ? [levelFrames.assumption] : [])]);
    return allowed.map((value) => {
      const condition: Predicate = {
        kind: "compare",
        operator: "==",
        left: { kind: "field", object: "part", offset: stateOffset, width: 16 },
        right: { kind: "constant", value, width: 16 },
        signed: false,
      };
      const seeded = seededWith(value);
      const walk = walkBehaviourRules(report, partType, fieldsOf(seeded, definitions, proof), {
        maxRunCalls: options.maxRunCalls,
        condition: { kind: "and", terms: [...constraints, condition] },
        branchDepth: depth - 1,
        explored,
        levelStart: true,
      });
      return { condition, walk };
    });
  };
  /** The plain numbers the writers found give the one unknown part field, when there are a few. */
  const producedValues = (
    fields: { object: string; offset: number; width: number }[],
    producers: NonNullable<NonNullable<BehaviourWalk["stop"]>["producers"]>,
  ): number[] | undefined => {
    const [field] = fields;
    if (fields.length !== 1 || field!.object !== "part") return undefined;
    const mask = field!.width === 8 ? 0xff : 0xffff;
    const values = [
      ...new Set(
        producers.flatMap((producer) =>
          producer.offset === field!.offset && producer.value.kind === "constant" ? [producer.value.value & mask] : [],
        ),
      ),
    ].sort((a, b) => a - b);
    return values.length >= 1 && values.length <= 6 ? values : undefined;
  };
  /**
   * When the next state depends on a part field the walk doesn't know, but the writers found give it a few plain
   * numbers, each number is followed as its own conditional walk from this frame. The writers aren't proved to be all
   * of them, so a last branch keeps the stop for any other value.
   */
  const valueBranches = (
    fields: { object: string; offset: number; width: number }[],
    producers: NonNullable<NonNullable<BehaviourWalk["stop"]>["producers"]>,
    run: number,
  ): { condition: Predicate; walk: BehaviourWalk }[] | undefined => {
    const depth = explored.size >= BRANCH_BUDGET ? 0 : (options.branchDepth ?? BRANCH_DEPTH);
    const decided = fields.length === 1 ? decidedValues(part, fields[0]!) : undefined;
    const values = decided?.values ?? producedValues(fields, producers);
    if (!values || depth <= 0) return undefined;
    const field = fields[0]!;
    const seededWith = (value: number) => {
      const seeded = new Map(bindings);
      writeField(seeded, "part", field.offset, bits(value, field.width === 8 ? 0xff : 0xffff, field.width));
      return seeded;
    };
    // A value the walk's own tests rule out isn't followed, nor one a decided assumption rules out, like tipping the
    // teeter-totter past an end.
    const possible = values.filter(
      (value) => predicateOf({ kind: "and", terms: constraints }, seededWith(value)) !== false,
    );
    const excluded = [
      ...new Set(possible.flatMap((value) => impossibleState(part, stateOffset, seededWith(value)) ?? [])),
    ];
    const allowed = possible.filter((value) => !impossibleState(part, stateOffset, seededWith(value)));
    if (!allowed.length) return undefined;
    if (excluded.length || decided) proof = finding([proof], [...excluded, ...(decided ? [decided.assumption] : [])]);
    return allowed.map((value) => {
      const condition: Predicate = {
        kind: "compare",
        operator: "==",
        left: { kind: "field", object: "part", offset: field.offset, width: field.width },
        right: { kind: "constant", value, width: field.width },
        signed: false,
      };
      const seeded = seededWith(value);
      // The branch carries the field it sets, also when the walk doesn't track it otherwise.
      const carried = definitions.some(
        (d) => d.object === "part" && d.offset === field.offset && d.width === field.width,
      )
        ? definitions
        : [...definitions, { object: "part", offset: field.offset, width: field.width }];
      const walk = walkBehaviourRules(report, partType, fieldsOf(seeded, carried, proof), {
        maxRunCalls: Math.max(1, (options.maxRunCalls ?? 256) - run - 1),
        condition: { kind: "and", terms: [...constraints, condition] },
        branchDepth: depth - 1,
        explored,
      });
      return { condition, walk };
    });
  };
  /** The branch for any value the writers found don't give: the walk stops there as before. */
  const otherValue = (
    field: { object: string; offset: number; width: number },
    producers: NonNullable<NonNullable<BehaviourWalk["stop"]>["producers"]>,
    stopped: BehaviourWalk,
  ): { condition: Predicate; walk: BehaviourWalk } => ({
    condition: {
      kind: "and",
      terms: producedValues([field], producers)!.map((value) => ({
        kind: "compare",
        operator: "!=",
        left: { kind: "field", object: "part", offset: field.offset, width: field.width },
        right: { kind: "constant", value, width: field.width },
        signed: false,
      })),
    },
    walk: stopped,
  });
  /**
   * Follows each way an unknown input chooses between, as its own conditional walk. Only plain comparisons of input
   * fields may decide; the deciding terms then hold for the rest of that branch, as far as its own writes keep them.
   * Rules that lead to the same next fields are one way: its condition is what they all test, and any one of their own
   * remaining tests may hold. When a value the walk can't name, like whether the game could make a new part, also
   * decides, it may only choose between rules that lead to the same frame: then rules that lead to the same frame are
   * one way, with the fields they agree on, as long as what they all test is plain and rules out every other way.
   */
  const branchesAt = (
    outcomes: { rule: WithUpdates; next: Bindings; destination: ReturnType<typeof valueOf> }[],
    guards: WithUpdates[],
    run: number,
  ): { condition: Predicate; alternatives?: Predicate[]; walk: BehaviourWalk }[] | undefined => {
    const depth = explored.size >= BRANCH_BUDGET ? 0 : (options.branchDepth ?? BRANCH_DEPTH);
    if (!guards.length || depth <= 0) return undefined;
    const deciding = guards
      .flatMap((rule) => predicateTerms(rule.condition))
      .filter((term) => predicateOf(term, bindings, constraints) === undefined);
    // Input fields and values the run itself computed may decide. Only input tests carry over into later runs; the
    // next run computes its own values again.
    const plain = (term: Predicate) => inputPredicate(term) || runValuePredicate(term);
    if (!deciding.length) return undefined;
    const byFrame = !deciding.every(plain);
    const ways = new Map<string, { rules: WithUpdates[]; next: Bindings; nexts: Bindings[]; kept: Predicate[][] }>();
    const excluded = new Set<string>();
    for (const outcome of outcomes) {
      const { rule } = outcome;
      // Within this branch the rule's condition holds, so a part field it tests for one number has that number before
      // the step; the step and the next frame are worked out again with it, like a counter that counts down.
      const pre = withEqualities(bindings, rule.condition);
      // A way that starts from a state a decided assumption rules out isn't followed.
      const ruledOut = impossibleState(part, stateOffset, pre);
      if (ruledOut) {
        excluded.add(ruledOut);
        continue;
      }
      let next = outcome.next;
      if (pre !== bindings) {
        next = ruleBindings(rule, pre, routine);
        writeField(next, "part", stateOffset, valueOf(rule.to, pre));
      }
      const kept = retainConstraints(
        completeRuleEffects(rule, routine)
          ? [...constraints, ...predicateTerms(rule.condition).filter(inputPredicate)]
          : [],
        rule.updates ?? routine?.writes ?? [],
        stateOffset,
        rule.to,
      );
      const frame = readField(next, "part", stateOffset, 16);
      if (byFrame && !known(frame)) return undefined;
      const key = byFrame ? String(frame.value) : signature(next);
      const way = ways.get(key);
      if (way) {
        way.rules.push(rule);
        way.nexts.push(next);
        way.kept.push(kept);
      } else ways.set(key, { rules: [rule], next, nexts: [next], kept: [kept] });
    }
    // With ways ruled out, the one left is still followed as a branch of its own.
    if (ways.size < (excluded.size ? 1 : 2) || ways.size > BRANCH_WAYS) return undefined;
    if (byFrame) {
      // What the rules of one frame all test must be plain, and must rule out every other frame's rules; the value
      // the walk can't name then only chooses between rules that lead to that frame.
      const tests = [...ways.values()].map(({ rules }) => shared(rules.map((rule) => predicateTerms(rule.condition))));
      if (
        tests.some(
          (terms) => !terms.every((term) => predicateOf(term, bindings, constraints) !== undefined || plain(term)),
        )
      )
        return undefined;
      const separated = tests.every((terms, n) =>
        tests.every(
          (others, m) =>
            m === n || terms.some((term) => predicateOf(term, bindings, [...constraints, ...others]) === false),
        ),
      );
      if (!separated) return undefined;
      for (const way of ways.values()) way.next = agreedBindings(way.nexts);
    }
    if (excluded.size) proof = finding([proof], [...excluded]);
    return [...ways.values()].map(({ rules, next, kept }) => {
      const wayProof = finding(
        [proof, ...rules],
        byFrame && rules.length > 1
          ? ["The rules that apply here lead to the same next frame; the fields they set differently are forgotten."]
          : [],
      );
      const walk = walkBehaviourRules(report, partType, fieldsOf(next, definitions, wayProof), {
        maxRunCalls: Math.max(1, (options.maxRunCalls ?? 256) - run - 1),
        condition: { kind: "and", terms: shared(kept) },
        branchDepth: depth - 1,
        explored,
      });
      if (rules.length === 1) return { condition: rules[0]!.condition, walk };
      const common = shared(rules.map((rule) => predicateTerms(rule.condition)));
      const commonText = new Set(common.map(textOf));
      const alternatives = rules.map((rule): Predicate => ({
        kind: "and",
        terms: predicateTerms(rule.condition).filter((term) => !commonText.has(textOf(term))),
      }));
      const unique = [...new Map(alternatives.map((item) => [textOf(item), item])).values()];
      return { condition: { kind: "and", terms: common }, alternatives: unique, walk };
    });
  };
  /**
   * Without a known starting frame, the rules can still decide the next one: when every rule that can apply covers all
   * of the run's paths, starts from any frame, and gives a known next frame under its own condition, each way is
   * followed like a branch. Like the pinball bumper, which goes to frame 1 when hit and to frame 0 otherwise.
   */
  const nextFromAnyFrame = () => {
    const candidates = rules.filter((rule) => predicateOf(rule.condition, bindings, constraints) !== false);
    if (
      !candidates.length ||
      candidates.some((rule) => rule.from !== null || rule.confidence === "unresolved") ||
      !guardCoverage(candidates, bindings, constraints, routine)
    )
      return undefined;
    const outcomes = candidates.map((rule) => {
      const pre = withEqualities(bindings, rule.condition);
      const next = ruleBindings(rule, pre, routine);
      const destination = valueOf(rule.to, pre);
      writeField(next, "part", stateOffset, destination);
      return { rule, next, destination };
    });
    if (outcomes.some((outcome) => !known(outcome.destination))) return undefined;
    if (outcomes.length > 1) return branchesAt(outcomes, candidates, 0);
    // One rule covers every path, like a bumper that was hit: the walk goes on from the frame it gives.
    const [{ rule, next }] = outcomes as [(typeof outcomes)[number]];
    const depth = explored.size >= BRANCH_BUDGET ? 0 : (options.branchDepth ?? BRANCH_DEPTH);
    if (depth <= 0) return undefined;
    const kept = retainConstraints(
      completeRuleEffects(rule, routine)
        ? [...constraints, ...predicateTerms(rule.condition).filter(inputPredicate)]
        : [],
      rule.updates ?? routine?.writes ?? [],
      stateOffset,
      rule.to,
    );
    const walk = walkBehaviourRules(report, partType, fieldsOf(next, definitions, finding([proof, rule])), {
      maxRunCalls: Math.max(1, (options.maxRunCalls ?? 256) - 1),
      condition: { kind: "and", terms: kept },
      branchDepth: depth - 1,
      explored,
    });
    return [{ condition: rule.condition, walk }];
  };
  /**
   * A rule whose only unresolved parts are written field values still fixes the state path when the routine's analysis
   * covers every path with complete effects: those fields are forgotten, and its destination and guard are exact.
   */
  const settledRoutine =
    !!routine &&
    (routine.uncertainties ?? []).length === 0 &&
    !!routine.outcomes?.length &&
    ((routine.uncertainEffects !== true && routine.outcomes.every((outcome) => outcome.effectsComplete === true)) ||
      // A helper that keeps the state but not the other fields still fixes the state path. Such a rule's effects are
      // incomplete, so the walk forgets every other field after it.
      (routine.returnPathsComplete === true &&
        routine.outcomes.every((outcome) => outcome.effectsComplete === true || outcome.keepsState === true)));
  // A guard may test a field the same run rewrote, like the result of a contact scan: that decides between exact
  // rules. An opaque unknown in a guard, or anything unknown in the destination, still stops the walk.
  const settledPath = (rule: WithUpdates) =>
    settledRoutine && !containsUnknown(rule.to) && !containsUnknown(rule.condition, false);
  const pathFinding = (rule: WithUpdates): Finding =>
    rule.confidence === "unresolved" && settledPath(rule)
      ? {
          confidence: "inferred",
          evidence: rule.evidence,
          assumptions: [
            ...rule.assumptions,
            "Fields this rule writes with unresolved values are forgotten; its destination and guard do not depend on them.",
          ],
        }
      : rule;
  const identity = (expression: Expression) =>
    expression.kind === "field" &&
    expression.object === "part" &&
    expression.offset === stateOffset &&
    !expression.unresolved;
  /**
   * While the state is unknown: the rules that may apply, when every one keeps the state, with what the walk knows
   * after one run. It is stable when each rule keeps at least what the walk knows, so every later run has these rules
   * or fewer to choose from.
   */
  const keptState = (fields: Bindings, tests: Predicate[]) => {
    const candidates = rules.filter((rule) => predicateOf(rule.condition, fields, tests) !== false);
    const domains = new Set(
      candidates.map((rule) =>
        rule.from === null ? "all" : JSON.stringify([...rule.from].sort((left, right) => left - right)),
      ),
    );
    if (
      !candidates.length ||
      domains.size !== 1 ||
      !guardCoverage(candidates, fields, tests, routine) ||
      !candidates.every((rule) => (rule.confidence !== "unresolved" || settledPath(rule)) && identity(rule.to))
    )
      return undefined;
    const nexts = candidates.map((rule) => ({
      next: ruleBindings(rule, fields, routine),
      kept: retainConstraints(
        completeRuleEffects(rule, routine) ? tests : [],
        rule.updates ?? routine?.writes ?? [],
        stateOffset,
        rule.to,
      ),
    }));
    const texts = tests.map(textOf);
    const stable = nexts.every(
      ({ next, kept }) => knowsAll(next, fields) && texts.every((text) => kept.some((term) => textOf(term) === text)),
    );
    const later = intersect(nexts.map(({ next }) => next));
    const kept = nexts[0]!.kept.filter((term) =>
      nexts.every(({ kept }) => kept.some((other) => textOf(other) === textOf(term))),
    );
    return { candidates, stable, later, kept };
  };
  const state = readField(bindings, "part", stateOffset, 16);
  if (!known(state)) {
    let held = keptState(bindings, constraints);
    let runCalls = 1;
    // A rule with incomplete effects forgets the other fields first. The walk then knows at most what every rule
    // leaves known, with the same state, so a hold from there one run later holds from here too.
    if (held && !held.stable && knowsAll(bindings, held.later) && signature(held.later) !== signature(bindings)) {
      const after = keptState(held.later, held.kept);
      if (after?.stable) {
        proof = finding([proof, ...held.candidates.map(pathFinding)]);
        bindings = held.later;
        constraints = held.kept;
        held = after;
        runCalls = 2;
      }
    }
    if (held?.stable) {
      const { candidates } = held;
      proof = finding(
        [proof, ...candidates.map(pathFinding)],
        [
          "The rule preserves any initial state in its stated source domain; no numeric starting state has been chosen.",
        ],
      );
      const allowedStates = candidates.some((rule) => rule.from === null)
        ? undefined
        : [...new Set(candidates.flatMap((rule) => rule.from ?? []))];
      return {
        ...base("rest"),
        runCalls,
        parameterised: {
          kind: "hold",
          state: { kind: "field", object: "part", offset: stateOffset, width: 16 },
          ...(allowedStates ? { allowedStates } : {}),
        },
      };
    }
    const levelStates = possibleStates(state);
    if (levelStates)
      return {
        ...base("unresolved", "The seed does not establish the state. No state zero is assumed."),
        confidence: "unresolved",
        stop: {
          kind: "state",
          description:
            "The seed fixes only some bits of the state, as when the level saves the starting frame. Each value those bits allow is followed separately.",
          evidence: [],
          branches: levelStates,
        },
      };
    const fromAnyFrame = nextFromAnyFrame();
    return {
      ...base("unresolved", "The seed does not establish the state. No state zero is assumed."),
      confidence: "unresolved",
      ...(fromAnyFrame
        ? {
            stop: {
              kind: "state" as const,
              description:
                "The starting frame isn't known, but every rule that can apply gives a known next frame. Each way is followed separately.",
              evidence: [],
              branches: fromAnyFrame,
            },
          }
        : {}),
    };
  }
  states.push(state.value);
  /** The finding of one step under these rules, worked out once per set of rules: walks take the same steps often. */
  const stepFinding = (candidates: WithUpdates[]): Finding => {
    let cache = stepFindings.get(part);
    if (!cache)
      stepFindings.set(part, (cache = { index: new Map(part.transitions.map((t, n) => [t, n])), steps: new Map() }));
    const id = candidates.map((rule) => cache.index.get(rule)).join();
    let step = cache.steps.get(id);
    if (!step) cache.steps.set(id, (step = finding(candidates.map(pathFinding))));
    return step;
  };

  const walkSignature = () => JSON.stringify([signature(bindings), constraints.map(textOf)]);
  /**
   * A state another branch of the same tree already follows, with the same known fields and no test this one doesn't
   * know too. That branch covers every way this one can go on, so this one ends there.
   */
  const joined = (): BehaviourWalk | undefined => {
    const known = new Set(constraints.map(textOf));
    const other = explored.states
      .get(signature(bindings))
      ?.find((item) => [...item.tests].every((test) => known.has(test)));
    return other
      ? base(
          "joins",
          `From frame ${other.frame} on, it continues like another branch of the same walk, which follows it from there.`,
        )
      : undefined;
  };
  const explore = () => {
    const id = signature(bindings);
    explored.size++;
    explored.states.set(id, [
      ...(explored.states.get(id) ?? []),
      { frame: states.at(-1)!, tests: new Set(constraints.map(textOf)) },
    ]);
  };
  const startId = walkSignature();
  const joinedAtStart = options.explored && !options.levelStart ? joined() : undefined;
  if (joinedAtStart) return joinedAtStart;
  explore();
  const seen = new Map([[startId, 0]]);
  const max = options.maxRunCalls ?? 256;
  for (let run = 0; run < max; run++) {
    const current = states.at(-1)!;
    const candidates = rules.filter(
      (rule) =>
        (rule.from === null || rule.from.includes(current)) &&
        predicateOf(rule.condition, bindings, constraints) !== false,
    );
    if (!candidates.length)
      return {
        ...base("unresolved", `The recovered rules do not establish a continuation from frame ${current}.`),
        confidence: "unresolved",
      };
    const unknownGuards = candidates.filter((rule) => predicateOf(rule.condition, bindings, constraints) === undefined);
    if (unknownGuards.length && !guardCoverage(candidates, bindings, constraints, routine)) {
      const guard = unknownGuards
        .flatMap((rule) => predicateTerms(rule.condition))
        .find((term) => predicateOf(term, bindings, constraints) === undefined);
      const expressions = guard?.kind === "compare" ? [guard.left, guard.right] : [];
      const subject = expressions.find((expression) => !known(valueOf(expression, bindings)));
      const description = `At frame ${current}, the next rule needs ${subject ? unknownWords(subject, report, part, bindings) : "an unresolved condition"}.`;
      return {
        ...base("unresolved", description),
        confidence: "unresolved",
        stop: {
          kind: "condition",
          description,
          evidence: stoppingEvidence(unknownGuards, expressions),
          fields: unknownFields(expressions, bindings),
        },
        evidence: evidence(proof.evidence, ...unknownGuards.map((rule) => rule.evidence)),
      };
    }
    if (candidates.some((rule) => rule.confidence === "unresolved" && !settledPath(rule))) {
      const description = `Frame ${current} reaches a call or other operation whose field effects remain unresolved.`;
      const expressions = candidates.flatMap((rule) => [
        rule.to,
        ...predicateTerms(rule.condition).flatMap((term) => (term.kind === "compare" ? [term.left, term.right] : [])),
      ]);
      return {
        ...base("unresolved", description),
        confidence: "unresolved",
        stop: {
          kind: "effects",
          description,
          evidence: stoppingEvidence(candidates, expressions),
          fields: unknownFields(expressions, bindings),
        },
        evidence: evidence(proof.evidence, ...candidates.map((item) => item.evidence)),
      };
    }
    const outcomes = candidates.map((rule) => {
      const next = ruleBindings(rule, bindings, routine);
      const destination = valueOf(rule.to, bindings);
      writeField(next, "part", stateOffset, destination);
      return { rule, next, destination };
    });
    if (outcomes.some((outcome) => !known(outcome.destination))) {
      const expression = outcomes.find((outcome) => !known(outcome.destination))!.rule.to;
      const description = `At frame ${current}, the next state depends on ${unknownWords(expression, report, part, bindings)} that is not established.`;
      const fields = unknownFields([expression], bindings);
      const producers = producersOf(report, part, fields);
      const stopped: BehaviourWalk = {
        ...base("unresolved", description),
        confidence: "unresolved",
        stop: {
          kind: "state",
          description,
          evidence: stoppingEvidence(candidates, [expression]),
          fields,
          ...(producers.length ? { producers } : {}),
        },
        evidence: evidence(proof.evidence, ...candidates.map((rule) => rule.evidence)),
      };
      const byValue = valueBranches(fields, producers, run);
      // When a decided assumption gives every number the field takes, there is no other value to stop at.
      const decided = fields.length === 1 ? decidedValues(part, fields[0]!) : undefined;
      return byValue
        ? {
            ...stopped,
            ...(decided ? { assumptions: finding([proof]).assumptions } : {}),
            stop: {
              ...stopped.stop!,
              branches: decided ? byValue : [...byValue, otherValue(fields[0]!, producers, stopped)],
            },
          }
        : stopped;
    }
    let next = outcomes[0]!;
    // Rules that all lead to the same frame need no branch: the walk goes on with what they agree on.
    const sameFrame =
      outcomes.length > 1 &&
      outcomes.every((outcome) => known(outcome.destination) && outcome.destination.value === next.destination.value);
    if (sameFrame && outcomes.some((outcome) => signature(outcome.next) !== signature(next.next))) {
      next = { ...next, next: agreedBindings(outcomes.map((outcome) => outcome.next)) };
      proof = finding(
        [proof],
        ["The rules that apply here lead to the same next frame; the fields they set differently are forgotten."],
      );
    }
    if (!sameFrame && outcomes.some((outcome) => signature(outcome.next) !== signature(next.next))) {
      const branches = branchesAt(outcomes, unknownGuards, run);
      return {
        ...base(
          "unresolved",
          unknownGuards.length
            ? "The unknown condition selects different next fields, so no branch is chosen."
            : "Applicable rules disagree on the next fields.",
        ),
        confidence: "unresolved",
        stop: {
          kind: "ambiguity",
          description: "The recorded branches have different field effects.",
          evidence: stoppingEvidence(candidates),
          fields: unknownFields(
            candidates.flatMap((rule) =>
              predicateTerms(rule.condition).flatMap((term) =>
                term.kind === "compare" ? [term.left, term.right] : [],
              ),
            ),
            bindings,
          ),
          ...(branches ? { branches } : {}),
        },
      };
    }
    if ((part as WithFrameCount).frameCount && next.destination.value >= (part as WithFrameCount).frameCount!)
      return { ...base("unresolved", "The next state has no known visible frame."), confidence: "unresolved" };
    const step = stepFinding(candidates);
    proof = finding([proof, step]);
    constraints = retainConstraints(
      candidates.every((rule) => completeRuleEffects(rule, routine)) ? constraints : [],
      candidates.flatMap((rule) => rule.updates ?? routine?.writes ?? []),
      stateOffset,
      next.rule.to,
    );
    bindings = next.next;
    states.push(next.destination.value);
    proofs.push(step);
    const id = walkSignature();
    const prior = seen.get(id);
    if (prior !== undefined) return base(prior === states.length - 2 ? "rest" : "loop", undefined, prior);
    const join = joined();
    if (join) return join;
    explore();
    seen.set(id, states.length - 1);
  }
  return { ...base("limit", `The walk reached its limit of ${max} run invocations.`), confidence: "unresolved" };
}

function stableStatesOf(report: BehaviourReport, part: PartBehaviour): StableStateDescription[] {
  const run = part.routines.find((item) => item.slot === 1);
  const stateOffset = stateOffsetOf(report);
  if (!run || stateOffset === undefined) return [];
  const initial = bindingsOf(metadataFields(report, part));
  const candidates = new Map<string, StableStateDescription>();
  for (const rule of (part.transitions as WithUpdates[]).filter((item) => item.routine === run.address)) {
    if (rule.confidence === "unresolved" || !rule.updates) continue;
    const state = valueOf(rule.to, initial);
    if (!known(state)) continue;
    const bindings = ruleBindings(
      rule,
      initial,
      report.routines.find((routine) => routine.address === run.address),
    );
    writeField(bindings, "part", stateOffset, state);
    const proof = finding(
      [rule],
      ["These fields follow a stated run outcome; they are not claimed to be the level's reset values."],
    );
    const fields = fieldsOf(bindings, fieldDefinitions(report, part), proof);
    const walk = walkBehaviourRules(report, part.type, fields, { maxRunCalls: 1 });
    if (walk.status !== "rest") continue;
    const id = signature(bindings);
    const prior = candidates.get(id);
    if (prior) {
      prior.origins.push({ condition: rule.condition, evidence: rule.evidence });
      prior.evidence = evidence(prior.evidence, rule.evidence);
    } else
      candidates.set(id, {
        state: state.value,
        frame: frameOf(part, state.value),
        fields,
        origins: [{ condition: rule.condition, evidence: rule.evidence }],
        ...finding([rule, walk], proof.assumptions),
      });
  }
  return [...candidates.values()];
}

interface InputCase extends Finding {
  fields: KnownField[];
  condition: Predicate;
}
function affineState(expression: Expression, offset: number): { scale: number; amount: number } | undefined {
  if (expression.kind === "field" && expression.object === "part" && expression.offset === offset)
    return { scale: 1, amount: 0 };
  if (expression.kind === "constant") return { scale: 0, amount: expression.value };
  if (expression.kind !== "binary" || !["+", "-"].includes(expression.operator)) return undefined;
  const left = affineState(expression.left, offset),
    right = affineState(expression.right, offset);
  if (!left || !right) return undefined;
  const sign = expression.operator === "+" ? 1 : -1;
  return { scale: left.scale + sign * right.scale, amount: left.amount + sign * right.amount };
}
function producerPartitions(
  report: BehaviourReport,
  part: PartBehaviour,
  inputs: InputCase[],
  alreadyTruncated: boolean,
): { cases: InputCase[]; truncated: boolean } {
  const stateOffset = stateOffsetOf(report);
  const typeOffset = report.layout.fields.find((field) => field.name === "type")?.offset;
  const producers = new Map<string, Map<number, FieldWrite>>();
  const remember = (write: FieldWrite) => {
    if (
      write.object !== "part" ||
      write.value.kind !== "constant" ||
      write.offset === stateOffset ||
      write.offset === typeOffset
    )
      return;
    const id = `${write.offset}:${write.width}`;
    const values = producers.get(id) ?? new Map<number, FieldWrite>();
    const value = wrap(write.value.value, write.width);
    const prior = values.get(value);
    values.set(value, prior ? { ...prior, evidence: evidence(prior.evidence, write.evidence) } : write);
    producers.set(id, values);
  };
  const ownerRoutines = new Set(part.routines.map((routine) => routine.address));
  for (const routine of report.routines)
    if (ownerRoutines.has(routine.address)) {
      for (const write of routine.writes) remember(write);
      for (const outcome of routine.outcomes ?? []) for (const write of outcome.fields) remember(write);
    }
  for (const transition of part.transitions as WithUpdates[])
    for (const write of transition.updates ?? []) remember(write);
  // Only the state-related fields a constructor sets take part in input cases; the zero words of a fresh part would
  // otherwise crowd the bounded case list without saying anything about the run guards' inputs.
  const creationRoles = new Set(["previousState", "savedState", "stateDelta", "savedStateDelta", "control", "trigger"]);
  for (const source of report.creation ?? [])
    if (source.partType === part.type)
      for (const field of source.fields.filter((item) => creationRoles.has(item.name)))
        remember({
          ...field,
          object: "part",
          value: { kind: "constant", value: field.value, width: field.width },
          routine: source.routine,
          condition: {
            kind: "unknown",
            reason: "A part of this type was successfully constructed before level overrides.",
          },
        });
  const sharedControl = report.layout.fields.find((field) => field.name === "stateDelta")?.offset;
  for (const effect of report.relatedObjectEffects) {
    if (effect.targetType === part.type) {
      remember({ ...effect.write, object: "part" });
      const source = report.routines.find((routine) => routine.address === effect.write.routine);
      for (const outcome of source?.iterationOutcomes ?? [])
        if (outcome.object === effect.write.object)
          for (const write of outcome.fields)
            if (write.object === outcome.object)
              remember({
                ...write,
                object: "part",
                assumptions: [
                  ...write.assumptions,
                  "This literal is assigned to a typed overlap-list member on a stated path, not a universal reset or a guaranteed incoming event.",
                ],
              });
    } else if (effect.targetType === undefined && effect.write.offset === sharedControl && effect.write.width === 16)
      remember({
        ...effect.write,
        object: "part",
        assumptions: [
          ...effect.write.assumptions,
          "The destination type of this shared control producer is unresolved. Its literal is used only as a conditional input value, not as proof of an incoming event for this type.",
        ],
      });
  }
  for (const context of report.lifecycle?.reset ?? []) for (const write of context.fields) remember(write);
  const result = new Map<string, InputCase>();
  let truncated = alreadyTruncated;
  const add = (input: InputCase) => {
    const id = JSON.stringify([
      signature(bindingsOf(input.fields)),
      predicateTerms(input.condition)
        .map((term) => JSON.stringify(term))
        .sort(),
    ]);
    if (result.has(id)) return;
    if (result.size >= 64) {
      truncated = true;
      return;
    }
    result.set(id, input);
  };
  for (const input of inputs) {
    add(input);
    const initial = bindingsOf(input.fields);
    if (stateOffset === undefined || !known(readField(initial, "part", stateOffset, 16))) continue;
    const pending = [input];
    const expanded = new Set<string>();
    let visits = 0;
    while (pending.length && visits++ < 64) {
      const variant = pending.shift()!;
      const variantBindings = bindingsOf(variant.fields);
      const id = JSON.stringify([
        signature(variantBindings),
        predicateTerms(variant.condition)
          .map((term) => JSON.stringify(term))
          .sort(),
      ]);
      if (expanded.has(id)) continue;
      expanded.add(id);
      const walk = walkBehaviourRules(report, part.type, variant.fields, { condition: variant.condition });
      if (walk.status === "rest" || walk.status === "loop") continue;
      const delta = report.layout.fields.find((field) => field.name === "stateDelta")?.offset;
      const dependencies = (walk.stop?.fields ?? [])
        .filter(
          (field) =>
            field.object === "part" &&
            field.offset !== stateOffset &&
            field.offset !== typeOffset &&
            !known(readField(variantBindings, field.object, field.offset, field.width)) &&
            producers.has(`${field.offset}:${field.width}`),
        )
        .sort(
          (left, right) => Number(right.offset === delta) - Number(left.offset === delta) || left.offset - right.offset,
        );
      const field = dependencies[0];
      if (!field) continue;
      const choices = [...producers.get(`${field.offset}:${field.width}`)!.entries()];
      if (choices.length > 8) truncated = true;
      for (const [value, producer] of choices.slice(0, 8)) {
        const current = readField(variantBindings, "part", field.offset, field.width);
        if (((current.value ^ value) & current.mask) !== 0) continue;
        const hypothesis: KnownField = {
          ...field,
          value,
          knownMask: full(field.width),
          ...finding(
            [variant, producer],
            [
              "This conditional parameter value is explicitly assigned by extracted code; it is not asserted to be the current reset value or an observed event.",
            ],
          ),
          confidence: "inferred",
        };
        const candidate: InputCase = {
          fields: [...variant.fields, hypothesis],
          condition: {
            kind: "and",
            terms: [
              ...predicateTerms(variant.condition),
              {
                kind: "compare",
                operator: "==",
                left: { kind: "field", object: "part", offset: field.offset, width: field.width },
                right: { kind: "constant", value, width: field.width },
                signed: false,
              },
            ],
          },
          ...finding([variant, producer]),
          confidence: "inferred",
        };
        if (predicateOf(candidate.condition, bindingsOf(candidate.fields)) === false) continue;
        add(candidate);
        pending.push(candidate);
      }
    }
    if (pending.length) truncated = true;
  }
  return { cases: [...result.values()], truncated };
}

function conditionalInputCases(
  report: BehaviourReport,
  part: PartBehaviour,
): { cases: InputCase[]; truncated: boolean } {
  const stateOffset = stateOffsetOf(report);
  const run = part.routines.find((callback) => callback.slot === 1);
  if (stateOffset === undefined || !run) return { cases: [], truncated: false };
  const metadata = metadataFields(report, part);
  const metadataBindings = bindingsOf(metadata);
  const cases = new Map<string, InputCase>();
  const literalStates = [
    ...new Set([
      ...(report.creation ?? [])
        .filter((source) => source.partType === part.type)
        .flatMap((source) => source.fields.filter((field) => field.offset === stateOffset).map((field) => field.value)),
      ...part.stateWrites
        .filter((write) => write.object === "part" && write.offset === stateOffset && write.value.kind === "constant")
        .map((write) => (write.value as Extract<Expression, { kind: "constant" }>).value),
      ...part.transitions
        .filter((rule) => rule.to.kind === "constant")
        .map((rule) => (rule.to as Extract<Expression, { kind: "constant" }>).value),
    ]),
  ];
  const maxCases = 64;
  for (const rule of part.transitions.filter((rule) => rule.routine === run.address)) {
    const terms = predicateTerms(rule.condition).filter(inputPredicate);
    if (!terms.length) continue;
    const condition: Predicate = { kind: "and", terms };
    if (predicateOf(condition, metadataBindings) === false) continue;
    const proof: Finding = {
      ...finding(
        [rule],
        [
          "This is a conditional input case stated by the run code, not a claim that a reset or an external event supplies these values.",
        ],
      ),
      confidence: "inferred",
    };
    const equalities: KnownField[] = [];
    let exactState: number | undefined;
    let low = 0,
      high = 0xffff,
      bounded = false;
    for (const term of terms) {
      if (term.kind !== "compare" || term.right.kind !== "constant") continue;
      if (term.left.kind === "field" && term.left.object === "part") {
        const field = term.left;
        if (term.operator === "==")
          equalities.push({
            object: field.object,
            offset: field.offset,
            width: field.width,
            value: wrap(term.right.value, field.width),
            knownMask: full(field.width),
            ...proof,
          });
        if (field.offset === stateOffset) {
          const value = term.signed
            ? signed(wrap(term.right.value, field.width), field.width)
            : wrap(term.right.value, field.width);
          if (term.operator === "==") exactState = wrap(value, field.width);
          if (term.operator === "<" || term.operator === "<=") {
            high = Math.min(high, value - (term.operator === "<" ? 1 : 0));
            bounded = true;
          }
          if (term.operator === ">" || term.operator === ">=")
            low = Math.max(low, value + (term.operator === ">" ? 1 : 0));
        }
      }
      if (term.operator === "==") {
        const affine = affineState(term.left, stateOffset);
        if (affine?.scale === 1) exactState = wrap(term.right.value - affine.amount, term.left.width);
      }
      if (term.left.kind === "binary" && term.left.operator === "&") {
        const field = term.left.left.kind === "field" ? term.left.left : term.left.right;
        const mask = term.left.left.kind === "constant" ? term.left.left : term.left.right;
        if (field.kind === "field" && field.object === "part" && mask.kind === "constant") {
          const maskedEquality = term.operator === "==" && (term.right.value & ~mask.value) === 0;
          const oneBitNonzero =
            term.operator === "!=" && term.right.value === 0 && mask.value > 0 && (mask.value & (mask.value - 1)) === 0;
          if (maskedEquality || oneBitNonzero)
            equalities.push({
              object: "part",
              offset: field.offset,
              width: field.width,
              value: oneBitNonzero ? mask.value : term.right.value,
              knownMask: mask.value,
              ...proof,
            });
        }
      }
    }
    const values =
      exactState !== undefined
        ? [exactState]
        : bounded && low >= 0 && high >= low && high - low < maxCases
          ? Array.from({ length: high - low + 1 }, (_, index) => low + index)
          : literalStates;
    if (exactState === undefined) {
      const fields = [...metadata, ...equalities];
      const bindings = bindingsOf(fields);
      if (predicateOf(condition, bindings) !== false) {
        const id = JSON.stringify([signature(bindings), terms.map((term) => JSON.stringify(term)).sort()]);
        if (!cases.has(id)) {
          if (cases.size >= maxCases) return producerPartitions(report, part, [...cases.values()], true);
          cases.set(id, { fields, condition, ...proof });
        }
      }
    }
    for (const value of values) {
      if ((part as WithFrameCount).frameCount && value >= (part as WithFrameCount).frameCount!) continue;
      const state: KnownField = { object: "part", offset: stateOffset, width: 16, value, knownMask: 0xffff, ...proof };
      const fields = [...metadata, ...equalities, state];
      const bindings = bindingsOf(fields);
      if (predicateOf(condition, bindings) === false) continue;
      const caseCondition: Predicate = {
        kind: "and",
        terms: [
          ...terms,
          {
            kind: "compare",
            operator: "==",
            left: { kind: "field", object: "part", offset: stateOffset, width: 16 },
            right: { kind: "constant", value, width: 16 },
            signed: false,
          },
        ],
      };
      const id = JSON.stringify([signature(bindings), terms.map((term) => JSON.stringify(term)).sort()]);
      const prior = cases.get(id);
      if (prior) {
        prior.evidence = evidence(prior.evidence, rule.evidence);
        continue;
      }
      if (cases.size >= maxCases) return producerPartitions(report, part, [...cases.values()], true);
      cases.set(id, { fields, condition: caseCondition, ...proof });
    }
  }
  return producerPartitions(report, part, [...cases.values()], false);
}

function remapExpression(expression: Expression, target: string, sourceType: number): Expression {
  if (expression.kind === "field")
    return {
      ...expression,
      object:
        expression.object === target
          ? "part"
          : expression.object === "part"
            ? `source-type-${sourceType}`
            : expression.object,
    };
  if (expression.kind === "binary")
    return {
      ...expression,
      left: remapExpression(expression.left, target, sourceType),
      right: remapExpression(expression.right, target, sourceType),
    };
  if (expression.kind === "table")
    return { ...expression, index: remapExpression(expression.index, target, sourceType) };
  return expression;
}
function remapPredicate(predicate: Predicate, target: string, sourceType: number): Predicate {
  if (predicate.kind === "compare")
    return {
      ...predicate,
      left: remapExpression(predicate.left, target, sourceType),
      right: remapExpression(predicate.right, target, sourceType),
    };
  if (predicate.kind === "and")
    return { ...predicate, terms: predicate.terms.map((term) => remapPredicate(term, target, sourceType)) };
  return predicate;
}

function fieldEffectWords(write: FieldWrite, report: BehaviourReport, other = false): string {
  if (write.object.startsWith("outline storage of a listed part at "))
    return "May update the outline coordinates of a part in the overlap list.";
  const name = report.layout.fields.find((field) => field.offset === write.offset)?.name;
  const subject = write.object.startsWith("a listed part at ")
    ? "a listed part's"
    : other
      ? "another part's"
      : "the part's";
  if (name === "state")
    return write.value.kind === "constant"
      ? `Selects state ${write.value.value}${other ? " on another part" : ""}.`
      : `Updates ${subject} selected state.`;
  if (name === "stateDelta") return `Updates ${subject} value that advances the animation state.`;
  if (name === "drawingFlags") {
    const flags = valueOf(write.value, new Map());
    const changes =
      report.layout.fields
        .find((field) => field.offset === write.offset)
        ?.masks?.flatMap((mask) => {
          if ((flags.mask & mask.value) !== mask.value) return [];
          const set = (flags.value & mask.value) === mask.value;
          if (mask.name === "hidden")
            return [set ? `Hides ${subject} frame on this path.` : `Allows ${subject} frame to be drawn on this path.`];
          if (mask.name === "horizontalFlip")
            return [
              set
                ? `Reflects ${subject} frame horizontally on this path.`
                : `Clears ${subject} horizontal reflection on this path.`,
            ];
          if (mask.name === "verticalFlip")
            return [
              set
                ? `Reflects ${subject} frame vertically on this path.`
                : `Clears ${subject} vertical reflection on this path.`,
            ];
          return [];
        }) ?? [];
    return changes.length
      ? changes.join(" ")
      : `Updates ${subject} drawing flags; the complete visual change is not established.`;
  }
  if (name === "frameWidth" || name === "frameHeight") return `Updates ${subject} current frame dimensions.`;
  if (name === "horizontalExtent" || name === "verticalExtent" || name === "baseWidth" || name === "baseHeight")
    return `Updates ${subject} stored dimensions.`;
  if (name === "drawX" || name === "drawY") return `Updates where ${other ? "another part's" : "the"} frame is drawn.`;
  if (name === "positionX" || name === "positionY") return `Updates ${subject} position.`;
  if (name === "velocityX" || name === "velocityY") return `Updates ${subject} motion.`;
  if (name === "contactPart" || name === "contactAngle" || name === "contactEdge")
    return `Updates ${subject} contact information.`;
  return `Updates ${subject} part-specific field; its complete meaning remains unresolved.`;
}
function inputConditionWords(predicate: Predicate, report: BehaviourReport, part: PartBehaviour): string {
  const nameOf = (expression: Expression) =>
    expression.kind === "field" && expression.object === "part"
      ? report.layout.fields.find((field) => field.offset === expression.offset)?.name
      : undefined;
  const fieldName = (expression: Expression): string => {
    if (expression.kind === "constant") return String(expression.value);
    if (expression.kind === "unknown") return "an unresolved result";
    if (expression.kind === "table") return "a selected table value";
    if (expression.kind === "binary") {
      const name = nameOf(expression.left);
      const leftField = expression.left.kind === "field" ? expression.left : undefined;
      if (name === "state" && expression.right.kind === "constant" && expression.right.value === 1)
        return expression.operator === "+" ? "the incremented state" : "the decremented state";
      if (name === "state" && nameOf(expression.right) === "stateDelta")
        return "the state after applying the control value";
      if (
        (name === "contextCounter" ||
          (leftField && part.counters.some((counter) => counter.offset === leftField.offset))) &&
        expression.right.kind === "constant" &&
        expression.right.value === 1
      )
        return expression.operator === "+" ? "the increased counter" : "the decreased counter";
      return "the recorded calculation";
    }
    const name = nameOf(expression);
    if (
      part.derivedValues?.some(
        (value) => value.value.object === expression.object && value.value.offset === expression.offset,
      )
    )
      return "the connection-conflict result";
    if (expression.object === "address of part") return "the part's address";
    if (expression.object !== "part") return "a linked object's recorded value";
    if (name === "state") return "the frame";
    if (name === "stateDelta") return "the state-control value";
    if (name === "drawingFlags") return "the drawing flags";
    if (name === "previousState" || name === "olderState") return "the previous-state value";
    if (name === "contextCounter" || part.counters.some((counter) => counter.offset === expression.offset))
      return "the part-specific counter";
    if (name && /position|draw|extent|width|height/i.test(name)) return "a position or size value";
    return "a part-specific value";
  };
  const terms = predicateTerms(predicate);
  const facts = bindingsOf(metadataFields(report, part));
  for (const term of terms)
    if (
      term.kind === "compare" &&
      term.operator === "==" &&
      term.left.kind === "field" &&
      term.left.object === "part" &&
      term.right.kind === "constant"
    )
      writeField(facts, "part", term.left.offset, bits(term.right.value, full(term.left.width), term.left.width));
  const labels = terms.flatMap((term) => {
    if (predicateWithoutConstraints(term, new Map()) === true) return [];
    if (term.kind !== "compare") return [{ text: "the other recorded checks succeed", priority: 8 }];
    const exact = term.operator === "==" && term.left.kind === "field" && term.right.kind === "constant";
    if (!exact && predicateWithoutConstraints(term, facts) === true) return [];
    const leftName = nameOf(term.left);
    const operators: Record<string, string> = {
      "==": "is",
      "!=": "is not",
      "<": "is below",
      "<=": "is at most",
      ">": "is above",
      ">=": "is at least",
    };
    const right =
      term.right.kind === "constant" && (term.signed || leftName === "stateDelta")
        ? String(signed(wrap(term.right.value, term.left.width), term.left.width))
        : fieldName(term.right);
    if (
      term.left.kind === "binary" &&
      term.left.operator === "&" &&
      term.right.kind === "constant" &&
      term.right.value === 0
    ) {
      const operand = term.left.left.kind === "field" ? term.left.left : term.left.right;
      const mask = term.left.left.kind === "constant" ? term.left.left : term.left.right;
      if (operand.kind === "field" && mask.kind === "constant") {
        const name = report.layout.fields
          .find((field) => field.offset === operand.offset)
          ?.masks?.find((field) => field.value === mask.value)?.name;
        const on = term.operator === "!=";
        if (name === "horizontalFlip")
          return [{ text: `the part is ${on ? "" : "not "}horizontally reflected`, priority: 4 }];
        if (name === "verticalFlip")
          return [{ text: `the part is ${on ? "" : "not "}vertically reflected`, priority: 4 }];
        if (name === "drawFromPieces")
          return [{ text: `the part ${on ? "uses" : "does not use"} piece drawing`, priority: 4 }];
      }
    }
    const spatial = [...expressionFields(term.left), ...expressionFields(term.right)].some((field) =>
      /position|draw|extent|width|height/i.test(
        report.layout.fields.find((item) => item.offset === field.offset)?.name ?? "",
      ),
    );
    if (spatial) return [{ text: "the recorded spatial checks succeed", priority: 7 }];
    if (fieldName(term.left) === right && !sameExpression(term.left, term.right))
      return [{ text: "the recorded relationship between field values holds", priority: 7 }];
    return [
      {
        text: `${fieldName(term.left)} ${operators[term.operator] ?? term.operator} ${right}`,
        priority:
          leftName === "state" && exact
            ? 0
            : leftName === "stateDelta" && exact
              ? 1
              : leftName === "contextCounter" && exact
                ? 2
                : 5,
      },
    ];
  });
  const unique = [
    ...new Map(labels.sort((left, right) => left.priority - right.priority).map((item) => [item.text, item])).values(),
  ];
  return unique.length
    ? `If ${unique
        .slice(0, 4)
        .map((item) => item.text)
        .join(" and ")}${unique.length > 4 ? ", with the further recorded checks" : ""}`
    : "Under the recorded run condition";
}
function walkWords(walk: BehaviourWalk): string {
  if (walk.parameterised?.kind === "cycle")
    return `Cycles ${walk.parameterised.direction === 1 ? "forward" : "backward"} through a block of ${walk.parameterised.period} consecutive frames, taking one run call per frame. The level supplies the frame block and starting phase.`;
  if (walk.parameterised?.kind === "hold")
    return "Keeps the supplied frame unchanged while the stated condition holds; no numeric starting frame is assumed.";
  if (!walk.states.length) return walk.reason ?? "The initial frame has not been established.";
  const labels = walk.frames
    .slice(0, 12)
    .map(
      (frame) =>
        `${frame.frame === undefined ? "state" : "frame"} ${frame.state}${frame.runCalls > 1 ? ` for ${frame.runCalls} run invocations` : ""}`,
    );
  const prefix = labels.join(", ") + (walk.frames.length > 12 ? ", followed by the remaining recorded frames" : "");
  if (walk.status === "rest") return `Shows ${prefix}, then holds the last frame.`;
  if (walk.status === "loop") return `Shows ${prefix}, then repeats its proved cycle.`;
  if (walk.status === "joins") return `Shows ${prefix}, then continues like another branch of the same walk.`;
  return `Known prefix: ${prefix}. ${walk.reason ?? "The continuation remains unresolved."}`;
}
function triggerWords(trigger: AnimationTrigger, report: BehaviourReport): string {
  if (trigger.kind === "input-case")
    return "This is a conditional input case taken from the run code. It does not assert that an external part supplies those inputs.";
  if (trigger.kind === "run")
    return "Apply the extracted run rules to the documented initial fields; unknown fields stay unknown.";
  const actions = [
    ...new Set(
      trigger.writes
        .filter((write) => write.object === "part" && write.value.kind !== "unknown")
        .map((write) => fieldEffectWords(write, report)),
    ),
  ].slice(0, 3);
  const contact =
    trigger.kind === "callback" &&
    /bounce/i.test(trigger.name) &&
    report.layout.fields.some((field) => field.name === "contactPart");
  const start = contact
    ? "If another part makes contact and the recorded contact and geometry checks reach this write"
    : trigger.kind === "related-write"
      ? "If the other part reaches the recorded write"
      : "If this callback reaches the recorded writes";
  return `${start}, its conditional effects are: ${actions.length ? actions.join(" ") : "the field changes retained in the evidence."}`;
}

function effectsOf(report: BehaviourReport, part: PartBehaviour): DescribedEffect[] {
  const effects: DescribedEffect[] = [];
  for (const write of part.visibleEffects)
    effects.push({
      kind: "drawing",
      description: fieldEffectWords(write, report),
      condition: write.condition,
      field: write.offset,
      routine: write.routine,
      ...finding([write]),
    });
  for (const counter of part.counters)
    effects.push({
      kind: "counter",
      description: `Updates a part-specific counter${counter.comparisons.length ? "; the recorded comparisons gate later behaviour" : ""}.`,
      field: counter.offset,
      ...finding([counter]),
    });
  for (const effect of report.relatedObjectEffects.filter((effect) => effect.sourceType === part.type))
    effects.push({
      kind: "related-object",
      description: fieldEffectWords(effect.write, report, true),
      condition: effect.write.condition,
      field: effect.write.offset,
      routine: effect.write.routine,
      ...finding([effect]),
    });
  const helperReport = report as BehaviourReport & {
    helpers?: (Finding & { address: number; kind: string; purpose: string; calls: number[] })[];
  };
  const helpers = new Map((helperReport.helpers ?? []).map((helper) => [helper.address, helper]));
  const visited = new Set<number>();
  const visit = (address: number, callEvidence: Evidence[], depth: number) => {
    if (visited.has(address) || depth > 32) return;
    visited.add(address);
    const helper = helpers.get(address);
    if (!helper) return;
    if (!["unknown", "unclassified", "read-only", "call-wrapper"].includes(helper.kind))
      effects.push({
        kind: "helper",
        description: `Can call a shared helper: ${helper.purpose}`,
        routine: helper.address,
        ...finding(
          [helper],
          [
            "The helper is reachable from a callback; this description does not assert that its call-path conditions occur.",
          ],
        ),
        evidence: evidence(callEvidence, helper.evidence),
      });
    for (const target of helper.calls) visit(target, helper.evidence, depth + 1);
  };
  for (const callback of part.routines) {
    const routine = report.routines.find((routine) => routine.address === callback.address);
    for (const call of routine?.calls ?? []) if (call.target) visit(call.target.address, call.evidence, 0);
    for (const write of routine?.writes ?? [])
      if (write.object !== "part" && write.object !== "data")
        effects.push({
          kind: "related-object",
          description: fieldEffectWords(write, report, true),
          condition: write.condition,
          field: write.offset,
          routine: write.routine,
          ...finding([write]),
        });
  }
  const unique = new Map<string, DescribedEffect>();
  for (const effect of effects) {
    const id = JSON.stringify([effect.kind, effect.description, effect.field, effect.condition]);
    const prior = unique.get(id);
    if (prior) {
      prior.evidence = evidence(prior.evidence, effect.evidence);
      prior.confidence = confidence(prior.confidence, effect.confidence);
    } else unique.set(id, effect);
  }
  return [...unique.values()];
}

function creationOf(report: BehaviourReport, part: PartBehaviour): RestDescription | undefined {
  const sources = (report.creation ?? []).filter((source) => source.partType === part.type);
  if (!sources.length) return undefined;
  const common = sources[0]!.fields.filter((field) =>
    sources.every((source) =>
      source.fields.some(
        (other) => other.offset === field.offset && other.width === field.width && other.value === field.value,
      ),
    ),
  );
  const proof = finding(sources, [
    "These are successful-creation defaults, not values supplied by every loaded level or restored by every reset.",
  ]);
  const fields: KnownField[] = [
    ...metadataFields(report, part),
    ...common.map((field) => ({ ...field, object: "part", knownMask: full(field.width) })),
  ];
  const state = common.find((field) => field.offset === stateOffsetOf(report));
  return {
    ...proof,
    fields,
    status: state ? "known" : "unresolved",
    ...(state ? { state: state.value, frame: frameOf(part, state.value) } : {}),
    description: state
      ? `A successfully created part starts in state ${state.value}, before level overrides.`
      : "No state value is established on every constructor return.",
    ...(!state ? { reason: "The constructor has no common final literal state; no zero input is assumed." } : {}),
  };
}

/** Produces rest findings and conditional animations using only reset and trigger assignments in this report. */
/** Proves translation-invariant phase cycles while leaving the frame block supplied by the level symbolic. */
function periodicAnimations(report: BehaviourReport, part: PartBehaviour): AnimationDescription[] {
  const stateOffset = stateOffsetOf(report),
    run = part.routines.find((r) => r.slot === 1);
  if (stateOffset === undefined || !run) return [];
  const rules = part.transitions.filter((r) => r.routine === run.address);
  const ownerState = (e: Expression): boolean => e.kind === "field" && e.object === "part" && e.offset === stateOffset;
  const contains = (e: Expression): boolean =>
    ownerState(e) ||
    (e.kind === "binary" && (contains(e.left) || contains(e.right))) ||
    (e.kind === "table" && contains(e.index));
  const affine = (e: Expression): number | undefined => {
    if (ownerState(e)) return 0;
    if (e.kind !== "binary" || !["+", "-"].includes(e.operator) || e.right.kind !== "constant") return;
    const before = affine(e.left);
    if (before === undefined) return;
    const value = signed(wrap(e.right.value, e.right.width), e.right.width);
    return before + (e.operator === "+" ? value : -value);
  };
  const periodOf = (e: Expression): number | undefined => {
    if (e.kind !== "binary" || e.right.kind !== "constant") return;
    const shift = affine(e.left);
    if (shift === undefined || shift < 0 || shift > 1) return;
    const amount = e.right.value;
    if (e.operator === "&" && amount >= 1 && amount < 16 && (amount & (amount + 1)) === 0) return amount + 1;
    if (["%", "s%"].includes(e.operator) && amount >= 2 && amount <= 16) return amount;
  };
  const periods = new Set<number>();
  for (const rule of rules)
    for (const term of predicateTerms(rule.condition))
      if (term.kind === "compare") {
        const period = periodOf(term.left) ?? periodOf(term.right);
        if (period) periods.add(period);
      }
  const results: AnimationDescription[] = [];
  for (const period of periods) {
    const invariant = (e: Expression): boolean => !contains(e) || periodOf(e) === period;
    if (
      rules.some(
        (rule) =>
          affine(rule.to) === undefined ||
          predicateTerms(rule.condition).some(
            (term) => term.kind === "compare" && (!invariant(term.left) || !invariant(term.right)),
          ) ||
          (rule as WithUpdates).updates?.some(
            (write) =>
              contains(write.value) &&
              !(write.object === "part" && write.offset === stateOffset && affine(write.value) !== undefined),
          ),
      )
    )
      continue;
    const contexts = new Map<string, { condition: Predicate; proof: Finding }>();
    for (const rule of rules) {
      const terms = predicateTerms(rule.condition).filter(
        (term) => inputPredicate(term) && (term.kind !== "compare" || (!contains(term.left) && !contains(term.right))),
      );
      const condition: Predicate = { kind: "and", terms };
      contexts.set(JSON.stringify(terms), { condition, proof: finding([rule]) });
    }
    const phasePart = {
      ...part,
      transitions: part.transitions.map((rule) => (rule.routine === run.address ? { ...rule, from: null } : rule)),
    };
    const phaseReport = { ...report, parts: [phasePart] };
    let tried = 0;
    for (const { condition, proof } of [...contexts.values()].sort(
      (a, b) => predicateTerms(a.condition).length - predicateTerms(b.condition).length,
    )) {
      if (tried++ >= 16) break;
      const fields = metadataFields(report, part);
      for (const term of predicateTerms(condition))
        if (
          term.kind === "compare" &&
          term.operator === "==" &&
          term.left.kind === "field" &&
          term.left.object === "part" &&
          term.right.kind === "constant"
        )
          fields.push({
            ...term.left,
            value: wrap(term.right.value, term.left.width),
            knownMask: full(term.left.width),
            ...proof,
          });
      const input = bindingsOf(fields);
      if (predicateOf(condition, input) === false) continue;
      // Zero here is the algebraic phase coordinate. It is never emitted as the part's starting state.
      const phase = walkBehaviourRules(
        phaseReport,
        part.type,
        [...fields, { object: "part", offset: stateOffset, width: 16, value: 0, knownMask: 0xffff, ...proof }],
        { condition, maxRunCalls: period * 3 },
      );
      const direction = phase.states[1] === 1 ? 1 : phase.states[1] === period - 1 ? -1 : undefined;
      if (
        phase.status !== "loop" ||
        direction === undefined ||
        phase.states.length <= period ||
        phase.states.some((state, i) => state !== (((direction * i) % period) + period) % period)
      )
        continue;
      const phaseProofs: Finding[] = [phase];
      let allPhases = true;
      for (let start = 1; start < period; start++) {
        const shifted = walkBehaviourRules(
          phaseReport,
          part.type,
          [...fields, { object: "part", offset: stateOffset, width: 16, value: start, knownMask: 0xffff, ...proof }],
          { condition, maxRunCalls: period * 3 },
        );
        if (
          shifted.status !== "loop" ||
          shifted.states.length <= period ||
          shifted.states.some((state, i) => state !== (((start + direction * i) % period) + period) % period)
        ) {
          allPhases = false;
          break;
        }
        phaseProofs.push(shifted);
      }
      if (!allPhases) continue;
      const maximum =
        Math.floor(
          (Math.min(0x7ffe, (part as WithFrameCount).frameCount ? (part as WithFrameCount).frameCount! - 1 : 0x7ffe) -
            (period - 1)) /
            period,
        ) * period;
      if (maximum < 0) continue;
      const phaseProof = finding(phaseProofs);
      const assumptions = [
        ...new Set([
          ...phaseProof.assumptions,
          `The frame-block base is a nonnegative multiple of ${period}, at most ${maximum}. Every state is that base plus a phase from 0 through ${period - 1}.`,
          "Every selected state must have a valid frame for this type. The phase relation does not establish additional sprite or frame data.",
          "State-dependent guards use only the proved periodic mask or remainder, and destinations are affine state changes. Phase reduction therefore leaves the frame-block base unchanged; it does not select a level's initial state.",
          "The stated input conditions remain subject to the same pointer, alias and memory-effect invalidation as the phase proof.",
        ]),
      ];
      const walk: BehaviourWalk = {
        ...phase,
        ...phaseProof,
        states: [],
        frames: [],
        fields: [],
        runCalls: period,
        loopStart: 0,
        confidence: "inferred",
        assumptions,
        parameterised: {
          kind: "cycle",
          state: { kind: "field", object: "level-supplied cycle state", offset: stateOffset, width: 16 },
          period,
          direction,
          minimumBase: 0,
          maximumBase: maximum,
        },
      };
      const trigger: AnimationTrigger = {
        kind: "input-case",
        name: inputConditionWords(condition, report, part),
        description: `${inputConditionWords(condition, report, part)}, the frame cycles within its current block of ${period} frames. The level supplies the block and starting phase.`,
        routine: run.address,
        condition,
        writes: [],
        ...proof,
        confidence: "inferred",
        assumptions,
      };
      results.push({
        id: `periodic-${period}-${results.length}`,
        initial: "run-guard",
        inputCondition: condition,
        initialFields: fields,
        prerequisites: [],
        trigger,
        walk,
        description: walkWords(walk),
        ...finding([trigger, walk]),
      });
    }
  }
  return results;
}

export function describeBehaviour(report: BehaviourReport): BehaviourDescription {
  const parts = report.parts.map((part): PartBehaviourDescription => {
    const rest = restOf(report, part);
    const creation = creationOf(report, part);
    if (rest.status === "unresolved" && report.lifecycle?.reset.length) {
      rest.description =
        "The level reset restores the frame saved in the level; TIM.EXE alone does not supply that value.";
      rest.evidence = evidence(rest.evidence, ...report.lifecycle.reset.map((context) => context.evidence));
      rest.assumptions.push(
        "This describes the proved level-reset context; other callers of the type reset callback can differ.",
      );
    }
    const stableStates = stableStatesOf(report, part);
    const effects = effectsOf(report, part);
    const gear = describeGear(part, report.gearScheduling, report.relatedObjectEffects);
    if (gear)
      for (const description of [
        gear.activation,
        gear.connections,
        gear.conflict,
        gear.withoutConflict,
        gear.withConflict,
        gear.cycles,
        ...gear.scheduling.map((finding) => finding.description),
      ])
        effects.push({
          kind: "helper",
          description,
          confidence: gear.confidence,
          evidence: gear.evidence,
          assumptions: gear.assumptions,
        });
    if (gear)
      for (const driver of gear.drivers)
        effects.push({
          kind: "related-object",
          description: driver.description,
          confidence: driver.confidence,
          evidence: driver.evidence,
          assumptions: driver.assumptions,
          condition: driver.write.condition,
          routine: driver.write.routine,
        });
    const animations: AnimationDescription[] = [];
    const run = part.routines.find((item) => item.slot === 1);
    const add = (id: string, trigger: AnimationTrigger, stable?: StableStateDescription, created = false) => {
      const initial = created ? creation! : (stable ?? rest);
      trigger = { ...trigger, description: triggerWords(trigger, report) };
      const proof = finding(
        [initial, trigger],
        trigger.condition.kind === "true"
          ? []
          : ["The animation is conditional on the stated trigger predicate; no collision or input field is invented."],
      );
      const restFields = stable
        ? stable.fields
        : created
          ? creation!.fields
          : rest.status === "known"
            ? rest.fields
            : rest.fields.filter((field) => field.confidence !== "unresolved");
      if (predicateOf(trigger.condition, bindingsOf(restFields)) === false) return;
      const ownerWrites = trigger.writes.filter((write) => write.object === "part");
      const seedBindings = applyWrites(bindingsOf(restFields), ownerWrites);
      const seedProof: Finding = {
        ...proof,
        confidence: confidence(...restFields.map((field) => field.confidence), "inferred"),
        assumptions: [
          ...new Set([
            ...proof.assumptions,
            ...(trigger.kind === "run"
              ? []
              : ["If this recorded trigger write is reached; no claim is made that its event or guard occurs."]),
          ]),
        ],
      };
      const seed = fieldsOf(seedBindings, [...fieldDefinitions(report, part), ...trigger.writes], seedProof);
      // The trigger's tests on the part's own fields still hold when the walk starts, as far as its writes leave those
      // fields alone, so a starting frame they rule out isn't followed.
      const stateOffset = stateOffsetOf(report);
      const held =
        trigger.kind === "run" || stateOffset === undefined
          ? []
          : retainConstraints(predicateTerms(trigger.condition).filter(inputPredicate), trigger.writes, stateOffset, {
              kind: "field",
              object: "part",
              offset: stateOffset,
              width: 16,
            });
      const walk: BehaviourWalk =
        trigger.effectsComplete === false
          ? {
              status: "unresolved",
              states: [],
              frames: [],
              fields: [],
              runCalls: 0,
              confidence: "unresolved",
              assumptions: proof.assumptions,
              evidence: proof.evidence,
              reason: "The trigger has untracked object effects, so its final starting fields are not established.",
              timingReason: "No run invocation can be established from this trigger.",
            }
          : walkBehaviourRules(report, part.type, seed, held.length ? { condition: { kind: "and", terms: held } } : {});
      animations.push({
        id,
        initial: created ? "creation" : stable ? "documented-rest" : "reset",
        prerequisites: created
          ? [
              {
                condition: {
                  kind: "unknown",
                  reason: "Successful creation before level overrides or other external field writes.",
                },
                evidence: creation!.evidence,
              },
            ]
          : (stable?.origins ?? []),
        trigger,
        initialFields: seed,
        description: walkWords(walk),
        walk,
        ...finding([trigger, walk]),
      });
    };
    if (run)
      add("run-from-reset", {
        kind: "run",
        name: "Run from the recovered reset fields",
        routine: run.address,
        condition: { kind: "true" },
        writes: [],
        ...finding([run]),
      });
    if (run && creation?.status === "known")
      add(
        "run-from-creation",
        {
          kind: "run",
          name: "Run after successful creation",
          routine: run.address,
          condition: { kind: "true" },
          writes: [],
          ...finding([run, creation]),
        },
        undefined,
        true,
      );
    if (run)
      stableStates.forEach((stable, index) =>
        add(
          `run-from-stable-${index}`,
          {
            kind: "run",
            name: `Run from documented stable state ${stable.state}`,
            routine: run.address,
            condition: { kind: "true" },
            writes: [],
            ...finding([run]),
          },
          stable,
        ),
      );
    for (const callback of part.routines.filter((item) => item.slot !== 1 && item.slot !== 2 && !item.sharedDefault)) {
      const routine = report.routines.find((item) => item.address === callback.address) as WithOutcomes | undefined;
      for (const [index, outcome] of (routine?.outcomes ?? []).entries()) {
        if (!outcome.fields.some((field) => field.object === "part")) continue;
        const trigger: AnimationTrigger = {
          kind: "callback",
          name: callback.role,
          routine: callback.address,
          condition: outcome.condition,
          writes: outcome.fields,
          effectsComplete: outcome.effectsComplete ?? outcome.confidence !== "unresolved",
          ...finding([callback, outcome]),
        };
        if (predicateOf(outcome.condition, bindingsOf(rest.fields)) !== false)
          add(`callback-${callback.slot}-${index}`, trigger);
        stableStates.forEach((stable, stableIndex) => {
          if (predicateOf(outcome.condition, bindingsOf(stable.fields)) !== false)
            add(`stable-${stableIndex}-callback-${callback.slot}-${index}`, trigger, stable);
        });
      }
    }
    const producers = new Set<string>();
    for (const [index, effect] of report.relatedObjectEffects
      .filter((item) => item.targetType === part.type)
      .entries()) {
      const source = report.routines.find((routine) => routine.address === effect.write.routine);
      const completeOutcomes = [
        ...(source?.outcomes ?? []).map((outcome, outcomeIndex) => ({
          outcome,
          outcomeIndex,
          scope: "return" as const,
        })),
        ...(source?.iterationOutcomes ?? [])
          .filter((outcome) => outcome.object === effect.write.object)
          .map((outcome, outcomeIndex) => ({ outcome, outcomeIndex, scope: "member" as const })),
      ].filter(({ outcome }) =>
        outcome.fields.some(
          (field) =>
            field.object === effect.write.object &&
            field.offset === effect.write.offset &&
            field.width === effect.write.width &&
            JSON.stringify(field.value) === JSON.stringify(effect.write.value),
        ),
      );
      const choices = completeOutcomes.length
        ? completeOutcomes
        : [{ outcome: undefined, outcomeIndex: -1, scope: "return" as const }];
      for (const { outcome, outcomeIndex, scope } of choices) {
        const identity = `${effect.write.routine}:${scope}:${outcomeIndex}:${effect.write.object}:${part.type}`;
        if (producers.has(identity)) continue;
        producers.add(identity);
        const sourceFields = outcome?.fields ?? [effect.write];
        const writes = sourceFields.map((field) => ({
          ...field,
          object:
            field.object === effect.write.object
              ? "part"
              : field.object === "part"
                ? `source-type-${effect.sourceType}`
                : field.object,
          value: remapExpression(field.value, effect.write.object, effect.sourceType),
          condition: remapPredicate(field.condition, effect.write.object, effect.sourceType),
        }));
        const trigger: AnimationTrigger = {
          kind: "related-write",
          name: `A recorded effect of ${effect.sourcePart}${scope === "member" ? " on a part in its overlap list" : ""}`,
          ...(scope === "member" ? { scope: "one overlap-list member" as const } : {}),
          routine: effect.write.routine,
          condition: remapPredicate(
            outcome?.condition ?? effect.write.condition,
            effect.write.object,
            effect.sourceType,
          ),
          writes,
          sourceType: effect.sourceType,
          effectsComplete: !!outcome && (outcome.effectsComplete ?? outcome.confidence !== "unresolved"),
          ...finding(
            outcome ? [effect, outcome] : [effect],
            scope === "member"
              ? [
                  "The assignments apply together to one member if it belongs to the source's overlap list and its per-member checks reach this outcome; list membership is not asserted to occur.",
                ]
              : [],
          ),
        };
        add(`related-${effect.sourceType}-${index}-${scope}-${outcomeIndex}`, trigger);
        stableStates.forEach((stable, stableIndex) =>
          add(`stable-${stableIndex}-related-${effect.sourceType}-${index}-${scope}-${outcomeIndex}`, trigger, stable),
        );
      }
    }
    const inputCases = conditionalInputCases(report, part);
    if (run)
      inputCases.cases.forEach((input, index) => {
        // A case a decided assumption rules out, like the monkey bike pedalling with its counter at 0, isn't walked.
        const offset = stateOffsetOf(report);
        if (offset !== undefined && impossibleState(part, offset, bindingsOf(input.fields))) return;
        // Nor is a case that needs a frame the part doesn't have, like a frame above the fish bowl's last.
        const frameCount = (part as WithFrameCount).frameCount;
        if (offset !== undefined && frameCount && frameCount <= 32) {
          const seeded = bindingsOf(input.fields);
          const anyFrame = [...Array(frameCount).keys()].some((frame) => {
            const fields = new Map(seeded);
            const before = readField(fields, "part", offset, 16);
            if (known(before) && before.value !== frame) return false;
            writeField(fields, "part", offset, bits(frame, 0xffff, 16));
            return predicateOf(input.condition, fields) !== false;
          });
          if (!anyFrame) return;
        }
        const trigger: AnimationTrigger = {
          kind: "input-case",
          name: inputConditionWords(input.condition, report, part),
          description: `${inputConditionWords(input.condition, report, part)}, the extracted run rules have the following consequence. This is an input case, not a proved external trigger.`,
          routine: run.address,
          condition: input.condition,
          writes: [],
          ...finding([input]),
        };
        const walk = walkBehaviourRules(report, part.type, input.fields, { condition: input.condition, midRun: true });
        animations.push({
          id: `run-guard-${index}`,
          initial: "run-guard",
          inputCondition: input.condition,
          initialFields: input.fields,
          description: walkWords(walk),
          prerequisites: [],
          trigger,
          walk,
          ...finding([trigger, walk]),
        });
      });
    animations.push(...periodicAnimations(report, part));
    const uncertainties = [
      ...new Set([
        ...part.uncertainties,
        ...(inputCases.truncated
          ? [
              "The description retained at most 64 conditional input cases with bounded producer-value partitions; further cases remain in the extracted report.",
            ]
          : []),
        ...(rest.reason ? [rest.reason] : []),
        ...animations.flatMap((animation) => (animation.walk.reason ? [animation.walk.reason] : [])),
      ]),
    ];
    const contact = describeCollisionDispatch(report.collisionDispatch, part);
    return {
      id: part.id,
      type: part.type,
      ...(gear ? { gear } : {}),
      ...(contact ? { contact } : {}),
      summary: `${rest.status === "known" ? `The reset paths establish state ${rest.state}.` : "The reset state is unresolved."} ${stableStates.length} stable ending${stableStates.length === 1 ? " is" : "s are"} proved from run outcomes. ${animations.filter((animation) => animation.walk.status === "rest" || animation.walk.status === "loop").length} conditional frame walks have a proved ending.`,
      rest,
      ...(creation ? { creation } : {}),
      stableStates,
      effects,
      rules: part.transitions
        .filter((rule) => rule.routine === run?.address)
        .map((rule) => ({
          description:
            rule.to.kind === "constant"
              ? `Under its recorded condition, the run code selects state ${rule.to.value}.`
              : rule.to.kind === "field"
                ? "Under its recorded condition, the run code selects a state supplied by the part's fields."
                : rule.to.kind === "unknown"
                  ? "The next state depends on an unresolved result."
                  : "Under its recorded condition, the run code calculates the next state from the part's fields.",
          condition: rule.condition,
          nextState: rule.to,
          ...finding([rule]),
        })),
      animations,
      triggers: part.triggers.map(({ name, condition, evidence, confidence }) => ({
        name,
        condition,
        evidence,
        confidence,
      })),
      uncertainties,
      ...finding([rest, ...animations]),
    };
  });
  return {
    listId: report.listId,
    parts,
    ...finding(parts, [
      "Frame walks apply extracted return expressions, not x86 instructions or executable callbacks.",
    ]),
  };
}
