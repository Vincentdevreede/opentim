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
  "A type record keeps the words it has in the program while a level runs, so a word the code reads from it, like the mass at +0x02, is the one in TIM.EXE. The frame list word at +0x14 is left out: the game sets it when it loads a part's pictures and clears it when it frees them.";
/** The word of a type record the game writes while it runs: the frame list, set and cleared with a part's pictures. */
export const TYPE_RECORD_WRITTEN = [0x14];

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
    // The game writes this word while it runs (0x107dc and 0x1084c in Even More), so the program's word isn't it.
    if (TYPE_RECORD_WRITTEN.includes(at % table.stride)) return e;
    used.table = true;
    return constant(record[(at % table.stride) / 2]!);
  }
  return e;
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
export const nameOf = (id: string) => id.replace(/-/g, " ");
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
  if (!outcome.effectsComplete || outcome.confidence === "unresolved") return undefined;
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
    if (unknown || term.kind !== "compare") return undefined;
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
  const startingFlags = report.helpers
    ?.find((h) => h.kind === "part-factory")
    ?.factory?.startingWords?.find((w) => w.field === LIST_FLAGS);

  const fieldName = (offset: number) => fieldNames.get(offset) ?? `field 0x${offset.toString(16).padStart(2, "0")}`;
  /** A value of the part's own fields in words, like "subtracts 1 from velocityX" or "halves velocityX, rounding down". */
  const settingWords = (offset: number, value: Expression) => {
    const field = fieldName(offset);
    const own = (e: Expression) => e.kind === "field" && e.object === "part" && e.offset === offset && e.width === 16;
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
      if (w.value.kind === "constant" && !w.directedSpeed) {
        sets.push({ kind: "field", offset: w.offset, width: w.width, value: w.value.value });
        continue;
      }
      if (!w.directedSpeed) {
        // A value worked out from the part's own fields, as a touch can set: like halving its velocityX.
        const value = rename(w.value, member, "part");
        sets.push({
          kind: "expression",
          offset: w.offset,
          width: w.width,
          value,
          words: settingWords(w.offset, value),
        });
        continue;
      }
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
      longs.set(
        low,
        `sets the long at 0x${low.offset.toString(16).padStart(2, "0")} to ${formula(part.word, { field: fieldName, of: (_, what) => what })} × ${2 ** part.shift}`,
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
          confidence: c.outcome.confidence,
          assumptions: new Set([
            ...c.outcome.assumptions,
            ...c.writes.flatMap((w) => w.assumptions),
            ...(used.table ? [TYPE_TABLE_ASSUMPTION] : []),
            ...settings.proofs,
          ]),
          evidence: uniqueEvidence([...c.outcome.evidence, ...c.writes.flatMap((w) => w.evidence)]),
        },
      });
    }
    const lines: OtherPartEffect[] = [];
    const rank: Record<Confidence, number> = { checked: 0, inferred: 1, unresolved: 2 };
    for (const group of groups.values())
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
          if ([...test.objects].every((o) => o === TOUCHER)) {
            const own = test.predicates.map((p) => renamePredicate(p, TOUCHER, "part"));
            toucher.push(...own);
            const drawn = own.length === 1 ? drawingFlagWords(own[0]!, report) : undefined;
            toucherWords.push(drawn ? `it is ${drawn}` : test.words(both));
          } else if ([...test.objects].every((o) => o === "part")) {
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
          description: `${article(name)} ${name} it touches${when} ${said.join(" and ")}.${only}${response}`,
          confidence: value.confidence,
          assumptions: [
            ...new Set([
              ...value.assumptions,
              ...(velocityDirection ? [SCREEN_DIRECTION_ASSUMPTION] : []),
              TOUCH_ASSUMPTION,
            ]),
          ],
          evidence: value.evidence,
        });
      }
    return lines;
  };
  const candidates: Candidate[] = [];
  const touches: TouchCandidate[] = [];
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
        byList = false;
      for (const term of c.memberTerms) {
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
        if (!flag) decided = false;
        conditionTerms.push(renamePredicate(typed, c.member, "part"));
        words.push(flag ?? "");
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
        ...(velocityDirection ? { velocityDirection } : {}),
        description,
        confidence: c.outcome.confidence,
        assumptions: [
          ...new Set([
            ...c.outcome.assumptions,
            ...c.writes.flatMap((w) => w.assumptions),
            ...(used.table ? [TYPE_TABLE_ASSUMPTION] : []),
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
