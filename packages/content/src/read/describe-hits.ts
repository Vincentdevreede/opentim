/**
 * What other parts do to a part that can change its frame, like the explosion setting a balloon's control value to 1 or
 * starting a mouse motor: these become trigger walks of the part, "hit by an explosion". Each comes from a proved
 * per-member outcome of another part's routine, worked out for this part's type. Only outcomes that write a field the
 * part's own rules read get a walk, and only when each such field gets a number. Outcomes that leave the part's
 * fields the same way, under the same tests of the part, share one walk, whichever part and path they come from.
 * An outcome must name the part's type, or its search's flag tests must be known and the part's type given every flag
 * the search needs, like the candle's first search, which keeps only parts with 0x0004 in field 0x0a.
 */
import type { BehaviourReport, Evidence, Expression, FieldWrite, Finding, Predicate } from "./behaviour.ts";
import {
  ANSWER_ASSUMPTION,
  type Evaluate,
  FIXED_LIST_ASSUMPTION,
  FIXED_TYPE,
  LIST_FLAGS,
  TYPE_TABLE_ASSUMPTION,
  listFlagWords,
  nameOf,
  objects,
  offMovingList,
  onlyAnswersOpen,
  partFields,
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
const article = (name: string) => (/^[aeiou]/.test(name) ? "an" : "a");
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
  /** What the source adds to its own field to get the point, like 74 for the teeter-totter's right end. */
  shift: number;
  low?: number;
  high?: number;
}
const signedOf = (value: number, width: number) => {
  const wrapped = value & (2 ** width - 1);
  return wrapped >= 2 ** (width - 1) ? wrapped - 2 ** width : wrapped;
};
/**
 * The place test a term makes, or undefined when it isn't one: the point must be the source part's own field, the same
 * field as the member's. A value the run gives, like the owner's field after a list scan, is not where the source is.
 */
export function placeTest(term: Predicate, member: string): PlaceTest | undefined {
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
 * Place tests in words, like "its positionX is 0 to 8 pixels left of the teeter-totter's positionX + 74". The
 * distance is the source's point minus the member's field, so a positive one is to the left.
 */
export function placeWords(tests: PlaceTest[], source: string, field: (offset: number) => string): string[] {
  const groups = new Map<string, { offset: number; shift: number; low?: number; high?: number }>();
  for (const t of tests) {
    const key = `${t.offset}:${t.shift}`;
    const g = groups.get(key) ?? { offset: t.offset, shift: t.shift };
    if (t.low !== undefined) g.low = Math.max(g.low ?? t.low, t.low);
    if (t.high !== undefined) g.high = Math.min(g.high ?? t.high, t.high);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ offset, shift, low, high }) => {
    const name = field(offset);
    const point = `the ${source}'s ${name}${shift > 0 ? ` + ${shift}` : shift < 0 ? ` - ${-shift}` : ""}`;
    if (low !== undefined && high !== undefined && low >= 0)
      return `its ${name} is ${low} to ${high} pixels left of ${point}`;
    if (low !== undefined && high !== undefined && high <= 0)
      return `its ${name} is ${-high} to ${-low} pixels right of ${point}`;
    if (low !== undefined && high !== undefined)
      return `its ${name} is between ${-low} pixels right and ${high} pixels left of ${point}`;
    if (low !== undefined) return `${point} minus its ${name} is at least ${low}`;
    return `${point} minus its ${name} is at most ${high}`;
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
  /** For a touch: what the bounce returns on the path, when it is a number. */
  returns?: number;
  /** For a touch: the source's tests left out, like those comparing the two parts or a query's answer. */
  dropped: { both: boolean; answer: boolean };
  /** For a list the source hands to a consumer: the consumer, and the tests of where the part lies from the source. */
  consumer?: number;
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
      for (const outcome of [...iterations, ...touches(callback)]) {
        const member = outcome.object;
        const touch = member === "collider";
        const consumed = "listConsumer" in outcome && !!outcome.listConsumer;
        // A bounce path whose only unknown is a query's answer, like the teeter-totter's bounce pool: the answer is the
        // source's business, like its own fields. So is where the source is, in a consumer's place test.
        const placeOnly = () =>
          terms(outcome.condition).every((t) => !objects(t).unknown || placeTest(t, member) !== undefined) &&
          outcome.fields.every((f) => !objects(f.value).unknown);
        if (
          !outcome.effectsComplete ||
          (outcome.confidence === "unresolved" && !(touch && onlyAnswersOpen(outcome)) && !(consumed && placeOnly()))
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
        for (const term of terms(outcome.condition)) {
          const { objects: read, unknown } = objects(term);
          const placed = consumed ? placeTest(term, member) : undefined;
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
          ...(touch && "returnValue" in outcome && outcome.returnValue.kind === "constant"
            ? { returns: outcome.returnValue.value }
            : {}),
          dropped,
          ...(consumed ? { consumer: outcome.listConsumer!.address, place } : {}),
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
      const changes = c.writes.filter(readsField);
      // A number, or a value of the part's own fields as the touch found them, in a field the rules read gives the walk
      // something to follow; a field a response may change again is unknown, and at least one other must be known.
      if (
        !changes.length ||
        changes.some((w) => w.directedSpeed || (!responded(w) && !ownValue(w.value, c.member))) ||
        changes.every(responded)
      )
        continue;
      // The contact dispatch walks the moving list: a part of a fixed type never touches, by a decided assumption.
      if (c.touch && fixed(part.type)) {
        assumptions.add(FIXED_LIST_ASSUMPTION);
        continue;
      }
      if (ruledBy.size) {
        for (const assumption of ruledBy) assumptions.add(assumption);
        continue;
      }
      const asPart = (w: FieldWrite): FieldWrite => {
        const value = ownValue(w.value, c.member);
        return {
          ...w,
          object: "part",
          condition: { kind: "true" },
          value:
            !responded(w) && value
              ? value
              : {
                  kind: "unknown",
                  reason: responded(w)
                    ? "A contact response after the bounce may change it."
                    : "The source sets it to a value the walk can't work out.",
                  width: w.width,
                },
        };
      };
      const sortedChanges = changes.map(asPart).sort((a, b) => a.offset - b.offset);
      // Where the part must lie from the source stays in words; the walk doesn't follow where parts are.
      const place = c.place?.length ? placeWords(c.place, nameOf(c.sourcePart), fieldName) : [];
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
        ...(usesLightable ? [LIGHTABLE_ASSUMPTION] : []),
        ...(responds && c.writes.some(responded) ? [RESPONSE_ASSUMPTION] : []),
        ...(c.dropped.both ? [TOUCH_TESTS_ASSUMPTION] : []),
        ...(c.dropped.answer ? [ANSWER_ASSUMPTION] : []),
        ...(place.length ? [PLACE_ASSUMPTION] : []),
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
      const names = [...new Set(hit.sources.map((s) => nameOf(s.part)))].map((n) => `${article(n)} ${n}`);
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
