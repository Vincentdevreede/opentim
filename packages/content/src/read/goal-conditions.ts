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
import { shape, withoutSaves, type GoalNames, type Shown } from "./describe-goals.ts";
import type { GoalComparison, GoalOperator, GoalProblem, GoalRoutine, GoalTest, GoalValue } from "./puzzle-goals.ts";

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
   * `word`: a test of a word of the game's memory, like the step count.
   */
  kind: "every" | "none" | "some" | "first" | "last" | "count" | "word";
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
const PART_SIZE = 0xa0;
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

/** A walk over lists of parts. */
interface Walked {
  id: number;
  lists: string;
}

type PartRef =
  | { kind: "each"; walk: Walked }
  /** The first part of a walk where `where` holds. */
  | { kind: "first"; walk: Walked; where: Formula }
  /** The last part of a walk where `where` holds. */
  | { kind: "last"; walk: Walked; where: Formula };

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
  | { kind: "unset"; why: string };

type Formula =
  | { kind: "true" }
  | { kind: "false" }
  | { kind: "test"; op: GoalComparison; signed: boolean; left: Sym; right: Sym }
  | { kind: "and"; items: Formula[] }
  | { kind: "or"; items: Formula[] }
  | { kind: "not"; item: Formula }
  /** `then` when `when` holds, else `else`: a test of a word that is one of two values. */
  | { kind: "choose"; when: Formula; then: Formula; else: Formula }
  | { kind: "some"; walk: Walked; where: Formula };

class DoesntFit extends Error {}

const TRUE: Formula = { kind: "true" };
const FALSE: Formula = { kind: "false" };
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const constant = (value: number): Sym => ({ kind: "constant", value: value & 0xffff });
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
  const a = isSigned ? signed16(l) : l;
  const b = isSigned ? signed16(r) : r;
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
  // A constant goes on the right, and a constant added on the left moves over for an equality.
  if (left.kind === "constant") {
    const flipped: Record<GoalComparison, GoalComparison> = {
      "==": "==",
      "!=": "!=",
      "<": ">",
      "<=": ">=",
      ">": "<",
      ">=": "<=",
    };
    return test(flipped[op], isSigned, right, left);
  }
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

/** Runs a goal program symbolically: what each word becomes, and when the goal is met. */
class Runner {
  private walks = 0;
  private frames = 0;
  /** The routines running now, from the goal down to the one that runs, with how many times each is. */
  private readonly calling = new Map<number, number>();
  readonly met: Formula[] = [];
  /** The data segment words the goal writes, by address. */
  readonly written = new Set<number>();
  private readonly heads: ReadonlyMap<number, string>;
  private readonly routines: Routines;
  private readonly names: GoalNames;

  constructor(routines: Routines, names: GoalNames) {
    this.routines = routines;
    this.names = names;
    this.heads = new Map(names.lists.map((l) => [l.head, l.name]));
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
      const end = this.run(shape(withoutSaves(routine.body), this.names), { env, alive: state.alive }, frame, returns);
      return merge([...returns, end]);
    } finally {
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
      return { kind: "word", address: address.value };
    }
    if (address.kind === "part") return { kind: "field", ref: address.ref, offset: 0 };
    if (
      address.kind === "binary" &&
      address.op === "+" &&
      address.left.kind === "part" &&
      address.right.kind === "constant" &&
      address.right.value < PART_SIZE
    )
      return { kind: "field", ref: address.left.ref, offset: address.right.value };
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
        if (address.kind === "constant" && env.has(`w:${address.value}`)) return env.get(`w:${address.value}`)!;
        return this.read(address);
      }
      case "binary":
        return binary(v.op, this.value(v.left, env, frame), this.value(v.right, env, frame));
    }
  }

  condition(t: GoalTest, env: Env, frame: number): Formula {
    return test(t.op, t.signed, this.value(t.left, env, frame), this.value(t.right, env, frame));
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
            if (value.kind !== "constant" || value.value !== mode.met)
              throw new DoesntFit("it sets the game mode to something other than the goal being met");
            this.met.push(state.alive);
            break;
          }
          if (key.startsWith("w:")) this.written.add(Number(key.slice(2)));
          state.env.set(key, value);
          break;
        }
        case "if": {
          const when = this.condition(s.test, state.env, frame);
          const then = this.run(s.then as Shown[], { env: state.env, alive: and(state.alive, when) }, frame, returns);
          const otherwise = this.run(
            s.else as Shown[],
            { env: state.env, alive: and(state.alive, not(when)) },
            frame,
            returns,
          );
          state = mergeIf(when, state, then, otherwise);
          break;
        }
        case "walk":
          state = this.walkOver(s.lists, s.part, s.body as Shown[], state, frame);
          break;
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
        case "break":
          throw new DoesntFit("it stops a loop early");
        case "loop":
          throw new DoesntFit("it has a loop that isn't a walk over the parts");
      }
    }
    return state;
  }

  /**
   * A walk over the parts of lists. The body runs once for a part of the walk, with each word it changes as it was
   * when the walk came to that part. A word the body sets to one value when a test holds is that value after the walk
   * when some part passed the test; a word it adds 1 to counts the parts that pass; a register it sets to the part is
   * the last part that passes. Anything else the body does with a word it changes is beyond these shapes.
   */
  private walkOver(lists: string, part: string, body: readonly Shown[], state: State, frame: number): State {
    const walked = this.walk(lists);
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
    inside.set(`r:${part}`, { kind: "part", ref: { kind: "each", walk: walked } });
    const met = this.met.length;
    const end = this.run(body, { env: inside, alive: TRUE }, frame, []);
    const metInside = this.met.splice(met);
    const each: Sym = { kind: "part", ref: { kind: "each", walk: walked } };
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
      const when = or(...changed.map((c) => c.when));
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
    env.set(`r:${part}`, { kind: "unset", why: "the part a walk ended on" });
    for (const m of metInside) {
      if (carries(m)) throw new DoesntFit("a walk's tests look at what it found before");
      this.met.push(and(state.alive, { kind: "some", walk: walked, where: m }));
    }
    return { env, alive: state.alive };
  }
}

/** Whether a sym or formula looks at the part of a walk. */
const mentions = (value: unknown, walked: Walked) =>
  holds(
    value,
    (n) => (n as { ref?: PartRef }).ref?.kind === "each" && (n as { ref: PartRef }).ref.walk.id === walked.id,
  );

/** The state where ways meet: each word is the value of the way that got there. */
function merge(states: State[]): State {
  const live = states.filter((s) => s.alive.kind !== "false");
  if (!live.length) return { env: states[0]?.env ?? new Map(), alive: FALSE };
  if (live.length === 1) return live[0]!;
  const keys = new Set(live.flatMap((s) => [...s.env.keys()]));
  const env: Env = new Map();
  for (const key of keys) {
    const missing: Sym = key.startsWith("w:")
      ? { kind: "word", address: Number(key.slice(2)) }
      : { kind: "unset", why: `${key.slice(2)} on one of the ways` };
    const values = live.map((s) => s.env.get(key) ?? missing);
    let value = values.at(-1)!;
    for (let k = live.length - 2; k >= 0; k--) value = ite(live[k]!.alive, values[k]!, value);
    env.set(key, value);
  }
  // Two ways of one test meet: the program runs whenever it ran before.
  const alive = or(...live.map((s) => s.alive));
  return { env, alive: simplifyAlive(alive, live) };
}

/** The state after an if: each word is the value of the branch the test picked. */
function mergeIf(when: Formula, before: State, then: State, otherwise: State): State {
  if (then.alive.kind === "false") return otherwise;
  if (otherwise.alive.kind === "false") return then;
  const env: Env = new Map();
  for (const key of new Set([...then.env.keys(), ...otherwise.env.keys()])) {
    const unset: Sym = key.startsWith("w:")
      ? { kind: "word", address: Number(key.slice(2)) }
      : { kind: "unset", why: `${key.slice(2)} on one of the ways` };
    env.set(key, ite(when, then.env.get(key) ?? unset, otherwise.env.get(key) ?? unset));
  }
  // Without a return in either branch the program runs on whenever it ran before the test.
  const whole = same(then.alive, and(before.alive, when)) && same(otherwise.alive, and(before.alive, not(when)));
  return { env, alive: whole ? before.alive : or(then.alive, otherwise.alive) };
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
  | { kind: "none"; walk: Walked; ways: Literal[][] };

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
      if (negated) return [[{ kind: "none", walk: f.walk, ways: inner }]];
      return [[{ kind: "some", walk: f.walk, ways: inner }]];
    }
  }
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
      case "field":
        return this.names.fields.get(v.offset) ?? `field ${hex(v.offset)}`;
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
    }
  }

  test(t: Extract<Literal, { kind: "test" }>): string {
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
      return `type ${t.op === "==" ? "is" : "isn't"} ${this.typeOf(t.right.value).name}`;
    const unsigned = !t.signed && t.op !== "==" && t.op !== "!=" ? " (unsigned)" : "";
    return `${this.sym(t.left)} ${OPS[t.op]} ${unsigned ? this.bound(t.right) : this.sym(t.right)}${unsigned}`;
  }

  /** A number an unsigned test compares with, as the test reads it: from 0x8000 up it stays positive. */
  private bound(v: Sym): string {
    return v.kind === "constant" ? String(v.value) : this.sym(v);
  }

  /** Says tests, with a lower and an upper bound of one field as one range. */
  tests(literals: Extract<Literal, { kind: "test" }>[]): string[] {
    const out: string[] = [];
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
        out.push(this.test(t));
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
    const key = JSON.stringify(ref);
    byRef.set(key, { ref, tests: [...(byRef.get(key)?.tests ?? []), l] });
  }
  for (const { ref, tests } of byRef.values()) {
    if (ref.kind === "each") continue;
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
      return `the count of ${types}${on}${where} ${OPS[c.count!.op]} ${c.count!.value}`;
    case "word":
      return tests;
  }
}

/** Says the goal routine at `start` as conditions, or why it can't. */
export function summariseGoal(routines: Routines, start: number, names: GoalNames): GoalSummary {
  try {
    const runner = new Runner(routines, names);
    const end = runner.routine(start, { env: new Map(), alive: TRUE });
    const say = new Sayer(names, runner.written);
    const met = or(...runner.met);
    const ways = shortest(
      dnf(met)
        .map(tidy)
        .filter((w): w is Literal[] => !!w),
    );
    if (ways.length > MOST_WAYS) throw new DoesntFit("it has too many ways to be met");
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
    return { ways: ways.map((w) => conditions(w, say)), remembered };
  } catch (problem) {
    if (problem instanceof DoesntFit) return { ways: [], remembered: [], problem: problem.message };
    throw problem;
  }
}
