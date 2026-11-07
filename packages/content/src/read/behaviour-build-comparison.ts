/**
 * What the build comparison of `extract-behaviour` compares of a part: its findings without what moves between builds
 * (addresses, the offsets of globals, evidence) and with values that are equal written one way (a chain in any order, a
 * choice as its cases, two shifts as one). Builds of one game then compare equal where they do the same.
 */
import { choiceOf, OPPOSITE, type BehaviourReport, type Expression } from "./behaviour.ts";

/** Hides code and data addresses in a value's name (they move between builds), keeping offsets after a `+`. */
const withoutAddresses = (text: string) =>
  text.replace(/\b(at|by|helper|destination|table) 0x[0-9a-f]+/gi, "$1 <address>");

/** The key a value sorts by: its JSON without the build's own global offsets, which `numberGlobals` marks. */
const sortKey = (value: unknown) => JSON.stringify(value, (key, child) => (key === "globalOffset" ? undefined : child));

/** The number a shift shifts by, when it is a number. */
const shiftOf = (item: Record<string, unknown>) => {
  const right = item.right as Record<string, unknown> | undefined;
  return right?.kind === "constant" && typeof right.value === "number" ? right.value : undefined;
};

/**
 * A value `choose` made, as its cases: each way through its tests, with the tests it takes and the value it gives.
 * Two ways that give the same value and differ only in one test, taken one way and the other, are one way without it.
 * Where the code is laid out differently, a build tests a choice's conditions in another order (the cat and the vacuum
 * cleaner in the Even More CD build); as cases, both give the same list.
 */
function choiceCases(value: Expression): { tests: unknown[]; value: unknown }[] | undefined {
  if (!choiceOf(value)) return undefined;
  const ways: { tests: Map<string, unknown>; value: unknown }[] = [];
  const walk = (e: Expression, tests: Map<string, unknown>): void => {
    const choice = choiceOf(e);
    if (!choice) {
      ways.push({ tests, value: semantic(e) });
      return;
    }
    const opposite = { ...choice.test, operator: OPPOSITE[choice.test.operator]! };
    for (const [test, next] of [
      [choice.test, choice.then],
      [opposite, choice.otherwise],
    ] as const) {
      const t = semantic(test);
      walk(next, new Map([...tests, [sortKey(t), t]]));
    }
  };
  walk(value, new Map());
  const oppositeKey = (key: string) => {
    const test = JSON.parse(key) as Record<string, unknown>;
    return sortKey({ ...test, operator: OPPOSITE[test.operator as string] });
  };
  for (let merged = true; merged;) {
    merged = false;
    search: for (let i = 0; i < ways.length; i++)
      for (let j = i + 1; j < ways.length; j++) {
        const [a, b] = [ways[i]!, ways[j]!];
        if (sortKey(a.value) !== sortKey(b.value) || a.tests.size !== b.tests.size) continue;
        const only = [...a.tests.keys()].filter((key) => !b.tests.has(key));
        if (only.length !== 1 || !b.tests.has(oppositeKey(only[0]!))) continue;
        a.tests.delete(only[0]!);
        ways.splice(j, 1);
        merged = true;
        break search;
      }
  }
  return ways
    .map((way) => ({
      tests: [...way.tests.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([, t]) => t),
      value: way.value,
    }))
    .sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
}

/** The terms of a condition: the terms of an "and", one test, or none. */
const conditionTerms = (condition: Record<string, unknown>): unknown[] | undefined =>
  condition.kind === "and" && Array.isArray(condition.terms)
    ? condition.terms
    : condition.kind === "compare"
      ? [condition]
      : condition.kind === "true"
        ? []
        : undefined;

/**
 * Findings that are the same but for one test of their condition, taken one way in one and the other way in the other,
 * are one finding without that test. The Even More CD build's vacuum cleaner tests whether its frame changed before
 * the same drawing either way, where the floppy doesn't test it.
 */
function mergeOpposites(items: unknown[]): unknown[] {
  let list = [...items];
  for (let merged = true; merged;) {
    merged = false;
    // Each finding once for each of its tests: the finding without its condition, its other tests, and the test with
    // its opposite as one key. A finding that meets one with the same key and the test the other way is merged.
    const seen = new Map<string, { index: number; key: number }>();
    const gone = new Set<number>();
    const next: unknown[] = [];
    // Long keys as short numbers, so a finding's key stays small however large the finding is.
    const numbers = new Map<string, number>();
    const number = (text: string) => numbers.get(text) ?? numbers.set(text, numbers.size).size - 1;
    list.forEach((value, index) => {
      const item = value as Record<string, unknown>;
      const terms =
        item?.condition && typeof item.condition === "object" ? conditionTerms(item.condition as never) : undefined;
      if (!terms?.length || !terms.some((term) => (term as Record<string, unknown>).kind === "compare")) return;
      const base = number(sortKey({ ...item, condition: null }));
      const keys = terms.map((term) => number(sortKey(term)));
      for (const [n, term] of terms.entries()) {
        const test = term as Record<string, unknown>;
        if (test.kind !== "compare" || !OPPOSITE[test.operator as string]) continue;
        const key = keys[n]!;
        const opposite = number(sortKey({ ...test, operator: OPPOSITE[test.operator as string] }));
        const others = keys.filter((_, m) => m !== n).sort((a, b) => a - b);
        const id = `${base}|${others.join(",")}|${Math.min(key, opposite)},${Math.max(key, opposite)}`;
        const other = seen.get(id);
        if (other && other.key === opposite && !gone.has(other.index) && !gone.has(index)) {
          const rest = terms.filter((_, m) => m !== n);
          gone.add(other.index).add(index);
          next.push({
            ...item,
            condition:
              rest.length === 0 ? { kind: "true" } : rest.length === 1 ? rest[0] : { kind: "and", terms: rest },
          });
          merged = true;
          return;
        }
        if (!other) seen.set(id, { index, key });
      }
    });
    if (merged) list = [...list.filter((_, index) => !gone.has(index)), ...next];
  }
  return list;
}

/** Removes evidence locations from semantic comparisons while keeping part field offsets. */
export function semantic(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = mergeOpposites(value.map(semantic));
    return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()]
      .map((item) => [sortKey(item), item] as const)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, item]) => item);
  }
  if (value === null || typeof value !== "object") return value;
  const item = value as Record<string, unknown>;
  const cases = choiceCases(item as unknown as Expression);
  if (cases) return { kind: "cases", width: item.width, cases };
  // These give the same value with their sides swapped. A build whose code is laid out the other way round writes a
  // choice's two ways in the other order (the dynamite plunger in the Even More CD build).
  // Two shifts by numbers are one shift: one build shifts a frame twice by 1 where another shifts it once by 2 (the
  // teeter-totter's reset tables in TIM 1).
  if (item.kind === "binary" && item.operator === "<<" && typeof shiftOf(item) === "number") {
    const inner = item.left as Record<string, unknown>;
    if (inner?.kind === "binary" && inner.operator === "<<" && typeof shiftOf(inner) === "number")
      return semantic({
        ...item,
        left: inner.left,
        right: { ...(item.right as object), value: shiftOf(inner)! + shiftOf(item)! },
      });
  }
  if (item.kind === "binary" && ["+", "*", "&", "|", "^"].includes(item.operator as string)) {
    // A chain of one of these gives the same value in any grouping and order. Where the code is laid out differently, a
    // build nests a choice's ways the other way (the cat and the vacuum cleaner in the Even More CD build), so the chain
    // is flattened, its terms sorted and nested again from the left.
    const terms: unknown[] = [];
    const collect = (value: unknown) => {
      const term = value as Record<string, unknown>;
      if (term?.kind === "binary" && term.operator === item.operator && term.width === item.width) {
        collect(term.left);
        collect(term.right);
      } else terms.push(semantic(value));
    };
    collect(item);
    const sorted = terms.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return sorted.slice(1).reduce((left, right) => ({ ...item, left, right }), sorted[0]);
  }
  if (item.kind === "and" && Array.isArray(item.terms)) {
    const terms = (item.terms as unknown[]).flatMap((term) =>
      (term as Record<string, unknown>)?.kind === "and"
        ? ((term as Record<string, unknown>).terms as unknown[])
        : [term],
    );
    if (terms.length !== item.terms.length) return semantic({ ...item, terms });
  }
  return Object.fromEntries(
    Object.entries(item)
      .filter(
        ([key]) =>
          !["evidence", "routine", "address", "segment", "assumptions", "uncertainties", "call"].includes(key) &&
          !(item.kind === "table" && key === "offset"),
      )
      .map(([key, child]) => [
        key,
        ["reason", "object"].includes(key) && typeof child === "string"
          ? withoutAddresses(child)
          : key === "runValues" && Array.isArray(child)
            ? semantic(child.map((name) => (typeof name === "string" ? withoutAddresses(name) : name)))
            : semantic(child),
      ]),
  );
}

function unresolved(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(unresolved);
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (
    item.confidence === "unresolved" ||
    item.kind === "unknown" ||
    item.kind === "table" ||
    (item.kind === "field" && item.object === "data")
  )
    return true;
  return Object.entries(item).some(
    ([key, child]) => !["evidence", "assumptions", "uncertainties"].includes(key) && unresolved(child),
  );
}

/** Maps every global of the data segment in a value, like a brick wall's test of a global. */
function mapGlobals(value: unknown, map: (offset: number) => Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => mapGlobals(item, map));
  if (value === null || typeof value !== "object") return value;
  const item = value as Record<string, unknown>;
  const mapped = Object.fromEntries(Object.entries(item).map(([key, child]) => [key, mapGlobals(child, map)]));
  return item.kind === "field" && item.object === "data" && typeof item.offset === "number"
    ? { ...mapped, ...map(item.offset) }
    : mapped;
}

/**
 * Globals sit at other offsets in every build, and nothing in one build says which global of another it is. So a part's
 * globals are numbered in the order its findings use them, sorted as if every global were the same: "global 1" is the
 * first one used. Two builds compare equal when they use their globals in the same places, as the TIM 1 builds and the
 * Even More builds do; which global it is in each build stays out of the comparison.
 */
function numberGlobals(findings: Record<string, unknown[]>): Record<string, unknown[]> {
  const marked = mapGlobals(findings, (offset) => ({ offset: "global", globalOffset: offset }));
  const order = new Map<number, number>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === "object") {
      const item = value as Record<string, unknown>;
      if (typeof item.globalOffset === "number" && !order.has(item.globalOffset))
        order.set(item.globalOffset, order.size + 1);
      Object.keys(item)
        .sort()
        .forEach((key) => visit(item[key]));
    }
  };
  visit(semantic(marked));
  return mapGlobals(findings, (offset) => ({ offset: `global ${order.get(offset)}` })) as Record<string, unknown[]>;
}

export function partSemantics(part: BehaviourReport["parts"][number], report: BehaviourReport) {
  const findings: Record<string, unknown[]> = {
    routines: part.routines.map(({ slot, role, shared, sharedDefault, confidence }) => ({
      slot,
      role,
      shared,
      sharedDefault,
      confidence,
    })),
    stateWrites: part.stateWrites,
    transitions: part.transitions,
    counters: part.counters,
    reset: part.reset,
    visibleEffects: part.visibleEffects,
    triggers: part.triggers,
    creation: (report.creation ?? [])
      .filter((source) => source.partType === part.type)
      .map(({ source, fields, confidence }) => ({ source, fields, confidence })),
  };
  const numbered = numberGlobals(findings);
  return {
    resolved: Object.fromEntries(
      Object.entries(numbered).map(([key, items]) => [key, semantic(items.filter((item) => !unresolved(item)))]),
    ),
    unresolved: Object.fromEntries(
      Object.entries(numbered).map(([key, items]) => [key, semantic(items.filter(unresolved))]),
    ),
  };
}
