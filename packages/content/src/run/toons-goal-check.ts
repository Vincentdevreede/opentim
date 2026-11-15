/**
 * Checks Toons' goals as `readToonsGoals` reads them against TOONS.EXE's own routines, as `goal-check.ts` does for
 * TIM: for each puzzle it makes up parts lists and words, runs the game's routine on the CPU and the read program in
 * `runGoal` over the same memory, and compares every word they leave in the data segment and in the far segments the
 * goals keep words in. TOONS.EXE runs from its load image laid out with its overlays (`readToonsMemory`), loaded at
 * segment 0, so the goal routines and the routines they call run where the reader read them; no DOS is needed.
 */
import {
  farWord,
  FAR_WORDS,
  GoalDividesByZero,
  GoalRunsOn,
  runGoal,
  UnsetValue,
  type GoalProblem,
  type GoalRoutine,
  type GoalStatement,
  type GoalTest,
  type GoalValue,
} from "../read/puzzle-goals.ts";
import type { ToonsMemory } from "../read/toons-drawing.ts";
import { Cpu, CpuRunsOn } from "./cpu.ts";
import type { GoalCheckResult, PartList } from "./goal-check.ts";

/** A Toons part's record size: TOONS.EXE allocates it with `calloc(1, 0xb3)`. */
const PART_SIZE = 0xb3;
const TYPE = 0x04;
const FLAGS = 0x06;
const PARTS_AT = 0xa000;
const STACK_TOP = 0xf000;
const STACK_FROM = 0xd000;
const STACK_TO = 0xf100;

/** A small seeded random number generator (mulberry32), so a check gives the same trials each time. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The parts lists the list head routine picks from: a test of a bit of its mask, then the word it gives, as in
 * `if (mask & 0x1000) return [0x49d6]`.
 */
export function toonsLists(routine: GoalRoutine | GoalProblem | undefined): PartList[] {
  const out: PartList[] = [];
  const walk = (body: readonly GoalStatement[], bit?: number) => {
    for (const s of body) {
      if (s.kind === "if") {
        const { left, right, op } = s.test;
        const tested =
          left.kind === "binary" && left.op === "&" && left.right.kind === "constant" && right.kind === "constant"
            ? left.right.value
            : undefined;
        // `mask hasn't the bit`: the other way has it.
        walk(s.then, tested !== undefined && op === "!=" ? tested : bit);
        walk(s.else, tested !== undefined && op === "==" ? tested : bit);
      } else if (
        s.kind === "set" &&
        bit !== undefined &&
        s.target.kind === "register" &&
        s.target.name === "ax" &&
        s.value.kind === "word" &&
        s.value.address.kind === "constant" &&
        !out.some((l) => l.bit === bit)
      )
        out.push({ head: s.value.address.value, bit });
    }
  };
  if (routine && "body" in routine) walk(routine.body);
  return out;
}

/** What a program reads: the fields of parts, the words, the constants, and its tests. */
function survey(routines: ReadonlyMap<number, GoalRoutine | GoalProblem>, start: number, words: Set<number>) {
  const fields = new Set<number>([TYPE]);
  const constants = new Set<number>([0, 1, 0xffff]);
  const tests = new Set<GoalTest>();
  const seen = new Set<number>();
  const value = (v: GoalValue) => {
    if (v.kind === "constant") {
      if (v.value < FAR_WORDS) constants.add(v.value);
    } else if (v.kind === "word") {
      const a = v.address;
      if (a.kind === "constant") words.add(a.value);
      else if (a.kind === "binary" && a.op === "+" && a.right.kind === "constant") {
        // A field of a part, or a table the goal keeps, indexed by a counter: its first words.
        if (a.right.value < PART_SIZE) fields.add(a.right.value);
        else for (let k = 0; k < 16; k++) words.add(a.right.value + 2 * k);
      }
      value(a);
    } else if (v.kind === "binary") {
      value(v.left);
      value(v.right);
    }
  };
  const body = (statements: readonly GoalStatement[]) => {
    for (const s of statements) {
      if (s.kind === "set") {
        value(s.target);
        value(s.value);
      } else if (s.kind === "if" || s.kind === "loop") {
        tests.add(s.test);
        value(s.test.left);
        value(s.test.right);
        if (s.kind === "if") {
          body(s.then);
          body(s.else);
        } else {
          body(s.before);
          body(s.body);
        }
      } else if (s.kind === "call") routine(s.routine);
    }
  };
  const routine = (address: number) => {
    if (seen.has(address)) return;
    seen.add(address);
    const r = routines.get(address);
    if (r && "body" in r) body(r.body);
  };
  routine(start);
  return { fields: [...fields], constants: [...constants], tests };
}

/** A goal's check; `compared` counts the trials whose words were compared, after both ran to their end. */
export type ToonsGoalCheckResult = GoalCheckResult & { name?: string; compared: number };

/**
 * Checks each goal of `goals` against its read program. `lists` are the parts lists, `steps` the step count word,
 * which is 0 in half the trials so the goals' first step is tried too.
 */
export function checkToonsGoals(
  toons: ToonsMemory,
  routines: ReadonlyMap<number, GoalRoutine | GoalProblem>,
  goals: readonly { puzzle: number; name?: string; segment: number; offset: number; address: number }[],
  lists: readonly PartList[],
  steps: number,
  { trials = 1000, seed = 1 }: { trials?: number; seed?: number } = {},
): ToonsGoalCheckResult[] {
  const cpu = new Cpu();
  cpu.memory.set(toons.memory.subarray(0, Math.min(toons.memory.length, cpu.memory.length)));
  const clean = cpu.memory.slice();
  const data = toons.dataSegment * 16;
  const linear = (address: number) => {
    const far = farWord(address);
    return far ? far.segment * 16 + far.offset : data + (address & 0xffff);
  };
  // The place of a word's second byte: like the processor, a word at offset 0xffff ends at offset 0 of its segment.
  const second = (address: number) => {
    const far = farWord(address);
    return far ? address - far.offset + ((far.offset + 1) & 0xffff) : (address + 1) & 0xffff;
  };
  const heads = new Set(lists.map((l) => l.head));
  const results: ToonsGoalCheckResult[] = [];

  for (const goal of goals) {
    const rng = random(seed + goal.puzzle);
    const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)]!;
    const words = new Set<number>([steps]);
    const { fields, constants, tests } = survey(routines, goal.address, words);
    for (const head of heads) words.delete(head);
    // The far segments the goal keeps words in, compared after each run as the data segment is.
    const segments = new Set([...words].map((w) => farWord(w)?.segment).filter((s) => s !== undefined));
    const regions = [data, ...[...segments].map((s) => s * 16)];
    // The finder looks for parts of a type: most made-up parts take a type the goal names.
    const types = constants.filter((c) => c > 0 && c < 0x100);
    const pool = [...new Set(constants.flatMap((c) => [c, (c + 1) & 0xffff, (c - 1) & 0xffff]))];
    const someValue = () => {
      const r = rng();
      if (r < 0.7) return pick(pool);
      if (r < 0.85) return Math.floor(rng() * 2001 - 1000) & 0xffff;
      return Math.floor(rng() * 0x10000);
    };
    const ours = new Uint8Array(clean.length);
    const put = (at: number, value: number) => {
      ours[at] = value & 0xff;
      ours[at + 1] = (value >> 8) & 0xff;
    };
    const readWord = (a: number) => ours[linear(a)]! | (ours[linear(second(a))]! << 8);
    const writeWord = (a: number, value: number) => {
      ours[linear(a)] = value & 0xff;
      ours[linear(second(a))] = (value >> 8) & 0xff;
    };
    const result: ToonsGoalCheckResult = {
      puzzle: goal.puzzle,
      ...(goal.name ? { name: goal.name } : {}),
      trials: 0,
      unset: 0,
      dividesByZero: 0,
      runOn: 0,
      differ: 0,
      compared: 0,
      tests: tests.size,
      bothWays: 0,
    };
    const ids = new Map<GoalTest, number>([...tests].map((t, k) => [t, k]));
    const taken = new Set<string>();
    for (let trial = 0; trial < trials; trial++) {
      ours.set(clean);
      let at = PARTS_AT;
      for (const list of lists) {
        const places = Array.from({ length: Math.floor(rng() * 7) }, () => (at += PART_SIZE) - PART_SIZE);
        put(data + list.head, places[0] ?? 0);
        places.forEach((place, k) => {
          ours.fill(0, data + place, data + place + PART_SIZE);
          for (const offset of fields) put(data + place + offset, someValue());
          put(data + place + TYPE, rng() < 0.8 && types.length ? pick(types) : someValue());
          put(data + place + FLAGS, (someValue() & ~0x3800) | list.bit);
          put(data + place, places[k + 1] ?? 0);
        });
      }
      for (const w of words) writeWord(w, w === steps && rng() < 0.5 ? 0 : someValue());
      cpu.memory.set(ours);
      result.trials++;
      const seen = new Set<string>();
      let ranOn = false;
      try {
        runGoal(routines, goal.address, { read: readWord, write: writeWord }, 200_000, (test, holds) =>
          seen.add(`${ids.get(test)}:${holds}`),
        );
      } catch (problem) {
        if (problem instanceof UnsetValue) {
          result.unset++;
          continue;
        }
        if (problem instanceof GoalDividesByZero) {
          result.dividesByZero++;
          continue;
        }
        if (!(problem instanceof GoalRunsOn)) throw problem;
        ranOn = true;
      }
      cpu.segs[0] = toons.dataSegment;
      cpu.segs[2] = toons.dataSegment;
      cpu.segs[3] = toons.dataSegment;
      cpu.regs[4] = STACK_TOP + 6;
      let gameRanOn = false;
      try {
        cpu.callFar(goal.segment, goal.offset, [], 300_000);
      } catch (problem) {
        // Only the limit counts as running on. Anything else, like a divide error, is the game doing something else.
        if (!(problem instanceof CpuRunsOn)) {
          result.differ++;
          result.firstDifference ??= `trial ${trial}: the game stopped: ${(problem as Error).message}`;
          continue;
        }
        gameRanOn = true;
      }
      if (ranOn || gameRanOn) {
        if (ranOn && gameRanOn) result.runOn++;
        else {
          result.differ++;
          result.firstDifference ??= `trial ${trial}: ${ranOn ? "the read program" : "the game"} ran on alone`;
        }
        continue;
      }
      result.compared++;
      for (const from of regions) {
        const theirs = cpu.memory.subarray(from, from + 0x10000);
        if (Buffer.compare(ours.subarray(from, from + 0x10000), theirs) === 0) continue;
        let a = 0;
        while (a < 0x10000 && (ours[from + a] === theirs[a] || (from === data && a >= STACK_FROM && a < STACK_TO))) a++;
        if (a >= 0x10000) continue;
        a &= ~1;
        result.differ++;
        result.firstDifference ??= `trial ${trial}: word ${(from / 16).toString(16)}:${a.toString(16)} is 0x${(theirs[a]! | (theirs[a + 1]! << 8)).toString(16)} in the game, 0x${(ours[from + a]! | (ours[from + a + 1]! << 8)).toString(16)} read`;
        break;
      }
      for (const s of seen) taken.add(s);
    }
    result.bothWays = [...ids.values()].filter((id) => taken.has(`${id}:true`) && taken.has(`${id}:false`)).length;
    results.push(result);
  }
  return results;
}
