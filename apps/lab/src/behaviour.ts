/**
 * The behaviour of the parts, read from `TIM.EXE` by `@opentim/content` without running it, made small enough to show
 * in the lab: findings keep their confidence and the addresses of their instructions, and expressions become text.
 */

import { describeGear } from "@opentim/content";
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
  /** What it sets, like `speed` or `velocity`, and to what, as text. */
  sets: { what: string; value: string }[];
  /** For a speed that points away from the other part: the largest error of that direction, in degrees. */
  awayWithin?: number;
  /** What this part must be, in a few words, like `moving list`. */
  when: string[];
  /** What the source must be, in a few words, like `mirrored`, and its whole condition as text. */
  sourceWhen: string[];
  sourceCondition: string;
  /** The analysis's own sentence. */
  description: string;
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

/** Writes expressions and conditions as text, with the names of the part's fields. */
export function writer(
  fields: readonly { offset: number; name: string }[],
  /** Names that only hold for this part's own fields, like the gear's neighbours. */
  own: ReadonlyMap<number, string> = new Map(),
) {
  const names = new Map([...PART_FIELDS, ...fields.map((f) => [f.offset, f.name] as const)]);
  const number = (n: number) => (n >= 0 && n < 100 ? String(n) : n < 0 && n > -100 ? String(n) : hex(n >>> 0));
  /** An object the analysis names, as text and the kind of thing it is. */
  const object = (text: string): { name: string; kind: Kind } => {
    // The same object read after a call that may have changed it.
    const after = / after (unresolved write|unresolved effect|field effect) at 0x[0-9a-f]+$/.exec(text);
    if (after) return object(text.slice(0, after.index));
    if (text === "part") return { name: "", kind: "part" };
    if (text === "collider") return { name: "collider", kind: "part" };
    if (text === "address of part") return { name: "this", kind: "other" };
    if (/^overlap candidate at /.test(text)) return { name: "found", kind: "part" };
    // The part a find-first loop stopped at, like the mouse the cat looks at.
    if (/^member found by the loop at 0x[0-9a-f]+$/.test(text)) return { name: "found", kind: "part" };
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
    if (target === "stack") return `local ${offset < 0 ? "-" : "+"}${hex(Math.abs(offset), 2)}`;
    if (target === "argument") return `argument+${hex(offset, 2)}`;
    return field(object(target), offset);
  };
  const expression = (e: Expression, nested = false): string => {
    switch (e.kind) {
      case "constant":
        return number(e.value);
      case "field":
        return place(e.object, e.offset);
      case "binary": {
        const text = `${expression(e.left, true)} ${e.operator} ${expression(e.right, true)}`;
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
      case "compare":
        return `${expression(p.left)} ${p.operator} ${expression(p.right)}`;
      case "and":
        return p.terms.map(predicate).join(" and ");
      case "unknown":
        return "unknown";
    }
  };
  return { expression, predicate, place };
}

const signed = (n: number) => (n > 0x7fff ? n - 0x10000 : n);

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
  write: ReturnType<typeof writer>,
  stateOffset: number,
  report: BehaviourReport,
): PartSummary {
  const roles = new Map(part.routines.map((r) => [r.address, roleOf(r.role)]));
  const routineName = (address: number) => roles.get(address) ?? hex(address, 5);
  const finding = (f: { confidence: Confidence; assumptions: string[]; evidence: Evidence[] }): Finding => ({
    confidence: f.confidence,
    assumptions: f.assumptions,
    evidence: instructions(f.evidence),
  });
  const writeOf = (w: FieldWrite): Write => ({
    ...finding(w),
    routine: routineName(w.routine),
    target: write.place(w.object, w.offset),
    value: write.expression(w.value),
    condition: write.predicate(w.condition),
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
        from: t.from,
        to: write.expression(t.to),
        toState: t.to.kind === "constant" ? t.to.value : undefined,
        targets: targetsOf(t.to, t.from, stateOffset),
        keeps,
        condition: write.predicate(t.condition),
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
        condition: t.condition && write.predicate(t.condition),
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
  const frames = walk.frames.map((f) => f.state);
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
function walksOf(animations: readonly AnimationDescription[], write: ReturnType<typeof writer>): Walk[] {
  return animations.map((a) => ({
    ...pathOf(a.walk, write),
    trigger:
      a.trigger.kind === "run" || a.trigger.kind === "input-case"
        ? "run"
        : a.trigger.kind === "related-write"
          ? // Another part's routine writes this one, like "A recorded effect of explosion".
            a.trigger.name.replace(/^A recorded effect of /, "by ")
          : roleOf(a.trigger.name),
    start: a.initial,
    condition: termsOf(a.inputCondition ?? a.trigger.condition, write),
    about: a.trigger.name,
    description: a.description,
  }));
}

/** The writer for a part: with the names of the gear's neighbours when it is a gear. */
function partWriter(part: PartBehaviour, fields: readonly { offset: number; name: string }[]) {
  const own = new Map(gearSlots(part).map((s) => [s.offset, s.name]));
  return writer(fields, own);
}

/** The walks from the triggers of each part, by type, from the report's description. */
export function summariseWalks(report: BehaviourReport, description: BehaviourDescription): Record<number, Walk[]> {
  const fields = report.layout.fields.map(({ offset, name }) => ({ offset, name }));
  const animations = new Map(description.parts.map((d) => [d.type, d.animations]));
  return Object.fromEntries(
    report.parts.map((p) => [p.type, walksOf(animations.get(p.type) ?? [], partWriter(p, fields))]),
  );
}

/** The largest error of a speed that points away from the other part, when one does. */
function awayWithin(sets: OtherPartEffect["sets"]): { awayWithin?: number } {
  const degrees = sets.flatMap((s) => (s.kind === "speed" && s.away ? [s.away.degrees] : []));
  return degrees.length ? { awayWithin: Math.max(...degrees) } : {};
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
        const pair = x && y ? [{ what: "velocity", value: `${signedText(x.value)}, ${signedText(y.value)}` }] : [];
        const sets = [
          ...pair,
          ...e.sets.flatMap((s) =>
            s.kind === "speed"
              ? [{ what: s.away ? "speed away" : "speed", value: String(s.speed) }]
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
          sets,
          when: e.conditionWords.map((w) => w.replace(/^on the /, "")),
          sourceWhen: e.sourceConditionWords,
          sourceCondition: write.predicate(e.sourceCondition),
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
    parts: Object.fromEntries(
      report.parts.map((p) => [p.type, summarisePart(p, partWriter(p, fields), stateOffset, report)]),
    ),
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
  | { status: "done"; walks: Record<number, Walk[]>; effects: Record<number, OtherEffect[]>; seconds: number }
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
