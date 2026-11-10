/**
 * Checks the goals `readGoalRoutines` reads against the game's own goal routines: for each puzzle it makes up parts
 * lists and words, runs the routine in the emulator and the read program in `runGoal` over the same data segment, and
 * compares every word they leave. The parts are made from what the routine reads: its fields, its words and the
 * constants it compares with. Worlds that take a test a way no world took before are kept and changed further, so the
 * check tries both ways of as many tests as it can.
 */
import { findDataSegment } from "../read/type-table.ts";
import {
  type GoalProblem,
  type GoalRoutine,
  type GoalStatement,
  type GoalTest,
  type GoalValue,
  GoalDividesByZero,
  GoalRunsOn,
  runGoal,
  UnsetValue,
} from "../read/puzzle-goals.ts";
import { Dos } from "./dos.ts";
import { readLzexeProgram } from "./program.ts";

/** A global list of parts: the word that holds its first part, and the bit a part on it has in its flags at 0x06. */
export interface PartList {
  head: number;
  bit: number;
}

export interface GoalCheckResult {
  puzzle: number;
  trials: number;
  /** Trials where the read program reads a register or stack word it never set, so it can't say what the game does. */
  unset: number;
  /** Trials where the read program divides by 0, where the game stops with a divide error; not compared. */
  dividesByZero: number;
  /** Trials where both ran past their limit, like a search for a part the made-up lists don't have. */
  runOn: number;
  /** Trials where the routine and the read program left different words, or only one of them ran on. */
  differ: number;
  /** The first difference, in words. */
  firstDifference?: string;
  /** The tests the program has, and how many of them the trials took both ways. */
  tests: number;
  bothWays: number;
}

const PARTS_AT = 0xa000;
const PART_SIZE = 0xa0;
const FLAGS = 0x06;
const STACK_TOP = 0xf000;
/** The words the two stacks use, which aren't compared. */
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

/** What a program reads: the fields of parts, the words of the data segment, the constants, and its tests. */
function survey(routines: ReadonlyMap<number, GoalRoutine | GoalProblem>, start: number) {
  const fields = new Set<number>();
  const words = new Set<number>();
  const constants = new Set<number>([0, 1, 0xffff]);
  const tests = new Set<GoalTest>();
  const seen = new Set<number>();
  const value = (v: GoalValue) => {
    if (v.kind === "constant") constants.add(v.value);
    else if (v.kind === "word") {
      const a = v.address;
      if (a.kind === "constant") words.add(a.value);
      else if (a.kind === "binary" && a.op === "+" && a.right.kind === "constant" && a.right.value < PART_SIZE)
        fields.add(a.right.value);
      else if (a.kind === "register") fields.add(0);
      value(a);
    } else if (v.kind === "binary") {
      value(v.left);
      value(v.right);
    }
  };
  const body = (statements: GoalStatement[]) => {
    for (const s of statements) {
      if (s.kind === "set") {
        value(s.target);
        value(s.value);
      } else if (s.kind === "if") {
        tests.add(s.test);
        value(s.test.left);
        value(s.test.right);
        body(s.then);
        body(s.else);
      } else if (s.kind === "loop") {
        tests.add(s.test);
        value(s.test.left);
        value(s.test.right);
        body(s.before);
        body(s.body);
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
  return { fields, words, constants: [...constants], tests };
}

interface World {
  lists: Map<number, Map<number, number>[]>;
  words: Map<number, number>;
}

/**
 * Checks the goal routine of each puzzle in `goals` (its address, segment and offset) against its read program.
 * `lists` are the global parts lists, `trials` the most trials per puzzle.
 */
export function checkGoals(
  exe: Uint8Array,
  routines: ReadonlyMap<number, GoalRoutine | GoalProblem>,
  goals: readonly { puzzle: number; segment: number; offset: number; address: number }[],
  lists: readonly PartList[],
  { trials = 3000, seed = 1 }: { trials?: number; seed?: number } = {},
): GoalCheckResult[] {
  const program = readLzexeProgram(exe);
  const dos = new Dos({ file: () => undefined, tickEvery: 1e12 });
  dos.start(program);
  const cpu = dos.cpu;
  const data = dos.load + findDataSegment(program.image);
  const base = data * 16;
  const clean = cpu.memory.slice(base, base + 0x10000);
  const heads = new Set(lists.map((l) => l.head));
  const results: GoalCheckResult[] = [];

  for (const goal of goals) {
    const rng = random(seed + goal.puzzle);
    const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)]!;
    const { fields, words, constants, tests } = survey(routines, goal.address);
    const pool = [...new Set(constants.flatMap((c) => [c, (c + 1) & 0xffff, (c - 1) & 0xffff]))];
    const someValue = () => {
      const r = rng();
      if (r < 0.7) return pick(pool);
      if (r < 0.85) return Math.floor(rng() * 2001 - 1000) & 0xffff;
      return Math.floor(rng() * 0x10000);
    };
    const somePart = (bit: number) => {
      const part = new Map<number, number>();
      for (const offset of fields) if (offset !== 0) part.set(offset, someValue());
      part.set(FLAGS, ((part.get(FLAGS) ?? 0) & ~0x3800) | bit);
      return part;
    };
    const newWorld = (): World => ({
      lists: new Map(lists.map((l) => [l.bit, Array.from({ length: Math.floor(rng() * 5) }, () => somePart(l.bit))])),
      words: new Map([...words].filter((w) => !heads.has(w)).map((w) => [w, someValue()])),
    });
    const change = (world: World): World => {
      const next: World = {
        lists: new Map([...world.lists].map(([bit, parts]) => [bit, parts.map((p) => new Map(p))])),
        words: new Map(world.words),
      };
      for (let n = 1 + Math.floor(rng() * 3); n > 0; n--) {
        const r = rng();
        const list = pick(lists);
        const parts = next.lists.get(list.bit)!;
        if (r < 0.15 && parts.length < 6) parts.splice(Math.floor(rng() * (parts.length + 1)), 0, somePart(list.bit));
        else if (r < 0.25 && parts.length) parts.splice(Math.floor(rng() * parts.length), 1);
        else if (r < 0.4 && next.words.size) next.words.set(pick([...next.words.keys()]), someValue());
        else if (parts.length) {
          const part = pick(parts);
          const offset = pick([...part.keys()]);
          part.set(offset, offset === FLAGS ? (someValue() & ~0x3800) | list.bit : someValue());
        }
      }
      return next;
    };
    const lay = (world: World, memory: Uint8Array) => {
      memory.set(clean);
      const put = (at: number, value: number) => {
        memory[at] = value & 0xff;
        memory[at + 1] = (value >> 8) & 0xff;
      };
      let at = PARTS_AT;
      for (const list of lists) {
        const parts = world.lists.get(list.bit)!;
        const places = parts.map(() => {
          const place = at;
          memory.fill(0, place, place + PART_SIZE);
          at += PART_SIZE;
          return place;
        });
        put(list.head, places[0] ?? 0);
        parts.forEach((part, k) => {
          for (const [offset, value] of part) put(places[k]! + offset, value);
          put(places[k]!, places[k + 1] ?? 0);
        });
      }
      for (const [w, value] of world.words) put(w, value);
    };

    const result: GoalCheckResult = {
      puzzle: goal.puzzle,
      trials: 0,
      unset: 0,
      dividesByZero: 0,
      runOn: 0,
      differ: 0,
      tests: tests.size,
      bothWays: 0,
    };
    const taken = new Set<string>();
    const ids = new Map<GoalTest, number>([...tests].map((t, k) => [t, k]));
    const kept: World[] = [];
    const ours = new Uint8Array(0x10000);
    for (let trial = 0; trial < trials; trial++) {
      const world = kept.length && rng() < 0.6 ? change(pick(kept)) : newWorld();
      lay(world, ours);
      cpu.memory.set(ours, base);
      result.trials++;
      const seen = new Set<string>();
      let ranOn = false;
      try {
        runGoal(
          routines,
          goal.address,
          {
            read: (a) => ours[a]! | (ours[(a + 1) & 0xffff]! << 8),
            write: (a, v) => {
              ours[a] = v & 0xff;
              ours[(a + 1) & 0xffff] = (v >> 8) & 0xff;
            },
          },
          20_000,
          (test, holds) => seen.add(`${ids.get(test)}:${holds}`),
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
      cpu.segs[0] = data;
      cpu.segs[2] = data;
      cpu.segs[3] = data;
      cpu.regs[4] = STACK_TOP + 6;
      let gameRanOn = false;
      try {
        dos.callFar(dos.load + goal.segment, goal.offset, [], 300_000, `the goal of puzzle ${goal.puzzle}`);
      } catch {
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
      const theirs = cpu.memory.subarray(base, base + 0x10000);
      for (let a = 0; a < 0x10000; a += 2) {
        if (a >= STACK_FROM && a < STACK_TO) continue;
        if (ours[a] === theirs[a] && ours[a + 1] === theirs[a + 1]) continue;
        result.differ++;
        result.firstDifference ??= `trial ${trial}: word 0x${a.toString(16)} is 0x${(theirs[a]! | (theirs[a + 1]! << 8)).toString(16)} in the game, 0x${(ours[a]! | (ours[a + 1]! << 8)).toString(16)} read`;
        break;
      }
      const before = taken.size;
      for (const s of seen) taken.add(s);
      if (taken.size > before) kept.push(world);
      if ([...ids.values()].every((id) => taken.has(`${id}:true`) && taken.has(`${id}:false`))) break;
    }
    result.bothWays = [...ids.values()].filter((id) => taken.has(`${id}:true`) && taken.has(`${id}:false`)).length;
    results.push(result);
  }
  return results;
}
