/**
 * The two helpers a routine calls after it changes a part's frame: one loads the frame's size into `frameWidth` and
 * `frameHeight`, the other sets `drawX` and `drawY` from the position, the frame's offset and the flip flags, and
 * calls the first. Both only read the part and tables, so each field they write is one value of the part's fields and
 * those tables, chosen by the tests on the path the helper takes.
 *
 * The proof reads the helpers' own analysis: every return path, its tests and its writes. A field's value is the sum
 * of each path's value times the 0 or 1 of that path's tests, which is exact because exactly one path's tests hold.
 * A caller then gets these values in place of unknown writes.
 */
import type { Expression, Finding, Predicate, RoutineAnalysis } from "./behaviour.ts";
import type { EngineSummary, EngineWrite } from "./behaviour-helpers.ts";
import { constant } from "./behaviour-terms.ts";

export interface FrameDrawing extends Finding {
  /** The part fields the helper writes, each with one value for every path. */
  fields: number[];
  /** The return paths the values are made from. */
  paths: number;
}

type Build = (operator: string, left: Expression, right: Expression, width?: number) => Expression;
type Compare = Extract<Predicate, { kind: "compare" }>;

const hex = (n: number) => `0x${n.toString(16)}`;
const partField = (offset: number): Expression => ({ kind: "field", object: "part", offset, width: 16 });
const textOf = (value: unknown) => JSON.stringify(value);
const inverse: Record<string, string> = { "==": "!=", "!=": "==" };

/** The words of a type record that point to its frames' offsets (`+0x18`) and sizes (`+0x1a`). */
const FRAME_TABLE_WORDS = [0x18, 0x1a];

/** Every field the expression reads is a field of the part itself; nothing is unknown. */
function onlyPartFields(e: Expression): boolean {
  if (e.kind === "constant") return true;
  if (e.kind === "field") return e.object === "part" && !e.unresolved;
  if (e.kind === "binary") return onlyPartFields(e.left) && onlyPartFields(e.right);
  if (e.kind === "table") return onlyPartFields(e.index);
  return false;
}
/** The routine's own instructions that store to one of these fields of an object. */
function storesTo(routine: RoutineAnalysis, offsets: number[]) {
  return routine.instructions.filter((i) => {
    const target = i.operands[0];
    return (
      i.flow === "next" &&
      target?.kind === "memory" &&
      offsets.includes(target.displacement) &&
      !target.base.includes("bp") &&
      !["cmp", "test", "push"].includes(i.mnemonic)
    );
  });
}
const writesField = (outcome: { fields: { object: string; offset: number }[] }, offset: number) =>
  outcome.fields.some((w) => w.object === "part" && w.offset === offset);
/** The value with `0 + x`, which the analysis leaves in table indices, written as `x`. */
function tidy(e: Expression, build: Build): Expression {
  if (e.kind === "binary") {
    const left = tidy(e.left, build),
      right = tidy(e.right, build);
    if (e.operator === "+" && zero(left)) return right;
    return left === e.left && right === e.right ? e : build(e.operator, left, right, e.width);
  }
  if (e.kind === "table") {
    const index = tidy(e.index, build);
    return index === e.index ? e : { ...e, index };
  }
  return e;
}
function partReads(e: Expression, found = new Set<number>()): Set<number> {
  if (e.kind === "field" && e.object === "part") found.add(e.offset);
  else if (e.kind === "binary") {
    partReads(e.left, found);
    partReads(e.right, found);
  } else if (e.kind === "table") partReads(e.index, found);
  return found;
}
/** The plain tests of a path: equalities and inequalities of values of the part and tables. */
function pathTests(condition: Predicate): Compare[] | undefined {
  const terms = condition.kind === "and" ? condition.terms : condition.kind === "true" ? [] : [condition];
  const tests: Compare[] = [];
  for (const term of terms) {
    if (term.kind !== "compare" || !inverse[term.operator]) return undefined;
    if (!onlyPartFields(term.left) || !onlyPartFields(term.right)) return undefined;
    tests.push(term);
  }
  return tests;
}
const complement = (a: Compare, b: Compare) =>
  textOf({ ...a, operator: inverse[a.operator], signed: false }) === textOf({ ...b, signed: false });

/**
 * One value from the paths' values, or undefined when two paths could both hold. Paths that give the same value and
 * differ only in one test and its opposite are joined first, so a field most paths agree on stays small.
 */
function combine(paths: { tests: Compare[]; value: Expression }[], build: Build): Expression | undefined {
  for (let a = 0; a < paths.length; a++)
    for (let b = a + 1; b < paths.length; b++) {
      const [x, y] = [paths[a]!, paths[b]!];
      if (!x.tests.some((t) => y.tests.some((u) => complement(t, u)))) return undefined;
    }
  const groups = paths.map((path) => ({ ...path }));
  let joined = true;
  while (joined) {
    joined = false;
    outer: for (let a = 0; a < groups.length; a++)
      for (let b = a + 1; b < groups.length; b++) {
        const [x, y] = [groups[a]!, groups[b]!];
        if (x.tests.length !== y.tests.length || textOf(x.value) !== textOf(y.value)) continue;
        const onlyX = x.tests.filter((t) => !y.tests.some((u) => textOf(t) === textOf(u)));
        const onlyY = y.tests.filter((t) => !x.tests.some((u) => textOf(t) === textOf(u)));
        if (onlyX.length !== 1 || onlyY.length !== 1 || !complement(onlyX[0]!, onlyY[0]!)) continue;
        groups[a] = { tests: x.tests.filter((t) => t !== onlyX[0]), value: x.value };
        groups.splice(b, 1);
        joined = true;
        break outer;
      }
  }
  return tree(groups, build) ?? constant(0);
}
const zero = (e: Expression) => e.kind === "constant" && e.value === 0;
/**
 * The sum of the groups' values, each times the 0 or 1 of its tests, with a test every group makes (or its opposite)
 * taken out in front once. Undefined is zero.
 */
function tree(groups: { tests: Compare[]; value: Expression }[], build: Build): Expression | undefined {
  const live = groups.filter((g) => !zero(g.value));
  if (!live.length) return undefined;
  if (groups.length === 1 && !groups[0]!.tests.length) return groups[0]!.value;
  const holds = (t: Compare) => build(t.operator, t.left, t.right, 16);
  const times = (t: Compare, e: Expression | undefined) => e && build("*", holds(t), e, 16);
  const plus = (a: Expression | undefined, b: Expression | undefined) => (a && b ? build("+", a, b, 16) : (a ?? b));
  const without = (g: { tests: Compare[]; value: Expression }, t: Compare) => ({
    tests: g.tests.filter((u) => textOf(u) !== textOf(t)),
    value: g.value,
  });
  for (const t of groups[0]!.tests) {
    const has = (g: { tests: Compare[] }) => g.tests.some((u) => textOf(u) === textOf(t));
    const opposite = (g: { tests: Compare[] }) => g.tests.find((u) => complement(t, u));
    if (groups.every(has))
      return times(
        t,
        tree(
          groups.map((g) => without(g, t)),
          build,
        ),
      );
    const u = groups.map(opposite).find(Boolean);
    if (u && groups.every((g) => has(g) || opposite(g)))
      return plus(
        times(
          t,
          tree(
            groups.filter(has).map((g) => without(g, t)),
            build,
          ),
        ),
        times(
          u,
          tree(
            groups.filter((g) => !has(g)).map((g) => without(g, u)),
            build,
          ),
        ),
      );
  }
  let sum: Expression | undefined;
  for (const group of live) {
    const term = group.tests.reduceRight<Expression>((e, t) => build("*", holds(t), e, 16), group.value);
    sum = plus(sum, term);
  }
  return sum;
}
/** Replaces the part's fields as they are after the call at `call` with the values the call wrote. */
function afterCall(e: Expression, call: number, values: Map<number, Expression>): Expression | undefined {
  if (e.kind === "field" && e.unresolved) {
    const value = e.object === `part after unresolved write at ${hex(call)}` ? values.get(e.offset) : undefined;
    return value && e.width === 16 ? value : undefined;
  }
  if (e.kind === "binary") {
    const left = afterCall(e.left, call, values),
      right = afterCall(e.right, call, values);
    return left && right ? { ...e, left, right } : undefined;
  }
  if (e.kind === "table") {
    const index = afterCall(e.index, call, values);
    return index && { ...e, index };
  }
  return e.kind === "unknown" ? undefined : e;
}

/** The values a helper writes, by field, from its complete analysis; undefined when a path is not plain. */
function pathValues(
  routine: RoutineAnalysis,
  written: number[],
  fields: number[],
  build: Build,
  replace: (e: Expression) => Expression | undefined = (e) => e,
): Map<number, Expression> | undefined {
  const outcomes = routine.outcomes ?? [];
  if (
    routine.status !== "complete" ||
    routine.returnPathsComplete !== true ||
    routine.uncertainEffects ||
    !outcomes.length ||
    outcomes.some((o) => o.effectsComplete !== true || o.keepsState)
  )
    return undefined;
  const paths: { tests: Compare[]; values: Map<number, Expression> }[] = [];
  for (const outcome of outcomes) {
    const tests = pathTests(outcome.condition)?.map((t) => ({
      ...t,
      left: tidy(t.left, build),
      right: tidy(t.right, build),
    }));
    if (!tests) return undefined;
    const values = new Map<number, Expression>();
    for (const write of outcome.fields) {
      if (write.object === "stack") continue;
      if (write.object !== "part" || write.width !== 16 || !written.includes(write.offset)) return undefined;
      values.set(write.offset, write.value);
    }
    paths.push({ tests, values });
  }
  const result = new Map<number, Expression>();
  for (const offset of fields) {
    const values = paths.map((path) => {
      const value = replace(tidy(path.values.get(offset) ?? partField(offset), build));
      return value && onlyPartFields(value) ? value : undefined;
    });
    if (values.some((value) => !value)) return undefined;
    const value = combine(
      paths.map((path, n) => ({ tests: path.tests, value: values[n]! })),
      build,
    );
    if (!value) return undefined;
    result.set(offset, value);
  }
  return result;
}

/**
 * Proves the frame size helper and the drawing position helper from their analysis, and gives their summaries the
 * exact values they write. A helper whose paths aren't all plain keeps its summary.
 */
export function proveFrameDrawing(
  summaries: Map<number, EngineSummary>,
  fields: { drawX: number; drawY: number; frameWidth: number; frameHeight: number },
  analyse: (summary: EngineSummary) => RoutineAnalysis,
  build: Build,
): void {
  const size = [fields.frameWidth, fields.frameHeight];
  const sizes = new Map<number, Map<number, Expression>>();
  const proved: [EngineSummary, RoutineAnalysis, Map<number, Expression>][] = [];
  const install = (summary: EngineSummary, routine: RoutineAnalysis, values: Map<number, Expression>) => {
    const outcomes = routine.outcomes!;
    const assumptions = [...new Set(outcomes.flatMap((o) => o.assumptions))];
    const evidence = [...new Map(outcomes.flatMap((o) => o.evidence).map((e) => [e.address, e])).values()];
    // Each write points to the helper's stores of its field, or to the call of the size helper that stores it.
    const stores = (offset: number) =>
      [
        ...storesTo(routine, [offset]),
        ...routine.instructions.filter(
          (i) => i.flow === "call" && summary.kind === "frame-position" && size.includes(offset),
        ),
      ].map((i) => ({ address: i.address, bytes: i.bytes, text: i.text }));
    summary.writes = [...values].map(([offset, value]): EngineWrite => ({
      confidence: "inferred",
      assumptions,
      evidence: stores(offset),
      root: "argument",
      argumentOffset: summary.argumentOffset,
      path: [],
      offset,
      width: 16,
      value,
      condition: { kind: "true" },
    }));
    summary.frameDrawing = {
      confidence: "inferred",
      assumptions,
      evidence,
      fields: [...values.keys()],
      paths: outcomes.length,
    };
    summary.assumptions = [...new Set([...summary.assumptions, ...assumptions])];
  };
  for (const summary of summaries.values()) {
    if (summary.kind !== "frame-dimensions" || !summary.footprint.complete || summary.argumentKind !== "object")
      continue;
    const routine = analyse(summary);
    const values = pathValues(routine, size, size, build);
    if (!values) continue;
    sizes.set(summary.address, values);
    proved.push([summary, routine, values]);
  }
  for (const summary of summaries.values()) {
    const dimensions = summary.calls.length === 1 ? sizes.get(summary.calls[0]!) : undefined;
    if (summary.kind !== "frame-position" || !summary.footprint.complete || !dimensions) continue;
    // The size helper reads no field this helper writes before calling it, so it sees the part as it came in.
    if ([...dimensions.values()].some((v) => [fields.drawX, fields.drawY].some((f) => partReads(v).has(f)))) continue;
    const routine = analyse(summary);
    const calls = routine.engineCalls ?? [];
    if (calls.length !== 1 || calls[0]!.summary !== summary.calls[0]) continue;
    const call = calls[0]!.instruction;
    const own = routine.writes.filter((w) => w.object !== "stack" && !(w.object === "part" && size.includes(w.offset)));
    if (own.some((w) => w.object !== "part" || ![fields.drawX, fields.drawY].includes(w.offset))) continue;
    // Only the call writes the frame size, and every path makes it, so the size it leaves is the size helper's.
    if (storesTo(routine, size).length || routine.outcomes?.some((o) => size.some((f) => !writesField(o, f)))) continue;
    const draw = [fields.drawX, fields.drawY];
    const position = pathValues(routine, [...draw, ...size], draw, build, (e) => afterCall(e, call, dimensions));
    if (!position) continue;
    proved.push([summary, routine, new Map([...position, ...dimensions])]);
  }
  // Installed only now: the drawing position helper is read with the size helper's general summary.
  for (const [summary, routine, values] of proved) install(summary, routine, values);
}

/**
 * A frame drawing value for a part of a known type: its type field becomes the type, and the type record's words that
 * point to the frames' offsets and sizes become the words in the program. A table read at a known address keeps its
 * address in the offset. The type record's frame list at `+0x14` is not read from the program: the program sets it
 * while a level runs.
 */
export function frameDrawingForType(
  e: Expression,
  type: number,
  typeOffset: number,
  table: { address: number; stride: number; words: number[][] } | undefined,
  build: Build,
  used: { table: boolean },
): Expression {
  if (e.kind === "field")
    return e.object === "part" && e.offset === typeOffset && e.width === 16 && !e.unresolved ? constant(type) : e;
  if (e.kind === "binary") {
    const left = frameDrawingForType(e.left, type, typeOffset, table, build, used),
      right = frameDrawingForType(e.right, type, typeOffset, table, build, used);
    const zero = (x: Expression) => x.kind === "constant" && x.value === 0;
    const one = (x: Expression) => x.kind === "constant" && x.value === 1;
    if (e.operator === "*" && (zero(left) || zero(right))) return constant(0, e.width);
    if (e.operator === "*" && one(left)) return right;
    if (e.operator === "*" && one(right)) return left;
    if (e.operator === "+" && zero(left)) return right;
    if ((e.operator === "+" || e.operator === "-") && zero(right)) return left;
    return left === e.left && right === e.right ? e : build(e.operator, left, right, e.width);
  }
  if (e.kind !== "table") return e;
  const index = frameDrawingForType(e.index, type, typeOffset, table, build, used);
  // A known part of the index goes into the offset: the address is the same.
  if (index.kind === "binary" && index.operator === "+" && index.left.kind === "constant")
    return { ...e, offset: (e.offset + index.left.value) & 0xffff, index: index.right };
  if (index.kind === "binary" && index.operator === "+" && index.right.kind === "constant")
    return { ...e, offset: (e.offset + index.right.value) & 0xffff, index: index.left };
  if (index.kind !== "constant") return index === e.index ? e : { ...e, index };
  const offset = (e.offset + index.value) & 0xffff;
  // Without a table of records one after another (TIM2.EXE reaches its records through pointers), no word is known.
  const at = table ? e.segment * 16 + offset - table.address - type * table.stride : -1;
  if (table && e.width === 16 && FRAME_TABLE_WORDS.includes(at) && table.words[type]?.[at / 2] !== undefined) {
    used.table = true;
    return constant(table.words[type]![at / 2]!);
  }
  return { ...e, offset, index: constant(0) };
}
