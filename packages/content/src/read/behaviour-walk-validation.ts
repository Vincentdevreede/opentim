/** Compares independently described frame walks with saved recordings. Recordings never seed a description. */
import type { BehaviourReport, Predicate } from "./behaviour.ts";
import type { MeasuredClip } from "./behaviour-validation.ts";
import {
  evaluateBehaviourCondition,
  type AnimationDescription,
  type BehaviourWalk,
  type KnownField,
  type PartBehaviourDescription,
  START,
  walkBehaviourRules,
  WIDENING_ASSUMPTION,
} from "./describe-behaviour.ts";

export interface DescribedWalkMatch {
  clip: string;
  classification: "complete" | "prefix" | "different" | "unavailable";
  basis: "reset-or-rest" | "creation" | "trigger" | "input-case" | "unavailable";
  measuredFrames: number;
  measuredTransitions: number;
  prefixFrames: number;
  animation?: string;
  conditionCompatibility: "established" | "unresolved" | "conditional-event";
  reason: string;
  evidenceAddresses: number[];
}
export interface DescribedWalkCoverage {
  clips: number;
  oneFrameClips: number;
  complete: number;
  prefix: number;
  different: number;
  unavailable: number;
  completeFromCreation: number;
  completeFromTriggers: number;
  completeFromResetOrRest: number;
  completeFromInputCases: number;
  matches: DescribedWalkMatch[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * The v25 recording adapter names the fields it actually saved. Flags are masked in the recording. No other
 * fields, including zeros from its old artificial objects, are supplied to this compatibility check.
 */
function recordedFields(report: BehaviourReport | undefined, clip: MeasuredClip): RecordedField[] {
  const seed = object(clip.input.seed) ? clip.input.seed : {};
  const write = recorderWrite(clip, 0);
  return [...namedFields(report, { ...clip.partSeed, ...seed, ...clip.frames[0], ...write }), RECORDER_CONTACT];
}
/** The part fields the recorder names, with the values given for them. Its flags are masked as it saves them. */
function namedFields(report: BehaviourReport | undefined, values: Record<string, unknown>): RecordedField[] {
  const state = report?.layout.fields.find((field) => field.name === "state")?.offset ?? 12;
  const delta = report?.layout.fields.find((field) => field.name === "stateDelta")?.offset ?? 18;
  const fields = [
    ["state", state],
    ["control", delta],
    ["timer", 0x96],
    ["heat", 0x9c],
    ["vx", 0x36],
    ["vy", 0x38],
    ["flags8", 8],
  ] as const;
  return fields.flatMap(([name, offset]) => {
    const value = values[name];
    return typeof value === "number" && offset !== undefined
      ? [{ object: "part", offset, width: 16, value, knownMask: name === "flags8" ? 0x3030 : 0xffff }]
      : [];
  });
}
/** The fields a recorder frame saves in full, so a write of the same value there changes nothing. */
const SAVED_IN_FULL = new Set(["state", "control", "timer", "heat"]);
/**
 * What the v25 recorder writes before the run at `tick` (`clip` in `research/v24/verify_animations.py`): its hold
 * values before `holdTicks`, or on every run without it, and its release values at `holdTicks` (the control value 0
 * when it names none). The write at tick 0 is part of the clip's starting fields.
 */
function recorderWrite(clip: MeasuredClip, tick: number): Record<string, number> | undefined {
  const { hold, holdTicks, release } = clip.input;
  if (!object(hold)) return undefined;
  const values =
    typeof holdTicks !== "number" || tick < holdTicks
      ? hold
      : tick === holdTicks
        ? object(release)
          ? release
          : { control: 0 }
        : undefined;
  return (
    values &&
    Object.fromEntries(
      Object.entries(values).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    )
  );
}
/** A run where the recorder writes an input again: the walk restarts there from these fields. */
interface Restart {
  run: number;
  fields: RecordedField[];
}
type Restarts = { restarts: Restart[]; forever: boolean } | { unsupported: string };
/**
 * The runs after the first where the recorder's write changes the part, with the fields the recording gives there:
 * the frame it saved before the write, with the written values over it. A write of the value the saved frame already
 * shows changes nothing, so the walk goes on through it. A recorder that writes on every run must have recorded a
 * cycle: it found the same fields after the write there, so from the end of the recording on, every run is a restart
 * from the fields of the run its cycle repeats.
 */
function recorderRestarts(report: BehaviourReport | undefined, clip: MeasuredClip): Restarts {
  if (!object(clip.input.hold)) return { restarts: [], forever: false };
  const { frames, loopStart } = clip,
    count = frames.length,
    forever = typeof clip.input.holdTicks !== "number";
  if (forever && loopStart === null)
    return { unsupported: "The recorder writes on every run, and the recording ends without a repeating cycle." };
  const period = loopStart === null ? 1 : count - loopStart;
  const last = forever ? count + period - 1 : (clip.input.holdTicks as number);
  const restarts: Restart[] = [];
  for (let run = 1; run <= last; run++) {
    const write = recorderWrite(clip, run);
    if (!write || !Object.keys(write).length) continue;
    if (run >= count && !forever) return { unsupported: "The recorder writes again after the recording's last frame." };
    const saved = run < count ? frames[run]! : frames[loopStart! + ((run - loopStart!) % period)]!;
    const unchanged =
      run < count &&
      Object.entries(write).every(
        ([name, value]) =>
          SAVED_IN_FULL.has(name) && typeof saved[name] === "number" && wrap16(saved[name]) === wrap16(value),
      );
    if (!unchanged) restarts.push({ run, fields: namedFields(report, { ...saved, ...write }) });
  }
  if (!forever && restarts.length && loopStart !== null && loopStart < restarts.at(-1)!.run)
    return { unsupported: "The recorded cycle starts before the recorder's last write." };
  return { restarts, forever };
}
/**
 * The recorder puts each part alone on an empty bench, touching nothing. The contact bits of the list flags at `0x06`
 * are the ones the contact dispatch tests before it calls a bounce callback (`0x0002` at `0x1071`, `0x0004` at
 * `0x10b5`) and to pick the response (`0x0001` at `0x1096`, Even More English floppy). Decided with the user: a
 * recording starts with them clear. Like every recorded field, it only rules out ways at the start.
 */
const RECORDER_CONTACT: RecordedField = { object: "part", offset: 0x06, width: 16, value: 0, knownMask: 0x0007 };
function stateAt(walk: BehaviourWalk, index: number, parameter: number): number | undefined {
  if (walk.parameterised?.kind === "hold") return parameter;
  if (walk.parameterised?.kind === "cycle") {
    const { period, direction } = walk.parameterised,
      base = Math.floor(parameter / period) * period;
    return base + ((((parameter - base + direction * index) % period) + period) % period);
  }
  if (index < walk.states.length) return walk.states[index];
  if (walk.status === "rest") return walk.states.at(-1);
  if (walk.status !== "loop" || walk.loopStart === undefined) return undefined;
  const period = walk.states.length - 1 - walk.loopStart;
  return period > 0 ? walk.states[walk.loopStart + ((index - walk.loopStart) % period)] : undefined;
}
type RecordedField = Pick<KnownField, "object" | "offset" | "width" | "value" | "knownMask">;
const wrap16 = (value: number) => ((value % 0x10000) + 0x10000) % 0x10000;

/** What the paths of a walk tree that the recording allows do, summed up. */
interface TreeOutcome {
  /** The fewest frames matched by a path whose continuation the tree leaves open, and why it is open. */
  open?: { frames: number; reason: string };
  /** The most frames matched by a path that then shows another frame than the recording. */
  differs?: { frames: number; index: number; predicted: number; recorded: number };
  /** Some path matches the recording forever: the recorded cycle, or the last recorded frame held. */
  repeats: boolean;
  /** Whether the paths went through a branch, so the reasons can say so. */
  branched: boolean;
}
interface TreeNode {
  walk: BehaviourWalk;
  index: number;
  run: number;
  /**
   * After a join with countdowns further on: by how much the starting values of the branch the path follows are
   * ahead of the recording's, by countdown field.
   */
  adjust: ReadonlyMap<number, number>;
}
const NO_ADJUST: ReadonlyMap<number, number> = new Map();
const adjustKey = (adjust: ReadonlyMap<number, number>) =>
  [...adjust].map(([offset, by]) => `${offset}+${by}`).join(",");
/** One frame's fields together: two fields that know different values for the same bit can't both hold. */
function mergeFields(fields: RecordedField[]): RecordedField[] | undefined {
  const bytes = new Map<string, { object: string; offset: number; value: number; mask: number }>();
  for (const field of fields)
    for (let byte = 0; byte < field.width / 8; byte++) {
      const id = `${field.object}:${field.offset + byte}`,
        value = (field.value >>> (8 * byte)) & 0xff,
        mask = (field.knownMask >>> (8 * byte)) & 0xff,
        other = bytes.get(id);
      if (other && (other.value ^ value) & other.mask & mask) return undefined;
      bytes.set(id, {
        object: field.object,
        offset: field.offset + byte,
        value: ((other?.value ?? 0) & (other?.mask ?? 0)) | (value & mask),
        mask: (other?.mask ?? 0) | mask,
      });
    }
  return [...bytes.values()].map((item) => ({
    object: item.object,
    offset: item.offset,
    width: 8,
    value: item.value,
    knownMask: item.mask,
  }));
}
/** A branch condition the known fields rule out, counting its alternatives: one of them must hold too. */
function ruledOut(branch: { condition: Predicate; alternatives?: Predicate[] }, fields: RecordedField[]): boolean {
  if (evaluateBehaviourCondition(branch.condition, fields) === false) return true;
  return (
    !!branch.alternatives?.length &&
    branch.alternatives.every((alternative) => evaluateBehaviourCondition(alternative, fields) === false)
  );
}
/** Strongly connected parts of a graph, without recursion: the walk trees can be deep. */
function cyclic(count: number, edges: number[][]): boolean[] {
  const index = new Array<number>(count).fill(-1),
    low = new Array<number>(count).fill(0),
    onStack = new Array<boolean>(count).fill(false),
    stack: number[] = [],
    result = new Array<boolean>(count).fill(false);
  let next = 0;
  for (let start = 0; start < count; start++) {
    if (index[start] !== -1) continue;
    const work: [number, number][] = [[start, 0]];
    index[start] = low[start] = next++;
    stack.push(start);
    onStack[start] = true;
    while (work.length) {
      const top = work.at(-1)!;
      const [node, edge] = top;
      if (edge < edges[node]!.length) {
        top[1]++;
        const target = edges[node]![edge]!;
        if (index[target] === -1) {
          index[target] = low[target] = next++;
          stack.push(target);
          onStack[target] = true;
          work.push([target, 0]);
        } else if (onStack[target]) low[node] = Math.min(low[node]!, index[target]!);
        continue;
      }
      work.pop();
      if (work.length) low[work.at(-1)![0]] = Math.min(low[work.at(-1)![0]]!, low[node]!);
      if (low[node] !== index[node]) continue;
      const members: number[] = [];
      let member: number;
      do {
        member = stack.pop()!;
        onStack[member] = false;
        members.push(member);
      } while (member !== node);
      const loops = members.length > 1 || edges[node]!.includes(node);
      if (loops) for (const item of members) result[item] = true;
    }
  }
  return result;
}
/** Bounds one search, so a pathological tree gives a prefix rather than a long wait. */
const TREE_NODES = 200_000;

/**
 * Follows a walk and the branches it splits into along a recording. Each path is followed as far as the recording
 * allows: a branch whose condition the recording's starting fields rule out (only on the first run, while those fields
 * still hold) or whose frame differs from the recording's is not the way the recording went. A join continues where
 * the branch it names is at that moment. In `agree` mode every way counts, as when the branch a walk joins knew fewer
 * tests than the walk itself: its ways may include some the walk can't take, so none of them may be chosen by the
 * frames.
 */
function followTree(
  root: BehaviourWalk,
  frames: number[],
  loopStart: number | null,
  recorded: RecordedField[],
  stateOffset: number,
): TreeOutcome | undefined {
  const count = frames.length,
    period = loopStart === null ? 0 : count - loopStart,
    total = loopStart === null ? count : count + 1;
  const expected = (run: number) =>
    run < count
      ? frames[run]!
      : loopStart === null
        ? frames[count - 1]!
        : frames[loopStart + ((run - loopStart) % period)]!;
  const runKey = (run: number) =>
    run < count ? String(run) : loopStart === null ? "held" : `cycle ${(run - loopStart) % period}`;
  const ids = new Map<BehaviourWalk, number>();
  const idOf = (walk: BehaviourWalk) => {
    let id = ids.get(walk);
    if (id === undefined) ids.set(walk, (id = ids.size));
    return id;
  };
  const at = (path: number[]) =>
    path.reduce<BehaviourWalk | undefined>((walk, n) => walk?.stop?.branches?.[n]?.walk, root);
  const agreed = new Map<string, TreeOutcome | undefined>();
  interface Sink {
    from?: number;
    progress: boolean;
    adjust: ReadonlyMap<number, number>;
  }
  // The recording's starting fields, as the starting values a countdown is followed from; they hold at every run.
  const startValues = (adjust: ReadonlyMap<number, number>): RecordedField[] =>
    recorded.map((field) => ({
      ...field,
      object: START,
      value: wrap16(field.value + (adjust.get(field.offset) ?? 0)),
    }));
  const recordedStarts = new Set(recorded.map((field) => field.offset));
  /** From the root walk's first state, or in `agree` mode from the position a join continues at. */
  const search = (from: TreeNode | undefined): TreeOutcome | undefined => {
    const agree = from !== undefined;
    const nodes: TreeNode[] = [],
      keys = new Map<string, number>(),
      edges: number[][] = [],
      still: number[][] = [];
    let branched = false,
      open: TreeOutcome["open"],
      differs: TreeOutcome["differs"],
      forever = false;
    const leaveOpen = (frames: number, reason: string) => {
      frames = Math.min(frames, total);
      if (!open || frames < open.frames) open = { frames, reason };
    };
    const disagree = (run: number, predicted: number) => {
      const frames = Math.min(run, total);
      if (!differs || frames > differs.frames) differs = { frames, index: run, predicted, recorded: expected(run) };
    };
    const node = (walk: BehaviourWalk, index: number, run: number, adjust: ReadonlyMap<number, number>) => {
      const key = `${idOf(walk)}:${index}:${runKey(run)}:${adjustKey(adjust)}`;
      let id = keys.get(key);
      if (id === undefined) {
        if (nodes.length >= TREE_NODES) return undefined;
        keys.set(key, (id = nodes.length));
        nodes.push({ walk, index, run, adjust });
        edges.push([]);
        still.push([]);
      }
      return id;
    };
    // Entering a walk's state at a run: it must show the recorded frame. The first frame only tells which start fits.
    const enter = (sink: Sink, walk: BehaviourWalk, index: number, run: number) => {
      const state = walk.states[index]!;
      if (state !== expected(run)) {
        if (run === 0) return;
        if (run >= count && loopStart === null)
          leaveOpen(
            count,
            "The recorded frames agree; a way the walk can go changes the frame after the recording ends.",
          );
        else disagree(run, state);
        return;
      }
      link(sink, node(walk, index, run, sink.adjust), run);
    };
    const link = (sink: Sink, id: number | undefined, run: number) => {
      if (id === undefined) return leaveOpen(run, "The comparison reached its size limit.");
      if (sink.from !== undefined) (sink.progress ? edges : still)[sink.from]!.push(id);
    };
    // Entering a walk at its first state.
    const enterWalk = (sink: Sink, walk: BehaviourWalk, run: number) => {
      if (walk.parameterised) return leaveOpen(run, "A branch holds a frame the walk doesn't name.");
      if (walk.states.length) return enter(sink, walk, 0, run);
      if (walk.stop?.branches?.length) return split(sink, walk, run);
      leaveOpen(run, walk.reason ?? "The walk does not establish its starting frame.");
    };
    // The ways a walk splits into where it stops. `run` is the run whose fields decide them.
    const split = (sink: Sink, walk: BehaviourWalk, run: number) => {
      branched = true;
      const length = walk.states.length;
      // The recording's starting fields hold as they are on the first run, and as starting values of countdowns on
      // every run. The walk's own fields there and those can't contradict each other.
      const fields = mergeFields([...walk.fields, ...startValues(sink.adjust), ...(run === 0 ? recorded : [])]);
      if (!fields) return;
      const last = walk.states.at(-1);
      // A walk that doesn't know its starting frame splits on it, or on the rules that give the next one.
      const onStart =
        !length &&
        walk.stop!.branches!.every(
          ({ condition, walk: branch }) =>
            condition.kind === "compare" &&
            condition.operator === "==" &&
            condition.left.kind === "field" &&
            condition.left.object === "part" &&
            condition.left.offset === stateOffset &&
            condition.right.kind === "constant" &&
            (!branch.states.length || branch.states[0] === condition.right.value),
        );
      for (const branch of walk.stop!.branches!) {
        if (ruledOut(branch, fields)) continue;
        const next = branch.walk;
        if (!length) enterWalk(onStart ? sink : { ...sink, progress: true }, next, onStart ? run : run + 1);
        else if (walk.stop!.kind === "ambiguity") enterWalk({ ...sink, progress: true }, next, run + 1);
        else if (walk.stop!.kind !== "state") leaveOpen(run + 1, walk.reason ?? "The walk stops.");
        else if (
          // For any other value of the field, the walk stops where it did: that branch repeats the walk itself.
          (next.states.length === length &&
            length > 1 &&
            next.status === "unresolved" &&
            !next.stop?.branches?.length &&
            next.states.every((state, n) => state === walk.states[n])) ||
          next.states[0] !== last
        )
          leaveOpen(run + 1, next.reason ?? walk.reason ?? "The walk stops.");
        else enterWalk({ ...sink, progress: false }, next, run);
      }
    };
    /**
     * The ways from a position whose continuation may include ways the path can't take: every one of them must agree
     * with the recording, since the frames can't tell a real way from one that isn't.
     */
    const allAgree = (
      walk: BehaviourWalk,
      index: number,
      run: number,
      adjust: ReadonlyMap<number, number>,
      why: string,
    ) => {
      branched = true;
      const key = `${idOf(walk)}:${index}:${runKey(run)}:${adjustKey(adjust)}`;
      if (!agreed.has(key)) {
        agreed.set(key, undefined);
        agreed.set(key, search({ walk, index, run, adjust }));
      }
      const ways = agreed.get(key);
      if (!ways || ways.open || (ways.differs && ways.repeats))
        return leaveOpen(
          Math.min(ways?.open?.frames ?? total, run + 1),
          `${why}, and its ways don't all agree with the recording.`,
        );
      if (ways.differs) return disagree(ways.differs.index, ways.differs.predicted);
      // Every way repeats the recording: so does this one.
      forever = true;
    };
    const searchFrom = (id: number) => {
      const { walk, index, run, adjust } = nodes[id]!;
      // A walk that widened forgot fields, so it may also go ways the part can't.
      if (!agree && walk.assumptions.includes(WIDENING_ASSUMPTION))
        return allAgree(walk, index, run, adjust, "The walk forgot fields at the branch depth limit");
      const length = walk.states.length;
      const sink = { from: id, progress: true, adjust };
      if (index < length - 1) return enter(sink, walk, index + 1, run + 1);
      if (walk.status === "rest") return enter(sink, walk, index, run + 1);
      if (walk.status === "loop" && walk.loopStart !== undefined && walk.loopStart < length - 1)
        return enter(sink, walk, walk.loopStart + 1, run + 1);
      if (walk.status === "joins" && walk.joined) {
        const target = at(walk.joined.path),
          position = walk.joined.index;
        if (!target || target.states[position] !== walk.states[index])
          return leaveOpen(run + 1, "The branch this walk joins was not found.");
        // With countdowns further on, the other branch goes on like this one would for starting values that much
        // larger. Only the recording's starting values need moving; the others aren't known anyway.
        const moved = new Map(adjust);
        for (const { offset, by } of walk.joined.shift ?? [])
          if (recordedStarts.has(offset)) moved.set(offset, wrap16((moved.get(offset) ?? 0) + by));
        // A join that knew more tests than the other branch, all of them of starting values the recording gives,
        // can still have its way chosen: those values rule out every way it can't take.
        const decided =
          walk.joined.sameTests || !!walk.joined.startTests?.every((offset) => recordedStarts.has(offset));
        if (agree || decided)
          return link({ from: id, progress: false, adjust: moved }, node(target, position, run, moved), run);
        return allAgree(target, position, run, moved, "The branch this walk joins knew fewer tests");
      }
      if (walk.stop?.branches?.length) return split(sink, walk, run);
      leaveOpen(run + 1, walk.reason ?? "The extracted walk stops before the recording ends.");
    };
    if (from)
      link({ progress: false, adjust: from.adjust }, node(from.walk, from.index, from.run, from.adjust), from.run);
    else enterWalk({ progress: false, adjust: NO_ADJUST }, root, 0);
    for (let id = 0; id < nodes.length; id++) searchFrom(id);

    // A loop of joins and branches that never takes a run can't show what comes next.
    const stalled = cyclic(nodes.length, still);
    if (stalled.some(Boolean))
      leaveOpen(nodes[stalled.indexOf(true)]!.run + 1, "The branches lead back to the same run.");
    const all = edges.map((list, n) => [...list, ...still[n]!]);
    const repeats = forever || cyclic(nodes.length, all).some(Boolean);
    // When the recording's starting fields rule out every way, this start isn't the recording's.
    return open || differs || repeats ? { open, differs, repeats, branched } : undefined;
  };
  return search(undefined);
}
/**
 * How a start is compared: `bounded` when the recorder writes again right after the given frames, so the walk only
 * needs to agree with them; `external` when the recorder writes again in a way the comparison can't follow.
 */
interface StartMode {
  bounded: boolean;
  external: boolean;
}
function matchStart(
  report: BehaviourReport | undefined,
  animation: AnimationDescription,
  clip: MeasuredClip,
  mode: StartMode,
): DescribedWalkMatch | undefined {
  const walk = animation.walk;
  if (!clip.frames.length) return undefined;
  const parameter = clip.frames[0]!.state;
  const recorded = recordedFields(report, clip);
  if (
    animation.initialFields?.some((field) => {
      const other = recorded.find(
        (other) => other.object === field.object && other.offset === field.offset && other.width === field.width,
      );
      return other && ((other.value ^ field.value) & other.knownMask & field.knownMask) !== 0;
    })
  )
    return undefined;
  if (
    walk.parameterised?.kind === "hold" &&
    walk.parameterised.allowedStates &&
    !walk.parameterised.allowedStates.includes(parameter)
  )
    return undefined;
  if (walk.parameterised?.kind === "cycle") {
    const model = walk.parameterised,
      base = Math.floor(parameter / model.period) * model.period;
    if (parameter < 0 || base < model.minimumBase || base > model.maximumBase) return undefined;
  }
  const basis =
    animation.initial === "creation"
      ? "creation"
      : animation.trigger.kind === "input-case"
        ? "input-case"
        : animation.trigger.kind === "run"
          ? "reset-or-rest"
          : "trigger";
  const compatibility = animation.inputCondition
    ? evaluateBehaviourCondition(animation.inputCondition, recorded)
    : true;
  if (compatibility === false) return undefined;
  const expected = clip.frames.map((frame) => frame.state);
  if (clip.loopStart !== null) expected.push(clip.frames[clip.loopStart]!.state);
  const base = {
    clip: clip.path,
    measuredFrames: clip.frames.length,
    measuredTransitions: expected.length - 1,
    animation: animation.id,
    basis,
    conditionCompatibility:
      compatibility === undefined ? "unresolved" : basis === "trigger" ? "conditional-event" : "established",
    evidenceAddresses: [...new Set(walk.evidence.map((item) => item.address))] as number[],
  } as const;
  if (!walk.parameterised) return matchTree(report, animation, clip, recorded, compatibility, base, mode);
  let matched = 0;
  for (const [index, state] of expected.entries()) {
    const prediction = stateAt(walk, index, parameter);
    if (prediction === undefined)
      return {
        ...base,
        classification: "prefix",
        prefixFrames: matched,
        reason: walk.reason ?? "The extracted walk stops before the recording ends.",
      };
    if (prediction !== state)
      return {
        ...base,
        classification: compatibility === undefined || (mode.external && matched) ? "prefix" : "different",
        prefixFrames: matched,
        reason:
          compatibility === undefined
            ? "The recording does not establish this input case's starting condition."
            : mode.external && matched
              ? "The oracle supplies further external writes; the description contains one trigger only."
              : `The described walk predicts state ${prediction} at frame ${index}; the oracle records ${state}.`,
      };
    matched++;
  }
  if (compatibility === undefined)
    return {
      ...base,
      classification: "prefix",
      prefixFrames: matched,
      reason: "The saved frames agree but do not establish every starting condition of this input case.",
    };
  if (mode.bounded)
    return { ...base, classification: "complete", prefixFrames: matched, reason: "The frames agree up to the write." };
  if (walk.status !== "rest" && walk.status !== "loop")
    return {
      ...base,
      classification: "prefix",
      prefixFrames: matched,
      reason: walk.reason ?? "The known frames agree but the ending remains unresolved.",
    };
  if (mode.external)
    return {
      ...base,
      classification: "prefix",
      prefixFrames: matched,
      reason: "The saved frames agree, but repeated external input is outside this single-trigger walk.",
    };
  if (clip.loopStart === null) {
    const complete = walk.status === "rest" && walk.runCalls <= clip.frames.length;
    return {
      ...base,
      classification: complete ? "complete" : "prefix",
      prefixFrames: matched,
      reason: complete
        ? "The frames agree and the extracted rules prove a stable ending."
        : "The recorded prefix agrees; its ending is not established by this walk.",
    };
  }
  const oraclePeriod = clip.frames.length - clip.loopStart;
  const modelPeriod =
    walk.parameterised?.kind === "cycle"
      ? walk.parameterised.period
      : walk.status === "rest"
        ? 1
        : walk.states.length - 1 - walk.loopStart!;
  const span = (oraclePeriod * modelPeriod) / gcd(oraclePeriod, modelPeriod);
  const end = Math.max(clip.loopStart, walk.loopStart ?? walk.states.length - 1) + span;
  if (end > 4096)
    return {
      ...base,
      classification: "prefix",
      prefixFrames: matched,
      reason: "The full cycle comparison exceeds 4096 frames; only the prefix was checked.",
    };
  for (let index = expected.length; index <= end; index++) {
    const expectedState = clip.frames[clip.loopStart + ((index - clip.loopStart) % oraclePeriod)]!.state;
    if (stateAt(walk, index, parameter) !== expectedState)
      return {
        ...base,
        classification: "different",
        prefixFrames: matched,
        reason: "The proved and recorded visible cycles differ.",
      };
  }
  return {
    ...base,
    classification: "complete",
    prefixFrames: matched,
    reason: "The recorded prefix and the complete repeating state-selected frame cycle agree.",
  };
}

/** Compares a walk and every branch it splits into with a recording. */
function matchTree(
  report: BehaviourReport | undefined,
  animation: AnimationDescription,
  clip: MeasuredClip,
  recorded: RecordedField[],
  compatibility: boolean | undefined,
  base: Omit<DescribedWalkMatch, "classification" | "prefixFrames" | "reason">,
  mode: StartMode,
): DescribedWalkMatch | undefined {
  const stateOffset = report?.layout.fields.find((field) => field.name === "state")?.offset ?? 12;
  // A field the trigger writes may hold the trigger's value at the first run rather than the recording's.
  const written = new Set(
    animation.trigger.kind === "run"
      ? []
      : animation.trigger.writes
          .filter((write) => write.object === "part")
          .flatMap((write) => [...Array(Math.max(1, write.width / 8)).keys()].map((byte) => write.offset + byte)),
  );
  const start = recorded.filter(
    (field) => ![...Array(field.width / 8).keys()].some((byte) => written.has(field.offset + byte)),
  );
  const frames = clip.frames.map((frame) => frame.state);
  const outcome = followTree(animation.walk, frames, clip.loopStart, start, stateOffset);
  if (!outcome) return undefined;
  const total = frames.length + (clip.loopStart === null ? 0 : 1);
  const hold = mode.external;
  const result = (classification: DescribedWalkMatch["classification"], prefixFrames: number, reason: string) => ({
    ...base,
    classification,
    prefixFrames,
    reason,
  });
  if (outcome.open && !(mode.bounded && outcome.open.frames >= total))
    return result("prefix", outcome.open.frames, outcome.open.reason);
  if (outcome.repeats || outcome.open) {
    if (compatibility === undefined)
      return result(
        "prefix",
        total,
        "The saved frames agree but do not establish every starting condition of this input case.",
      );
    if (hold)
      return result(
        "prefix",
        total,
        "The saved frames agree, but repeated external input is outside this single-trigger walk.",
      );
    if (mode.bounded) return result("complete", total, "The frames agree up to the write.");
    return result(
      "complete",
      total,
      clip.loopStart === null
        ? outcome.branched
          ? "The frames agree, and every branch the recording allows proves a stable ending."
          : "The frames agree and the extracted rules prove a stable ending."
        : outcome.branched
          ? "The recorded prefix and the repeating frame cycle agree in every branch the recording allows."
          : "The recorded prefix and the complete repeating state-selected frame cycle agree.",
    );
  }
  const differs = outcome.differs!;
  if (compatibility === undefined)
    return result("prefix", differs.frames, "The recording does not establish this input case's starting condition.");
  if (hold)
    return result(
      "prefix",
      differs.frames,
      "The oracle supplies further external writes; the description contains one trigger only.",
    );
  const predicted =
    differs.index >= frames.length
      ? "The proved and recorded visible cycles differ."
      : `The described walk predicts state ${differs.predicted} at frame ${differs.index}; the oracle records ${differs.recorded}.`;
  return result(
    "different",
    differs.frames,
    outcome.branched ? `Every branch the recording allows disagrees with it. ${predicted}` : predicted,
  );
}

/** Walks the part's run rules from the fields a recording gives where its recorder writes again. */
export type RestartWalk = (fields: KnownField[]) => BehaviourWalk;
/**
 * A walk from the given fields only, like an input case in the middle of a run: everything else is unknown. The walks
 * are kept by their fields, since a recording that writes on every run restarts from the same fields again and again.
 */
export function restartWalk(report: BehaviourReport, partType: number): RestartWalk {
  const walks = new Map<string, BehaviourWalk>();
  return (fields) => {
    const key = JSON.stringify(
      fields.map(({ object, offset, width, value, knownMask }) => [object, offset, width, value, knownMask]),
    );
    let walk = walks.get(key);
    if (!walk) walks.set(key, (walk = walkBehaviourRules(report, partType, fields, { midRun: true })));
    return walk;
  };
}
type Segments = Pick<DescribedWalkMatch, "classification" | "prefixFrames" | "reason">;
/**
 * Follows a recording from each run where its recorder writes again, with a walk from the fields the recording gives
 * there. A part of the recording that ends at the next write only needs the walk to agree up to there; the last part
 * needs a proved ending like a whole recording.
 */
function followRestarts(
  report: BehaviourReport | undefined,
  clip: MeasuredClip,
  plan: { restarts: Restart[]; forever: boolean },
  walkFrom: RestartWalk,
): Segments {
  const stateOffset = report?.layout.fields.find((field) => field.name === "state")?.offset ?? 12;
  const { frames, loopStart } = clip,
    count = frames.length,
    period = loopStart === null ? 1 : count - loopStart,
    total = count + (loopStart === null ? 0 : 1);
  const stateAtRun = (run: number) =>
    run < count ? frames[run]!.state : frames[loopStart! + ((run - loopStart!) % period)]!.state;
  for (const [index, { run, fields }] of plan.restarts.entries()) {
    const end = plan.restarts[index + 1]?.run ?? (plan.forever ? count + period : undefined);
    const states =
      end === undefined
        ? frames.slice(run).map((frame) => frame.state)
        : [...Array(end - run + 1).keys()].map((n) => stateAtRun(run + n));
    const cycle = end === undefined && loopStart !== null ? loopStart - run : null;
    const length = states.length + (cycle === null ? 0 : 1);
    const seed = fields.map((field) => ({
      ...field,
      value: wrap16(field.value),
      confidence: "checked" as const,
      assumptions: [],
      evidence: [],
    }));
    const outcome = followTree(walkFrom(seed), states, cycle, fields, stateOffset);
    const at = (frames: number) => Math.min(total, run + frames);
    const where = `the recorder's write at run ${run}`;
    if (!outcome)
      return { classification: "prefix", prefixFrames: at(0), reason: `The walk from ${where} has no way.` };
    if (outcome.open && (end === undefined || outcome.open.frames < length))
      return {
        classification: "prefix",
        prefixFrames: at(outcome.open.frames),
        reason: `From ${where}: ${outcome.open.reason}`,
      };
    if (outcome.repeats || outcome.open) continue;
    const differs = outcome.differs!;
    return {
      classification: "different",
      prefixFrames: at(differs.frames),
      reason:
        run + differs.index >= count
          ? `From ${where}, the proved and recorded visible cycles differ.`
          : `From ${where}, the walk predicts state ${differs.predicted} at frame ${run + differs.index}; the oracle records ${differs.recorded}.`,
    };
  }
  return {
    classification: "complete",
    prefixFrames: total,
    reason: plan.forever
      ? "The recorder writes on every run. The walks from the start and from each write agree with the recording up to the next write, through its cycle."
      : `The recorder writes again at ${runWords(plan.restarts.map((restart) => restart.run))}. The walks from the start and from each write agree with the recording, and the last one proves its ending.`,
  };
}
/** Runs in words, with a stretch of consecutive runs as one range. */
function runWords(runs: number[]): string {
  const ranges: string[] = [];
  for (let n = 0; n < runs.length;) {
    let end = n;
    while (end + 1 < runs.length && runs[end + 1] === runs[end]! + 1) end++;
    ranges.push(end > n ? `${runs[n]} to ${runs[end]}` : String(runs[n]));
    n = end + 1;
  }
  return `${ranges.length > 1 || runs.length > 1 ? "runs" : "run"} ${ranges.length > 1 ? `${ranges.slice(0, -1).join(", ")} and ${ranges.at(-1)}` : ranges[0]}`;
}
/**
 * Compares one start with a recording. Where the recorder writes an input again, the start only needs to agree up to
 * that write, and the rest of the recording is followed from the write (the same for every start).
 */
function matchWalk(
  report: BehaviourReport | undefined,
  animation: AnimationDescription,
  clip: MeasuredClip,
  restarts: () => Segments | undefined,
): DescribedWalkMatch | undefined {
  const plan = recorderRestarts(report, clip);
  const later = "unsupported" in plan ? undefined : restarts();
  if (!later || "unsupported" in plan || !plan.restarts.length)
    return matchStart(report, animation, clip, {
      bounded: false,
      external: "unsupported" in plan || (!!plan.restarts.length && !later),
    });
  const first = plan.restarts[0]!.run,
    count = clip.frames.length;
  const head = matchStart(
    report,
    animation,
    {
      ...clip,
      frames: [...Array(first + 1).keys()].map((run) =>
        run < count
          ? clip.frames[run]!
          : clip.frames[clip.loopStart! + ((run - clip.loopStart!) % (count - clip.loopStart!))]!,
      ),
      loopStart: null,
    },
    { bounded: true, external: false },
  );
  if (!head) return undefined;
  const whole = {
    ...head,
    measuredFrames: count,
    measuredTransitions: count - 1 + (clip.loopStart === null ? 0 : 1),
  };
  return head.classification === "complete" ? { ...whole, ...later } : whole;
}
/** The comparison of a recording's later parts, once for all of its starts. */
function restartsOnce(
  report: BehaviourReport | undefined,
  clip: MeasuredClip,
  walkFrom: RestartWalk | undefined,
): () => Segments | undefined {
  let result: Segments | undefined,
    done = false;
  return () => {
    if (done) return result;
    done = true;
    const plan = recorderRestarts(report, clip);
    if (walkFrom && !("unsupported" in plan) && plan.restarts.length)
      result = followRestarts(report, clip, plan, walkFrom);
    return result;
  };
}

/** Complete counts retain their basis: actual code triggers and conditional input scenarios are distinct. */
export function validateDescribedWalks(
  report: BehaviourReport,
  part: PartBehaviourDescription,
  clips: MeasuredClip[],
): DescribedWalkCoverage {
  const rank = { complete: 2, prefix: 1, different: 0, unavailable: -1 };
  const basisRank = { "reset-or-rest": 2, creation: 2, trigger: 1, "input-case": 0, unavailable: -1 };
  const walkFrom = restartWalk(report, part.type);
  const matches = clips.map((clip): DescribedWalkMatch => {
    const restarts = restartsOnce(report, clip, walkFrom);
    const candidates = part.animations
      .filter(
        (animation) =>
          animation.walk.states.length || animation.walk.parameterised || animation.walk.stop?.branches?.length,
      )
      .flatMap((animation) => {
        const match = matchWalk(report, animation, clip, restarts);
        return match ? [match] : [];
      });
    candidates.sort(
      (left, right) =>
        rank[right.classification] - rank[left.classification] ||
        right.prefixFrames - left.prefixFrames ||
        basisRank[right.basis] - basisRank[left.basis],
    );
    return (
      candidates[0] ?? {
        clip: clip.path,
        classification: "unavailable",
        basis: "unavailable",
        measuredFrames: clip.frames.length,
        measuredTransitions: clip.frames.length - 1 + (clip.loopStart === null ? 0 : 1),
        prefixFrames: 0,
        conditionCompatibility: "unresolved",
        reason: "No described initial state or conditional input case is established by the recording.",
        evidenceAddresses: [],
      }
    );
  });
  return {
    clips: clips.length,
    oneFrameClips: clips.filter((clip) => clip.frames.length === 1 && clip.loopStart === null).length,
    complete: matches.filter((match) => match.classification === "complete").length,
    prefix: matches.filter((match) => match.classification === "prefix").length,
    different: matches.filter((match) => match.classification === "different").length,
    unavailable: matches.filter((match) => match.classification === "unavailable").length,
    completeFromCreation: matches.filter((match) => match.classification === "complete" && match.basis === "creation")
      .length,
    completeFromTriggers: matches.filter((match) => match.classification === "complete" && match.basis === "trigger")
      .length,
    completeFromResetOrRest: matches.filter(
      (match) => match.classification === "complete" && match.basis === "reset-or-rest",
    ).length,
    completeFromInputCases: matches.filter(
      (match) => match.classification === "complete" && match.basis === "input-case",
    ).length,
    matches,
  };
}

export type WalkMatch = DescribedWalkMatch;

/**
 * Compares one recording with independently extracted starts; a missing compatible start is unavailable. Without
 * `walkFrom`, a recording whose recorder writes an input again stays a prefix after the write.
 */
export function compareMeasuredWalks(
  animations: AnimationDescription[],
  clip: MeasuredClip,
  report?: BehaviourReport,
  walkFrom?: RestartWalk,
): WalkMatch {
  const restarts = restartsOnce(report, clip, walkFrom);
  const rank = { complete: 3, prefix: 2, different: 1, unavailable: 0 };
  const basisRank = { "reset-or-rest": 2, creation: 2, trigger: 1, "input-case": 0, unavailable: -1 };
  const candidates = animations.flatMap((animation) => {
    const match = matchWalk(report, animation, clip, restarts);
    return match ? [match] : [];
  });
  candidates.sort(
    (a, b) =>
      rank[b.classification] - rank[a.classification] ||
      b.prefixFrames - a.prefixFrames ||
      basisRank[b.basis] - basisRank[a.basis],
  );
  return (
    candidates[0] ?? {
      clip: clip.path,
      classification: "unavailable",
      basis: "unavailable",
      measuredFrames: clip.frames.length,
      measuredTransitions: clip.frames.length - 1 + (clip.loopStart === null ? 0 : 1),
      prefixFrames: 0,
      conditionCompatibility: "unresolved",
      reason:
        "No independently described start is compatible with the saved recording. No oracle field was supplied to a description.",
      evidenceAddresses: [],
    }
  );
}
