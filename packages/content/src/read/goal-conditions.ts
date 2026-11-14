/**
 * Says a goal program (`puzzle-goals.ts`) as a few conditions on the parts, for a level view: "every bowling ball on
 * the moving list: positionY = 264", "some baseball: 24 ≤ positionX ≤ 243", "the first basketball", "fewer than 2
 * balloons with state = 0", or a test of a word like the step count. A place test becomes an area of the level.
 *
 * The program is run symbolically: every word is kept as an expression of the parts' fields and the words the step
 * started with, a walk over the parts becomes "some part where …" or "how many parts where …", and the tests that lead
 * to "the goal is met" are gathered into ways, each a list of conditions that must all hold. A goal that does
 * something these shapes can't say, like a walk that looks at the parts it saw before, gets no conditions but the
 * reason, and stays readable as its program (`describe-goals.ts`).
 */
import { masked, ordinal, PART_SIZE, shape, withoutSaves, type GoalNames, type Shown } from "./describe-goals.ts";
import {
  FAR_WORDS,
  farWord,
  type GoalComparison,
  type GoalOperator,
  type GoalProblem,
  type GoalRoutine,
  type GoalTest,
  type GoalValue,
} from "./puzzle-goals.ts";

/** A place a part has to be in: the inclusive range of its positionX and positionY, open where a side isn't tested. */
export interface GoalArea {
  x: { min?: number; max?: number };
  y: { min?: number; max?: number };
}

export interface GoalCondition {
  /**
   * `every`: each part of the types on the lists passes the tests (`where`, when given, picks the parts it holds for).
   * `none`: no part of the types on the lists passes `where`. `some`: at least one passes the tests. `first`/`last`:
   * the first part a search finds, or the last one a walk keeps. `count`: how many parts pass `where`, against a number.
   * `word`: a test of a word of the game's memory, like the step count. `part`: one part of the level, by `part`.
   * `nth`: the n-th part of its type on the lists, as Toons' goals find their parts, by `nth`.
   */
  kind: "every" | "none" | "some" | "first" | "last" | "count" | "word" | "part" | "nth";
  /** For `part`: the part's index in the level. */
  part?: number;
  /** For `nth`: which part of the type, from 1. */
  nth?: number;
  /**
   * When the tests needn't hold now: `so far` when they held at some step of the run up to this one, `before` when
   * at some step before this one. A goal remembers it in a word it keeps.
   */
  once?: "so far" | "before";
  /** With `once`: the tests held at no step of that time. */
  never?: boolean;
  /** With `once`: at how many steps of that time the tests held, against a number. A goal counts them in a word. */
  steps?: { op: GoalComparison; value: number };
  /**
   * The last step at which the tests held was this many steps before this one (`afterFirst`: and it wasn't the first
   * step). A goal keeps the step count of that step in a word.
   */
  ago?: { steps: number; afterFirst?: boolean };
  /**
   * For `nth`: the condition is about the part a field of the n-th part holds, like Al's angel, by the field's name.
   * `kept`: the part the field held at the last step at which the condition before it held, which the goal keeps.
   */
  via?: { name: string; kept?: boolean };
  /** The lists the parts are on, like "the moving list". */
  lists?: string;
  /** The part types, by number and name; none means parts of any type. */
  types?: { type: number; name: string }[];
  /** Tests that pick the parts the condition is about. */
  where?: string[];
  /** What must hold. */
  tests: string[];
  /** For `count`: the comparison and the number. */
  count?: { op: GoalComparison; value: number };
  /** Where the parts must be, when the tests on their place are ranges. */
  area?: GoalArea;
}

export interface GoalSummary {
  /** The goal is met when all conditions of one of the ways hold. Empty when the goal doesn't fit these shapes. */
  ways: GoalCondition[][];
  /** Words of memory the goal keeps from step to step, and what each one becomes. */
  remembered: { word: string; becomes: string[] }[];
  /** Why the goal can't be said as conditions, when it can't. */
  problem?: string;
}

const TYPE = 0x04;
/** More ways than this and the conditions say less than the program. */
const MOST_WAYS = 6;
/** How deep a routine may call itself before it counts as never stopping. */
const MOST_CALLS = 8;
/**
 * How many routines a goal may run in all, counting every call, before it counts as never stopping. A routine that calls
 * itself on both ways of a test doubles the runs at every level; shipped goals run at most 2.
 */
const MOST_RUNS = 64;

type Routines = ReadonlyMap<number, GoalRoutine | GoalProblem>;

/** A walk over lists of parts; with `type`, over the parts of that type only, in their order on the lists. */
interface Walked {
  id: number;
  lists: string;
  type?: number;
}

type PartRef =
  | { kind: "each"; walk: Walked }
  /** The first part of a walk where `where` holds. */
  | { kind: "first"; walk: Walked; where: Formula }
  /** The last part of a walk where `where` holds. */
  | { kind: "last"; walk: Walked; where: Formula }
  /** The n-th part of a type on the lists, from the finder; the goal keeps it from its first step. */
  | { kind: "nth"; type: number; nth: number; lists: string }
  /**
   * The part a field of another part holds. With `at`, the part it held at the last step at which `at.item` held,
   * which the goal keeps in a word.
   */
  | { kind: "via"; from: PartRef; offset: number; at?: { item: Formula; before: boolean } };

type Sym =
  | { kind: "constant"; value: number }
  | { kind: "part"; ref: PartRef }
  | { kind: "field"; ref: PartRef; offset: number }
  /** A word of the data segment as the step left it before the goal. */
  | { kind: "word"; address: number }
  | { kind: "binary"; op: GoalOperator; left: Sym; right: Sym }
  | { kind: "ite"; when: Formula; then: Sym; else: Sym }
  /** How many parts of a walk pass `where`. */
  | { kind: "count"; walk: Walked; where: Formula }
  /** A word a walk changes, as it is when the walk comes to a part. */
  | { kind: "carried"; key: string }
  | { kind: "unset"; why: string }
  /**
   * The step count of the last step at which `item` held, or `first` when it never did: a word a goal sets to the
   * step count whenever a test holds. `steps` is the step count word.
   */
  | { kind: "stamp"; item: Formula; before: boolean; first: number; steps: number }
  /** `first` plus how many steps `item` held at: a word a goal adds 1 to whenever a test holds. */
  | { kind: "tally"; item: Formula; before: boolean; first: number }
  /** How many parts a walk over parts of one type has come to before this one: a counter that steps along a table. */
  | { kind: "index"; walk: Walked };

type Formula =
  | { kind: "true" }
  | { kind: "false" }
  /** `exact`: the sum on the left is compared as a number, without the overflow of a word. */
  | { kind: "test"; op: GoalComparison; signed: boolean; left: Sym; right: Sym; exact?: boolean }
  | { kind: "and"; items: Formula[] }
  | { kind: "or"; items: Formula[] }
  | { kind: "not"; item: Formula }
  /** `then` when `when` holds, else `else`: a test of a word that is one of two values. */
  | { kind: "choose"; when: Formula; then: Formula; else: Formula }
  | { kind: "some"; walk: Walked; where: Formula }
  /**
   * `item` held at some step: of the run so far, this step included, or (`before`) before this step. A word a goal
   * keeps, set to 0 in its first step and to 1 whenever a test holds, says this.
   */
  | { kind: "ever"; item: Formula; before: boolean; afterFirst?: boolean }
  /** The last step at which `item` held, so far or before this one, was `steps` steps before this one. */
  | { kind: "ago"; item: Formula; before: boolean; steps: number }
  /** How many steps `item` held at, so far or before this one, against a number. */
  | { kind: "times"; item: Formula; before: boolean; op: GoalComparison; value: number };

class DoesntFit extends Error {}

const TRUE: Formula = { kind: "true" };
const FALSE: Formula = { kind: "false" };
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** A number as a word; a place of a far segment (`FAR_WORDS` and up) stays as it is. */
const constant = (value: number): Sym => ({ kind: "constant", value: value >= FAR_WORDS ? value : value & 0xffff });
const signed16 = (value: number) => (value >= 0x8000 ? value - 0x10000 : value);
const hex = (value: number) => `0x${value.toString(16)}`;

/** Whether something holds a sym or formula `found` says yes to, at any depth. */
function holds(value: unknown, found: (node: { kind?: string }) => boolean): boolean {
  if (!value || typeof value !== "object") return false;
  if (found(value as { kind?: string })) return true;
  return Object.values(value).some((v) => holds(v, found));
}
const carries = (value: unknown) => holds(value, (n) => n.kind === "carried");

function and(...items: Formula[]): Formula {
  const out: Formula[] = [];
  for (const item of items.flatMap((i) => (i.kind === "and" ? i.items : [i]))) {
    if (item.kind === "false") return FALSE;
    if (item.kind !== "true" && !out.some((o) => same(o, item))) out.push(item);
  }
  return out.length === 0 ? TRUE : out.length === 1 ? out[0]! : { kind: "and", items: out };
}

function or(...items: Formula[]): Formula {
  const out: Formula[] = [];
  for (const item of items.flatMap((i) => (i.kind === "or" ? i.items : [i]))) {
    if (item.kind === "true") return TRUE;
    if (item.kind !== "false" && !out.some((o) => same(o, item))) out.push(item);
  }
  return out.length === 0 ? FALSE : out.length === 1 ? out[0]! : { kind: "or", items: out };
}

const NEGATED: Record<GoalComparison, GoalComparison> = {
  "==": "!=",
  "!=": "==",
  "<": ">=",
  "<=": ">",
  ">": "<=",
  ">=": "<",
};

/** The comparison with its sides swapped. */
const FLIPPED: Record<GoalComparison, GoalComparison> = {
  "==": "==",
  "!=": "!=",
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
};

/**
 * A test of a word a goal keeps from step to step as what happened: the step it keeps against the step count ("30
 * steps after it last held"), or against the value it starts with, and a count of steps against a number. Undefined
 * when neither side is such a word.
 */
function history(op: GoalComparison, left: Sym, right: Sym): Formula | undefined {
  const added = left.kind === "binary" && left.op === "+" && left.right.kind === "constant" ? left : undefined;
  const stamp = left.kind === "stamp" ? left : added?.left.kind === "stamp" ? added.left : undefined;
  if (stamp) {
    const plus = added ? signed16((added.right as { value: number }).value) : 0;
    if ((op === "==" || op === "!=") && right.kind === "word" && right.address === stamp.steps && plus >= 0) {
      const ago: Formula = { kind: "ago", item: stamp.item, before: stamp.before, steps: plus };
      return op === "==" ? ago : not(ago);
    }
    // The step it keeps is the first step's count, 0, until the test holds at a later step.
    if ((op === "==" || op === "!=") && !added && right.kind === "constant" && right.value === stamp.first) {
      if (stamp.first !== 0) throw new DoesntFit("it keeps a step and starts it at a step other than the first");
      const ever: Formula = { kind: "ever", item: stamp.item, before: stamp.before, afterFirst: true };
      return op === "!=" ? ever : not(ever);
    }
    throw new DoesntFit("it works with a step it keeps in a way the conditions can't say");
  }
  if (left.kind === "tally") {
    if (right.kind !== "constant")
      throw new DoesntFit("it compares a count of steps with something other than a number");
    return { kind: "times", item: left.item, before: left.before, op, value: signed16(right.value) - left.first };
  }
  return undefined;
}

function not(f: Formula): Formula {
  switch (f.kind) {
    case "true":
      return FALSE;
    case "false":
      return TRUE;
    case "not":
      return f.item;
    case "test":
      return { ...f, op: NEGATED[f.op] };
    case "choose":
      return choose(f.when, not(f.then), not(f.else));
    default:
      return { kind: "not", item: f };
  }
}

function choose(when: Formula, then: Formula, otherwise: Formula): Formula {
  if (when.kind === "true" || same(then, otherwise)) return then;
  if (when.kind === "false") return otherwise;
  if (then.kind === "false") return and(not(when), otherwise);
  if (otherwise.kind === "false") return and(when, then);
  if (then.kind === "true") return or(when, otherwise);
  if (otherwise.kind === "true") return or(not(when), then);
  return { kind: "choose", when, then, else: otherwise };
}

function ite(when: Formula, then: Sym, otherwise: Sym): Sym {
  if (when.kind === "true" || same(then, otherwise)) return then;
  if (when.kind === "false") return otherwise;
  return { kind: "ite", when, then, else: otherwise };
}

function binary(op: GoalOperator, left: Sym, right: Sym): Sym {
  if (left.kind === "ite") return ite(left.when, binary(op, left.then, right), binary(op, left.else, right));
  if (right.kind === "ite") return ite(right.when, binary(op, left, right.then), binary(op, left, right.else));
  if (left.kind === "constant" && right.kind === "constant") {
    const l = left.value;
    const r = right.value;
    // A place in a far segment plus or less a number, like `es:[bx + 0x7584]`, is another place of that segment.
    if (l >= FAR_WORDS || r >= FAR_WORDS) {
      const far = farWord(Math.max(l, r))!;
      const other = l >= FAR_WORDS ? r : l;
      if ((op === "+" && other < FAR_WORDS) || (op === "-" && r < FAR_WORDS && l >= FAR_WORDS))
        return constant(FAR_WORDS + far.segment * 0x10000 + ((far.offset + (op === "+" ? other : -other)) & 0xffff));
      throw new DoesntFit("it works out a place in a far segment in a way it can't follow");
    }
    switch (op) {
      case "+":
        return constant(l + r);
      case "-":
        return constant(l - r);
      case "&":
        return constant(l & r);
      case "|":
        return constant(l | r);
      case "^":
        return constant(l ^ r);
      case "<<":
        return constant(l << (r & 0x1f));
      case ">>":
        return constant(signed16(l) >> Math.min(r & 0x1f, 15));
      case ">>>":
        return constant(l >>> (r & 0x1f));
      case "/":
      case "%":
        if (!r) throw new DoesntFit("it divides by 0");
        return constant(op === "/" ? Math.trunc(signed16(l) / signed16(r)) : signed16(l) % signed16(r));
    }
  }
  if (right.kind === "constant" && right.value === 0 && ["+", "-", "|", "^", "<<", ">>", ">>>"].includes(op))
    return left;
  if (left.kind === "constant" && left.value === 0 && ["+", "|", "^"].includes(op)) return right;
  if (op === "-" && right.kind === "constant") return binary("+", left, constant(-right.value));
  if (op === "+" && left.kind === "binary" && left.op === "+" && left.right.kind === "constant")
    if (right.kind === "constant") return binary("+", left.left, constant(left.right.value + right.value));
  return { kind: "binary", op, left, right };
}

function compare(op: GoalComparison, isSigned: boolean, l: number, r: number): boolean {
  return compareNumbers(op, isSigned ? signed16(l) : l, isSigned ? signed16(r) : r);
}

/** Two numbers compared as numbers. */
function compareNumbers(op: GoalComparison, a: number, b: number): boolean {
  return op === "=="
    ? a === b
    : op === "!="
      ? a !== b
      : op === "<"
        ? a < b
        : op === "<="
          ? a <= b
          : op === ">"
            ? a > b
            : a >= b;
}

function test(op: GoalComparison, isSigned: boolean, left: Sym, right: Sym): Formula {
  if (left.kind === "ite")
    return choose(left.when, test(op, isSigned, left.then, right), test(op, isSigned, left.else, right));
  if (right.kind === "ite")
    return choose(right.when, test(op, isSigned, left, right.then), test(op, isSigned, left, right.else));
  if (left.kind === "constant" && right.kind === "constant")
    return compare(op, isSigned, left.value, right.value) ? TRUE : FALSE;
  const remembered = history(op, left, right) ?? history(FLIPPED[op], right, left);
  if (remembered) return remembered;
  // How many parts of a walk pass a test against how many pass a test that takes in fewer: all or not all of them.
  if ((op === "==" || op === "!=") && left.kind === "count" && right.kind === "count" && same(left.walk, right.walk)) {
    const [a, b] = [left.where, right.where].map((w) => (w.kind === "and" ? w.items : [w])) as [Formula[], Formula[]];
    const [base, more] = a.length <= b.length ? [a, b] : [b, a];
    const extra = more.filter((m) => !base.some((x) => same(m, x)));
    if (extra.length && extra.length === more.length - base.length) {
      // Equal when no part that passes the shorter test fails the rest of the longer one.
      const some: Formula = { kind: "some", walk: left.walk, where: and(...base, not(and(...extra))) };
      return op === "==" ? not(some) : some;
    }
  }
  // A constant goes on the right, and a constant added on the left moves over for an equality.
  if (left.kind === "constant") return test(FLIPPED[op], isSigned, right, left);
  if (
    (op === "==" || op === "!=") &&
    right.kind === "constant" &&
    left.kind === "binary" &&
    left.op === "+" &&
    left.right.kind === "constant"
  )
    return test(op, isSigned, left.left, constant(right.value - left.right.value));
  if (same(left, right)) return compare(op, isSigned, 0, 0) ? TRUE : FALSE;
  return { kind: "test", op, signed: isSigned, left, right };
}

/** The cases of a sym: each value it can have, and when. */
function cases(value: Sym, when: Formula = TRUE): { when: Formula; value: Sym }[] {
  if (value.kind !== "ite") return [{ when, value }];
  return [...cases(value.then, and(when, value.when)), ...cases(value.else, and(when, not(value.when)))];
}

type Env = Map<string, Sym>;

interface State {
  env: Env;
  /** When the program still runs at this point. */
  alive: Formula;
}

/**
 * What a goal that sets up its words in its first step keeps in them, as `summariseGoal` finds it: the words that keep
 * a part the finder found, and the words that remember that something happened (0 at first, and 1 from the step
 * where a test held).
 */
interface Kept {
  /** Words set to a part the finder found, or to something else worked out from the parts, and never written after. */
  parts: ReadonlyMap<number, Sym>;
  /** Words that remember what happened, by address. */
  latches: ReadonlyMap<number, Latch>;
  /** Whether reading another word the first step set up doesn't fit: the last pass. */
  strict: boolean;
}

/**
 * A word set to `first` in the first step's setup that the steps change as a sign of what happened. `end` is what it
 * holds after every write of a step, with the word as the step left it as such.
 *
 * - `latch`: set to `value` when `when` holds;
 * - `stamp`: set to the step count when `when` holds;
 * - `tally`: 1 added when `when` holds;
 * - `link`: set to the part `field` (a field of a found part) holds when `when` holds;
 * - `state`: one of a few numbers by the tests of the step and what it held before; `after` is what it holds after
 *   the step's writes, said by those tests and what happened before.
 */
interface Latch {
  kind: "latch" | "stamp" | "tally" | "link" | "state";
  when: Formula;
  value: number;
  first: number;
  end: Sym;
  field?: Extract<Sym, { kind: "field" }>;
  after?: Sym;
}

/** A value with every part that is the same as `target` put `by` in its place. */
function replaced<T>(value: T, target: unknown, by: unknown): T {
  if (same(value, target)) return by as T;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => replaced(v, target, by)) as T;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaced(v, target, by)])) as T;
}

/** A sym built again from its parts, so that tests and sums of numbers put in its place are worked out. */
function rebuildSym(v: Sym): Sym {
  switch (v.kind) {
    case "binary":
      return binary(v.op, rebuildSym(v.left), rebuildSym(v.right));
    case "ite":
      return ite(rebuild(v.when), rebuildSym(v.then), rebuildSym(v.else));
    default:
      return v;
  }
}

/** A formula built again from its parts, so that tests of numbers put in its place are decided. */
function rebuild(f: Formula): Formula {
  switch (f.kind) {
    case "test":
      return f.exact ? f : test(f.op, f.signed, rebuildSym(f.left), rebuildSym(f.right));
    case "and":
      return and(...f.items.map(rebuild));
    case "or":
      return or(...f.items.map(rebuild));
    case "not":
      return not(rebuild(f.item));
    case "choose":
      return choose(rebuild(f.when), rebuild(f.then), rebuild(f.else));
    case "some":
      return { ...f, where: rebuild(f.where) };
    case "ever":
    case "ago":
    case "times":
      return { ...f, item: rebuild(f.item) };
    default:
      return f;
  }
}

/** A formula with each test of whether the part `ref` is there (the part against 0) decided as `there` says. */
function exists(f: Formula, ref: PartRef, there: boolean): Formula {
  const part: Sym = { kind: "part", ref };
  const swap = (x: unknown): unknown => {
    if (!x || typeof x !== "object") return x;
    if (Array.isArray(x)) return x.map(swap);
    const node = x as Formula;
    if (
      node.kind === "test" &&
      (node.op === "==" || node.op === "!=") &&
      node.right.kind === "constant" &&
      node.right.value === 0 &&
      same(node.left, part)
    )
      return (node.op === "!=") === there ? TRUE : FALSE;
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, swap(v)]));
  };
  return swap(f) as Formula;
}

/** A sym with each choice on a test already decided (by `known`, the test's text) taken that way. */
function rebuildKnown(v: Sym, known: ReadonlyMap<string, boolean>): Sym {
  if (v.kind === "ite") {
    const was = known.get(JSON.stringify(v.when));
    if (was !== undefined) return rebuildKnown(was ? v.then : v.else, known);
    return ite(v.when, rebuildKnown(v.then, known), rebuildKnown(v.else, known));
  }
  if (v.kind === "binary") return binary(v.op, rebuildKnown(v.left, known), rebuildKnown(v.right, known));
  return v;
}

/** Whether statements break out of the loop they are in, not counting loops inside them. */
function breaksOut(body: readonly Shown[]): boolean {
  return body.some(
    (s) => s.kind === "break" || (s.kind === "if" && (breaksOut(s.then as Shown[]) || breaksOut(s.else as Shown[]))),
  );
}

/** How many rounds a loop with a counter may run before it counts as never stopping. */
const MOST_ROUNDS = 64;

/** Runs a goal program symbolically: what each word becomes, and when the goal is met. */
class Runner {
  private walks = 0;
  private frames = 0;
  /** The walks over parts of one type that loops which find part after part make, numbered below 0. */
  private enumerations = 0;
  /** For each loop a round runs in, the states that break out of it; undefined where a break doesn't fit. */
  private readonly breaks: (State[] | undefined)[] = [];
  /** For each round of a loop, the parts it finds. */
  private readonly finds: PartRef[][] = [];
  /** Tables a loop filled with the parts of a type in order, by the address of their first word. */
  private readonly arrays = new Map<number, Walked>();
  /** The routines running now, from the goal down to the one that runs, with how many times each is. */
  private readonly calling = new Map<number, number>();
  readonly met: Formula[] = [];
  /** The data segment words the goal writes, by address. */
  readonly written = new Set<number>();
  /** Every word the goal writes outside its first step's setup, kept words too. */
  readonly stepWrites = new Set<number>();
  /** The words the setup in the first step sets, and what to: `if the step count = 0: …`. */
  setup?: Map<number, Sym>;
  private inSetup = false;
  private readonly heads: ReadonlyMap<number, string>;
  private readonly routines: Routines;
  private readonly names: GoalNames;
  private readonly kept?: Kept;

  constructor(routines: Routines, names: GoalNames, kept?: Kept) {
    this.routines = routines;
    this.names = names;
    this.kept = kept;
    this.heads = new Map(names.lists.map((l) => [l.head, l.name]));
  }

  /**
   * A word a branch didn't write, where branches meet: as it was before, which for a goal with a setup may be a word
   * it keeps. Without a setup, the word as the step left it.
   */
  private readonly missing = (address: number): Sym | undefined => {
    if (!this.kept) return undefined;
    // A word that remembers something stays as the step left it until it is read, as in the pass that found it.
    if (this.kept.latches.has(address)) return { kind: "word", address };
    return this.read(constant(address));
  };

  /** Whether a test is the one a setup in the first step is under: the step count against 0. */
  private setupOf(s: Extract<Shown, { kind: "if" }>): readonly Shown[] | undefined {
    const { test } = s;
    if (
      this.names.firstStep === undefined ||
      test.left.kind !== "word" ||
      test.left.address.kind !== "constant" ||
      test.left.address.value !== this.names.firstStep ||
      test.right.kind !== "constant" ||
      test.right.value !== 0
    )
      return undefined;
    if (test.op === "==" && !s.else.length) return s.then as Shown[];
    if (test.op === "!=" && !s.then.length) return s.else as Shown[];
    return undefined;
  }

  /**
   * Runs the setup of the first step on its own, to see what it sets the words to. The steps go on without it: the
   * last pass reads every word it sets as what the setup put there or what the goal remembers in it since.
   */
  private runSetup(body: readonly Shown[], state: State, frame: number) {
    if (this.setup) throw new DoesntFit("it sets up its words twice");
    const met = this.met.length;
    const returns: State[] = [];
    this.inSetup = true;
    let end: State;
    try {
      end = this.run(body, { env: new Map(state.env), alive: TRUE }, frame, returns);
    } finally {
      this.inSetup = false;
    }
    if (returns.length || this.met.length > met) throw new DoesntFit("it ends or meets the goal while it sets up");
    this.setup = new Map();
    for (const [key, value] of end.env)
      if (key.startsWith("w:") && value !== state.env.get(key)) this.setup.set(Number(key.slice(2)), value);
  }

  /**
   * Runs a loop with a counter round by round: its test must be decided in every round. A loop whose rounds depend
   * on the parts may still be one of two shapes: a loop that finds the next part of a type each round
   * (`enumerate`), or a loop over a table such a loop filled (`overTable`).
   */
  private unroll(s: Extract<Shown, { kind: "loop" }>, start: State, frame: number, returns: State[]): State {
    if (breaksOut(s.before as Shown[]) || breaksOut(s.body as Shown[])) return this.enumerate(s, start, frame, returns);
    let state = start;
    for (let round = 0; round <= MOST_ROUNDS; round++) {
      state = this.run(s.before as Shown[], state, frame, returns);
      if (state.alive.kind === "false") return state;
      const go = this.condition(s.test, state.env, frame);
      if (go.kind === "false") return state;
      if (go.kind !== "true") {
        if (round > 0) throw new DoesntFit("it has a loop whose rounds depend on the parts");
        return this.overTable(s, start, frame) ?? this.enumerate(s, start, frame, returns);
      }
      state = this.run(s.body as Shown[], state, frame, returns);
    }
    throw new DoesntFit(`it has a loop that runs more than ${MOST_ROUNDS} rounds`);
  }

  /**
   * One round of a loop from a state, the parts it finds kept in `found`: the states that leave the loop in it (by its
   * test or a break, each with when it does) and the state the next round starts from.
   */
  private round(s: Extract<Shown, { kind: "loop" }>, start: State, frame: number, returns: State[], found: PartRef[]) {
    const breaks: State[] = [];
    this.breaks.push(breaks);
    this.finds.push(found);
    try {
      const before = this.run(s.before as Shown[], start, frame, returns);
      const go = this.condition(s.test, before.env, frame);
      const left = [{ env: before.env, alive: and(before.alive, not(go)) }];
      const next = this.run(s.body as Shown[], { env: before.env, alive: and(before.alive, go) }, frame, returns);
      return { left: [...left, ...breaks].filter((l) => l.alive.kind !== "false"), next };
    } finally {
      this.breaks.pop();
      this.finds.pop();
    }
  }

  /**
   * A loop that finds the n-th part of a type in its first round, the next one in the next round and so on, and leaves
   * when there is none or when a test of the part holds: like HARD18's "find every message machine" and LOON7's "find
   * the first balloon with a rope". Its first two rounds are run and must do the same to their parts. After it, a word
   * that holds the part the round found holds the first part of the type, in order on the lists, that passes the
   * test (or 0 when none does); a word that counts the rounds by 1 holds how many parts of the type there are, when
   * the loop only leaves at the end; a table the rounds fill holds the parts in order. A search from n = 0 starts with
   * the first part on the list when it is of the type, which is the first of the type then.
   */
  private enumerate(s: Extract<Shown, { kind: "loop" }>, start: State, frame: number, returns: State[]): State {
    const fail = () => new DoesntFit("it has a loop whose rounds depend on the parts");
    if (!this.names.finder || start.alive.kind === "false") throw fail();
    const found0: PartRef[] = [];
    const found1: PartRef[] = [];
    const r0 = this.round(s, { env: start.env, alive: TRUE }, frame, returns, found0);
    const r1 = this.round(s, { env: r0.next.env, alive: TRUE }, frame, returns, found1);
    const [p0, p1] = [found0, found1].map((f) => (f.length === 1 && f[0]!.kind === "nth" ? f[0] : undefined));
    if (
      p0?.kind !== "nth" ||
      p1?.kind !== "nth" ||
      p0.type !== p1.type ||
      p0.lists !== p1.lists ||
      p1.nth !== p0.nth + 1 ||
      p0.nth > 1
    )
      throw fail();
    const leave0 = rebuild(or(...r0.left.map((l) => l.alive)));
    const leave1 = rebuild(or(...r1.left.map((l) => l.alive)));
    if (!same(rebuild(replaced(leave0, p0, p1)), leave1)) throw fail();
    // The loop leaves when the part isn't there, and else when `leaves` holds for it.
    if (rebuild(exists(leave0, p0, false)).kind !== "true") throw fail();
    const walked: Walked = { id: -++this.enumerations, lists: p0.lists, type: p0.type };
    const each: PartRef = { kind: "each", walk: walked };
    const typeIs = test("==", false, { kind: "field", ref: each, offset: TYPE }, constant(p0.type));
    const leaves = rebuild(replaced(exists(leave0, p0, true), p0, each));
    const where = and(typeIs, leaves);
    const part0: Sym = { kind: "part", ref: p0 };
    const firstFound: Sym =
      leaves.kind === "false"
        ? constant(0)
        : ite(
            { kind: "some", walk: walked, where },
            { kind: "part", ref: { kind: "first", walk: walked, where } },
            constant(0),
          );
    const env0 = merge(r0.left).env;
    const env1 = merge(r1.left).env;
    const env: Env = new Map(start.env);
    for (const key of new Set([...env0.keys(), ...env1.keys()])) {
      const v0 = env0.get(key);
      const v1 = env1.get(key);
      if (key.startsWith("r:") || key.startsWith("l:")) {
        env.set(
          key,
          v0 && v1 && same(v0, v1) ? v0 : { kind: "unset", why: `${key.slice(2)} after a loop over the parts` },
        );
        continue;
      }
      if (v0 && v1 && same(v0, v1) && !holds(v0, (n) => same(n, p0))) {
        env.set(key, v0);
        continue;
      }
      if (v0 && v1 && same(v0, part0) && same(v1, { kind: "part", ref: p1 })) {
        env.set(key, firstFound);
        continue;
      }
      // A word the rounds count by 1 is how many parts there are, when the loop goes to the end of the list.
      if (v0?.kind === "constant" && v1?.kind === "constant" && v1.value === v0.value + 1 && leaves.kind === "false") {
        env.set(key, binary("+", v0, { kind: "count", walk: walked, where: typeIs }));
        continue;
      }
      // A table the rounds fill, a word a part from its start: its first word holds the first part, and so on.
      const address = Number(key.slice(2));
      const table = (at: number, p: PartRef) => same(env0.get(`w:${at}`), { kind: "part", ref: p });
      if (v1 && !v0 && same(v1, { kind: "part", ref: p1 }) && table(address - 2, p0) && p0.nth === 1) {
        this.arrays.set(address - 2, walked);
        continue;
      }
      if (v0 && same(v0, part0) && same(v1, part0) && env1.has(`w:${address + 2}`) && p0.nth === 1) continue;
      throw fail();
    }
    // A search from n = 0: the finder gives the first part on the list when it is of the type, and else 0.
    if (p0.nth === 0) {
      const head: PartRef = { kind: "first", walk: this.walk(p0.lists), where: TRUE };
      const headIs = test("==", false, { kind: "field", ref: head, offset: TYPE }, constant(p0.type));
      for (const [key, value] of env)
        if (value === firstFound)
          env.set(key, ite(headIs, firstFound, rebuildSym(replaced(env0.get(key)!, part0, constant(0)))));
    }
    return { env, alive: start.alive };
  }

  /**
   * A loop over a table a loop over the parts filled (`enumerate`), with a counter from 0 up to how many parts there
   * are: a walk over those parts, with the table's word at the counter as the part.
   */
  private overTable(s: Extract<Shown, { kind: "loop" }>, start: State, frame: number): State | undefined {
    if (s.before.length || s.test.left.kind !== "register" || (s.test.op !== "<" && s.test.op !== ">"))
      return undefined;
    const counter = s.test.left.name;
    const bound = this.value(s.test.right, start.env, frame);
    if (bound.kind !== "count" || !bound.walk.type || ![...this.arrays.values()].some((w) => same(w, bound.walk)))
      return undefined;
    const from = start.env.get(`r:${counter}`);
    if (s.test.op !== "<" || from?.kind !== "constant" || from.value !== 0) return undefined;
    return this.walkOver(
      bound.walk,
      `r:${counter}`,
      { kind: "index", walk: bound.walk },
      s.body as Shown[],
      start,
      frame,
    );
  }

  private walk(lists: string): Walked {
    return { id: ++this.walks, lists };
  }

  /** Runs a routine's body in a frame of its own; a return ends only this routine. */
  routine(address: number, state: State): State {
    // A call on a way the program never takes does nothing. This is also where a routine that calls itself after
    // setting a word its test reads, like a flag, stops.
    if (state.alive.kind === "false") return state;
    const routine = this.routines.get(address);
    if (!routine) throw new DoesntFit(`the routine at ${hex(address)} isn't read`);
    if (!("body" in routine)) throw new DoesntFit(`the routine at ${hex(address)} isn't read: ${routine.reason}`);
    // A routine that calls itself on tests without numbers to end on would never stop.
    const depth = this.calling.get(address) ?? 0;
    if (depth >= MOST_CALLS)
      throw new DoesntFit(`the routine at ${hex(address)} calls itself more than ${MOST_CALLS} deep`);
    if (this.frames >= MOST_RUNS) throw new DoesntFit(`it runs more than ${MOST_RUNS} routines`);
    this.calling.set(address, depth + 1);
    try {
      const frame = ++this.frames;
      const returns: State[] = [];
      // Registers are the routine's own; words of memory are shared.
      const env: Env = new Map([...state.env].filter(([k]) => k.startsWith("w:")));
      // A break inside the routine can't leave a loop of its caller.
      this.breaks.push(undefined);
      const end = this.run(shape(withoutSaves(routine.body), this.names), { env, alive: state.alive }, frame, returns);
      return merge([...returns, end], this.missing);
    } finally {
      this.breaks.pop();
      if (depth) this.calling.set(address, depth);
      else this.calling.delete(address);
    }
  }

  private key(target: GoalValue, env: Env, frame: number): string {
    if (target.kind === "register") return `r:${target.name}`;
    if (target.kind === "local") return `l:${frame}:${target.offset}`;
    if (target.kind === "word") {
      const address = this.value(target.address, env, frame);
      if (address.kind === "constant") return `w:${address.value}`;
      throw new DoesntFit(
        address.kind === "part" || address.kind === "binary"
          ? "it writes to a part or to a computed place"
          : "it writes to a place it doesn't know",
      );
    }
    throw new DoesntFit("it writes to a place it doesn't know");
  }

  /** The word at a place: a global word, a part's field, or the first part of a list. */
  private read(address: Sym): Sym {
    if (address.kind === "ite") return ite(address.when, this.read(address.then), this.read(address.else));
    if (address.kind === "unset") return address;
    if (address.kind === "constant") {
      const list = this.heads.get(address.value);
      if (list !== undefined) return { kind: "part", ref: { kind: "first", walk: this.walk(list), where: TRUE } };
      const part = this.kept?.parts.get(address.value);
      if (part) return part;
      const latch = this.kept?.latches.get(address.value);
      if (latch) return this.remembered(latch, true);
      if (this.kept?.strict && this.setup?.has(address.value))
        throw new DoesntFit(
          "it keeps a word from step to step that is neither a part it found nor a sign of something that happened",
        );
      const fixed = this.names.fixedWords?.get(address.value);
      if (fixed !== undefined) return constant(fixed);
      return { kind: "word", address: address.value };
    }
    if (address.kind === "part") return { kind: "field", ref: address.ref, offset: 0 };
    // A word of a table a loop filled with parts, at a counter that steps along it: the part the walk is at.
    if (address.kind === "binary" && address.op === "+" && address.right.kind === "constant") {
      const walked = this.arrays.get(address.right.value);
      if (walked && same(address.left, binary("<<", { kind: "index", walk: walked }, constant(1))))
        return { kind: "part", ref: { kind: "each", walk: walked } };
    }
    // A field that holds a part: the field of the part it holds.
    if (this.names.linkName) {
      const [holder, offset] =
        address.kind === "binary" && address.op === "+" && address.right.kind === "constant"
          ? [address.left, address.right.value]
          : [address, 0];
      if (holder.kind === "field" && offset < (this.names.partSize ?? PART_SIZE))
        return { kind: "field", ref: { kind: "via", from: holder.ref, offset: holder.offset }, offset };
    }
    if (
      address.kind === "binary" &&
      address.op === "+" &&
      address.left.kind === "part" &&
      address.right.kind === "constant" &&
      address.right.value < (this.names.partSize ?? PART_SIZE)
    )
      return { kind: "field", ref: address.left.ref, offset: address.right.value };
    // The pass that looks for the words a goal keeps reads them as words; a part one holds is known only after it.
    if (this.kept && !this.kept.strict && holds(address, (n) => n.kind === "word"))
      return { kind: "unset", why: "the part a word it keeps holds" };
    throw new DoesntFit("it reads memory at a computed place");
  }

  value(v: GoalValue, env: Env, frame: number): Sym {
    switch (v.kind) {
      case "constant":
        return constant(v.value);
      case "register":
        return env.get(`r:${v.name}`) ?? { kind: "unset", why: `${v.name} before it is set` };
      case "local":
        return env.get(`l:${frame}:${v.offset}`) ?? { kind: "unset", why: "a local before it is set" };
      case "localAddress":
        throw new DoesntFit("it passes the place of a local");
      case "word": {
        const address = this.value(v.address, env, frame);
        if (address.kind === "constant" && env.has(`w:${address.value}`)) {
          const found = env.get(`w:${address.value}`)!;
          // A word that remembers something, read after every write of this step: it says whether the test held
          // at some step so far.
          const latch = this.kept?.latches.get(address.value);
          if (!latch) return found;
          if (same(found, latch.end)) return this.remembered(latch, false);
          // A write that reads the word first, like a count's `+= 1`, read it as it was before this step.
          const self: Sym = { kind: "word", address: address.value };
          if (latch.kind !== "state" && same(replaced(found, this.remembered(latch, true), self), latch.end))
            return this.remembered(latch, false);
          // A word of several values, partway through the step's writes: only its own writes read it so, and the
          // goal may not test it (checked at the end).
          if (latch.kind === "state") return found;
          return replaced(found, { kind: "word", address: address.value }, this.read(address));
        }
        return this.read(address);
      }
      case "binary":
        return binary(v.op, this.value(v.left, env, frame), this.value(v.right, env, frame));
    }
  }

  condition(t: GoalTest, env: Env, frame: number): Formula {
    const tested = test(t.op, t.signed, this.value(t.left, env, frame), this.value(t.right, env, frame));
    // The part a goal keeps from a field, taken when the field's part was of a type: a part then, not 0. A read
    // through 0 finds the data segment's first words, whose type word isn't a type (`fixedWords`).
    const decide = (x: unknown): unknown => {
      if (!x || typeof x !== "object") return x;
      if (Array.isArray(x)) return x.map(decide);
      const f = x as Formula;
      if (
        f.kind === "test" &&
        (f.op === "==" || f.op === "!=") &&
        f.right.kind === "constant" &&
        f.right.value === 0 &&
        f.left.kind === "part" &&
        f.left.ref.kind === "via" &&
        f.left.ref.at &&
        this.isPart(f.left.ref)
      )
        return f.op === "!=" ? TRUE : FALSE;
      return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, decide(v)]));
    };
    return holds(tested, (n) => (n as { ref?: PartRef }).ref?.kind === "via")
      ? rebuild(decide(tested) as Formula)
      : tested;
  }

  /**
   * Whether the part a goal keeps from a field (`via` with `at`) is a part for sure: it was kept only when a test of
   * its type held, and a read through 0 never gives a type.
   */
  private isPart(ref: Extract<PartRef, { kind: "via" }>): boolean {
    const now: PartRef = { kind: "via", from: ref.from, offset: ref.offset };
    const nullType = this.names.fixedWords?.get(TYPE);
    if (nullType === undefined) return false;
    // Every way the part was kept tests its type.
    const ways = waysOf(ref.at!.item);
    return (
      ways.length > 0 &&
      ways.every((way) =>
        way.some(
          (f) =>
            f.kind === "test" &&
            f.op === "==" &&
            same(f.left, { kind: "field", ref: now, offset: TYPE }) &&
            f.right.kind === "constant" &&
            f.right.value !== nullType &&
            f.right.value < 0x100,
        ),
      )
    );
  }

  /**
   * A test of a sum's sign as the reader gives it: first whether the second number is -32768, whose negation isn't a
   * word, and then the first number against 0 less the second. Both ways do the same as the sum, worked out without
   * the overflow of a word, against 0: "positionY + height < 0". Undefined when the if isn't of that shape.
   */
  private exactSum(s: Extract<Shown, { kind: "if" }>, env: Env, frame: number) {
    const inner = s.else.length === 1 ? s.else[0] : undefined;
    const guard = s.test;
    if (
      inner?.kind !== "if" ||
      guard.op !== "==" ||
      guard.right.kind !== "constant" ||
      guard.right.value !== 0x8000 ||
      !inner.test.signed ||
      inner.test.op === "==" ||
      inner.test.op === "!=" ||
      inner.test.right.kind !== "binary" ||
      inner.test.right.op !== "-" ||
      !same(inner.test.right.left, { kind: "constant", value: 0 }) ||
      !same(inner.test.right.right, guard.left)
    )
      return undefined;
    const below = inner.test.op === "<" || inner.test.op === "<=";
    if (!same(s.then, below ? inner.then : inner.else)) return undefined;
    const op = inner.test.op;
    // The cases of the two numbers, each test taken one way only once.
    const exact = (first: Sym, second: Sym, known: ReadonlyMap<string, boolean> = new Map()): Formula => {
      const split = (when: Formula, then: () => [Sym, Sym], otherwise: () => [Sym, Sym]): Formula => {
        const key = JSON.stringify(when);
        const was = known.get(key);
        if (was !== undefined) return exact(...(was ? then() : otherwise()), known);
        const yes = new Map(known).set(key, true);
        const no = new Map(known).set(key, false);
        return choose(when, exact(...then(), yes), exact(...otherwise(), no));
      };
      if (first.kind === "ite") {
        const f = first;
        return split(
          f.when,
          () => [f.then, second],
          () => [f.else, second],
        );
      }
      if (second.kind === "ite") {
        const g = second;
        return split(
          g.when,
          () => [first, g.then],
          () => [first, g.else],
        );
      }
      first = rebuildKnown(first, known);
      // The first number is often the sum less the second, as the reader works it out from the register after the add.
      if (
        first.kind === "binary" &&
        first.op === "-" &&
        same(first.right, second) &&
        first.left.kind === "binary" &&
        first.left.op === "+" &&
        same(first.left.right, second)
      )
        first = first.left.left;
      if (first.kind === "constant" && second.kind === "constant")
        return compareNumbers(op, signed16(first.value) + signed16(second.value), 0) ? TRUE : FALSE;
      return { kind: "test", op, signed: true, left: binary("+", first, second), right: constant(0), exact: true };
    };
    const when = exact(this.value(inner.test.left, env, frame), this.value(guard.left, env, frame));
    return { when, then: inner.then, else: inner.else };
  }

  /** A word that remembers what happened, as it is before this step's writes or after them. */
  private remembered(latch: Latch, before: boolean): Sym {
    switch (latch.kind) {
      case "latch":
        return ite({ kind: "ever", item: latch.when, before }, constant(latch.value), constant(latch.first));
      case "stamp":
        return { kind: "stamp", item: latch.when, before, first: latch.first, steps: this.names.firstStep! };
      case "tally":
        return { kind: "tally", item: latch.when, before, first: latch.first };
      case "link": {
        const field = latch.field!;
        const ref: PartRef = { kind: "via", from: field.ref, offset: field.offset, at: { item: latch.when, before } };
        return ite({ kind: "ever", item: latch.when, before }, { kind: "part", ref }, constant(latch.first));
      }
      case "state":
        if (before) throw new DoesntFit("it reads a word it keeps before this step changes it");
        return latch.after!;
    }
  }

  /** Runs statements; a return adds its state to `returns` and ends the way it was on. */
  run(body: readonly Shown[], start: State, frame: number, returns: State[]): State {
    let state: State = { env: new Map(start.env), alive: start.alive };
    for (const s of body) {
      if (state.alive.kind === "false") break;
      switch (s.kind) {
        case "set": {
          const value = this.value(s.value, state.env, frame);
          const key = this.key(s.target, state.env, frame);
          const mode = this.names.mode;
          if (mode && key === `w:${mode.word}`) {
            if (value.kind !== "constant" || (mode.met !== undefined && value.value !== mode.met))
              throw new DoesntFit("it sets the game mode to something other than the goal being met");
            this.met.push(state.alive);
            break;
          }
          if (key.startsWith("w:") && !this.inSetup) {
            const address = Number(key.slice(2));
            this.stepWrites.add(address);
            // A word that keeps a part or remembers something is said by the conditions, not as a word kept.
            if (!this.kept?.parts.has(address) && !this.kept?.latches.has(address)) this.written.add(address);
          }
          state.env.set(key, value);
          break;
        }
        case "find": {
          const value = (v: GoalValue, what: string) => {
            const found = this.value(v, state.env, frame);
            if (found.kind !== "constant") throw new DoesntFit(`it looks for a part by a ${what} that isn't a number`);
            return found.value;
          };
          const part: Sym = {
            kind: "part",
            ref: {
              kind: "nth",
              type: value(s.type, "type"),
              nth: value(s.nth, "place"),
              lists: masked(value(s.mask, "list")),
            },
          };
          this.finds.at(-1)?.push(part.ref);
          const key = this.key(s.target, state.env, frame);
          state.env.delete("r:dx");
          state.env.set("r:ax", part);
          if (key.startsWith("w:") && !this.inSetup) {
            this.stepWrites.add(Number(key.slice(2)));
            if (!this.kept?.parts.has(Number(key.slice(2)))) this.written.add(Number(key.slice(2)));
          }
          state.env.set(key, part);
          break;
        }
        case "if": {
          const setup = this.setupOf(s);
          if (setup) {
            this.runSetup(setup, state, frame);
            break;
          }
          const sum = this.names.exactSums ? this.exactSum(s, state.env, frame) : undefined;
          const when = sum?.when ?? this.condition(s.test, state.env, frame);
          const then = this.run(
            (sum?.then ?? s.then) as Shown[],
            { env: state.env, alive: and(state.alive, when) },
            frame,
            returns,
          );
          const otherwise = this.run(
            (sum?.else ?? s.else) as Shown[],
            { env: state.env, alive: and(state.alive, not(when)) },
            frame,
            returns,
          );
          state = mergeIf(when, state, then, otherwise, this.missing, this.names.countedLoops);
          break;
        }
        case "walk": {
          const walked = this.walk(s.lists);
          const each: Sym = { kind: "part", ref: { kind: "each", walk: walked } };
          state = this.walkOver(walked, `r:${s.part}`, each, s.body as Shown[], state, frame);
          break;
        }
        case "search": {
          const walked = this.walk(s.list);
          const inside = new Map(state.env);
          inside.set(`r:${s.part}`, { kind: "part", ref: { kind: "each", walk: walked } });
          const where = test(
            NEGATED[s.test.op],
            s.test.signed,
            this.value(s.test.left, inside, frame),
            this.value(s.test.right, inside, frame),
          );
          state.env.set(`r:${s.part}`, { kind: "part", ref: { kind: "first", walk: walked, where } });
          break;
        }
        case "call": {
          if (s.routine === this.names.listHead || s.routine === this.names.listNext)
            throw new DoesntFit("it calls a list routine outside a walk over the parts");
          const after = this.routine(s.routine, state);
          const env = new Map(state.env);
          for (const [k, v] of after.env) if (k.startsWith("w:")) env.set(k, v);
          env.delete("r:dx");
          const ax = after.env.get("r:ax");
          if (ax) env.set("r:ax", ax);
          else env.delete("r:ax");
          state = { env, alive: after.alive };
          break;
        }
        case "return":
          returns.push(state);
          state = { env: state.env, alive: FALSE };
          break;
        case "break": {
          const target = this.breaks.at(-1);
          if (!target) throw new DoesntFit("it stops a loop early");
          target.push(state);
          state = { env: state.env, alive: FALSE };
          break;
        }
        case "loop":
          if (!this.names.countedLoops) throw new DoesntFit("it has a loop that isn't a walk over the parts");
          state = this.unroll(s, state, frame, returns);
          break;
      }
    }
    return state;
  }

  /**
   * A walk over the parts of lists. The body runs once for a part of the walk, with each word it changes as it was
   * when the walk came to that part. A word the body sets to one value when a test holds is that value after the walk
   * when some part passed the test; a word it adds 1 to counts the parts that pass; a register it sets to the part is
   * the last part that passes. Anything else the body does with a word it changes is beyond these shapes. `bound` holds
   * `boundTo` in the body: the part, or the counter of a loop over a table of parts. A walk over the parts of one type
   * counts and looks at only those.
   */
  private walkOver(
    walked: Walked,
    bound: string,
    boundTo: Sym,
    body: readonly Shown[],
    state: State,
    frame: number,
  ): State {
    const keys = new Set<string>();
    const collect = (statements: readonly Shown[]) => {
      for (const s of statements) {
        if (s.kind === "set") keys.add(this.key(s.target, state.env, frame));
        else if (s.kind === "if") {
          collect(s.then as Shown[]);
          collect(s.else as Shown[]);
        } else if (s.kind === "walk") throw new DoesntFit("it walks the parts inside a walk over the parts");
        else if (s.kind === "search") keys.add(`r:${s.part}`);
        else if (s.kind === "call") throw new DoesntFit("it calls a routine inside a walk over the parts");
        else if (s.kind === "return") throw new DoesntFit("it ends inside a walk over the parts");
      }
    };
    collect(body);
    const inside: Env = new Map(state.env);
    for (const key of keys) inside.set(key, { kind: "carried", key });
    inside.set(bound, boundTo);
    const met = this.met.length;
    this.breaks.push(undefined);
    let end: State;
    try {
      end = this.run(body, { env: inside, alive: TRUE }, frame, []);
    } finally {
      this.breaks.pop();
    }
    const metInside = this.met.splice(met);
    const each: Sym = { kind: "part", ref: { kind: "each", walk: walked } };
    const typed = (f: Formula) =>
      walked.type === undefined
        ? f
        : and(test("==", false, { kind: "field", ref: each.ref, offset: TYPE }, constant(walked.type)), f);
    const env = new Map(state.env);
    for (const key of keys) {
      const before =
        state.env.get(key) ??
        (key.startsWith("w:")
          ? this.read(constant(Number(key.slice(2))))
          : ({ kind: "unset", why: `${key.slice(2)} before it is set` } as Sym));
      const carried: Sym = { kind: "carried", key };
      const found = cases(end.env.get(key) ?? carried);
      const changed = found.filter((c) => !same(c.value, carried));
      if (!changed.length) {
        env.set(key, before);
        continue;
      }
      if (changed.some((c) => carries(c.when))) throw new DoesntFit("a walk's tests look at what it found before");
      const when = typed(or(...changed.map((c) => c.when)));
      const value = changed[0]!.value;
      const counts = (v: Sym) =>
        v.kind === "binary" && v.op === "+" && same(v.left, carried) && same(v.right, constant(1));
      const steady = changed.every((c) => same(c.value, value));
      if (steady && counts(value)) env.set(key, binary("+", before, { kind: "count", walk: walked, where: when }));
      else if (steady && same(value, each))
        env.set(
          key,
          ite(
            { kind: "some", walk: walked, where: when },
            { kind: "part", ref: { kind: "last", walk: walked, where: when } },
            before,
          ),
        );
      else if (
        steady &&
        !carries(value) &&
        !holds(value, (n) => n.kind === "part" && same(n, each)) &&
        !mentions(value, walked)
      )
        env.set(key, ite({ kind: "some", walk: walked, where: when }, value, before));
      else env.set(key, { kind: "unset", why: `what a walk leaves in ${key.slice(2)}` });
    }
    env.set(bound, { kind: "unset", why: "the part a walk ended on" });
    for (const m of metInside) {
      if (carries(m)) throw new DoesntFit("a walk's tests look at what it found before");
      this.met.push(and(state.alive, { kind: "some", walk: walked, where: typed(m) }));
    }
    return { env, alive: state.alive };
  }
}

/** Whether a sym or formula looks at the part of a walk. */
const mentions = (value: unknown, walked: Walked) =>
  holds(value, (n) => {
    const ref = (n as { ref?: PartRef }).ref;
    return ref?.kind === "each" && ref.walk.id === walked.id;
  });

/** The state where ways meet: each word is the value of the way that got there. */
function merge(states: State[], missing?: (address: number) => Sym | undefined): State {
  const live = states.filter((s) => s.alive.kind !== "false");
  if (!live.length) return { env: states[0]?.env ?? new Map(), alive: FALSE };
  if (live.length === 1) return live[0]!;
  const keys = new Set(live.flatMap((s) => [...s.env.keys()]));
  const env: Env = new Map();
  for (const key of keys) {
    const unset: Sym = key.startsWith("w:")
      ? (missing?.(Number(key.slice(2))) ?? { kind: "word", address: Number(key.slice(2)) })
      : { kind: "unset", why: `${key.slice(2)} on one of the ways` };
    const values = live.map((s) => s.env.get(key) ?? unset);
    let value = values.at(-1)!;
    for (let k = live.length - 2; k >= 0; k--) value = ite(live[k]!.alive, values[k]!, value);
    env.set(key, value);
  }
  // Two ways of one test meet: the program runs whenever it ran before.
  const alive = or(...live.map((s) => s.alive));
  return { env, alive: simplifyAlive(alive, live) };
}

/** The state after an if: each word is the value of the branch the test picked. */
function mergeIf(
  when: Formula,
  before: State,
  then: State,
  otherwise: State,
  missing?: (address: number) => Sym | undefined,
  joined = false,
): State {
  if (then.alive.kind === "false") return otherwise;
  if (otherwise.alive.kind === "false") return then;
  const env: Env = new Map();
  for (const key of new Set([...then.env.keys(), ...otherwise.env.keys()])) {
    const unset: Sym = key.startsWith("w:")
      ? (missing?.(Number(key.slice(2))) ?? { kind: "word", address: Number(key.slice(2)) })
      : { kind: "unset", why: `${key.slice(2)} on one of the ways` };
    const value = ite(when, then.env.get(key) ?? unset, otherwise.env.get(key) ?? unset);
    env.set(key, joined ? joinIte(value) : value);
  }
  // Without a return in either branch the program runs on whenever it ran before the test.
  const whole = same(then.alive, and(before.alive, when)) && same(otherwise.alive, and(before.alive, not(when)));
  return { env, alive: whole ? before.alive : or(then.alive, otherwise.alive) };
}

/**
 * A value that is the same on several ways as one test: "1 when a, else 1 when b, else 0" is "1 when a or b, else 0".
 * This keeps a count over parts that each pass one of several tests from growing with every way.
 */
function joinIte(value: Sym): Sym {
  if (value.kind !== "ite") return value;
  const { when, then, else: otherwise } = value;
  if (otherwise.kind === "ite") {
    if (same(otherwise.then, then)) return joinIte(ite(or(when, otherwise.when), then, otherwise.else));
    if (same(otherwise.else, then)) return joinIte(ite(or(when, not(otherwise.when)), then, otherwise.then));
  }
  if (then.kind === "ite") {
    if (same(then.else, otherwise)) return joinIte(ite(and(when, then.when), then.then, otherwise));
    if (same(then.then, otherwise)) return joinIte(ite(and(when, not(then.when)), then.else, otherwise));
  }
  // Both ways a choice between the same two values: one choice.
  if (
    then.kind === "ite" &&
    otherwise.kind === "ite" &&
    same(then.then, otherwise.then) &&
    same(then.else, otherwise.else)
  )
    return joinIte(ite(or(and(when, then.when), and(not(when), otherwise.when)), then.then, then.else));
  return value;
}

/** `(A and t) or (A and not t)` is `A`, which keeps the merged conditions short. */
function simplifyAlive(alive: Formula, live: State[]): Formula {
  if (live.length !== 2) return alive;
  const [a, b] = live.map((s) => (s.alive.kind === "and" ? s.alive.items : [s.alive]));
  if (a!.length !== b!.length) return alive;
  const shared = a!.slice(0, -1);
  if (!shared.every((f, k) => same(f, b![k])) || !same(not(a!.at(-1)!), b!.at(-1)!)) return alive;
  return and(...shared);
}

// Ways: the goal's condition as an or of ands of literals.

type Literal =
  | Extract<Formula, { kind: "test" }>
  | { kind: "some"; walk: Walked; ways: Literal[][] }
  | { kind: "none"; walk: Walked; ways: Literal[][] }
  | Extract<Formula, { kind: "ever" }>
  | Extract<Formula, { kind: "ago" }>
  | Extract<Formula, { kind: "times" }>
  /** `item` held at no step so far, or before this one. */
  | { kind: "never"; item: Formula; before: boolean };

function dnf(f: Formula, negated = false): Literal[][] {
  switch (f.kind) {
    case "true":
      return negated ? [] : [[]];
    case "false":
      return negated ? [[]] : [];
    case "test": {
      const t = negated ? { ...f, op: NEGATED[f.op] } : f;
      return [[t]];
    }
    case "not":
      return dnf(f.item, !negated);
    case "choose":
      return negated
        ? dnf(choose(f.when, not(f.then), not(f.else)))
        : [...dnf(and(f.when, f.then)), ...dnf(and(not(f.when), f.else))];
    case "and":
    case "or": {
      const all = (f.kind === "and") !== negated;
      const parts = f.items.map((i) => dnf(i, negated));
      if (!all) return parts.flat();
      let out: Literal[][] = [[]];
      for (const p of parts) {
        const next: Literal[][] = [];
        for (const a of out) for (const b of p) next.push([...a, ...b]);
        out = next.map(tidy).filter((w): w is Literal[] => !!w);
        if (out.length > 64) throw new DoesntFit("it has too many ways to be met");
      }
      return out;
    }
    case "some": {
      const inner = shortest(
        dnf(f.where)
          .map(tidy)
          .filter((w): w is Literal[] => !!w),
      );
      // No part can pass tests that never all hold: "some" is never true then, and "none" always.
      if (!inner.length) return negated ? [[]] : [];
      if (negated) return [[{ kind: "none", walk: f.walk, ways: inner }]];
      return [[{ kind: "some", walk: f.walk, ways: inner }]];
    }
    case "ever":
      if (!negated) return [[f]];
      if (f.afterFirst) throw new DoesntFit("it needs something not to have happened after the first step");
      return [[{ kind: "never", item: f.item, before: f.before }]];
    case "ago":
      if (negated) throw new DoesntFit("it needs something not to have last happened a number of steps ago");
      return [[f]];
    case "times":
      return [[negated ? { ...f, op: NEGATED[f.op] } : f]];
  }
}

/** A literal as a formula again: "some" and "none" with their tests as `where`, "never" as not "ever". */
function formula(l: Literal): Formula {
  switch (l.kind) {
    case "some":
    case "none": {
      const some: Formula = { kind: "some", walk: l.walk, where: or(...l.ways.map((w) => and(...w.map(formula)))) };
      return l.kind === "some" ? some : not(some);
    }
    case "never":
      return not({ kind: "ever", item: l.item, before: l.before });
    default:
      return l;
  }
}

const waysOf = (f: Formula) =>
  shortest(
    dnf(f)
      .map(tidy)
      .filter((w): w is Literal[] => !!w),
  );

/**
 * Ways with what a goal remembers: a test that held at some step in one of several ways is one way for each, as "at
 * some step, A or B" is "at some step A, or at some step B".
 */
function withHistory(ways: Literal[][]): Literal[][] {
  return ways.flatMap((way) => {
    const ever = way.filter((l) => l.kind === "ever");
    // "Never A or B" is "never A and never B"; a count of steps or the last step is of one thing.
    const rest = way.flatMap((l): Literal[] => {
      if (l.kind === "never") return waysOf(l.item).map((i) => ({ ...l, item: and(...i.map(formula)) }));
      if (l.kind !== "ago" && l.kind !== "times") return l.kind === "ever" ? [] : [l];
      const inner = waysOf(l.item);
      if (inner.length !== 1) throw new DoesntFit("it remembers when one of several things held");
      return [{ ...l, item: and(...inner[0]!.map(formula)) }];
    });
    let split: Literal[][] = [rest];
    for (const e of ever) {
      const inner = waysOf(e.item);
      if (split.length * inner.length > 64) throw new DoesntFit("it has too many ways to be met");
      split = split.flatMap((w) => inner.map((i) => [...w, { ...e, item: and(...i.map(formula)) }]));
    }
    return split;
  });
}

const typeTest = (l: Literal, walked: Walked) =>
  l.kind === "test" &&
  l.left.kind === "field" &&
  l.left.offset === TYPE &&
  l.left.ref.kind === "each" &&
  l.left.ref.walk.id === walked.id &&
  l.right.kind === "constant";

/** Groups a walk's ways by their tests other than the type, so parts of several types that pass the same tests are one. */
function byTests(walked: Walked, ways: Literal[][]): Literal[][][] {
  const groups = new Map<string, Literal[][]>();
  for (const w of ways) {
    const key = JSON.stringify(w.filter((l) => !(typeTest(l, walked) && l.kind === "test" && l.op === "==")));
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  return [...groups.values()];
}

type Test = Extract<Formula, { kind: "test" }>;

/** The values a test of a word against a number lets through, as an inclusive range; none for `≠`. */
function range(t: Test): [number, number] | undefined {
  if (t.right.kind !== "constant" || t.op === "!=") return undefined;
  const v = t.signed ? signed16(t.right.value) : t.right.value;
  const [low, high] = t.signed ? [-0x8000, 0x7fff] : [0, 0xffff];
  switch (t.op) {
    case "==":
      return [v, v];
    case "<":
      return [low, v - 1];
    case "<=":
      return [low, v];
    case ">":
      return [v + 1, high];
    case ">=":
      return [v, high];
  }
}

/** Whether `a` holding means `b` holds: both test one word against a number, and `a` lets through less. */
function implies(a: Test, b: Test): boolean {
  if (same(a, b) || !same(a.left, b.left) || a.signed !== b.signed || b.right.kind !== "constant") return false;
  if (!!a.exact !== !!b.exact) return false;
  const ra = range(a);
  if (!ra) return false;
  if (b.op === "!=") {
    const v = b.signed ? signed16(b.right.value) : b.right.value;
    return v < ra[0] || v > ra[1];
  }
  const rb = range(b)!;
  return ra[0] >= rb[0] && ra[1] <= rb[1];
}

/** Whether way `a` holding means way `b` holds: each test of `b` is in `a` or follows from one of its tests. */
function covers(a: Literal[], b: Literal[]): boolean {
  return b.every((lb) => a.some((la) => same(la, lb) || (la.kind === "test" && lb.kind === "test" && implies(la, lb))));
}

/**
 * The fewest, shortest ways that hold exactly when the given ones do: two ways that differ in one test and its opposite
 * give the way without it, and a way that another way already covers is left out. So a walk that fails a part "when
 * state ≠ 0", and again in each branch of a later test, says "state ≠ 0" once.
 */
function shortest(ways: Literal[][]): Literal[][] {
  const absorb = (all: Literal[][]) =>
    all.filter((w, k) => !all.some((o, j) => j !== k && covers(w, o) && (!covers(o, w) || j < k)));
  let out = absorb(ways);
  for (let rounds = 0; rounds < 64 && out.length <= 64; rounds++) {
    const added: Literal[][] = [];
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        const opposite = a.filter((la) => la.kind === "test" && b.some((lb) => same(lb, not(la))));
        if (opposite.length !== 1) continue;
        const cut = opposite[0]! as Formula;
        const joined = tidy([...a.filter((l) => l !== cut), ...b.filter((l) => !same(l, not(cut)))]);
        if (joined && ![...out, ...added].some((o) => covers(joined, o))) added.push(joined);
      }
    if (!added.length) break;
    out = absorb([...out, ...added]);
  }
  return out;
}

/** A way without repeats, or undefined when it can't hold: a test and its opposite, or two types for one part. */
function tidy(way: Literal[]): Literal[] | undefined {
  const out: Literal[] = [];
  for (const l of way) {
    if (out.some((o) => same(o, l))) continue;
    if (l.kind === "test" && out.some((o) => o.kind === "test" && same(o, { ...l, op: NEGATED[l.op] })))
      return undefined;
    out.push(l);
  }
  // A test another test of the same word already implies says nothing, like `state ≠ 0` beside `state ≥ 5`.
  for (let k = out.length - 1; k >= 0; k--) {
    const l = out[k]!;
    if (l.kind === "test" && out.some((o, j) => j !== k && o.kind === "test" && implies(o, l))) out.splice(k, 1);
  }
  // Something that held at some step and at no step can't both be.
  for (const l of out)
    if (
      l.kind === "never" &&
      out.some((o) => o.kind === "ever" && same(o.item, l.item) && (o.before === l.before || !l.before))
    )
      return undefined;
  // "No part where A" and "some part where A" of one walk can't both hold.
  for (const l of out)
    if (
      l.kind === "some" &&
      out.some(
        (o) => o.kind === "none" && o.walk.id === l.walk.id && l.ways.every((w) => o.ways.some((n) => same(n, w))),
      )
    )
      return undefined;
  // A part is of one type: two `is` tests that differ can't both hold, and an `isn't` test beside an `is` says nothing.
  const types = out.filter(
    (l): l is Extract<Literal, { kind: "test" }> =>
      l.kind === "test" && l.left.kind === "field" && l.left.offset === TYPE && l.right.kind === "constant",
  );
  for (const t of types.filter((t) => t.op === "==")) {
    const sameField = types.filter((o) => same(o.left, t.left));
    if (sameField.some((o) => o.op === "==" && !same(o.right, t.right))) return undefined;
    if (sameField.some((o) => o.op === "!=" && same(o.right, t.right))) return undefined;
    for (const o of sameField) if (o.op === "!=") out.splice(out.indexOf(o), 1);
  }
  return out;
}

// Saying the literals.

const OPS: Record<GoalComparison, string> = { "==": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥" };

class Sayer {
  private readonly position: { x?: number; y?: number };
  private readonly names: GoalNames;
  private readonly written: ReadonlySet<number>;

  constructor(names: GoalNames, written: ReadonlySet<number>) {
    this.names = names;
    this.written = written;
    const offset = (name: string) => [...names.fields].find(([, n]) => n === name)?.[0];
    this.position = { x: offset("positionX"), y: offset("positionY") };
  }

  typeOf(type: number) {
    return { type, name: this.names.types.get(type) ?? `type ${type}` };
  }

  sym(v: Sym, mask = false): string {
    switch (v.kind) {
      case "constant":
        return mask ? hex(v.value) : String(signed16(v.value));
      case "field": {
        const name = this.names.fields.get(v.offset) ?? `field ${hex(v.offset)}`;
        return v.ref.kind === "via" && !v.ref.at ? `${this.linkName(v.ref)}'s ${name}` : name;
      }
      case "word": {
        const name = this.names.words.get(v.address) ?? `word ${hex(v.address)}`;
        return this.written.has(v.address) ? `${name} from the step before` : name;
      }
      case "binary": {
        if (v.op === "+" && v.right.kind === "constant" && v.right.value >= 0x8000)
          return `${this.sym(v.left)} - ${-signed16(v.right.value)}`;
        const isMask = ["&", "|", "^"].includes(v.op);
        return `(${this.sym(v.left, isMask)} ${v.op} ${this.sym(v.right, isMask)})`.replace(/^\((.*)\)$/, "$1");
      }
      case "part":
        return "the part";
      case "count":
        return "how many parts";
      case "ite":
      case "carried":
        return "a value that depends on the parts";
      case "unset":
        return `an unset value (${v.why})`;
      case "stamp":
      case "tally":
      case "index":
        throw new DoesntFit("it works with a word it keeps in a way the conditions can't say");
    }
  }

  /** The name of the part a field holds, like Al's angel, by the type of the part that holds it. */
  linkName(ref: Extract<PartRef, { kind: "via" }>): string {
    const type = ref.from.kind === "nth" ? ref.from.type : undefined;
    const own = type === undefined ? undefined : this.names.linkName?.(type, ref.offset);
    return own ?? `the part at ${this.names.fields.get(ref.offset) ?? `field ${hex(ref.offset)}`}`;
  }

  test(t: Extract<Literal, { kind: "test" }>, type?: number, part: ReadonlyMap<number, number> = new Map()): string {
    if (
      t.left.kind === "binary" &&
      t.left.op === "&" &&
      t.right.kind === "constant" &&
      t.right.value === 0 &&
      (t.op === "==" || t.op === "!=")
    )
      return `${this.sym(t.left.left)} ${t.op === "!=" ? "has" : "hasn't"} the bits ${this.sym(t.left.right, true)}`;
    if (
      t.left.kind === "field" &&
      t.left.offset === TYPE &&
      t.right.kind === "constant" &&
      (t.op === "==" || t.op === "!=")
    )
      return `${t.left.ref.kind === "via" && !t.left.ref.at ? `${this.linkName(t.left.ref)}'s type` : "type"} ${t.op === "==" ? "is" : "isn't"} ${this.typeOf(t.right.value).name}`;
    const unsigned = !t.signed && t.op !== "==" && t.op !== "!=" ? " (unsigned)" : "";
    const named =
      type !== undefined && t.left.kind === "field" && t.right.kind === "constant" && (t.op === "==" || t.op === "!=")
        ? this.names.valueName?.(type, t.left.offset, t.right.value, part)
        : undefined;
    return `${this.sym(t.left)} ${OPS[t.op]} ${unsigned ? this.bound(t.right) : this.sym(t.right)}${unsigned}${named ? ` (${named})` : ""}`;
  }

  /** A number an unsigned test compares with, as the test reads it: from 0x8000 up it stays positive. */
  private bound(v: Sym): string {
    return v.kind === "constant" ? String(v.value) : this.sym(v);
  }

  /** Says tests, with a lower and an upper bound of one field as one range; `type` names values of its fields. */
  tests(literals: Extract<Literal, { kind: "test" }>[], type?: number): string[] {
    const out: string[] = [];
    // The fields the tests fix, for naming one value by another, like a frame by the action it belongs to.
    const part = new Map<number, number>();
    for (const t of literals)
      if (t.op === "==" && t.left.kind === "field" && t.right.kind === "constant")
        part.set(t.left.offset, t.right.value);
    const used = new Set<number>();
    literals.forEach((t, k) => {
      if (used.has(k)) return;
      const low = t.op === ">=" || t.op === ">";
      const high = t.op === "<=" || t.op === "<";
      const pair = literals.findIndex(
        (o, j) =>
          j > k &&
          !used.has(j) &&
          o.right.kind === "constant" &&
          t.right.kind === "constant" &&
          o.signed === t.signed &&
          same(o.left, t.left) &&
          ((low && (o.op === "<=" || o.op === "<")) || (high && (o.op === ">=" || o.op === ">"))),
      );
      if (pair < 0 || t.left.kind === "binary") {
        out.push(this.test(t, type, part));
        return;
      }
      used.add(pair);
      const [lower, upper] = low ? [t, literals[pair]!] : [literals[pair]!, t];
      const unsigned = !t.signed ? " (unsigned)" : "";
      const say = (v: Sym) => (t.signed ? this.sym(v) : this.bound(v));
      out.push(
        `${say(lower.right)} ${lower.op === ">=" ? "≤" : "<"} ${this.sym(t.left)} ${OPS[upper.op]} ${say(upper.right)}${unsigned}`,
      );
    });
    return out;
  }

  /** The place the range tests of a part's position put it in, if it has any. */
  area(literals: Extract<Literal, { kind: "test" }>[]): GoalArea | undefined {
    const area: GoalArea = { x: {}, y: {} };
    let any = false;
    for (const t of literals) {
      if (t.left.kind !== "field") continue;
      const axis = t.left.offset === this.position.x ? "x" : t.left.offset === this.position.y ? "y" : undefined;
      if (!axis) continue;
      // A test against another field or a "≠" doesn't make a range; the condition's tests still say it.
      if (t.right.kind !== "constant" || t.op === "!=") continue;
      const v = t.signed ? signed16(t.right.value) : t.right.value;
      const range = area[axis];
      const raise = (min: number) => (range.min = Math.max(range.min ?? -Infinity, min));
      const lower = (max: number) => (range.max = Math.min(range.max ?? Infinity, max));
      if (t.op === "==") {
        raise(v);
        lower(v);
      } else if (t.op === ">") raise(v + 1);
      else if (t.op === ">=") raise(v);
      else if (t.op === "<") lower(v - 1);
      else lower(v);
      any = true;
    }
    return any ? area : undefined;
  }
}

/** The literals of a way that are about one part, the type tests apart. */
function partOf(way: Literal[], walked: Walked) {
  const types = way.filter((l) => typeTest(l, walked) && l.kind === "test" && l.op === "==") as Extract<
    Literal,
    { kind: "test" }
  >[];
  const rest = way.filter((l) => !types.includes(l as never));
  return { types: types.map((t) => (t.right as { value: number }).value), rest };
}

const isTest = (l: Literal): l is Extract<Literal, { kind: "test" }> => l.kind === "test";

/** The parts a sym looks at, without looking inside how a part was found. */
function refsOf(v: Sym, out: PartRef[] = []): PartRef[] {
  if (v.kind === "field" || v.kind === "part") {
    if (!out.some((r) => same(r, v.ref))) out.push(v.ref);
  } else if (v.kind === "binary") {
    refsOf(v.left, out);
    refsOf(v.right, out);
  } else if (v.kind === "ite") {
    refsOf(v.then, out);
    refsOf(v.else, out);
  }
  return out;
}

/** Which part a test is about, if it looks at a part. */
function refOf(l: Extract<Literal, { kind: "test" }>): PartRef | undefined {
  const refs = refsOf(l.right, refsOf(l.left));
  if (refs.length > 1) throw new DoesntFit("it compares two parts with each other");
  return refs[0];
}

function conditions(way: Literal[], say: Sayer): GoalCondition[] {
  const out: GoalCondition[] = [];
  const typesOf = (types: number[]) => (types.length ? { types: [...new Set(types)].map((t) => say.typeOf(t)) } : {});
  const partTests = (walked: Walked, literals: Literal[]) => {
    if (!literals.every(isTest)) throw new DoesntFit("it looks at the parts of one walk inside another");
    for (const l of literals) {
      const ref = refOf(l);
      if (ref && !(ref.kind === "each" && ref.walk.id === walked.id))
        throw new DoesntFit("it compares parts of two walks");
      if (holds(l, (n) => n.kind === "unset")) throw new DoesntFit(`it reads ${unsetWhy(l)}`);
    }
    return literals;
  };
  const byRef = new Map<string, { ref: PartRef; tests: Extract<Literal, { kind: "test" }>[] }>();
  for (const l of way) {
    if (l.kind === "ever" || l.kind === "never" || l.kind === "ago" || l.kind === "times") {
      // A step kept as the last step something held is not 0 when it held after the first: the "ago" says it.
      const sameItem = (o: Literal) => o.kind === "ago" && same(o.item, l.item) && o.before === l.before;
      if (l.kind === "ever" && l.afterFirst && way.some(sameItem)) continue;
      if (l.kind === "ever" && l.afterFirst)
        throw new DoesntFit("it needs something to have happened after the first step");
      const inner = conditions(waysOf(l.item)[0] ?? [], say);
      if (inner.length !== 1) throw new DoesntFit("it remembers that several things held at one step");
      const c: GoalCondition = { ...inner[0]!, once: l.before ? "before" : "so far" };
      if (l.kind === "never") c.never = true;
      if (l.kind === "times") c.steps = { op: l.op, value: l.value };
      if (l.kind === "ago") {
        const afterFirst = way.some(
          (o) => o.kind === "ever" && o.afterFirst && same(o.item, l.item) && o.before === l.before,
        );
        c.ago = { steps: l.steps, ...(afterFirst ? { afterFirst } : {}) };
      }
      out.push(c);
      continue;
    }
    if (l.kind === "some") {
      // Parts of several types that pass the same tests are one condition; other tests are said as alternatives.
      const groups = byTests(l.walk, l.ways).map((ways) => ({
        types: ways.flatMap((w) => partOf(w, l.walk).types),
        anyType: ways.some((w) => !partOf(w, l.walk).types.length),
        rest: partTests(l.walk, partOf(ways[0]!, l.walk).rest) as Extract<Literal, { kind: "test" }>[],
      }));
      const types = groups.flatMap((g) => g.types);
      const anyType = groups.some((g) => g.anyType);
      const oneType = groups.every((g) => same(g.types, groups[0]!.types) && g.anyType === groups[0]!.anyType);
      const area = groups.length === 1 ? say.area(groups[0]!.rest) : undefined;
      const tests =
        groups.length === 1
          ? say.tests(groups[0]!.rest)
          : [
              groups
                .map((g) =>
                  [
                    ...(oneType ? [] : [g.anyType ? "any type" : g.types.map((t) => say.typeOf(t).name).join(" or ")]),
                    ...say.tests(g.rest),
                  ].join(", "),
                )
                .join("; or "),
            ];
      out.push({
        kind: "some",
        lists: l.walk.lists,
        ...typesOf(anyType ? [] : types),
        tests,
        ...(area ? { area } : {}),
      });
      continue;
    }
    if (l.kind === "none") {
      out.push(...every(l, say, partTests, typesOf));
      continue;
    }
    if (holds(l, (n) => n.kind === "unset")) throw new DoesntFit(`it reads ${unsetWhy(l)}`);
    const count = l.left.kind === "count" ? l.left : undefined;
    if (count) {
      if (l.right.kind !== "constant") throw new DoesntFit("it compares a count with something other than a number");
      const ways = byTests(
        count.walk,
        shortest(
          dnf(count.where)
            .map(tidy)
            .filter((w): w is Literal[] => !!w),
        ),
      );
      if (ways.length !== 1) throw new DoesntFit("it counts parts that pass one of several tests");
      const types = ways[0]!.flatMap((w) => partOf(w, count.walk).types);
      const rest = partTests(count.walk, partOf(ways[0]![0]!, count.walk).rest);
      out.push({
        kind: "count",
        lists: count.walk.lists,
        ...typesOf(types),
        ...(rest.length ? { where: say.tests(rest) } : {}),
        tests: [],
        count: { op: l.op, value: l.signed ? signed16(l.right.value) : l.right.value },
      });
      continue;
    }
    if (holds(l, (n) => n.kind === "count")) throw new DoesntFit("it does sums with a count of parts");
    const ref = refOf(l);
    if (!ref) {
      out.push({ kind: "word", tests: [say.test(l)] });
      continue;
    }
    if (ref.kind === "each") throw new DoesntFit("it looks at a walk's part after the walk");
    // A test of the part a field holds now goes with the part that holds it, like "angel's type is al-e-cat".
    const owner = ref.kind === "via" && !ref.at ? ref.from : ref;
    const key = JSON.stringify(owner);
    byRef.set(key, { ref: owner, tests: [...(byRef.get(key)?.tests ?? []), l] });
  }
  for (const { ref, tests } of byRef.values()) {
    if (ref.kind === "each") continue;
    if (ref.kind === "via") {
      // The part a field held at the last step a test held, which the goal keeps.
      if (ref.from.kind !== "nth" || !ref.at) throw new DoesntFit("it follows a field of a part it didn't find");
      out.push({
        kind: "nth",
        nth: ref.from.nth,
        lists: ref.from.lists,
        types: [say.typeOf(ref.from.type)],
        via: { name: say.linkName({ ...ref, at: undefined }), kept: true },
        tests: say.tests(tests),
      });
      continue;
    }
    if (ref.kind === "nth") {
      const area = say.area(tests);
      out.push({
        kind: "nth",
        nth: ref.nth,
        lists: ref.lists,
        types: [say.typeOf(ref.type)],
        tests: say.tests(tests, ref.type),
        ...(area ? { area } : {}),
      });
      continue;
    }
    const where = shortest(
      dnf(ref.where)
        .map(tidy)
        .filter((w): w is Literal[] => !!w),
    );
    const groups = byTests(ref.walk, where);
    if (groups.length > 1) throw new DoesntFit(`it looks for the ${ref.kind} part that passes one of several tests`);
    const types = (groups[0] ?? []).flatMap((w) => partOf(w, ref.walk).types);
    const rest = groups[0]?.[0] ? partTests(ref.walk, partOf(groups[0][0], ref.walk).rest) : [];
    const area = say.area(tests);
    out.push({
      kind: ref.kind,
      lists: ref.walk.lists,
      ...typesOf(types),
      ...(rest.length ? { where: say.tests(rest) } : {}),
      tests: say.tests(tests),
      ...(area ? { area } : {}),
    });
  }
  return out;
}

function unsetWhy(l: unknown): string {
  let why = "a value it didn't set";
  holds(l, (n) => {
    if (n.kind === "unset") why = `an unset value: ${(n as { why: string }).why}`;
    return n.kind === "unset";
  });
  return why;
}

/**
 * "No part where one of these ways holds", said as what each part must pass: a way's last test, turned round, for the
 * parts its earlier tests pick. An earlier test that another way already asks of every part of the types says nothing
 * new and is left out, so "x < 342 fails; x ≥ 342 and x > 442 fails" reads "342 ≤ x ≤ 442".
 */
function every(
  l: Extract<Literal, { kind: "none" }>,
  say: Sayer,
  partTests: (walked: Walked, literals: Literal[]) => Literal[],
  typesOf: (types: number[]) => { types?: GoalCondition["types"] },
): GoalCondition[] {
  const rows = l.ways.map((w) => {
    const { types, rest } = partOf(w, l.walk);
    const tests = partTests(l.walk, rest) as Extract<Literal, { kind: "test" }>[];
    return { types, guards: tests.slice(0, -1), last: tests.at(-1) };
  });
  // What every part of the types must pass anyway, where the row's own guards pick it.
  const required = (row: (typeof rows)[number]) =>
    rows
      .filter(
        (r) =>
          r !== row &&
          r.last &&
          (!r.types.length || same(r.types, row.types)) &&
          r.guards.every((g) => row.guards.some((h) => same(g, h))),
      )
      .map((r) => not(r.last!));
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rows) {
      const known = required(r);
      const kept = r.guards.filter((g) => !known.some((k) => same(k, g)));
      if (kept.length < r.guards.length) {
        r.guards = kept;
        changed = true;
      }
    }
  }
  // Rows of the same types and guards are one condition; rows that differ only in type are one condition too.
  const groups: { types: number[]; guards: Extract<Literal, { kind: "test" }>[]; musts: Formula[]; none: boolean }[] =
    [];
  for (const r of rows) {
    const must = r.last ? [not(r.last)] : [];
    const found = groups.find((g) => same(g.types, r.types) && same(g.guards, r.guards) && g.none === !r.last);
    if (found) found.musts.push(...must.filter((m) => !found.musts.some((o) => same(o, m))));
    else groups.push({ types: r.types, guards: r.guards, musts: must, none: !r.last });
  }
  const merged: typeof groups = [];
  for (const g of groups) {
    const found = merged.find(
      (m) =>
        same(m.guards, g.guards) && same(m.musts, g.musts) && m.none === g.none && m.types.length && g.types.length,
    );
    if (found) found.types.push(...g.types);
    else merged.push({ ...g, types: [...g.types] });
  }
  return merged.map((g) => {
    const musts = g.musts as Extract<Literal, { kind: "test" }>[];
    const area = g.guards.length ? undefined : say.area(musts);
    return {
      kind: g.none ? "none" : "every",
      lists: l.walk.lists,
      ...typesOf(g.types),
      ...(g.guards.length ? { where: say.tests(g.guards) } : {}),
      tests: g.none ? [] : say.tests(musts),
      ...(area ? { area } : {}),
    };
  });
}

/** The condition a formula says, for the words a goal keeps: its ways joined by "or". */
function formulaText(f: Formula, say: Sayer): string {
  const ways = shortest(
    dnf(f)
      .map(tidy)
      .filter((w): w is Literal[] => !!w),
  ).map((w) => conditions(w, say).map(conditionText).join(" and "));
  return ways.join(", or ");
}

/** Says a condition in one line, like "every bowling-ball on the moving list: positionY = 264". */
export function conditionText(c: GoalCondition): string {
  const types = c.types?.length ? c.types.map((t) => t.name).join(" or ") : "part";
  const where = c.where?.length ? ` where ${c.where.join(", ")}` : "";
  const on = c.lists ? ` on ${c.lists}` : "";
  const tests = c.tests.join(", ");
  switch (c.kind) {
    case "every":
      return `every ${types}${on}${where}: ${tests}`;
    case "none":
      return `no ${types}${on}${where}`;
    case "some":
      return `some ${types}${on}${tests ? `: ${tests}` : ""}`;
    case "first":
    case "last":
      return `the ${c.kind} ${types}${on}${where}${tests ? `: ${tests}` : ""}`;
    case "count":
      return `the count of ${types}${on}${where} ${OPS[c.count!.op]} ${c.count!.value}${tests ? `, ${tests}` : ""}`;
    case "word":
      return tests;
    case "part":
      return `${types} #${c.part}${tests ? `: ${tests}` : ""}`;
    case "nth": {
      const part = `the ${ordinal(c.nth!)} ${types}${on}`;
      const what = c.via ? `the ${c.via.kept ? "kept " : ""}${c.via.name} of ${part}` : part;
      return `${once(c)}${what}${tests ? `: ${tests}` : ""}`;
    }
  }
}

/** A count of steps in words: "exactly", "at least" and so on before the number. */
const STEP_COUNTS: Record<GoalComparison, string> = {
  "==": "exactly",
  "!=": "other than",
  "<": "fewer than",
  "<=": "at most",
  ">": "more than",
  ">=": "at least",
};

/** When a condition's tests held, as words before it: "at some step so far, ", "last held 30 steps ago, ". */
function once(c: GoalCondition): string {
  const time = c.once === "before" ? "before this one" : "so far";
  if (c.ago)
    return `last held ${c.ago.steps} steps ago${c.once === "before" ? ", this step not counted" : ""}${c.ago.afterFirst ? ", not at the first step" : ""}, `;
  if (!c.once) return "";
  if (c.steps) return `at ${STEP_COUNTS[c.steps.op]} ${c.steps.value} step${c.steps.value === 1 ? "" : "s"} ${time}, `;
  return c.never ? `at no step ${time}, ` : `at some step ${time}, `;
}

/**
 * What a goal that sets up its words in its first step keeps in them. A first pass runs the setup to see what it sets;
 * a word set to a part the finder found (or to something else worked out from the parts, like how many there are),
 * and not written in the steps, keeps that. A second pass runs the steps with those parts: a word set to a number in
 * the setup and changed in the steps only when tests hold remembers what happened (`Latch`): that a test held at some
 * step, the last step it held at, at how many steps it held, the part a field held then, or one of a few numbers by
 * what happened in which order. Without a setup, nothing is kept.
 */
function keptWords(routines: Routines, start: number, names: GoalNames): Kept | undefined {
  const first = new Runner(routines, names);
  try {
    first.routine(start, { env: new Map(), alive: TRUE });
  } catch (problem) {
    // The steps may not fit before the parts are known; the setup comes first and is what this pass is for.
    if (!(problem instanceof DoesntFit)) throw problem;
  }
  const setup = first.setup;
  if (!setup) return undefined;
  const fromParts = (value: Sym) =>
    value.kind !== "constant" &&
    !holds(value, (n) => ["word", "unset", "carried", "index", "stamp", "tally"].includes(n.kind ?? ""));
  const parts = new Map([...setup].filter(([, value]) => fromParts(value)));
  const second = new Runner(routines, names, { parts, latches: new Map(), strict: false });
  const end = second.routine(start, { env: new Map(), alive: TRUE });
  if ([...parts.keys()].some((address) => second.stepWrites.has(address)))
    throw new DoesntFit("it changes a word that keeps a part it found");
  const latches = new Map<number, Latch>();
  for (const [address, value] of setup) {
    if (value.kind !== "constant" || !second.stepWrites.has(address)) continue;
    const before: Sym = { kind: "word", address };
    const last = end.env.get(`w:${address}`) ?? before;
    const found = cases(last);
    const changed = found.filter((c) => !same(c.value, before));
    const to = changed[0]?.value;
    if (!to) continue;
    const steady = changed.every((c) => same(c.value, to));
    const when = or(...changed.map((c) => c.when));
    // A test of a word the goal keeps itself, or of a value it never set, isn't something that happened.
    const ownTests = holds(
      when,
      (n) => n.kind === "unset" || (n.kind === "word" && setup.has((n as { address: number }).address)),
    );
    const latch = { when, value: 0, first: value.value, end: last };
    if (to.kind === "constant" && to.value !== value.value && changed.length < found.length && steady) {
      if (!ownTests) latches.set(address, { ...latch, kind: "latch", value: to.value });
    } else if (steady && names.firstStep !== undefined && same(to, { kind: "word", address: names.firstStep })) {
      if (!ownTests) latches.set(address, { ...latch, kind: "stamp" });
    } else if (steady && same(to, binary("+", before, constant(1)))) {
      if (!ownTests) latches.set(address, { ...latch, kind: "tally" });
    } else if (steady && to.kind === "field" && to.ref.kind === "nth" && value.value === 0 && names.linkName) {
      if (!ownTests) latches.set(address, { ...latch, kind: "link", field: to });
    } else if (found.every((c) => c.value.kind === "constant" || same(c.value, before))) {
      const after = stateAfter(last, address, value.value);
      if (after) latches.set(address, { ...latch, kind: "state", after });
    }
  }
  return { parts, latches, strict: true };
}

/** A formula in one written form for what it says: its ways in order, so two that say the same are the same. */
function normal(f: Formula): Formula {
  const ways = waysOf(f);
  if (ways.some((w) => !w.length)) return TRUE;
  const sorted = ways
    .map((w) => and(...w.map(formula)))
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return or(...sorted);
}

/**
 * A word that holds one of a few numbers, set to `first` in the setup and to one number or another by the tests of
 * each step and what it held before (`last`, with `word` for that): what it holds after a step, as tests of the step
 * and of what happened before. For each number it may hold, the tests that lead to it must be the same from each value
 * they lead from, and the values they lead from must be ones the word holds exactly when a test held at some step
 * before (or never did). So BRAN8's word that becomes 1 when the switch is on and 2 when it is off after being 1 holds
 * 2 when the switch is off and was on at some step before. Undefined when the word isn't of that shape.
 */
function stateAfter(last: Sym, address: number, first: number): Sym | undefined {
  const self: Sym = { kind: "word", address };
  const values = [
    ...new Set([first, ...cases(last).flatMap((c) => (c.value.kind === "constant" ? [c.value.value] : []))]),
  ].sort((a, b) => a - b);
  if (values.length > 4) return undefined;
  /** The tests under which the word becomes one of `targets` from `from`. */
  const into = (targets: number[], from: number) =>
    normal(
      or(
        ...cases(rebuildSym(replaced(last, self, constant(from))))
          .filter((c) => c.value.kind === "constant" && targets.includes(c.value.value))
          .map((c) => rebuild(c.when)),
      ),
    );
  /** The test that held at some step exactly when the word holds one of `set`, or undefined. */
  const everIn = (set: number[]): Formula | undefined => {
    if (set.includes(first) || !set.length) return undefined;
    if (!set.every((v) => into(set, v).kind === "true")) return undefined;
    const outside = values.filter((v) => !set.includes(v)).map((v) => into(set, v));
    return outside.every((f) => same(f, outside[0])) ? outside[0] : undefined;
  };
  /** That the word held one of `set` before this step, as what happened. */
  const before = (set: number[]): Formula | undefined => {
    if (set.length === values.length) return TRUE;
    const ever = everIn(set);
    if (ever) return { kind: "ever", item: ever, before: true };
    const never = everIn(values.filter((v) => !set.includes(v)));
    return never ? not({ kind: "ever", item: never, before: true }) : undefined;
  };
  const ways: { value: number; when: Formula }[] = [];
  for (const target of values) {
    const from = values.map((v) => into([target], v));
    const reached = values.filter((_, k) => from[k]!.kind !== "false");
    if (!reached.length) continue;
    const test = from[values.indexOf(reached[0]!)]!;
    if (!reached.every((v) => same(from[values.indexOf(v)], test))) return undefined;
    const held = before(reached);
    if (!held) return undefined;
    ways.push({ value: target, when: and(test, held) });
  }
  if (!ways.length) return undefined;
  return ways
    .slice(0, -1)
    .reduceRight((rest: Sym, w) => ite(w.when, constant(w.value), rest), constant(ways.at(-1)!.value));
}

/** Conditions on parts the finder found in the order of their types' first condition, then by their place. */
function inOrder(conditions: GoalCondition[]): GoalCondition[] {
  const types = conditions.map((c) => c.types?.[0]?.type);
  const rank = (c: GoalCondition) => [types.indexOf(c.types?.[0]?.type), c.nth ?? 0];
  return [...conditions].sort((a, b) => rank(a)[0]! - rank(b)[0]! || rank(a)[1]! - rank(b)[1]!);
}

/** The parts a sym or formula looks at that the finder found. */
function foundParts(value: unknown): string[] {
  const out = new Set<string>();
  holds(value, (n) => {
    const ref = (n as { ref?: PartRef }).ref;
    if (ref?.kind === "nth") out.add(JSON.stringify(ref));
    return false;
  });
  return [...out];
}

/**
 * A goal met when each of some parts it found passes one of several tests, as one way: a condition for each part,
 * with the tests all its ways share and then its alternatives. Undefined when the goal isn't of that shape.
 */
function byPart(met: Formula, say: Sayer): GoalCondition[] | undefined {
  // "Not (A or B)" is "not A and not B".
  const items =
    met.kind === "and" ? met.items : met.kind === "not" && met.item.kind === "or" ? met.item.items.map(not) : [met];
  const groups = new Map<string, Formula[]>();
  for (const item of items) {
    const parts = foundParts(item);
    if (parts.length !== 1) return undefined;
    groups.set(parts[0]!, [...(groups.get(parts[0]!) ?? []), item]);
  }
  const out: GoalCondition[] = [];
  for (const formulas of groups.values()) {
    const ways = withHistory(waysOf(and(...formulas)));
    if (ways.length > MOST_WAYS) return undefined;
    const each = ways.map((w) => conditions(w, say));
    if (each.some((c) => c.length !== 1)) return undefined;
    const first = each[0]![0]!;
    if (each.some(([c]) => !same({ ...c, tests: [], area: undefined }, { ...first, tests: [], area: undefined })))
      return undefined;
    const shared = first.tests.filter((t) => each.every(([c]) => c!.tests.includes(t)));
    const alternatives = each.map(([c]) => c!.tests.filter((t) => !shared.includes(t)));
    const area = each.length === 1 ? first.area : undefined;
    out.push({
      ...first,
      tests: [
        ...shared,
        ...(each.length > 1
          ? [`one of: ${alternatives.map((a) => (a.length > 1 ? `(${a.join(", ")})` : a[0])).join(" or ")}`]
          : []),
      ],
      ...(area ? { area } : { area: undefined }),
    });
    if (!out.at(-1)!.area) delete out.at(-1)!.area;
  }
  return out;
}

/** Says the goal routine at `start` as conditions, or why it can't. */
export function summariseGoal(routines: Routines, start: number, names: GoalNames): GoalSummary {
  try {
    const kept = names.firstStep === undefined ? undefined : keptWords(routines, start, names);
    const runner = new Runner(routines, names, kept);
    const end = runner.routine(start, { env: new Map(), alive: TRUE });
    const say = new Sayer(names, runner.written);
    const met = or(...runner.met);
    const state = (n: { kind?: string }) =>
      n.kind === "word" && kept?.latches.get((n as { address: number }).address)?.kind === "state";
    if (holds(met, state)) throw new DoesntFit("it tests a word it keeps partway through the step's writes");
    let ways: Literal[][];
    try {
      ways = withHistory(
        shortest(
          dnf(met)
            .map(tidy)
            .filter((w): w is Literal[] => !!w),
        ),
      );
      if (ways.length > MOST_WAYS) throw new DoesntFit("it has too many ways to be met");
    } catch (problem) {
      // Parts it found that each pass one of several tests, all at once: one condition each, with the tests as
      // alternatives, instead of a way for every choice.
      const each = kept && problem instanceof DoesntFit ? byPart(met, say) : undefined;
      if (!each) throw problem;
      return { ways: [inOrder(each)], remembered: [] };
    }
    const remembered = [...runner.written]
      .sort((a, b) => a - b)
      .map((address) => {
        const name = names.words.get(address) ?? `word ${hex(address)}`;
        const value = end.env.get(`w:${address}`) ?? { kind: "word", address };
        const found = cases(value);
        const becomes = found.map((c, k) => {
          const what = same(c.value, { kind: "word", address }) ? "stays" : `becomes ${say.sym(c.value)}`;
          if (found.length === 1) return what;
          return k === found.length - 1 ? `else ${what}` : `${what} when ${formulaText(c.when, say)}`;
        });
        return { word: name, becomes };
      });
    return { ways: ways.map((w) => (kept ? inOrder(conditions(w, say)) : conditions(w, say))), remembered };
  } catch (problem) {
    if (problem instanceof DoesntFit) return { ways: [], remembered: [], problem: problem.message };
    throw problem;
  }
}
