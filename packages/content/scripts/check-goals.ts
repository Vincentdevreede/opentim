/**
 * Reads every puzzle's goal and checks each read goal against what the game itself does, in the emulator, for every
 * game folder it is given, each the same way:
 *
 * - TIM 1 and Even More: the goal routines of TIM.EXE (`src/read/puzzle-goals.ts`), each checked against the routine
 *   itself (`src/run/goal-check.ts`). The parts lists come from the analysis: the lists the list head routine picks by
 *   each bit of its mask.
 * - TIM 2: the goal entries each level file keeps (`level.tim2.goal`), tested by one routine of TIM2.EXE for every
 *   puzzle. `runTim2Goal` (`src/read/tim2-goal.ts`) says what the entries mean; `src/run/tim2-goal-check.ts` checks it
 *   against the routine on made-up parts, for each shipped level and for made-up goals.
 * - Toons: the goal routines of TOONS.EXE (`src/read/toons-goals.ts`), checked the same way
 *   (`src/run/toons-goal-check.ts`), with the parts lists the list head routine the finder calls picks.
 *
 * Fails when a game's goals or TIM 2's level files aren't found, a goal can't be read, a read goal does something
 * other than the game, or a Toons goal isn't compared in any trial.
 *
 *   pnpm --filter @opentim/content check-goals --tim1 <game folder> --evenmore <game folder> --tim2 <game folder>
 *     --toons <game folder> [--trials n]
 *
 * Each game has its own number of trials per puzzle unless `--trials` gives one: 3,000 for TIM 1 and Even More, 1,000
 * for TIM 2 and Toons.
 */
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { globalLists } from "../src/read/behaviour-list-masks.ts";
import { readBehaviour } from "../src/read/behaviour.ts";
import { readLevel } from "../src/read/level.ts";
import { findGoalTable, readGoalRoutines, type GoalProblem, type GoalRoutine } from "../src/read/puzzle-goals.ts";
import { readToonsMemory } from "../src/read/toons-drawing.ts";
import { findToonsGoalTable, toonsFinder } from "../src/read/toons-goals.ts";
import { findTim2GoalRoutine, tim2GoalWords } from "../src/read/tim2-goal.ts";
import { findDataSegment } from "../src/read/type-table.ts";
import { checkGoals, type GoalCheckResult } from "../src/run/goal-check.ts";
import { readLzexeProgram } from "../src/run/program.ts";
import { checkTim2Goals, madeUpTim2Goals, type Tim2GoalToCheck } from "../src/run/tim2-goal-check.ts";
import { checkToonsGoals, toonsLists } from "../src/run/toons-goal-check.ts";
import {
  buildFolders,
  folderOptions,
  GAMES,
  inEachBuild,
  jobsOption,
  readBuild,
  readProgram,
  readResources,
  type BuildFolder,
  type Game,
} from "./builds.ts";

const hex = (value: number) => `0x${value.toString(16)}`;

/** Trials per puzzle when `--trials` doesn't say. */
const TRIALS: Record<Game, number> = { tim1: 3000, evenmore: 3000, tim2: 1000, toons: 1000 };

/** One build's lines in the order they are printed (errors to stderr), and how many problems it has. */
interface BuildCheck {
  lines: { error: boolean; text: string }[];
  problems: number;
}

/** A check's results as every game prints them, after the build's first line. */
function report(check: BuildCheck, results: readonly (GoalCheckResult & { name?: string })[], what = "goals") {
  const log = (text: string) => check.lines.push({ error: false, text });
  const sum = (pick: (r: (typeof results)[number]) => number) => results.reduce((total, r) => total + pick(r), 0);
  const differ = results.filter((r) => r.differ);
  log(
    `  Checked ${results.length} ${what} in ${sum((r) => r.trials)} trials: ${differ.length} differ from the game; ` +
      `${results.filter((r) => r.bothWays === r.tests).length} took every test both ways ` +
      `(${sum((r) => r.bothWays)} of ${sum((r) => r.tests)} tests in all).`,
  );
  const note = (what: string, pick: (r: (typeof results)[number]) => number) => {
    const some = results.filter((r) => pick(r));
    if (some.length) log(`  ${what}: ${some.map((r) => `${r.name ?? r.puzzle} (${pick(r)})`).join(", ")}`);
  };
  note("Reads a value it never set (puzzles, trials)", (r) => r.unset);
  note("Divides by 0 (puzzles, trials)", (r) => r.dividesByZero);
  note("Runs on in both (puzzles, trials)", (r) => r.runOn);
  for (const r of differ)
    check.lines.push({ error: true, text: `  ${r.name ?? `Puzzle ${r.puzzle}`} differs: ${r.firstDifference}` });
  check.problems += differ.length;
}

/** The routines a goal reaches through its calls are all read. */
function readable(routines: ReadonlyMap<number, GoalRoutine | GoalProblem>, address: number): boolean {
  const reached = new Set<number>();
  const reach = (at: number): boolean => {
    if (reached.has(at)) return true;
    reached.add(at);
    const routine = routines.get(at);
    return !!routine && "body" in routine && callees(routine).every(reach);
  };
  return reach(address);
}

/** TIM 1 and Even More: TIM.EXE's goal routine of each puzzle. */
function checkTim(build: BuildFolder, trials: number): BuildCheck {
  const check: BuildCheck = { lines: [], problems: 0 };
  const log = (text: string) => check.lines.push({ error: false, text });
  const error = (text: string) => check.lines.push({ error: true, text });
  const { program, files, parts } = readBuild(build);
  const image = readLzexeProgram(program).image;
  const table = findGoalTable(image, findDataSegment(image));
  if (!table) {
    error(`${build.folder}: no goal table found`);
    return { ...check, problems: 1 };
  }
  const shipped = [...files.keys()].filter((name) => /^L\d+\.LEV$/i.test(name)).length;
  const routines = new Map<number, GoalRoutine | GoalProblem>();
  for (const goal of table.routines) readGoalRoutines(image, goal.segment, goal.offset, routines);
  const unread = [...routines.values()].filter((r): r is GoalProblem => !("body" in r));
  const goalRoutines = new Set(table.routines.map((g) => g.address)).size;
  log(
    `${build.folder}: goal dispatcher ${hex(table.dispatcher)}, puzzle number in ${hex(table.puzzleWord)}, ` +
      `${table.routines.length} puzzles in the table (${shipped} levels shipped), ${goalRoutines} goal routines, ` +
      `${routines.size} routines read with the ones they call, ${unread.length} not`,
  );
  for (const problem of unread) error(`  Not read: ${hex(problem.address)} at ${hex(problem.at)}: ${problem.reason}`);
  check.problems += unread.length;

  const lists = readBehaviour(program, parts).helpers;
  const heads = lists && globalLists(lists);
  if (!heads) {
    error("  The analysis doesn't read the parts lists, so the goals aren't checked.");
    return { ...check, problems: check.problems + 1 };
  }
  const goals = table.routines.filter((goal) => readable(routines, goal.address));
  report(check, checkGoals(program, routines, goals, heads.byHead, { trials }));
  return check;
}

/** Toons: TOONS.EXE's goal routine of each puzzle, run with its overlays laid out. */
function checkToons(build: BuildFolder<"toons">, trials: number): BuildCheck {
  const check: BuildCheck = { lines: [], problems: 0 };
  const log = (text: string) => check.lines.push({ error: false, text });
  const error = (text: string) => check.lines.push({ error: true, text });
  const toons = readToonsMemory(readProgram(build));
  const table = findToonsGoalTable(toons);
  if (!table?.routines.length || table.words.steps === undefined) {
    error(`${build.folder}: no goal table found`);
    return { ...check, problems: 1 };
  }
  const files = readResources(build.folder);
  const shipped = table.routines.filter((goal) => goal.name && files.has(`${goal.name}.LEV`)).length;
  const routines = new Map<number, GoalRoutine | GoalProblem>();
  for (const goal of table.routines)
    readGoalRoutines(toons.memory, goal.segment, goal.offset, routines, { resolve: toons.resolve, farWords: true });
  const unread = [...routines.values()].filter((r): r is GoalProblem => !("body" in r));
  log(
    `${build.folder}: goal dispatcher ${hex(table.dispatcher)}, ${table.routines.length} puzzles in the table ` +
      `(${shipped} levels shipped), ${new Set(table.routines.map((g) => g.address)).size} goal routines, ` +
      `${routines.size} routines read with the ones they call, ${unread.length} not`,
  );
  for (const problem of unread) error(`  Not read: ${hex(problem.address)} at ${hex(problem.at)}: ${problem.reason}`);
  check.problems += unread.length;
  // The finder's own first call is the list head routine.
  const finder = routines.get(toonsFinder(routines, new Set(table.routines.map((g) => g.address))) ?? -1);
  const head = finder && "body" in finder ? finder.body.find((s) => s.kind === "call") : undefined;
  const lists = toonsLists(head?.kind === "call" ? routines.get(head.routine) : undefined);
  if (!lists.length) {
    error("  The parts lists aren't found from the finder's list head routine, so the goals aren't checked.");
    return { ...check, problems: check.problems + 1 };
  }
  const results = checkToonsGoals(toons, routines, table.routines, lists, table.words.steps, { trials });
  report(check, results);
  // A goal whose every trial stopped before its words were compared isn't checked at all.
  const unchecked = results.filter((r) => !r.compared);
  for (const r of unchecked) error(`  ${r.name ?? `Puzzle ${r.puzzle}`} isn't compared in any trial`);
  check.problems += unchecked.length;
  return check;
}

/** How many made-up TIM 2 goals the check tries besides the shipped ones. */
const MADE_UP_TIM2_GOALS = 200;

/** TIM 2: the goal entries of each level, all tested by one routine of TIM2.EXE. */
function checkTim2(build: BuildFolder<"tim2">, trials: number): BuildCheck {
  const check: BuildCheck = { lines: [], problems: 0 };
  const log = (text: string) => check.lines.push({ error: false, text });
  const error = (text: string) => check.lines.push({ error: true, text });
  const tim2 = readToonsMemory(readProgram(build));
  const routine = findTim2GoalRoutine(tim2);
  if (!routine) {
    error(`${build.folder}: no goal routine found`);
    return { ...check, problems: 1 };
  }
  const files = readResources(build.folder);
  const names = [...files.keys()].filter((name) => /\.LEV$/i.test(name)).sort();
  const goals: Tim2GoalToCheck[] = [];
  const unread: string[] = [];
  names.forEach((file, puzzle) => {
    const name = file.replace(/\.LEV$/i, "");
    let level: ReturnType<typeof readLevel>;
    try {
      level = readLevel(files.get(file)!, { name: file });
    } catch (problem) {
      unread.push(`${name}: ${(problem as Error).message}`);
      return;
    }
    const goal = level.tim2?.goal;
    if (!goal) return unread.push(`${name}: no goal entries`);
    if (goal.entries.some((e) => e.part !== null && !level.parts[e.part]))
      return unread.push(`${name}: an entry points past the parts`);
    goals.push({
      puzzle,
      name,
      first: goal.first,
      entries: goal.entries.map((e) => ({ part: e.part, values: tim2GoalWords(e.values) })),
      last: goal.last,
      parts: level.parts.map((part) => ({
        type: part.type,
        state: part.state[0],
        x: part.position.x,
        y: part.position.y,
        baseWidth: part.baseSize.width,
        baseHeight: part.baseSize.height,
        group: part.group === "moving" ? "moving" : "static",
      })),
    });
  });
  const file = tim2.fileOffset(routine.address);
  log(
    `${build.folder}: goal routine ${hex(routine.segment)}:${hex(routine.offset)} (file offset ${hex(file)}), goal ` +
      `words ${hex(routine.first)} to ${hex(routine.last)}, checks counted in ${hex(routine.checks)}, ${names.length} ` +
      `levels shipped, ${goals.length} goals read, ${unread.length} not`,
  );
  for (const problem of unread) error(`  Not read: ${problem}`);
  check.problems += unread.length;
  if (!names.length) {
    error("  No level files found, so no shipped goal is checked.");
    check.problems++;
  }
  report(check, checkTim2Goals(tim2, routine, goals, { trials }));
  report(check, checkTim2Goals(tim2, routine, madeUpTim2Goals(MADE_UP_TIM2_GOALS), { trials }), "made-up goals");
  return check;
}

export function inBuild(build: BuildFolder<Game>, given: { trials?: number }): BuildCheck {
  const trials = given.trials ?? TRIALS[build.game];
  if (build.game === "toons") return checkToons(build as BuildFolder<"toons">, trials);
  if (build.game === "tim2") return checkTim2(build as BuildFolder<"tim2">, trials);
  return checkTim(build as BuildFolder, trials);
}

function callees(routine: GoalRoutine): number[] {
  const out: number[] = [];
  const walk = (body: GoalRoutine["body"]) => {
    for (const s of body) {
      if (s.kind === "call") out.push(s.routine);
      else if (s.kind === "if") {
        walk(s.then);
        walk(s.else);
      } else if (s.kind === "loop") {
        walk(s.before);
        walk(s.body);
      }
    }
  };
  walk(routine.body);
  return out;
}

if (isMainThread) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
    options: { jobs: { type: "string" }, trials: { type: "string" }, ...folderOptions(GAMES) },
  });
  const builds = buildFolders(values, GAMES);
  if (!builds.length) throw new Error("Give at least one --tim1, --evenmore, --tim2 or --toons folder");
  const trials = values.trials === undefined ? undefined : Number(values.trials);
  if (trials !== undefined && (!Number.isInteger(trials) || trials < 1))
    throw new Error(`--trials must be a whole number above 0, not ${values.trials}`);

  let problems = 0;
  await inEachBuild<BuildCheck, Game>(
    import.meta.url,
    builds,
    (result) => {
      for (const { error, text } of result.lines) (error ? console.error : console.log)(text);
      problems += result.problems;
    },
    { jobs: jobsOption(values.jobs), given: trials === undefined ? {} : { trials } },
  );
  if (problems) {
    console.error(
      `${problems} problems: goals not found, routines not read, goals that differ from the game, or goals not compared.`,
    );
    process.exitCode = 1;
  } else console.log("Every goal is read, and every read goal does what the game's routine does.");
}
