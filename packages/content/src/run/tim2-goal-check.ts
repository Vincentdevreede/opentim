/**
 * Checks TIM 2's goals as the level files keep them against TIM2.EXE's goal routine, as `goal-check.ts` does for the
 * goal routines of TIM 1 and Even More. TIM 2 has one routine that tests the goal entries for every puzzle, so for each
 * puzzle the check lays the puzzle's goal entries and made-up parts lists into TIM2.EXE's memory, runs the routine on
 * the CPU and `runTim2Goal` on the same parts, and compares the answer and every word they leave. TIM2.EXE runs from its
 * load image laid out with its overlays (`readToonsMemory`), loaded at segment 0, so no DOS is needed.
 *
 * The parts are the level's goal parts, a few of its other parts and a few made up of the goal's types, each on its own
 * list, in the bin or on no list, in the level's order or shuffled. Their states, places and sizes are drawn around the
 * goal's numbers: the state limits, the area's edges and the screen's, one more and one less, and other numbers.
 */
import {
  runTim2Goal,
  TIM2_GOAL_ENTRY_SIZE,
  TIM2_GOAL_FIELDS,
  TIM2_SCREEN,
  type Tim2GoalPart,
  type Tim2GoalRoutine,
  type Tim2GoalWorld,
} from "../read/tim2-goal.ts";
import type { ToonsMemory } from "../read/toons-drawing.ts";
import { Cpu, CpuRunsOn } from "./cpu.ts";
import type { GoalCheckResult } from "./goal-check.ts";

/** A goal to check: the level's goal words and its parts, each with its list and the words the routine reads. */
export interface Tim2GoalToCheck {
  puzzle: number;
  name?: string;
  first: number;
  /** The entries: the part's place in `parts` (or null) and the seven words. */
  entries: readonly { part: number | null; values: readonly number[] }[];
  last: number;
  parts: readonly (Tim2GoalPart & { group: "static" | "moving" })[];
}

/** Where the made-up parts' records go: a segment for every two parts, and each record 0x100 bytes into it. */
const PARTS_SEGMENT = 0x7000;
const RECORD_SIZE = 0x100;
/** The routine's stack, in a segment of its own so it can't touch the data segment or the code. */
const STACK_SEGMENT = 0x9000;
/** The most of the level's other parts a world has. */
const OTHERS = 16;
const STACK_TOP = 0xf000;

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

/** A part's record as a far pointer: two parts share a segment, and parts two apart share an offset. */
const recordOf = (k: number) => ({ segment: PARTS_SEGMENT + (k >> 1) * 0x20, offset: (k & 1) * RECORD_SIZE });

type Part = Tim2GoalPart & { record: number };

/** The tests a goal's answer can depend on, by the names `runTim2Goal` gives them. */
export function tim2GoalTests(goal: Pick<Tim2GoalToCheck, "first" | "entries" | "last">): string[] {
  const tests = ["a part in the bin is the goal's", "a part on a list is the goal's", "enough checks"];
  if (goal.first === 0) return ["the first word isn't 0"];
  for (let k = 0; k < goal.entries.length && goal.entries[k]!.part !== null; k++) {
    tests.push(`entry ${k + 1}: holds`);
    // Only an entry that counts tests parts other than its own, whose type can differ.
    if (goal.entries[k]!.values[2]) tests.push(`entry ${k + 1}: the type`, `entry ${k + 1}: enough parts`);
  }
  return tests;
}

/**
 * Checks each goal of `goals` against TIM2.EXE's goal routine, `trials` worlds each, and stops early when every test
 * went both ways. Each entry's part must be one of the goal's parts.
 */
export function checkTim2Goals(
  program: Pick<ToonsMemory, "memory" | "dataSegment">,
  routine: Tim2GoalRoutine,
  goals: readonly Tim2GoalToCheck[],
  { trials = 1000, seed = 1 }: { trials?: number; seed?: number } = {},
): (GoalCheckResult & { name?: string })[] {
  const cpu = new Cpu();
  cpu.memory.set(program.memory.subarray(0, Math.min(program.memory.length, cpu.memory.length)));
  const clean = cpu.memory.slice();
  const data = program.dataSegment * 16;
  const results: (GoalCheckResult & { name?: string })[] = [];

  for (const goal of goals) {
    const rng = random(seed + goal.puzzle);
    const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)]!;
    const goalParts = new Set(goal.entries.map((e) => e.part).filter((p) => p !== null));
    const goalTypes = [...goalParts].map((p) => goal.parts[p]?.type ?? 0);
    const values = goal.entries.filter((e) => e.part !== null).map((e) => e.values);
    const states = [0, 1, ...values.flatMap(([low = 0, high = 0]) => [low, high])];
    const middlesX = [0, TIM2_SCREEN.width, ...values.flatMap(([, , , x = 0, , w = 0]) => [x, x + w])];
    const middlesY = [0, TIM2_SCREEN.height, ...values.flatMap(([, , , , y = 0, , h = 0]) => [y, y + h])];
    const near = (numbers: number[]) => [...new Set(numbers.flatMap((n) => [n - 1, n, n + 1]))];
    const pools = { state: near(states), x: near(middlesX), y: near(middlesY), checks: near([0, goal.last]) };
    const someValue = (pool: number[]) => {
      const r = rng();
      if (r < 0.75) return pick(pool) & 0xffff;
      if (r < 0.9) return Math.floor(rng() * 2001 - 1000) & 0xffff;
      return Math.floor(rng() * 0x10000);
    };
    const sizes = [0, 1, 2, 15, 16, 31, 32, 64];
    const made = (base: Tim2GoalPart, record: number): Part => {
      const baseWidth = rng() < 0.6 ? base.baseWidth : someValue(sizes);
      const baseHeight = rng() < 0.6 ? base.baseHeight : someValue(sizes);
      // A middle near the goal's numbers, and the position that puts it there.
      const x = (someValue(pools.x) - ((baseWidth << 16) >> 17)) & 0xffff;
      const y = (someValue(pools.y) - ((baseHeight << 16) >> 17)) & 0xffff;
      const type = rng() < 0.9 ? base.type : rng() < 0.5 && goalTypes.length ? pick(goalTypes) : someValue([1, 2, 9]);
      return { type, state: someValue(pools.state), x, y, baseWidth, baseHeight, record };
    };

    const tests = tim2GoalTests(goal);
    const ids = new Set(tests);
    const taken = new Set<string>();
    const result: GoalCheckResult & { name?: string } = {
      puzzle: goal.puzzle,
      ...(goal.name ? { name: goal.name } : {}),
      trials: 0,
      unset: 0,
      dividesByZero: 0,
      runOn: 0,
      differ: 0,
      tests: tests.length,
      bothWays: 0,
    };
    const others = goal.parts.map((_, k) => k).filter((k) => !goalParts.has(k));
    const ours = new Uint8Array(clean.length);
    const put = (at: number, value: number) => {
      ours[at] = value & 0xff;
      ours[at + 1] = (value >> 8) & 0xff;
    };
    const putFar = (at: number, record: number | undefined) => {
      const far = record === undefined ? { segment: 0, offset: 0 } : recordOf(record);
      put(at, far.offset);
      put(at + 2, far.segment);
    };
    for (let trial = 0; trial < trials; trial++) {
      // The level's parts this world has: every goal part and up to five others, then up to three of the goal's types.
      const chosen = [...goalParts, ...others.filter(() => rng() < 5 / Math.max(5, others.length)).slice(0, OTHERS)];
      const parts = new Map<number, Part & { group: "static" | "moving" }>();
      chosen.forEach((k, n) => parts.set(k, { ...made(goal.parts[k]!, n), group: goal.parts[k]!.group }));
      const extra = Array.from({ length: goalParts.size ? Math.floor(rng() * 4) : 0 }, (_, n) => {
        const base = goal.parts[pick([...goalParts])]!;
        return {
          ...made(base, chosen.length + n),
          group: rng() < 0.85 ? base.group : pick(["static", "moving"] as const),
        };
      });
      const lists: Record<"moving" | "static" | "bin", Part[]> = { moving: [], static: [], bin: [] };
      for (const part of [...parts.values(), ...extra]) {
        const r = rng();
        if (r < 0.8) lists[part.group].push(part);
        else if (r < 0.9) lists.bin.push(part);
      }
      for (const list of Object.values(lists))
        if (rng() < 0.5)
          for (let k = list.length - 1; k > 0; k--) {
            const j = Math.floor(rng() * (k + 1));
            [list[k], list[j]] = [list[j]!, list[k]!];
          }
      // Every goal part has its record, also on no list: the routine reads its type.
      const entryPart = (index: number | null) => (index === null ? null : parts.get(index)!);
      const world: Tim2GoalWorld<Part> = {
        first: goal.first,
        entries: goal.entries.map((e) => ({ part: entryPart(e.part), values: e.values })),
        last: goal.last,
        ...lists,
        checks: someValue(pools.checks),
      };

      ours.set(clean);
      put(data + routine.first, world.first);
      world.entries.forEach((e, k) => {
        const at = data + routine.entries + k * TIM2_GOAL_ENTRY_SIZE;
        putFar(at, e.part?.record);
        e.values.forEach((value, n) => put(at + 4 + 2 * n, value));
      });
      put(data + routine.last, world.last);
      put(data + routine.checks, world.checks);
      const records = new Set<Part>(world.entries.flatMap((e) => (e.part ? [e.part] : [])));
      for (const [name, list] of Object.entries(lists)) {
        putFar(data + routine.lists[name as keyof typeof lists], list[0]?.record);
        list.forEach((part, k) => {
          records.add(part);
          const far = recordOf(part.record);
          const at = far.segment * 16 + far.offset;
          putFar(at + TIM2_GOAL_FIELDS.next, list[k + 1]?.record);
        });
      }
      for (const part of records) {
        const far = recordOf(part.record);
        const at = far.segment * 16 + far.offset;
        for (const field of ["type", "state", "x", "y", "baseWidth", "baseHeight"] as const)
          put(at + TIM2_GOAL_FIELDS[field], part[field]);
      }
      cpu.memory.set(ours);
      result.trials++;

      const seen = new Set<string>();
      const read = runTim2Goal(world, (test, holds) => seen.add(`${test}:${holds}`));
      put(data + routine.checks, read.checks);

      cpu.segs[0] = program.dataSegment;
      cpu.segs[2] = STACK_SEGMENT;
      cpu.segs[3] = program.dataSegment;
      cpu.regs[4] = STACK_TOP;
      let answer: number;
      try {
        answer = cpu.callFar(routine.segment, routine.offset, [], 300_000);
      } catch (problem) {
        result.differ++;
        result.firstDifference ??=
          problem instanceof CpuRunsOn
            ? `trial ${trial}: the game ran on`
            : `trial ${trial}: the game stopped: ${(problem as Error).message}`;
        continue;
      }
      if (answer !== read.answer) {
        result.differ++;
        result.firstDifference ??= `trial ${trial}: the game answers ${answer}, the read goal ${read.answer}`;
        continue;
      }
      const from = data;
      const theirs = cpu.memory.subarray(from, from + 0x10000);
      if (Buffer.compare(ours.subarray(from, from + 0x10000), theirs) !== 0) {
        let a = 0;
        while (ours[from + a] === theirs[a]) a++;
        a &= ~1;
        result.differ++;
        result.firstDifference ??= `trial ${trial}: word 0x${a.toString(16)} is 0x${(theirs[a]! | (theirs[a + 1]! << 8)).toString(16)} in the game, 0x${(ours[from + a]! | (ours[from + a + 1]! << 8)).toString(16)} read`;
        continue;
      }
      const partsFrom = PARTS_SEGMENT * 16;
      const partsTo = recordOf(0x40).segment * 16;
      if (Buffer.compare(ours.subarray(partsFrom, partsTo), cpu.memory.subarray(partsFrom, partsTo)) !== 0) {
        result.differ++;
        result.firstDifference ??= `trial ${trial}: the game changed a part`;
        continue;
      }
      for (const s of seen) if (ids.has(s.slice(0, s.lastIndexOf(":")))) taken.add(s);
      if (tests.every((t) => taken.has(`${t}:true`) && taken.has(`${t}:false`))) break;
    }
    result.bothWays = tests.filter((t) => taken.has(`${t}:true`) && taken.has(`${t}:false`)).length;
    results.push(result);
  }
  return results;
}

/** Made-up goals for the parts of the routine the shipped goals don't reach: gaps, counts, a first word of 0. */
export function madeUpTim2Goals(count: number, seed = 1): Tim2GoalToCheck[] {
  const rng = random(seed);
  const int = (from: number, to: number) => from + Math.floor(rng() * (to - from + 1));
  return Array.from({ length: count }, (_, puzzle) => {
    const parts = Array.from({ length: int(1, 8) }, () => ({
      type: int(1, 4),
      state: 0,
      x: int(0, 600),
      y: int(0, 380),
      baseWidth: int(1, 40),
      baseHeight: int(1, 40),
      group: rng() < 0.6 ? ("moving" as const) : ("static" as const),
    }));
    const entries = Array.from({ length: 8 }, (_, k) => {
      const used = k < int(0, 8) || rng() < 0.1;
      const x = int(-20, 600);
      const y = int(-20, 380);
      const low = int(-2, 5);
      return {
        part: used ? int(0, parts.length - 1) : null,
        values: [
          low,
          low + int(-1, 4),
          rng() < 0.3 ? int(1, 3) : 0,
          x,
          y,
          rng() < 0.2 ? -1 : rng() < 0.3 ? 0 : int(1, 200),
          int(0, 200),
        ],
      };
    });
    return {
      puzzle,
      name: `made-up ${puzzle + 1}`,
      first: rng() < 0.1 ? 0 : 1,
      entries,
      last: rng() < 0.3 ? int(-2, 5) : 0,
      parts,
    };
  });
}
