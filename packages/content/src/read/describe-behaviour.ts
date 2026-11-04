/** Builds descriptions and frame walks from extracted rules. No instruction stream is interpreted here. */
import { describeCollisionDispatch } from "./behaviour-collision-dispatch.ts";
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
  status: "rest" | "loop" | "unresolved" | "limit";
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
const sameExpression = (left: Expression, right: Expression) => JSON.stringify(left) === JSON.stringify(right);
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

function fieldDefinitions(
  report: BehaviourReport,
  part: PartBehaviour,
): { object: string; offset: number; width: number }[] {
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
  return [...fields.values()];
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
function completeRuleEffects(rule: WithUpdates, routine?: RoutineAnalysis): boolean {
  if (routine?.uncertainEffects !== true) return true;
  const matching =
    routine?.outcomes?.filter((outcome) => JSON.stringify(outcome.condition) === JSON.stringify(rule.condition)) ?? [];
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
  options: { maxRunCalls?: number; condition?: Predicate } = {},
): BehaviourWalk {
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
  const state = readField(bindings, "part", stateOffset, 16);
  if (!known(state)) {
    const candidates = rules.filter((rule) => predicateOf(rule.condition, bindings, constraints) !== false);
    const identity = (expression: Expression) =>
      expression.kind === "field" &&
      expression.object === "part" &&
      expression.offset === stateOffset &&
      !expression.unresolved;
    const domains = new Set(
      candidates.map((rule) =>
        rule.from === null ? "all" : JSON.stringify([...rule.from].sort((left, right) => left - right)),
      ),
    );
    if (
      candidates.length &&
      domains.size === 1 &&
      guardCoverage(candidates, bindings, constraints, routine) &&
      candidates.every((rule) => rule.confidence !== "unresolved" && identity(rule.to))
    ) {
      const starts = JSON.stringify([signature(bindings), constraints]);
      const stable = candidates.every((rule) => {
        const next = ruleBindings(rule, bindings, routine);
        return (
          JSON.stringify([
            signature(next),
            retainConstraints(
              completeRuleEffects(rule, routine) ? constraints : [],
              rule.updates ?? routine?.writes ?? [],
              stateOffset,
              rule.to,
            ),
          ]) === starts
        );
      });
      if (stable) {
        proof = finding(
          [proof, ...candidates],
          [
            "The rule preserves any initial state in its stated source domain; no numeric starting state has been chosen.",
          ],
        );
        const allowedStates = candidates.some((rule) => rule.from === null)
          ? undefined
          : [...new Set(candidates.flatMap((rule) => rule.from ?? []))];
        return {
          ...base("rest"),
          runCalls: 1,
          parameterised: {
            kind: "hold",
            state: { kind: "field", object: "part", offset: stateOffset, width: 16 },
            ...(allowedStates ? { allowedStates } : {}),
          },
        };
      }
    }
    return {
      ...base("unresolved", "The seed does not establish the state. No state zero is assumed."),
      confidence: "unresolved",
    };
  }
  states.push(state.value);
  const walkSignature = () => JSON.stringify([signature(bindings), constraints]);
  const seen = new Map([[walkSignature(), 0]]);
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
    if (candidates.some((rule) => rule.confidence === "unresolved")) {
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
      return {
        ...base("unresolved", description),
        confidence: "unresolved",
        stop: {
          kind: "state",
          description,
          evidence: stoppingEvidence(candidates, [expression]),
          fields: unknownFields([expression], bindings),
        },
        evidence: evidence(proof.evidence, ...candidates.map((rule) => rule.evidence)),
      };
    }
    const next = outcomes[0]!;
    if (outcomes.some((outcome) => signature(outcome.next) !== signature(next.next)))
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
        },
      };
    if ((part as WithFrameCount).frameCount && next.destination.value >= (part as WithFrameCount).frameCount!)
      return { ...base("unresolved", "The next state has no known visible frame."), confidence: "unresolved" };
    proof = finding([proof, ...candidates]);
    constraints = retainConstraints(
      candidates.every((rule) => completeRuleEffects(rule, routine)) ? constraints : [],
      candidates.flatMap((rule) => rule.updates ?? routine?.writes ?? []),
      stateOffset,
      next.rule.to,
    );
    bindings = next.next;
    states.push(next.destination.value);
    proofs.push(finding(candidates));
    const id = walkSignature();
    const prior = seen.get(id);
    if (prior !== undefined) return base(prior === states.length - 2 ? "rest" : "loop", undefined, prior);
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
  for (const source of report.creation ?? [])
    if (source.partType === part.type)
      for (const field of source.fields)
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
          : walkBehaviourRules(report, part.type, seed);
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
        const trigger: AnimationTrigger = {
          kind: "input-case",
          name: inputConditionWords(input.condition, report, part),
          description: `${inputConditionWords(input.condition, report, part)}, the extracted run rules have the following consequence. This is an input case, not a proved external trigger.`,
          routine: run.address,
          condition: input.condition,
          writes: [],
          ...finding([input]),
        };
        const walk = walkBehaviourRules(report, part.type, input.fields, { condition: input.condition });
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
