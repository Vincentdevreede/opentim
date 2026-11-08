/**
 * Reads every puzzle's goal routine from TIM.EXE (`src/read/puzzle-goals.ts`) and checks each read goal against the
 * routine itself in the emulator (`src/run/goal-check.ts`), build by build. Fails when a build's goal table isn't
 * found, a routine can't be read, or a read goal leaves a word different from the game's routine. The parts lists
 * come from the analysis: the lists the list head routine picks by each bit of its mask.
 *
 *   pnpm --filter @opentim/content check-goals --tim1 <game folder> --evenmore <game folder> [--trials 3000]
 */
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { globalLists } from "../src/read/behaviour-list-masks.ts";
import { readBehaviour } from "../src/read/behaviour.ts";
import { findGoalTable, readGoalRoutines, type GoalProblem, type GoalRoutine } from "../src/read/puzzle-goals.ts";
import { findDataSegment } from "../src/read/type-table.ts";
import { checkGoals } from "../src/run/goal-check.ts";
import { readLzexeProgram } from "../src/run/program.ts";
import { buildFolders, inEachBuild, jobsOption, readBuild, type BuildFolder } from "./builds.ts";

const hex = (value: number) => `0x${value.toString(16)}`;

/** One build's lines in the order they are printed (errors to stderr), and how many problems it has. */
export function inBuild(build: BuildFolder, given: { trials: number }) {
  const lines: { error: boolean; text: string }[] = [];
  const log = (text: string) => lines.push({ error: false, text });
  const error = (text: string) => lines.push({ error: true, text });
  let problems = 0;
  const { program, files, parts } = readBuild(build);
  const image = readLzexeProgram(program).image;
  const table = findGoalTable(image, findDataSegment(image));
  if (!table) {
    error(`${build.folder}: no goal table found`);
    return { lines, problems: 1 };
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
  problems += unread.length;

  const report = readBehaviour(program, parts);
  const lists = report.helpers && globalLists(report.helpers);
  if (!lists) {
    error("  The analysis doesn't read the parts lists, so the goals aren't checked.");
    return { lines, problems: problems + 1 };
  }
  const readable = table.routines.filter((goal) => {
    const reached = new Set<number>();
    const reach = (address: number): boolean => {
      if (reached.has(address)) return true;
      reached.add(address);
      const routine = routines.get(address);
      return !!routine && "body" in routine && callees(routine).every(reach);
    };
    return reach(goal.address);
  });
  const results = checkGoals(program, routines, readable, lists.byHead, { trials: given.trials });
  const sum = (pick: (r: (typeof results)[number]) => number) => results.reduce((total, r) => total + pick(r), 0);
  const differ = results.filter((r) => r.differ);
  log(
    `  Checked ${results.length} goals in ${sum((r) => r.trials)} trials: ${differ.length} differ from the game; ` +
      `${results.filter((r) => r.bothWays === r.tests).length} took every test both ways ` +
      `(${sum((r) => r.bothWays)} of ${sum((r) => r.tests)} tests in all).`,
  );
  const note = (what: string, pick: (r: (typeof results)[number]) => number) => {
    const some = results.filter((r) => pick(r));
    if (some.length) log(`  ${what}: ${some.map((r) => `${r.puzzle} (${pick(r)})`).join(", ")}`);
  };
  note("Reads a value it never set, when a part it looks for isn't there (puzzles, trials)", (r) => r.unset);
  note("Divides by 0 (puzzles, trials)", (r) => r.dividesByZero);
  note("Runs on in both, like a search for a part that isn't there (puzzles, trials)", (r) => r.runOn);
  for (const r of differ) error(`  Puzzle ${r.puzzle} differs: ${r.firstDifference}`);
  problems += differ.length;
  return { lines, problems };
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
    options: {
      jobs: { type: "string" },
      trials: { type: "string", default: "3000" },
      tim1: { type: "string", multiple: true },
      evenmore: { type: "string", multiple: true },
    },
  });
  if (!values.tim1?.length && !values.evenmore?.length)
    throw new Error("Give at least one --tim1 or --evenmore folder");
  const trials = Number(values.trials);
  if (!Number.isInteger(trials) || trials < 1)
    throw new Error(`--trials must be a whole number above 0, not ${values.trials}`);

  let problems = 0;
  await inEachBuild<ReturnType<typeof inBuild>>(
    import.meta.url,
    buildFolders(values),
    (result) => {
      for (const { error, text } of result.lines) (error ? console.error : console.log)(text);
      problems += result.problems;
    },
    { jobs: jobsOption(values.jobs), given: { trials } },
  );
  if (problems) {
    console.error(
      `${problems} problems: goal tables not found, routines not read, or goals that differ from the game.`,
    );
    process.exitCode = 1;
  } else console.log("Every goal routine is read, and every read goal does what the game's routine does.");
}
