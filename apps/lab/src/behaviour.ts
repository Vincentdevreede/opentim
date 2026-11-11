/**
 * The behaviour of the parts, read from `TIM.EXE` by `@opentim/content` without running it, made small enough to show
 * in the lab: findings keep their confidence and the addresses of their instructions, and expressions become text.
 */

import { choiceOf, describeGear } from "@opentim/content";
import type {
  PuzzleGoal,
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
  /**
   * What it sets, like `speed` or `velocity`, and to what, as text. A direction on the screen has no `what`. A goal
   * mark keeps its bit in `mark`, to name the mark after the parts that set it.
   */
  sets: { what: string; value: string; mark?: number }[];
  /** For a speed that points away from the other part: the largest error of that direction, in degrees. */
  awayWithin?: number;
  /** What this part must be, in a few words, like `moving list`. */
  when: string[];
  /**
   * What the source must be, in a few words, like `mirrored`, and its whole condition as text: one for each way the
   * source does the same, like the jack-in-the-box's push, which tests its frame on each way.
   */
  sourceWhen: string[];
  sourceConditions: string[];
  /** When it does this on paths whose tests can't be said as one: each path's tests in words. */
  cases?: string[];
  /**
   * The fields the source leaves to the contact search it then runs on this part, by name, like the teeter-totter's
   * launch: what that search finds there only the run knows.
   */
  searched?: string[];
  /** The analysis's own sentence. */
  description: string;
}

/** One frame a part comes to rest on: from a run outcome, or where its walks end. */
export interface RestingFrame extends Finding {
  state: number;
  /** How many walk branches come to rest on it, when the walks give it rather than a run outcome. */
  walks?: number;
  /** The conditions on the way there, for the first few, as text; empty when a way there has none. */
  conditions: string[];
  /** Set when a way there has no test, so the part rests there whatever the conditions of the other ways. */
  always?: true;
  /** How many ways come to rest on it: the walks, or the run outcomes that keep it. */
  ways: number;
  /** Set when the analysis keeps the conditions of only the first few ways, so the others' aren't known. */
  capped?: true;
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
  /**
   * The conditions of those ways as text, each once; `always` when a way has no test. Empty when the analysis gives
   * none.
   */
  conditions: string[];
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
  /** The tables the reset copies the outline from, when it copies one, and the drawing flag bits for each flip. */
  outlineTables?: OutlineTablesSummary;
}

/** The outline tables a part's reset copies from, chosen by its frame and how it is flipped. */
export interface OutlineTablesSummary extends Finding {
  tables: { when: string[][]; corners: [number, number][] }[];
  flips: { horizontal?: number; vertical?: number };
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
  /** The fields of a part object the analysis found, by offset, with the bits of a flag word it names. */
  fields: { offset: number; name: string; confidence: Confidence; masks?: { value: number; name: string }[] }[];
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
 * of which the last two are sockets (0x5d14). The level loader puts the file's third flag word (with the goal marks),
 * the belt's place and width, the rope slots' places and the extra word in the others (`docs/levels.md`).
 */
const PART_FIELDS = new Map([
  [0x00, "nextInList"],
  [0x06, "lists"],
  [0x0a, "marks"],
  // The byte the relay passes along a part's belt and ropes (`0x65c1`).
  [0x14, "relayByte"],
  // The fine position, in 1/512 pixels, as longs.
  [0x16, "fineX"],
  [0x18, "fineX.high"],
  [0x1a, "fineY"],
  [0x1c, "fineY.high"],
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
  [0x56, "beltPlaceX"],
  [0x57, "beltPlaceY"],
  [0x58, "beltWidth"],
  [0x5a, "link0"],
  [0x5c, "link1"],
  [0x5e, "link2"],
  [0x60, "link3"],
  [0x62, "socket1"],
  [0x64, "socket2"],
  [0x66, "rope"],
  [0x6a, "ropeSlot0X"],
  [0x6b, "ropeSlot0Y"],
  [0x6c, "ropeSlot1X"],
  [0x6d, "ropeSlot1Y"],
  // Where a flame lights a lightable part, from its corner: the candle's wick, the fuse of the dynamite, the cannon and
  // the rocket. Their reset sets it, and the flame's search (0x448e) looks for it in the flame's box.
  [0x72, "fuseX"],
  [0x73, "fuseY"],
  [0x78, "found"],
  [0x7a, "overlapX"],
  [0x7c, "overlapY"],
  [0x7e, "socketNumber"],
  [0x96, "extra"],
  // A counter some parts keep, which the check against the recordings calls the heat.
  [0x9c, "heat"],
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
  {
    name: "pull kind",
    raw: "ropeKind, argument+0x0c",
    meaning:
      "1, 2 or 4 as the rope code works it out (0x7996), with 8 or 16 for the side of the rope; a question has 0x8000 too, when the teeter-totter only asks",
  },
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

/** A field of the part record as the writer names it, with the bits of it the analysis names, like `horizontalFlip`. */
export interface WriterField {
  offset: number;
  name: string;
  masks?: readonly { value: number; name: string }[];
}

const writerFields = (report: BehaviourReport): WriterField[] =>
  report.layout.fields.map(({ offset, name, masks }) => ({ offset, name, ...(masks ? { masks } : {}) }));

/** The bits the analysis names in the drawing flags, as words for set and clear. */
const MASK_WORDS: Record<string, [string, string]> = {
  horizontalFlip: ["mirrored", "not mirrored"],
  verticalFlip: ["upside down", "not upside down"],
  drawFromPieces: ["drawn from pieces", "not drawn from pieces"],
};

/**
 * Every bit of a part's three flag words the program uses, as words for set and clear, by field and bit: the list
 * flags at 0x06, the drawing flags at 0x08 and the marks at 0x0a. What each one does, with the routines that show it in
 * Even More (English floppy) and TIM 1 (French), is in `docs/behaviour.md` under "Flag bits". The bits not here are
 * never tested or set on a part: 0x0080 and 0x0100 of the list flags, 0x4000 of the drawing flags, and 0x0800 up of
 * the marks.
 */
export const FLAG_BITS = new Map<string, [string, string]>([
  // The list flags.
  ["6:1", ["in contact", "not in contact"]],
  ["6:2", ["hit a fixed part", "didn't hit a fixed part"]],
  ["6:4", ["hit a moving part", "didn't hit a moving part"]],
  ["6:8", ["hit handled this step", "hit not handled this step"]],
  ["6:16", ["made during the run", "not made during the run"]],
  ["6:32", ["slides with more friction", "slides with normal friction"]],
  ["6:64", ["drawn as tiles", "not drawn as tiles"]],
  ["6:512", ["can be turned upside down", "can't be turned upside down"]],
  ["6:1024", ["can be mirrored", "can't be mirrored"]],
  ["6:2048", ["in the parts bin", "not in the parts bin"]],
  ["6:4096", ["on the moving list", "not on the moving list"]],
  ["6:8192", ["on the fixed list", "not on the fixed list"]],
  ["6:16384", ["fixed kind", "not a fixed kind"]],
  ["6:32768", ["placed by the puzzle", "not placed by the puzzle"]],
  // The drawing flags; the level file's mirror bits are kept here, for when the layout isn't read.
  ["8:1", ["takes a belt", "takes no belt"]],
  ["8:2", ["has a belt on", "has no belt on"]],
  ["8:4", ["takes a rope", "takes no rope"]],
  ["8:8", ["takes a rope at either end", "takes a rope at one place"]],
  ["8:16", ["mirrored", "not mirrored"]],
  ["8:32", ["upside down", "not upside down"]],
  ["8:64", ["ran this step", "not run this step"]],
  ["8:128", ["can be stretched sideways", "can't be stretched sideways"]],
  ["8:256", ["can be stretched up and down", "can't be stretched up and down"]],
  ["8:512", ["held this step", "not held this step"]],
  ["8:1024", ["known free this step", "not known free this step"]],
  ["8:2048", ["turns by itself", "doesn't turn by itself"]],
  ["8:4096", ["drawn from pieces", "not drawn from pieces"]],
  ["8:8192", ["out of play", "in play"]],
  ["8:32768", ["touches like a fixed part", "touches like a moving part"]],
  // The marks.
  ["10:1", ["has a plug", "has no plug"]],
  ["10:2", ["has sockets", "has no sockets"]],
  ["10:4", ["lightable", "not lightable"]],
  ["10:8", ["placed freely", "snaps to the grid"]],
  ["10:16", ["in a bucket", "not in a bucket"]],
  ["10:32", ["in the drawing layers", "not in the drawing layers"]],
  ["10:64", ["locked in the editor", "not locked in the editor"]],
  ...[0x0080, 0x0100, 0x0200, 0x0400].map((mask): [string, [string, string]] => [
    `10:${mask}`,
    ["goal mark set", "goal mark clear"],
  ]),
]);

/** The words for a bit of a flag word, from the analysis's names of its bits and the flags the program shows. */
function bitWordsOf(fields: readonly WriterField[], offset: number, mask: number): [string, string] | undefined {
  const masked = fields.find((f) => f.offset === offset)?.masks?.find((m) => m.value === mask);
  return (masked && MASK_WORDS[masked.name]) ?? FLAG_BITS.get(`${offset}:${mask}`);
}

/** The bits set in a flag word of the part record, in words, and the bits no name is known for. */
export function flagWords(
  offset: number,
  value: number,
  fields: readonly WriterField[] = [],
): { words: string[]; unknown: number } {
  const words: string[] = [];
  let unknown = 0;
  for (let bit = 1; bit <= 0x8000; bit <<= 1) {
    if (!(value & bit)) continue;
    const named = bitWordsOf(fields, offset, bit);
    if (named) words.push(named[0]);
    else unknown |= bit;
  }
  return { words, unknown };
}

/** The name of a word of the part record: the analysis's, else the lab's own, as the Behaviour tab says it. */
export function recordName(offset: number, fields: readonly WriterField[] = []): string | undefined {
  return fields.find((f) => f.offset === offset)?.name ?? PART_FIELDS.get(offset);
}

/** Flags the analysis names in its sentences with their bit after them, like "out-of-play flag 0x2000". */
const NAMED_FLAG = /\b(contact flag|out-of-play flag|ran-this-step mark|goal mark) 0x[0-9a-f]{4}\b/g;

/**
 * The fields of a rope record by offset: the parts at its two ends (the one in slot 0 holds the record), their rope
 * slot numbers, and the two ends' points, as the rope code reads them (`0x7996`).
 */
const ROPE_FIELDS = new Map([
  [0x02, "end0"],
  [0x04, "end1"],
  [0x0a, "end0Slot"],
  [0x0b, "end1Slot"],
  // A counter: rope callbacks add 1 to it for pull kind 1, and the teeter-totter adds or takes 1.
  [0x0e, "count"],
  [0x14, "end0X"],
  [0x16, "end0Y"],
  [0x18, "end1X"],
  [0x1a, "end1Y"],
]);

/** The flag words a sentence names, by the name it gives them. */
const FLAG_WORD_NAMES: Record<string, number> = { lists: 0x06, listFlags: 0x06, drawingFlags: 0x08, marks: 0x0a };

/**
 * The bracketed group that ends a value masked as `(group & mask)`, rewritten by `rewrite`, for every such mask in the
 * text: `((16 * x) & 0xffff) >> 1` with the mask left out reads `(16 * x) >> 1`. The group can hold brackets of its own.
 */
function rewriteMasked(text: string, mask: string, rewrite: (group: string) => string): string {
  const tail = ` & ${mask})`;
  for (let at = text.indexOf(tail); at >= 0; at = text.indexOf(tail, at + 1)) {
    let depth = 0;
    let open = -1;
    for (let k = at - 1; k >= 0; k--) {
      if (text[k] === ")") depth++;
      else if (text[k] === "(") {
        if (depth === 0) {
          open = k;
          break;
        }
        depth--;
      }
    }
    if (open < 0) continue;
    const group = text.slice(open + 1, at);
    const out = rewrite(group);
    text = text.slice(0, open) + out + text.slice(at + tail.length);
    at = open;
  }
  return text;
}

/**
 * A word compared as a signed number by flipping its top bit, `(x ^ 0x8000) >= -32766`, as the word compared as it is,
 * `x >= 2`, for every such compare in the text. The word can hold brackets of its own.
 */
function unflipCompares(text: string): string {
  const flip = / \^ 0x8000\) (>=|>|<=|<|==|!=) (-?\d+)/g;
  for (let m = flip.exec(text); m; m = flip.exec(text)) {
    let depth = 0;
    let open = -1;
    for (let k = m.index - 1; k >= 0; k--) {
      if (text[k] === ")") depth++;
      else if (text[k] === "(") {
        if (depth === 0) {
          open = k;
          break;
        }
        depth--;
      }
    }
    if (open < 0) continue;
    const value = (Number(m[2]) & 0xffff) ^ 0x8000;
    const out = `${text.slice(open + 1, m.index)} ${m[1]} ${value}`;
    text = text.slice(0, open) + out + text.slice(m.index + m[0].length);
    flip.lastIndex = open + out.length;
  }
  return text;
}

/** A group without the brackets around all of it, `(a + b)` as `a + b`. */
function unbracket(group: string): string {
  if (!group.startsWith("(") || !group.endsWith(")")) return group;
  let depth = 0;
  for (let k = 0; k < group.length; k++) {
    if (group[k] === "(") depth++;
    else if (group[k] === ")") depth--;
    if (depth === 0 && k < group.length - 1) return group;
  }
  return group.slice(1, -1);
}

/**
 * A sentence of the analysis as the lab shows it: a flag it names without its bit, a test of one flag bit by its name,
 * a value kept to a word without the mask, a position rounded down to a tile, and a field it calls by its offset, like
 * "field 0x28" or "its 0x26", by the name the lab gives that field.
 */
export function tidyWords<T extends string | undefined>(text: T): T {
  if (text === undefined) return text;
  let out: string = text;
  out = unflipCompares(rewriteMasked(out, "0xffff", (group) => group));
  out = rewriteMasked(out, "0xfff0", (group) => `(${unbracket(group)} rounded down to 16)`);
  return (
    out
      .replace(NAMED_FLAG, "$1")
      .replace(/\(([^()]*)\) & 0xfff0\b/g, "$1 rounded down to 16")
      .replace(/\b(\w+) & (0x[0-9a-f]+) is (not )?0\b/g, (all, name: string, mask: string, not?: string) => {
        const offset = FLAG_WORD_NAMES[name];
        const words = offset === undefined ? undefined : FLAG_BITS.get(`${offset}:${parseInt(mask, 16)}`);
        return words ? words[not ? 0 : 1] : all;
      })
      .replace(/ (of|from|after) the (query|call|scan|loop|insertion) at 0x[0-9a-f]+/g, " $1 the $2")
      .replace(/ \(the allocation at 0x[0-9a-f]+\)/g, "")
      // An address in the program says nothing in a sentence; the instructions in the tip have it.
      .replace(/ at 0x[0-9a-f]{4,5}\b/g, "")
      .replace(/\bcounter at (0x[0-9a-f]{2})\b/g, (all, offset: string) => {
        const name = PART_FIELDS.get(parseInt(offset, 16));
        return name ? `counter (its ${name})` : all;
      })
      .replace(/\bMovement 0x8000\b/g, "Movement -32768")
      .replace(
        /\b(?:field )?(0x[0-9a-f]{2}) of the record of (its rope at 0x66|the rope it is asked about)/g,
        (all, offset: string, rope: string) => {
          const name = ROPE_FIELDS.get(parseInt(offset, 16));
          return name ? `the ${name} of ${rope === "its rope at 0x66" ? "its rope" : rope}` : all;
        },
      )
      .replace(/\bits rope link at 0x66 or 0x68\b/g, "its first or second rope link")
      .replace(/\brope link (0x[0-9a-f]{2})\b/g, (all, offset: string) => PART_FIELDS.get(parseInt(offset, 16)) ?? all)
      .replace(/\b(byte|flags) at 0x[0-9a-f]{2}\b/g, "$1")
      .replace(/\bpart\.(0x[0-9a-f]{1,2})\b/g, (all, offset: string) => {
        const name = PART_FIELDS.get(parseInt(offset, 16));
        return name ? `part.${name}` : all;
      })
      .replace(/\bfield (0x[0-9a-f]{1,2})\b/g, (all, offset: string) => PART_FIELDS.get(parseInt(offset, 16)) ?? all)
      .replace(
        /\b(its|sets|changes|and|,) (0x[0-9a-f]{2})\b(?! of the record)/g,
        (all, before: string, offset: string) => {
          const name = PART_FIELDS.get(parseInt(offset, 16));
          return name ? `${before} ${name}` : all;
        },
      ) as T
  );
}

/**
 * The parts that set each goal mark on a part, by its type and bit as `type:bit`, from what other parts do to it: the
 * vacuum sets one on what it sucks up, Mel's House one on Mel. Only goal routines test the marks, so the parts that
 * set one are what it means.
 */
export function goalMarkSetters(effects: Record<number, OtherEffect[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [type, list] of Object.entries(effects))
    for (const e of list)
      for (const s of e.sets) {
        if (s.mark === undefined || s.value !== "set") continue;
        const key = `${type}:${s.mark}`;
        const by = out.get(key) ?? [];
        if (!by.includes(e.source)) by.push(e.source);
        out.set(key, by);
      }
  return out;
}

/** The flag words a goal's test names, by the name it gives them. */
const GOAL_FLAG_WORDS: Record<string, number> = {
  "field 0xa": 0x0a,
  "0xa": 0x0a,
  marks: 0x0a,
  "0x6": 0x06,
  listFlags: 0x06,
  "0x8": 0x08,
  drawingFlags: 0x08,
};

/**
 * A goal's test of one flag bit in words, for parts of the types given: a goal mark by the parts that set it, like
 * "field 0xa has the bits 0x100" as "marked by Vacuum", and any other bit by its name, like "part.drawingFlags hasn't
 * the bits 0x2000" as "part in play". A test of more than one bit, or of a bit without a name, stays as it is.
 */
export function goalMarkWords(text: string, types: readonly number[], setters: ReadonlyMap<string, string[]>): string {
  return text.replace(
    /\b(field 0xa|(?:part\.)?(?:listFlags|drawingFlags|marks|0x6|0x8|0xa)) (has|hasn't) the bits (0x[0-9a-f]+)\b/g,
    (all, place: string, has: string, bits: string) => {
      const bit = parseInt(bits, 16);
      const offset = GOAL_FLAG_WORDS[place.replace(/^part\./, "")];
      if (offset === undefined || !bit || bit & (bit - 1)) return all;
      const whose = place.startsWith("part.") ? "part " : "";
      if (offset === 0x0a) {
        const by = [...new Set(types.flatMap((t) => setters.get(`${t}:${bit}`) ?? []))];
        if (by.length) return `${whose}${has === "has" ? "" : "not "}marked by ${by.join(" or ")}`;
      }
      // A goal mark no part is seen to set, or not yet: the walks that say who sets it come last.
      const words = FLAG_BITS.get(`${offset}:${bit}`);
      return words ? `${whose}${words[has === "has" ? 0 : 1]}` : all;
    },
  );
}

/** Writes expressions and conditions as text, with the names of the part's fields. */
export function writer(
  fields: readonly WriterField[],
  /** Names that only hold for this part's own fields, like the gear's neighbours. */
  own: ReadonlyMap<number, string> = new Map(),
  /** The routine the expressions come from, when its argument has names: the rope callback's. */
  routine?: "rope",
) {
  const names = new Map([...PART_FIELDS, ...fields.map((f) => [f.offset, f.name] as const)]);
  /** A number in a formula, in decimal: a value the program keeps in a word or a long reads as the signed number. */
  const number = (n: number, width = 16) => {
    const bits = width > 0 && width <= 32 ? width : 16;
    const unsigned = n < 0 ? n + 2 ** bits : n;
    return String(unsigned >= 2 ** (bits - 1) ? unsigned - 2 ** bits : unsigned);
  };
  /** A number in a condition, in the style its place asks for. */
  const numberIn = (n: number, width: number, style: Numbers): string => {
    const bits = width > 0 && width <= 32 ? width : 16;
    const unsigned = n < 0 ? n + 2 ** bits : n;
    const signedValue = unsigned >= 2 ** (bits - 1) ? unsigned - 2 ** bits : unsigned;
    switch (style) {
      case "words":
        return number(n, width);
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
    if (table) return { name: "[table[…]]", kind: "other" };
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
    if (kind === "rope" && ROPE_FIELDS.has(offset)) return `${name}.${ROPE_FIELDS.get(offset)}`;
    if (kind === "outline") return `${name}[${offset >> 2}].${["x", "y", "edge", "edge"][offset & 3]}`;
    if (name === "this" && offset === 0) return "this";
    return raw;
  };
  const place = (target: string, offset: number) => {
    if (target === "data") return `ds:${hex(offset, 4)}`;
    // Whether a find-first loop found a part, and what a query answered, like whether a spot is blocked.
    if (offset === 0 && /^member found by the loop at 0x[0-9a-f]+ link$/.test(target)) return "found";
    const answer = /^answer of the query at (0x[0-9a-f]+)$/.exec(target);
    if (answer && offset === 0) return "the query's answer";
    // The angle from one part's centre to another's, which a call works out while the game runs.
    const angle = /^centre angle answer at (0x[0-9a-f]+)$/.exec(target);
    if (angle && offset === 0) return "the centre angle";
    // Whether a call that makes a part made one, and whether the gear's turn jams.
    const made = /^nullable allocation result at (0x[0-9a-f]+)$/.exec(target);
    if (made && offset === 0) return "the new part";
    const jam = /^gear connection conflict at (0x[0-9a-f]+)$/.exec(target);
    if (jam && offset === 0) return "the gear jam";
    // The part's own fields after a call that may change them, and at the start of a walk.
    const later = /^part after (the query|list scan) at (0x[0-9a-f]+)$/.exec(target);
    if (later)
      return `${field({ name: "", kind: "part" }, offset)} after the ${later[1] === "list scan" ? "scan" : "query"}`;
    if (target === "part at the walk's start")
      return `${field({ name: "", kind: "part" }, offset)} at the walk's start`;
    // A value a scan or a loop leaves in the routine's own stack.
    const local = /^local after (list scan|find-first loop) at (0x[0-9a-f]+)$/.exec(target);
    if (local) return `local ${offset} after the ${local[1] === "list scan" ? "scan" : "loop"}`;
    // The neighbours an ordered insertion links a part between, which only the run knows.
    const linked = /^(next|previous) in the ordered list after the insertion at (0x[0-9a-f]+)$/.exec(target);
    if (linked) return `${linked[1]} in the list after the insertion`;
    // What a search writes in the parts it finds: the next part in its found list, and the values it works out.
    if (/^next in the found list of the query at 0x[0-9a-f]+$/.test(target)) return "next found";
    const written = /^value the (query|call) at (0x[0-9a-f]+) writes to a (found|selected) part$/.exec(target);
    if (written) return `${field({ name: "", kind: "part" }, offset)} from the call`;
    const scanned = /^value after the list scan at (0x[0-9a-f]+) in (.+)$/.exec(target);
    if (scanned) return `${field(object(scanned[2]!), offset)} after the scan`;
    if (target === "stack") return `local ${offset}`;
    if (target === "argument") return (routine === "rope" && ROPE_ARGUMENTS.get(offset)) || `argument ${offset}`;
    return field(object(target), offset);
  };
  /** Whether a value is a direction word, like where a part was hit (0x0d98), or one with a turn added. */
  const isAngle = (e: Expression): boolean =>
    (e.kind === "field" && /(^|\.)contactAngle$/.test(place(e.object, e.offset))) ||
    (e.kind === "binary" &&
      (e.operator === "+" || e.operator === "-") &&
      isAngle(e.left) &&
      e.right.kind === "constant");
  /**
   * A flag word of a part with bits set, cleared or switched, like `drawingFlags ^ 0x10`, in words: "drawingFlags with
   * mirrored switched". Undefined when it is something else or a bit has no name.
   */
  const flagChange = (e: Expression): string | undefined => {
    const steps: string[] = [];
    let at = e;
    while (at.kind === "binary" && ["&", "|", "^"].includes(at.operator) && at.right.kind === "constant") {
      const value = at.right.value & 0xffff;
      const bits = at.operator === "&" ? ~value & 0xffff : value;
      if (!bits) return undefined;
      const names: string[] = [];
      for (let bit = 1; bit <= 0x8000; bit <<= 1) if (bits & bit) names.push(`${bit}`);
      steps.unshift(`${at.operator}:${names.join(",")}`);
      at = at.left;
    }
    if (!steps.length || at.kind !== "field" || ![0x06, 0x08, 0x0a].includes(at.offset)) return undefined;
    if (object(at.object).kind !== "part") return undefined;
    const field = at;
    const said: string[] = [];
    for (const step of steps) {
      const [operator, list] = step.split(":") as [string, string];
      const names = list.split(",").map((bit) => bitWordsOf(fields, field.offset, Number(bit))?.[0]);
      if (names.some((n) => n === undefined)) return undefined;
      const verb = operator === "|" ? "set" : operator === "&" ? "cleared" : "switched";
      said.push(`${names.join(" and ")} ${verb}`);
    }
    return `${place(field.object, field.offset)} with ${said.join(", then ")}`;
  };
  /**
   * The program's way to pick one of two values without a jump, `(a & (c * -1)) | (b & ((c * -1) ^ 0xffff))`: a when c
   * holds, else b. Undefined for anything else.
   */
  const pickOfTwo = (e: Extract<Expression, { kind: "binary" }>) => {
    if (e.operator !== "|" || e.left.kind !== "binary" || e.right.kind !== "binary") return undefined;
    if (e.left.operator !== "&" || e.right.operator !== "&") return undefined;
    const same = (a: Expression, b: Expression) => JSON.stringify(a) === JSON.stringify(b);
    /** `c * -1` (all bits when c holds), as c. */
    const all = (m: Expression) =>
      m.kind === "binary" &&
      m.operator === "*" &&
      m.right.kind === "constant" &&
      [-1, 0xffff, 0xffffffff].includes(m.right.value)
        ? m.left
        : undefined;
    const sides = [
      [e.left, e.right],
      [e.right, e.left],
    ] as const;
    for (const [one, other] of sides)
      for (const [value, mask] of [
        [one.left, one.right],
        [one.right, one.left],
      ] as const) {
        const condition = all(mask);
        if (!condition) continue;
        for (const [rest, notMask] of [
          [other.left, other.right],
          [other.right, other.left],
        ] as const)
          if (
            notMask.kind === "binary" &&
            notMask.operator === "^" &&
            notMask.right.kind === "constant" &&
            (notMask.right.value & 0xffff) === 0xffff &&
            same(notMask.left, mask)
          )
            return { condition, value, rest };
      }
    return undefined;
  };
  /** A mask that keeps the low bits, 3, 7, 15 and so on up to 255, as what it is: the rest after dividing. */
  const remainderOf = (mask: number) => (mask >= 3 && mask <= 0xff && (mask & (mask + 1)) === 0 ? mask + 1 : 0);
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
        // A word compared as a signed number by flipping its top bit, `(x ^ 0x8000) >= -32766`, is the word compared
        // as it is: x >= 2.
        if (
          ["<", "<=", ">", ">=", "==", "!="].includes(e.operator) &&
          e.right.kind === "constant" &&
          e.left.kind === "binary" &&
          e.left.operator === "^" &&
          e.left.right.kind === "constant" &&
          (e.left.right.value & 0xffff) === 0x8000
        ) {
          const text = `${expression(e.left.left, true)} ${e.operator} ${(e.right.value & 0xffff) ^ 0x8000}`;
          return nested ? `(${text})` : text;
        }
        if (style === "words") {
          // A word taken as signed, `(x ^ 0x8000) - 0x8000`, and a value kept to a word, `x & 0xffff`, read as the
          // value: the numbers are signed words already.
          if (
            e.operator === "-" &&
            e.right.kind === "constant" &&
            e.right.value === 0x8000 &&
            e.left.kind === "binary" &&
            e.left.operator === "^" &&
            e.left.right.kind === "constant" &&
            e.left.right.value === 0x8000
          )
            return expression(e.left.left, nested, style);
          if (e.operator === "&" && e.right.kind === "constant" && e.right.value >>> 0 === 0xffff) {
            if (e.left.width <= 16) return expression(e.left, nested, style);
            // The low or high word of a 32-bit value, like a product split in two.
            const high =
              e.left.kind === "binary" &&
              e.left.operator === ">>>" &&
              e.left.right.kind === "constant" &&
              e.left.right.value === 16;
            const whole = high && e.left.kind === "binary" ? e.left.left : e.left;
            const text = `the ${high ? "high" : "low"} word of ${expression(whole, true, style)}`;
            return nested ? `(${text})` : text;
          }
          // Rounding down to a multiple of 16, the size of a tile, like the explosion's reach.
          if (e.operator === "&" && e.right.kind === "constant" && e.right.value >>> 0 === 0xfff0)
            return `(${expression(e.left, false, style)} rounded down to 16)`;
          const changed = flagChange(e);
          if (changed) return nested ? `(${changed})` : changed;
          const picked = pickOfTwo(e);
          if (picked) {
            const text = `${expression(picked.value, true, style)} if ${expression(picked.condition, false, style)}, else ${expression(picked.rest, true, style)}`;
            return nested ? `(${text})` : text;
          }
          const divisor = e.operator === "&" && e.right.kind === "constant" ? remainderOf(e.right.value >>> 0) : 0;
          if (divisor) {
            const text = `${expression(e.left, true)} mod ${divisor}`;
            return nested ? `(${text})` : text;
          }
          const right =
            ["&", "|", "^"].includes(e.operator) && e.right.kind === "constant"
              ? e.right.value >>> 0 < 10
                ? String(e.right.value >>> 0)
                : hex(e.right.value >>> 0)
              : expression(e.right, true);
          const text = `${expression(e.left, true)} ${e.operator} ${right}`;
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
        // Low bits of a number that isn't a flag word, like `state & 3`, as the rest after dividing: "state mod 4".
        const flagWord = masked.left.kind === "field" && [0x06, 0x08, 0x0a].includes(masked.left.offset);
        const divisor =
          masked.operator === "&" && masked.right.kind === "constant" && !flagWord
            ? remainderOf(masked.right.value >>> 0)
            : 0;
        if (divisor) {
          const text = `${left} mod ${divisor}`;
          return nested ? `(${text})` : text;
        }
        let operator = masked.operator;
        let right =
          bitwise && masked.right.kind === "constant"
            ? masked.right.value >>> 0 < 10
              ? String(masked.right.value >>> 0)
              : hex(masked.right.value >>> 0)
            : expression(masked.right, true, shift ? "unsigned" : inner);
        if ((operator === "+" || operator === "-") && /^-\d/.test(right)) {
          operator = operator === "+" ? "-" : "+";
          right = right.slice(1);
        }
        const text = `${left} ${operator} ${right}`;
        return nested ? `(${text})` : text;
      }
      case "table":
        // Where the table is in the program says nothing in a formula; the instructions in the tip have it.
        return `table[${expression(e.index)}]`;
      case "unknown":
        return "unknown";
    }
  };
  const bitWords = (offset: number, mask: number) => bitWordsOf(fields, offset, mask);
  /**
   * A test of one named bit of a part's flags in words, like `drawingFlags & 0x10 == 0` as "not mirrored" and
   * `found.lists & 0x1000 != 0` as "found on the moving list"; undefined for any other test.
   */
  const bitTest = (p: Extract<Predicate, { kind: "compare" }>): string | undefined => {
    if (p.operator !== "==" && p.operator !== "!=") return undefined;
    const [tested, against] = p.right.kind === "constant" ? [p.left, p.right] : [p.right, p.left];
    if (against.kind !== "constant" || tested.kind !== "binary") return undefined;
    const folded = foldMask(tested);
    if (folded.kind !== "binary" || folded.operator !== "&" || folded.right.kind !== "constant") return undefined;
    const mask = folded.right.value >>> 0;
    if (!mask || (mask & (mask - 1)) !== 0) return undefined;
    const value = against.value >>> 0;
    if (value !== 0 && value !== mask) return undefined;
    // A bit flipped before the test, like `(drawingFlags ^ 0x10) & 0x10`, tests the other way.
    let flags = folded.left;
    let flipped = false;
    if (flags.kind === "binary" && flags.operator === "^" && flags.right.kind === "constant") {
      if ((flags.right.value & mask) !== 0) flipped = true;
      flags = flags.left;
    }
    if (flags.kind !== "field" || object(flags.object).kind !== "part") return undefined;
    const words = bitWords(flags.offset, mask);
    if (!words) return undefined;
    const set = ((p.operator === "!=") === (value === 0)) !== flipped;
    // The part the field belongs to, like "found" in "found.lists"; nothing for the part itself.
    const whose = object(flags.object).name;
    return `${whose ? `${whose} ` : ""}${words[set ? 0 : 1]}`;
  };
  /**
   * A test of the kind of pull a rope callback is asked about, in words: `ropeKind & 0x8006 == 4` as "pull kind 4, not
   * a question". The rope code (0x7996) gives kind 1, 2 or 4, with 8 or 16 for the side of the rope, and the teeter-
   * totter adds 0x8000 when it only asks (0x1d2a5).
   */
  const ropeTest = (p: Extract<Predicate, { kind: "compare" }>): string | undefined => {
    if (routine !== "rope" || (p.operator !== "==" && p.operator !== "!=")) return undefined;
    const [tested, against] = p.right.kind === "constant" ? [p.left, p.right] : [p.right, p.left];
    if (against.kind !== "constant") return undefined;
    const folded = tested.kind === "binary" ? foldMask(tested) : tested;
    const [field, mask] =
      folded.kind === "binary" && folded.operator === "&" && folded.right.kind === "constant"
        ? [folded.left, folded.right.value & 0xffff]
        : [folded, against.value & 0x8000 ? 0xffff : 0x7fff];
    if (field.kind !== "field" || field.object !== "argument" || field.offset !== 0x0c) return undefined;
    const value = against.value & 0xffff & mask;
    const kind = value & 0x7fff;
    const asks = (yes: boolean) => (yes ? "a question" : "not a question");
    if (!(mask & 0x8000)) return `pull kind ${p.operator === "==" ? "" : "isn't "}${kind}`;
    if (!(mask & 0x7fff)) return asks(!!(value & 0x8000) === (p.operator === "=="));
    const words = `pull kind ${kind}, ${asks(!!(value & 0x8000))}`;
    return p.operator === "==" ? words : `not (${words})`;
  };
  /**
   * A test of the top bit of a direction, `(contactAngle - 16384) & 0x8000 != 0`, as the half of the turn it is in:
   * "contactAngle from 270° to 90°". The top bit is set from 180° on, so a turn added moves that half.
   */
  const halfTurn = (p: Extract<Predicate, { kind: "compare" }>): string | undefined => {
    if (p.operator !== "==" && p.operator !== "!=") return undefined;
    const [tested, against] = p.right.kind === "constant" ? [p.left, p.right] : [p.right, p.left];
    if (against.kind !== "constant" || tested.kind !== "binary" || tested.operator !== "&") return undefined;
    if (tested.right.kind !== "constant" || (tested.right.value & 0xffff) !== 0x8000) return undefined;
    const value = against.value & 0xffff;
    if (value !== 0 && value !== 0x8000) return undefined;
    let angle = tested.left;
    let turn = 0;
    if (
      angle.kind === "binary" &&
      (angle.operator === "+" || angle.operator === "-") &&
      angle.right.kind === "constant"
    ) {
      turn = angle.operator === "+" ? angle.right.value : -angle.right.value;
      angle = angle.left;
    }
    if (!isAngle(angle) || angle.kind !== "field") return undefined;
    const set = (p.operator === "!=") === (value === 0);
    // The top bit of the angle plus the turn is set for angles from 0x8000 - turn up to 0x10000 - turn.
    const degrees = (n: number) => Number(((((n % 0x10000) + 0x10000) % 0x10000) * 360) / 0x10000).toFixed(2);
    const [from, to] = set ? [0x8000 - turn, 0x10000 - turn] : [-turn, 0x8000 - turn];
    const end = Number(degrees(to)) || 360;
    return `${place(angle.object, angle.offset)} from ${Number(degrees(from))}° to ${end}°`;
  };
  const predicate = (p: Predicate): string => {
    switch (p.kind) {
      case "true":
        return "always";
      case "compare": {
        const bit = bitTest(p);
        if (bit) return bit;
        const half = halfTurn(p);
        if (half) return half;
        const rope = ropeTest(p);
        if (rope) return rope;
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
    if (!driver.descriptions.includes(tidyWords(d.description))) driver.descriptions.push(tidyWords(d.description));
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
      activation: tidyWords(gear.activation),
      connections: tidyWords(gear.connections),
      conflict: tidyWords(gear.conflict),
      withoutConflict: tidyWords(gear.withoutConflict),
      withConflict: tidyWords(gear.withConflict),
      cycles: tidyWords(gear.cycles),
      scheduling: gear.scheduling.map((s) => tidyWords(s.description)),
      limits: gear.limits.map((l) => tidyWords(l)),
    },
  };
}

function summarisePart(
  part: PartBehaviour,
  fields: readonly WriterField[],
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
    outlineTables: summariseOutlineTables(part, report, finding),
  };
}

/** The tables the part's reset copies its outline from, with the flag bits that flip it, from the report's layout. */
function summariseOutlineTables(
  part: PartBehaviour,
  report: BehaviourReport,
  finding: (f: { confidence: Confidence; assumptions: string[]; evidence: Evidence[] }) => Finding,
): OutlineTablesSummary | undefined {
  const reset = part.routines.find((r) => roleOf(r.role) === "reset")?.address;
  const copy = report.outlineTables?.find((item) => item.routine === reset);
  if (!copy) return undefined;
  const masks = report.layout.fields.find((f) => f.name === "drawingFlags")?.masks ?? [];
  const bit = (name: string) => masks.find((m) => m.name === name)?.value;
  const horizontal = bit("horizontalFlip");
  const vertical = bit("verticalFlip");
  return {
    ...finding(copy),
    tables: copy.tables.map(({ when, corners }) => ({ when, corners })),
    flips: { ...(horizontal === undefined ? {} : { horizontal }), ...(vertical === undefined ? {} : { vertical }) },
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
        ? tidyWords(walk.stop?.description ?? walk.reason)
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
    // A hit walked from an input case needs both: the case, and what the hit itself tests, like the trampoline's
    // contactEdge == 0. The trigger's condition holds both for a hit; the same term is said once.
    condition: [...new Set([...termsOf(a.inputCondition, write), ...termsOf(a.trigger.condition, write)])],
    about: a.trigger.name,
    description: tidyWords(a.description),
  };
}

/** The writer for a part: with the names of the gear's neighbours when it is a gear. */
function partWriter(part: PartBehaviour, fields: readonly WriterField[], routine?: "rope") {
  const own = new Map(gearSlots(part).map((s) => [s.offset, s.name]));
  return writer(fields, own, routine);
}

/** The walks from the triggers of each part, by type, from the report's description. */
export function summariseWalks(report: BehaviourReport, description: BehaviourDescription): Record<number, Walk[]> {
  const fields = writerFields(report);
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
  const fields = writerFields(report);
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
        description: tidyWords(rest.description),
        ...(rest.reason ? { reason: rest.reason } : {}),
        resting: d.stableStates
          .map((stable): RestingFrame => {
            const conditions = [...new Set(stable.origins.map((o) => write.predicate(o.condition)))];
            const always = conditions.includes("always");
            return {
              confidence: stable.confidence,
              assumptions: stable.assumptions,
              evidence: instructions(stable.evidence),
              state: frameOf(stable.state),
              ...(stable.walks ? { walks: stable.walks } : {}),
              // A way without a test rests there always, so no other way's condition is needed.
              conditions: always ? [] : conditions,
              ...(always ? { always: true as const } : {}),
              ways: stable.walks ?? stable.origins.length,
              ...((stable.walks ?? 0) > stable.origins.length ? { capped: true as const } : {}),
            };
          })
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
export function summariseDoings(report: BehaviourReport, description: BehaviourDescription): Record<number, Doing[]> {
  const fields = writerFields(report);
  const parts = new Map(report.parts.map((p) => [p.type, p]));
  return Object.fromEntries(
    description.parts.map((d) => {
      const part = parts.get(d.type);
      const write = part ? partWriter(part, fields) : writer(fields);
      // The rope callback's own findings name what the rope code passes it.
      const rope = part ? partWriter(part, fields, "rope") : write;
      const ropeRoutines = new Set(part?.routines.filter((r) => roleOf(r.role) === "rope").map((r) => r.address));
      const writerOf = (routine?: number) => (routine !== undefined && ropeRoutines.has(routine) ? rope : write);
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
        // When it does it: a way through its routines can need a test, like the gun's mirrored bullet.
        const conditions = (e.conditions ?? (e.condition ? [e.condition] : [])).map((c) =>
          writerOf(e.routine).predicate(c),
        );
        for (const sentence of sentences) {
          const line = lines.get(sentence);
          if (line) {
            line.ways++;
            for (const c of conditions) if (!line.conditions.includes(c)) line.conditions.push(c);
            if (e.confidence === "unresolved" || (e.confidence === "inferred" && line.confidence === "checked"))
              line.confidence = e.confidence;
            // The line stands on every way, so it keeps what each way assumes and the instructions that show it.
            for (const a of e.assumptions) if (!line.assumptions.includes(a)) line.assumptions.push(a);
            for (const i of instructions(e.evidence))
              if (line.evidence.length < MAX_EVIDENCE && !line.evidence.some((x) => x.address === i.address))
                line.evidence.push(i);
            continue;
          }
          lines.set(sentence, {
            confidence: e.confidence,
            // A copy, so adding another way's assumptions leaves the report as it is.
            assumptions: [...e.assumptions],
            evidence: instructions(e.evidence),
            on,
            description: tidyWords(sentence),
            ways: 1,
            conditions: [...new Set(conditions)],
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
): { what: string; value: string; mark?: number } {
  const flag = /^(sets|clears) its (.+?) (0x[0-9a-f]{4}) in /.exec(s.words);
  if (flag) {
    // The row names the part that sets it, so a goal mark needs no bit; the bit stays for naming the mark elsewhere.
    const value = flag[1] === "sets" ? "set" : "cleared";
    return flag[2] === "goal mark"
      ? { what: "goal mark", value, mark: parseInt(flag[3]!, 16) }
      : { what: flag[2]!, value };
  }
  const fine = FINE.get(s.offset);
  const word = / to the (low|high) word of (.+)$/.exec(s.words);
  if (fine && word) return { what: `${fine} ${word[1]}`, value: word[2]! };
  const field = write.place("part", s.offset);
  // A number or a formula added, like the fan's push: "adds 16 * (256 - |overlapX|) to velocityX, kept within its speed
  // limit".
  const added = /^(adds|subtracts) (.+) (?:to|from) (?:field 0x[0-9a-f]+|\w+)(, kept within its speed limit)?$/.exec(
    s.words,
  );
  if (added)
    return {
      what: field,
      value: tidyWords(`${field} ${added[1] === "adds" ? "+" : "-"} ${added[2]}${added[3] ?? ""}`),
    };
  if (/^keeps (?:field 0x[0-9a-f]+|\w+) within its speed limit$/.test(s.words))
    return { what: field, value: "kept within its speed limit" };
  if (/^halves /.test(s.words)) return { what: field, value: "halved, rounding down" };
  if (/^reverses /.test(s.words)) return { what: field, value: "reversed" };
  const to = /^sets (?:field 0x[0-9a-f]+|\w+) to (.+)$/.exec(s.words);
  return { what: field, value: to ? tidyWords(to[1]!) : write.expression(s.value) };
}

/** Both words of the fine position that one value sets, as one: "fine Y" rather than its low and high word. */
function joinFine(sets: OtherEffect["sets"]) {
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

/**
 * Effects that say the same, from the same part, as one: the analysis keeps a line for each test its source makes (the
 * jack-in-the-box's push on each of its frames), and the row keeps each of those conditions. It is as sure as the
 * least sure of them, and keeps what each assumes and the instructions that show it.
 */
function joinSameEffects(effects: OtherEffect[]): OtherEffect[] {
  const joined = new Map<string, OtherEffect>();
  for (const e of effects) {
    const key = JSON.stringify([e.sourceType, e.touch, e.sets, e.when, e.sourceWhen, e.cases, e.description]);
    const line = joined.get(key);
    if (!line) {
      joined.set(key, { ...e, assumptions: [...e.assumptions], evidence: [...e.evidence] });
      continue;
    }
    for (const c of e.sourceConditions) if (!line.sourceConditions.includes(c)) line.sourceConditions.push(c);
    if (e.confidence === "unresolved" || (e.confidence === "inferred" && line.confidence === "checked"))
      line.confidence = e.confidence;
    for (const a of e.assumptions) if (!line.assumptions.includes(a)) line.assumptions.push(a);
    for (const i of e.evidence)
      if (line.evidence.length < MAX_EVIDENCE && !line.evidence.some((x) => x.address === i.address))
        line.evidence.push(i);
    if (e.awayWithin !== undefined) line.awayWithin = Math.max(line.awayWithin ?? 0, e.awayWithin);
  }
  return [...joined.values()];
}

/** What other parts do to each part without changing its frame, by type, from the report's description. */
export function summariseEffects(
  report: BehaviourReport,
  description: BehaviourDescription,
): Record<number, OtherEffect[]> {
  const fields = writerFields(report);
  const write = writer(fields);
  const signedText = (n: number) => String(n > 0x7fff ? n - 0x10000 : n);
  return Object.fromEntries(
    description.parts.map((d) => [
      d.type,
      joinSameEffects(
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
            when: e.conditionWords.map((w) => tidyWords(w.replace(/^on the /, ""))),
            sourceWhen: e.sourceConditionWords.map(tidyWords),
            sourceConditions: [write.predicate(e.sourceCondition)],
            ...(e.cases ? { cases: e.cases.map((c) => tidyWords(c.words)) } : {}),
            ...(e.searched?.length ? { searched: e.searched.map((offset) => write.place("part", offset)) } : {}),
            description: e.description,
          };
        }),
      ),
    ]),
  );
}

/** The summary of a behaviour report, for the lab. */
export function summariseBehaviour(report: BehaviourReport): BehaviourSummary {
  const fields = report.layout.fields.map(({ offset, name, confidence, masks }) => ({
    offset,
    name,
    confidence,
    ...(masks ? { masks } : {}),
  }));
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
    parts: Object.fromEntries(
      report.parts.map((p) => [p.type, summarisePart(p, writerFields(report), stateOffset, report)]),
    ),
    assumptions: report.assumptions,
  };
}

/**
 * A run of frames as short text, like "0–2". A run that starts below 0, like the wood incline's -1 to 3, says "to":
 * "-1–3" reads like a subtraction.
 */
export const rangeText = (start: number, end: number): string => (start < 0 ? `${start} to ${end}` : `${start}–${end}`);

/** The states as short text, like "0–2, 4", or "-1 to 3". */
export function statesText(states: readonly number[] | null): string {
  if (!states) return "any";
  if (!states.length) return "none";
  const runs: string[] = [];
  for (let i = 0; i < states.length; i++) {
    let j = i;
    while (j + 1 < states.length && states[j + 1] === states[j]! + 1) j++;
    runs.push(j > i ? rangeText(states[i]!, states[j]!) : String(states[i]));
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
      /**
       * Whether the loops over the parts a part finds were read once for each type a found part can have, which gives
       * more of what other parts do to it, like the vacuum cleaner's pull. That takes longest, so it comes last.
       */
      perType: boolean;
      /** Why the loops couldn't be read per type, when that failed after these walks came: no more lines will come. */
      perTypeError?: string;
    }
  | { status: "error"; message: string };

/**
 * The walks to show once the loops per type were read: the new walks, or when that failed, the first walks with why,
 * so they no longer show as still being read.
 */
export function walksAfterPerType(
  first: WalksResult | { status: "reading" } | undefined,
  perType: WalksResult,
): WalksResult | { status: "reading" } | undefined {
  if (perType.status === "done") return perType;
  return first?.status === "done" ? { ...first, perTypeError: perType.message } : first;
}

/** Whether the loops over found parts are still being read per type, which can add what other parts do. */
export function readingPerType(walks: WalksResult | { status: "reading" } | undefined): boolean {
  return walks?.status === "done" && !walks.perType && walks.perTypeError === undefined;
}

/** Every puzzle's goal, read from the program once its behaviour is read, since the goals are named with it. */
export type GoalsResult =
  { status: "done"; goals: PuzzleGoal[]; seconds: number } | { status: "error"; message: string };

/** What the worker is asked: the program as it ships, and what was read from it before. */
export interface BehaviourRequest {
  program: Uint8Array;
  parts: ProgramParts;
}

/**
 * What the worker answers: first the behaviour, then the goals, then the walks, then the walks again with the loops read
 * per type.
 */
export type BehaviourMessage =
  | { kind: "progress"; step: number; done: number; total: number }
  | { kind: "behaviour"; result: BehaviourResult }
  | { kind: "goals"; result: GoalsResult }
  | { kind: "walks"; result: WalksResult }
  | { kind: "per type"; result: WalksResult };

/**
 * The steps of a read in the background, in the order the worker takes them, with about how much of the whole time
 * each takes (seconds on Even More, English floppy): the first goes type by type, the walks part by part, the fourth
 * loop by loop.
 */
export const READ_STEPS = [
  { name: "Reading the parts’ code", share: 13 },
  { name: "Reading the goals", share: 0.2 },
  { name: "Following the walks", share: 95 },
  { name: "Reading what other parts do to each type", share: 25 },
  { name: "Following the walks again", share: 99 },
] as const;

/** Where a read in the background is: its step, and how many of the step's items are done; `finished` at its end. */
export type ReadProgressEvent =
  { program: Uint8Array; step: number; done: number; total: number } | { program: Uint8Array; finished: true };

const progressListeners = new Set<(e: ReadProgressEvent) => void>();
/** Tells a listener where every read in the background is, as it goes on; returns how to stop. */
export function onReadProgress(listener: (e: ReadProgressEvent) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}
const tellProgress = (e: ReadProgressEvent) => progressListeners.forEach((l) => l(e));

/** The behaviour and the walks of a program, once per program: a later call gets the same answers, unless one failed. */
const results = new WeakMap<Uint8Array, BehaviourReading>();

/** The answers of a read in the background, each as it comes. */
export interface BehaviourReading {
  result: Promise<BehaviourResult>;
  goals: Promise<GoalsResult>;
  walks: Promise<WalksResult>;
  perType: Promise<WalksResult>;
}

/** How to stop the read of a program while its worker still runs. */
const running = new Map<Uint8Array, (message: string) => void>();

/**
 * Stops the read of a program that was replaced, so its worker doesn't keep going for answers nobody needs. Its
 * promises end with an error and it isn't kept, so reading the program again starts over.
 */
export function stopBehaviourRead(program: Uint8Array): void {
  running.get(program)?.("The program was replaced.");
}

/**
 * Reads the behaviour of a program in a worker, then the walks from its triggers, then the walks again with the loops
 * over found parts read per type. The behaviour comes first, so it can show while the rest is still being read.
 */
export function readBehaviourInBackground(program: Uint8Array, parts: ProgramParts): BehaviourReading {
  let reading = results.get(program);
  if (!reading) {
    let resolveResult!: (r: BehaviourResult) => void;
    let resolveGoals!: (r: GoalsResult) => void;
    let resolveWalks!: (r: WalksResult) => void;
    let resolvePerType!: (r: WalksResult) => void;
    reading = {
      result: new Promise((resolve) => (resolveResult = resolve)),
      goals: new Promise((resolve) => (resolveGoals = resolve)),
      walks: new Promise((resolve) => (resolveWalks = resolve)),
      perType: new Promise((resolve) => (resolvePerType = resolve)),
    };
    let worker: Worker | undefined;
    const end = () => {
      tellProgress({ program, finished: true });
      worker?.terminate();
      if (running.get(program) === stop) running.delete(program);
    };
    const stop = (message: string) => {
      resolveResult({ status: "error", message });
      resolveGoals({ status: "error", message });
      resolveWalks({ status: "error", message });
      resolvePerType({ status: "error", message });
      end();
      if (results.get(program) === reading) results.delete(program);
    };
    results.set(program, reading);
    running.set(program, stop);
    // Starting the worker or sending it the program can throw too, which ends the read like an error in the worker.
    try {
      worker = new Worker(new URL("./behaviour.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }: MessageEvent<BehaviourMessage>) => {
        if (data.kind === "progress") {
          tellProgress({ program, step: data.step, done: data.done, total: data.total });
        } else if (data.kind === "behaviour") {
          resolveResult(data.result);
          if (data.result.status === "error") stop(data.result.message);
        } else if (data.kind === "goals") {
          // Goals that can't be read don't stop the walks.
          resolveGoals(data.result);
        } else if (data.kind === "walks") {
          resolveWalks(data.result);
          if (data.result.status === "error") stop(data.result.message);
        } else {
          resolvePerType(data.result);
          end();
        }
      };
      // Settling a promise again does nothing, so a failure after the behaviour came only fails the walks.
      worker.onerror = (e) => stop(e.message || "The analysis stopped.");
      worker.postMessage({ program, parts } satisfies BehaviourRequest);
    } catch (e) {
      stop(e instanceof Error ? e.message : "The analysis couldn’t start.");
    }
    // A failed read isn't kept, so a later call tries again. Goals that can't be read stay the same on every try, and
    // the worker goes on with the walks after them, so they keep the read.
    const forget = (r: { status: string }) => {
      if (r.status === "error" && results.get(program) === reading) results.delete(program);
    };
    void reading.result.then(forget);
    void reading.walks.then(forget);
    void reading.perType.then(forget);
  }
  return reading;
}
