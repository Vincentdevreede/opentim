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
  type Evaluate,
  FIXED_LIST_ASSUMPTION,
  FIXED_TYPE,
  LIST_FLAGS,
  TYPE_TABLE_ASSUMPTION,
  listFlagWords,
  nameOf,
  objects,
  partFields,
  predicateForType,
  renamePredicate,
  terms,
} from "./describe-effects.ts";

const MOVING_LIST = 0x1000;

/** One way other parts change this part's fields that its rules read. */
export interface PartHit extends Finding {
  /** The parts whose routines do it, with the routine. */
  sources: { type: number; part: string; routine: number }[];
  /** What the hit leaves in this part's fields, with `part` this part. A field set differently by the sources is unknown. */
  writes: FieldWrite[];
  /** What must hold for this part, with `part` this part: like being mirrored, or on the moving list. */
  condition: Predicate;
  /** The tests of `condition` on the part's list, in words, like "on the moving list". */
  conditionWords: string[];
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

/** A flag test of a search on the member it keeps, like `(member + 0x0a & 0x0004) != 0`. */
interface SearchTest extends Finding {
  offset: number;
  mask: number;
  set: boolean;
}
const flagTest = (member: string, t: SearchTest): Predicate => ({
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
function searchTests(report: BehaviourReport, routine: number, header: number): SearchTest[] | undefined {
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
        if (!outcome.effectsComplete || outcome.confidence === "unresolved") continue;
        const member = outcome.object;
        const writes = outcome.fields.filter((f) => f.object === member);
        if (!writes.length || writes.length !== outcome.fields.length) continue;
        const memberTerms: Predicate[] = [];
        let open = false;
        for (const term of terms(outcome.condition)) {
          const { objects: read, unknown } = objects(term);
          if (unknown || term.kind === "unknown") open = true;
          else if ([...read].every((o) => o === member)) memberTerms.push(term);
          // The source's own tests, like the explosion going to frame 2, don't concern this part.
          else if (![...read].every((o) => o === "part")) open = true;
        }
        const types = new Set(memberTerms.flatMap((term) => namedType(term, member, typeOffset) ?? []));
        // Without a named type, every test the search makes on the member must be known: like the candle's first
        // search, which keeps only parts with 0x0004 in field 0x0a.
        const search =
          types.size || member === "collider"
            ? undefined
            : searchTests(report, callback.address, "header" in outcome ? outcome.header : 0);
        if (open || (!types.size && !search)) continue;
        candidates.push({
          sourceType: source.type,
          sourcePart: source.id,
          routine: callback.address,
          member,
          outcome,
          writes,
          memberTerms,
          types,
          touch: member === "collider",
          ...(search ? { search } : {}),
        });
      }
    }

  for (const part of report.parts) {
    const hits = new Map<string, { hit: PartHit; tests: Predicate[]; touch: boolean; others: FieldWrite[][] }>();
    const assumptions = new Set<string>();
    const fixed = startingFlags && (startingFlags.values[part.type]! & FIXED_TYPE) !== 0;
    const known = (member: string) =>
      fixed ? [{ object: member, offset: LIST_FLAGS, width: 16, value: 0, knownMask: MOVING_LIST }] : [];
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
        byFixedList = false;
      // The source's code must name this part's type: a search may hold parts the source never acts on. Or, when it
      // names none, the program must give this type every flag the search needs: from the factory's table for the
      // type, or from its constructor. The walk still keeps the search's tests, since a part may lose a flag.
      if (c.types.size ? !c.types.has(part.type) : c.search!.some((t) => t.set && !gives(part.type, t))) continue;
      const searchTerms = (c.search ?? []).map((t) => flagTest(c.member, t));
      for (const term of [...c.memberTerms, ...searchTerms]) {
        const typed = predicateForType(term, c.member, typeOffset, part.type, report.typeTable, used);
        const value = evaluate(typed, known(c.member));
        if (value === true) continue;
        const flag = listFlagWords(typed, c.member);
        if (value === false) {
          // Ruled out by the decided assumption only when no other test rules it out too.
          if (flag && fixed && possible) byFixedList = true;
          else {
            possible = false;
            byFixedList = false;
          }
          continue;
        }
        if (readsTable(typed)) possible = false;
        kept.push(renamePredicate(typed, c.member, "part"));
      }
      if (!possible) continue;
      const changes = c.writes.filter(readsField);
      // Only a number in a field the rules read gives the walk something to follow.
      if (!changes.length || changes.some((w) => w.value.kind !== "constant" || w.directedSpeed)) continue;
      if (byFixedList) {
        assumptions.add(FIXED_LIST_ASSUMPTION);
        continue;
      }
      const asPart = (w: FieldWrite): FieldWrite => ({
        ...w,
        object: "part",
        condition: { kind: "true" },
      });
      const sortedChanges = changes.map(asPart).sort((a, b) => a.offset - b.offset);
      const key = JSON.stringify([c.touch, sortedChanges.map((w) => [w.offset, w.width, w.value])]);
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
      ];
      const others = c.writes.filter((w) => !readsField(w)).map(asPart);
      const prior = hits.get(key);
      if (prior) {
        const hit = prior.hit;
        if (!hit.sources.some((s) => s.type === c.sourceType && s.routine === c.routine))
          hit.sources.push({ type: c.sourceType, part: c.sourcePart, routine: c.routine });
        hit.evidence = uniqueEvidence([...hit.evidence, ...evidence]);
        // A walk for several paths starts from what they all need: the tests every one of them makes.
        prior.tests = prior.tests.filter((t) => kept.some((u) => JSON.stringify(u) === JSON.stringify(t)));
        hit.assumptions = [...new Set([...hit.assumptions, ...proof])];
        prior.others.push(others);
        continue;
      }
      hits.set(key, {
        tests: kept,
        hit: {
          sources: [{ type: c.sourceType, part: c.sourcePart, routine: c.routine }],
          writes: sortedChanges,
          condition: { kind: "true" },
          conditionWords: [],
          name: "",
          confidence: c.outcome.confidence,
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
    const list = [...hits.values()].map(({ hit, tests, touch, others }) => {
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
      return hit;
    });
    if (list.length || assumptions.size) result.set(part.type, { hits: list, assumptions: [...assumptions] });
  }
  return result;
}
