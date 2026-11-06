/** Compares independently described frame walks with saved recordings. Recordings never seed a description. */
import type { BehaviourReport, Expression, Predicate, RoutineAnalysis } from "./behaviour.ts";
import type { MeasuredClip } from "./behaviour-validation.ts";
import type { Instruction } from "./x86.ts";
import { discoverFindFirstLoops } from "./behaviour-find-first-loops.ts";
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
  /**
   * `seeded-state`: a walk from a trigger the recorder never performs, whose start is what the recorder seeded: the
   * trigger's writes are the values the recorder's action gives, so the walk is the run from the recorder's start.
   * `recorder-fields`: the match needed what the recorder itself writes or clears between runs (its bench).
   * `recorder-skipped-search`: it needed that and what the recorder gave in place of a search it skipped (an empty found
   * list). Both show the walk agrees with the recorder, not what the game does.
   */
  basis:
    | "reset-or-rest"
    | "creation"
    | "input-case"
    | "seeded-state"
    | "recorder-fields"
    | "recorder-skipped-search"
    | "unavailable";
  measuredFrames: number;
  measuredTransitions: number;
  prefixFrames: number;
  animation?: string;
  conditionCompatibility: "established" | "unresolved";
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
  completeFromSeededStates: number;
  completeFromResetOrRest: number;
  completeFromInputCases: number;
  completeFromRecorderFields: number;
  completeFromRecorderSkippedSearches: number;
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

/**
 * The part fields the v25 recorder writes itself (`setup`, `apply` and `step` in `research/v24/verify_animations.py`):
 * the type, flags, frame, previous frames, control value, position, speed, size, counter, heat and the outline and
 * drawing pointers. It clears the rest of the part's 0x300 bytes before each clip and never writes them again.
 */
const RECORDER_FIELDS: [number, number][] = [
  [0x04, 2],
  [0x08, 2],
  [0x0c, 6],
  [0x12, 2],
  [0x1e, 12],
  [0x36, 4],
  [0x40, 8],
  [0x80, 6],
  [0x96, 2],
  [0x9c, 2],
];
/** The bytes of the part the recorder writes itself. */
const RECORDER_BYTES = new Set(
  RECORDER_FIELDS.flatMap(([offset, size]) => [...Array(size).keys()].map((n) => offset + n)),
);
/** The part's size in the recorder: it clears this many bytes before each clip. */
const RECORDER_PART_SIZE = 0x300;
/**
 * The bytes of a part that the run routine may write, or undefined when that can't be shown. It counts every data
 * write by its offset whatever pointer it goes through, and the routines it calls in its own code segment; a call that
 * leaves the segment is skipped by the recorder and writes nothing. It gives up on string instructions, interrupts,
 * calls it can't follow and a pointer the routine moves by an offset (`lea`, `add` and the like on a register it writes
 * through), since then an offset no longer says which field is written.
 */
function runWrites(
  report: BehaviourReport,
  routine: RoutineAnalysis | undefined,
  seen = new Set<number>(),
  /** Instructions of the run routine that never run in the clip, like the body of a loop over an empty list. */
  never: ReadonlySet<number> = new Set(),
): Set<number> | undefined {
  if (!routine || routine.status !== "complete" || !routine.instructions?.length) return undefined;
  if (seen.has(routine.address)) return new Set();
  seen.add(routine.address);
  const written = new Set<number>();
  const runs = routine.instructions.filter((i) => !never.has(i.address));
  const bases = new Set(
    runs.flatMap((i) => (i.operands[0]?.kind === "memory" && !NOT_WRITING.has(i.mnemonic) ? i.operands[0].base : [])),
  );
  const callAt = new Map(routine.calls.map((call) => [call.instruction, call]));
  for (const i of runs) {
    if (/^(stos|movs|ins|rep|cmps|scas|lods)/.test(i.mnemonic) || i.mnemonic === "int") return undefined;
    const destination = i.operands[0],
      source = i.operands[1];
    if (i.flow === "call") {
      const target = callAt.get(i.address)?.target;
      if (!target) return undefined;
      if (target.segment !== routine.segment) continue;
      const callee = runWrites(
        report,
        report.routines.find((item) => item.address === target.address) as RoutineAnalysis | undefined,
        seen,
      );
      if (!callee) return undefined;
      for (const byte of callee) written.add(byte);
      continue;
    }
    if (destination?.kind === "register" && bases.has(destination.name) && !NOT_WRITING.has(i.mnemonic)) {
      // A pointer may be loaded, copied, tested, cleared or restored, never moved by an offset.
      const plain =
        (i.mnemonic === "mov" && (source?.kind === "memory" || source?.kind === "register")) ||
        (i.mnemonic === "mov" && source?.kind === "immediate" && source.value === 0) ||
        (i.mnemonic === "xor" && source?.kind === "register" && source.name === destination.name) ||
        // A test of the pointer against itself keeps it.
        (["or", "and"].includes(i.mnemonic) && source?.kind === "register" && source.name === destination.name) ||
        i.mnemonic === "pop" ||
        i.mnemonic === "les" ||
        i.mnemonic === "lds";
      if (!plain) return undefined;
    }
    if (
      i.flow === "next" &&
      destination?.kind === "memory" &&
      destination.segment !== "ss" &&
      !NOT_WRITING.has(i.mnemonic)
    )
      for (let byte = 0; byte < destination.width / 8; byte++) written.add(destination.displacement + byte);
  }
  return written;
}
/**
 * What the v25 recorder itself does to the part between runs (`setup`, `clip` and `step` in
 * `research/v24/verify_animations.py`), as fields for every run of a clip:
 *
 * - before each run it has set the six words at `0x1e` to `0x28` to 100;
 * - after each run it copies the frame into `0x0e`, so before run n (n > 0) `0x0e` holds the frame the clip saved at
 *   run n, and 0 before the first run, since it cleared the part;
 * - in the same step it first copies `0x0e` into `0x10`. When nothing in the clip writes `0x0e`, `0x10` holds the
 *   frame at run n - 1 from run 2 on, and 0 before;
 * - it clears the part's 0x300 bytes before the clip and never writes the ones it doesn't name. Where nothing in the
 *   clip can write such a byte (`runWrites`), it is 0 before every run. That is shown from the code, not assumed.
 *
 * The values it writes for the clip's input are the recorder's writes the comparison already follows. None of this
 * says what the game gives the part.
 */
function recorderFields(report: BehaviourReport, partType: number, clip: MeasuredClip): RecorderFacts {
  const address = report.parts.find((part) => part.type === partType)?.routines.find((r) => r.slot === 1)?.address;
  const written = runWrites(
    report,
    report.routines.find((item) => item.address === address) as RoutineAnalysis | undefined,
  );
  const zero = new Set<number>();
  if (written)
    for (let byte = 0; byte < RECORDER_PART_SIZE; byte++)
      if (!RECORDER_BYTES.has(byte) && !written.has(byte)) zero.add(byte);
  const keepsPrevious = !!written && !written.has(0x0e) && !written.has(0x0f);
  const { frames, loopStart } = clip,
    count = frames.length;
  const frameAt = (run: number) =>
    run < count
      ? frames[run]!.state
      : loopStart === null
        ? frames[count - 1]!.state
        : frames[loopStart + ((run - loopStart) % (count - loopStart))]!.state;
  const word = (offset: number, value: number): RecordedField => ({
    object: "part",
    offset,
    width: 16,
    value: wrap16(value),
    knownMask: 0xffff,
  });
  const positions = [0x1e, 0x20, 0x22, 0x24, 0x26, 0x28].map((offset) => word(offset, 100));
  const inputs = (run: number) => [
    ...positions,
    word(0x0e, run === 0 ? 0 : frameAt(run)),
    ...(keepsPrevious ? [word(0x10, run <= 1 ? 0 : frameAt(run - 1))] : []),
  ];
  return { inputs, ...(zero.size ? { zero } : {}) };
}
const overlapsAny = (field: RecordedField, others: RecordedField[]) =>
  field.object === "part" &&
  others.some(
    (other) =>
      other.object === "part" &&
      other.offset < field.offset + field.width / 8 &&
      field.offset < other.offset + other.width / 8,
  );
/** Whether known part fields agree with the recorder's writes and with the bytes it cleared that nothing writes. */
function recorderAgrees(
  known: RecordedField[],
  given: RecordedField[],
  zero: ReadonlySet<number> | undefined,
): boolean {
  const part = known.filter((field) => field.object === "part");
  if (given.length && !mergeFields([...part.filter((field) => overlapsAny(field, given)), ...given])) return false;
  return (
    !zero ||
    part.every((field) =>
      [...Array(field.width / 8).keys()].every(
        (byte) => !zero.has(field.offset + byte) || ((field.value & field.knownMask) >>> (8 * byte)) % 0x100 === 0,
      ),
    )
  );
}
/** The part fields a condition reads, by offset and width. */
const readFields = new WeakMap<Predicate, { offset: number; width: number }[]>();
function fieldsRead(predicate: Predicate): { offset: number; width: number }[] {
  let result = readFields.get(predicate);
  if (result) return result;
  const found: { offset: number; width: number }[] = [];
  const visit = (value: Expression | Predicate) => {
    if (value.kind === "field") {
      if (value.object === "part" && !value.unresolved) found.push({ offset: value.offset, width: value.width });
    } else if (value.kind === "binary" || value.kind === "compare") {
      visit(value.left);
      visit(value.right);
    } else if (value.kind === "table") visit(value.index);
    else if (value.kind === "and") value.terms.forEach(visit);
  };
  visit(predicate);
  readFields.set(predicate, (result = found));
  return result;
}
/** The known fields with 0 for each field a branch reads that lies in the recorder's cleared, unwritten bytes. */
function withZero(
  branch: { condition: Predicate; alternatives?: Predicate[] },
  fields: RecordedField[],
  zero: ReadonlySet<number>,
): RecordedField[] | undefined {
  const extra = [branch.condition, ...(branch.alternatives ?? [])]
    .flatMap(fieldsRead)
    .filter(
      ({ offset, width }) =>
        (width === 8 || width === 16) && [...Array(width / 8).keys()].every((byte) => zero.has(offset + byte)),
    )
    .map(({ offset, width }) => ({ object: "part", offset, width, value: 0, knownMask: width === 8 ? 0xff : 0xffff }));
  return extra.length ? mergeFields([...fields, ...extra]) : fields;
}
/** Rewrites a branch condition with what the recorder gave in place of searches it skipped. */
type RecorderView = (predicate: Predicate) => Predicate;
/** What the recorder did, beyond the clip's saved fields, for the comparison to use on every run of a clip. */
interface RecorderFacts {
  /** Branch conditions rewritten with the empty found list of a search the recorder skipped. */
  view?: RecorderView;
  /** The part fields the recorder writes before a run, by the run's number in the clip. */
  inputs?: (run: number) => RecordedField[];
  /** The bytes of the part the recorder clears before the clip that nothing in the clip can write: 0 on every run. */
  zero?: ReadonlySet<number>;
}
const NOT_WRITING = new Set(["cmp", "test", "push"]);
/** Whether an instruction may write the part field at `offset` (2 bytes): any data write there, through any pointer. */
function mayWrite(i: Instruction, offset: number): boolean {
  if (/^(stos|movs|ins|rep)/.test(i.mnemonic) || i.mnemonic === "int") return true;
  const destination = i.operands[0];
  return (
    i.flow === "next" &&
    destination?.kind === "memory" &&
    destination.segment !== "ss" &&
    !NOT_WRITING.has(i.mnemonic) &&
    destination.displacement < offset + 2 &&
    offset < destination.displacement + destination.width / 8
  );
}
/**
 * What the v25 recorder gives a part in place of a search it skipped, as a rewrite of the walk's branch conditions.
 * The recorder runs only the part's run routine. Its hook catches the first instruction of any routine outside the
 * part types' code segment, pops the far return address, sets AX and DX to 0 and writes no memory
 * (`hook` in `research/v24/verify_animations.py`); the clip counts each one in `skippedEngineServices`. A search that
 * builds the list of parts it found (an overlap query) starts that list in a field of the part, like 0x78; the recorder
 * cleared that field before the clip and nothing writes it, when the run writes no such field itself outside the loops
 * over that list and calls nothing in its own code segment outside them. Then each loop over the list finds it empty:
 *
 * - a loop that stops at the first part it acts on finds no part: its member link is 0;
 * - after a loop over every part, the part's fields hold what they held before it. That is the value at the run's
 *   start when nothing on the way from the run's start to the loop writes the field or calls anything but the search.
 *
 * Only searches the clip lists as skipped count, and only for that clip. Nothing here says what the game finds.
 */
function recorderView(
  report: BehaviourReport | undefined,
  partType: number | undefined,
  clip: MeasuredClip,
): { view: RecorderView; searches: number[] } | undefined {
  if (!report || partType === undefined) return undefined;
  const skipped = new Set(
    Object.entries(clip.skippedEngineServices)
      .filter(([, count]) => typeof count === "number" && count > 0)
      .map(([address]) => Number.parseInt(address, 16)),
  );
  const searches = new Map(
    (report.helpers ?? [])
      .filter((helper) => skipped.has(helper.address) && helper.kind === "overlap-list" && helper.list)
      .map((helper) => [helper.address, helper.list!.headField]),
  );
  if (!searches.size) return undefined;
  const address = report.parts.find((part) => part.type === partType)?.routines.find((r) => r.slot === 1)?.address;
  const routine = report.routines.find((item) => item.address === address) as RoutineAnalysis | undefined;
  if (!routine || routine.status !== "complete" || !routine.instructions?.length) return undefined;
  const callAt = new Map(routine.calls.map((call) => [call.instruction, call]));
  const heads = new Set(searches.values());
  const next = new Map<number, number[]>(),
    previous = new Map<number, number[]>();
  for (const edge of routine.edges)
    if (edge.to !== null) {
      next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
      previous.set(edge.to, [...(previous.get(edge.to) ?? []), edge.from]);
    }
  const reach = (from: number, links: Map<number, number[]>, stop: (at: number) => boolean) => {
    const seen = new Set<number>([from]),
      pending = [from];
    while (pending.length) {
      const at = pending.pop()!;
      if (at !== from && stop(at)) continue;
      for (const to of links.get(at) ?? [])
        if (!seen.has(to)) {
          seen.add(to);
          pending.push(to);
        }
    }
    return seen;
  };
  const byAddress = new Map(routine.instructions.map((i) => [i.address, i]));
  /** A loop over the found list: a scan over every part, or a loop that stops at the first part it acts on. */
  interface ListLoop {
    header: number;
    body: number[];
    headField: number;
    /** For a scan: the search call whose list it walks. */
    query?: number;
  }
  const scans: ListLoop[] = (routine.listLoops ?? []).flatMap((loop) => {
    const target = loop.query === undefined ? undefined : callAt.get(loop.query)?.target?.address;
    return loop.source === "overlap-query" &&
      target !== undefined &&
      searches.has(target) &&
      searches.get(target) === loop.headField
      ? [{ header: loop.header, body: loop.body, headField: loop.headField!, query: loop.query }]
      : [];
  });
  // A loop that stops at the first part it acts on (`discoverFindFirstLoops`), whose first part is loaded from the
  // found list's field on the part itself: the routine's own part pointer, which it only loads from its argument.
  const argument = routine.instructions.some((i) => i.mnemonic === "retf") ? 6 : 4;
  const ownPart = (name: string) => {
    const writes = routine.instructions.filter(
      (i) => i.operands[0]?.kind === "register" && i.operands[0].name === name && !NOT_WRITING.has(i.mnemonic),
    );
    return (
      writes.length > 0 &&
      writes.some((i) => i.mnemonic === "mov") &&
      writes.every((i) => {
        const source = i.operands[1];
        if (i.mnemonic === "mov")
          return (
            source?.kind === "memory" &&
            source.segment === "ss" &&
            source.base.join() === "bp" &&
            source.displacement === argument
          );
        // Restoring the caller's register on the way out.
        if (i.mnemonic !== "pop") return false;
        const rest = routine.instructions.filter((other) => other.address > i.address);
        const end = rest.findIndex((other) => other.flow === "return");
        return (
          end >= 0 &&
          rest
            .slice(0, end)
            .every(
              (other) =>
                other.mnemonic === "pop" ||
                (other.mnemonic === "mov" && other.operands[0]?.kind === "register" && other.operands[0].name === "sp"),
            )
        );
      })
    );
  };
  const helpers = new Map((report.helpers ?? []).map((helper) => [helper.address, helper]));
  const firsts: ListLoop[] = [...discoverFindFirstLoops(routine, helpers).values()].flatMap((loop) => {
    if (!loop.excludesOwner || scans.some((scan) => scan.header === loop.header)) return [];
    const branch = byAddress.get(loop.evidence[1]!.address);
    const entries = (next.get(branch?.address ?? -1) ?? []).filter((at) => at !== loop.exit);
    // The loop's body: what its entry reaches before the head or the exit, and what reaches the head back.
    const back = new Set<number>();
    for (const at of previous.get(loop.header) ?? [])
      for (const from of reach(at, previous, (from) => from === loop.header)) back.add(from);
    const body = new Set<number>();
    for (const entry of entries)
      for (const at of reach(entry, next, (to) => to === loop.header || to === loop.exit))
        if (at !== loop.header && at !== loop.exit && back.has(at)) body.add(at);
    const loads = routine.instructions.filter((i) => {
      const source = i.operands[1];
      return (
        !body.has(i.address) &&
        i.mnemonic === "mov" &&
        i.operands[0]?.kind === "register" &&
        i.operands[0].name === loop.node &&
        source?.kind === "memory" &&
        source.segment === "ds" &&
        source.base.length === 1 &&
        source.base[0] !== loop.node
      );
    });
    const load = loads[0]?.operands[1];
    if (loads.length !== 1 || load?.kind !== "memory" || !heads.has(load.displacement) || !ownPart(load.base[0]!))
      return [];
    // Every way from the run's start into the loop comes through that load, and keeps the part it loaded.
    const at = loads[0]!.address;
    if (reach(routine.address, next, (to) => to === at || body.has(to)).has(loop.header)) return [];
    const onTheWay = reach(at, next, (to) => to === loop.header || body.has(to));
    if (
      [...onTheWay].some((to) => {
        const i = byAddress.get(to);
        return (
          to !== at &&
          to !== loop.header &&
          (!i ||
            i.flow === "call" ||
            (i.operands[0]?.kind === "register" && i.operands[0].name === loop.node && !NOT_WRITING.has(i.mnemonic)))
        );
      })
    )
      return [];
    return [{ header: loop.header, body: [...body], headField: load.displacement }];
  });
  const loops = [...scans, ...firsts];
  const bodies = new Set(loops.flatMap((loop) => loop.body));
  // What the run can write while every such list is empty: their bodies never run.
  const written = runWrites(report, routine, new Set(), bodies);
  const listEmpty = (head: number) =>
    !!written &&
    !RECORDER_BYTES.has(head) &&
    !RECORDER_BYTES.has(head + 1) &&
    !written.has(head) &&
    !written.has(head + 1);
  const empty = loops.filter((loop) => listEmpty(loop.headField));
  if (!empty.length) return undefined;
  /** The instructions on some way from the run's start to the loop's head that doesn't go round the loop. */
  const before = (loop: (typeof empty)[number]) => {
    const body = new Set(loop.body);
    const forward = reach(routine.address, next, (at) => at === loop.header);
    const backward = reach(loop.header, previous, (at) => at === routine.address || body.has(at));
    return [...forward].filter((at) => at !== loop.header && backward.has(at) && !body.has(at));
  };
  const keeps = new Map<string, boolean>();
  const unchanged = (loop: (typeof empty)[number], offset: number) => {
    const key = `${loop.header}:${offset}`;
    let result = keeps.get(key);
    if (result === undefined)
      keeps.set(
        key,
        (result = before(loop).every((at) => {
          const i = byAddress.get(at);
          return !!i && loop.query !== undefined && !mayWrite(i, offset) && (i.flow !== "call" || at === loop.query);
        })),
      );
    return result;
  };
  const named = new Map(empty.map((loop) => [`0x${loop.header.toString(16)}`, loop]));
  const replace = (expression: Expression): Expression => {
    if (expression.kind === "binary")
      return { ...expression, left: replace(expression.left), right: replace(expression.right) };
    if (expression.kind === "table") return { ...expression, index: replace(expression.index) };
    if (expression.kind !== "field" || !expression.unresolved) return expression;
    const link = /^member found by the loop at (0x[0-9a-f]+) link$/.exec(expression.object);
    if (link && named.has(link[1]!) && expression.offset === 0)
      return { kind: "constant", value: 0, width: expression.width };
    const after = /^part after list scan at (0x[0-9a-f]+)$/.exec(expression.object);
    const loop = after && named.get(after[1]!);
    if (loop && unchanged(loop, expression.offset))
      return { kind: "field", object: "part", offset: expression.offset, width: expression.width };
    return expression;
  };
  const done = new WeakMap<Predicate, Predicate>();
  const view = (predicate: Predicate): Predicate => {
    let result = done.get(predicate);
    if (result) return result;
    result =
      predicate.kind === "compare"
        ? { ...predicate, left: replace(predicate.left), right: replace(predicate.right) }
        : predicate.kind === "and"
          ? { ...predicate, terms: predicate.terms.map(view) }
          : predicate;
    done.set(predicate, result);
    return result;
  };
  const used = [...searches].filter(([, head]) => empty.some((loop) => loop.headField === head)).map(([at]) => at);
  return { view, searches: [...new Set(used)].sort((a, b) => a - b) };
}
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
/**
 * A condition that can't hold: the known fields rule it out, or they do once each part field it tests for one number
 * has that number. A rewritten condition can test the same field twice, like the mouse motor's "control value is 0
 * and the control value after the scan isn't 0" once the scan leaves the control value as it was.
 */
function impossible(condition: Predicate, fields: RecordedField[]): boolean {
  if (evaluateBehaviourCondition(condition, fields) === false) return true;
  const equal: RecordedField[] = [];
  for (const term of condition.kind === "and" ? condition.terms : [condition]) {
    if (term.kind !== "compare" || term.operator !== "==") continue;
    const [field, number] = term.right.kind === "constant" ? [term.left, term.right] : [term.right, term.left];
    if (field.kind !== "field" || field.object !== "part" || field.unresolved || number.kind !== "constant") continue;
    if (field.width !== 8 && field.width !== 16) continue;
    const mask = field.width === 8 ? 0xff : 0xffff;
    equal.push({
      object: "part",
      offset: field.offset,
      width: field.width,
      value: number.value & mask,
      knownMask: mask,
    });
  }
  if (!equal.length) return false;
  const merged = mergeFields([...fields, ...equal]);
  return !merged || evaluateBehaviourCondition(condition, merged) === false;
}
/** `ruledOut` for conditions rewritten with what the recorder gave in place of a search it skipped. */
function viewedOut(branch: { condition: Predicate; alternatives?: Predicate[] }, fields: RecordedField[]): boolean {
  return (
    impossible(branch.condition, fields) ||
    (!!branch.alternatives?.length && branch.alternatives.every((alternative) => impossible(alternative, fields)))
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
  facts?: RecorderFacts,
  /** The clip's run at the tree's first run, for the recorder's writes before each run. */
  offset = 0,
): TreeOutcome | undefined {
  const view = facts?.view;
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
      const given = facts?.inputs?.(run + offset) ?? [];
      // The recorder's own writes before this run replace what the walk knew there. A walk that knew another value for
      // them, or a value other than 0 for a field the recorder cleared and nothing writes, isn't on the recorder's way.
      if (facts && !recorderAgrees(walk.fields, given, facts.zero))
        return leaveOpen(run + 1, "The walk knows another value for a field the recorder sets before this run.");
      const own = given.length ? walk.fields.filter((field) => !overlapsAny(field, given)) : walk.fields;
      const fields = mergeFields([...own, ...startValues(sink.adjust), ...(run === 0 ? recorded : []), ...given]);
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
        const seen = view
          ? { condition: view(branch.condition), alternatives: branch.alternatives?.map(view) }
          : branch;
        const known = facts?.zero ? withZero(seen, fields, facts.zero) : fields;
        if (!known || (facts ? viewedOut(seen, known) : ruledOut(seen, known))) continue;
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
  facts?: RecorderFacts;
}
/** The objects of the fields an expression or condition reads. */
function objectsRead(value: Expression | Predicate, found: string[] = []): string[] {
  if (value.kind === "field") found.push(value.object);
  else if (value.kind === "binary" || value.kind === "compare") {
    objectsRead(value.left, found);
    objectsRead(value.right, found);
  } else if (value.kind === "table") objectsRead(value.index, found);
  else if (value.kind === "and") value.terms.forEach((term) => objectsRead(term, found));
  return found;
}
/** Whether a walk keeps a test of this object at its start: the part, its start values and what its pointers reach. */
const partObject = (object: string): boolean =>
  object === "part" || object === START || object.startsWith("address of ") || object.startsWith("referenced-by(");
/**
 * Whether a walk from a trigger starts where the recording does. The v25 recorder (`clip` and `step` in
 * `research/v24/verify_animations.py`) puts each part alone on a cleared bench, writes the fields its action names
 * (`state`, `control`, `timer`, `heat`, `vx`, `vy` and the flags at `0x08`) and then only calls the part's run routine,
 * returning 0 from every call that leaves the parts' code segment. It calls no other callback of the part, and no other
 * part is there to write to it. So no trigger of a walk, a callback of the part or another part's write, happens in a
 * recording. Such a walk only stands for a clip when its start is one the recorder gave: every bit the trigger writes
 * that the walk knows, the recorder gives with that value, and every test of the trigger's the walk keeps (on part
 * fields the trigger leaves alone) holds for the recorder's fields. Without the bench (`zero`), the recorder gives only
 * the fields its action and the clip's first frame name.
 */
function recorderStart(animation: AnimationDescription, given: RecordedField[], zero?: ReadonlySet<number>): boolean {
  const written = new Set(
    animation.trigger.writes
      .filter((write) => write.object === "part")
      .flatMap((write) => [...Array(Math.max(1, write.width / 8)).keys()].map((byte) => write.offset + byte)),
  );
  const byteOf = (field: RecordedField, offset: number) => ({
    value: (field.value >>> (8 * (offset - field.offset))) & 0xff,
    mask: (field.knownMask >>> (8 * (offset - field.offset))) & 0xff,
  });
  const givenByte = (offset: number) => {
    if (zero?.has(offset)) return { value: 0, mask: 0xff };
    let value = 0,
      mask = 0;
    for (const field of given)
      if (field.object === "part" && field.offset <= offset && offset < field.offset + field.width / 8) {
        const known = byteOf(field, offset);
        value |= known.value & known.mask & ~mask;
        mask |= known.mask;
      }
    return { value, mask };
  };
  const writesGiven = (animation.initialFields ?? []).every(
    (field) =>
      field.object !== "part" ||
      [...Array(field.width / 8).keys()].every((byte) => {
        const offset = field.offset + byte;
        if (!written.has(offset)) return true;
        const known = byteOf(field, offset),
          recorder = givenByte(offset);
        return (known.mask & ~recorder.mask) === 0 && ((known.value ^ recorder.value) & known.mask) === 0;
      }),
  );
  if (!writesGiven) return false;
  const terms = (predicate: Predicate): Predicate[] =>
    predicate.kind === "and" ? predicate.terms.flatMap(terms) : predicate.kind === "compare" ? [predicate] : [];
  return terms(animation.trigger.condition).every((term) => {
    // A test of the event itself, like the argument a rope passes, says nothing about the part's start.
    if (!objectsRead(term).every(partObject)) return true;
    // Nor does a test of a field the trigger writes: the walk starts from the written value.
    if (
      fieldsRead(term).some(({ offset, width }) =>
        [...Array(Math.max(1, width / 8)).keys()].some((byte) => written.has(offset + byte)),
      )
    )
      return true;
    const fields = zero ? withZero({ condition: term }, given, zero) : given;
    return !!fields && evaluateBehaviourCondition(term, fields) === true;
  });
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
  // A start that knows another value for a field the recorder gives itself isn't the recorder's start.
  if (mode.facts && !recorderAgrees(animation.initialFields ?? [], mode.facts.inputs?.(0) ?? [], mode.facts.zero))
    return undefined;
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
          : "seeded-state";
  // The recorder performs no trigger, so a walk from one counts only when its start is what the recorder seeded.
  if (
    basis === "seeded-state" &&
    !recorderStart(
      animation,
      mode.facts
        ? [...recorded, ...(mode.facts.inputs?.(0) ?? [])]
        : recorded.filter((field) => field !== RECORDER_CONTACT),
      mode.facts?.zero,
    )
  )
    return undefined;
  // With the recorder's bench, a field the input case tests that the recorder cleared and nothing in the clip writes is
  // 0, like the monkey bike's belt link at 0x54.
  const given =
    animation.inputCondition && mode.facts?.zero
      ? withZero({ condition: animation.inputCondition }, recorded, mode.facts.zero)
      : recorded;
  if (!given) return undefined;
  const compatibility = animation.inputCondition ? evaluateBehaviourCondition(animation.inputCondition, given) : true;
  if (compatibility === false) return undefined;
  const expected = clip.frames.map((frame) => frame.state);
  if (clip.loopStart !== null) expected.push(clip.frames[clip.loopStart]!.state);
  const base = {
    clip: clip.path,
    measuredFrames: clip.frames.length,
    measuredTransitions: expected.length - 1,
    animation: animation.id,
    basis,
    conditionCompatibility: compatibility === undefined ? "unresolved" : "established",
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
  const outcome = followTree(animation.walk, frames, clip.loopStart, start, stateOffset, mode.facts);
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
  facts?: RecorderFacts,
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
    const outcome = followTree(walkFrom(seed), states, cycle, fields, stateOffset, facts, run);
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
  facts?: RecorderFacts,
): DescribedWalkMatch | undefined {
  const plan = recorderRestarts(report, clip);
  const later = "unsupported" in plan ? undefined : restarts();
  if (!later || "unsupported" in plan || !plan.restarts.length)
    return matchStart(report, animation, clip, {
      bounded: false,
      external: "unsupported" in plan || (!!plan.restarts.length && !later),
      facts,
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
    { bounded: true, external: false, facts },
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
  facts?: RecorderFacts,
): () => Segments | undefined {
  let result: Segments | undefined,
    done = false;
  return () => {
    if (done) return result;
    done = true;
    const plan = recorderRestarts(report, clip);
    if (walkFrom && !("unsupported" in plan) && plan.restarts.length)
      result = followRestarts(report, clip, plan, walkFrom, facts);
    return result;
  };
}

/**
 * The best match from the walks as they are. When it isn't complete, the match with what the recorder itself did
 * between runs (the fields it writes before every run, and the fields it cleared that nothing in the clip writes), and
 * then also with the empty found list of a search the clip lists as skipped. Each has its own basis, and is taken when
 * it matches, gets further, or disagrees: a recording that then disagrees is a finding too.
 */
function withRecorder(
  report: BehaviourReport | undefined,
  partType: number | undefined,
  clip: MeasuredClip,
  best: (facts?: RecorderFacts) => DescribedWalkMatch | undefined,
): DescribedWalkMatch | undefined {
  const plain = best();
  if (plain?.classification === "complete" || !report || partType === undefined) return plain;
  const better = (match: DescribedWalkMatch | undefined, than: DescribedWalkMatch | undefined) =>
    !!match &&
    (match.classification === "complete" ||
      match.classification === "different" ||
      (match.classification === "prefix" &&
        (!than || than.classification !== "prefix" || match.prefixFrames > than.prefixFrames)));
  const facts = recorderFields(report, partType, clip);
  const fields = best(facts);
  let result = plain;
  if (better(fields, plain))
    result = {
      ...fields!,
      basis: "recorder-fields",
      reason: `${fields!.reason} ${RECORDER_FIELDS_WORDS}`,
    };
  if (result?.classification === "complete" || result?.classification === "different") return result;
  const recorder = recorderView(report, partType, clip);
  const seen = recorder && best({ ...facts, view: recorder.view });
  if (!recorder || !better(seen, result)) return result;
  const searches = recorder.searches.map((address) => `0x${address.toString(16)}`);
  return {
    ...seen!,
    basis: "recorder-skipped-search",
    reason: `${seen!.reason} ${RECORDER_FIELDS_WORDS} The recorder skipped the search at ${searches.join(" and ")}: in the recording it returned 0 and wrote nothing, so the run found no part. That is the recorder's answer, not the game's.`,
  };
}
const RECORDER_FIELDS_WORDS =
  "It takes the fields the recorder writes before every run, and the fields it clears that nothing in the clip writes, as the recorder gave them: that is the recorder's bench, not the game's.";
const RANK = { complete: 3, prefix: 2, different: 1, unavailable: 0 };
/** Where several walks fit equally, the one that needs the fewest facts beyond the recording. */
const BASIS_RANK = {
  "reset-or-rest": 2,
  creation: 2,
  "input-case": 1,
  "seeded-state": 0,
  "recorder-fields": -1,
  "recorder-skipped-search": -1,
  unavailable: -1,
};
const byRank = (left: DescribedWalkMatch, right: DescribedWalkMatch) =>
  RANK[right.classification] - RANK[left.classification] ||
  right.prefixFrames - left.prefixFrames ||
  BASIS_RANK[right.basis] - BASIS_RANK[left.basis];

/** Complete counts retain their basis: reset or rest, creation, input cases and seeded states are distinct. */
export function validateDescribedWalks(
  report: BehaviourReport,
  part: PartBehaviourDescription,
  clips: MeasuredClip[],
): DescribedWalkCoverage {
  const walkFrom = restartWalk(report, part.type);
  const animations = part.animations.filter(
    (animation) =>
      animation.walk.states.length || animation.walk.parameterised || animation.walk.stop?.branches?.length,
  );
  const matches = clips.map((clip): DescribedWalkMatch => {
    const best = (facts?: RecorderFacts) => {
      const restarts = restartsOnce(report, clip, walkFrom, facts);
      return animations
        .flatMap((animation) => {
          const match = matchWalk(report, animation, clip, restarts, facts);
          return match ? [match] : [];
        })
        .sort(byRank)[0];
    };
    return (
      withRecorder(report, part.type, clip, best) ?? {
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
    completeFromSeededStates: matches.filter(
      (match) => match.classification === "complete" && match.basis === "seeded-state",
    ).length,
    completeFromResetOrRest: matches.filter(
      (match) => match.classification === "complete" && match.basis === "reset-or-rest",
    ).length,
    completeFromInputCases: matches.filter(
      (match) => match.classification === "complete" && match.basis === "input-case",
    ).length,
    completeFromRecorderFields: matches.filter(
      (match) => match.classification === "complete" && match.basis === "recorder-fields",
    ).length,
    completeFromRecorderSkippedSearches: matches.filter(
      (match) => match.classification === "complete" && match.basis === "recorder-skipped-search",
    ).length,
    matches,
  };
}

export type WalkMatch = DescribedWalkMatch;

/**
 * Compares one recording with independently extracted starts; a missing compatible start is unavailable. Without
 * `walkFrom`, a recording whose recorder writes an input again stays a prefix after the write. With `partType`, a
 * clip that lists a search the recorder skipped may match with the recorder's empty found list, under its own basis.
 */
export function compareMeasuredWalks(
  animations: AnimationDescription[],
  clip: MeasuredClip,
  report?: BehaviourReport,
  walkFrom?: RestartWalk,
  partType?: number,
): WalkMatch {
  const best = (facts?: RecorderFacts) => {
    const restarts = restartsOnce(report, clip, walkFrom, facts);
    return animations
      .flatMap((animation) => {
        const match = matchWalk(report, animation, clip, restarts, facts);
        return match ? [match] : [];
      })
      .sort(byRank)[0];
  };
  return (
    withRecorder(report, partType, clip, best) ?? {
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
