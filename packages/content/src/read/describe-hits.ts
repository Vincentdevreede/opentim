/**
 * What other parts do to a part that can change its frame, like the explosion setting a balloon's control value to 1 or
 * starting a mouse motor: these become trigger walks of the part, "hit by an explosion". Each comes from a proved
 * per-member outcome of another part's routine, worked out for this part's type. Only outcomes that write a field the
 * part's own rules read get a walk, and only when each such field gets a number. Outcomes that leave the part's
 * fields the same way, under the same tests of the part, share one walk, whichever part and path they come from.
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
        if (open || !types.size) continue;
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
      // The source's code must name this part's type: a search may hold parts the source never acts on.
      if (!c.types.has(part.type)) continue;
      for (const term of c.memberTerms) {
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
      const evidence = uniqueEvidence([...c.outcome.evidence, ...c.writes.flatMap((w) => w.evidence)]);
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
