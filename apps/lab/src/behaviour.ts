/**
 * The behaviour of the parts, read from `TIM.EXE` by `@opentim/content` without running it, made small enough to show
 * in the lab: findings keep their confidence and the addresses of their instructions, and expressions become text.
 */

import { choiceOf, describeGear } from "@opentim/content";
import type {
  AnimationDescription,
  BehaviourDescription,
  BehaviourReport,
  BehaviourWalk,
  Confidence,
  Evidence,
  Expression,
  FieldWrite,
  OtherPartEffect,
  PartBehaviour,
  Predicate,
  ProgramParts,
} from "@opentim/content";

/** An instruction a finding comes from, at its address in the unpacked program. */
export interface Instruction {
  address: number;
  text: string;
}

export interface Finding {
  confidence: Confidence;
  assumptions: string[];
  evidence: Instruction[];
}

/** A routine of the part, from one of the six code pointers in its record. */
export interface Routine extends Finding {
  /** What the routine is likely for, like `run`; a guess from where the program calls it. */
  role: string;
  /** Where it is, as segment and offset. */
  at: string;
  address: number;
  /** True when other parts use the same routine. */
  shared: boolean;
  /** True when it is a shared routine that does nothing, like an empty default. */
  empty: boolean;
}

/** A way a routine can end: from these frames, under this condition, the part is in this state. */
export interface Change extends Finding {
  /** The role of the routine, or its address when it isn't one of the part's six. */
  routine: string;
  /** The states it can start from; null when they aren't bounded. */
  from: number[] | null;
  to: string;
  /** The state as a number, when the routine sets it to one. */
  toState?: number;
  /** The state it ends in for each state in `from`, when that only depends on the state. */
  targets?: number[];
  /** True when the state stays what it was. */
  keeps: boolean;
  condition: string;
}

export interface Trigger extends Finding {
  name: string;
  routine: string;
  condition?: string;
}

export interface Counter extends Finding {
  field: string;
  updates: string[];
  comparisons: string[];
}

export interface Write extends Finding {
  routine: string;
  target: string;
  value: string;
  condition: string;
}

/** Where a walk starts: from how the part was placed, after it is created, from a resting state, or while it runs. */
export type WalkStart = AnimationDescription["initial"];

/** The frames a part shows after a trigger, as far as the analysis can follow them, and how that ends. */
export interface WalkPath {
  confidence: Confidence;
  /** The states it shows in order, which are its frames. */
  frames: number[];
  /**
   * How it ends: it rests on its last frame, loops back to the frame at `loopFrom`, runs past the steps the analysis
   * follows, holds or cycles a frame it is given, continues like another branch of the same walk, splits on a
   * condition, or stops where the analysis can't follow.
   */
  end: "rest" | "loop" | "limit" | "hold" | "cycle" | "joins" | "branches" | "stop";
  /** For a loop, the index in `frames` it goes back to. */
  loopFrom?: number;
  /** For a cycle, how many frames it goes through and in which direction. */
  cycle?: { period: number; direction: 1 | -1 };
  /** Why it stops or splits, in the analysis's own words. */
  reason?: string;
  /** When an unknown input decides between rules: the path under each condition, as the terms of that condition. */
  branches: { condition: string[]; path: WalkPath }[];
  /** For a split: every way it splits into ends, also past the branches shown here. */
  settled?: boolean;
  /** For a split deeper than the branches shown: how many ways it splits into. */
  ways?: number;
}

/** What follows one trigger: its name, where it starts, under which condition, and the path of frames. */
export interface Walk extends WalkPath {
  /** The short name of the trigger, like `run` or `bounce`. */
  trigger: string;
  start: WalkStart;
  /** The terms of the condition the trigger needs; empty when it always runs. */
  condition: string[];
  /** The trigger in the analysis's own words. */
  about: string;
  /** What the analysis says about the walk as a whole. */
  description?: string;
}

/** Something another part does to this one without changing its frame, like the explosion's push. */
export interface OtherEffect extends Finding {
  /** The part that does it. */
  sourceType: number;
  source: string;
  /** Set when this part touches the source, rather than the source reaching it. */
  touch?: true;
  /** What it sets, like `speed` or `velocity`, and to what, as text. A direction on the screen has no `what`. */
  sets: { what: string; value: string }[];
  /** For a speed that points away from the other part: the largest error of that direction, in degrees. */
  awayWithin?: number;
  /** What this part must be, in a few words, like `moving list`. */
  when: string[];
  /** What the source must be, in a few words, like `mirrored`, and its whole condition as text. */
  sourceWhen: string[];
  sourceCondition: string;
  /** When it does this on paths whose tests can't be said as one: each path's tests in words. */
  cases?: string[];
  /** The analysis's own sentence. */
  description: string;
}

/** One frame a part comes to rest on: from a run outcome, or where its walks end. */
export interface RestingFrame extends Finding {
  state: number;
  /** How many walk branches come to rest on it, when the walks give it rather than a run outcome. */
  walks?: number;
  /** The conditions on the way there, for the first few, as text. */
  conditions: string[];
}

/** How a part's frame is when the machine is put back, and the frames it comes to rest on. */
export interface RestSummary extends Finding {
  /**
   * `known`: the reset gives one frame. `saved`: it keeps the frame the level saved. `sockets`: it sets the frame from
   * whether plugs are in the part's sockets. `unresolved`: the analysis can't tell.
   */
  status: "known" | "saved" | "sockets" | "unresolved";
  /** The frame the reset gives, when it gives one. */
  state?: number;
  /** The frames the reset can leave, when they are known. */
  frames?: number[];
  /** The analysis's own sentence, and why it can't say more. */
  description: string;
  reason?: string;
  resting: RestingFrame[];
}

/** A line of what the part does, from the analysis: a part it creates, or what it does to itself or to other parts. */
export interface Doing extends Finding {
  /** `created`: a part it makes. `itself`: a flag of its own with a proved meaning. `others`: another part's fields. */
  on: "created" | "itself" | "others";
  /** The analysis's own sentence. */
  description: string;
  /** How many ways through its routines give the same sentence. */
  ways: number;
}

export interface PartSummary {
  routines: Routine[];
  changes: Change[];
  triggers: Trigger[];
  counters: Counter[];
  reset: Write[];
  effects: Write[];
  uncertainties: string[];
  gear?: GearSummary;
}

/** How a gear connects to others and passes its turn on, from the analysis of its routines. */
export interface GearSummary extends Finding {
  /** The four neighbours its reset links, one grid step away. */
  slots: { offset: number; name: string; side: "left" | "right" | "above" | "below"; distance: number }[];
  /** The field of the belt record whose other end is its fifth connection. */
  peerField: number;
  /** The parts that write its pending step through their belt, with the values they write. */
  drivers: { type: number; part: string; steps: string[]; confidence: Confidence; descriptions: string[] }[];
  /** The analysis's own words for each rule. */
  text: {
    activation: string;
    connections: string;
    conflict: string;
    withoutConflict: string;
    withConflict: string;
    cycles: string;
    scheduling: string[];
    limits: string[];
  };
}

export interface Timing extends Finding {
  /** The divisor the program gives the timer, and the rate that gives with the PC's usual clock. */
  divisor?: number;
  ticksPerSecond?: number;
  /** The least number of timer ticks the game loop waits for. */
  minimumTicks?: number;
  minimumMilliseconds?: number;
}

export interface BehaviourSummary {
  /** The fields of a part object the analysis found, by offset. */
  fields: { offset: number; name: string; confidence: Confidence }[];
  timing: Timing;
  parts: Record<number, PartSummary>;
  assumptions: string[];
}

const hex = (n: number, digits = 1) => `0x${n.toString(16).padStart(digits, "0")}`;
const PIT_CLOCK = 1193182;
/** Evidence per finding stays readable, and the summary small enough to pass from a worker. */
const MAX_EVIDENCE = 40;

const instructions = (evidence: readonly Evidence[]): Instruction[] =>
  evidence.slice(0, MAX_EVIDENCE).map(({ address, text }) => ({ address, text }));

/**
 * Fields of a part the analysis doesn't name, read from the program's code: the found list and overlaps that the
 * searches at 0x417e and 0x437d write, the history that each step shifts (0x87ed), momentum (0x3855), and the links,
 * of which the last two are sockets (0x5d14).
 */
const PART_FIELDS = new Map([
  [0x00, "nextInList"],
  [0x06, "lists"],
  [0x26, "olderX"],
  [0x28, "olderY"],
  [0x2e, "previousDrawX"],
  [0x30, "previousDrawY"],
  [0x32, "olderDrawX"],
  [0x34, "olderDrawY"],
  [0x3c, "momentum"],
  [0x3e, "momentum.high"],
  [0x48, "previousFrameWidth"],
  [0x4a, "previousFrameHeight"],
  [0x4c, "olderFrameWidth"],
  [0x4e, "olderFrameHeight"],
  [0x54, "belt"],
  [0x5a, "link0"],
  [0x5c, "link1"],
  [0x5e, "link2"],
  [0x60, "link3"],
  [0x62, "socket1"],
  [0x64, "socket2"],
  [0x66, "rope"],
  [0x78, "found"],
  [0x7a, "overlapX"],
  [0x7c, "overlapY"],
  [0x7e, "socketNumber"],
]);
/** What a field of a part points to: another part, a belt record, the outline points, or a rope record. */
const LINKS = new Map<number, Kind>([
  [0x54, "belt"],
  [0x5a, "part"],
  [0x5c, "part"],
  [0x5e, "part"],
  [0x60, "part"],
  [0x62, "part"],
  [0x64, "part"],
  [0x66, "rope"],
  [0x78, "part"],
  [0x82, "outline"],
  [0x84, "part"],
]);
type Kind = "part" | "belt" | "outline" | "rope" | "other";

/**
 * How numbers read in a condition: `words` as everywhere else (small ones in decimal, others in hex), `signed` and
 * `unsigned` in decimal, `bits` in hex unless below 10, `masked` (what masked bits are compared with) in hex unless 0,
 * and an angle in degrees (a full turn is 0x10000).
 */
type Numbers = "words" | "signed" | "unsigned" | "bits" | "masked" | "angle" | "signed angle";

/**
 * The words the rope code passes a rope callback, by their place on its stack: the part at the other end of the rope
 * (0x08462 passes the part whose rope moved, the connection query 0x1d638 the part that asks), the slot number of the
 * rope's end on this part, the kind of pull 0x7996 works out (with 0x8000 when the teeter-totter only asks first, as
 * its run does at 0x1d2a5), and the momentum of the part that started the pull, passed along unchanged.
 */
const ROPE_ARGUMENTS = new Map([
  [0x0a, "ropeSlot"],
  [0x0c, "ropeKind"],
  [0x10, "pullMomentum"],
  [0x12, "pullMomentum.high"],
]);

/** What the lab's own names in a condition stand for, with the analysis's raw form, for the tips. */
export const NAMED_TERMS: { name: string; raw: string; meaning: string }[] = [
  { name: "otherEnd", raw: "[argument+0x06]", meaning: "the part at the other end of the rope" },
  { name: "ropeSlot", raw: "argument+0x0a", meaning: "which of its two rope links the rope is tied to" },
  { name: "ropeKind", raw: "argument+0x0c", meaning: "the kind of pull, with 0x8000 when it only asks" },
  { name: "pullMomentum", raw: "argument+0x10", meaning: "the momentum of the part that started the pull" },
  {
    name: "askedRope",
    raw: "[table …+0x66[…]]",
    meaning: "the record of the rope it is asked about, its rope link at 0x66 picked by ropeSlot",
  },
];

/**
 * A mask of a mask as one, `(x & 0x8007) & 0x7fff` as `x & 0x7`, and bits set before a mask that keeps none of them
 * left out, `(x | 0x40) & 0x400` as `x & 0x400`. When the mask keeps only bits that were set, the value is the mask.
 */
function foldMask(e: Extract<Expression, { kind: "binary" }>): Expression {
  const { left, right } = e;
  if (e.operator !== "&" || right.kind !== "constant" || left.kind !== "binary" || left.right.kind !== "constant")
    return e;
  const [inner, mask] = [left.right.value >>> 0, right.value >>> 0];
  if (left.operator === "&")
    return foldMask({ ...e, left: left.left, right: { ...right, value: (inner & mask) >>> 0 } });
  if (left.operator === "|" && (inner & mask) === 0) return foldMask({ ...e, left: left.left });
  if (left.operator === "|" && (inner & mask) === mask) return right;
  return e;
}

/** Writes expressions and conditions as text, with the names of the part's fields. */
export function writer(
  fields: readonly { offset: number; name: string }[],
  /** Names that only hold for this part's own fields, like the gear's neighbours. */
  own: ReadonlyMap<number, string> = new Map(),
  /** The routine the expressions come from, when its argument has names: the rope callback's. */
  routine?: "rope",
) {
  const names = new Map([...PART_FIELDS, ...fields.map((f) => [f.offset, f.name] as const)]);
  const number = (n: number) => (n >= 0 && n < 100 ? String(n) : n < 0 && n > -100 ? String(n) : hex(n >>> 0));
  /** A number in a condition, in the style its place asks for. */
  const numberIn = (n: number, width: number, style: Numbers): string => {
    const bits = width > 0 && width <= 32 ? width : 16;
    const unsigned = n < 0 ? n + 2 ** bits : n;
    const signedValue = unsigned >= 2 ** (bits - 1) ? unsigned - 2 ** bits : unsigned;
    switch (style) {
      case "words":
        return number(n);
      case "bits":
        return unsigned < 10 ? String(unsigned) : hex(unsigned);
      case "masked":
        return unsigned ? hex(unsigned) : "0";
      case "unsigned":
        return String(unsigned);
      case "signed":
        return String(signedValue);
      case "angle":
      case "signed angle": {
        const degrees = ((style === "angle" ? unsigned : signedValue) * 360) / 0x10000;
        return `${Number(degrees.toFixed(2))}°`;
      }
    }
  };
  /** An object the analysis names, as text and the kind of thing it is. */
  const object = (text: string): { name: string; kind: Kind } => {
    // The same object read after a call that may have changed it.
    const after = / after (unresolved write|unresolved effect|field effect) at 0x[0-9a-f]+$/.exec(text);
    if (after) return object(text.slice(0, after.index));
    if (text === "part" || /^part after (the query|list scan) at 0x[0-9a-f]+$/.test(text))
      return { name: "", kind: "part" };
    // The part's found list right after a search filled it: its head is the part found last.
    if (/^found list after the query at 0x[0-9a-f]+$/.test(text)) return { name: "", kind: "part" };
    if (text === "collider") return { name: "collider", kind: "part" };
    if (text === "address of part") return { name: "this", kind: "other" };
    if (/^overlap candidate at /.test(text)) return { name: "found", kind: "part" };
    // The part a find-first loop stopped at, like the mouse the cat looks at.
    if (/^member found by the loop at 0x[0-9a-f]+$/.test(text)) return { name: "found", kind: "part" };
    // The part an overlap query picked, and a part a rope, belt or pulley reaches from this one.
    if (/^a candidate selected by the overlap query at 0x[0-9a-f]+$/.test(text)) return { name: "found", kind: "part" };
    if (/^a part reached through a rope, belt or pulley at 0x[0-9a-f]+$/.test(text))
      return { name: "reached", kind: "part" };
    // The part at the other end of the rope, which the rope code passes a rope callback.
    if (routine === "rope" && /^referenced-by\(argument\+0x0?6\)$/.test(text))
      return { name: "otherEnd", kind: "part" };
    const linked = /^referenced-by\((.+)\+0x([0-9a-f]+)\)$/.exec(text);
    if (linked) {
      const inner = object(linked[1]!);
      const offset = parseInt(linked[2]!, 16);
      const kind: Kind =
        inner.kind === "part"
          ? (LINKS.get(offset) ?? "other")
          : (inner.kind === "belt" && (offset === 4 || offset === 6)) || (inner.kind === "rope" && offset === 0)
            ? "part"
            : "other";
      const name = kind === "outline" ? "outline" : field(inner, offset);
      // A link without a name is bracketed, so its own fields don't read as a sum.
      return { name: kind === "other" || name.includes("+") ? `[${name}]` : name, kind };
    }
    // The record of the rope a rope callback is asked about: the part's rope link at 0x66, or the one after it, picked
    // by the slot number of the rope's end (decided assumption 1), like the teeter-totter's at 0x1d53d.
    if (/^pointer loaded from table 0x[0-9a-f]+\+0x66 indexed by .*"object":"address of part"/.test(text))
      return { name: "askedRope", kind: "rope" };
    const table = /^pointer loaded from table (\S+) indexed by /.exec(text);
    if (table) return { name: `[table ${table[1]}[…]]`, kind: "other" };
    return { name: text, kind: "other" };
  };
  const field = ({ name, kind }: { name: string; kind: Kind }, offset: number): string => {
    const raw = `${name || "part"}+${hex(offset, 2)}`;
    if (kind === "part") {
      const known = (!name && own.get(offset)) || names.get(offset);
      return known ? (name ? `${name}.${known}` : known) : raw;
    }
    if (kind === "belt" && (offset === 4 || offset === 6)) return `${name}.end${offset === 4 ? 1 : 2}`;
    if (kind === "rope" && offset === 0) return `${name}.part`;
    if (kind === "outline") return `${name}[${offset >> 2}].${["x", "y", "edge", "edge"][offset & 3]}`;
    if (name === "this" && offset === 0) return "this";
    return raw;
  };
  const place = (target: string, offset: number) => {
    if (target === "data") return `ds:${hex(offset, 4)}`;
    // Whether a find-first loop found a part, and what a query answered, like whether a spot is blocked.
    if (offset === 0 && /^member found by the loop at 0x[0-9a-f]+ link$/.test(target)) return "found";
    const answer = /^answer of the query at (0x[0-9a-f]+)$/.exec(target);
    if (answer && offset === 0) return `answer at ${answer[1]}`;
    // The angle from one part's centre to another's, which a call works out while the game runs.
    const angle = /^centre angle answer at (0x[0-9a-f]+)$/.exec(target);
    if (angle && offset === 0) return `centre angle at ${angle[1]}`;
    // Whether a call that makes a part made one, and whether the gear's turn jams.
    const made = /^nullable allocation result at (0x[0-9a-f]+)$/.exec(target);
    if (made && offset === 0) return `new part from the call at ${made[1]}`;
    const jam = /^gear connection conflict at (0x[0-9a-f]+)$/.exec(target);
    if (jam && offset === 0) return `gear jam at ${jam[1]}`;
    // The part's own fields after a call that may change them, and at the start of a walk.
    const later = /^part after (the query|list scan) at (0x[0-9a-f]+)$/.exec(target);
    if (later)
      return `${field({ name: "", kind: "part" }, offset)} after the ${later[1] === "list scan" ? "scan" : "query"} at ${later[2]}`;
    if (target === "part at the walk's start")
      return `${field({ name: "", kind: "part" }, offset)} at the walk's start`;
    // A value a scan or a loop leaves in the routine's own stack.
    const local = /^local after (list scan|find-first loop) at (0x[0-9a-f]+)$/.exec(target);
    if (local)
      return `local ${offset < 0 ? "-" : "+"}${hex(Math.abs(offset), 2)} after the ${local[1] === "list scan" ? "scan" : "loop"} at ${local[2]}`;
    // The neighbours an ordered insertion links a part between, which only the run knows.
    const linked = /^(next|previous) in the ordered list after the insertion at (0x[0-9a-f]+)$/.exec(target);
    if (linked) return `${linked[1]} in the list after the insertion at ${linked[2]}`;
    // What a search writes in the parts it finds: the next part in its found list, and the values it works out.
    if (/^next in the found list of the query at 0x[0-9a-f]+$/.test(target)) return "next found";
    const written = /^value the (query|call) at (0x[0-9a-f]+) writes to a (found|selected) part$/.exec(target);
    if (written) return `${field({ name: "", kind: "part" }, offset)} from the call at ${written[2]}`;
    const scanned = /^value after the list scan at (0x[0-9a-f]+) in (.+)$/.exec(target);
    if (scanned) return `${field(object(scanned[2]!), offset)} after the scan at ${scanned[1]}`;
    if (target === "stack") return `local ${offset < 0 ? "-" : "+"}${hex(Math.abs(offset), 2)}`;
    if (target === "argument")
      return (routine === "rope" && ROPE_ARGUMENTS.get(offset)) || `argument+${hex(offset, 2)}`;
    return field(object(target), offset);
  };
  /** Whether a value is a direction word, like where a part was hit (0x0d98), or one with a turn added. */
  const isAngle = (e: Expression): boolean =>
    (e.kind === "field" && /(^|\.)contactAngle$/.test(place(e.object, e.offset))) ||
    (e.kind === "binary" &&
      (e.operator === "+" || e.operator === "-") &&
      isAngle(e.left) &&
      e.right.kind === "constant");
  const expression = (e: Expression, nested = false, style: Numbers = "words"): string => {
    // One of two values a test picks, written as the two values and the test.
    const choice = choiceOf(e);
    if (choice) {
      const text = `${expression(choice.then, true, style)} if ${predicate(choice.test)}, else ${expression(choice.otherwise, true, style)}`;
      return nested ? `(${text})` : text;
    }
    switch (e.kind) {
      case "constant":
        return numberIn(e.value, e.width, style);
      case "field":
        return place(e.object, e.offset);
      case "binary": {
        if (style === "words") {
          const text = `${expression(e.left, true)} ${e.operator} ${expression(e.right, true)}`;
          return nested ? `(${text})` : text;
        }
        // In a condition: masks in hex, and what they are applied to in bits too; a shift by a count; a negative
        // number added as one taken off.
        const masked = foldMask(e);
        if (masked.kind !== "binary") return expression(masked, nested, "masked");
        const bitwise = ["&", "|", "^"].includes(masked.operator);
        const shift = ["<<", ">>", ">>>"].includes(masked.operator);
        const inner: Numbers = bitwise ? "bits" : style;
        const left = expression(masked.left, true, inner);
        let operator = masked.operator;
        let right =
          bitwise && masked.right.kind === "constant"
            ? hex(masked.right.value >>> 0)
            : expression(masked.right, true, shift ? "unsigned" : inner);
        if ((operator === "+" || operator === "-") && /^-\d/.test(right)) {
          operator = operator === "+" ? "-" : "+";
          right = right.slice(1);
        }
        const text = `${left} ${operator} ${right}`;
        return nested ? `(${text})` : text;
      }
      case "table":
        return `table ${hex(e.segment, 4)}:${hex(e.offset, 4)}[${expression(e.index)}]`;
      case "unknown":
        return "unknown";
    }
  };
  const predicate = (p: Predicate): string => {
    switch (p.kind) {
      case "true":
        return "always";
      case "compare": {
        // A frame, a speed, a position or a control value as a signed number, a direction in degrees, and a value of
        // masked bits in hex like the mask.
        const masked = (e: Expression) => e.kind === "binary" && ["&", "|", "^"].includes(e.operator);
        const style: Numbers = [p.left, p.right].some(isAngle)
          ? p.signed
            ? "signed angle"
            : "angle"
          : [p.left, p.right].some(masked)
            ? "bits"
            : p.signed || p.operator === "==" || p.operator === "!="
              ? "signed"
              : "unsigned";
        // The bits a hex mask keeps are compared with bits in hex too; ordered, or under a small mask, as a number.
        const equal = p.operator === "==" || p.operator === "!=";
        const mask = (e: Expression) => {
          const folded = e.kind === "binary" ? foldMask(e) : e;
          return folded.kind === "binary" && folded.operator === "&" && folded.right.kind === "constant"
            ? folded.right.value >>> 0
            : 0;
        };
        const hexMask = [p.left, p.right].some((e) => mask(e) >= 10);
        const side = (e: Expression): Numbers =>
          style === "bits" && e.kind === "constant" ? (equal && hexMask ? "masked" : "unsigned") : style;
        return `${expression(p.left, false, side(p.left))} ${p.operator} ${expression(p.right, false, side(p.right))}`;
      }
      case "and":
        return p.terms.map(predicate).join(" and ");
      case "unknown":
        return "unknown";
    }
  };
  return { expression, predicate, place };
}

const signed = (n: number) => (n > 0x7fff ? n - 0x10000 : n);
/** A frame the program keeps as a word, as the signed number it stands for: 65535 is frame -1. */
const frameOf = (n: number) => (n > 0x7fff && n <= 0xffff ? n - 0x10000 : n);

/** The 16-bit value of an expression for a state, when it depends on nothing but the state. */
export function valueForState(e: Expression, state: number, stateOffset: number): number | undefined {
  if (e.kind === "constant") return e.value & 0xffff;
  if (e.kind === "field") return e.object === "part" && e.offset === stateOffset ? state & 0xffff : undefined;
  if (e.kind !== "binary") return undefined;
  const l = valueForState(e.left, state, stateOffset);
  const r = valueForState(e.right, state, stateOffset);
  if (l === undefined || r === undefined) return undefined;
  const value = (() => {
    switch (e.operator) {
      case "+":
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      case "&":
        return l & r;
      case "|":
        return l | r;
      case "^":
        return l ^ r;
      case "<<":
        return l << r;
      case ">>":
        return signed(l) >> r;
      case ">>>":
        return l >>> r;
      case "/":
        return r ? Math.trunc(l / r) : undefined;
      case "%":
        return r ? l % r : undefined;
      case "s/":
        return r ? Math.trunc(signed(l) / signed(r)) : undefined;
      case "s%":
        return r ? signed(l) % signed(r) : undefined;
    }
  })();
  return value === undefined ? undefined : value & 0xffff;
}

/** The short role of a routine, like `run` for "run callback candidate". */
const roleOf = (role: string) => role.replace(/ callback candidate$/, "");

function targetsOf(to: Expression, from: number[] | null, stateOffset: number): number[] | undefined {
  if (!from?.length || to.kind !== "binary") return undefined;
  const targets = from.map((state) => valueForState(to, state, stateOffset));
  return targets.every((t) => t !== undefined) ? targets.map(signed) : undefined;
}

const SIDES = { "1,0": "left", "-1,0": "right", "0,1": "above", "0,-1": "below" } as const;

/** The gear's neighbours by the side they are on: reset subtracts their saved position from its own. */
function gearSlots(part: PartBehaviour) {
  return (part.gearConnections?.slots ?? []).flatMap(({ offset, dx, dy }) => {
    const side = SIDES[`${Math.sign(dx)},${Math.sign(dy)}` as keyof typeof SIDES];
    if (!side) return [];
    const name = `gear${side[0]!.toUpperCase()}${side.slice(1)}`;
    return [{ offset, name, side, distance: Math.abs(dx || dy) }];
  });
}

function summariseGear(part: PartBehaviour, report: BehaviourReport): GearSummary | undefined {
  const gear = describeGear(part, report.gearScheduling, report.relatedObjectEffects);
  if (!gear || !part.gearRun) return undefined;
  const delta = part.gearRun.deltaField;
  const drivers = new Map<number, GearSummary["drivers"][number]>();
  for (const d of gear.drivers) {
    const value = d.write.value;
    const step =
      value.kind === "constant"
        ? String(value.value > 0x7fff ? value.value - 0x10000 : value.value)
        : value.kind === "field" && value.object === "part" && value.offset === delta
          ? "its own step"
          : "unknown";
    const driver = drivers.get(d.sourceType) ?? {
      type: d.sourceType,
      part: d.sourcePart,
      steps: [],
      confidence: d.confidence,
      descriptions: [],
    };
    if (!driver.steps.includes(step)) driver.steps.push(step);
    driver.steps.sort((a, b) => (Number(a) || (a === "0" ? 0 : 99)) - (Number(b) || (b === "0" ? 0 : 99)));
    if (!driver.descriptions.includes(d.description)) driver.descriptions.push(d.description);
    if (d.confidence === "unresolved") driver.confidence = "unresolved";
    drivers.set(d.sourceType, driver);
  }
  return {
    confidence: gear.confidence,
    assumptions: gear.assumptions,
    evidence: instructions(gear.evidence),
    slots: gearSlots(part),
    peerField: part.gearRun.propagationRelation.expansion.peer.connectionField,
    drivers: [...drivers.values()],
    text: {
      activation: gear.activation,
      connections: gear.connections,
      conflict: gear.conflict,
      withoutConflict: gear.withoutConflict,
      withConflict: gear.withConflict,
      cycles: gear.cycles,
      scheduling: gear.scheduling.map((s) => s.description),
      limits: gear.limits,
    },
  };
}

function summarisePart(
  part: PartBehaviour,
  fields: readonly { offset: number; name: string }[],
  stateOffset: number,
  report: BehaviourReport,
): PartSummary {
  const roles = new Map(part.routines.map((r) => [r.address, roleOf(r.role)]));
  const routineName = (address: number) => roles.get(address) ?? hex(address, 5);
  const write = partWriter(part, fields);
  // The rope callback's own findings name what the rope code passes it.
  const rope = partWriter(part, fields, "rope");
  const writerOf = (routine: number) => (roles.get(routine) === "rope" ? rope : write);
  const finding = (f: { confidence: Confidence; assumptions: string[]; evidence: Evidence[] }): Finding => ({
    confidence: f.confidence,
    assumptions: f.assumptions,
    evidence: instructions(f.evidence),
  });
  const writeOf = (w: FieldWrite): Write => ({
    ...finding(w),
    routine: routineName(w.routine),
    target: writerOf(w.routine).place(w.object, w.offset),
    value: writerOf(w.routine).expression(w.value),
    condition: writerOf(w.routine).predicate(w.condition),
  });
  return {
    routines: part.routines.map((r) => ({
      ...finding(r),
      role: roleOf(r.role),
      at: `${hex(r.segment, 4)}:${hex(r.offset, 4)}`,
      address: r.address,
      shared: r.shared,
      empty: r.sharedDefault,
    })),
    changes: part.transitions.map((t) => {
      const keeps = t.to.kind === "field" && t.to.object === "part" && t.to.offset === stateOffset;
      return {
        ...finding(t),
        routine: routineName(t.routine),
        from: t.from && t.from.map(frameOf),
        to: write.expression(t.to),
        toState: t.to.kind === "constant" ? frameOf(t.to.value) : undefined,
        targets: targetsOf(t.to, t.from, stateOffset),
        keeps,
        condition: writerOf(t.routine).predicate(t.condition),
      };
    }),
    // The six routines are listed on their own; triggers are what else starts a change.
    triggers: part.triggers
      .filter((t) => !/ callback candidate$/.test(t.name))
      .map((t) => ({
        ...finding(t),
        // Name the field, like "stateDelta gates a state change" for "Field 0x12 gates a state change".
        name: t.name.replace(/^Field (0x[0-9a-f]+)/, (_, offset: string) => write.place("part", Number(offset))),
        routine: routineName(t.routine),
        condition: t.condition && writerOf(t.routine).predicate(t.condition),
      })),
    counters: part.counters.map((c) => ({
      ...finding(c),
      field: write.place("part", c.offset),
      updates: [...new Set(c.updates.map((u) => write.expression(u.value)))],
      comparisons: [...new Set(c.comparisons.map(write.predicate))],
    })),
    reset: part.reset.map(writeOf),
    effects: part.visibleEffects.map(writeOf),
    uncertainties: part.uncertainties,
    gear: summariseGear(part, report),
  };
}

/** How deep branches go in the summary: a branch of a branch, and no further. */
const BRANCH_DEPTH = 2;

/** The terms of a condition as text, so the tab can tidy them and drop the ones that say nothing. */
function termsOf(p: Predicate | undefined, write: ReturnType<typeof writer>): string[] {
  if (!p || p.kind === "true") return [];
  if (p.kind === "and") return p.terms.flatMap((t) => termsOf(t, write));
  return [write.predicate(p)];
}

/** Whether a walk ends in every way it can go: none of its branches, at any depth, stops. */
function settles(walk: BehaviourWalk): boolean {
  if (["rest", "loop", "joins"].includes(walk.status)) return true;
  const branches = walk.stop?.branches;
  return !!branches?.length && branches.every((b) => settles(b.walk));
}

function pathOf(walk: BehaviourWalk, write: ReturnType<typeof writer>, depth = 0): WalkPath {
  const frames = walk.frames.map((f) => frameOf(f.state));
  const branches =
    depth < BRANCH_DEPTH
      ? (walk.stop?.branches ?? []).map((b) => ({
          // Rules that lead to the same next fields are one way: what they all test, and one of their own cases.
          condition: [
            ...termsOf(b.condition, write),
            ...(b.alternatives?.length ? [`one of ${b.alternatives.length} cases`] : []),
          ],
          path: pathOf(b.walk, write, depth + 1),
        }))
      : [];
  const p = walk.parameterised;
  const end: WalkPath["end"] =
    p?.kind === "hold"
      ? "hold"
      : p?.kind === "cycle"
        ? "cycle"
        : walk.status === "rest"
          ? "rest"
          : walk.status === "loop"
            ? "loop"
            : walk.status === "limit"
              ? "limit"
              : walk.status === "joins"
                ? "joins"
                : walk.stop?.branches?.length
                  ? "branches"
                  : "stop";
  return {
    confidence: walk.confidence,
    frames,
    end,
    loopFrom: walk.status === "loop" ? walk.loopStart : undefined,
    cycle: p?.kind === "cycle" ? { period: p.period, direction: p.direction } : undefined,
    reason:
      end === "stop" || end === "branches"
        ? (walk.stop?.description ?? walk.reason)
        : end === "joins"
          ? walk.reason
          : undefined,
    branches,
    ...(end === "branches" && settles(walk) ? { settled: true } : {}),
    ...(end === "branches" && !branches.length ? { ways: walk.stop!.branches!.length } : {}),
  };
}

/** The walks of a part, one for each trigger and starting case the analysis follows. */
function walksOf(
  animations: readonly AnimationDescription[],
  write: ReturnType<typeof writer>,
  /** The writer for walks the rope callback starts, which names what the rope code passes it. */
  rope: ReturnType<typeof writer> = write,
): Walk[] {
  return animations.map((a) =>
    walkOf(a, a.trigger.kind === "callback" && roleOf(a.trigger.name) === "rope" ? rope : write),
  );
}

function walkOf(a: AnimationDescription, write: ReturnType<typeof writer>): Walk {
  return {
    ...pathOf(a.walk, write),
    trigger:
      a.trigger.kind === "run" || a.trigger.kind === "input-case"
        ? "run"
        : a.trigger.kind === "related-write"
          ? // Another part's routine writes this one, like "A recorded effect of explosion" or "Hit by an explosion", or
            // its touch does, like "Touching a trampoline". What the touch needs of the part is in its condition.
            a.trigger.name
              .replace(/^A recorded effect of /, "by ")
              .replace(/^Hit by /, "hit by ")
              .replace(/^Touching (.+?)(, if .*)?$/, "touching $1")
          : roleOf(a.trigger.name),
    start: a.initial,
    condition: termsOf(a.inputCondition ?? a.trigger.condition, write),
    about: a.trigger.name,
    description: a.description,
  };
}

/** The writer for a part: with the names of the gear's neighbours when it is a gear. */
function partWriter(part: PartBehaviour, fields: readonly { offset: number; name: string }[], routine?: "rope") {
  const own = new Map(gearSlots(part).map((s) => [s.offset, s.name]));
  return writer(fields, own, routine);
}

/** The walks from the triggers of each part, by type, from the report's description. */
export function summariseWalks(report: BehaviourReport, description: BehaviourDescription): Record<number, Walk[]> {
  const fields = report.layout.fields.map(({ offset, name }) => ({ offset, name }));
  const animations = new Map(description.parts.map((d) => [d.type, d.animations]));
  return Object.fromEntries(
    report.parts.map((p) => [
      p.type,
      walksOf(animations.get(p.type) ?? [], partWriter(p, fields), partWriter(p, fields, "rope")),
    ]),
  );
}

/** How each part's reset leaves its frame and where it comes to rest, by type, from the report's description. */
export function summariseRests(
  report: BehaviourReport,
  description: BehaviourDescription,
): Record<number, RestSummary> {
  const fields = report.layout.fields.map(({ offset, name }) => ({ offset, name }));
  const parts = new Map(report.parts.map((p) => [p.type, p]));
  return Object.fromEntries(
    description.parts.map((d) => {
      const part = parts.get(d.type);
      const write = part ? partWriter(part, fields) : writer(fields);
      const { rest } = d;
      const summary: RestSummary = {
        confidence: rest.confidence,
        assumptions: rest.assumptions,
        evidence: instructions(rest.evidence),
        status: rest.status,
        ...(rest.status === "known" && rest.state !== undefined ? { state: frameOf(rest.state) } : {}),
        ...(rest.frames ? { frames: rest.frames.map(frameOf).sort((a, b) => a - b) } : {}),
        description: rest.description,
        ...(rest.reason ? { reason: rest.reason } : {}),
        resting: d.stableStates
          .map((stable) => ({
            confidence: stable.confidence,
            assumptions: stable.assumptions,
            evidence: instructions(stable.evidence),
            state: frameOf(stable.state),
            ...(stable.walks ? { walks: stable.walks } : {}),
            conditions: [...new Set(stable.origins.map((o) => write.predicate(o.condition)))].filter(
              (c) => c !== "always",
            ),
          }))
          // A frame word of -1 comes last in the description; signed, it comes first.
          .sort((a, b) => a.state - b.state),
      };
      return [d.type, summary];
    }),
  );
}

/** Flags and fields of a part whose meaning the code proves, as the analysis names them in its lines. */
const PROVED = /ran-this-step mark|out-of-play flag|goal mark|contact flag|fine (horizontal|vertical) position/;

/**
 * What each part does, by type, from the report's description: the parts it creates, what it does to other parts, and
 * the flags of its own whose meaning the code proves. Ways that say the same are one line.
 */
export function summariseDoings(description: BehaviourDescription): Record<number, Doing[]> {
  return Object.fromEntries(
    description.parts.map((d) => {
      const lines = new Map<string, Doing>();
      for (const e of d.effects) {
        const on =
          e.kind === "related-object"
            ? /^Creates /.test(e.description)
              ? "created"
              : "others"
            : e.kind === "drawing" && PROVED.test(e.description)
              ? "itself"
              : undefined;
        if (!on) continue;
        // A way that changes several things says each in a sentence of its own, so each one is a line; of its own
        // flags only those with a proved meaning. A created part's sentences belong together.
        const sentences =
          on === "created"
            ? [e.description]
            : e.description.split(/(?<=\.) (?=[A-Z])/).filter((t) => on === "others" || PROVED.test(t));
        for (const sentence of sentences) {
          const line = lines.get(sentence);
          if (line) {
            line.ways++;
            if (e.confidence === "unresolved" || (e.confidence === "inferred" && line.confidence === "checked"))
              line.confidence = e.confidence;
            continue;
          }
          lines.set(sentence, {
            confidence: e.confidence,
            assumptions: e.assumptions,
            evidence: instructions(e.evidence),
            on,
            description: sentence,
            ways: 1,
          });
        }
      }
      return [d.type, [...lines.values()]];
    }),
  );
}

/** The largest error of a speed that points away from the other part, when one does. */
function awayWithin(sets: OtherPartEffect["sets"]): { awayWithin?: number } {
  const degrees = sets.flatMap((s) => (s.kind === "speed" && s.away ? [s.away.degrees] : []));
  return degrees.length ? { awayWithin: Math.max(...degrees) } : {};
}

/** The fine position's words by field: the longs at 0x16 (across) and 0x1a (down), in 1/512 pixels. */
const FINE = new Map([
  [0x16, "fine X"],
  [0x18, "fine X"],
  [0x1a, "fine Y"],
  [0x1c, "fine Y"],
]);

/**
 * A value another part sets from this part's own fields, in a few words from the analysis's own: a flag bit with a
 * proved meaning set or cleared, a word of the fine position, a number added or taken off, or the formula.
 */
function settingOf(
  s: Extract<OtherPartEffect["sets"][number], { kind: "expression" }>,
  write: ReturnType<typeof writer>,
): { what: string; value: string } {
  const flag = /^(sets|clears) its (.+?) (0x[0-9a-f]{4}) in /.exec(s.words);
  if (flag) {
    // Goal marks differ only in their bit, so it stays; the other flags are one bit each.
    const name = flag[2] === "goal mark" ? `goal mark ${flag[3]}` : flag[2]!;
    return { what: name, value: flag[1] === "sets" ? "set" : "cleared" };
  }
  const fine = FINE.get(s.offset);
  const word = / to the (low|high) word of (.+)$/.exec(s.words);
  if (fine && word) return { what: `${fine} ${word[1]}`, value: word[2]! };
  const field = write.place("part", s.offset);
  const add = /^(adds|subtracts) (\d+) (?:to|from) /.exec(s.words);
  if (add) return { what: field, value: `${field} ${add[1] === "adds" ? "+" : "-"} ${add[2]}` };
  if (/^halves /.test(s.words)) return { what: field, value: "halved, rounding down" };
  if (/^reverses /.test(s.words)) return { what: field, value: "reversed" };
  const to = /^sets (?:field 0x[0-9a-f]+|\w+) to (.+)$/.exec(s.words);
  return { what: field, value: to ? to[1]! : write.expression(s.value) };
}

/** Both words of the fine position that one value sets, as one: "fine Y" rather than its low and high word. */
function joinFine(sets: { what: string; value: string }[]) {
  return sets.flatMap((s) => {
    const half = /^(fine [XY]) (low|high)$/.exec(s.what);
    if (!half) return [s];
    const other = sets.find(
      (o) => o.what === `${half[1]} ${half[2] === "low" ? "high" : "low"}` && o.value === s.value,
    );
    if (!other) return [{ ...s, what: `${half[1]} ${half[2]} word` }];
    return half[2] === "low" ? [{ what: half[1]!, value: s.value }] : [];
  });
}

/** What other parts do to each part without changing its frame, by type, from the report's description. */
export function summariseEffects(
  report: BehaviourReport,
  description: BehaviourDescription,
): Record<number, OtherEffect[]> {
  const fields = report.layout.fields.map(({ offset, name }) => ({ offset, name }));
  const write = writer(fields);
  const signedText = (n: number) => String(n > 0x7fff ? n - 0x10000 : n);
  return Object.fromEntries(
    description.parts.map((d) => [
      d.type,
      d.effectsFromOthers.map((e): OtherEffect => {
        const fieldValue = (offset: number) =>
          e.sets.find((s) => s.kind === "field" && s.offset === offset) as { value: number } | undefined;
        const [x, y] = [fieldValue(0x36), fieldValue(0x38)];
        // Both velocities read as one pair, across then down.
        // Where both velocities move the part on the screen, when the analysis says it; the numbers are in the tip.
        const pair =
          x && y
            ? [
                e.velocityDirection
                  ? { what: "", value: e.velocityDirection }
                  : { what: "velocity", value: `${signedText(x.value)}, ${signedText(y.value)}` },
              ]
            : [];
        const sets = [
          ...pair,
          ...e.sets.flatMap((s) =>
            s.kind === "speed"
              ? [{ what: s.away ? "speed away" : "speed", value: String(s.speed) }]
              : s.kind === "expression"
                ? // A value of the part's own fields, like a touch that halves its velocityX.
                  [settingOf(s, write)]
                : pair.length && (s.offset === 0x36 || s.offset === 0x38)
                  ? []
                  : [{ what: write.place("part", s.offset), value: signedText(s.value) }],
          ),
        ];
        return {
          confidence: e.confidence,
          assumptions: e.assumptions,
          evidence: instructions(e.evidence),
          ...awayWithin(e.sets),
          sourceType: e.sourceType,
          source: e.sourcePart,
          ...(e.touch ? { touch: true } : {}),
          sets: joinFine(sets),
          when: e.conditionWords.map((w) => w.replace(/^on the /, "")),
          sourceWhen: e.sourceConditionWords,
          sourceCondition: write.predicate(e.sourceCondition),
          ...(e.cases ? { cases: e.cases.map((c) => c.words) } : {}),
          description: e.description,
        };
      }),
    ]),
  );
}

/** The summary of a behaviour report, for the lab. */
export function summariseBehaviour(report: BehaviourReport): BehaviourSummary {
  const fields = report.layout.fields.map(({ offset, name, confidence }) => ({ offset, name, confidence }));
  const stateOffset = fields.find((f) => f.name === "state")?.offset ?? 0x0c;
  const { pit, cycle } = report.timing;
  const timing: Timing = {
    confidence: pit && cycle ? "inferred" : "unresolved",
    assumptions: [...(pit?.assumptions ?? []), ...(cycle?.assumptions ?? [])],
    evidence: instructions([...(pit?.evidence ?? []), ...(cycle?.evidence ?? [])]),
    divisor: pit?.divisor,
    ticksPerSecond: pit?.divisor ? PIT_CLOCK / pit.divisor : undefined,
    minimumTicks: cycle?.minimumInterrupts,
    minimumMilliseconds: cycle?.minimumPeriodMilliseconds,
  };
  return {
    fields,
    timing,
    parts: Object.fromEntries(report.parts.map((p) => [p.type, summarisePart(p, fields, stateOffset, report)])),
    assumptions: report.assumptions,
  };
}

/** The states as short text, like "0–2, 4". */
export function statesText(states: readonly number[] | null): string {
  if (!states) return "any";
  if (!states.length) return "none";
  const runs: string[] = [];
  for (let i = 0; i < states.length; i++) {
    let j = i;
    while (j + 1 < states.length && states[j + 1] === states[j]! + 1) j++;
    runs.push(j > i ? `${states[i]}–${states[j]}` : String(states[i]));
    i = j;
  }
  return runs.join(", ");
}

export type BehaviourResult =
  { status: "done"; summary: BehaviourSummary; seconds: number } | { status: "error"; message: string };

/** The walks of every part, by type, which take a few more seconds to read after the rest, and the effects of others. */
export type WalksResult =
  | {
      status: "done";
      walks: Record<number, Walk[]>;
      effects: Record<number, OtherEffect[]>;
      rests: Record<number, RestSummary>;
      doings: Record<number, Doing[]>;
      seconds: number;
    }
  | { status: "error"; message: string };

/** What the worker is asked: the program as it ships, and what was read from it before. */
export interface BehaviourRequest {
  program: Uint8Array;
  parts: ProgramParts;
}

/** What the worker answers: first the behaviour, then the walks. */
export type BehaviourMessage = { kind: "behaviour"; result: BehaviourResult } | { kind: "walks"; result: WalksResult };

/** The behaviour and the walks of a program, once per program: a later call gets the same answers, unless one failed. */
const results = new WeakMap<Uint8Array, { result: Promise<BehaviourResult>; walks: Promise<WalksResult> }>();

/**
 * Reads the behaviour of a program in a worker, then the walks from its triggers. The behaviour comes first, so it can
 * show while the walks are still being read.
 */
export function readBehaviourInBackground(
  program: Uint8Array,
  parts: ProgramParts,
): { result: Promise<BehaviourResult>; walks: Promise<WalksResult> } {
  let reading = results.get(program);
  if (!reading) {
    let resolveResult!: (r: BehaviourResult) => void;
    let resolveWalks!: (r: WalksResult) => void;
    reading = {
      result: new Promise((resolve) => (resolveResult = resolve)),
      walks: new Promise((resolve) => (resolveWalks = resolve)),
    };
    const worker = new Worker(new URL("./behaviour.worker.ts", import.meta.url), { type: "module" });
    const stop = (message: string) => {
      resolveResult({ status: "error", message });
      resolveWalks({ status: "error", message });
      worker.terminate();
    };
    worker.onmessage = ({ data }: MessageEvent<BehaviourMessage>) => {
      if (data.kind === "behaviour") {
        resolveResult(data.result);
        if (data.result.status === "error") stop(data.result.message);
      } else {
        resolveWalks(data.result);
        worker.terminate();
      }
    };
    // Settling a promise again does nothing, so a failure after the behaviour came only fails the walks.
    worker.onerror = (e) => stop(e.message || "The analysis stopped.");
    worker.postMessage({ program, parts } satisfies BehaviourRequest);
    results.set(program, reading);
    // A failed read isn't kept, so a later call tries again.
    const forget = (r: { status: string }) => {
      if (r.status === "error" && results.get(program) === reading) results.delete(program);
    };
    void reading.result.then(forget);
    void reading.walks.then(forget);
  }
  return reading;
}
