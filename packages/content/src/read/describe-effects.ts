/**
 * What other parts do to a part without changing its frame, like the explosion's push: a short line on the part's
 * description instead of a walk. Each line comes from a proved per-member outcome of another part's routine, worked
 * out for this part's type. A line is only made when the outcome's condition on the member is decided by the type
 * alone, apart from which list the part is on, and when every field it sets gets a number. An outcome that sets the
 * part's state, or a field the part's own rules read, can change its frame: walks are the place for that, so it gets
 * no line here. A part also gets what the bounce of a part it touches sets on it, with the tests of both parts.
 */
import type {
  BehaviourReport,
  Confidence,
  Evidence,
  Expression,
  FieldWrite,
  Finding,
  Predicate,
  RoutineOutcome,
} from "./behaviour.ts";
import type { KnownField } from "./describe-behaviour.ts";
import { binary, speedLimitOf } from "./behaviour.ts";
import { directionError } from "./behaviour-centre-angle.ts";
import {
  compareWords,
  formula,
  impossible,
  joinPaths,
  longPart,
  testsInWords,
  testsOf,
  type Names,
  type Tests,
} from "./describe-touch.ts";
import {
  flagTest,
  isLightableTest,
  LIGHTABLE_ASSUMPTION,
  LIGHTABLE_PARTS,
  searchTests,
  type SearchTest,
} from "./describe-hits.ts";

/**
 * The list flags of a part at `0x06`: the routine that puts a part on a list (`0x6469` in Even More, English floppy)
 * gives it `0x1000` and the moving list when its starting flags lack `0x4000`, and `0x2000` and the fixed list
 * otherwise.
 */
export const LIST_FLAGS = 0x06;
const MOVING_LIST = 0x1000;
const FIXED_LIST = 0x2000;
export const FIXED_TYPE = 0x4000;

export const FIXED_LIST_ASSUMPTION =
  "A part of a type whose starting flags have 0x4000 is never on the moving list: its list flags at 0x06 never have 0x1000. The game puts such a part on the fixed list, and no shipped level saves one with 0x1000.";
/**
 * The gun makes each bullet with the part factory and links it into the list of moving parts itself (`0x629d`, called
 * at `0x1b3b5` in Even More, English floppy), giving it `0x0010` at `0x06` but not `0x1000`, which only the routine at
 * `0x6469` sets. No shipped level saves a bullet. Decided with the user on 2026-11-06.
 */
export const BULLET_LIST_ASSUMPTION =
  "A jack-in-the-box never punches a bullet: a bullet never has 0x1000 in its list flags at 0x06, which the analysis calls being on the moving list. The gun doesn't give the bullets it makes that flag, and no shipped level saves a bullet.";
/**
 * The decided assumption that keeps a part off the moving list (its list flags at `0x06` never have `0x1000`), if
 * any: for a part of a fixed type, or the bullet.
 */
export function offMovingList(
  part: { id: string; type: number },
  startingFlags: { values: number[] } | undefined,
): string | undefined {
  if (startingFlags && (startingFlags.values[part.type]! & FIXED_TYPE) !== 0) return FIXED_LIST_ASSUMPTION;
  return part.id === "bullet" ? BULLET_LIST_ASSUMPTION : undefined;
}
const CENTRES_ASSUMPTION =
  "The two centres are less than 32768 apart across and down, so the word differences the centre angle takes are the true ones. When they are the same point there is no direction, and the setter puts the whole speed into velocityY.";
/**
 * Which way a velocity moves a part on the screen. The code shows that a velocity has the sign of the change of the
 * position it goes with (`0x7e08` to `0x7e2d` in Even More, English floppy), but not how a position maps to the
 * screen. The user saw it in the game on 2026-11-05: an unflipped jack-in-the-box, which sets both velocities
 * negative, knocks a part up and to the left.
 */
export const SCREEN_DIRECTION_ASSUMPTION =
  "On the screen, a negative velocityX at 0x36 moves a part to the left and a negative velocityY at 0x38 moves it up. In the game, a jack-in-the-box that isn't flipped, which sets both negative, knocks a part up and to the left.";
export const TYPE_TABLE_ASSUMPTION =
  "A type record keeps the words it has in the program while a level runs, so a word the code reads from it, like the mass at +0x02, is the one in TIM.EXE. Three words are left out: the game works out the acceleration at +0x08 and the speed limit at +0x0a for every type from the level's air pressure and gravity, and sets the frame list at +0x14 when it loads a part's pictures and clears it when it frees them.";
/**
 * The words of a type record the game writes while it runs: the acceleration and the speed limit, worked out from the
 * level's air pressure and gravity (`0x369c` in Even More, English floppy), and the frame list, set and cleared with a
 * part's pictures.
 */
export const TYPE_RECORD_WRITTEN = [0x08, 0x0a, 0x14];

/**
 * What single flag bits of a part mean, by field and bit, from the code that reads them (addresses in Even More, English
 * floppy; every build reads them the same way, and TIM 1 has none of the goal marks):
 *
 * - `0x0001` in the list flags at `0x06`: the contact search sets it after a contact (`0x073f`). The mover then moves the
 *   part 2 pixels more along its gravity each step (`0x38aa`), and after a bounce that doesn't return 0 the contact
 *   dispatch picks the response at `0x3980` instead of the reflection at `0x3c1c`.
 * - `0x2000` in the drawing flags: takes the part out of play. The contact dispatch leaves it out (its eligibility), the
 *   contact search passes over it (`0x058c`, `0x0663`) and the overlap searches leave it out (`0x41b9`, `0x430b`,
 *   `0x44c0`).
 * - `0x0040` in the drawing flags: the step's run loop (`0x0e89`) first clears it, with `0x0200` and `0x0400`, on the
 *   parts of the list at `0x4e1f` (`0x0e97`), and then calls the run callback only of parts without it (`0x0eab`,
 *   `0x0ee6`, `0x0f15`). Runs like the teeter-totter's set it on their own part, and the gear propagation sets it on
 *   each gear it moves (`0x1b26a`, `0x1b271`).
 * - `0x0080`, `0x0100`, `0x0200` and `0x0400` in field `0x0a`: goal marks. No part's code tests them; only the puzzle
 *   goal checks do, which the routine at `0x14ae` picks by the puzzle number at `0x4ac1` from the table at `0x201a`.
 *   Each goes through one part type on the moving list and ends the puzzle (the game mode `0x4a6d` becomes `0x0200`)
 *   when all of them have the mark: Mel Schlemming with `0x0080` (`0x24b3`), alligators with `0x0080` (`0x24f6`),
 *   tennis balls with `0x0100` (`0x29a3`), mice with `0x0100` (`0x2b50`) or `0x0200` (`0x259d`), cats with `0x0400`
 *   (`0x256e`), and one check wants `0x0400` on fish bowls (`0x28ae`). A search of the whole program for tests of these
 *   bits, in all eleven builds, finds no other.
 */
export const PART_FLAGS: { offset: number; mask: number; name: string; words: string }[] = [
  {
    offset: LIST_FLAGS,
    mask: 0x0001,
    name: "contact flag 0x0001",
    words:
      "the contact search sets it after a contact; while it is set the mover pulls the part 2 pixels further along its gravity each time it moves it, and the contact dispatch picks the response at 0x3980 over the reflection at 0x3c1c",
  },
  {
    offset: 0x08,
    mask: 0x2000,
    name: "out-of-play flag 0x2000",
    words: "the contact dispatch, the contact search and the overlap searches pass over a part with it",
  },
  {
    offset: 0x08,
    mask: 0x0040,
    name: "ran-this-step mark 0x0040",
    words: "the step's run loop clears it first and then calls no run callback of a part that has it",
  },
  ...[0x0080, 0x0100, 0x0200, 0x0400].map((mask) => ({
    offset: 0x0a,
    mask,
    name: `goal mark 0x${mask.toString(16).padStart(4, "0")}`,
    words:
      "no part's code reads it, only the puzzle goal checks, which end a puzzle when every part of one type has its mark",
  })),
];
/** Where a flag bit lives, in words: "list flags", "drawing flags" or "field 0x0a". */
const FLAG_FIELDS: Record<number, string> = { [LIST_FLAGS]: "list flags", 0x08: "drawing flags", 0x0a: "field 0x0a" };
/**
 * A set or cleared bit in words, like "sets its out-of-play flag 0x2000 in its drawing flags (the contact dispatch ...
 * pass over a part with it)", or undefined when the bit has no proved meaning.
 */
export function flagWords(offset: number, mask: number, set: boolean, whose: string, long = true): string | undefined {
  const flag = PART_FLAGS.find((f) => f.offset === offset && f.mask === mask);
  if (!flag) return undefined;
  return `${set ? "sets" : "clears"} ${whose} ${flag.name} in ${FLAG_FIELDS[offset]}${long ? ` (${flag.words})` : ""}`;
}
/**
 * The bits a value sets and clears in its own field, when it is the field with bits set by `or` and cleared by `and`,
 * like `(flags | 0x2000) & 0xfffe`; undefined for any other value.
 */
export function changedBits(
  value: Expression,
  field: { object: string; offset: number },
): { set: number; clear: number } | undefined {
  // The same part later in the routine, like "member found by the loop at 0x1a01a after field effect at 0x1a01a".
  if (
    value.kind === "field" &&
    (value.object === field.object || value.object.startsWith(`${field.object} after `)) &&
    value.offset === field.offset
  )
    return { set: 0, clear: 0 };
  if (value.kind !== "binary" || value.right.kind !== "constant") return undefined;
  const inner = changedBits(value.left, field);
  const mask = value.right.value & 0xffff;
  if (!inner) return undefined;
  if (value.operator === "|") return { set: inner.set | mask, clear: inner.clear & ~mask };
  if (value.operator === "&") return { set: inner.set & mask, clear: inner.clear | (~mask & 0xffff) };
  return undefined;
}
/**
 * The fine position: the longs at `0x16` (across) and `0x1a` (down) hold the position in 1/512 pixels. The mover adds the
 * velocity to them and sets positionX and positionY to them shifted right by 9 (`0x3896` to `0x38f5` in Even More,
 * English floppy; `0x2ccb` to `0x2d24` in TIM 1, French).
 */
export const FINE_POSITION: Record<number, string> = {
  0x16: "fine horizontal position (low word)",
  0x18: "fine horizontal position (high word)",
  0x1a: "fine vertical position (low word)",
  0x1c: "fine vertical position (high word)",
};
/**
 * The contact record a contact search fills in on the part it moves (`0x09eb` to `0x0a06`): the part it touched at
 * `0x84`, two side bytes at `0x86` and `0x87` (`0x0db5`, `0x0dcc`, and the helper at `0x04b0`), the angle at `0x88` and
 * the edge at `0x8a`. The contact flags `0x0002` and `0x0004` at `0x06` say which response route follows (`0x09af` to
 * `0x09e7`), and `0x0001` is set at `0x073f`.
 */
export const CONTACT_RECORD: Record<number, string> = {
  [LIST_FLAGS]: "contact flags in its list flags at 0x06",
  0x86: "contact side byte at 0x86",
  0x87: "contact side byte at 0x87",
};

/** Something another part sets on this part: its velocity to a speed, or a field to a number. */
export type OtherPartSetting =
  | {
      kind: "speed";
      /** The velocity fields, `0x36` and `0x38`. */
      fields: number[];
      /** The length of the new velocity, for this part's type. */
      speed: number;
      /** The routine that sets it. */
      setter: number;
      /**
       * When it points away from the source: from the source's centre to this part's, within `degrees`, as the centre
       * angle (`routine`) and the setter's tables give it.
       */
      away?: { routine: number; degrees: number };
    }
  | { kind: "field"; offset: number; width: number; value: number }
  /**
   * A field set from this part's own fields as they were when it touched the source, with `part` this part: like the
   * alligator's `0 - |velocityY|`. `words` says it, like "sets velocityY to -|velocityY|".
   */
  | { kind: "expression"; offset: number; width: number; value: Expression; words: string };

export interface OtherPartEffect extends Finding {
  sourceType: number;
  sourcePart: string;
  routine: number;
  /**
   * What the source part's own fields must be, with `part` the source: like the explosion going to frame 2. For a touch,
   * tests that compare the two parts are here too, with `collider` this part.
   */
  sourceCondition: Predicate;
  /** The tests of `sourceCondition` that have a name, in a few words, like "mirrored". */
  sourceConditionWords: string[];
  sets: OtherPartSetting[];
  /** What must hold for this part as well, with `part` this part: like being on the moving list. */
  condition: Predicate;
  /** `condition` in a few words, like "on the moving list". */
  conditionWords: string[];
  /** When it sets both velocities to numbers: where that moves the part on the screen, like "up and to the left". */
  velocityDirection?: string;
  /**
   * Set when this part touches the source: the contact dispatch calls the source's bounce with this part. `returns` is
   * what the bounce returns on these paths, which says whether the game goes on to a contact response, undefined when
   * it isn't a number.
   */
  touch?: { returns?: number };
  /**
   * When the same part does the same on paths whose tests can't be said as one: each path's tests, the way
   * `sourceCondition` and `condition` say them. The line holds when one of them holds; `sourceCondition`, `condition`
   * and their words then keep only the tests every case makes.
   */
  cases?: {
    sourceCondition: Predicate;
    sourceConditionWords: string[];
    condition: Predicate;
    conditionWords: string[];
    words: string;
  }[];
  description: string;
}

export type Evaluate = (
  condition: Predicate,
  fields: Pick<KnownField, "object" | "offset" | "width" | "value" | "knownMask">[],
) => boolean | undefined;

const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
const wrap = (value: number, width: number) => ((value % 2 ** width) + 2 ** width) % 2 ** width;
export const terms = (predicate: Predicate): Predicate[] =>
  predicate.kind === "and" ? predicate.terms.flatMap(terms) : predicate.kind === "true" ? [] : [predicate];
const conjunction = (list: Predicate[]): Predicate =>
  list.length === 0 ? { kind: "true" } : list.length === 1 ? list[0]! : { kind: "and", terms: list };

/** The objects whose fields an expression reads, and whether it holds something unknown. */
export function objects(
  value: Expression | Predicate,
  found = new Set<string>(),
): { objects: Set<string>; unknown: boolean } {
  let unknown = false;
  const visit = (v: Expression | Predicate) => {
    if (v.kind === "unknown") unknown = true;
    else if (v.kind === "field") {
      if (v.unresolved) unknown = true;
      found.add(v.object);
    } else if (v.kind === "binary" || v.kind === "compare") {
      visit(v.left);
      visit(v.right);
    } else if (v.kind === "table") visit(v.index);
    else if (v.kind === "and") v.terms.forEach(visit);
  };
  visit(value);
  return { objects: found, unknown };
}

/** A number for an expression of constants, at its width. */
function numberOf(e: Expression): number | undefined {
  if (e.kind === "constant") return wrap(e.value, e.width);
  if (e.kind !== "binary") return undefined;
  const a = numberOf(e.left),
    b = numberOf(e.right);
  if (a === undefined || b === undefined) return undefined;
  // A comparison gives 1 or 0, read unsigned at the width of what it compares, as the walks read it.
  if (["==", "!=", "<", "<=", ">", ">="].includes(e.operator)) {
    const [x, y] = [wrap(a, e.left.width), wrap(b, e.left.width)];
    const op = e.operator;
    return Number(
      op === "=="
        ? x === y
        : op === "!="
          ? x !== y
          : op === "<"
            ? x < y
            : op === "<="
              ? x <= y
              : op === ">"
                ? x > y
                : x >= y,
    );
  }
  // An arithmetic shift right keeps the sign of the word it shifts.
  if (e.operator === ">>") {
    const size = 2 ** e.left.width;
    const value = a >= size / 2 ? a - size : a;
    return wrap(Math.floor(value / 2 ** b), e.width);
  }
  const result =
    e.operator === "+"
      ? a + b
      : e.operator === "-"
        ? a - b
        : e.operator === "*"
          ? a * b
          : e.operator === "&"
            ? a & b
            : e.operator === "|"
              ? a | b
              : e.operator === "^"
                ? a ^ b
                : e.operator === "<<"
                  ? a * 2 ** b
                  : e.operator === ">>>"
                    ? Math.floor(a / 2 ** b)
                    : undefined;
  return result === undefined ? undefined : wrap(result, e.width);
}

/** Puts the member's type in, and reads the type table where its index is then known. */
function forType(
  e: Expression,
  member: string,
  typeOffset: number,
  type: number,
  table: BehaviourReport["typeTable"],
  used: { table: boolean },
): Expression {
  if (e.kind === "field" && e.object === member && e.offset === typeOffset && e.width === 16) return constant(type);
  if (e.kind === "binary") {
    const left = forType(e.left, member, typeOffset, type, table, used),
      right = forType(e.right, member, typeOffset, type, table, used);
    // Rebuilt with the analysis's own folding, so a test of two numbers the type settles is a number too.
    return left === e.left && right === e.right ? e : binary(e.operator, left, right, e.width, Infinity);
  }
  if (e.kind === "table") {
    const index = numberOf(forType(e.index, member, typeOffset, type, table, used));
    if (index === undefined || !table || e.width !== 16) return e;
    const at = e.segment * 16 + wrap(e.offset + index, 16) - table.address;
    const record = table.words[Math.floor(at / table.stride)];
    if (at < 0 || at % 2 || !record || at % table.stride >= table.stride - 1) return e;
    // The game writes this word while it runs (0x107dc and 0x1084c in Even More), so the program's word isn't it.
    if (TYPE_RECORD_WRITTEN.includes(at % table.stride)) return e;
    used.table = true;
    return constant(record[(at % table.stride) / 2]!);
  }
  return e;
}
/** The overlap an overlap search stored in a found part, like "overlapX the query at 0x1abc7 found for <member>". */
const OVERLAP = /^overlap([XY]) the query at 0x[0-9a-f]+ found for (.+)$/;
/** A value with the overlap its search stored in the member read as the member's own field, which holds it now. */
export function withOwnOverlaps(e: Expression, member: string): Expression {
  if (e.kind === "field" && e.unresolved && OVERLAP.exec(e.object)?.[2] === member)
    return { kind: "field", object: member, offset: e.offset, width: e.width };
  if (e.kind === "binary")
    return { ...e, left: withOwnOverlaps(e.left, member), right: withOwnOverlaps(e.right, member) };
  if (e.kind === "table") return { ...e, index: withOwnOverlaps(e.index, member) };
  return e;
}
/**
 * A value a source sets on a found part of the type, settled as far as the type allows: the overlap its search just
 * stored in the part reads as the part's own field, words of the type record the type settles are numbers, and a value
 * kept within the part's speed limit is the value inside, with `kept` set. The speed limit is a word of the type record
 * the game works out per level, so it stays a word, but it is the part's own.
 */
export function settleForType(
  value: Expression,
  member: string,
  typeOffset: number,
  type: number,
  table: BehaviourReport["typeTable"],
  used: { table: boolean },
): { value: Expression; kept: boolean } {
  const settled = forType(withOwnOverlaps(value, member), member, typeOffset, type, table, used);
  const kept = speedLimitOf(settled);
  const limit = kept?.limit;
  const ownLimit =
    !!table &&
    limit?.kind === "table" &&
    limit.segment * 16 + limit.offset === table.address + SPEED_LIMIT &&
    JSON.stringify(limit.index).includes(`"object":${JSON.stringify(member)},"offset":${typeOffset}`);
  return ownLimit && kept ? { value: kept.speed, kept: true } : { value: settled, kept: false };
}
/** The speed limit's word in a type record, which the game works out for every type from the level's air and gravity. */
const SPEED_LIMIT = 0x0a;

/**
 * A value as the words say it, the same number written plainly: a word sign extended to 32 bits is the word, a 32-bit
 * number past 2^31 is negative, `(c × x) >> k` with c a multiple of 2^k is `(c / 2^k) × x`, the low word of a quotient
 * is the quotient (a push's quotient fits a word), and a signed division reads ÷.
 */
export function tidyArithmetic(e: Expression): Expression {
  if (e.kind === "constant" && e.width === 32 && e.value >= 2 ** 31)
    return { kind: "binary", operator: "-", left: constant(0, 32), right: constant(2 ** 32 - e.value, 32), width: 32 };
  if (e.kind !== "binary") return e;
  const left = tidyArithmetic(e.left),
    right = tidyArithmetic(e.right);
  const number = (x: Expression) => (x.kind === "constant" ? x.value : undefined);
  // (x ^ 0x8000) - 0x8000: the word x, sign extended.
  if (
    e.operator === "-" &&
    number(e.right) === 0x8000 &&
    e.left.kind === "binary" &&
    e.left.operator === "^" &&
    number(e.left.right) === 0x8000
  )
    return tidyArithmetic(e.left.left);
  if (e.operator === ">>" && e.left.kind === "binary" && e.left.operator === "*" && number(e.right) !== undefined) {
    const k = number(e.right)!;
    const c = number(e.left.left);
    // The number is signed: the arithmetic shift keeps its sign.
    const signedC = c !== undefined && c >= 2 ** (e.left.left.width - 1) ? c - 2 ** e.left.left.width : c;
    if (signedC !== undefined && signedC % 2 ** k === 0) {
      const scaled = signedC / 2 ** k;
      const width = e.left.left.width;
      return tidyArithmetic({ ...e.left, left: constant(scaled < 0 ? 2 ** width + scaled : scaled, width) });
    }
  }
  if (e.operator === "&" && number(e.right) === 0xffff && e.left.kind === "binary" && e.left.operator === "s/")
    return tidyArithmetic(e.left);
  if (e.operator === "s/") return { ...e, operator: "÷", left, right };
  return left === e.left && right === e.right ? e : { ...e, left, right };
}

export function predicateForType(
  p: Predicate,
  ...rest: [string, number, number, BehaviourReport["typeTable"], { table: boolean }]
): Predicate {
  if (p.kind === "compare") return { ...p, left: forType(p.left, ...rest), right: forType(p.right, ...rest) };
  if (p.kind === "and") return { ...p, terms: p.terms.map((t) => predicateForType(t, ...rest)) };
  return p;
}

/** A test of one named drawing flag of the source, like `(part + 0x08 & 0x10) != 0`, in words. */
function drawingFlagWords(p: Predicate, report: BehaviourReport): string | undefined {
  if (p.kind !== "compare" || !["==", "!="].includes(p.operator)) return undefined;
  const { left, right } = p;
  if (right.kind !== "constant" || right.value !== 0 || left.kind !== "binary" || left.operator !== "&") return;
  const [flags, mask] = left.left.kind === "field" ? [left.left, left.right] : [left.right, left.left];
  if (flags.kind !== "field" || flags.object !== "part" || mask.kind !== "constant") return undefined;
  const field = report.layout.fields.find((f) => f.offset === flags.offset && f.name === "drawingFlags");
  const name = field?.masks?.find((m) => m.value === mask.value)?.name;
  const words = name === "horizontalFlip" ? "mirrored" : name === "verticalFlip" ? "upside down" : undefined;
  return words && `${p.operator === "!=" ? "" : "not "}${words}`;
}

/** A test of one list flag of the member, like `(member + 0x06 & 0x1000) != 0`, in words. */
export function listFlagWords(p: Predicate, member: string): string | undefined {
  if (p.kind !== "compare" || !["==", "!="].includes(p.operator)) return undefined;
  const { left, right } = p;
  if (right.kind !== "constant" || right.value !== 0 || left.kind !== "binary" || left.operator !== "&") return;
  const [flags, mask] = left.left.kind === "field" ? [left.left, left.right] : [left.right, left.left];
  if (flags.kind !== "field" || flags.object !== member || flags.offset !== LIST_FLAGS || mask.kind !== "constant")
    return undefined;
  const list = mask.value === MOVING_LIST ? "moving" : mask.value === FIXED_LIST ? "fixed" : undefined;
  return list && `${p.operator === "!=" ? "" : "not "}on the ${list} list`;
}

export function rename(e: Expression, from: string, to: string): Expression {
  if (e.kind === "field" && e.object === from) return { ...e, object: to };
  if (e.kind === "binary") return { ...e, left: rename(e.left, from, to), right: rename(e.right, from, to) };
  if (e.kind === "table") return { ...e, index: rename(e.index, from, to) };
  return e;
}
export const renamePredicate = (p: Predicate, from: string, to: string): Predicate =>
  p.kind === "compare"
    ? { ...p, left: rename(p.left, from, to), right: rename(p.right, from, to) }
    : p.kind === "and"
      ? { ...p, terms: p.terms.map((t) => renamePredicate(t, from, to)) }
      : p;

/** The part fields an expression reads, as offsets. */
export function partFields(value: Expression | Predicate, found: Set<number>) {
  if (value.kind === "field" && value.object === "part") found.add(value.offset);
  else if (value.kind === "binary" || value.kind === "compare") {
    partFields(value.left, found);
    partFields(value.right, found);
  } else if (value.kind === "table") partFields(value.index, found);
  else if (value.kind === "and") value.terms.forEach((t) => partFields(t, found));
}

const uniqueEvidence = (list: Evidence[]) => [...new Map(list.map((e) => [e.address, e])).values()];
/**
 * Ids are never renamed once published, so a part whose id doesn't say what it is in TIM 1 and Even More gets its
 * words here: part 43 has the id "pinball", but in these games it is the cannonball the cannon fires.
 */
const WORDS: Record<string, string> = {
  pinball: "cannonball",
  // Names the game writes with hyphens or as a name keep them; other ids are words split by spaces.
  "teeter-totter": "teeter-totter",
  "jack-in-the-box": "jack-in-the-box",
  "jack-o-lantern": "jack-o-lantern",
  "mel-schlemming": "Mel Schlemming",
  "mels-house": "Mel's house",
};
/** A part id in words, for the behaviour descriptions of TIM 1 and Even More. */
export const nameOf = (id: string) => WORDS[id] ?? id.replace(/-/g, " ");
const article = (name: string) => (/^[aeiou]/.test(name) ? "An" : "A");
/** A part's name with "a" or "an" before it, or alone when it is a name, like Mel Schlemming. */
export const named = (name: string, capital = false): string =>
  /^[A-Z]/.test(name) ? name : `${capital ? article(name) : article(name).toLowerCase()} ${name}`;

interface Candidate {
  sourceWords: string[];
  sourceType: number;
  sourcePart: string;
  routine: number;
  member: string;
  outcome: Finding & { condition: Predicate; fields: FieldWrite[] };
  writes: FieldWrite[];
  sourceTerms: Predicate[];
  memberTerms: Predicate[];
  /**
   * Whether the source names the part's type, or else the flag tests of the search that found it, when they are all
   * known. Only then may a line keep tests of the part's own fields that its type doesn't decide: a search may keep
   * only parts with a flag the outcome doesn't show, like the candle's, which keeps lightable parts.
   */
  named: boolean;
  search?: SearchTest[];
}

/** The part that touched the source, as the bounce callback gets it; `part` is the source, the part it touched. */
const TOUCHER = "collider";
export const TOUCH_ASSUMPTION =
  "The part touches the source, which is another part, and the fields of both meet the tests when the contact dispatch calls the source's bounce; that this happens in a level is not claimed.";

/** Whether a value reads a table, which a line can't look up. */
function readsTable(value: Expression | Predicate): boolean {
  if (value.kind === "table") return true;
  if (value.kind === "binary" || value.kind === "compare") return readsTable(value.left) || readsTable(value.right);
  if (value.kind === "and") return value.terms.some(readsTable);
  return false;
}

/**
 * A query's answer, like the bounce pool's at `0x867c` (Even More, English floppy) that the teeter-totter asks whether a
 * landing is new: one value of that call, which the analysis names but doesn't know.
 */
const ANSWER = /^answer of the query at (0x[0-9a-f]+)$/;
export const ANSWER_ASSUMPTION =
  "A query's answer is one value of that call: the line holds when the answer passes the test, whatever it depends on.";
/** Whether a test reads a query's answer, and nothing else the analysis doesn't know. */
export function readsAnswer(term: Predicate): boolean {
  let answer = false,
    other = false;
  const visit = (v: Expression | Predicate) => {
    if (v.kind === "unknown") other = true;
    else if (v.kind === "field") {
      if (ANSWER.test(v.object) && v.unresolved) answer = true;
      else if (v.unresolved) other = true;
    } else if (v.kind === "binary" || v.kind === "compare") {
      visit(v.left);
      visit(v.right);
    } else if (v.kind === "table") visit(v.index);
    else if (v.kind === "and") v.terms.forEach(visit);
  };
  visit(term);
  return answer && !other;
}
/**
 * Whether an outcome's only unknown is a query's answer in its tests: its effects are complete and every value it writes
 * is known, so it is unresolved only because the answer is.
 */
export function onlyAnswersOpen(outcome: { effectsComplete?: boolean; condition: Predicate; fields: FieldWrite[] }) {
  return (
    !!outcome.effectsComplete &&
    terms(outcome.condition).some(readsAnswer) &&
    terms(outcome.condition).every((t) => readsAnswer(t) || !objects(t).unknown) &&
    outcome.fields.every((f) => !objects(f.value).unknown)
  );
}

/** A path of a bounce callback that sets fields of the part that touched it. */
interface TouchCandidate {
  sourceType: number;
  sourcePart: string;
  routine: number;
  outcome: RoutineOutcome;
  writes: FieldWrite[];
  /** The tests of the touching part (and of numbers alone), of the touched part, and those that compare the two. */
  toucherTerms: Predicate[];
  sourceTerms: Predicate[];
  bothTerms: Predicate[];
  /** What the bounce returns on the path, when it is a number. */
  returns?: number;
}

/**
 * A bounce path that can give a touch line: its effects are complete, it writes the touching part, and nothing but the
 * two parts, and each value it writes there is a number, a speed the speed setter got, or worked out from the touching
 * part's own fields alone.
 */
function touchCandidate(
  source: { id: string; type: number },
  routine: number,
  outcome: RoutineOutcome,
): TouchCandidate | undefined {
  if (!outcome.effectsComplete || (outcome.confidence === "unresolved" && !onlyAnswersOpen(outcome))) return undefined;
  const writes = outcome.fields.filter((f) => f.object === TOUCHER);
  // What the bounce does to the touched part itself is that part's own business.
  if (!writes.length || outcome.fields.some((f) => f.object !== TOUCHER && f.object !== "part")) return undefined;
  const own = (value: Expression) => {
    const read = objects(value);
    return !read.unknown && [...read.objects].every((o) => o === TOUCHER) && !readsTable(value);
  };
  if (writes.some((w) => !w.directedSpeed && !own(w.value))) return undefined;
  const toucherTerms: Predicate[] = [],
    sourceTerms: Predicate[] = [],
    bothTerms: Predicate[] = [];
  for (const term of terms(outcome.condition)) {
    const { objects: read, unknown } = objects(term);
    if (term.kind !== "compare") return undefined;
    // A query's answer is the touched part's business: its bounce asked the query.
    if (readsAnswer(term)) {
      if ([...read].every((o) => o === "part" || ANSWER.test(o))) sourceTerms.push(term);
      else return undefined;
      continue;
    }
    if (unknown) return undefined;
    if ([...read].every((o) => o === TOUCHER)) toucherTerms.push(term);
    else if ([...read].every((o) => o === "part")) sourceTerms.push(term);
    else if ([...read].every((o) => o === "part" || o === TOUCHER)) bothTerms.push(term);
    else return undefined;
  }
  return {
    sourceType: source.type,
    sourcePart: source.id,
    routine,
    outcome,
    writes,
    toucherTerms,
    sourceTerms,
    bothTerms,
    ...(outcome.returnValue.kind === "constant" ? { returns: outcome.returnValue.value } : {}),
  };
}

/**
 * By part type: the lines for what other parts do to it without changing its frame, and the decided assumptions that
 * ruled out others. `evaluate` tests a condition against known fields, as the walks do.
 */
export function effectsFromOthers(
  report: BehaviourReport,
  evaluate: Evaluate,
): Map<number, { effects: OtherPartEffect[]; assumptions: string[] }> {
  const result = new Map<number, { effects: OtherPartEffect[]; assumptions: string[] }>();
  const typeOffset = report.layout.fields.find((f) => f.name === "type")?.offset;
  const stateOffset = report.layout.fields.find((f) => f.name === "state")?.offset;
  if (typeOffset === undefined || stateOffset === undefined) return result;
  const routines = new Map(report.routines.map((r) => [r.address, r]));
  const fieldNames = new Map(report.layout.fields.map((f) => [f.offset, f.name]));
  // The words an overlap search stores in the parts it finds, named by the axis its code measures them on.
  for (const h of report.helpers ?? [])
    for (const o of h.list?.overlaps ?? []) if (!fieldNames.has(o.offset)) fieldNames.set(o.offset, `overlap${o.axis}`);
  const startingFlags = report.helpers
    ?.find((h) => h.kind === "part-factory")
    ?.factory?.startingWords?.find((w) => w.field === LIST_FLAGS);

  const factory = report.helpers?.find((h) => h.kind === "part-factory")?.factory;
  /** Whether a new part of the type gets the bits: from the factory's table, or from its constructor's first run. */
  const gives = (type: number, t: SearchTest) =>
    ((factory?.startingWords?.find((w) => w.field === t.offset)?.values[type] ?? 0) & t.mask) === t.mask ||
    !!factory?.constructorFlags?.some((f) => f.type === type && f.field === t.offset && (f.mask & t.mask) === t.mask);
  const fieldName = (offset: number) => fieldNames.get(offset) ?? `field 0x${offset.toString(16).padStart(2, "0")}`;
  /** A value of the part's own fields in words, like "subtracts 1 from velocityX" or "halves velocityX, rounding down". */
  const settingWords = (offset: number, raw: Expression) => {
    const field = fieldName(offset);
    const value = tidyArithmetic(raw);
    const own = (e: Expression) => e.kind === "field" && e.object === "part" && e.offset === offset && e.width === 16;
    // A value added to the field's own, like a push.
    if (value.kind === "binary" && value.operator === "+" && own(value.left) && value.right.kind !== "constant")
      return `adds ${formula(value.right, { field: fieldName, of: (_, what) => what })} to ${field}`;
    const signedWord = (n: number) => (n >= 0x8000 ? n - 0x10000 : n);
    if (value.kind === "binary" && own(value.left) && value.right.kind === "constant") {
      const n = value.right.value;
      const hex = `0x${n.toString(16).padStart(4, "0")}`;
      if (value.operator === "+" || value.operator === "-") {
        const amount = value.operator === "+" ? signedWord(n) : -signedWord(n);
        return amount >= 0 ? `adds ${amount} to ${field}` : `subtracts ${-amount} from ${field}`;
      }
      // An arithmetic shift right halves a signed word and rounds down.
      if (value.operator === ">>" && n === 1) return `halves ${field} (rounding down)`;
      // Single bits whose meaning the code proves say it, like the contact flag 0x0001 at 0x06.
      const bits = value.operator === "&" ? ~n & 0xffff : value.operator === "|" ? n : 0;
      const named =
        bits && (bits & (bits - 1)) === 0 ? flagWords(offset, bits, value.operator === "|", "its", false) : undefined;
      if (named) return named;
      if (value.operator === "&") return `clears ${`0x${(~n & 0xffff).toString(16).padStart(4, "0")}`} in ${field}`;
      if (value.operator === "|") return `sets ${hex} in ${field}`;
      if (value.operator === "^") return `turns ${hex} in ${field} round`;
    }
    if (value.kind === "binary" && value.operator === "-" && value.left.kind === "constant" && value.left.value === 0) {
      if (own(value.right)) return `reverses ${field}`;
    }
    const plain: Names = { field: fieldName, of: (_, what) => what };
    const long = longPart(value);
    if (long)
      return `sets ${field} to the ${long.high ? "high" : "low"} word of ${formula(long.word, plain)} × ${2 ** long.shift}`;
    return `sets ${field} to ${formula(value, plain)}`;
  };
  /**
   * What the writes set on a part of the type: numbers, speeds and values of its own fields. Undefined when a speed
   * isn't a number for it.
   */
  const settingsOf = (writes: FieldWrite[], member: string, type: number, used: { table: boolean }) => {
    const sets: OtherPartSetting[] = [];
    /** The speeds whose every write points along the line from the source's centre to this part's. */
    const lines = new Map<OtherPartSetting, { routine: number; call: number } | undefined>();
    for (const w of writes) {
      // A number, or a value the part's type settles, like a speed read from its type record.
      // A number, a value of the part's own fields, or either one kept within the part's speed limit.
      const settled = w.directedSpeed
        ? undefined
        : settleForType(w.value, member, typeOffset, type, report.typeTable, used);
      const number = settled && numberOf(settled.value);
      if (settled && number !== undefined && !settled.kept) {
        sets.push({ kind: "field", offset: w.offset, width: w.width, value: number });
        continue;
      }
      if (settled) {
        // Only a value of the part's own fields says something a line can repeat.
        const read = objects(settled.value);
        if (read.unknown || readsTable(settled.value) || [...read.objects].some((o) => o !== member)) return undefined;
        // A value worked out from the part's own fields, as a touch can set: like halving its velocityX.
        const value = rename(settled.value, member, "part");
        const unchanged = value.kind === "field" && value.object === "part" && value.offset === w.offset;
        sets.push({
          kind: "expression",
          offset: w.offset,
          width: w.width,
          value,
          words: settled.kept
            ? unchanged
              ? `keeps ${fieldName(w.offset)} within its speed limit`
              : `${settingWords(w.offset, value)}, kept within its speed limit`
            : settingWords(w.offset, value),
        });
        continue;
      }
      if (!w.directedSpeed) continue;
      const speed = numberOf(forType(w.directedSpeed.speed, member, typeOffset, type, report.typeTable, used));
      if (speed === undefined) return undefined;
      const prior = sets.find(
        (s): s is Extract<OtherPartSetting, { kind: "speed" }> =>
          s.kind === "speed" && s.setter === w.directedSpeed!.routine && s.speed === speed,
      );
      const direction = w.directedSpeed.direction;
      const away =
        direction?.from === "part" && direction.to === member
          ? { routine: direction.routine, call: direction.call }
          : undefined;
      if (prior) {
        prior.fields = [...prior.fields, w.offset].sort((a, b) => a - b);
        const line = lines.get(prior);
        if (line?.routine !== away?.routine || line?.call !== away?.call) lines.set(prior, undefined);
      } else {
        const set: OtherPartSetting = { kind: "speed", fields: [w.offset], speed, setter: w.directedSpeed.routine };
        sets.push(set);
        lines.set(set, away);
      }
    }
    const proofs: string[] = [];
    for (const [set, line] of lines) {
      if (set.kind !== "speed" || !line) continue;
      const centre = report.helpers?.find((h) => h.address === line.routine)?.centreAngle;
      const velocity = report.helpers?.find((h) => h.address === set.setter)?.directedVelocity;
      // The direction is of the whole velocity: both its fields must be this speed from that one answer.
      if (velocity && velocity.stores.some((store) => !set.fields.includes(store.field))) continue;
      const degrees = centre && velocity && directionError(centre.backend, velocity, set.speed);
      if (degrees === undefined) continue;
      // Rounded up, so the bound still holds.
      set.away = { routine: line.routine, degrees: Math.ceil(degrees * 100) / 100 };
      proofs.push(...centre!.assumptions, CENTRES_ASSUMPTION);
    }
    return { sets, proofs };
  };
  /** The settings in words, with the source's name; both velocities set to numbers read as a direction on the screen. */
  const sayings = (sets: OtherPartSetting[], name: string) => {
    // Both velocities set to numbers read as one direction on the screen, with the numbers after it.
    const velocity = (name: string) =>
      sets.find(
        (s): s is Extract<OtherPartSetting, { kind: "field" }> =>
          s.kind === "field" && s.width === 16 && fieldNames.get(s.offset) === name,
      );
    const [across, down] = [velocity("velocityX"), velocity("velocityY")];
    const signedWord = (value: number) => (value >= 0x8000 ? value - 0x10000 : value);
    const vx = across && signedWord(across.value),
      vy = down && signedWord(down.value);
    const velocityDirection =
      vx !== undefined && vy !== undefined
        ? [vy < 0 ? "up" : vy > 0 ? "down" : "", vx < 0 ? "to the left" : vx > 0 ? "to the right" : ""]
            .filter((w) => w)
            .join(" and ") || undefined
        : undefined;
    // The two words of a long set from one value read as one: like the trampoline's 32-bit position at 0x1a.
    const longs = new Map<OtherPartSetting, string>();
    for (const low of sets) {
      const part = low.kind === "expression" ? longPart(low.value) : undefined;
      const high = sets.find(
        (s) =>
          s.kind === "expression" &&
          low.kind === "expression" &&
          s.offset === low.offset + 2 &&
          JSON.stringify(longPart(s.value)) === JSON.stringify(part && { ...part, high: true }),
      );
      if (!part || part.high || !high || low.kind !== "expression") continue;
      const fine = FINE_POSITION[low.offset] ? (low.offset < 0x1a ? "horizontal" : "vertical") : undefined;
      longs.set(
        low,
        `sets ${fine ? `its fine ${fine} position (the long at 0x${low.offset.toString(16)}, in 1/512 pixels)` : `the long at 0x${low.offset.toString(16).padStart(2, "0")}`} to ${formula(part.word, { field: fieldName, of: (_, what) => what })} × ${2 ** part.shift}`,
      );
      longs.set(high, "");
    }
    const said = sets.flatMap((s) => {
      if (longs.has(s)) return longs.get(s) ? [longs.get(s)!] : [];
      if (velocityDirection && (s === across || s === down))
        return s === across ? [`sets its velocity ${velocityDirection} (velocityX ${vx}, velocityY ${vy})`] : [];
      if (s.kind === "expression") return [s.words];
      if (s.kind === "speed")
        return [
          s.away
            ? `sets its speed to ${s.speed}, away from the ${name}`
            : `sets its speed to ${s.speed}, in a direction the ${name} works out`,
        ];
      const field = fieldNames.get(s.offset);
      // A velocity is a signed word.
      const value = field?.startsWith("velocity") && s.value >= 0x8000 ? s.value - 0x10000 : s.value;
      return [`sets ${field ?? `+0x${s.offset.toString(16)}`} to ${value}`];
    });
    return { said, velocityDirection };
  };
  /** Types whose bounce the game also calls on a part of that type itself, with what it touched (Mel in Even More). */
  const selfCalled = new Set((report.collisionDispatch ?? []).flatMap((d) => d.specialSelfCall?.type ?? []));
  /**
   * The touch lines of a part: what the bounce of a part it touches sets on it. Paths that set the same, and return
   * the same, are joined where their tests allow it. `read` are the fields the part's own rules read.
   */
  const touchLines = (part: BehaviourReport["parts"][number], read: Set<number>, assumptions: Set<string>) => {
    const readsField = (w: FieldWrite) => [...Array(w.width / 8).keys()].some((byte) => read.has(w.offset + byte));
    // The contact dispatch walks the moving list: a part of a fixed type is never on it, by a decided assumption.
    const fixed = !!startingFlags && (startingFlags.values[part.type]! & FIXED_TYPE) !== 0;
    interface Path {
      c: TouchCandidate;
      sets: OtherPartSetting[];
      raw: Predicate[];
      confidence: Confidence;
      assumptions: Set<string>;
      evidence: Evidence[];
    }
    const groups = new Map<string, { tests: Tests; value: Path }[]>();
    for (const c of touches) {
      // The bounce of such a type may run with a part of the type as the toucher and anything as `part`.
      if (selfCalled.has(c.sourceType) && part.type === c.sourceType) continue;
      const used = { table: false };
      const kept: Predicate[] = [];
      let possible = true;
      for (const term of [...c.toucherTerms, ...c.bothTerms, ...c.sourceTerms]) {
        const typed = predicateForType(term, TOUCHER, typeOffset, part.type, report.typeTable, used);
        const value = evaluate(typed, []);
        if (value === true) continue;
        if (value === false || readsTable(typed)) {
          possible = false;
          break;
        }
        kept.push(typed);
      }
      // A write to a field the part's rules read can change its frame: walks are the place for that.
      if (!possible || c.writes.some(readsField)) continue;
      const settings = settingsOf(c.writes, TOUCHER, part.type, used);
      if (!settings) continue;
      if (fixed) {
        assumptions.add(FIXED_LIST_ASSUMPTION);
        continue;
      }
      const tests = testsOf(kept);
      if (!tests || impossible(tests)) continue;
      const key = JSON.stringify([c.routine, settings.sets, c.returns ?? null]);
      const group = groups.get(key) ?? [];
      groups.set(key, group);
      group.push({
        tests,
        value: {
          c,
          sets: settings.sets,
          raw: kept,
          // Unresolved only because of a query's answer, which the line keeps as a test.
          confidence: c.outcome.confidence === "unresolved" ? "inferred" : c.outcome.confidence,
          assumptions: new Set([
            ...c.outcome.assumptions,
            ...c.writes.flatMap((w) => w.assumptions),
            ...(used.table ? [TYPE_TABLE_ASSUMPTION] : []),
            ...(c.sourceTerms.some(readsAnswer) ? [ANSWER_ASSUMPTION] : []),
            ...settings.proofs,
          ]),
          evidence: uniqueEvidence([...c.outcome.evidence, ...c.writes.flatMap((w) => w.evidence)]),
        },
      });
    }
    const lines: OtherPartEffect[] = [];
    const rank: Record<Confidence, number> = { checked: 0, inferred: 1, unresolved: 2 };
    for (const group of groups.values()) {
      const start = lines.length;
      for (const { tests, value, joined } of joinPaths(group, (into, from) => {
        for (const a of from.assumptions) into.assumptions.add(a);
        into.evidence = uniqueEvidence([...into.evidence, ...from.evidence]);
        if (rank[from.confidence] > rank[into.confidence]) into.confidence = from.confidence;
      })) {
        const { c, sets } = value;
        const name = nameOf(c.sourcePart);
        // Each test with its comparisons and words; a path's own tests when they can't be said in short.
        const list =
          testsInWords(tests) ??
          (joined
            ? undefined
            : value.raw.map((p) => ({
                predicates: [p],
                objects: objects(p).objects,
                words: (names: Names) => compareWords(p as Extract<Predicate, { kind: "compare" }>, names),
              })));
        if (!list) continue;
        const names = (whose: (object: string) => string): Names => ({
          field: fieldName,
          of: (object, what) => `${whose(object)}${what}`,
        });
        const both = names((object) => (object === TOUCHER ? "its " : `the ${name}'s `));
        const toucher: Predicate[] = [],
          source: Predicate[] = [],
          toucherWords: string[] = [],
          sourceWords: string[] = [],
          sourcePhrases: string[] = [];
        for (const test of list) {
          const flag = test.predicates.length === 1 ? test.predicates[0]! : undefined;
          // A query's answer belongs to the touched part, whose bounce asked the query.
          const read = [...test.objects].map((o) => (ANSWER.test(o) ? "part" : o));
          if (read.every((o) => o === TOUCHER)) {
            const own = test.predicates.map((p) => renamePredicate(p, TOUCHER, "part"));
            toucher.push(...own);
            const drawn = own.length === 1 ? drawingFlagWords(own[0]!, report) : undefined;
            toucherWords.push(drawn ? `it is ${drawn}` : test.words(both));
          } else if (read.every((o) => o === "part")) {
            source.push(...test.predicates);
            const drawn = flag && drawingFlagWords(flag, report);
            sourceWords.push(drawn || test.words(names(() => "")));
            sourcePhrases.push(drawn ? `the ${name} is ${drawn}` : test.words(both));
          } else {
            source.push(...test.predicates);
            toucherWords.push(test.words(both));
          }
        }
        const { said, velocityDirection } = sayings(sets, name);
        const when = sourcePhrases.length ? `, when ${sourcePhrases.join(" and ")},` : "";
        const only = toucherWords.length ? ` Only when ${toucherWords.join(" and ")}.` : "";
        // The dispatch goes on to a contact response only when the bounce returns something other than 0.
        const response =
          c.returns === undefined
            ? " The game may go on to a contact response, which can change these again."
            : c.returns === 0
              ? " Its bounce returns 0 then, so no contact response follows."
              : ` Its bounce returns ${c.returns} then, so the game may go on to a contact response, which can change these again.`;
        lines.push({
          sourceType: c.sourceType,
          sourcePart: c.sourcePart,
          routine: c.routine,
          sourceCondition: conjunction(source),
          sourceConditionWords: sourceWords,
          sets,
          condition: conjunction(toucher),
          conditionWords: toucherWords,
          ...(velocityDirection ? { velocityDirection } : {}),
          touch: c.returns === undefined ? {} : { returns: c.returns },
          description: `${named(name, true)} it touches${when} ${said.join(" and ")}.${only}${response}`,
          confidence: value.confidence,
          assumptions: [
            ...new Set([
              ...value.assumptions,
              ...(velocityDirection ? [SCREEN_DIRECTION_ASSUMPTION] : []),
              TOUCH_ASSUMPTION,
            ]),
          ],
          evidence: value.evidence,
          caseWords: [sourcePhrases.join(" and "), toucherWords.join(" and ")].filter(Boolean).join(", and "),
        } as OtherPartEffect & { caseWords: string });
      }
      // Lines of one group set the same and differ only in their tests: they are one line with each path as a case.
      const made = lines.splice(start) as (OtherPartEffect & { caseWords: string })[];
      if (made.length === 1) lines.push(withoutCaseWords(made[0]!));
      else if (made.length > 1) lines.push(casesLine(made));
    }
    return lines;
  };
  const withoutCaseWords = (line: OtherPartEffect & { caseWords?: string }): OtherPartEffect => {
    const copy = { ...line };
    delete copy.caseWords;
    return copy;
  };
  /** One line for lines that set the same: the tests every case makes stay on the line, the rest go to `cases`. */
  const casesLine = (made: (OtherPartEffect & { caseWords: string })[]): OtherPartEffect => {
    const first = made[0]!;
    const common = (list: (line: OtherPartEffect) => Predicate[]) =>
      list(first).filter((term) =>
        made.every((line) => list(line).some((t) => JSON.stringify(t) === JSON.stringify(term))),
      );
    const commonWords = (list: (line: OtherPartEffect) => string[]) =>
      list(first).filter((word) => made.every((line) => list(line).includes(word)));
    const name = nameOf(first.sourcePart);
    const { said } = sayings(first.sets, name);
    const tail = / (Its bounce returns|The game may go on).*$/.exec(first.description)?.[0] ?? "";
    const rank: Record<Confidence, number> = { checked: 0, inferred: 1, unresolved: 2 };
    return {
      ...withoutCaseWords(first),
      sourceCondition: conjunction(common((line) => terms(line.sourceCondition))),
      sourceConditionWords: commonWords((line) => line.sourceConditionWords),
      condition: conjunction(common((line) => terms(line.condition))),
      conditionWords: commonWords((line) => line.conditionWords),
      cases: made.map((item) => ({
        sourceCondition: item.sourceCondition,
        sourceConditionWords: item.sourceConditionWords,
        condition: item.condition,
        conditionWords: item.conditionWords,
        words: item.caseWords,
      })),
      description: `${named(name, true)} it touches ${said.join(" and ")} in ${made.length} cases: ${made
        .map((item, n) => `(${n + 1}) when ${item.caseWords}`)
        .join("; ")}.${tail}`,
      confidence: made.map((item) => item.confidence).reduce((a, b) => (rank[b] > rank[a] ? b : a)),
      assumptions: [...new Set(made.flatMap((item) => item.assumptions))],
      evidence: uniqueEvidence(made.flatMap((item) => item.evidence)),
    };
  };
  const candidates: Candidate[] = [];
  const touches: TouchCandidate[] = [];
  for (const source of report.parts)
    for (const callback of source.routines) {
      if (callback.sharedDefault) continue;
      for (const outcome of routines.get(callback.address)?.iterationOutcomes ?? []) {
        // What a list consumer does to a member tests where it lies from the source, which a line can't say yet: it
        // comes as a walk (`describe-hits.ts`).
        if (!outcome.effectsComplete || outcome.confidence === "unresolved" || outcome.listConsumer) continue;
        const member = outcome.object;
        const writes = outcome.fields.filter((f) => f.object === member);
        if (!writes.length || writes.length !== outcome.fields.length) continue;
        // Every field set needs a number for the part's type, a formula of its own fields, or the speed the speed setter
        // was given: so a value may read only the member and the type table.
        if (
          writes.some((w) => {
            const read = objects(withOwnOverlaps(w.value, member));
            return !w.directedSpeed && (read.unknown || [...read.objects].some((o) => o !== member));
          })
        )
          continue;
        const sourceTerms: Predicate[] = [],
          memberTerms: Predicate[] = [];
        let open = false;
        for (const term of terms(outcome.condition)) {
          const { objects: read, unknown } = objects(term);
          if (unknown || term.kind === "unknown") open = true;
          else if ([...read].every((o) => o === "part")) sourceTerms.push(term);
          else if ([...read].every((o) => o === member)) memberTerms.push(term);
          else open = true;
        }
        if (open) continue;
        const named = memberTerms.some(
          (t) =>
            t.kind === "compare" &&
            t.operator === "==" &&
            t.left.kind === "field" &&
            t.left.object === member &&
            t.left.offset === typeOffset &&
            t.right.kind === "constant",
        );
        const search = named ? undefined : searchTests(report, callback.address, outcome.header);
        candidates.push({
          named,
          ...(search ? { search } : {}),
          sourceWords: sourceTerms.flatMap((t) => drawingFlagWords(t, report) ?? []),
          sourceType: source.type,
          sourcePart: source.id,
          routine: callback.address,
          member,
          outcome,
          writes,
          sourceTerms,
          memberTerms,
        });
      }
      // The contact dispatch calls the bounce of the touched part's type with the part that touched it (`collider`).
      if (callback.slot === 0)
        for (const outcome of routines.get(callback.address)?.outcomes ?? []) {
          const touch = touchCandidate(source, callback.address, outcome);
          if (touch) touches.push(touch);
        }
    }

  for (const part of report.parts) {
    const effects = new Map<string, OtherPartEffect>();
    const assumptions = new Set<string>();
    // A part of a fixed type, or the bullet, is never on the moving list: a decided assumption says so.
    const offList = offMovingList(part, startingFlags);
    const known = offList
      ? (member: string) => [
          { object: member, offset: LIST_FLAGS, width: 16, value: 0, knownMask: MOVING_LIST } satisfies Pick<
            KnownField,
            "object" | "offset" | "width" | "value" | "knownMask"
          >,
        ]
      : () => [];
    // The fields the part's own rules read: setting one of them can change its frame.
    const read = new Set<number>([stateOffset]);
    for (const rule of part.transitions) {
      partFields(rule.condition, read);
      partFields(rule.to, read);
    }
    for (const c of candidates) {
      const used = { table: false };
      const conditionTerms: Predicate[] = [],
        words: string[] = [];
      let possible = true,
        decided = true,
        byList = false,
        usesLightable = false;
      // The search's flags: one it needs must be given to the type, by the factory, its constructor or, for the lightable
      // mark, the decided assumption. A flag it needs clear stays as the line's condition.
      const searchTerms: Predicate[] = [];
      /** The name of each flag the search needs clear, by its test. */
      const clearNames = new Map<Predicate, string>();
      for (const t of c.search ?? []) {
        if (!t.set) {
          const test = flagTest(c.member, t);
          searchTerms.push(test);
          const named = PART_FLAGS.find((flag) => flag.offset === t.offset && flag.mask === t.mask);
          if (named) clearNames.set(test, named.name);
          continue;
        }
        if (isLightableTest(t)) {
          if (!LIGHTABLE_PARTS.has(part.id)) possible = false;
          else usesLightable = true;
        } else if (!gives(part.type, t)) possible = false;
      }
      for (const term of [...c.memberTerms, ...searchTerms]) {
        const typed = predicateForType(term, c.member, typeOffset, part.type, report.typeTable, used);
        const value = evaluate(typed, known(c.member));
        if (value === true) continue;
        const flag = listFlagWords(typed, c.member);
        if (value === false) {
          // Ruled out by the decided assumption only when no other test rules it out too.
          if (flag && offList && possible) byList = true;
          else {
            possible = false;
            byList = false;
          }
          continue;
        }
        const own = renamePredicate(typed, c.member, "part");
        // A test of the part's own fields that its type doesn't decide, like Mel's frame, stays as the line's condition,
        // in words, as for a touch: "its state is below 6".
        if (!flag && (!(c.named || c.search) || own.kind !== "compare" || readsTable(own))) decided = false;
        conditionTerms.push(own);
        // A flag the search needs clear says its name, like "its out-of-play flag 0x2000 is clear".
        const cleared = clearNames.get(term);
        words.push(
          flag ??
            (cleared
              ? `its ${cleared} is clear`
              : own.kind === "compare"
                ? compareWords(own, { field: fieldName, of: (_, what) => `its ${what}` })
                : ""),
        );
      }
      if (!possible || !decided) continue;
      if (c.writes.some((w) => [...Array(w.width / 8).keys()].some((byte) => read.has(w.offset + byte)))) continue;
      const settings = settingsOf(c.writes, c.member, part.type, used);
      if (!settings) continue;
      const { sets, proofs } = settings;
      // The part would get this line but for its list: a decided assumption keeps it off the moving list.
      if (byList) {
        assumptions.add(offList!);
        continue;
      }
      const name = nameOf(c.sourcePart);
      const { said, velocityDirection } = sayings(sets, name);
      const when = c.sourceWords.length ? `, when the ${name} is ${c.sourceWords.join(" and ")},` : "";
      const description = `${named(name, true)} that reaches it${when} ${said.join(" and ")}.${words.length ? ` Only when ${words.map((w) => (w.startsWith("its ") ? w : `it is ${w}`)).join(" and ")}.` : ""}`;
      // Outcomes join only when their source tests match too, so a line never drops another outcome's source test.
      const key = JSON.stringify([c.routine, sets, conditionTerms, c.sourceTerms]);
      const prior = effects.get(key);
      const evidence = uniqueEvidence([...c.outcome.evidence, ...c.writes.flatMap((w) => w.evidence)]);
      if (prior) {
        prior.evidence = uniqueEvidence([...prior.evidence, ...evidence]);
        continue;
      }
      effects.set(key, {
        sourceType: c.sourceType,
        sourcePart: c.sourcePart,
        routine: c.routine,
        sourceCondition: conjunction(c.sourceTerms),
        sourceConditionWords: c.sourceWords,
        sets,
        condition: conjunction(conditionTerms),
        conditionWords: words,
        ...(velocityDirection ? { velocityDirection } : {}),
        description,
        confidence: c.outcome.confidence,
        assumptions: [
          ...new Set([
            ...c.outcome.assumptions,
            ...c.writes.flatMap((w) => w.assumptions),
            ...(used.table ? [TYPE_TABLE_ASSUMPTION] : []),
            ...(usesLightable ? [LIGHTABLE_ASSUMPTION] : []),
            ...proofs,
            ...(velocityDirection ? [SCREEN_DIRECTION_ASSUMPTION] : []),
            "The part is in the source's overlap list and the source's own fields meet the source condition; that this happens in a level is not claimed.",
          ]),
        ],
        evidence,
      });
    }
    for (const line of touchLines(part, read, assumptions)) effects.set(`touch ${effects.size}`, line);
    if (effects.size || assumptions.size)
      result.set(part.type, { effects: [...effects.values()], assumptions: [...assumptions] });
  }
  return result;
}
