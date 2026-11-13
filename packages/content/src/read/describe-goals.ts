/**
 * Says a goal program (`puzzle-goals.ts`) in words, as indented lines of pseudo-code: the parts' fields by name, part
 * types by id, the lists a loop walks, and the write that ends the run as "the goal is met". The program itself stays
 * the exact form; this is only a way to read it.
 */
import {
  farWord,
  type GoalProblem,
  type GoalRoutine,
  type GoalStatement,
  type GoalTest,
  type GoalValue,
  negate,
} from "./puzzle-goals.ts";

export interface GoalNames {
  /** Part fields by offset, like `positionX` for 0x1e. */
  fields: ReadonlyMap<number, string>;
  /** Part types by number, like `basketball`. */
  types: ReadonlyMap<number, string>;
  /** The global parts lists: the word with each one's first part, its bit for the list routines and its name. */
  lists: readonly { head: number; bit: number; name: string }[];
  /** The list head and list next routines, which a loop over parts calls. */
  listHead?: number;
  listNext?: number;
  /** Other words of the data segment by address, like the game mode word. */
  words: ReadonlyMap<number, string>;
  /**
   * The word a goal writes when it is met, and the value that ends the run. Without a value, any write meets the goal:
   * Toons' goals write how many steps the run goes on before it ends.
   */
  mode?: { word: number; met?: number };
  /** Names for routines a goal calls, like "puzzle 17's goal". */
  routines?: ReadonlyMap<number, string>;
  /**
   * A routine that gives the n-th part of a type on the lists the mask names (its arguments: the type, n from 1 and the
   * mask), as Toons' goals find their parts. A call to it is said as what it finds.
   */
  finder?: number;
}

const TYPE = 0x04;
const PART_SIZE = 0xa0;

type Routines = ReadonlyMap<number, GoalRoutine | GoalProblem>;

const hex = (value: number) => `0x${value.toString(16)}`;
/** A word's address: a far one as its segment and offset. */
const place = (address: number) => {
  const far = farWord(address);
  return far ? `${hex(far.segment)}:${far.offset.toString(16).padStart(4, "0")}` : hex(address);
};
const signed = (value: number) => (value >= 0x8000 ? value - 0x10000 : value);
const isRegister = (v: GoalValue, name?: string): v is { kind: "register"; name: string } =>
  v.kind === "register" && (name === undefined || v.name === name);
const isConstant = (v: GoalValue, value?: number): v is { kind: "constant"; value: number } =>
  v.kind === "constant" && (value === undefined || v.value === value);

/** A loop over the parts of lists, read from one of the two forms the goals use. */
export interface Walk {
  kind: "walk";
  part: string;
  lists: string;
  body: GoalStatement[];
}

/** A loop that steps along the moving list until a test fails, without stopping at the list's end. */
export interface Search {
  kind: "search";
  part: string;
  list: string;
  test: GoalTest;
}

/** A call to the finder: the n-th part of a type on some lists, put in `target`. */
export interface Find {
  kind: "find";
  /** Where the part goes: the word the result is stored in right after the call, or `ax`. */
  target: GoalValue;
  /** Whether the statement after the call, the store, is taken too. */
  stored: boolean;
  type: GoalValue;
  nth: GoalValue;
  mask: GoalValue;
}

export type Shown = GoalStatement | Walk | Search | Find;

/**
 * The constant a body pushes at `k` (a set of a local below the frame), directly or from a register set to it just
 * before, and where the statements after it start.
 */
function pushedConstant(
  body: readonly GoalStatement[],
  k: number,
): { value: number; next: number; from: number } | undefined {
  const s = body[k];
  if (s?.kind !== "set" || s.target.kind !== "local") return undefined;
  if (isConstant(s.value)) return { value: s.value.value, next: k + 1, from: k };
  const before = body[k - 1];
  if (
    isRegister(s.value) &&
    before?.kind === "set" &&
    isRegister(before.target, s.value.name) &&
    isConstant(before.value)
  )
    return { value: before.value.value, next: k + 1, from: k - 1 };
  return undefined;
}

/** The lists a walk visits, by the masks it gives the list head and list next routines. */
function listsByMasks(names: GoalNames, head: number, next: number): string | undefined {
  const order = [...names.lists];
  const first = order.filter((l) => head & l.bit);
  const after = order.filter((l) => next & l.bit);
  if (!first.length) return undefined;
  const walked: string[] = [];
  // The head routine takes the first list of the head mask; at the end of a fixed part's list the next routine goes
  // on with the head routine and its own mask, and after a moving part's with the third list when its mask has it.
  const visit = (list: (typeof order)[number] | undefined) => {
    if (!list || walked.includes(list.name)) return;
    walked.push(list.name);
    const k = order.indexOf(list);
    if (k === 0) visit(after.find((l) => l !== list));
    else if (k === 1 && order[2] && next & order[2].bit) visit(order[2]);
  };
  for (const list of first) visit(list);
  return walked.join(", then ");
}

/** An expression with a register replaced by a value. */
function substitute(v: GoalValue, name: string, by: GoalValue): GoalValue {
  if (isRegister(v, name)) return by;
  if (v.kind === "binary") return { ...v, left: substitute(v.left, name, by), right: substitute(v.right, name, by) };
  if (v.kind === "word") return { ...v, address: substitute(v.address, name, by) };
  return v;
}

/**
 * A call to the finder at `call`, with its three arguments pushed before it (each maybe from a register worked out
 * just before) and its result stored right after it: what to say instead, and where the statements it takes start.
 */
function finding(
  body: readonly GoalStatement[],
  call: number,
  finder: number,
): { find: Find; start: number } | undefined {
  const c = body[call];
  const store = body[call + 1];
  if (c?.kind !== "call" || c.routine !== finder) return undefined;
  const stored = store?.kind === "set" && isRegister(store.value, "ax");
  const args: GoalValue[] = [];
  let at = call - 1;
  for (let n = 0; n < 3; n++) {
    const push = body[at];
    if (push?.kind !== "set" || push.target.kind !== "local" || push.target.offset !== c.stack + 2 * n)
      return undefined;
    let value = push.value;
    at--;
    // The register pushed, worked out in the statements just before: `ax = si; ax += 1`.
    for (let before = body[at]; ; before = body[at]) {
      if (!isRegister(value) || before?.kind !== "set" || !isRegister(before.target, value.name)) break;
      const name = value.name;
      value = before.value;
      at--;
      // Earlier sets of the same register build the value up: substitute them in.
      for (let earlier = body[at]; earlier?.kind === "set" && isRegister(earlier.target, name); earlier = body[at]) {
        value = substitute(value, name, earlier.value);
        at--;
      }
    }
    args.push(value);
  }
  const [type, nth, mask] = args as [GoalValue, GoalValue, GoalValue];
  const target: GoalValue = stored ? store.target : { kind: "register", name: "ax" };
  return { find: { kind: "find", target, stored, type, nth, mask }, start: at + 1 };
}

/** Finds the walks and searches in a body and shows them as such; the rest stays as it is. */
export function shape(body: readonly GoalStatement[], names: GoalNames): Shown[] {
  const out: Shown[] = [];
  const lists = new Map(names.lists.map((l) => [l.head, l.name]));
  for (let k = 0; k < body.length; k++) {
    const s = body[k]!;
    const loop = body[k + 1];
    const found = names.finder === undefined ? undefined : finding(body, k, names.finder);
    // The pushes and the registers loaded for them were shown one to one before; the finding takes their place.
    if (
      found &&
      out.length >= k - found.start &&
      out.slice(out.length - (k - found.start)).every((x) => x.kind === "set")
    ) {
      out.splice(out.length - (k - found.start));
      out.push(found.find);
      if (found.find.stored) k++;
      continue;
    }
    // r = [list head]; while r != 0: body; r = [r]
    if (
      s.kind === "set" &&
      s.target.kind === "register" &&
      s.value.kind === "word" &&
      isConstant(s.value.address) &&
      lists.has(s.value.address.value) &&
      loop?.kind === "loop" &&
      !loop.before.length
    ) {
      const r = s.target.name;
      const list = lists.get(s.value.address.value)!;
      const last = loop.body.at(-1);
      const steps =
        last?.kind === "set" &&
        isRegister(last.target, r) &&
        last.value.kind === "word" &&
        isRegister(last.value.address, r);
      const untilEnd = isRegister(loop.test.left, r) && isConstant(loop.test.right, 0) && loop.test.op === "!=";
      if (steps && untilEnd) {
        out.push({ kind: "walk", part: r, lists: list, body: shape(loop.body.slice(0, -1), names) as GoalStatement[] });
        k++;
        continue;
      }
      if (steps && loop.body.length === 1) {
        out.push({ kind: "search", part: r, list, test: loop.test });
        k++;
        continue;
      }
    }
    // push m; call list head; pop; while (r = ax) != 0: body; push m'; push r; call list next; pop; pop. A mask may be
    // pushed from a register loaded with it just before.
    const head = pushedConstant(body, k);
    const call = body[head?.next ?? -1];
    const walk = body[(head?.next ?? -1) + 2];
    if (
      head &&
      call?.kind === "call" &&
      call.routine === names.listHead &&
      walk?.kind === "loop" &&
      walk.before.length === 1
    ) {
      const before = walk.before[0]!;
      const r = before.kind === "set" && before.target.kind === "register" ? before.target.name : undefined;
      const n = walk.body.length;
      const nextCall = walk.body[n - 3];
      const pushPart = walk.body[n - 4];
      const mask = [n - 5, n - 6]
        .map((at) => ({ at, found: pushedConstant(walk.body, at) }))
        .find((m) => m.found?.next === n - 4);
      if (
        r &&
        before.kind === "set" &&
        isRegister(before.value, "ax") &&
        isRegister(walk.test.left, r) &&
        isConstant(walk.test.right, 0) &&
        nextCall?.kind === "call" &&
        nextCall.routine === names.listNext &&
        pushPart?.kind === "set" &&
        isRegister(pushPart.value, r) &&
        mask?.found
      ) {
        const visited = listsByMasks(names, head.value, mask.found.value);
        if (visited) {
          // The register the head's mask was loaded into was said already.
          if (head.from < k) out.pop();
          out.push({
            kind: "walk",
            part: r,
            lists: visited,
            body: shape(walk.body.slice(0, mask.found.from), names) as GoalStatement[],
          });
          k = head.next + 2;
          continue;
        }
      }
    }
    if (s.kind === "if")
      out.push({ ...s, then: shape(s.then, names) as GoalStatement[], else: shape(s.else, names) as GoalStatement[] });
    else if (s.kind === "loop")
      out.push({
        ...s,
        before: shape(s.before, names) as GoalStatement[],
        body: shape(s.body, names) as GoalStatement[],
      });
    else out.push(s);
  }
  return out;
}

/** A routine's body without the pushes it starts with to keep its caller's si and di, which its end restores. */
export function withoutSaves(body: readonly GoalStatement[]): GoalStatement[] {
  let k = 0;
  while (k < body.length) {
    const s = body[k]!;
    if (s.kind !== "set" || s.target.kind !== "local" || !isRegister(s.value) || !["si", "di"].includes(s.value.name))
      break;
    k++;
  }
  return body.slice(k);
}

const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** The lists a mask names, by the bits the list routines test: 0x2000 fixed, 0x1000 moving, 0x0800 the third. */
const MASK_LISTS: [number, string][] = [
  [0x2000, "the fixed list"],
  [0x1000, "the moving list"],
  [0x0800, "the third list"],
];
const masked = (mask: number) => {
  const lists = MASK_LISTS.filter(([bit]) => mask & bit).map(([, name]) => name);
  return lists.length ? lists.join(" or ") : `the lists ${hex(mask)}`;
};

const OPS: Record<GoalTest["op"], string> = { "==": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥" };

/**
 * Says the goal routine at `start` in words, one line per statement with two spaces of indent per level. Routines it
 * calls without arguments are said in place; a routine that isn't read is named with its reason.
 */
export function describeGoal(routines: Routines, start: number, names: GoalNames): string[] {
  const lines: string[] = [];
  const parts = new Map<string, string>();

  const value = (v: GoalValue, hexadecimal = false): string => {
    switch (v.kind) {
      case "constant":
        return hexadecimal ? hex(v.value) : String(signed(v.value));
      case "register":
        return parts.get(v.name) ?? v.name;
      case "local":
        return v.offset < 0 ? `local ${-v.offset}` : `argument ${(v.offset - 6) / 2 + 1}`;
      case "localAddress":
        return `the place of local ${-v.offset}`;
      case "word": {
        const a = v.address;
        if (isConstant(a))
          return (
            names.words.get(a.value) ??
            names.lists.find((l) => l.head === a.value)?.name.replace(/^the /, "the first part on the ") ??
            `word ${place(a.value)}`
          );
        if (isRegister(a)) return `${value(a)}.next`;
        if (
          a.kind === "binary" &&
          a.op === "+" &&
          isRegister(a.left) &&
          isConstant(a.right) &&
          a.right.value < PART_SIZE
        )
          return `${value(a.left)}.${names.fields.get(a.right.value) ?? hex(a.right.value)}`;
        if (a.kind === "binary" && a.op === "+" && isConstant(a.right))
          return `word ${place(a.right.value)}[${value(a.left)}]`;
        return `word [${value(a)}]`;
      }
      case "binary": {
        const mask = ["&", "|", "^"].includes(v.op);
        const right = v.op === "<<" || v.op === ">>" || v.op === ">>>" ? value(v.right) : value(v.right, mask);
        return `(${value(v.left, mask)} ${v.op} ${right})`;
      }
    }
  };

  const typeField = (v: GoalValue) =>
    v.kind === "word" && v.address.kind === "binary" && v.address.op === "+" && isConstant(v.address.right, TYPE);

  const test = (t: GoalTest): string => {
    if (t.left.kind === "binary" && t.left.op === "&" && isConstant(t.right, 0) && (t.op === "==" || t.op === "!=")) {
      return `${value(t.left.left)} ${t.op === "!=" ? "has" : "hasn't"} the bits ${value(t.left.right, true)}`;
    }
    if (typeField(t.left) && isConstant(t.right) && (t.op === "==" || t.op === "!=")) {
      const type = names.types.get(t.right.value) ?? `type ${t.right.value}`;
      return `${value(t.left)} ${t.op === "==" ? "is" : "isn't"} ${type}`;
    }
    const unsigned = !t.signed && t.op !== "==" && t.op !== "!=" ? " (unsigned)" : "";
    // An unsigned test's number is said as the unsigned word it is: 40000, not -25536.
    const right = unsigned && isConstant(t.right) ? String(t.right.value & 0xffff) : value(t.right);
    return `${value(t.left)} ${OPS[t.op]} ${right}${unsigned}`;
  };

  const say = (body: readonly Shown[], depth: number, called: readonly number[]) => {
    const pad = "  ".repeat(depth);
    for (const s of body) {
      switch (s.kind) {
        case "walk": {
          const name = [...parts.values()].includes("part") ? "other part" : "part";
          parts.set(s.part, name);
          lines.push(`${pad}for each ${name} on ${s.lists}:`);
          say(s.body, depth + 1, called);
          parts.delete(s.part);
          break;
        }
        case "find": {
          const type = isConstant(s.type) ? (names.types.get(s.type.value) ?? `type ${s.type.value}`) : value(s.type);
          const nth = isConstant(s.nth) ? ordinal(s.nth.value) : `number ${value(s.nth)}`;
          const lists = isConstant(s.mask) ? masked(s.mask.value) : `the lists ${value(s.mask, true)}`;
          lines.push(`${pad}${value(s.target)} = the ${nth} ${type} on ${lists}, or 0 if there is none`);
          break;
        }
        case "search":
          lines.push(
            `${pad}${s.part} = the first part from the start of ${s.list} where ${test(negate(s.test)).replace(new RegExp(`\\b${s.part}\\b`, "g"), "it")}, going on past the list's end if none is`,
          );
          break;
        case "set": {
          const target = value(s.target);
          if (names.mode && s.target.kind === "word" && isConstant(s.target.address, names.mode.word)) {
            if (names.mode.met === undefined)
              lines.push(`${pad}the goal is met, and the run ends ${value(s.value)} steps later`);
            else
              lines.push(
                isConstant(s.value, names.mode.met)
                  ? `${pad}the goal is met`
                  : `${pad}${target} = ${value(s.value, true)}`,
              );
            break;
          }
          const v = s.value;
          if (
            v.kind === "binary" &&
            (v.op === "+" || v.op === "-") &&
            JSON.stringify(v.left) === JSON.stringify(s.target)
          ) {
            const by = isConstant(v.right) ? signed(v.right.value) : undefined;
            if (by === 1) {
              lines.push(`${pad}${target} ${v.op === "+" ? "+" : "-"}= 1`);
              break;
            }
          }
          lines.push(`${pad}${target} = ${value(v)}`);
          break;
        }
        case "if": {
          const thenEmpty = !s.then.length;
          lines.push(`${pad}if ${test(thenEmpty ? negate(s.test) : s.test)}:`);
          say((thenEmpty ? s.else : s.then) as Shown[], depth + 1, called);
          if (!thenEmpty && s.else.length) {
            lines.push(`${pad}else:`);
            say(s.else as Shown[], depth + 1, called);
          }
          break;
        }
        case "loop":
          lines.push(`${pad}repeat:`);
          say(s.before as Shown[], depth + 1, called);
          lines.push(`${pad}  stop repeating unless ${test(s.test)}`);
          say(s.body as Shown[], depth + 1, called);
          break;
        case "call": {
          const routine = routines.get(s.routine);
          if (!routine || !("body" in routine)) {
            lines.push(`${pad}call ${hex(s.routine)}, which isn't read${routine ? `: ${routine.reason}` : ""}`);
            break;
          }
          if (called.includes(s.routine)) {
            lines.push(`${pad}call ${hex(s.routine)} again (it calls itself)`);
            break;
          }
          lines.push(`${pad}do ${names.routines?.get(s.routine) ?? `the routine at ${hex(s.routine)}`}:`);
          say(shape(withoutSaves(routine.body), names), depth + 1, [...called, s.routine]);
          break;
        }
        case "break":
          lines.push(`${pad}stop the loop`);
          break;
        case "return":
          lines.push(`${pad}stop`);
          break;
      }
    }
  };

  const routine = routines.get(start);
  if (!routine || !("body" in routine))
    return [`the goal routine at ${hex(start)} isn't read${routine ? `: ${routine.reason}` : ""}`];
  say(shape(withoutSaves(routine.body), names), 0, [start]);
  return lines.length ? lines : ["nothing: the goal is never met"];
}
