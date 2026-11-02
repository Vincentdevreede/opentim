/** Compares recorded state sequences with static transition expressions. It never executes instructions or callbacks. */
import type { Expression, Predicate, Transition } from "./behaviour.ts";

export interface MeasuredFrame {
  state: number;
  [field: string]: unknown;
}

export interface MeasuredClip {
  path: string;
  frames: MeasuredFrame[];
  loopStart: number | null;
  input: Record<string, unknown>;
  skippedEngineServices: Record<string, unknown>;
}

export interface MeasuredTransition {
  clip: string;
  tick: number;
  from: number;
  to: number;
  status: "checked" | "inferred" | "unresolved" | "missed";
  unchanged: boolean;
  transitions: number[];
}

export interface MeasurementCoverage {
  clips: number;
  unchangedSteps: number;
  unchanged: { checked: number; inferred: number; unresolved: number; missed: number };
  checked: number;
  inferred: number;
  unresolved: number;
  missed: number;
  completeClips: number;
  clipsWithoutSteps: number;
  transitions: MeasuredTransition[];
  unseenTransitions: number[];
  clipsWithSkippedServices: number;
  limitations: string[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Finds every clip, including orientations, actions and recordings from each initial state. */
export function measuredClips(value: unknown, path = "part"): MeasuredClip[] {
  if (!record(value)) return [];
  if (Array.isArray(value.frames)) {
    if (
      !value.frames.every((frame) => record(frame) && typeof frame.state === "number" && Number.isInteger(frame.state))
    )
      throw new Error(`${path}: a measured frame has no integer state`);
    const frames = value.frames as MeasuredFrame[];
    if (!frames.length) throw new Error(`${path}: a measured clip has no frames`);
    const loopStart = value.loopStart ?? null;
    if (
      loopStart !== null &&
      (typeof loopStart !== "number" || !Number.isInteger(loopStart) || loopStart < 0 || loopStart >= frames.length)
    )
      throw new Error(`${path}: invalid loopStart`);
    return [
      {
        path,
        frames,
        loopStart: loopStart as number | null,
        input: record(value.input) ? value.input : {},
        skippedEngineServices: record(value.skippedEngineServices) ? value.skippedEngineServices : {},
      },
    ];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    Array.isArray(child)
      ? child.flatMap((item, index) => measuredClips(item, `${path}.${key}[${index}]`))
      : measuredClips(child, `${path}.${key}`),
  );
}

const fields = new Map([
  [0x0c, "state"],
  [0x12, "control"],
  [0x96, "timer"],
  [0x9c, "heat"],
  [0x36, "vx"],
  [0x38, "vy"],
]);
const wrap = (value: number, width: number) => ((value % 2 ** width) + 2 ** width) % 2 ** width;
const signed = (value: number, width: number) => (value >= 2 ** (width - 1) ? value - 2 ** width : value);

/** Substitutes recorded field values into graph algebra, not into machine instructions. */
function expressionValue(expression: Expression, frame: MeasuredFrame): number | undefined {
  const width = expression.width;
  if (expression.kind === "constant") return wrap(expression.value, width);
  if (expression.kind === "field") {
    if (expression.object !== "part") return undefined;
    const name = fields.get(expression.offset);
    const value = name && frame[name];
    return typeof value === "number" ? wrap(value, width) : undefined;
  }
  if (expression.kind !== "binary") return undefined;
  // The oracle records only these bits of +8. Other bits must remain unknown.
  if (expression.operator === "&") {
    const [field, mask] =
      expression.left.kind === "field" ? [expression.left, expression.right] : [expression.right, expression.left];
    if (
      field.kind === "field" &&
      field.object === "part" &&
      field.offset === 8 &&
      mask.kind === "constant" &&
      (mask.value & ~0x3030) === 0 &&
      typeof frame.flags8 === "number"
    )
      return wrap(frame.flags8 & mask.value, width);
  }
  const left = expressionValue(expression.left, frame);
  const right = expressionValue(expression.right, frame);
  if (left === undefined || right === undefined) return undefined;
  if (["==", "!=", "<", "<=", ">", ">="].includes(expression.operator)) {
    const a = wrap(left, expression.left.width),
      b = wrap(right, expression.left.width),
      op = expression.operator;
    return wrap(
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
      width,
    );
  }
  let value: number;
  switch (expression.operator) {
    case "+":
      value = left + right;
      break;
    case "-":
      value = left - right;
      break;
    case "*":
      value = left * right;
      break;
    case "&":
      value = left & right;
      break;
    case "|":
      value = left | right;
      break;
    case "^":
      value = left ^ right;
      break;
    case "<<":
      value = left << right;
      break;
    case ">>":
      value = signed(left, expression.left.width) >> right;
      break;
    case ">>>":
      value = left >>> right;
      break;
    case "%":
      if (!right) return undefined;
      value = left % right;
      break;
    case "/":
      if (!right) return undefined;
      value = Math.trunc(left / right);
      break;
    case "s/":
    case "s%": {
      const denominator = signed(right, expression.right.width);
      if (!denominator) return undefined;
      const dividend = signed(left, expression.left.width);
      value = expression.operator === "s/" ? Math.trunc(dividend / denominator) : dividend % denominator;
      break;
    }
    default:
      return undefined;
  }
  return wrap(value, width);
}

function predicateValue(predicate: Predicate, frame: MeasuredFrame): boolean | undefined {
  if (predicate.kind === "true") return true;
  if (predicate.kind === "unknown") return undefined;
  if (predicate.kind === "and") {
    const values = predicate.terms.map((term) => predicateValue(term, frame));
    return values.includes(false) ? false : values.includes(undefined) ? undefined : true;
  }
  let left = expressionValue(predicate.left, frame);
  let right = expressionValue(predicate.right, frame);
  if (left === undefined || right === undefined) return undefined;
  left = wrap(left, predicate.left.width);
  right = wrap(right, predicate.left.width);
  if (predicate.signed) {
    left = signed(left, predicate.left.width);
    right = signed(right, predicate.left.width);
  }
  switch (predicate.operator) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    default:
      return undefined;
  }
}

function inputFrame(clip: MeasuredClip, tick: number): MeasuredFrame {
  const frame = { ...clip.frames[tick]! };
  const hold = clip.input.hold;
  const ticks = clip.input.holdTicks;
  if (record(hold)) {
    const values = typeof ticks !== "number" || tick < ticks ? hold : tick === ticks ? clip.input.release : undefined;
    if (record(values)) Object.assign(frame, values);
    else if (typeof ticks === "number" && tick === ticks) frame.control = 0;
  }
  return frame;
}

/**
 * Checks each step and the closing edge of each measured loop. A compatible edge with unknown conditions is
 * unresolved, never explained. Unchanged states require an explicit edge preserving the state and are reported
 * separately from changed-state steps.
 */
export function validateMeasuredPart(transitions: Transition[], clips: MeasuredClip[]): MeasurementCoverage {
  const result: MeasurementCoverage = {
    clips: clips.length,
    unchangedSteps: 0,
    unchanged: { checked: 0, inferred: 0, unresolved: 0, missed: 0 },
    checked: 0,
    inferred: 0,
    unresolved: 0,
    missed: 0,
    completeClips: 0,
    clipsWithoutSteps: 0,
    transitions: [],
    unseenTransitions: [],
    clipsWithSkippedServices: 0,
    limitations: [
      "This checks graph expressions against recorded fields. It does not execute instructions or callbacks.",
      "Unchanged states require an explicit graph edge preserving state. Hidden and flip changes are not validated here.",
      "Only fields recorded by the oracle can resolve predicates. The oracle masks +8 to 0x3030.",
      "The oracle skipped external engine services. Its clips do not establish world interactions or wall time.",
      "A recorded step is checked independently. Shared hidden variables across steps may add unresolved constraints.",
    ],
  };
  const observed = new Set<number>();
  for (const clip of clips) {
    if (Object.keys(clip.skippedEngineServices).length) result.clipsWithSkippedServices++;
    let complete = true;
    const steps = clip.frames.length - 1 + (clip.loopStart === null ? 0 : 1);
    if (!steps) result.clipsWithoutSteps++;
    for (let tick = 0; tick < steps; tick++) {
      const frame = inputFrame(clip, tick);
      const next = clip.frames[tick + 1] ?? clip.frames[clip.loopStart!]!;
      const unchanged = frame.state === next.state;
      if (unchanged) result.unchangedSteps++;
      const matches: { index: number; status: "checked" | "inferred" | "unresolved" }[] = [];
      transitions.forEach((transition, index) => {
        if (transition.from !== null && !transition.from.includes(frame.state)) return;
        const condition = predicateValue(transition.condition, frame);
        if (condition === false) return;
        const destination = expressionValue(transition.to, frame);
        if (destination !== undefined && destination !== wrap(next.state, transition.to.width)) return;
        const status =
          condition === undefined || destination === undefined || transition.confidence === "unresolved"
            ? "unresolved"
            : transition.confidence;
        matches.push({ index, status });
      });
      const status = matches.some((match) => match.status === "checked")
        ? "checked"
        : matches.some((match) => match.status === "inferred")
          ? "inferred"
          : matches.length
            ? "unresolved"
            : "missed";
      const candidates = matches.filter((match) => match.status === status).map((match) => match.index);
      if (status === "checked" || status === "inferred") candidates.forEach((index) => observed.add(index));
      else complete = false;
      if (unchanged) result.unchanged[status]++;
      else result[status]++;
      result.transitions.push({
        clip: clip.path,
        tick,
        from: frame.state,
        to: next.state,
        status,
        unchanged,
        transitions: candidates,
      });
    }
    if (steps && complete) result.completeClips++;
  }
  result.unseenTransitions = transitions.flatMap((_, index) => (observed.has(index) ? [] : [index]));
  return result;
}
