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
import {
  allocationCall,
  binary,
  callKinds,
  choiceOf,
  choose,
  openCalls,
  speedLimitOf,
  TYPE_RECORD_WRITTEN,
} from "./behaviour.ts";
import { directionError } from "./behaviour-centre-angle.ts";
import { limitForAir } from "./behaviour-speed-limits.ts";
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
  PLACE_DIFFERENCE_ASSUMPTION,
  placeTest,
  placeWords,
  searchTests,
  madeIntoFixedList,
  searchesOnlyMovingList,
  type PlaceTest,
  type SearchTest,
} from "./describe-hits.ts";
import { conjunction, constant, uniqueEvidence, unsigned } from "./behaviour-terms.ts";

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
 * A search that walks only the list at `0x4d7d` (Even More, English floppy) finds no part of a fixed type. That list is
 * the one the routine at `0x6469` puts a dropped part on when its type lacks `0x4000`, and the one the contact dispatch
 * walks. Part code links rope ends, pinballs and bullets into it itself, none of a fixed type, and no shipped level
 * stores a part of a fixed type in its moving group. Decided with the user on 2026-11-08, to be checked again later.
 */
export const MOVING_SEARCH_ASSUMPTION =
  "A search that walks only the moving list (the list the contact dispatch walks) finds no part of a fixed type. The game puts a dropped part there only when its type isn't fixed, the parts part code links there itself (rope ends, pinballs, bullets) aren't of a fixed type, and no shipped level stores a part of a fixed type among its moving parts.";
/**
 * A part of a type that only part code makes and links into the fixed list, the explosion, is never on the moving list.
 * Its two makers (`0x190f:0x32a9` and `0x16ca:0x3792` in Even More, English floppy) link it into the list at `0x4e1f`,
 * and no shipped level stores one. Decided with the user on 2026-11-08: an explosion only happens after another part's
 * action, so a level never stores one.
 */
export const MADE_FIXED_ASSUMPTION =
  "An explosion is never on the moving list, so it touches nothing and no search of the moving list finds it. Only part code makes explosions, and it links them into the fixed list; an explosion only happens after another part's action, so no level stores one.";
/** The lowest and highest air pressure a level can have, by the decided assumption: what the control panel can set. */
const AIR_PRESSURES = { min: 0, max: 128 };
/**
 * A level's air pressure is one the control panel can set. The panel keeps its setting from 0 to 128 (`0x12566` to
 * `0x1257a` in Even More, English floppy) and a new level starts at 67 (`0x15d69`). Decided with the user on
 * 2026-11-08.
 */
export const AIR_PRESSURE_ASSUMPTION =
  "A level's air pressure is one the game's control panel can set, from 0 to 128. The panel keeps its setting in that range and a new level starts at 67; the level loader reads the word as it is, but only the game writes level files, and the shipped levels use 0 to 68.";
/** The lowest and highest speed limit the air pressures a level can have give a type the routine doesn't fix. */
export function speedLimitRange(table: BehaviourReport["typeTable"]): { min: number; max: number } | undefined {
  const setup = table?.speedLimits;
  if (!setup) return undefined;
  let min = Infinity,
    max = -Infinity;
  for (let air = AIR_PRESSURES.min; air <= AIR_PRESSURES.max; air++) {
    const limit = limitForAir(setup, air);
    if (limit === undefined) return undefined;
    min = Math.min(min, limit);
    max = Math.max(max, limit);
  }
  return { min, max };
}
/** What a walk that keeps a value within the lowest limit of the range rests on. */
export const rangeNote = (range: { min: number; max: number }) =>
  `Every speed limit the air pressure can give, from ${range.min} to ${range.max}, gives the part the same frames, since its rules don't tell those speeds apart, so the walk keeps the value within ${range.min}.`;
/**
 * Whether the part's rules can't tell which limit of the range kept a velocity within it: they read the field only in
 * tests of that field alone, and each test gives the same answer for every speed from the lowest limit to the highest,
 * and for every one from minus the highest to minus the lowest. Those are the only speeds two limits of the range can
 * leave different, so a walk may keep the value within the lowest.
 */
export function rulesIgnoreLimit(
  part: Pick<BehaviourReport["parts"][number], "transitions">,
  offset: number,
  range: { min: number; max: number },
  evaluate: Evaluate,
): boolean {
  if (range.min <= 0 || range.max > 0x7fff) return false;
  const reads = (value: Expression | Predicate) => {
    const found = new Set<number>();
    partFields(value, found);
    return found;
  };
  const touches = (found: Set<number>) => found.has(offset) || found.has(offset + 1);
  /** A test of the field alone that gives one answer over each side of the range. */
  const blind = (term: Predicate) => {
    const found = reads(term);
    if (!touches(found)) return true;
    if (term.kind !== "compare" || [...found].some((o) => o !== offset)) return false;
    for (const sign of [1, -1]) {
      let first: boolean | undefined;
      for (let speed = range.min; speed <= range.max; speed++) {
        const answer = evaluate(term, [
          { object: "part", offset, width: 16, value: unsigned(sign * speed, 16), knownMask: 0xffff },
        ]);
        if (answer === undefined || (first !== undefined && answer !== first)) return false;
        first = answer;
      }
    }
    return true;
  };
  /**
   * A value a rule stores that keeps the field's speeds apart no better: a choice by such tests between values that
   * don't read the field, or, stored in the field itself, the field as it was.
   */
  const keeps = (value: Expression, target: number): boolean => {
    if (!touches(reads(value))) return true;
    if (value.kind === "field" && value.object === "part" && value.offset === offset && value.width === 16)
      return target === offset;
    const choice = choiceOf(value);
    return !!choice && blind(choice.test) && keeps(choice.then, target) && keeps(choice.otherwise, target);
  };
  for (const rule of part.transitions) {
    if (touches(reads(rule.to))) return false;
    for (const update of (rule as { updates?: FieldWrite[] }).updates ?? [])
      if (!terms(update.condition).every(blind) || !keeps(update.value, update.offset)) return false;
    if (!terms(rule.condition).every(blind)) return false;
  }
  return true;
}
/**
 * The fields of the touching part every contact response writes again, when one always follows a bounce that returns
 * something other than 0: each pass of the contact dispatch picks exactly one response, whatever the touching part's
 * flags and type, and every response is described and writes the field on every way. Undefined otherwise.
 */
function rewrittenByResponse(report: BehaviourReport, evaluate: Evaluate): Set<number> | undefined {
  const dispatches = report.collisionDispatch ?? [];
  if (!dispatches.length) return undefined;
  let fields: Set<number> | undefined;
  for (const dispatch of dispatches) {
    for (const pass of dispatch.passes) {
      // The routes test the touching part's list flags and type. Each field gets a value for every way its tests can
      // tell apart: every mix of the bits its masks pick, and for a comparison the constant, its two neighbours, the
      // extremes and a value no test names.
      const masks = new Map<number, number>();
      const compared = new Map<number, Set<number>>();
      const visit = (v: Expression | Predicate): boolean => {
        if (v.kind === "compare" || v.kind === "binary") {
          if (v.left.kind === "field" && v.right.kind === "constant") {
            if (v.left.object !== "collider") return false;
            const { offset } = v.left;
            const value = v.right.value & 0xffff;
            if (v.operator === "&") masks.set(offset, (masks.get(offset) ?? 0) | value);
            else if (v.operator in OPPOSITE) compared.set(offset, (compared.get(offset) ?? new Set()).add(value));
            else return false;
            return true;
          }
          // A test can also be a value, 1 when it holds: those join with `&`.
          if (v.operator !== "&" && !(v.operator in OPPOSITE)) return false;
          return visit(v.left) && visit(v.right);
        }
        if (v.kind === "and") return v.terms.every(visit);
        return v.kind === "true" || v.kind === "constant";
      };
      if (!pass.callbackNonzero.every((route) => visit(route.condition))) return undefined;
      // A field both masked and compared whole could need a value that mixes the two: not worked out here.
      if ([...masks.keys()].some((o) => compared.has(o))) return undefined;
      const read = new Map<number, number[]>();
      for (const [offset, mask] of masks) {
        const bits = [...Array(16).keys()].map((b) => 1 << b).filter((b) => mask & b);
        if (bits.length > 12) return undefined;
        read.set(
          offset,
          [...Array(2 ** bits.length).keys()].map((n) => bits.reduce((v, b, k) => (n & (1 << k) ? v | b : v), 0)),
        );
      }
      for (const [offset, constants] of compared) {
        const values = new Set([0, 0x7fff, 0x8000, 0xffff]);
        for (const c of constants) for (const v of [c - 1, c, c + 1]) values.add(v & 0xffff);
        let fresh = 0;
        while (constants.has(fresh)) fresh++;
        read.set(offset, [...values.add(fresh)]);
      }
      const offsets = [...read.keys()];
      const choices = offsets.map((o) => read.get(o)!);
      if (choices.reduce((n, list) => n * list.length, 1) > 4096) return undefined;
      const combine = (n: number, known: { offset: number; value: number }[]): boolean => {
        if (n === offsets.length) {
          const fieldsKnown = known.map((k) => ({
            object: "collider",
            offset: k.offset,
            width: 16,
            value: k.value & 0xffff,
            knownMask: 0xffff,
          }));
          const taken = pass.callbackNonzero.filter((route) => evaluate(route.condition, fieldsKnown) === true);
          const unsure = pass.callbackNonzero.some((route) => evaluate(route.condition, fieldsKnown) === undefined);
          return !unsure && taken.length === 1;
        }
        return choices[n]!.every((value) => combine(n + 1, [...known, { offset: offsets[n]!, value }]));
      };
      if (!combine(0, [])) return undefined;
    }
    for (const response of dispatch.responses ?? []) {
      if (response.status !== "described") return undefined;
      const helper = report.helpers?.find((h) => h.address === response.routine);
      if (!helper) return undefined;
      const own = new Set<number>();
      // Only stores the response makes on every way through it.
      for (const w of helper.writes)
        if (w.root === "argument" && !w.path?.length && w.condition.kind === "true")
          for (let byte = 0; byte < w.width / 8; byte++) own.add(w.offset + byte);
      fields = fields ? new Set([...fields].filter((f) => own.has(f))) : own;
    }
  }
  return fields;
}
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
export const CENTRES_ASSUMPTION =
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
const PART_FLAGS: { offset: number; mask: number; name: string; words: string }[] = [
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
   * The fields the source leaves to the contact search it then runs on this part, like the teeter-totter sweeping a
   * part it launches: what that search finds there only the run knows, so the line names them without a value.
   */
  searched?: number[];
  /**
   * Where this part must lie from the source, like the vacuum cleaner's "its positionY is at least 47 pixels below the
   * vacuum cleaner's positionY". Its words are in `conditionWords`.
   */
  place?: PlaceTest[];
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

export const terms = (predicate: Predicate): Predicate[] =>
  predicate.kind === "and" ? predicate.terms.flatMap(terms) : predicate.kind === "true" ? [] : [predicate];
/** Names in a list: "a", "a and b", "a, b and c". */
const listWords = (names: string[]) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

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

/** The name a line gives the source while it says a value of both parts, so `part` can be the part it changes. */
const SOURCE = "the source";
/**
 * Whether a value or test reads the member with the source, or an allocation answer, and nothing else: a line says it
 * in words of where the source is, like the wall split's cut from the explosion's centre.
 */
export function readsSourcePlace(value: Expression | Predicate, member: string): boolean {
  let other = false,
    placed = false;
  const visit = (v: Expression | Predicate) => {
    if (v.kind === "unknown") other = true;
    else if (v.kind === "field") {
      if (v.unresolved ? !!allocationCall(v.object) : v.object === "part") placed = true;
      else if (v.unresolved || v.object !== member) other = true;
    } else if (v.kind === "binary" || v.kind === "compare") {
      visit(v.left);
      visit(v.right);
    } else if (v.kind === "table") visit(v.index);
    else if (v.kind === "and") v.terms.forEach(visit);
  };
  visit(value);
  return placed && !other;
}
/** A number for an expression of constants, at its width. */
function numberOf(e: Expression): number | undefined {
  if (e.kind === "constant") return unsigned(e.value, e.width);
  if (e.kind !== "binary") return undefined;
  const a = numberOf(e.left),
    b = numberOf(e.right);
  if (a === undefined || b === undefined) return undefined;
  // A comparison gives 1 or 0, read unsigned at the width of what it compares, as the walks read it.
  if (["==", "!=", "<", "<=", ">", ">="].includes(e.operator)) {
    const [x, y] = [unsigned(a, e.left.width), unsigned(b, e.left.width)];
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
    return unsigned(Math.floor(value / 2 ** b), e.width);
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
  return result === undefined ? undefined : unsigned(result, e.width);
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
    const at = e.segment * 16 + unsigned(e.offset + index, 16) - table.address;
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
/** A test with the overlap its search stored in the member read as the member's own field. */
export const withOwnOverlapsIn = (p: Predicate, member: string): Predicate =>
  p.kind === "compare"
    ? { ...p, left: withOwnOverlaps(p.left, member), right: withOwnOverlaps(p.right, member) }
    : p.kind === "and"
      ? { ...p, terms: p.terms.map((t) => withOwnOverlapsIn(t, member)) }
      : p;
/** A value with the overlap its search stored in the member read as the member's own field, which holds it now. */
export function withOwnOverlaps(e: Expression, member: string): Expression {
  if (e.kind === "field" && e.unresolved && OVERLAP.exec(e.object)?.[2] === member)
    return { kind: "field", object: member, offset: e.offset, width: e.width };
  if (e.kind === "binary") {
    const left = withOwnOverlaps(e.left, member),
      right = withOwnOverlaps(e.right, member);
    return left === e.left && right === e.right ? e : { ...e, left, right };
  }
  if (e.kind === "table") {
    const index = withOwnOverlaps(e.index, member);
    return index === e.index ? e : { ...e, index };
  }
  return e;
}
const OPPOSITE: Record<string, string> = { "==": "!=", "!=": "==", "<": ">=", ">=": "<", ">": "<=", "<=": ">" };
/**
 * A value that picks between values by tests that read the source, like the jack-in-the-box's push tilting the
 * bellows by which side of it the jack-in-the-box's centre is on, as cases: each with its tests and the value it picks.
 * A choice that reads only the part stays one value, like a velocity kept within its speed limit. A value that reads
 * the source in another way stays as it is, as one case without tests. Undefined past `limit` cases.
 */
export function sourceChoices(value: Expression, limit = 32): { tests: Predicate[]; value: Expression }[] | undefined {
  const split = (e: Expression): { tests: Predicate[]; value: Expression }[] => {
    const read = objects(e).objects;
    const choice = read.has("part") || [...read].some((o) => allocationCall(o)) ? choiceOf(e) : undefined;
    if (!choice) return [{ tests: [], value: e }];
    const opposite = { ...choice.test, operator: OPPOSITE[choice.test.operator]! };
    return [
      ...split(choice.then).map((c) => ({ ...c, tests: [choice.test, ...c.tests] })),
      ...split(choice.otherwise).map((c) => ({ ...c, tests: [opposite, ...c.tests] })),
    ];
  };
  const cases = split(value);
  return cases.length > limit ? undefined : cases;
}
/**
 * A loop's way with each value that picks by the source's tests split into its cases: one way for each, with the
 * case's tests added to the way's and the value it picks. A case that leaves the field as it was writes nothing.
 */
/** A sum with a negative number read as a difference: "x + -32" as "x - 32". */
const plainSigns = (words: string) => words.replace(/\+ -(\d)/g, "- $1");
/** Whether a list of tests has one test and its opposite. */
function contradicts(tests: Predicate[]): boolean {
  const keys = new Set(tests.map((t) => JSON.stringify(t)));
  return tests.some(
    (t) =>
      t.kind === "compare" &&
      !!OPPOSITE[t.operator] &&
      keys.has(JSON.stringify({ ...t, operator: OPPOSITE[t.operator]! })),
  );
}
export function splitBySource<T extends { condition: Predicate; fields: FieldWrite[] }>(
  outcome: T,
  member: string,
): T[] {
  let ways: { tests: Predicate[]; fields: FieldWrite[] }[] = [{ tests: [], fields: [] }];
  for (const w of outcome.fields) {
    const cases = w.object === member ? sourceChoices(w.value) : undefined;
    if (!cases || cases.length === 1) {
      ways = ways.map((way) => ({ ...way, fields: [...way.fields, w] }));
      continue;
    }
    ways = ways
      .flatMap((way) =>
        cases.map((c) => {
          const unchanged = c.value.kind === "field" && c.value.object === member && c.value.offset === w.offset;
          return {
            tests: [...way.tests, ...c.tests],
            fields: unchanged ? way.fields : [...way.fields, { ...w, value: c.value }],
          };
        }),
      )
      // Fields chosen by the same tests, like the wall split's, give ways that contradict themselves: drop them now.
      .filter((way) => !contradicts(way.tests));
    if (ways.length > 64) return [outcome];
  }
  if (ways.length === 1) return [outcome];
  // A case whose tests contradict each other, or the way's, never happens: a nested choice brings back tests the case
  // already made, the same or opposite.
  const key = (t: Predicate) => JSON.stringify(t);
  const opposite = (t: Predicate) =>
    t.kind === "compare" && OPPOSITE[t.operator] ? key({ ...t, operator: OPPOSITE[t.operator]! }) : undefined;
  return ways.flatMap((way) => {
    const all = [...terms(outcome.condition), ...way.tests];
    const keys = new Set(all.map(key));
    if (all.some((t) => keys.has(opposite(t) ?? ""))) return [];
    const once = all.filter((t, n) => all.findIndex((u) => key(u) === key(t)) === n);
    return [{ ...outcome, condition: conjunction(once), fields: way.fields }];
  });
}
/**
 * The values the frame-position helper writes in a part's own fields, like its frameWidth from its frame list: a
 * source that redraws itself and then reads such a field reads that value, which a line or walk says by the field's
 * name. The helper's value reads the part's fields as they are when it is called, so where the source changed one
 * before, like the teeter-totter stepping its frame, the value holds what that field was then: each field of the
 * helper's value may stand for any value of the source's own fields, the same one wherever it is read.
 */
export function drawnFieldsOf(report: Pick<BehaviourReport, "helpers">): (p: Predicate) => Predicate {
  const drawn = (report.helpers ?? [])
    .filter((h) => h.kind === "frame-position")
    .flatMap((h) =>
      (h.writes ?? []).flatMap((w) =>
        "root" in w && w.root === "argument" && !w.path?.length && (w.condition?.kind ?? "true") === "true"
          ? [
              {
                value: w.value,
                field: { kind: "field", object: "part", offset: w.offset, width: w.width } as Expression,
              },
            ]
          : [],
      ),
    );
  const fits = (template: Expression, e: Expression, bound: Map<number, string>): boolean => {
    if (template.kind === "field" && template.object === "part" && !template.unresolved) {
      const key = JSON.stringify(e);
      const prior = bound.get(template.offset);
      if (prior !== undefined) return prior === key;
      // A field may stand only for a value of the source's own fields.
      const read = objects(e);
      if (read.unknown || [...read.objects].some((o) => o !== "part")) return false;
      bound.set(template.offset, key);
      return true;
    }
    if (template.kind !== e.kind) return false;
    if (template.kind === "binary" && e.kind === "binary")
      return (
        template.operator === e.operator && fits(template.left, e.left, bound) && fits(template.right, e.right, bound)
      );
    if (template.kind === "table" && e.kind === "table")
      return template.segment === e.segment && template.offset === e.offset && fits(template.index, e.index, bound);
    return JSON.stringify(template) === JSON.stringify(e);
  };
  const drawnValue = (e: Expression): Expression => {
    const named = drawn.find((d) => d.value.kind === "binary" && fits(d.value, e, new Map()));
    if (named) return named.field;
    if (e.kind === "binary") return { ...e, left: drawnValue(e.left), right: drawnValue(e.right) };
    return e;
  };
  const drawnFields = (p: Predicate): Predicate =>
    p.kind === "compare"
      ? { ...p, left: drawnValue(p.left), right: drawnValue(p.right) }
      : p.kind === "and"
        ? { ...p, terms: p.terms.map(drawnFields) }
        : p;
  return drawnFields;
}
/** A found part's field a loop reads after a connection query of the source's, like "<member> after field effect at 0x1d2af". */
const AFTER_EFFECT = / after field effect at (0x[0-9a-f]+)$/;
/**
 * A value with a found part's field read after the source's rope pull (a connection query) read as the part's own
 * field: the loop reads the part as it is then, which is how a line reads it, as with the overlap its search stored.
 */
function afterQueries(e: Expression, member: string, kindAt: (instruction: number) => string | undefined): Expression {
  if (e.kind === "field" && e.unresolved && e.object.startsWith(`${member} after field effect at `)) {
    const at = AFTER_EFFECT.exec(e.object);
    if (at && kindAt(Number(at[1])) === "connection-query")
      return { kind: "field", object: member, offset: e.offset, width: e.width };
  }
  if (e.kind === "binary")
    return { ...e, left: afterQueries(e.left, member, kindAt), right: afterQueries(e.right, member, kindAt) };
  if (e.kind === "table") return { ...e, index: afterQueries(e.index, member, kindAt) };
  return e;
}
export const afterQueriesIn = (
  p: Predicate,
  member: string,
  kindAt: (instruction: number) => string | undefined,
): Predicate =>
  p.kind === "compare"
    ? { ...p, left: afterQueries(p.left, member, kindAt), right: afterQueries(p.right, member, kindAt) }
    : p.kind === "and"
      ? { ...p, terms: p.terms.map((t) => afterQueriesIn(t, member, kindAt)) }
      : p;
/**
 * Whether a test reads only the source: its own fields, and what its rope pull (a connection query) answers or its
 * own fields after it, with at least one of the latter. Only the run knows those, so the test stays the source's.
 */
export function sourceRun(term: Predicate, kindAt: (instruction: number) => string | undefined): boolean {
  let run = false,
    other = false;
  const visit = (v: Expression | Predicate) => {
    if (v.kind === "unknown") other = true;
    else if (v.kind === "field") {
      if (!v.unresolved) {
        if (v.object !== "part") other = true;
        return;
      }
      const at = /^(?:answer of the query|part after the query) at (0x[0-9a-f]+)$/.exec(v.object);
      if (at && kindAt(Number(at[1])) === "connection-query") run = true;
      else other = true;
    } else if (v.kind === "binary" || v.kind === "compare") {
      visit(v.left);
      visit(v.right);
    } else if (v.kind === "table") visit(v.index);
    else if (v.kind === "and") v.terms.forEach(visit);
  };
  visit(term);
  return run && !other;
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
): { value: Expression; kept: boolean; limit?: number; range?: { min: number; max: number } } {
  const settled = forType(withOwnOverlaps(value, member), member, typeOffset, type, table, used);
  const kept = speedLimitOf(settled);
  const limit = kept?.limit;
  // The limit read for this part's type: through its type field, or, read for a known type, at that type's record.
  const ownLimit =
    !!table &&
    limit?.kind === "table" &&
    limit.segment * 16 + limit.offset === table.address + SPEED_LIMIT &&
    (JSON.stringify(limit.index).includes(`"object":${JSON.stringify(member)},"offset":${typeOffset}`) ||
      (limit.index.kind === "constant" && limit.index.value === type * table.stride));
  if (!ownLimit || !kept) return { value: settled, kept: false };
  // A type whose limit is the same number in every level, like the bullet's 12288.
  const fixed = table?.speedLimits?.fixed.find((f) => f.type === type)?.limit;
  if (fixed !== undefined) return { value: kept.speed, kept: true, limit: fixed };
  // Any other type's limit is one the level's air pressure gives, by the decided assumption within a range.
  const range = speedLimitRange(table);
  return range ? { value: kept.speed, kept: true, range } : { value: kept.speed, kept: true };
}
/** A speed limit that is a number in every level, as the words give it after "its speed limit". */
const limitWords = (limit: number | undefined) => (limit === undefined ? "" : ` of ${limit}`);
/**
 * A value kept within a speed limit that is a number: `limit if speed > limit, else -limit if speed < -limit, else
 * speed`, signed, as the speed limit routine leaves it.
 */
export function keptWithin(speed: Expression, limit: number): Expression {
  const number = constant(limit),
    negative = constant(unsigned(-limit, 16));
  const above: Extract<Predicate, { kind: "compare" }> = {
    kind: "compare",
    operator: ">",
    left: speed,
    right: number,
    signed: true,
  };
  const below: Extract<Predicate, { kind: "compare" }> = {
    kind: "compare",
    operator: "<",
    left: speed,
    right: negative,
    signed: true,
  };
  return choose(above, number, choose(below, negative, speed, 16), 16);
}
/** The speed limit's word in a type record, which the game works out for every type from the level's air and gravity. */
const SPEED_LIMIT = 0x0a;

/**
 * A value as the words say it, the same number written plainly: a word sign extended to 32 bits is the word, a 32-bit
 * number past 2^31 is negative, `(c × x) >> k` with c a multiple of 2^k is `(c / 2^k) × x` when the product can't wrap,
 * the low word of a quotient
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
    // Only when the product can't wrap: with a factor of w bits, |c| × 2^w must stay within the product's sign bit,
    // or `(2 × x) >> 1` would read x where the game's product wraps.
    const factor = tidyArithmetic(e.left.right);
    const fits = signedC !== undefined && Math.abs(signedC) * 2 ** factor.width <= 2 ** (e.left.width - 1);
    if (signedC !== undefined && fits && signedC % 2 ** k === 0) {
      const scaled = signedC / 2 ** k;
      const width = e.left.left.width;
      return tidyArithmetic({ ...e.left, left: constant(scaled < 0 ? 2 ** width + scaled : scaled, width) });
    }
  }
  if (e.operator === "&" && number(e.right) === 0xffff && e.left.kind === "binary" && e.left.operator === "s/")
    return tidyArithmetic(e.left);
  // A division by 1, like a push divided by a mass of 1, is the value itself.
  if (e.operator === "s/" && number(right) === 1) return left;
  // The low word of a value, in 16-bit arithmetic that wraps anyway, is the value: the mask says nothing there. Before
  // a shift right, a division or a comparison the high word would count, so the mask stays.
  const lowWord = (x: Expression) =>
    x.kind === "binary" && x.operator === "&" && number(x.right) === 0xffff ? x.left : x;
  if (e.width === 16 && ["+", "-", "*", "&", "|", "^", "<<"].includes(e.operator)) {
    const [l, r] = [lowWord(left), lowWord(right)];
    if (l !== left || r !== right) return tidyArithmetic({ ...e, left: l, right: r });
  }
  if (e.operator === "s/") return { ...e, operator: "÷", left, right };
  // A type settled to a number leaves products by a test's 1 or 0, like `(type != 8) * x` for a type other than 8.
  if (e.operator === "*" && (number(left) === 0 || number(right) === 0)) return constant(0, e.width);
  if (e.operator === "*" && number(left) === 1) return right;
  if (e.operator === "*" && number(right) === 1) return left;
  if (e.operator === "+" && number(left) === 0) return right;
  if ((e.operator === "+" || e.operator === "-") && number(right) === 0) return left;
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
  /** Set when the way comes from reading the loop for one type of found part: it holds only for that type. */
  onlyType?: number;
  sourceWords: string[];
  sourceType: number;
  sourcePart: string;
  routine: number;
  member: string;
  outcome: Finding & { condition: Predicate; fields: FieldWrite[] };
  writes: FieldWrite[];
  /** The fields the contact search the source runs on the part leaves as only the run knows. */
  searched: number[];
  sourceTerms: Predicate[];
  /** Whether the source's tests read a word of its own type record. */
  sourceTable: boolean;
  memberTerms: Predicate[];
  /** The tests of where the part lies from the source. */
  place: PlaceTest[];
  /**
   * Other tests that read the part with the source, or what a call of the source's found only the run knows, like the
   * wall split's hole edges from the explosion's centre and whether the game had room for the copy. Said in words.
   */
  relative: Predicate[];
  /**
   * Whether the source names the part's type, or else the flag tests of the search that found it, when they are all
   * known. Only then may a line keep tests of the part's own fields that its type doesn't decide: a search may keep
   * only parts with a flag the outcome doesn't show, like the candle's, which keeps lightable parts.
   */
  named: boolean;
  search?: SearchTest[];
  /** Every search the part's list comes from walks only the moving list. */
  movingOnly: boolean;
}

/** The part that touched the source, as the bounce callback gets it; `part` is the source, the part it touched. */
const TOUCHER = "collider";
export const TOUCH_ASSUMPTION =
  "The part touches the source, which is another part, and the fields of both meet the tests when the contact dispatch calls the source's bounce; that this happens in a level is not claimed.";

/** Whether a value reads a table, which a line can't look up. */
function readsTable(
  value: Expression | Predicate,
  allowed?: (e: Extract<Expression, { kind: "table" }>) => boolean,
): boolean {
  if (value.kind === "table") return !allowed?.(value);
  if (value.kind === "binary" || value.kind === "compare")
    return readsTable(value.left, allowed) || readsTable(value.right, allowed);
  if (value.kind === "and") return value.terms.some((t) => readsTable(t, allowed));
  return false;
}
/**
 * Whether a table word is the speed limit of a part of the type: the game works it out for every type when a level
 * starts, so it is the part's own, like a field, though it is no number before the level.
 */
function isSpeedLimitOf(
  e: Extract<Expression, { kind: "table" }>,
  type: number,
  table: BehaviourReport["typeTable"],
): boolean {
  return (
    !!table &&
    e.segment * 16 + e.offset === table.address + SPEED_LIMIT &&
    e.index.kind === "constant" &&
    e.index.value === type * table.stride
  );
}
/** Whether a value reads a table word besides the speed limit of a part of the type. */
export const readsTableBesidesSpeedLimit = (
  value: Expression | Predicate,
  type: number,
  table: BehaviourReport["typeTable"],
): boolean => readsTable(value, (e) => isSpeedLimitOf(e, type, table));

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
  // A table word goes on to the line's settings, which take one the part's type settles, or its own speed limit.
  const own = (value: Expression) => {
    const read = objects(value);
    return !read.unknown && [...read.objects].every((o) => o === TOUCHER);
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
  const fixedType = (type: number) => !!startingFlags && (startingFlags.values[type]! & FIXED_TYPE) !== 0;

  const factory = report.helpers?.find((h) => h.kind === "part-factory")?.factory;
  /** Whether a new part of the type gets the bits: from the factory's table, or from its constructor's first run. */
  const gives = (type: number, t: SearchTest) =>
    ((factory?.startingWords?.find((w) => w.field === t.offset)?.values[type] ?? 0) & t.mask) === t.mask ||
    !!factory?.constructorFlags?.some((f) => f.type === type && f.field === t.offset && (f.mask & t.mask) === t.mask);
  const fieldName = (offset: number) => fieldNames.get(offset) ?? `field 0x${offset.toString(16).padStart(2, "0")}`;
  /** A value of the part's own fields in words, like "subtracts 1 from velocityX" or "halves velocityX, rounding down". */
  /** A test of both parts, or of whether the game had room for a copy, in words. */
  const relativeWords = (t: Extract<Predicate, { kind: "compare" }>, member: string, source: string) => {
    const room = [t.left, t.right].find((e) => e.kind === "field" && allocationCall(e.object));
    const zero = [t.left, t.right].some((e) => e.kind === "constant" && e.value === 0);
    if (room?.kind === "field" && zero && (t.operator === "==" || t.operator === "!="))
      return `${t.operator === "!=" ? "the game finds room" : "the game finds no room"} for the copy the ${source} makes (the allocation at ${allocationCall(room.object)})`;
    return plainSigns(
      compareWords(
        { ...t, left: tidyArithmetic(t.left), right: tidyArithmetic(t.right) },
        {
          field: fieldName,
          of: (object, what) => (object === member ? `its ${what}` : `the ${source}'s ${what}`),
        },
      ),
    );
  };
  const settingWords = (offset: number, raw: Expression, type?: number, source?: string) => {
    const table = (e: Extract<Expression, { kind: "table" }>) =>
      type !== undefined && isSpeedLimitOf(e, type, report.typeTable) ? "speed limit" : undefined;
    // A value of where the source is names the source's fields, like "the explosion's centre X".
    if (source !== undefined) {
      const names: Names = {
        field: fieldName,
        of: (object, what) => (object === SOURCE ? `the ${source}'s ${what}` : what),
        table,
      };
      return `sets ${fieldName(offset)} to ${plainSigns(formula(tidyArithmetic(raw), names))}`;
    }
    const field = fieldName(offset);
    const value = tidyArithmetic(raw);
    const own = (e: Expression) => e.kind === "field" && e.object === "part" && e.offset === offset && e.width === 16;
    // A value added to the field's own, like a push.
    if (value.kind === "binary" && value.operator === "+" && own(value.left) && value.right.kind !== "constant")
      return `adds ${formula(value.right, { field: fieldName, of: (_, what) => what, table })} to ${field}`;
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
    const plain: Names = { field: fieldName, of: (_, what) => what, table };
    const long = longPart(value);
    if (long)
      return `sets ${field} to the ${long.high ? "high" : "low"} word of ${formula(long.word, plain)} × ${2 ** long.shift}`;
    return `sets ${field} to ${formula(value, plain)}`;
  };
  /**
   * What the writes set on a part of the type: numbers, speeds and values of its own fields. Undefined when a speed
   * isn't a number for it.
   */
  const settingsOf = (
    writes: FieldWrite[],
    member: string,
    type: number,
    used: { table: boolean },
    source?: string,
  ) => {
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
      if (settled && source !== undefined && !settled.kept && readsSourcePlace(settled.value, member)) {
        // A value of where the source is, like the wall split's cut from the explosion's centre: the source's fields
        // are named, and `part` is this part.
        const value = rename(rename(settled.value, "part", SOURCE), member, "part");
        sets.push({
          kind: "expression",
          offset: w.offset,
          width: w.width,
          value,
          words: settingWords(w.offset, value, type, source),
        });
        continue;
      }
      if (settled) {
        // Only a value of the part's own fields says something a line can repeat.
        const read = objects(settled.value);
        if (
          read.unknown ||
          readsTableBesidesSpeedLimit(settled.value, type, report.typeTable) ||
          [...read.objects].some((o) => o !== member)
        )
          return undefined;
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
              ? `keeps ${fieldName(w.offset)} within its speed limit${limitWords(settled.limit)}`
              : `${settingWords(w.offset, value, type)}, kept within its speed limit${limitWords(settled.limit)}`
            : settingWords(w.offset, value, type),
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
  const rewritten = rewrittenByResponse(report, evaluate);
  const touchLines = (part: BehaviourReport["parts"][number], read: Set<number>, assumptions: Set<string>) => {
    const readsField = (w: FieldWrite) => [...Array(w.width / 8).keys()].some((byte) => read.has(w.offset + byte));
    // A field the contact response that always follows a bounce returning nonzero writes again is that response's.
    const responds = (c: TouchCandidate) => c.returns !== undefined && c.returns !== 0 && !!rewritten;
    const redone = (w: FieldWrite) =>
      [...Array(w.width / 8).keys()].every((byte) => rewritten?.has(w.offset + byte) ?? false);
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
      // A write to a field the part's rules read can change its frame: walks are the place for that, unless the
      // contact response that always follows writes the field again.
      if (!possible || c.writes.some((w) => readsField(w) && !(responds(c) && redone(w)))) continue;
      const settings = settingsOf(c.writes, TOUCHER, part.type, used);
      if (!settings) continue;
      if (fixed) {
        assumptions.add(FIXED_LIST_ASSUMPTION);
        continue;
      }
      if (madeIntoFixedList(report).has(part.type)) {
        assumptions.add(MADE_FIXED_ASSUMPTION);
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
        const ruled = c.writes.filter(readsField).map((w) => fieldName(w.offset));
        const response =
          c.returns === undefined
            ? " The game may go on to a contact response, which can change these again."
            : c.returns === 0
              ? " Its bounce returns 0 then, so no contact response follows."
              : ruled.length
                ? ` Its bounce returns ${c.returns} then, so the game always goes on to a contact response, which works ${listWords([...new Set(ruled)])} out again from the angle they touch at: which frame it shows next is up to that response.`
                : ` Its bounce returns ${c.returns} then, so the game ${rewritten ? "always goes" : "may go"} on to a contact response, which can change these again.`;
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
  const drawnFields = drawnFieldsOf(report);
  const candidates: Candidate[] = [];
  const touches: TouchCandidate[] = [];
  for (const source of report.parts)
    for (const callback of source.routines) {
      if (callback.sharedDefault) continue;
      // A loop read for each type of found part gives each type's own ways, in place of the generic ones.
      const code = routines.get(callback.address);
      const ways = code?.iterationOutcomesByType
        ? Object.entries(code.iterationOutcomesByType).flatMap(([type, list]) =>
            list.map((outcome) => ({ outcome, onlyType: Number(type) as number | undefined })),
          )
        : (code?.iterationOutcomes ?? []).map((outcome) => ({ outcome, onlyType: undefined as number | undefined }));
      const kindAt = callKinds(report, callback.address);
      for (const { outcome, onlyType } of ways.flatMap((way) =>
        splitBySource(way.outcome, way.outcome.object).map((outcome) => ({ ...way, outcome })),
      )) {
        // What a list consumer does to a member tests where it lies from the source, which a line can't say yet: it
        // comes as a walk (`describe-hits.ts`). A way is read when it is open only at the overlap its search stored in
        // the part, at a rope pull of the source's (a connection query) or at the contact search it runs on the part.
        if (
          !outcome.effectsComplete ||
          outcome.listConsumer ||
          (outcome.confidence === "unresolved" &&
            openCalls([outcome.condition, ...outcome.fields.flatMap((f) => [f.value, f.condition])], kindAt).other)
        )
          continue;
        const member = outcome.object;
        // The source's own type is known when the callback is its type's alone: its type and its type record's words
        // are numbers in its tests, like the half width of the teeter-totter's frame.
        const sourceUsed = { table: false };
        const ownType = (t: Predicate) =>
          callback.shared ? t : predicateForType(t, "part", typeOffset, source.type, report.typeTable, sourceUsed);
        const all = outcome.fields.filter((f) => f.object === member);
        if (!all.length || all.length !== outcome.fields.length) continue;
        // What the contact search leaves on the part, and a value read from it after, only the run knows: the line
        // names those fields and sets the others.
        const searched = all.filter((w) => {
          const open = openCalls([w.value], kindAt);
          return open.contactSearch && !open.connectionQuery && !open.other;
        });
        // A value of where the source is reads the source's drawn fields by name, like its frameWidth, and its own
        // type is known when the callback is its type's alone, as in its tests.
        const writes = all
          .filter((w) => !searched.includes(w))
          .map((w) => {
            const value = withOwnOverlaps(w.value, member);
            if (!readsSourcePlace(value, member)) return w;
            const test = ownType(
              drawnFields({ kind: "compare", operator: "==", left: value, right: constant(0), signed: false }),
            );
            return test.kind === "compare" ? { ...w, value: test.left } : w;
          });
        if (!writes.length) continue;
        // Every field set needs a number for the part's type, a formula of its own fields, or the speed the speed setter
        // was given: so a value may read only the member and the type table.
        if (
          writes.some((w) => {
            const value = withOwnOverlaps(w.value, member);
            const read = objects(value);
            return (
              !w.directedSpeed &&
              (read.unknown || [...read.objects].some((o) => o !== member)) &&
              !readsSourcePlace(value, member)
            );
          })
        )
          continue;
        const sourceTerms: Predicate[] = [],
          memberTerms: Predicate[] = [],
          relative: Predicate[] = [],
          place: PlaceTest[] = [];
        let open = false;
        for (const term of terms(outcome.condition).map((t) =>
          ownType(drawnFields(afterQueriesIn(withOwnOverlapsIn(t, member), member, kindAt))),
        )) {
          const { objects: read, unknown } = objects(term);
          // A test the source's type settles says nothing when it holds, and rules the way out when it fails.
          if (!read.size && !unknown && term.kind === "compare") {
            const value = evaluate(term, []);
            if (value === true) continue;
            if (value === false) {
              open = true;
              break;
            }
          }
          const placed = unknown ? undefined : placeTest(term, member);
          const both = readsSourcePlace(term, member);
          // A test of what the source's rope pull answers, or of its own fields after it, is the source's.
          if (sourceRun(term, kindAt)) sourceTerms.push(term);
          else if ((unknown || term.kind === "unknown") && !both) open = true;
          else if ([...read].every((o) => o === "part")) sourceTerms.push(term);
          else if ([...read].every((o) => o === member)) memberTerms.push(term);
          // A test of where the part lies from the source, like the vacuum cleaner's nozzle below it.
          else if (placed) place.push(placed);
          // Another test of both parts, like a wall split's hole edge, said as it is.
          else if (both && term.kind === "compare") relative.push(term);
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
          ...(onlyType === undefined ? {} : { onlyType }),
          named,
          movingOnly: searchesOnlyMovingList(report, callback.address, outcome.header),
          ...(search ? { search } : {}),
          sourceWords: sourceTerms.flatMap((t) => drawingFlagWords(t, report) ?? []),
          sourceTable: sourceUsed.table,
          sourceType: source.type,
          sourcePart: source.id,
          routine: callback.address,
          member,
          outcome,
          writes,
          searched: [...new Set(searched.map((w) => w.offset))].sort((a, b) => a - b),
          sourceTerms,
          memberTerms,
          place,
          relative,
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
      if (c.onlyType !== undefined && c.onlyType !== part.type) continue;
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
        if (
          !flag &&
          (!(c.named || c.search) ||
            own.kind !== "compare" ||
            readsTableBesidesSpeedLimit(own, part.type, report.typeTable))
        )
          decided = false;
        conditionTerms.push(own);
        // A flag the search needs clear says its name, like "its out-of-play flag 0x2000 is clear".
        const cleared = clearNames.get(term);
        words.push(
          flag ??
            (cleared
              ? `its ${cleared} is clear`
              : own.kind === "compare"
                ? compareWords(
                    { ...own, left: tidyArithmetic(own.left), right: tidyArithmetic(own.right) },
                    {
                      field: fieldName,
                      of: (_, what) => `its ${what}`,
                      table: (e) => (isSpeedLimitOf(e, part.type, report.typeTable) ? "speed limit" : undefined),
                    },
                  )
                : ""),
        );
      }
      if (!possible || !decided) continue;
      if (c.writes.some((w) => [...Array(w.width / 8).keys()].some((byte) => read.has(w.offset + byte)))) continue;
      const settings = settingsOf(c.writes, c.member, part.type, used, nameOf(c.sourcePart));
      if (!settings) continue;
      const { sets, proofs } = settings;
      // The part would get this line but for its list: a decided assumption keeps it off the moving list.
      if (byList) {
        assumptions.add(offList!);
        continue;
      }
      // Or but for the list its source searches: a part of a fixed type is never on the moving list.
      if (c.movingOnly && fixedType(part.type)) {
        assumptions.add(FIXED_LIST_ASSUMPTION);
        assumptions.add(MOVING_SEARCH_ASSUMPTION);
        continue;
      }
      if (c.movingOnly && madeIntoFixedList(report).has(part.type)) {
        assumptions.add(MADE_FIXED_ASSUMPTION);
        continue;
      }
      const name = nameOf(c.sourcePart);
      const { said, velocityDirection } = sayings(sets, name);
      const placeSaid = [
        ...placeWords(c.place, name, fieldName, c.sourcePart),
        ...c.relative.map((t) => relativeWords(t as Extract<Predicate, { kind: "compare" }>, c.member, name)),
      ];
      words.push(...placeSaid);
      const when = c.sourceWords.length ? `, when the ${name} is ${c.sourceWords.join(" and ")},` : "";
      const searchedSaid = c.searched.length
        ? ` Then it runs the contact search on it, which may change its ${listWords(c.searched.map((offset) => fieldName(offset)))}; what that search finds there, only the run knows.`
        : "";
      const description = `${named(name, true)} that reaches it${when} ${said.join(" and ")}.${words.length ? ` Only when ${words.map((w) => (/^\(*(its|the game) /.test(w) ? w : `it is ${w}`)).join(" and ")}.` : ""}${searchedSaid}`;
      // Outcomes join only when their source tests match too, so a line never drops another outcome's source test.
      const key = JSON.stringify([c.routine, sets, conditionTerms, c.sourceTerms, placeSaid, c.searched]);
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
        // Tests of both parts go with the source's, with `collider` this part, as for a touch.
        sourceCondition: conjunction([
          ...c.sourceTerms,
          ...c.relative.map((t) => renamePredicate(t, c.member, "collider")),
        ]),
        sourceConditionWords: c.sourceWords,
        sets,
        condition: conjunction(conditionTerms),
        conditionWords: words,
        ...(velocityDirection ? { velocityDirection } : {}),
        ...(c.place.length ? { place: c.place } : {}),
        ...(c.searched.length ? { searched: c.searched } : {}),
        description,
        // A way open only at the overlap its search stored reads it as the part's own field, which holds it.
        confidence: c.outcome.confidence === "unresolved" ? "inferred" : c.outcome.confidence,
        assumptions: [
          ...new Set([
            ...c.outcome.assumptions,
            ...c.writes.flatMap((w) => w.assumptions),
            ...(used.table || c.sourceTable ? [TYPE_TABLE_ASSUMPTION] : []),
            ...(usesLightable ? [LIGHTABLE_ASSUMPTION] : []),
            ...proofs,
            ...(velocityDirection ? [SCREEN_DIRECTION_ASSUMPTION] : []),
            ...(c.place.some((t) => t.compared) ? [PLACE_DIFFERENCE_ASSUMPTION] : []),
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
