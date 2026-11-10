/**
 * What other parts do to a part that can change its frame, like the explosion setting a balloon's control value to 1 or
 * starting a mouse motor: these become trigger walks of the part, "hit by an explosion". Each comes from a proved
 * per-member outcome of another part's routine, worked out for this part's type. Only outcomes that write a field the
 * part's own rules read get a walk, and only when each such field gets a number. Outcomes that leave the part's
 * fields the same way, under the same tests of the part, share one walk, whichever part and path they come from.
 * An outcome must name the part's type, or its search's flag tests must be known and the part's type given every flag
 * the search needs, like the candle's first search, which keeps only parts with 0x0004 in field 0x0a.
 */
import { globalLists, searchedLists, typesLinkedInto } from "./behaviour-list-masks.ts";
import type { BehaviourReport, Evidence, Expression, FieldWrite, Finding, Predicate } from "./behaviour.ts";
import { callKinds, choiceOf, openCalls } from "./behaviour.ts";
import { formula as formulaOf } from "./describe-touch.ts";
import { directionCases } from "./behaviour-centre-angle.ts";
import {
  ANSWER_ASSUMPTION,
  CENTRES_ASSUMPTION,
  type Evaluate,
  FIXED_LIST_ASSUMPTION,
  MOVING_SEARCH_ASSUMPTION,
  MADE_FIXED_ASSUMPTION,
  FIXED_TYPE,
  LIST_FLAGS,
  TYPE_TABLE_ASSUMPTION,
  listFlagWords,
  named,
  nameOf,
  objects,
  offMovingList,
  onlyAnswersOpen,
  partFields,
  AIR_PRESSURE_ASSUMPTION,
  keptWithin,
  rangeNote,
  rulesIgnoreLimit,
  settleForType,
  splitBySource,
  afterQueriesIn,
  drawnFieldsOf,
  sourceRun,
  withOwnOverlapsIn,
  tidyArithmetic,
  predicateForType,
  readsAnswer,
  rename,
  renamePredicate,
  terms,
} from "./describe-effects.ts";

const MOVING_LIST = 0x1000;
/**
 * The flag the candle's and the rocket's first searches need: `0x0004` in field `0x0a`, which marks a part the candle
 * can light. Only the constructors of the cannon (`0x162c9` in Even More, English floppy), the dynamite (`0x16306`), the
 * rocket (`0x1664f`) and the candle (`0x167ea`) set it. Decided with the user on 2026-11-06: these four always have it
 * and no other part does, though a level stores the word.
 */
export const LIGHTABLE = { offset: 0x0a, mask: 0x0004 };
export const LIGHTABLE_PARTS = new Set(["cannon", "dynamite", "rocket", "candle"]);
export const LIGHTABLE_ASSUMPTION =
  "Only the cannon, dynamite, rocket and candle are ever marked as lightable (0x0004 in field 0x0a), and they always are. Only their constructors set it, and in the shipped levels every one of these four has it and no other part does.";
export const isLightableTest = (t: { offset: number; mask: number }) =>
  t.offset === LIGHTABLE.offset && t.mask === LIGHTABLE.mask;

/** One way other parts change this part's fields that its rules read. */
export interface PartHit extends Finding {
  /** The parts whose routines do it, with the routine, and the list consumer the routine hands its list to. */
  sources: { type: number; part: string; routine: number; consumer?: number }[];
  /** What the hit leaves in this part's fields, with `part` this part. A field set differently by the sources is unknown. */
  writes: FieldWrite[];
  /** What must hold for this part, with `part` this part: like being mirrored, or on the moving list. */
  condition: Predicate;
  /** The tests of `condition` on the part's list, in words, like "on the moving list". */
  conditionWords: string[];
  /** Where the part must lie from the source, in words, which the walk doesn't follow. */
  placeWords?: string[];
  name: string;
}

const conjunction = (list: Predicate[]): Predicate =>
  list.length === 0 ? { kind: "true" } : list.length === 1 ? list[0]! : { kind: "and", terms: list };
const uniqueEvidence = (list: Evidence[]) => [...new Map(list.map((e) => [e.address, e])).values()];
/** The type a test `member type == type` names. */
function namedType(term: Predicate, member: string, typeOffset: number): number | undefined {
  return term.kind === "compare" &&
    term.operator === "==" &&
    term.left.kind === "field" &&
    term.left.object === member &&
    term.left.offset === typeOffset &&
    term.left.width === 16 &&
    term.right.kind === "constant"
    ? term.right.value
    : undefined;
}
/** Whether a value still reads a table, which a walk can't look up. */
function readsTable(value: Expression | Predicate): boolean {
  if (value.kind === "table") return true;
  if (value.kind === "binary" || value.kind === "compare") return readsTable(value.left) || readsTable(value.right);
  if (value.kind === "and") return value.terms.some(readsTable);
  return false;
}

/**
 * A test of where the member lies from a point of the source, like the teeter-totter's list consumer testing
 * `(teeter-totter positionX + 74) - member positionX >= 54`: the distance from the point to the member's field, in
 * the field's own unit, and a bound on it.
 */
export interface PlaceTest {
  offset: number;
  /** For the source's centre, the size field whose half it adds to its field, like frameWidth for the centre X. */
  half?: number;
  /** The same for the member's centre, when the test measures to its centre. */
  memberHalf?: number;
  /**
   * A value of the source's own fields its point adds as well, like the teeter-totter's half width in the frame it
   * just went to, which it reads from its frame list.
   */
  extra?: Expression;
  /** What the source adds to its own field to get the point, like 74 for the teeter-totter's right end. */
  shift: number;
  low?: number;
  high?: number;
  /**
   * Set when the test compares the two places, like `member positionY > source positionY + 44`, and the distance is
   * read from that: so the places must be near enough that their difference doesn't wrap around a word.
   */
  compared?: true;
}
/** What reading the distance from a comparison of two places assumes. */
export const PLACE_DIFFERENCE_ASSUMPTION =
  "Two parts' places differ by less than 32,768 pixels, so a test comparing them says how far apart they are.";
const signedOf = (value: number, width: number) => {
  const wrapped = value & (2 ** width - 1);
  return wrapped >= 2 ** (width - 1) ? wrapped - 2 ** width : wrapped;
};
/**
 * The place test a term makes, or undefined when it isn't one: the point must be the source part's own field, the same
 * field as the member's. A value the run gives, like the owner's field after a list scan, is not where the source is.
 */
export function placeTest(term: Predicate, member: string): PlaceTest | undefined {
  return pointTest(term, member) ?? comparedPlaces(term, member);
}
function pointTest(term: Predicate, member: string): PlaceTest | undefined {
  if (term.kind !== "compare" || !term.signed || term.right.kind !== "constant") return undefined;
  const left = term.left;
  if (left.kind !== "binary" || left.operator !== "-") return undefined;
  const mine = left.right,
    point = left.left;
  if (mine.kind !== "field" || mine.object !== member || mine.unresolved) return undefined;
  const theirs = point.kind === "binary" && point.operator === "+" ? point.left : point;
  const shift =
    point.kind === "binary" && point.operator === "+"
      ? point.right.kind === "constant"
        ? signedOf(point.right.value, point.right.width)
        : undefined
      : 0;
  if (
    shift === undefined ||
    theirs.kind !== "field" ||
    theirs.object !== "part" ||
    theirs.unresolved ||
    theirs.offset !== mine.offset ||
    theirs.width !== mine.width
  )
    return undefined;
  const n = signedOf(term.right.value, term.right.width);
  const bound =
    term.operator === ">="
      ? { low: n }
      : term.operator === ">"
        ? { low: n + 1 }
        : term.operator === "<="
          ? { high: n }
          : term.operator === "<"
            ? { high: n - 1 }
            : undefined;
  return bound && { offset: mine.offset, shift, ...bound };
}
/**
 * A signed test comparing a place of the member with a place of the source along the same axis, like the vacuum
 * cleaner's `member positionY > source positionY + 44` or `source centre X - 4 <= member centre X`, where a centre X is
 * `positionX + (frameWidth >> 1)`, or the jack-in-the-box's `member positionX + 20 <= source centre X`. Both sides are
 * sums of the two parts' fields and numbers; their difference must be the source's place minus the member's (or the
 * other way round) plus a number, and that gives the bound on the distance from the source's place to the member's.
 */
function comparedPlaces(term: Predicate, member: string): PlaceTest | undefined {
  if (term.kind !== "compare" || !term.signed || !["<", "<=", ">", ">="].includes(term.operator)) return undefined;
  const atoms = new Map<string, number>();
  const extras = new Map<string, Expression>();
  let number = 0;
  /** A value that reads only the source's own known fields, words and numbers. */
  const sourceOnly = (e: Expression) => {
    const text = JSON.stringify(e);
    const objects = [...text.matchAll(/"object":"([^"]+)"/g)].map((m) => m[1]);
    return (
      objects.length > 0 &&
      objects.every((o) => o === "part") &&
      !text.includes('"unresolved":true') &&
      !text.includes('"kind":"unknown"')
    );
  };
  const add = (e: Expression, sign: number): boolean => {
    if (!(e.kind === "field" || e.kind === "constant") && !(e.kind === "binary" && ["+", "-"].includes(e.operator))) {
      const half =
        e.kind === "binary" &&
        e.operator === ">>" &&
        e.right.kind === "constant" &&
        e.right.value === 1 &&
        e.left.kind === "field";
      if (!half && sourceOnly(e)) {
        const key = `x:${JSON.stringify(e)}`;
        extras.set(key, e);
        atoms.set(key, (atoms.get(key) ?? 0) + sign);
        return true;
      }
    }
    if (e.kind === "constant") {
      number += sign * signedOf(e.value, e.width);
      return true;
    }
    if (e.kind === "field" && !e.unresolved && (e.object === member || e.object === "part")) {
      const key = `${e.object === member ? "m" : "s"}:${e.offset}:${e.width}:full`;
      atoms.set(key, (atoms.get(key) ?? 0) + sign);
      return true;
    }
    if (e.kind !== "binary") return false;
    if (e.operator === "+") return add(e.left, sign) && add(e.right, sign);
    if (e.operator === "-") return add(e.left, sign) && add(e.right, -sign);
    if (
      e.operator === ">>" &&
      e.right.kind === "constant" &&
      e.right.value === 1 &&
      e.left.kind === "field" &&
      !e.left.unresolved &&
      (e.left.object === member || e.left.object === "part")
    ) {
      const key = `${e.left.object === member ? "m" : "s"}:${e.left.offset}:${e.left.width}:half`;
      atoms.set(key, (atoms.get(key) ?? 0) + sign);
      return true;
    }
    return false;
  };
  if (!add(term.left, 1) || !add(term.right, -1)) return undefined;
  const used = [...atoms].filter(([, n]) => n !== 0);
  const extra = used.filter(([key]) => key.startsWith("x:"));
  const of = (who: string) => used.filter(([key]) => key.startsWith(`${who}:`));
  const mine = of("m"),
    theirs = of("s");
  if (!mine.length || !theirs.length) return undefined;
  const sign = theirs[0]![1];
  // The source's atoms and extras come with the source's sign, the member's with the other.
  if (![1, -1].includes(sign) || used.some(([key, n]) => n !== (key.startsWith("m:") ? -sign : sign))) return undefined;
  /** A part's point: one field, and at most one half of a size, like a centre. */
  const point = (list: [string, number][]) => {
    const fields = list.filter(([key]) => key.endsWith(":full")),
      halves = list.filter(([key]) => key.endsWith(":half"));
    if (fields.length !== 1 || halves.length > 1) return undefined;
    const [, offset, width] = fields[0]![0].split(":").map(Number) as [number, number, number];
    return width === 16 ? { offset, half: halves.length ? Number(halves[0]![0].split(":")[1]) : undefined } : undefined;
  };
  const at = point(mine),
    from = point(theirs);
  // Points along the same axis: the same field of each part, each with or without half its size.
  if (!at || !from || at.offset !== from.offset) return undefined;
  const { offset } = at;
  // left - right = sign × distance + number, compared with 0; so the distance is compared with -number, the test
  // turned round when the source's place came with a minus.
  const flip: Record<string, string> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" };
  const operator = sign === 1 ? term.operator : flip[term.operator]!;
  const n = sign === 1 ? -number : number;
  const bound =
    operator === ">="
      ? { low: n }
      : operator === ">"
        ? { low: n + 1 }
        : operator === "<="
          ? { high: n }
          : { high: n - 1 };
  return {
    offset,
    ...(from.half === undefined ? {} : { half: from.half }),
    ...(at.half === undefined ? {} : { memberHalf: at.half }),
    ...(extra.length
      ? {
          extra: extra
            .map(([key]) => extras.get(key)!)
            .reduce((a, b) => ({ kind: "binary", operator: "+", left: a, right: b, width: 16 })),
        }
      : {}),
    shift: 0,
    ...bound,
    compared: true,
  };
}

/**
 * Points of a part the place tests use, by the part's id, its field and the shift. The teeter-totter's list consumer
 * measures from `positionX + 74` and `positionX`, the two ends of its board as seen on screen.
 */
export const NAMED_POINTS: Record<string, Record<string, string>> = {
  "teeter-totter": { "positionX:74": "right end", "positionX:0": "left end" },
};
/**
 * Place tests in words, like "its positionX is 0 to 8 pixels left of the teeter-totter's right end (positionX + 74)"
 * or "its positionY is at least 47 pixels below the vacuum cleaner's positionY". The distance is the source's point
 * minus the member's place, so a positive one is to the left, or above. A point in `NAMED_POINTS` for the source's id
 * is named, with the field and shift after it; a centre says its formula.
 */
export function placeWords(
  tests: PlaceTest[],
  source: string,
  field: (offset: number) => string,
  sourceId?: string,
): string[] {
  const groups = new Map<
    string,
    {
      offset: number;
      half?: number;
      memberHalf?: number;
      extra?: Expression;
      shift: number;
      low?: number;
      high?: number;
    }
  >();
  for (const t of tests) {
    const key = `${t.offset}:${t.half}:${t.memberHalf}:${t.shift}:${JSON.stringify(t.extra)}`;
    const g = groups.get(key) ?? {
      offset: t.offset,
      ...(t.half === undefined ? {} : { half: t.half }),
      ...(t.memberHalf === undefined ? {} : { memberHalf: t.memberHalf }),
      ...(t.extra ? { extra: t.extra } : {}),
      shift: t.shift,
    };
    if (t.low !== undefined) g.low = Math.max(g.low ?? t.low, t.low);
    if (t.high !== undefined) g.high = Math.min(g.high ?? t.high, t.high);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ offset, half, memberHalf, extra, shift, low, high }) => {
    const fieldName = field(offset);
    const axis = /[XY]$/.exec(fieldName)?.[0];
    const centre = `centre${axis ? ` ${axis}` : ""}`;
    const name = memberHalf === undefined ? fieldName : centre;
    const plain = { field, of: (_: string, what: string) => what };
    const base = half === undefined ? fieldName : `${fieldName} + ${field(half)} / 2`;
    const formula = extra ? `${base} + ${formulaOf(tidyArithmetic(extra), plain, true)}` : base;
    const at = `${formula}${shift > 0 ? ` + ${shift}` : shift < 0 ? ` - ${-shift}` : ""}`;
    const end = sourceId === undefined || extra ? undefined : NAMED_POINTS[sourceId]?.[`${fieldName}:${shift}`];
    const point =
      half === undefined
        ? end
          ? `the ${source}'s ${end} (${at})`
          : `the ${source}'s ${at}`
        : `the ${source}'s ${centre} (${at})`;
    const [before, after] = axis === "Y" ? ["above", "below"] : ["left of", "right of"];
    const px = (n: number) => `${n} ${n === 1 ? "pixel" : "pixels"}`;
    if (low !== undefined && high !== undefined && low === -high)
      return `its ${name} is within ${px(high)} of ${point}`;
    if (low !== undefined && high !== undefined && low >= 0)
      return `its ${name} is ${low} to ${px(high)} ${before} ${point}`;
    if (low !== undefined && high !== undefined && high <= 0)
      return `its ${name} is ${-high} to ${px(-low)} ${after} ${point}`;
    if (low !== undefined && high !== undefined)
      return `its ${name} is between ${px(-low)} ${after} and ${px(high)} ${before} ${point}`;
    if (low === 0 && high === undefined) return `its ${name} is at or ${before} ${point}`;
    if (high === 0 && low === undefined) return `its ${name} is at or ${after} ${point}`;
    // At least 1 pixel off is strictly to that side.
    if (low === 1 && high === undefined) return `its ${name} is ${before} ${point}`;
    if (high === -1 && low === undefined) return `its ${name} is ${after} ${point}`;
    if (low !== undefined)
      return low > 0
        ? `its ${name} is at least ${px(low)} ${before} ${point}`
        : `its ${name} is at most ${px(-low)} ${after} ${point}`;
    return high! < 0
      ? `its ${name} is at least ${px(-high!)} ${after} ${point}`
      : `its ${name} is at most ${px(high!)} ${before} ${point}`;
  });
}

/** A flag test of a search on the member it keeps, like `(member + 0x0a & 0x0004) != 0`. */
export interface SearchTest extends Finding {
  offset: number;
  mask: number;
  set: boolean;
}
export const flagTest = (member: string, t: SearchTest): Predicate => ({
  kind: "compare",
  operator: t.set ? "!=" : "==",
  left: {
    kind: "binary",
    operator: "&",
    left: { kind: "field", object: member, offset: t.offset, width: 16 },
    right: { kind: "constant", value: t.mask, width: 16 },
    width: 16,
  },
  right: { kind: "constant", value: 0, width: 16 },
  signed: false,
});

/**
 * The flag tests on a member that the searches filling a loop's list make, when the reader has every such test of
 * each search: only the tests all of them make, since the member may come from any of them.
 */
export function searchTests(report: BehaviourReport, routine: number, header: number): SearchTest[] | undefined {
  const code = report.routines.find((r) => r.address === routine);
  const loop = code?.listLoops?.find((l) => l.header === header && l.source === "overlap-query");
  if (!loop?.queries.length) return undefined;
  let common: SearchTest[] | undefined;
  for (const query of loop.queries) {
    const target = code!.engineCalls?.find((c) => c.instruction === query)?.summary;
    const tests = report.helpers?.find((h) => h.address === target && h.kind === "overlap-list")?.list?.memberTests;
    if (!tests) return undefined;
    common = common
      ? common.filter((t) => tests.some((u) => u.offset === t.offset && u.mask === t.mask && u.set === t.set))
      : tests;
  }
  return common;
}

/**
 * Whether every search a loop's list comes from walks only the moving list: the list the contact dispatch walks, which
 * the routine that puts a dropped part on a list (`0x6469` in Even More, English floppy) gives a part of a type without
 * `0x4000`. False when a search's lists aren't known.
 */
export function searchesOnlyMovingList(report: BehaviourReport, routine: number, header: number): boolean {
  const moving = new Set((report.collisionDispatch ?? []).flatMap((d) => d.list?.globalHead ?? []));
  if (moving.size !== 1) return false;
  const code = report.routines.find((r) => r.address === routine);
  const loop = code?.listLoops?.find((l) => l.header === header && l.source === "overlap-query");
  if (!loop?.queries.length) return false;
  return loop.queries.every((query) => {
    const calls = code!.engineCalls?.filter((c) => c.instruction === query) ?? [];
    return (
      calls.length > 0 &&
      calls.every((call) => {
        const search = report.helpers?.find((h) => h.address === call.summary && h.kind === "overlap-list");
        const lists = search && call.listMasks && searchedLists(report.helpers!, search, call.listMasks);
        return !!lists?.length && lists.every((head) => moving.has(head));
      })
    );
  });
}

/** The head of the moving list: the one list the contact dispatch walks. */
function movingListHead(report: BehaviourReport): number | undefined {
  const moving = new Set((report.collisionDispatch ?? []).flatMap((d) => d.list?.globalHead ?? []));
  return moving.size === 1 ? [...moving][0] : undefined;
}

/**
 * The head of the fixed list: of the lists the list head routine picks by its mask, the one that is neither the moving
 * list nor the list the list next routine goes on to by itself (`0x4e1f` in Even More, English floppy).
 */
export function fixedListHead(report: BehaviourReport): number | undefined {
  const moving = movingListHead(report);
  const lists = report.helpers && globalLists(report.helpers);
  if (moving === undefined || !lists) return undefined;
  const others = lists.byHead.filter(
    (list) => list.head !== moving && !lists.byNext.some((next) => next.head === list.head),
  );
  return others.length === 1 ? others[0]!.head : undefined;
}

const madeIntoFixedListOf = new WeakMap<BehaviourReport, Set<number>>();
/**
 * The types that aren't of a fixed type but that part code makes with the part factory and links into the fixed list
 * itself, and never into the moving list: the explosion in Even More and TIM 1 (`typesLinkedInto`). By a decided
 * assumption such a part is never on the moving list.
 */
export function madeIntoFixedList(report: BehaviourReport): Set<number> {
  let types = madeIntoFixedListOf.get(report);
  if (!types) {
    const fixed = fixedListHead(report);
    const moving = movingListHead(report);
    const starting = report.helpers
      ?.find((h) => h.kind === "part-factory")
      ?.factory?.startingWords?.find((w) => w.field === LIST_FLAGS);
    types = new Set();
    if (fixed !== undefined && moving !== undefined && report.helpers && starting) {
      const intoMoving = typesLinkedInto(report.routines, report.helpers, moving).types;
      for (const type of typesLinkedInto(report.routines, report.helpers, fixed).types)
        if ((starting.values[type]! & FIXED_TYPE) === 0 && !intoMoving.has(type)) types.add(type);
    }
    madeIntoFixedListOf.set(report, types);
  }
  return types;
}

/**
 * After a bounce returns anything but 0, the contact dispatch may go on to a contact response, picked by the touching
 * part's flags. What such a response stores on the touching part is unknown after the touch. `undefined` when a
 * response has no relation, so what it may change isn't known.
 */
function responseFields(report: BehaviourReport): Set<number> | undefined {
  const fields = new Set<number>();
  for (const dispatch of report.collisionDispatch ?? [])
    for (const response of dispatch.responses ?? []) {
      if (response.status !== "described") return undefined;
      for (const w of response.writes)
        if (!w.path.length) for (let byte = 0; byte < w.width / 8; byte++) fields.add(w.offset + byte);
    }
  return fields;
}
export const RESPONSE_ASSUMPTION =
  "When the bounce returns anything but 0, the game may go on to a contact response: the fields its relation stores on the touching part (its velocity and fine position, and for the two-part exchange its list flags) are unknown after it, and it changes no other field of it. The exchange's relation lists every store; what stays open about it is only whether it returns when the two weights add up to 0.";
export const CONTACT_SEARCH_NOTE =
  "After setting the part's speeds the source runs the contact search on it, which may change its place, drawing place, frame size, list flags and contact record but not its speeds: the walk takes the fields it leaves that the part's rules read as unknown, and follows both ways where a rule tests them.";
export const PLACE_ASSUMPTION =
  "The part lies where the source's tests of the two places need it, like within a number of pixels from the teeter-totter's end, and the two places are close enough that the 16-bit difference the code takes doesn't wrap round; the walk doesn't follow where parts are, so it says this in words.";
export const TOUCH_TESTS_ASSUMPTION =
  "The tests of the bounce that compare the two parts, like where the part is on the source, hold; the walk doesn't follow the source's fields, so it doesn't keep them.";

/** A value worked out from the member's own fields alone, with `part` the member: a walk can work it out. */
function ownValue(value: Expression, member: string): Expression | undefined {
  const read = objects(value);
  if (read.unknown || readsTable(value) || ![...read.objects].every((o) => o === member)) return undefined;
  return rename(value, member, "part");
}

/** One way a push along the line between the two centres reaches the part, as its rules tell them apart. */
interface DirectionClass {
  /** The velocity fields, as the walk takes them. */
  values: Map<number, number>;
  /** Where the part must lie from the source, in words; empty when every direction gives the same frames. */
  words: string[];
  proof: string[];
}

/**
 * A speed the setter gives along the line from the source's centre to the part's (the explosion's push, the pinball
 * bumper's throw), split into the directions the part's rules tell apart. Every direction the centre angle can answer
 * gives a velocity (`directionCases`); the rules' tests of the velocity fields give each one an answer, and the
 * directions with the same answers make one case. A case is said as how far from level the line between the centres
 * is, so the answers must split by that alone, the same way on every side. The walk takes one velocity of each case,
 * which gives the frames every one of its directions gives. Undefined when the rules read the velocity in another way,
 * or the speed or the tables aren't known.
 */
function directionClasses(
  report: BehaviourReport,
  part: BehaviourReport["parts"][number],
  writes: FieldWrite[],
  member: string,
  typeOffset: number,
  source: string,
  evaluate: Evaluate,
  used: { table: boolean },
): DirectionClass[] | undefined {
  const first = writes[0]!.directedSpeed!;
  const line = first.direction;
  if (!line || line.from !== "part" || line.to !== member) return undefined;
  const speedOf = (w: FieldWrite) => {
    const value = settleForType(w.directedSpeed!.speed, member, typeOffset, part.type, report.typeTable, used).value;
    return value.kind === "constant" ? value.value : undefined;
  };
  const speed = speedOf(writes[0]!);
  if (
    speed === undefined ||
    writes.some(
      (w) =>
        w.width !== 16 ||
        w.directedSpeed!.routine !== first.routine ||
        w.directedSpeed!.call !== first.call ||
        JSON.stringify(w.directedSpeed!.direction) !== JSON.stringify(line) ||
        speedOf(w) !== speed,
    )
  )
    return undefined;
  const centre = report.helpers?.find((h) => h.address === line.routine)?.centreAngle;
  const velocity = report.helpers?.find((h) => h.address === first.routine)?.directedVelocity;
  if (!centre || !velocity || velocity.stores.some((store) => !writes.some((w) => w.offset === store.field)))
    return undefined;
  const cases = directionCases(centre.backend, velocity, speed);
  if (!cases) return undefined;
  const across = velocity.stores.find((store) => store.coefficient === "horizontal")!.field;
  const down = velocity.stores.find((store) => store.coefficient === "vertical")!.field;
  const fields: number[] = [across, down];
  const reads = (value: Expression | Predicate) => {
    const found = new Set<number>();
    partFields(value, found);
    return [...found];
  };
  const touches = (value: Expression | Predicate) =>
    reads(value).some((o) => fields.some((f) => o === f || o === f + 1));
  // The tests that tell velocities apart: the rules' tests of the two fields, and the choices a rule stores by them.
  const tests: Predicate[] = [];
  const test = (term: Predicate) => {
    if (!touches(term)) return true;
    if (term.kind !== "compare" || reads(term).some((o) => !fields.includes(o))) return false;
    tests.push(term);
    return true;
  };
  // A rule may store the field back moved by a number, like the bullet's bounce taking 1 from velocityX: the tests
  // must then answer the same at the moved velocity too.
  const shifts: { field: number; by: number }[] = [];
  const own = (value: Expression, target: number) =>
    value.kind === "field" && value.object === "part" && value.offset === target && value.width === 16;
  const keeps = (value: Expression, target: number): boolean => {
    if (!touches(value)) return true;
    if (own(value, target)) return true;
    if (
      value.kind === "binary" &&
      ["+", "-"].includes(value.operator) &&
      own(value.left, target) &&
      value.right.kind === "constant"
    ) {
      const by = value.operator === "+" ? value.right.value : -value.right.value;
      shifts.push({ field: target, by: ((by + 0x8000) & 0xffff) - 0x8000 });
      return true;
    }
    const choice = choiceOf(value);
    return !!choice && test(choice.test) && keeps(choice.then, target) && keeps(choice.otherwise, target);
  };
  for (const rule of part.transitions) {
    if (touches(rule.to)) return undefined;
    for (const update of (rule as { updates?: FieldWrite[] }).updates ?? [])
      if (!terms(update.condition).every(test) || !keeps(update.value, update.offset)) return undefined;
    if (!terms(rule.condition).every(test)) return undefined;
  }
  const answers = (vx: number, vy: number) => {
    const list = [{ field: across, by: 0 }, ...shifts].flatMap((shift) => {
      const known = [
        { object: "part", offset: across, width: 16, value: (vx + (shift.field === across ? shift.by : 0)) & 0xffff },
        { object: "part", offset: down, width: 16, value: (vy + (shift.field === down ? shift.by : 0)) & 0xffff },
      ].map((f) => ({ ...f, knownMask: 0xffff }));
      return tests.map((t) => evaluate(t, known));
    });
    return list.some((a) => a === undefined) ? undefined : JSON.stringify(list);
  };
  // How far from level the line is, from 0 to 90 degrees.
  const level = (degrees: number) => (Math.abs(degrees) <= 90 ? Math.abs(degrees) : 180 - Math.abs(degrees));
  const groups = new Map<string, { cases: typeof cases; low: number; high: number }>();
  for (const one of cases) {
    const key = answers(one.vx, one.vy);
    if (key === undefined) return undefined;
    const [a, b] = [level(one.from), level(one.to)];
    const group = groups.get(key) ?? { cases: [], low: Infinity, high: -Infinity };
    group.cases.push(one);
    group.low = Math.min(group.low, a, b);
    group.high = Math.max(group.high, a, b);
    groups.set(key, group);
  }
  // Each case must be one stretch from level, apart from the others but for where two meet.
  const sorted = [...groups.entries()].sort((a, b) => a[1].low - b[1].low);
  const EPSILON = 1e-9;
  for (let n = 1; n < sorted.length; n++) if (sorted[n]![1].low < sorted[n - 1]![1].high - EPSILON) return undefined;
  if (sorted[0]![1].low > EPSILON || sorted.at(-1)![1].high < 90 - EPSILON) return undefined;
  // Centres at the same point: the whole speed goes into velocityY, by the stated assumption on the centres.
  const same = new Set([answers(0, speed), answers(0, -speed)]);
  if (same.size !== 1 || !groups.has([...same][0]!)) return undefined;
  const degrees = (n: number) => `${Math.round(n * 10) / 10}`;
  const from = `the line from the ${nameOf(source)}'s centre to its centre`;
  return sorted.map(([key, group]) => {
    const middle = (group.low + group.high) / 2;
    // The velocity of a line that far below level to the right.
    const taken = group.cases.find(
      (c) => c.from >= -EPSILON && c.to <= 90 + EPSILON && c.from <= middle && middle <= c.to,
    )!;
    const stretch =
      sorted.length === 1
        ? undefined
        : group.low <= EPSILON
          ? `${from} is at most ${degrees(group.high)} degrees from level`
          : group.high >= 90 - EPSILON
            ? `${from} is more than ${degrees(group.low)} degrees from level`
            : `${from} is between ${degrees(group.low)} and ${degrees(group.high)} degrees from level`;
    const words = stretch ? [key === [...same][0] ? `${stretch}, or the two centres are the same point` : stretch] : [];
    return {
      values: new Map([
        [across, taken.vx],
        [down, taken.vy],
      ]),
      words,
      proof: [
        ...centre.assumptions,
        CENTRES_ASSUMPTION,
        `Every direction ${stretch ? "in this stretch" : "of the push"} gives the part the same frames, since its rules don't tell those velocities apart, so the walk takes the one for a line ${degrees(middle)} degrees below level to the right: velocityX ${taken.vx} and velocityY ${taken.vy}.`,
      ],
    };
  });
}

interface Candidate {
  sourceType: number;
  sourcePart: string;
  routine: number;
  member: string;
  outcome: Finding & { fields: FieldWrite[] };
  writes: FieldWrite[];
  memberTerms: Predicate[];
  /** The types the source's tests name: the source's code must name a part's type to hit it. */
  types: Set<number>;
  /** From the source's bounce callback: the part touched the source, rather than being in its list. */
  touch: boolean;
  /** Without a named type: the flag tests of the search that found the member, which the walk keeps. */
  search?: SearchTest[];
  /** Every search the member's list comes from walks only the moving list. */
  movingOnly: boolean;
  /** For a touch: what the bounce returns on the path, when it is a number. */
  returns?: number;
  /** For a touch: the source's tests left out, like those comparing the two parts or a query's answer. */
  dropped: { both: boolean; answer: boolean };
  /** For a list the source hands to a consumer: the consumer. */
  consumer?: number;
  /** The tests of where the part lies from the source, like the jack-in-the-box's reach or the teeter-totter's ends. */
  place?: PlaceTest[];
}

/**
 * By part type: the ways other parts change fields its rules read, and the decided assumptions that ruled out others.
 * `evaluate` tests a condition against known fields, as the walks do.
 */
export function hitsFromOthers(
  report: BehaviourReport,
  evaluate: Evaluate,
): Map<number, { hits: PartHit[]; assumptions: string[] }> {
  const result = new Map<number, { hits: PartHit[]; assumptions: string[] }>();
  const typeOffset = report.layout.fields.find((f) => f.name === "type")?.offset;
  const stateOffset = report.layout.fields.find((f) => f.name === "state")?.offset;
  if (typeOffset === undefined || stateOffset === undefined) return result;
  const fieldName = (offset: number) =>
    report.layout.fields.find((f) => f.offset === offset)?.name ?? `field 0x${offset.toString(16).padStart(2, "0")}`;
  const routines = new Map(report.routines.map((r) => [r.address, r]));
  const startingFlags = report.helpers
    ?.find((h) => h.kind === "part-factory")
    ?.factory?.startingWords?.find((w) => w.field === LIST_FLAGS);

  const factory = report.helpers?.find((h) => h.kind === "part-factory")?.factory;
  /** Whether a new part of the type gets the bits: from the factory's table, or from its constructor's first run. */
  const gives = (type: number, t: SearchTest) =>
    ((factory?.startingWords?.find((w) => w.field === t.offset)?.values[type] ?? 0) & t.mask) === t.mask ||
    !!factory?.constructorFlags?.some((f) => f.type === type && f.field === t.offset && (f.mask & t.mask) === t.mask);
  const drawnFields = drawnFieldsOf(report);
  const candidates: Candidate[] = [];
  /**
   * The contact dispatch calls the bounce callback of the type of the part a moving part touched, with the moving part
   * as its argument (`collider`); `part` is the touched part, the source here. Its outcomes are the touching part's
   * member outcomes.
   */
  const touches = (callback: { slot: number; address: number }) =>
    callback.slot === 0
      ? (routines.get(callback.address)?.outcomes ?? []).map((outcome) => ({ ...outcome, object: "collider" }))
      : [];
  for (const source of report.parts)
    for (const callback of source.routines) {
      if (callback.sharedDefault) continue;
      const iterations = routines.get(callback.address)?.iterationOutcomes ?? [];
      const kindAt = callKinds(report, callback.address);
      // A value that picks by the source's tests, like where the jack-in-the-box is from the bellows, is its cases.
      for (const outcome of [...iterations.flatMap((o) => splitBySource(o, o.object)), ...touches(callback)]) {
        const member = outcome.object;
        const touch = member === "collider";
        const consumed = "listConsumer" in outcome && !!outcome.listConsumer;
        // A bounce path whose only unknown is a query's answer, like the teeter-totter's bounce pool: the answer is the
        // source's business, like its own fields. So is where the source is, in a consumer's place test.
        const placeOnly = () =>
          terms(outcome.condition).every((t) => !objects(t).unknown || placeTest(t, member) !== undefined) &&
          outcome.fields.every((f) => !objects(f.value).unknown);
        // A search's own list may be open only at the overlap the search stored, the source's rope pull or the contact
        // search it runs on the part, as for the lines (`describe-effects.ts`).
        const readable = () =>
          !touch &&
          !consumed &&
          !openCalls([outcome.condition, ...outcome.fields.flatMap((f) => [f.value, f.condition])], kindAt).other;
        if (
          !outcome.effectsComplete ||
          (outcome.confidence === "unresolved" &&
            !(touch && onlyAnswersOpen(outcome)) &&
            !(consumed && placeOnly()) &&
            !readable())
        )
          continue;
        const writes = outcome.fields.filter((f) => f.object === member);
        // What a bounce does to the touched part itself is that part's own business.
        const extra = outcome.fields.filter((f) => f.object !== member && !(touch && f.object === "part"));
        if (!writes.length || extra.length) continue;
        const memberTerms: Predicate[] = [];
        const dropped = { both: false, answer: false };
        const place: PlaceTest[] = [];
        let open = false;
        for (const term of terms(outcome.condition).map((t) =>
          drawnFields(afterQueriesIn(withOwnOverlapsIn(t, member), member, kindAt)),
        )) {
          // What the source's rope pull answers, and its own fields after it, are the source's business.
          if (!touch && sourceRun(term, kindAt)) continue;
          const { objects: read, unknown } = objects(term);
          // A test of where the part lies from the source, like the jack-in-the-box's reach or the teeter-totter's ends.
          const placed = touch ? undefined : placeTest(term, member);
          if (placed) place.push(placed);
          else if (touch && term.kind === "compare" && readsAnswer(term) && ![...read].includes(member))
            dropped.answer = true;
          else if (unknown || term.kind === "unknown") open = true;
          else if ([...read].every((o) => o === member)) memberTerms.push(term);
          // The source's own tests, like the explosion going to frame 2, don't concern this part.
          else if ([...read].every((o) => o === "part")) continue;
          // A bounce's tests that compare the two parts, like where the part landed on a trampoline.
          else if (touch && [...read].every((o) => o === "part" || o === member)) dropped.both = true;
          else open = true;
        }
        const types = new Set(memberTerms.flatMap((term) => namedType(term, member, typeOffset) ?? []));
        // Without a named type, every test the search makes on the member must be known: like the candle's first
        // search, which keeps only parts with 0x0004 in field 0x0a.
        const search =
          types.size || member === "collider"
            ? undefined
            : searchTests(report, callback.address, "header" in outcome ? outcome.header : 0);
        // Any moving part can touch the source, so a touch needs no named type: its type tests decide.
        if (open || (!types.size && !search && !touch)) continue;
        candidates.push({
          sourceType: source.type,
          sourcePart: source.id,
          routine: callback.address,
          member,
          outcome,
          writes,
          memberTerms,
          types,
          touch,
          ...(search ? { search } : {}),
          movingOnly:
            !touch && searchesOnlyMovingList(report, callback.address, "header" in outcome ? outcome.header : 0),
          ...(touch && "returnValue" in outcome && outcome.returnValue.kind === "constant"
            ? { returns: outcome.returnValue.value }
            : {}),
          dropped,
          ...(consumed ? { consumer: outcome.listConsumer!.address } : {}),
          ...(place.length ? { place } : {}),
        });
      }
    }

  const afterResponse = responseFields(report);
  const fixed = (type: number) => !!startingFlags && (startingFlags.values[type]! & FIXED_TYPE) !== 0;
  for (const part of report.parts) {
    const hits = new Map<
      string,
      { hit: PartHit; tests: Predicate[]; place: string[]; touch: boolean; others: FieldWrite[][] }
    >();
    const assumptions = new Set<string>();
    // A part of a fixed type, or the bullet, is never on the moving list: a decided assumption says so.
    const offList = offMovingList(part, startingFlags);
    const known = (member: string) =>
      offList ? [{ object: member, offset: LIST_FLAGS, width: 16, value: 0, knownMask: MOVING_LIST }] : [];
    // Whether the part is marked as lightable is decided by its type too, with the decided assumption.
    const lightable = LIGHTABLE_PARTS.has(part.id);
    const marked = (member: string) => ({
      object: member,
      ...LIGHTABLE,
      width: 16,
      value: lightable ? LIGHTABLE.mask : 0,
      knownMask: LIGHTABLE.mask,
    });
    // The fields the part's own rules read: setting one of them can change its frame.
    const read = new Set<number>([stateOffset]);
    for (const rule of part.transitions) {
      partFields(rule.condition, read);
      partFields(rule.to, read);
    }
    const readsField = (w: FieldWrite) => [...Array(w.width / 8).keys()].some((byte) => read.has(w.offset + byte));
    for (const c of candidates) {
      const used = { table: false };
      const kept: Predicate[] = [];
      let possible = true,
        usesLightable = false;
      /** The decided assumptions that rule this out, when no other test does. */
      const ruledBy = new Set<string>();
      // The source's code must name this part's type: a search may hold parts the source never acts on. Or, when it
      // names none, the program must give this type every flag the search needs: from the factory's table for the
      // type, or from its constructor. The walk still keeps the search's tests, since a part may lose a flag, except
      // the lightable flag, which the decided assumption settles for every type.
      const needs = (t: SearchTest) => t.set && (lightable || !isLightableTest(t));
      if (c.types.size ? !c.types.has(part.type) : !c.touch && c.search!.some((t) => needs(t) && !gives(part.type, t)))
        continue;
      const searchTerms = (c.search ?? []).map((t) => flagTest(c.member, t));
      for (const term of [...c.memberTerms, ...searchTerms]) {
        const typed = predicateForType(term, c.member, typeOffset, part.type, report.typeTable, used);
        let value = evaluate(typed, known(c.member));
        let by = listFlagWords(typed, c.member) && offList;
        if (value === undefined) {
          value = evaluate(typed, [...known(c.member), marked(c.member)]);
          if (value === true) usesLightable = true;
          by = LIGHTABLE_ASSUMPTION;
        }
        if (value === true) continue;
        if (value === false) {
          // Ruled out by a decided assumption only when no other test rules it out too.
          if (by && possible) ruledBy.add(by);
          else {
            possible = false;
            ruledBy.clear();
          }
          continue;
        }
        if (readsTable(typed)) possible = false;
        kept.push(renamePredicate(typed, c.member, "part"));
      }
      if (!possible) continue;
      // A contact response may follow a bounce that doesn't return 0: what it stores is unknown after the touch.
      const responds = c.touch && c.returns !== 0;
      if (responds && !afterResponse) continue;
      const responded = (w: FieldWrite) =>
        responds && [...Array(w.width / 8).keys()].some((byte) => afterResponse!.has(w.offset + byte));
      // A field the contact search the source runs on the part leaves, like where the teeter-totter's launch puts it:
      // only the run knows, like a field a response may change.
      const kindAt = callKinds(report, c.routine);
      const searched = (w: FieldWrite) => {
        const left = openCalls([w.value], kindAt);
        return left.contactSearch && !left.other && !left.connectionQuery;
      };
      const unknown = (w: FieldWrite) => responded(w) || searched(w);
      const changes = c.writes.filter(readsField);
      // A value with the words of the part's type record its type settles, like a launch speed by its mass, and the
      // overlap its search stored as its own field. A value kept within its speed limit has a number to follow only
      // when the limit is the same number in every level, like the bullet's.
      // A limit the level's air pressure gives is one of a range: a walk may keep the value within its lowest when the
      // part's rules can't tell the limits of the range apart.
      let limited = false;
      let ranged: { min: number; max: number } | undefined;
      const own = (w: FieldWrite) => {
        const settled = settleForType(w.value, c.member, typeOffset, part.type, report.typeTable, used);
        if (!settled.kept) return ownValue(settled.value, c.member);
        if (settled.limit !== undefined) {
          const value = ownValue(keptWithin(settled.value, settled.limit), c.member);
          if (value) limited = true;
          return value;
        }
        if (!settled.range || !rulesIgnoreLimit(part, w.offset, settled.range, evaluate)) return undefined;
        const value = ownValue(keptWithin(settled.value, settled.range.min), c.member);
        if (value) ranged = settled.range;
        return value;
      };
      // A number, or a value of the part's own fields as the touch found them, in a field the rules read gives the walk
      // something to follow; a field a response may change again, or the contact search leaves, is unknown, and at least
      // one other must be known.
      // A push along the line between the centres, like the bumper's throw, is split into the directions the part's
      // rules tell apart.
      const directed = c.writes.filter((w) => w.directedSpeed);
      const directions =
        changes.some((w) => w.directedSpeed && !responded(w)) && directed.length
          ? directionClasses(report, part, directed, c.member, typeOffset, c.sourcePart, evaluate, used)
          : undefined;
      if (
        !changes.length ||
        changes.some((w) => (w.directedSpeed ? !directions && !responded(w) : !unknown(w) && !own(w))) ||
        changes.every(unknown)
      )
        continue;
      // The contact dispatch walks the moving list: a part of a fixed type never touches, by a decided assumption.
      if (c.touch && fixed(part.type)) {
        assumptions.add(FIXED_LIST_ASSUMPTION);
        continue;
      }
      // Nor does an explosion, which only part code makes, on the fixed list, by a decided assumption.
      if ((c.touch || c.movingOnly) && madeIntoFixedList(report).has(part.type)) {
        assumptions.add(MADE_FIXED_ASSUMPTION);
        continue;
      }
      // A search that walks only the moving list never finds a part of a fixed type, by a decided assumption.
      if (c.movingOnly && fixed(part.type)) {
        assumptions.add(FIXED_LIST_ASSUMPTION);
        assumptions.add(MOVING_SEARCH_ASSUMPTION);
        continue;
      }
      if (ruledBy.size) {
        for (const assumption of ruledBy) assumptions.add(assumption);
        continue;
      }
      for (const direction of directions ?? [undefined]) {
        const asPart = (w: FieldWrite): FieldWrite => {
          const taken = direction?.values.get(w.offset);
          const value: Expression | undefined =
            w.directedSpeed && taken !== undefined
              ? { kind: "constant", value: taken & 0xffff, width: 16 }
              : w.directedSpeed
                ? undefined
                : own(w);
          return {
            ...w,
            object: "part",
            condition: { kind: "true" },
            value:
              !unknown(w) && value
                ? value
                : {
                    kind: "unknown",
                    reason: responded(w)
                      ? "A contact response after the bounce may change it."
                      : searched(w)
                        ? "The contact search the source runs on it may change it; where it leaves the part, only the run knows."
                        : "The source sets it to a value the walk can't work out.",
                    width: w.width,
                  },
          };
        };
        const sortedChanges = changes.map(asPart).sort((a, b) => a.offset - b.offset);
        // Where the part must lie from the source stays in words; the walk doesn't follow where parts are.
        const place = [
          ...(c.place?.length ? placeWords(c.place, nameOf(c.sourcePart), fieldName, c.sourcePart) : []),
          ...(direction?.words ?? []),
        ];
        const key = JSON.stringify([c.touch, sortedChanges.map((w) => [w.offset, w.width, w.value]), place]);
        const given = (c.search ?? []).flatMap((t) =>
          t.set
            ? (factory?.constructorFlags ?? []).filter(
                (f) => f.type === part.type && f.field === t.offset && (f.mask & t.mask) === t.mask,
              )
            : [],
        );
        const evidence = uniqueEvidence([
          ...c.outcome.evidence,
          ...c.writes.flatMap((w) => w.evidence),
          ...(c.search ?? []).flatMap((t) => t.evidence),
          ...given.flatMap((f) => f.evidence),
        ]);
        const proof = [
          ...c.outcome.assumptions,
          ...c.writes.flatMap((w) => w.assumptions),
          ...(used.table ? [TYPE_TABLE_ASSUMPTION] : []),
          ...(limited || ranged ? report.typeTable!.speedLimits!.assumptions : []),
          ...(ranged ? [AIR_PRESSURE_ASSUMPTION, rangeNote(ranged)] : []),
          ...(usesLightable ? [LIGHTABLE_ASSUMPTION] : []),
          ...(responds && c.writes.some(responded) ? [RESPONSE_ASSUMPTION] : []),
          ...(changes.some(searched) ? [CONTACT_SEARCH_NOTE] : []),
          ...(c.dropped.both ? [TOUCH_TESTS_ASSUMPTION] : []),
          ...(c.dropped.answer ? [ANSWER_ASSUMPTION] : []),
          ...(c.place?.length ? [PLACE_ASSUMPTION] : []),
          ...(c.place?.some((t) => t.compared) ? [PLACE_DIFFERENCE_ASSUMPTION] : []),
          ...(direction?.proof ?? []),
        ];
        const others = c.writes.filter((w) => !readsField(w)).map(asPart);
        const prior = hits.get(key);
        if (prior) {
          const hit = prior.hit;
          if (!hit.sources.some((s) => s.type === c.sourceType && s.routine === c.routine && s.consumer === c.consumer))
            hit.sources.push({
              type: c.sourceType,
              part: c.sourcePart,
              routine: c.routine,
              ...(c.consumer === undefined ? {} : { consumer: c.consumer }),
            });
          hit.evidence = uniqueEvidence([...hit.evidence, ...evidence]);
          // A walk for several paths starts from what they all need: the tests every one of them makes.
          prior.tests = prior.tests.filter((t) => kept.some((u) => JSON.stringify(u) === JSON.stringify(t)));
          hit.assumptions = [...new Set([...hit.assumptions, ...proof])];
          prior.others.push(others);
          continue;
        }
        hits.set(key, {
          tests: kept,
          place,
          hit: {
            sources: [
              {
                type: c.sourceType,
                part: c.sourcePart,
                routine: c.routine,
                ...(c.consumer === undefined ? {} : { consumer: c.consumer }),
              },
            ],
            writes: sortedChanges,
            condition: { kind: "true" },
            conditionWords: [],
            name: "",
            // Unresolved only because of a query's answer, which is the source's business.
            confidence: c.outcome.confidence === "unresolved" ? "inferred" : c.outcome.confidence,
            assumptions: [
              ...new Set([
                ...proof,
                c.touch
                  ? "The part touches the source and the source's own fields meet the source's tests; that this happens in a level is not claimed."
                  : "The part is in the source's overlap list and the source's own fields meet the source's tests; that this happens in a level is not claimed.",
              ]),
            ],
            evidence,
          },
          touch: c.touch,
          others: [others],
        });
      }
    }
    const list = [...hits.values()].map(({ hit, tests, place, touch, others }) => {
      hit.condition = conjunction(tests);
      hit.conditionWords = tests.flatMap((t) => listFlagWords(t, "part") ?? []);
      // A field the rules don't read keeps the value every source gives it, or becomes unknown.
      const offsets = new Map<string, FieldWrite>();
      for (const w of others.flat()) offsets.set(`${w.offset}:${w.width}`, w);
      for (const [place, w] of offsets) {
        const same = others.every((set) =>
          set.some((x) => `${x.offset}:${x.width}` === place && JSON.stringify(x.value) === JSON.stringify(w.value)),
        );
        hit.writes.push(
          same
            ? w
            : {
                ...w,
                value: { kind: "unknown", reason: "The parts that do this set it differently.", width: w.width },
              },
        );
      }
      hit.sources.sort((a, b) => a.part.localeCompare(b.part));
      const names = [...new Set(hit.sources.map((s) => nameOf(s.part)))].map((n) => named(n));
      const listed = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
      hit.name = touch ? `Touching ${listed}` : `Hit by ${listed}`;
      if (place.length) {
        hit.placeWords = place;
        hit.name += `, when ${place.join(" and ")}`;
      }
      return hit;
    });
    if (list.length || assumptions.size) result.set(part.type, { hits: list, assumptions: [...assumptions] });
  }
  return result;
}
