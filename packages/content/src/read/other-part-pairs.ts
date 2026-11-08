/**
 * Which part types can do something to which, as the code allows it, and where each pair is described (step C2 of
 * docs/behaviour-plan.md). Three ways reach another part:
 *
 * - a touch: the contact dispatch calls the bounce callback of the touched part's type with the moving part that
 *   touched it (`collider`), so a bounce's writes to `collider` are what the touched part does to the toucher;
 * - an overlap list: a run walks the parts its search found and writes some of them (the explosion, the candle and
 *   rocket lighting, the jack-in-the-box's punch, the vacuum cleaner and others), read as per-member outcomes;
 * - a list consumer: a run hands a fresh search's list to a helper that writes its members, like the teeter-totter's
 *   ends. The helper is read path by path for one member, and the run puts in its arguments at each call.
 *
 * A pair is allowed when one path of the source's code writes the part, or may write it, and the path's tests of the
 * part's type (with the type table) don't rule its type out. It is then described (a line or a walk in the part's
 * "From other parts"), ruled out by a decided assumption, or missing with the reason the description can't say it yet.
 * The searches themselves also write the found list's link and scratch words on every part they find; those are
 * counted apart.
 */
import type { BehaviourReport, Expression, FieldWrite, Predicate, RoutineOutcome } from "./behaviour.ts";
import { callKinds, openCalls, SIZE_BUDGET_REACHED } from "./behaviour.ts";
import {
  effectsFromOthers,
  type Evaluate,
  FIXED_LIST_ASSUMPTION,
  MOVING_SEARCH_ASSUMPTION,
  MADE_FIXED_ASSUMPTION,
  FIXED_TYPE,
  LIST_FLAGS,
  objects,
  offMovingList,
  onlyAnswersOpen,
  partFields,
  predicateForType,
  settleForType,
  withOwnOverlapsIn,
  afterQueriesIn,
  sourceRun,
  readsAnswer,
  readsTableBesidesSpeedLimit,
  terms,
} from "./describe-effects.ts";
import {
  hitsFromOthers,
  isLightableTest,
  LIGHTABLE,
  LIGHTABLE_ASSUMPTION,
  LIGHTABLE_PARTS,
  placeTest,
  searchTests,
  madeIntoFixedList,
  searchesOnlyMovingList,
} from "./describe-hits.ts";

export type PairWay = "touch" | "overlap list" | "list consumer";
export interface OtherPartPair {
  sourceType: number;
  sourcePart: string;
  targetType: number;
  targetPart: string;
  way: PairWay;
  /** The source's callback. */
  routine: number;
  /** The paths of the source's code that allow the pair. */
  paths: number;
  /** The target's fields those paths write, by offset. */
  fields: number[];
  status: "described" | "partly described" | "ruled out" | "missing";
  /** For a described pair: lines and walks in the target's "From other parts". */
  lines: number;
  walks: number;
  /** Fields the allowed paths write that no line or walk of this pair names. */
  undescribedFields: number[];
  /** For a pair ruled out or missing, or the paths a partly described pair leaves out: why, one per reason. */
  reasons: string[];
}
/** A source whose search writes the found list's fields on every part it finds. */
export interface FoundListWrites {
  sourceType: number;
  sourcePart: string;
  routine: number;
  /** The query's address and the fields it writes on a found part. */
  queries: { call: number; helper: number; fields: number[] }[];
  /** Part types whose own rules read one of these fields at the start of a run. */
  readBy: string[];
}
/** A run that hands a search's list to a helper whose per-member effects the analysis doesn't read. */
export interface UnreadConsumer {
  sourceType: number;
  sourcePart: string;
  routine: number;
  consumer: number;
  calls: number[];
  /** The member fields the helper may write. */
  fields: number[];
}
export interface OtherPartPairs {
  pairs: OtherPartPair[];
  foundLists: FoundListWrites[];
  consumers: UnreadConsumer[];
  /** Bounce paths only a self call can take (the part's type is never the touched part's there), by source. */
  selfCallPaths: { sourcePart: string; paths: number }[];
}

export const NO_COMPLETE_EFFECTS = "the path's effects aren't complete, so the analysis doesn't know all it writes";
export const UNRESOLVED_PATH = "the path is unresolved: a test or value on it isn't read";
export const SEARCH_UNREAD =
  "its rules read a field the source sets, so it needs a walk, and a walk needs the source to name the part's type or the tests its search makes on the part, which aren't read for this search";
export const CONTACT_SEARCH =
  "the source runs the contact search on the part: where that leaves the part, with its contact record and list flags, only the run knows";
export const OTHER_OBJECTS = "the same path also writes another object, which a line or walk of one part can't say";
export const OPEN_TEST = "a test depends on something besides the two parts' own fields, like where the part is";
export const DIRECTED_RULE_FIELD =
  "its rules read the velocity it sets, whose direction depends on where the two parts are, so a walk can't follow it";
export const UNKNOWN_VALUE = "a value it sets isn't known to the analysis";
export const HELPER_VALUE =
  "a value it sets comes from a helper the source calls on the part, whose tests the analysis doesn't carry into the loop";
export const BUDGET_VALUE = "a value it sets grew past the size the analysis keeps for one value";
export const OPEN_VALUE = "a value it sets reads something besides the two parts' fields";
export const SOURCE_VALUE = "a value it sets depends on the source's own fields, like where the source is";
export const TABLE_VALUE =
  "a value it sets reads a table word the part's type doesn't settle, like one picked by an angle";
export const RESPONSE_FIELDS = "a contact response after the bounce may change every field the part's rules read";
export const LIMIT_RULE_FIELD =
  "its rules read a velocity the source keeps within the part's speed limit, a word the game works out for each level, so a walk can't follow it";
export const UNDECIDED_TEST =
  "a test of the part's own fields isn't settled by its type, and the source names no type and its search's flag tests aren't all read";
export const UNCLASSIFIED = "not described, for a reason this check doesn't name";
export const CONSUMER_UNREAD =
  "the helper that walks the list is read only as a footprint (which member fields it may write), not path by path";

const hex = (n: number) => `0x${n.toString(16)}`;
/** A test that reads no object and no unknown, like `7 >=s 7`: its value is the same on every run. */
const constantTest = (term: Predicate) => {
  const read = objects(term);
  return term.kind === "compare" && !read.unknown && !read.objects.size;
};
const bytesOf = (w: { offset: number; width: number }) => [...Array(w.width / 8).keys()].map((b) => w.offset + b);

interface Path {
  sourceType: number;
  sourcePart: string;
  routine: number;
  way: PairWay;
  member: string;
  outcome: (RoutineOutcome | NonNullable<BehaviourReport["routines"][number]["iterationOutcomes"]>[number]) & {
    fields: FieldWrite[];
  };
  writes: FieldWrite[];
  memberTerms: Predicate[];
  header?: number;
  /** Set when the way comes from reading the loop for one type of found part: it holds only for that type. */
  onlyType?: number;
}

/**
 * Every (source, target) pair the code allows, with where it is described. `evaluate` tests a condition against known
 * fields, as the walks do.
 */
export function otherPartPairs(report: BehaviourReport, evaluate: Evaluate): OtherPartPairs {
  const typeOffset = report.layout.fields.find((f) => f.name === "type")?.offset;
  const stateOffset = report.layout.fields.find((f) => f.name === "state")?.offset;
  const result: OtherPartPairs = { pairs: [], foundLists: [], consumers: [], selfCallPaths: [] };
  if (typeOffset === undefined || stateOffset === undefined) return result;
  const routines = new Map(report.routines.map((r) => [r.address, r]));
  const helpers = new Map((report.helpers ?? []).map((h) => [h.address, h]));
  const startingFlags = report.helpers
    ?.find((h) => h.kind === "part-factory")
    ?.factory?.startingWords?.find((w) => w.field === LIST_FLAGS);
  const fixed = (type: number) => !!startingFlags && (startingFlags.values[type]! & FIXED_TYPE) !== 0;
  const effects = effectsFromOthers(report, evaluate);
  const hits = hitsFromOthers(report, evaluate);
  /** The fields each part's own rules read, its state included. */
  const ruleFields = new Map(
    report.parts.map((part) => {
      const read = new Set<number>([stateOffset]);
      for (const rule of part.transitions) {
        partFields(rule.condition, read);
        partFields(rule.to, read);
      }
      return [part.type, read];
    }),
  );
  const typed = (term: Predicate, object: string, type: number) =>
    predicateForType(term, object, typeOffset, type, report.typeTable, { table: false });

  const paths: Path[] = [];
  for (const source of report.parts)
    for (const callback of source.routines) {
      if (callback.sharedDefault) continue;
      const code = routines.get(callback.address);
      if (!code) continue;
      const add = (way: PairWay, member: string, outcome: Path["outcome"], header?: number, onlyType?: number) => {
        const writes = outcome.fields.filter((f) => f.object === member);
        if (!writes.length && outcome.effectsComplete) return;
        // A constant test that fails, like `0 != 0`, means the code never takes the path.
        if (terms(outcome.condition).some((term) => constantTest(term) && evaluate(term, []) === false)) return;
        const memberTerms = terms(outcome.condition)
          .map((term) => withOwnOverlapsIn(term, member))
          .filter((term) => {
            const read = objects(term);
            return !read.unknown && read.objects.size === 1 && read.objects.has(member);
          });
        paths.push({
          sourceType: source.type,
          sourcePart: source.id,
          routine: callback.address,
          way,
          member,
          outcome,
          writes,
          memberTerms,
          ...(header === undefined ? {} : { header }),
          ...(onlyType === undefined ? {} : { onlyType }),
        });
      };
      // A loop read for each type of found part gives each type's own ways, in place of the generic ones.
      if (code.iterationOutcomesByType)
        for (const [type, list] of Object.entries(code.iterationOutcomesByType))
          for (const outcome of list)
            add(
              outcome.listConsumer ? "list consumer" : "overlap list",
              outcome.object,
              outcome,
              outcome.header,
              Number(type),
            );
      else
        for (const outcome of code.iterationOutcomes ?? [])
          add(outcome.listConsumer ? "list consumer" : "overlap list", outcome.object, outcome, outcome.header);
      if (callback.slot === 0) {
        let selfOnly = 0;
        for (const outcome of code.outcomes ?? []) {
          // A path whose tests of the touched part (`part`) fail for the source's own type is never taken when the
          // source is the touched part: only a self call, where `part` is what the toucher touched, takes it.
          const own = terms(outcome.condition).filter((term) => {
            const read = objects(term);
            return !read.unknown && read.objects.size === 1 && read.objects.has("part");
          });
          if (own.some((term) => evaluate(typed(term, "part", source.type), []) === false)) {
            if (outcome.fields.some((f) => f.object === "collider")) selfOnly++;
            continue;
          }
          add("touch", "collider", outcome);
        }
        if (selfOnly) result.selfCallPaths.push({ sourcePart: source.id, paths: selfOnly });
      }
      // The searches the run makes write the found list's fields on every part they find.
      const queries: FoundListWrites["queries"] = [];
      const consumerCalls = new Map<number, number[]>();
      for (const call of code.engineCalls ?? []) {
        const helper = helpers.get(call.summary);
        if (helper?.kind === "overlap-list")
          queries.push({
            call: call.instruction,
            helper: helper.address,
            fields: [
              ...new Set(
                helper.writes
                  .filter((w) => w.selection === "overlap-candidate" && !w.path?.length)
                  .map((w) => w.offset),
              ),
            ].sort((a, b) => a - b),
          });
        // A consumer read path by path gives its members' outcomes to the run, above.
        if (helper?.listConsumer && !helper.listConsumer.memberOutcomes)
          consumerCalls.set(helper.address, [...(consumerCalls.get(helper.address) ?? []), call.instruction]);
      }
      if (queries.length) {
        const fields = new Set(queries.flatMap((q) => q.fields.flatMap((offset) => [offset, offset + 1])));
        result.foundLists.push({
          sourceType: source.type,
          sourcePart: source.id,
          routine: callback.address,
          queries,
          readBy: report.parts.filter((p) => [...ruleFields.get(p.type)!].some((f) => fields.has(f))).map((p) => p.id),
        });
      }
      for (const [consumer, calls] of consumerCalls) {
        const contract = helpers.get(consumer)!.listConsumer!;
        result.consumers.push({
          sourceType: source.type,
          sourcePart: source.id,
          routine: callback.address,
          consumer,
          calls: calls.sort((a, b) => a - b),
          fields: [...new Set(contract.fields.filter((f) => f.root === "member").map((f) => f.offset))].sort(
            (a, b) => a - b,
          ),
        });
      }
    }

  /** Why a value isn't known: a helper's effect on the part, the size budget, or else no reason this check names. */
  const unknownReason = (value: Expression): string => {
    const reasons = new Set<string>();
    const visit = (v: Expression): void => {
      if (v.kind === "unknown") reasons.add(v.reason);
      else if (v.kind === "field" && v.unresolved) reasons.add("");
      else if (v.kind === "binary") {
        visit(v.left);
        visit(v.right);
      } else if (v.kind === "table") visit(v.index);
    };
    visit(value);
    const all = (test: (reason: string) => boolean) => reasons.size > 0 && [...reasons].every(test);
    if (all((r) => r === SIZE_BUDGET_REACHED)) return BUDGET_VALUE;
    if (all((r) => /^Conditional .+ effect on field /.test(r) && !/^Conditional contact-search /.test(r)))
      return HELPER_VALUE;
    return UNKNOWN_VALUE;
  };
  /** Whether a path's tests name the part's type, like the jack-in-the-box's `type == 0x15` for the switch. */
  const namesType = (path: Path) =>
    path.memberTerms.some(
      (t) =>
        t.kind === "compare" &&
        t.operator === "==" &&
        t.left.kind === "field" &&
        t.left.object === path.member &&
        t.left.offset === typeOffset,
    );
  /** Why a path the description leaves out for this part isn't said, when no decided assumption rules it out. */
  const missingReason = (path: Path, type: number): string => {
    const { outcome, way, member } = path;
    const touch = way === "touch";
    // A loop's test of where the member lies from the source is said in words.
    const placed = (term: Predicate) => !touch && placeTest(term, member) !== undefined;
    if (!outcome.effectsComplete) return NO_COMPLETE_EFFECTS;
    const kindAt = callKinds(report, path.routine);
    // A loop's way the lines read: open only at the overlap its search stored, the source's rope pull or the contact
    // search it runs on the part.
    const open =
      way === "overlap list" && "scope" in outcome
        ? openCalls([outcome.condition, ...outcome.fields.flatMap((f) => [f.value, f.condition])], kindAt)
        : undefined;
    if (
      outcome.confidence === "unresolved" &&
      !(touch && onlyAnswersOpen(outcome)) &&
      !(open && !open.other) &&
      !(
        way === "list consumer" &&
        terms(outcome.condition).every((t) => placed(t) || !objects(t).unknown) &&
        outcome.fields.every((f) => !objects(f.value).unknown)
      )
    )
      return UNRESOLVED_PATH;
    if (outcome.fields.some((f) => f.object !== member && !(touch && f.object === "part"))) return OTHER_OBJECTS;
    for (const term of terms(outcome.condition).map((t) =>
      afterQueriesIn(withOwnOverlapsIn(t, path.member), member, kindAt),
    )) {
      // What the source's rope pull answers, and its own fields after it, are the source's tests.
      if (!touch && sourceRun(term, kindAt)) continue;
      const read = objects(term);
      if (touch && term.kind === "compare" && readsAnswer(term) && !read.objects.has(member)) continue;
      if (placed(term)) continue;
      // A constant test the conditions keep, like `1 != 0`, reads no object: when it holds it says nothing.
      if (constantTest(term) && evaluate(term, []) === true) continue;
      if (read.unknown || term.kind === "unknown") return OPEN_TEST;
      const only = [...read.objects];
      // A loop's tests may read the source or the member, a bounce's both together.
      if (only.every((o) => o === member || o === "part") && (touch || only.length === 1)) continue;
      return OPEN_TEST;
    }
    const read = ruleFields.get(type)!;
    const readsRule = (w: FieldWrite) => bytesOf(w).some((b) => read.has(b));
    const writes = [...path.writes].sort((a, b) => Number(readsRule(b)) - Number(readsRule(a)));
    // A field the contact search leaves open gives its reason only when no other write has one.
    let searched = false;
    for (const w of writes) {
      if (w.directedSpeed) {
        if (readsRule(w)) return DIRECTED_RULE_FIELD;
        continue;
      }
      // The value as the line says it: the overlap its search stored, the type's words and the part's speed limit.
      const { value: settled, kept } = settleForType(w.value, member, typeOffset!, type, report.typeTable, {
        table: false,
      });
      const value = objects(settled);
      if (value.unknown) {
        const left = openCalls([w.value], kindAt);
        if (!left.other && !left.connectionQuery && left.contactSearch) {
          searched = true;
          continue;
        }
        return unknownReason(w.value);
      }
      // A field its rules read needs a walk, which needs the part's type named or its search's tests read.
      if (
        readsRule(w) &&
        way === "overlap list" &&
        !namesType(path) &&
        !searchTests(report, path.routine, path.header ?? 0)
      )
        return SEARCH_UNREAD;
      if ([...value.objects].some((o) => o !== member && o !== "part")) return OPEN_VALUE;
      if (value.objects.has("part")) return SOURCE_VALUE;
      if (readsTableBesidesSpeedLimit(settled, type, report.typeTable)) return TABLE_VALUE;
      if (kept && readsRule(w)) return LIMIT_RULE_FIELD;
    }
    if (searched) return CONTACT_SEARCH;
    if (
      touch &&
      "returnValue" in outcome &&
      !(outcome.returnValue.kind === "constant" && outcome.returnValue.value === 0) &&
      path.writes.some(readsRule)
    )
      return RESPONSE_FIELDS;
    if (way !== "touch") return UNDECIDED_TEST;
    return UNCLASSIFIED;
  };

  const groups = new Map<string, { path: Path; type: number; ruled: Set<string>; reasons: Set<string> }[]>();
  for (const path of paths)
    for (const target of report.parts) {
      // A test of the part's type, or of a type table word, that fails for this type: the code never does it.
      if (path.onlyType !== undefined && path.onlyType !== target.type) continue;
      if (path.memberTerms.some((term) => evaluate(typed(term, path.member, target.type), []) === false)) continue;
      const ruled = new Set<string>();
      // The contact dispatch walks the moving list: a part of a fixed type never touches, by a decided assumption.
      if (path.way === "touch" && fixed(target.type)) ruled.add(FIXED_LIST_ASSUMPTION);
      // Nor does an explosion, and no search of the moving list finds one, by another.
      if (
        madeIntoFixedList(report).has(target.type) &&
        (path.way === "touch" ||
          (path.way === "overlap list" &&
            path.header !== undefined &&
            searchesOnlyMovingList(report, path.routine, path.header)))
      )
        ruled.add(MADE_FIXED_ASSUMPTION);
      // A search that walks only the moving list never finds one either, by a decided assumption.
      if (
        path.way === "overlap list" &&
        path.header !== undefined &&
        fixed(target.type) &&
        searchesOnlyMovingList(report, path.routine, path.header)
      )
        ruled.add(MOVING_SEARCH_ASSUMPTION);
      const offList = offMovingList(target, startingFlags);
      const lightable = LIGHTABLE_PARTS.has(target.id);
      const known = [
        ...(offList ? [{ object: path.member, offset: LIST_FLAGS, width: 16, value: 0, knownMask: 0x1000 }] : []),
        {
          object: path.member,
          ...LIGHTABLE,
          width: 16,
          value: lightable ? LIGHTABLE.mask : 0,
          knownMask: LIGHTABLE.mask,
        },
      ];
      for (const term of path.memberTerms) {
        const value = typed(term, path.member, target.type);
        if (offList && evaluate(value, known.slice(0, 1)) === false) ruled.add(offList);
        else if (evaluate(value, known) === false) ruled.add(LIGHTABLE_ASSUMPTION);
      }
      // Without a named type, the search that filled the list keeps only parts with its flags.
      if (path.way === "overlap list" && path.header !== undefined) {
        const named = path.memberTerms.some(
          (t) =>
            t.kind === "compare" &&
            t.operator === "==" &&
            t.left.kind === "field" &&
            t.left.object === path.member &&
            t.left.offset === typeOffset,
        );
        const tests = named ? [] : (searchTests(report, path.routine, path.header) ?? []);
        if (tests.some((t) => t.set && isLightableTest(t)) && !lightable) ruled.add(LIGHTABLE_ASSUMPTION);
      }
      const key = `${path.sourceType}:${target.type}:${path.routine}:${path.way}`;
      const list = groups.get(key) ?? [];
      groups.set(key, list);
      list.push({ path, type: target.type, ruled, reasons: new Set() });
    }

  for (const list of groups.values()) {
    const { path, type } = list[0]!;
    const target = report.parts.find((p) => p.type === type)!;
    const open = list.filter((item) => !item.ruled.size);
    // Lines come from a touch or the run's own list, never from a consumer: a line of the same run's list doesn't
    // describe what its consumer does.
    const lines = (effects.get(type)?.effects ?? []).filter(
      (e) =>
        e.sourceType === path.sourceType &&
        e.routine === path.routine &&
        path.way !== "list consumer" &&
        (e.touch !== undefined) === (path.way === "touch"),
    );
    // A consumer's walks name it, apart from the run's own list.
    const walks = (hits.get(type)?.hits ?? []).filter((h) =>
      h.sources.some(
        (s) =>
          s.type === path.sourceType &&
          s.routine === path.routine &&
          (s.consumer !== undefined) === (path.way === "list consumer"),
      ),
    );
    const fields = [...new Set(open.flatMap((item) => item.path.writes.map((w) => w.offset)))].sort((a, b) => a - b);
    const said = new Set<number>();
    for (const line of lines)
      for (const set of line.sets)
        for (const offset of set.kind === "speed" ? set.fields : [set.offset]) said.add(offset);
    for (const walk of walks) for (const w of walk.writes) said.add(w.offset);
    const described = lines.length + walks.length > 0;
    const undescribedFields = described ? fields.filter((f) => !said.has(f)) : [];
    // A described pair whose other paths write fields no line or walk names is described in part: those paths' reasons.
    const unsaid = open.filter((item) => item.path.writes.some((w) => undescribedFields.includes(w.offset)));
    const reasons = described
      ? [...new Set(unsaid.map((item) => missingReason(item.path, type)))]
      : open.length
        ? [...new Set(open.map((item) => missingReason(item.path, type)))]
        : [...new Set(list.flatMap((item) => [...item.ruled]))];
    result.pairs.push({
      sourceType: path.sourceType,
      sourcePart: path.sourcePart,
      targetType: type,
      targetPart: target.id,
      way: path.way,
      routine: path.routine,
      paths: list.length,
      fields,
      status: described
        ? undescribedFields.length
          ? "partly described"
          : "described"
        : open.length
          ? "missing"
          : "ruled out",
      lines: lines.length,
      walks: walks.length,
      undescribedFields,
      reasons,
    });
  }
  result.pairs.sort(
    (a, b) =>
      a.sourcePart.localeCompare(b.sourcePart) ||
      a.way.localeCompare(b.way) ||
      a.targetPart.localeCompare(b.targetPart) ||
      a.routine - b.routine,
  );
  return result;
}

/** The pairs as text, by source: which targets, how, and where each one is described. */
export function renderOtherPartPairs(pairs: OtherPartPairs): string {
  const lines: string[] = [];
  const bySource = new Map<string, OtherPartPair[]>();
  for (const pair of pairs.pairs) {
    const key = `${pair.sourcePart} ${pair.way} ${hex(pair.routine)}`;
    bySource.set(key, [...(bySource.get(key) ?? []), pair]);
  }
  const count = (status: OtherPartPair["status"]) => pairs.pairs.filter((p) => p.status === status).length;
  lines.push(
    `Pairs: ${pairs.pairs.length} allowed, ${count("described")} described, ${count("partly described")} partly described, ${count("ruled out")} ruled out, ${count("missing")} missing`,
  );
  for (const [source, list] of bySource) {
    lines.push(`${source}:`);
    for (const status of ["described", "partly described", "ruled out", "missing"] as const) {
      const items = list.filter((p) => p.status === status);
      if (!items.length) continue;
      const names = items.map(
        (p) =>
          `${p.targetPart}${p.lines + p.walks ? ` (${p.lines} lines, ${p.walks} walks${p.undescribedFields.length ? `; not named: ${p.undescribedFields.map(hex).join(" ")}` : ""})` : ""}`,
      );
      lines.push(`  ${status} (${items.length}): ${names.join(", ")}`);
      if (status !== "described")
        for (const reason of new Set(items.flatMap((p) => p.reasons)))
          lines.push(
            `    ${reason}: ${items
              .filter((p) => p.reasons.includes(reason))
              .map((p) => p.targetPart)
              .join(", ")}`,
          );
    }
  }
  for (const c of pairs.consumers)
    lines.push(
      `${c.sourcePart} list consumer ${hex(c.consumer)} (calls ${c.calls.map(hex).join(" ")}): member fields ${c.fields.map(hex).join(" ")}; ${CONSUMER_UNREAD}`,
    );
  for (const f of pairs.foundLists)
    lines.push(
      `${f.sourcePart} found list: ${f.queries.map((q) => `${hex(q.call)} writes ${q.fields.map(hex).join(" ")}`).join("; ")}; read by the rules of ${f.readBy.length ? f.readBy.join(", ") : "no part"}`,
    );
  for (const s of pairs.selfCallPaths) lines.push(`${s.sourcePart}: ${s.paths} bounce paths only a self call takes`);
  return lines.join("\n");
}
