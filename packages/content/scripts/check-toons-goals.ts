/**
 * Reads every Toons puzzle's goal routine from TOONS.EXE (`src/read/toons-goals.ts`) and checks each against the
 * routine itself in the emulator (`src/run/toons-goal-check.ts`), as `check-goals` does for TIM. Fails when the goal
 * table isn't found, a routine can't be read, or a read goal leaves a word different from the game's routine. The parts
 * lists are the ones the list head routine the finder calls picks by each bit of its mask.
 *
 *   pnpm --filter @opentim/content check-toons-goals --toons <game folder> [--trials 1000]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readGoalRoutines, type GoalProblem, type GoalRoutine } from "../src/read/puzzle-goals.ts";
import { readToonsMemory } from "../src/read/toons-drawing.ts";
import { findToonsGoalTable, toonsFinder } from "../src/read/toons-goals.ts";
import { checkToonsGoals, toonsLists } from "../src/run/toons-goal-check.ts";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
  options: { toons: { type: "string" }, trials: { type: "string", default: "1000" } },
});
if (!values.toons) throw new Error("Give the --toons folder");
const trials = Number(values.trials);
if (!Number.isInteger(trials) || trials < 1)
  throw new Error(`--trials must be a whole number above 0, not ${values.trials}`);

const hex = (value: number) => `0x${value.toString(16)}`;
const toons = readToonsMemory(new Uint8Array(readFileSync(join(values.toons, "TOONS.EXE"))));
const table = findToonsGoalTable(toons);
if (!table?.routines.length || table.words.steps === undefined) throw new Error("No goal table found in TOONS.EXE");
const routines = new Map<number, GoalRoutine | GoalProblem>();
for (const goal of table.routines)
  readGoalRoutines(toons.memory, goal.segment, goal.offset, routines, { resolve: toons.resolve, farWords: true });
const unread = [...routines.values()].filter((r): r is GoalProblem => !("body" in r));
console.log(
  `Goal dispatcher ${hex(table.dispatcher)}, ${table.routines.length} puzzles, ` +
    `${new Set(table.routines.map((g) => g.address)).size} goal routines, ${routines.size} routines read with the ` +
    `ones they call, ${unread.length} not`,
);
for (const problem of unread)
  console.error(`  Not read: ${hex(problem.address)} at ${hex(problem.at)}: ${problem.reason}`);
// The finder's own first call is the list head routine.
const finder = routines.get(toonsFinder(routines, new Set(table.routines.map((g) => g.address))) ?? -1);
const head = finder && "body" in finder ? finder.body.find((s) => s.kind === "call") : undefined;
const lists = toonsLists(head?.kind === "call" ? routines.get(head.routine) : undefined);
if (!lists.length) throw new Error("The parts lists aren't found from the finder's list head routine");
console.log(`  Parts lists: ${lists.map((l) => `${hex(l.bit)} at ${hex(l.head)}`).join(", ")}`);

const results = checkToonsGoals(toons, routines, table.routines, lists, table.words.steps, { trials });
const sum = (pick: (r: (typeof results)[number]) => number) => results.reduce((total, r) => total + pick(r), 0);
const differ = results.filter((r) => r.differ);
console.log(
  `  Checked ${results.length} goals in ${sum((r) => r.trials)} trials: ${differ.length} differ from the game; ` +
    `${results.filter((r) => r.bothWays === r.tests).length} took every test both ways ` +
    `(${sum((r) => r.bothWays)} of ${sum((r) => r.tests)} tests in all).`,
);
const note = (what: string, pick: (r: (typeof results)[number]) => number) => {
  const some = results.filter((r) => pick(r));
  if (some.length) console.log(`  ${what}: ${some.map((r) => `${r.name ?? r.puzzle} (${pick(r)})`).join(", ")}`);
};
note("Reads a value it never set (puzzles, trials)", (r) => r.unset);
note("Divides by 0 (puzzles, trials)", (r) => r.dividesByZero);
note("Runs on in both (puzzles, trials)", (r) => r.runOn);
for (const r of differ) console.error(`  ${r.name ?? `Puzzle ${r.puzzle}`} differs: ${r.firstDifference}`);
if (unread.length || differ.length) {
  console.error(`${unread.length + differ.length} problems: routines not read, or goals that differ from the game.`);
  process.exitCode = 1;
} else console.log("Every goal routine is read, and every read goal does what the game's routine does.");
