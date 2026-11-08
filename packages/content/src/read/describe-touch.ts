/**
 * The tests of a touch line in a short form: what the touching part and the touched part must be when one touches the
 * other. A bounce callback reaches the same writes on many paths, like the conveyor belt's on its 16. Each path's tests
 * become one value set per expression ("its contactEdge is 0", "its velocityX + 4096 is at most 4096"), so paths whose
 * tests differ only in the values one expression takes can be joined into one line, and a test that every value passes
 * drops out. Joining only ever unites whole paths, so a line holds exactly when one of its paths' tests hold.
 */
import type { Expression, Predicate } from "./behaviour.ts";
import { speedLimitOf } from "./behaviour.ts";

/** Ranges of a word's values, read unsigned, sorted and apart. */
type Ranges = [number, number][];
/** What one expression must be: a range of values, or for a test of two expressions, whether it holds. */
interface Test {
  /** A test compared with a number: the expression; else the test itself, in its first form. */
  subject: Expression | Extract<Predicate, { kind: "compare" }>;
  width: number;
  ranges: Ranges;
  /** Whether the code compared it signed, for the words. */
  signed: boolean;
}
/** A path's tests, by expression. */
export type Tests = Map<string, Test>;

const key = (value: unknown) => JSON.stringify(value);
const top = (width: number) => 2 ** width - 1;
const PAIRS: Record<string, [string, boolean]> = {
  "==": ["==", true],
  "!=": ["==", false],
  "<": ["<", true],
  ">=": ["<", false],
  "<=": ["<=", true],
  ">": ["<=", false],
};
const FLIP: Record<string, string> = { "==": "==", "!=": "!=", "<": ">", ">": "<", "<=": ">=", ">=": "<=" };

function normal(list: Ranges): Ranges {
  const sorted = list.filter(([a, b]) => a <= b).sort((x, y) => x[0] - y[0]);
  const out: Ranges = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
const intersect = (x: Ranges, y: Ranges): Ranges =>
  normal(x.flatMap(([a, b]) => y.map(([c, d]): [number, number] => [Math.max(a, c), Math.min(b, d)])));
const sameRanges = (x: Ranges, y: Ranges) => key(x) === key(y);
const within = (inner: Ranges, outer: Ranges) => sameRanges(intersect(inner, outer), inner);
/** The values of the word the ranges leave out. */
function complement(ranges: Ranges, width: number): Ranges {
  const out: Ranges = [];
  let next = 0;
  for (const [a, b] of ranges) {
    if (a > next) out.push([next, a - 1]);
    next = b + 1;
  }
  if (next <= top(width)) out.push([next, top(width)]);
  return out;
}

/** The values `x operator number` lets through, for a word of `width` bits read signed or not. */
function rangesOf(operator: string, number: number, width: number, signed: boolean): Ranges | undefined {
  const size = 2 ** width;
  const toSigned = (v: number) => (signed && v >= size / 2 ? v - size : v);
  const [low, high] = signed ? [-size / 2, size / 2 - 1] : [0, size - 1];
  const n = toSigned(number % size);
  const span: Ranges | undefined =
    operator === "=="
      ? [[n, n]]
      : operator === "!="
        ? [
            [low, n - 1],
            [n + 1, high],
          ]
        : operator === "<"
          ? [[low, n - 1]]
          : operator === "<="
            ? [[low, n]]
            : operator === ">"
              ? [[n + 1, high]]
              : operator === ">="
                ? [[n, high]]
                : undefined;
  if (!span) return undefined;
  // Back to unsigned: a signed range below zero is the top of the word.
  return normal(
    span.flatMap(([a, b]): Ranges => {
      if (a > b) return [];
      if (b < 0) return [[a + size, b + size]];
      if (a < 0)
        return [
          [a + size, size - 1],
          [0, b],
        ];
      return [[a, b]];
    }),
  );
}

/**
 * A path's tests by expression, or undefined when one of them isn't a comparison. A test of an expression with a
 * number narrows that expression's values; a test of two expressions is kept whole, as holding or not.
 */
export function testsOf(terms: Predicate[]): Tests | undefined {
  const tests: Tests = new Map();
  for (const term of terms) {
    if (term.kind !== "compare" || !PAIRS[term.operator]) return undefined;
    // A number on the left reads the other way round.
    const t =
      term.left.kind === "constant" && term.right.kind !== "constant"
        ? { ...term, left: term.right, right: term.left, operator: FLIP[term.operator]! }
        : term;
    if (t.right.kind === "constant" && t.left.kind !== "constant") {
      const width = t.left.width;
      const ranges = rangesOf(t.operator, t.right.value, width, t.signed);
      if (!ranges) return undefined;
      const at = key(t.left);
      const prior = tests.get(at);
      tests.set(at, {
        subject: t.left,
        width,
        ranges: prior ? intersect(prior.ranges, ranges) : ranges,
        signed: (prior?.signed ?? false) || t.signed,
      });
      continue;
    }
    const [operator, holds] = PAIRS[t.operator]!;
    const subject = { ...t, operator };
    const at = key(subject);
    const ranges: Ranges = [[holds ? 1 : 0, holds ? 1 : 0]];
    const prior = tests.get(at);
    tests.set(at, { subject, width: 1, ranges: prior ? intersect(prior.ranges, ranges) : ranges, signed: t.signed });
  }
  return simplified(tests);
}

/** The values an expression can take at all: `x & 7` only 0 to 7. */
function domain(e: Expression): Ranges {
  if (e.kind === "binary" && e.operator === "&" && e.right.kind === "constant")
    return [[0, e.right.value & top(e.width)]];
  return [[0, top(e.width)]];
}

/**
 * The tests said more simply, meaning the same. A test of `x << n` where x is known to stay below the bits the shift
 * keeps becomes a test of x, like the jump table index `(contactEdge << 1) == 4` with contactEdge at most 7, which is
 * contactEdge 2. A test every value the expression can take passes drops out, like `(x & 7) <= 7`.
 */
function simplified(tests: Tests): Tests {
  for (const [at, test] of [...tests]) {
    const s = test.subject;
    if (s.kind !== "binary" || s.operator !== "<<" || s.right.kind !== "constant" || s.left.width !== s.width) continue;
    const n = s.right.value;
    if (n < 1 || n >= s.width) continue;
    const below = tests.get(key(s.left));
    const known = below ? below.ranges : domain(s.left);
    // Only when x << n can't lose bits: then it is x times 2^n.
    if (!known.length || known.at(-1)![1] >= 2 ** (s.width - n)) continue;
    const step = 2 ** n;
    const values = normal(test.ranges.map(([a, b]): [number, number] => [Math.ceil(a / step), Math.floor(b / step)]));
    tests.delete(at);
    tests.set(key(s.left), {
      subject: s.left,
      width: s.width,
      ranges: intersect(known, values),
      signed: below?.signed ?? false,
    });
  }
  for (const [at, test] of [...tests])
    if (
      test.subject.kind !== "compare" &&
      sameRanges(intersect(test.ranges, domain(test.subject)), domain(test.subject))
    )
      tests.delete(at);
  return tests;
}

/** The comparisons that say a value set, or undefined when it isn't one range in the signed or the unsigned order. */
function compares(test: Test): Extract<Predicate, { kind: "compare" }>[] | undefined {
  const { subject, width, ranges } = test;
  if (ranges.length === 1 && ranges[0]![0] === 0 && ranges[0]![1] === top(width)) return [];
  if (subject.kind === "compare") {
    const holds = ranges[0]![0] === 1;
    if (holds) return [subject];
    const opposite = Object.entries(PAIRS).find(([, [base, h]]) => base === subject.operator && !h)![0];
    return [{ ...subject, operator: opposite }];
  }
  const size = 2 ** width;
  const number = (value: number): Expression => ({ kind: "constant", value: ((value % size) + size) % size, width });
  const compare = (operator: string, value: number, signed: boolean): Extract<Predicate, { kind: "compare" }> => ({
    kind: "compare",
    operator,
    left: subject,
    right: number(value),
    signed,
  });
  if (ranges.length === 1 && ranges[0]![0] === ranges[0]![1]) return [compare("==", ranges[0]![0], false)];
  // Every value but one.
  const missing = complement(ranges, width);
  if (missing.length === 1 && missing[0]![0] === missing[0]![1]) return [compare("!=", missing[0]![0], false)];
  for (const signed of test.signed ? [true, false] : [false, true]) {
    // In signed order the top half of the word comes first.
    const ordered = signed
      ? normal(
          ranges.flatMap(([a, b]): Ranges => [
            ...(a < size / 2 ? [[a, Math.min(b, size / 2 - 1)] as [number, number]] : []),
            ...(b >= size / 2 ? [[Math.max(a, size / 2) - size, b - size] as [number, number]] : []),
          ]),
        )
      : ranges;
    if (ordered.length !== 1) continue;
    const [a, b] = ordered[0]!;
    const [low, high] = signed ? [-size / 2, size / 2 - 1] : [0, size - 1];
    return [...(a > low ? [compare(">=", a, signed)] : []), ...(b < high ? [compare("<=", b, signed)] : [])];
  }
  return undefined;
}

/** The tests as comparisons, or undefined when one can't be said as a few comparisons. */
export function predicatesOf(tests: Tests): Predicate[] | undefined {
  const out: Predicate[] = [];
  for (const test of tests.values()) {
    const list = compares(test);
    if (!list) return undefined;
    out.push(...list);
  }
  return out;
}

/** Whether a path's tests let no value through. */
export const impossible = (tests: Tests) => [...tests.values()].some((t) => t.ranges.length === 0);

/** Every test drops out that lets every value through. */
function trimmed(tests: Tests): Tests {
  return new Map(
    [...tests].filter(([, t]) => !(t.ranges.length === 1 && t.ranges[0]![0] === 0 && t.ranges[0]![1] === top(t.width))),
  );
}

/** Whether every case `narrow` lets through, `wide` lets through as well. */
function covers(wide: Tests, narrow: Tests): boolean {
  return [...wide].every(([at, t]) => {
    const other = narrow.get(at);
    return !!other && within(other.ranges, t.ranges);
  });
}

/**
 * Joins the paths that lead to the same line: a path whose cases another path's tests already let through is left out,
 * and two paths whose tests differ only in one expression become one, with the values either lets through, when that
 * can still be said as comparisons. `join` merges what the two paths carry.
 */
export function joinPaths<T>(paths: { tests: Tests; value: T }[], join: (into: T, from: T) => void) {
  /** `joined` when the tests are no longer one path's own: then only `predicatesOf` says them. */
  const list = paths.map((p) => ({ tests: trimmed(p.tests), value: p.value, joined: false }));
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++)
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const [a, b] = [list[i]!, list[j]!];
        if (covers(a.tests, b.tests)) {
          join(a.value, b.value);
          list.splice(j, 1);
          changed = true;
          break outer;
        }
        if (a.tests.size !== b.tests.size || ![...a.tests.keys()].every((at) => b.tests.has(at))) continue;
        const differ = [...a.tests.keys()].filter(
          (at) => !sameRanges(a.tests.get(at)!.ranges, b.tests.get(at)!.ranges),
        );
        if (differ.length !== 1) continue;
        const at = differ[0]!;
        const [x, y] = [a.tests.get(at)!, b.tests.get(at)!];
        const united: Test = { ...x, ranges: normal([...x.ranges, ...y.ranges]), signed: x.signed || y.signed };
        if (!compares(united)) continue;
        const tests = trimmed(new Map(a.tests).set(at, united));
        if (!predicatesOf(tests)) continue;
        list[i] = { tests, value: a.value, joined: true };
        join(a.value, b.value);
        list.splice(j, 1);
        changed = true;
        break outer;
      }
  }
  return list;
}

/** How to name fields in words: a field's name, and whose it is, like "its velocityX" or "the alligator's positionX". */
export interface Names {
  field(offset: number): string;
  of(object: string, what: string): string;
  /** The name of a table word, like a part's speed limit, when it has one. */
  table?(e: Extract<Expression, { kind: "table" }>): string | undefined;
}

const isAbsolute = (e: Expression): Expression | undefined => {
  // The compiler's absolute value: (x ^ (x >> 15)) - (x >> 15).
  if (e.kind !== "binary" || e.operator !== "-" || e.left.kind !== "binary" || e.left.operator !== "^") return;
  const x = e.left.left;
  const isSign = (s: Expression) =>
    s.kind === "binary" &&
    s.operator === ">>" &&
    key(s.left) === key(x) &&
    s.right.kind === "constant" &&
    s.right.value === 15;
  return isSign(e.right) && isSign(e.left.right) ? x : undefined;
};
/** A centre, `positionX + (frameWidth >> 1)` and the same down, as the centre angle works it out. */
function centre(e: Expression, names: Names): { object: string; axis: string } | undefined {
  if (e.kind !== "binary" || e.operator !== "+" || e.left.kind !== "field") return undefined;
  const half = e.right;
  if (half.kind !== "binary" || half.operator !== ">>" || half.left.kind !== "field") return undefined;
  if (half.right.kind !== "constant" || half.right.value !== 1 || half.left.object !== e.left.object) return undefined;
  const [position, size] = [names.field(e.left.offset), names.field(half.left.offset)];
  const axis =
    position === "positionX" && size === "frameWidth"
      ? "X"
      : position === "positionY" && size === "frameHeight"
        ? "Y"
        : "";
  return axis ? { object: e.left.object, axis } : undefined;
}

/**
 * One half of a long that holds a word times a power of two: `(X << n) & 0xffff` is the low word and
 * `((X << n) >>> 16) & 0xffff` the high word, where `X = ((f >> 15) << 16) | f` is the word `f` widened with its sign.
 */
export function longPart(e: Expression): { word: Expression; shift: number; high: boolean } | undefined {
  if (e.kind !== "binary" || e.operator !== "&" || e.right.kind !== "constant" || e.right.value !== 0xffff) return;
  let value = e.left;
  const high = value.kind === "binary" && value.operator === ">>>";
  if (value.kind === "binary" && value.operator === ">>>") {
    if (value.right.kind !== "constant" || value.right.value !== 16) return undefined;
    value = value.left;
  }
  if (value.kind !== "binary" || value.operator !== "<<" || value.width !== 32 || value.right.kind !== "constant")
    return undefined;
  const shift = value.right.value;
  const widened = value.left;
  if (shift > 16 || widened.kind !== "binary" || widened.operator !== "|" || widened.width !== 32) return undefined;
  const [top, word] = [widened.left, widened.right];
  if (word.kind !== "field" || word.width !== 16) return undefined;
  if (top.kind !== "binary" || top.operator !== "<<" || top.right.kind !== "constant" || top.right.value !== 16)
    return undefined;
  const sign = top.left;
  if (sign.kind !== "binary" || sign.operator !== ">>" || sign.width !== 16 || key(sign.left) !== key(word))
    return undefined;
  if (sign.right.kind !== "constant" || sign.right.value !== 15) return undefined;
  return { word, shift, high };
}

/** An expression as a short formula, with field names, signed numbers and masks in hexadecimal. */
export function formula(e: Expression, names: Names, nested = false): string {
  if (e.kind === "constant") {
    const size = 2 ** e.width;
    return e.width <= 16 && e.value >= size / 2 ? String(e.value - size) : String(e.value);
  }
  // A query's answer is one value of that call, named by the call.
  if (e.kind === "field" && e.unresolved && /^answer of the query at /.test(e.object)) return `the ${e.object}`;
  if (e.kind === "field") return names.of(e.object, names.field(e.offset));
  if (e.kind === "binary") {
    // A value kept within a speed limit, as the game's speed limit routine keeps a velocity.
    const kept = speedLimitOf(e);
    if (kept) {
      const limit = kept.limit.kind === "table" ? names.table?.(kept.limit) : undefined;
      const text = `${formula(kept.speed, names, true)} kept within ${limit ? `its ${limit}` : `±${formula(kept.limit, names, true)}`}`;
      return nested ? `(${text})` : text;
    }
    const absolute = isAbsolute(e);
    if (absolute) return `|${formula(absolute, names)}|`;
    const middle = centre(e, names);
    if (middle) return names.of(middle.object, `centre ${middle.axis}`);
    if (e.operator === "-" && e.left.kind === "constant" && e.left.value === 0)
      return `-${formula(e.right, names, true)}`;
    const mask = ["&", "|", "^"].includes(e.operator) && e.right.kind === "constant";
    const right = mask
      ? `0x${(e.right as { value: number }).value.toString(16).padStart(4, "0")}`
      : formula(e.right, names, true);
    const text = `${formula(e.left, names, true)} ${e.operator} ${right}`;
    return nested ? `(${text})` : text;
  }
  if (e.kind === "table") return names.table?.(e) ?? "a table word";
  return "an unknown value";
}

const WORDS: Record<string, string> = {
  "==": "is",
  "!=": "is not",
  "<": "is below",
  "<=": "is at most",
  ">": "is above",
  ">=": "is at least",
};

/** One test in words, like "its contactEdge is 0" or "its contactAngle is below -2048 or above 2048". */
function testWords(test: Test, names: Names): string | undefined {
  const { subject, width, ranges } = test;
  if (subject.kind === "compare") {
    const [p] = compares(test)!;
    if (!p) return undefined;
    const unsigned = !p.signed && !["==", "!="].includes(p.operator) ? " (unsigned)" : "";
    return `${formula(p.left, names)} ${WORDS[p.operator] ?? p.operator} ${formula(p.right, names)}${unsigned}`;
  }
  const size = 2 ** width;
  const what = formula(subject, names);
  for (const signed of test.signed ? [true, false] : [false, true]) {
    const show = (v: number) => String(signed && v >= size / 2 ? v - size : v);
    const ordered = (list: Ranges) =>
      signed
        ? normal(
            list.flatMap(([a, b]): Ranges => [
              ...(a < size / 2 ? [[a, Math.min(b, size / 2 - 1)] as [number, number]] : []),
              ...(b >= size / 2 ? [[Math.max(a, size / 2) - size, b - size] as [number, number]] : []),
            ]),
          )
        : list;
    const [low, high] = signed ? [-size / 2, size / 2 - 1] : [0, size - 1];
    const unsigned = signed ? "" : " (unsigned)";
    const kept = ordered(ranges);
    const out = ordered(complement(ranges, width));
    if (kept.length === 1 && kept[0]![0] === kept[0]![1]) return `${what} is ${show(kept[0]![0])}`;
    if (out.length === 1 && out[0]![0] === out[0]![1]) return `${what} is not ${show(out[0]![0])}`;
    if (kept.length === 1) {
      const [a, b] = kept[0]!;
      if (a === low) return `${what} is at most ${b}${unsigned}`;
      if (b === high) return `${what} is at least ${a}${unsigned}`;
      return `${what} is between ${a} and ${b}${unsigned}`;
    }
    if (out.length === 1 && out[0]![0] > low && out[0]![1] < high)
      return `${what} is not between ${out[0]![0]} and ${out[0]![1]}${unsigned}`;
  }
  return undefined;
}

/**
 * The tests one by one: their comparisons, the objects they read, and their words. Undefined when one can't be said
 * as a few comparisons.
 */
export function testsInWords(
  tests: Tests,
): { predicates: Predicate[]; objects: Set<string>; words: (names: Names) => string }[] | undefined {
  const out = [];
  for (const test of tests.values()) {
    const predicates = compares(test);
    if (!predicates) return undefined;
    const objects = new Set<string>();
    const visit = (e: Expression | Predicate) => {
      if (e.kind === "field") objects.add(e.object);
      else if (e.kind === "binary" || e.kind === "compare") {
        visit(e.left);
        visit(e.right);
      } else if (e.kind === "table") visit(e.index);
    };
    visit(test.subject);
    out.push({
      predicates,
      objects,
      words: (names: Names) =>
        testWords(test, names) ??
        predicates.map((p) => compareWords(p as Extract<Predicate, { kind: "compare" }>, names)).join(" and "),
    });
  }
  return out;
}

/** A comparison in words, like "its contactEdge is 0", with "(unsigned)" where the order is the unsigned one. */
export function compareWords(p: Extract<Predicate, { kind: "compare" }>, names: Names): string {
  const unsigned = !p.signed && !["==", "!="].includes(p.operator) ? " (unsigned)" : "";
  return `${formula(p.left, names)} ${WORDS[p.operator] ?? p.operator} ${formula(p.right, names)}${unsigned}`;
}
