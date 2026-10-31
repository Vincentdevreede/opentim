/**
 * The behaviour of the parts, read from `TIM.EXE` by `@opentim/content` without running it, made small enough to show
 * in the lab: findings keep their confidence and the addresses of their instructions, and expressions become text.
 */

import type {
  BehaviourReport,
  Confidence,
  Evidence,
  Expression,
  FieldWrite,
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

export interface PartSummary {
  routines: Routine[];
  changes: Change[];
  triggers: Trigger[];
  counters: Counter[];
  reset: Write[];
  effects: Write[];
  uncertainties: string[];
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

/** Writes expressions and conditions as text, with the names of the part's fields. */
export function writer(fields: readonly { offset: number; name: string }[]) {
  const names = new Map(fields.map((f) => [f.offset, f.name]));
  const number = (n: number) => (n >= 0 && n < 100 ? String(n) : n < 0 && n > -100 ? String(n) : hex(n >>> 0));
  const place = (object: string, offset: number) => {
    if (object === "part") return names.get(offset) ?? `part+${hex(offset, 2)}`;
    if (object === "data") return `ds:${hex(offset, 4)}`;
    if (object === "stack") return `local ${offset < 0 ? "-" : "+"}${hex(Math.abs(offset), 2)}`;
    if (object === "argument") return `argument+${hex(offset, 2)}`;
    const linked = /^referenced-by\((.+)\)$/.exec(object);
    const field = names.get(offset) ?? `+${hex(offset, 2)}`;
    return linked ? `[${linked[1]}].${field}` : `${object}+${hex(offset, 2)}`;
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

/** The short role of a routine, like `run` for "run callback candidate". */
const roleOf = (role: string) => role.replace(/ callback candidate$/, "");

function summarisePart(part: PartBehaviour, write: ReturnType<typeof writer>, stateOffset: number): PartSummary {
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
  };
}

/** The summary of a behaviour report, for the lab. */
export function summariseBehaviour(report: BehaviourReport): BehaviourSummary {
  const fields = report.layout.fields.map(({ offset, name, confidence }) => ({ offset, name, confidence }));
  const write = writer(fields);
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
    parts: Object.fromEntries(report.parts.map((p) => [p.type, summarisePart(p, write, stateOffset)])),
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

/** What the worker is asked: the program as it ships, and what was read from it before. */
export interface BehaviourRequest {
  program: Uint8Array;
  parts: ProgramParts;
}

/** The behaviour of a program, once per program: a later call gets the same answer. */
const results = new WeakMap<Uint8Array, Promise<BehaviourResult>>();

/** Reads the behaviour of a program in a worker. */
export function readBehaviourInBackground(program: Uint8Array, parts: ProgramParts): Promise<BehaviourResult> {
  let result = results.get(program);
  if (!result) {
    result = new Promise((resolve) => {
      const worker = new Worker(new URL("./behaviour.worker.ts", import.meta.url), { type: "module" });
      const done = (r: BehaviourResult) => {
        resolve(r);
        worker.terminate();
      };
      worker.onmessage = ({ data }: MessageEvent<BehaviourResult>) => done(data);
      worker.onerror = (e) => done({ status: "error", message: e.message || "The analysis stopped." });
      worker.postMessage({ program, parts } satisfies BehaviourRequest);
    });
    results.set(program, result);
  }
  return result;
}
