/**
 * What other parts do to a part without changing its frame, like the explosion's push: a short line on the part's
 * description instead of a walk. Each line comes from a proved per-member outcome of another part's routine, worked
 * out for this part's type. A line is only made when the outcome's condition on the member is decided by the type
 * alone, apart from which list the part is on, and when every field it sets gets a number. An outcome that sets the
 * part's state, or a field the part's own rules read, can change its frame: walks are the place for that, so it gets
 * no line here.
 */
import type { BehaviourReport, Evidence, Expression, FieldWrite, Finding, Predicate } from "./behaviour.ts";
import type { KnownField } from "./describe-behaviour.ts";

/**
 * The list flags of a part at `0x06`: the routine that puts a part on a list (`0x6469` in Even More, English floppy)
 * gives it `0x1000` and the moving list when its starting flags lack `0x4000`, and `0x2000` and the fixed list
 * otherwise.
 */
const LIST_FLAGS = 0x06;
const MOVING_LIST = 0x1000;
const FIXED_LIST = 0x2000;
const FIXED_TYPE = 0x4000;

export const FIXED_LIST_ASSUMPTION =
  "A part of a type whose starting flags have 0x4000 is never on the moving list: its list flags at 0x06 never have 0x1000. The game puts such a part on the fixed list, and no shipped level saves one with 0x1000.";
const TYPE_TABLE_ASSUMPTION =
  "A type record keeps the words it has in the program while a level runs, so a word the code reads from it, like the mass at +0x02, is the one in TIM.EXE.";

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
    }
  | { kind: "field"; offset: number; width: number; value: number };

export interface OtherPartEffect extends Finding {
  sourceType: number;
  sourcePart: string;
  routine: number;
  /** What the source part's own fields must be, with `part` the source: like the explosion going to frame 2. */
  sourceCondition: Predicate;
  /** The tests of `sourceCondition` that have a name, in a few words, like "mirrored". */
  sourceConditionWords: string[];
  sets: OtherPartSetting[];
  /** What must hold for this part as well, with `part` this part: like being on the moving list. */
  condition: Predicate;
  /** `condition` in a few words, like "on the moving list". */
  conditionWords: string[];
  description: string;
}

type Evaluate = (
  condition: Predicate,
  fields: Pick<KnownField, "object" | "offset" | "width" | "value" | "knownMask">[],
) => boolean | undefined;

const constant = (value: number, width = 16): Expression => ({ kind: "constant", value, width });
const wrap = (value: number, width: number) => ((value % 2 ** width) + 2 ** width) % 2 ** width;
const terms = (predicate: Predicate): Predicate[] =>
  predicate.kind === "and" ? predicate.terms.flatMap(terms) : predicate.kind === "true" ? [] : [predicate];
const conjunction = (list: Predicate[]): Predicate =>
  list.length === 0 ? { kind: "true" } : list.length === 1 ? list[0]! : { kind: "and", terms: list };

/** The objects whose fields an expression reads, and whether it holds something unknown. */
function objects(value: Expression | Predicate, found = new Set<string>()): { objects: Set<string>; unknown: boolean } {
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
    return left === e.left && right === e.right ? e : { ...e, left, right };
  }
  if (e.kind === "table") {
    const index = numberOf(forType(e.index, member, typeOffset, type, table, used));
    if (index === undefined || !table || e.width !== 16) return e;
    const at = e.segment * 16 + wrap(e.offset + index, 16) - table.address;
    const record = table.words[Math.floor(at / table.stride)];
    if (at < 0 || at % 2 || !record || at % table.stride >= table.stride - 1) return e;
    used.table = true;
    return constant(record[(at % table.stride) / 2]!);
  }
  return e;
}
function predicateForType(
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
function listFlagWords(p: Predicate, member: string): string | undefined {
  if (p.kind !== "compare" || !["==", "!="].includes(p.operator)) return undefined;
  const { left, right } = p;
  if (right.kind !== "constant" || right.value !== 0 || left.kind !== "binary" || left.operator !== "&") return;
  const [flags, mask] = left.left.kind === "field" ? [left.left, left.right] : [left.right, left.left];
  if (flags.kind !== "field" || flags.object !== member || flags.offset !== LIST_FLAGS || mask.kind !== "constant")
    return undefined;
  const list = mask.value === MOVING_LIST ? "moving" : mask.value === FIXED_LIST ? "fixed" : undefined;
  return list && `${p.operator === "!=" ? "" : "not "}on the ${list} list`;
}

function rename(e: Expression, from: string, to: string): Expression {
  if (e.kind === "field" && e.object === from) return { ...e, object: to };
  if (e.kind === "binary") return { ...e, left: rename(e.left, from, to), right: rename(e.right, from, to) };
  if (e.kind === "table") return { ...e, index: rename(e.index, from, to) };
  return e;
}
const renamePredicate = (p: Predicate, from: string, to: string): Predicate =>
  p.kind === "compare"
    ? { ...p, left: rename(p.left, from, to), right: rename(p.right, from, to) }
    : p.kind === "and"
      ? { ...p, terms: p.terms.map((t) => renamePredicate(t, from, to)) }
      : p;

/** The part fields an expression reads, as offsets. */
function partFields(value: Expression | Predicate, found: Set<number>) {
  if (value.kind === "field" && value.object === "part") found.add(value.offset);
  else if (value.kind === "binary" || value.kind === "compare") {
    partFields(value.left, found);
    partFields(value.right, found);
  } else if (value.kind === "table") partFields(value.index, found);
  else if (value.kind === "and") value.terms.forEach((t) => partFields(t, found));
}

const uniqueEvidence = (list: Evidence[]) => [...new Map(list.map((e) => [e.address, e])).values()];
const nameOf = (id: string) => id.replace(/-/g, " ");
const article = (name: string) => (/^[aeiou]/.test(name) ? "An" : "A");

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
  const startingFlags = report.helpers
    ?.find((h) => h.kind === "part-factory")
    ?.factory?.startingWords?.find((w) => w.field === LIST_FLAGS);

  const candidates: Candidate[] = [];
  for (const source of report.parts)
    for (const callback of source.routines) {
      if (callback.sharedDefault) continue;
      for (const outcome of routines.get(callback.address)?.iterationOutcomes ?? []) {
        if (!outcome.effectsComplete || outcome.confidence === "unresolved") continue;
        const member = outcome.object;
        const writes = outcome.fields.filter((f) => f.object === member);
        if (!writes.length || writes.length !== outcome.fields.length) continue;
        // Every field set needs a number: a constant, or the speed the speed setter was given.
        if (writes.some((w) => !w.directedSpeed && w.value.kind !== "constant")) continue;
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
        candidates.push({
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
    }

  for (const part of report.parts) {
    const effects = new Map<string, OtherPartEffect>();
    const assumptions = new Set<string>();
    const fixed = startingFlags && (startingFlags.values[part.type]! & FIXED_TYPE) !== 0;
    const known = fixed
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
        byFixedList = false;
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
        if (!flag) decided = false;
        conditionTerms.push(renamePredicate(typed, c.member, "part"));
        words.push(flag ?? "");
      }
      if (!possible || !decided) continue;
      if (c.writes.some((w) => [...Array(w.width / 8).keys()].some((byte) => read.has(w.offset + byte)))) continue;
      const sets: OtherPartSetting[] = [];
      let numbered = true;
      for (const w of c.writes) {
        if (!w.directedSpeed) {
          sets.push({ kind: "field", offset: w.offset, width: w.width, value: (w.value as { value: number }).value });
          continue;
        }
        const speed = numberOf(forType(w.directedSpeed.speed, c.member, typeOffset, part.type, report.typeTable, used));
        if (speed === undefined) {
          numbered = false;
          break;
        }
        const prior = sets.find(
          (s): s is Extract<OtherPartSetting, { kind: "speed" }> =>
            s.kind === "speed" && s.setter === w.directedSpeed!.routine && s.speed === speed,
        );
        if (prior) prior.fields = [...prior.fields, w.offset].sort((a, b) => a - b);
        else sets.push({ kind: "speed", fields: [w.offset], speed, setter: w.directedSpeed.routine });
      }
      if (!numbered) continue;
      // A fixed type would get this line but for its list: the decided assumption keeps it off the moving list.
      if (byFixedList) {
        assumptions.add(FIXED_LIST_ASSUMPTION);
        continue;
      }
      const name = nameOf(c.sourcePart);
      const said = sets.map((s) => {
        if (s.kind === "speed") return `sets its speed to ${s.speed}, in a direction the ${name} works out`;
        const field = fieldNames.get(s.offset);
        // A velocity is a signed word.
        const value = field?.startsWith("velocity") && s.value >= 0x8000 ? s.value - 0x10000 : s.value;
        return `sets ${field ?? `+0x${s.offset.toString(16)}`} to ${value}`;
      });
      const when = c.sourceWords.length ? `, when the ${name} is ${c.sourceWords.join(" and ")},` : "";
      const description = `${article(name)} ${name} that reaches it${when} ${said.join(" and ")}.${words.length ? ` Only when it is ${words.join(" and ")}.` : ""}`;
      const key = JSON.stringify([c.routine, sets, conditionTerms]);
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
        description,
        confidence: c.outcome.confidence,
        assumptions: [
          ...new Set([
            ...c.outcome.assumptions,
            ...c.writes.flatMap((w) => w.assumptions),
            ...(used.table ? [TYPE_TABLE_ASSUMPTION] : []),
            "The part is in the source's overlap list and the source's own fields meet the source condition; that this happens in a level is not claimed.",
          ]),
        ],
        evidence,
      });
    }
    if (effects.size || assumptions.size)
      result.set(part.type, { effects: [...effects.values()], assumptions: [...assumptions] });
  }
  return result;
}
