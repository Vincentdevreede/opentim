/** Compiles complete scalar return intervals into bounded ordinary expression algebra. */
import type { Expression, Predicate } from "./behaviour.ts";
import type { RoutineCode } from "./behaviour-code.ts";
import type { Instruction, Operand } from "./x86.ts";

export interface ScalarStep {
  expression: Expression;
  input: Expression;
  signed: boolean;
  width: number;
  intervals: { low: number; high: number; value: number }[];
}
type Algebra = (operator: string, left: Expression, right: Expression, width?: number) => Expression;
const constant = (value: number, width: number): Expression => ({ kind: "constant", value, width });
const wrap = (n: number, width: number) => ((n % 2 ** width) + 2 ** width) % 2 ** width;
const signed = (n: number, width: number) =>
  wrap(n, width) >= 2 ** (width - 1) ? wrap(n, width) - 2 ** width : wrap(n, width);
const opaque = (e: Expression): boolean =>
  e.kind === "unknown" ||
  (e.kind === "field" && (e.object === "data" || e.object.startsWith("data after "))) ||
  (e.kind === "binary" && (opaque(e.left) || opaque(e.right))) ||
  (e.kind === "table" && opaque(e.index));

/** Gaps, conflicting overlaps, other input expressions and unknown predicates retain the original path splitting. */
export function compileScalarStep(
  cases: { condition: Predicate; value: Expression }[],
  algebra: Algebra,
): ScalarStep | undefined {
  if (!cases.length || cases.length > 24 || cases.some((c) => c.value.kind !== "constant")) return;
  const width = cases[0]!.value.width;
  if (![8, 16].includes(width) || cases.some((c) => c.value.width !== width)) return;
  let input: Expression | undefined, isSigned: boolean | undefined;
  const intervals: ScalarStep["intervals"] = [];
  for (const item of cases) {
    const terms = (p: Predicate): Predicate[] =>
      p.kind === "and" ? p.terms.flatMap(terms) : p.kind === "true" ? [] : [p];
    const tests = terms(item.condition);
    let low = -Infinity,
      high = Infinity;
    for (const test of tests) {
      if (
        test.kind !== "compare" ||
        test.right.kind !== "constant" ||
        test.left.kind === "constant" ||
        opaque(test.left)
      )
        return;
      if (!input) {
        input = test.left;
        isSigned = test.signed;
      }
      if (
        JSON.stringify(input) !== JSON.stringify(test.left) ||
        isSigned !== test.signed ||
        ![8, 16].includes(input.width)
      )
        return;
      const n = isSigned ? signed(test.right.value, input.width) : wrap(test.right.value, input.width);
      if (test.operator === "<") high = Math.min(high, n - 1);
      else if (test.operator === "<=") high = Math.min(high, n);
      else if (test.operator === ">") low = Math.max(low, n + 1);
      else if (test.operator === ">=") low = Math.max(low, n);
      else if (test.operator === "==") {
        low = Math.max(low, n);
        high = Math.min(high, n);
      } else return;
    }
    intervals.push({ low, high, value: wrap((item.value as Extract<Expression, { kind: "constant" }>).value, width) });
  }
  if (!input || isSigned === undefined) return;
  const minimum = isSigned ? -(2 ** (input.width - 1)) : 0,
    maximum = isSigned ? 2 ** (input.width - 1) - 1 : 2 ** input.width - 1;
  const sorted = intervals
    .map((p) => ({ ...p, low: Math.max(minimum, p.low), high: Math.min(maximum, p.high) }))
    .filter((p) => p.low <= p.high)
    .sort((a, b) => a.low - b.low || a.high - b.high);
  const merged: ScalarStep["intervals"] = [];
  for (const next of sorted) {
    const previous = merged.at(-1);
    if (!previous) {
      if (next.low !== minimum) return;
      merged.push({ ...next });
      continue;
    }
    if (next.low > previous.high + 1 || (next.low <= previous.high && next.value !== previous.value)) return;
    if (next.value === previous.value) previous.high = Math.max(previous.high, next.high);
    else merged.push({ ...next });
  }
  if (!merged.length || merged.at(-1)!.high !== maximum) return;
  // Flipping the sign bit maps signed order to unsigned order, without a new public expression kind.
  const ordered = isSigned ? algebra("^", input, constant(2 ** (input.width - 1), input.width), input.width) : input;
  let expression = constant(merged[0]!.value, width);
  for (let n = 1; n < merged.length; n++) {
    const interval = merged[n]!,
      previous = merged[n - 1]!;
    const cut = isSigned ? wrap(interval.low, input.width) ^ (2 ** (input.width - 1)) : interval.low;
    const gate = algebra(">=", ordered, constant(cut, input.width), width);
    expression = algebra(
      "+",
      expression,
      algebra("*", gate, constant(wrap(interval.value - previous.value, width), width), width),
      width,
    );
    if (opaque(expression)) return;
  }
  return { expression, input, signed: isSigned, width, intervals: merged };
}

const reg = (o: Operand | undefined, name?: string): o is Extract<Operand, { kind: "register" }> =>
  o?.kind === "register" && (name === undefined || o.name === name);
const memory = (o: Operand | undefined): o is Extract<Operand, { kind: "memory" }> => o?.kind === "memory";
const writes = (i: Instruction) => i.flow === "next" && !["cmp", "test", "push", "nop"].includes(i.mnemonic);

/** Proves a leaf frame preserves the caller's nonvolatile registers and argument copies. */
export function pureScalarFrame(code: RoutineCode): boolean {
  if (code.status !== "complete" || code.calls.length || code.edges.some((e) => e.to === code.address)) return false;
  const all = code.instructions,
    [push, frame] = all;
  if (
    push?.mnemonic !== "push" ||
    !reg(push.operands[0], "bp") ||
    frame?.mnemonic !== "mov" ||
    !reg(frame.operands[0], "bp") ||
    !reg(frame.operands[1], "sp")
  )
    return false;
  let start = 2,
    locals = 0;
  const allocate = all[start];
  if (allocate?.mnemonic === "sub" && reg(allocate.operands[0], "sp") && allocate.operands[1]?.kind === "immediate") {
    locals = allocate.operands[1].value;
    if (locals < 0 || locals > 0x1000 || locals % 2) return false;
    start++;
  }
  const saved: string[] = [];
  while (
    all[start]?.mnemonic === "push" &&
    reg(all[start]!.operands[0]) &&
    ["si", "di"].includes((all[start]!.operands[0] as Extract<Operand, { kind: "register" }>).name)
  ) {
    const name = (all[start++]!.operands[0] as Extract<Operand, { kind: "register" }>).name;
    if (saved.includes(name)) return false;
    saved.push(name);
  }
  const returns = all.filter((i) => i.flow === "return");
  if (returns.length !== 1 || returns[0] !== all.at(-1) || !["ret", "retf"].includes(returns[0]!.mnemonic))
    return false;
  if (returns[0]!.operands[0]?.kind === "immediate" && returns[0]!.operands[0].value % 2) return false;
  let end = all.length - 2;
  if (all[end]?.mnemonic !== "pop" || !reg(all[end]!.operands[0], "bp")) return false;
  end--;
  const restore = all[end];
  if (restore?.mnemonic === "mov" && reg(restore.operands[0], "sp") && reg(restore.operands[1], "bp")) end--;
  else if (locals) return false;
  for (const name of saved) {
    if (all[end]?.mnemonic !== "pop" || !reg(all[end]!.operands[0], name)) return false;
    end--;
  }
  const firstPop = all[end + 1]!.address;
  for (let n = 0; n < start; n++) {
    const edges = code.edges.filter((e) => e.from === all[n]!.address);
    if (edges.length !== 1 || edges[0]!.to !== all[n + 1]?.address || edges[0]!.kind !== "next") return false;
  }
  for (let n = 1; n < all.length; n++) {
    if (
      (n < start || all[n]!.address > firstPop) &&
      (code.edges.filter((e) => e.to === all[n]!.address).length !== 1 ||
        !code.edges.some((e) => e.from === all[n - 1]!.address && e.to === all[n]!.address))
    )
      return false;
  }
  for (const i of all.slice(start, end + 1)) {
    if (
      /^(push|pop|movs|stos|lods|cmps|scas|ins|outs|int|iret|enter|leave|esc|bound|lds|std$|in$|out$|sti$|cli$|hlt$)/.test(
        i.mnemonic,
      )
    )
      return false;
    if (!writes(i)) continue;
    for (const o of i.mnemonic === "xchg" ? i.operands : i.operands.slice(0, 1)) {
      if (
        reg(o) &&
        (["sp", "bp", "ss", "ds"].includes(o.name) || (["si", "di"].includes(o.name) && !saved.includes(o.name)))
      )
        return false;
      if (
        memory(o) &&
        (o.segment !== "ss" ||
          o.base.join() !== "bp" ||
          o.displacement >= 0 ||
          o.displacement < -locals ||
          o.displacement + o.width / 8 > 0)
      )
        return false;
    }
  }
  return true;
}
