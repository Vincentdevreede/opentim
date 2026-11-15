/**
 * The emulated TOONS.EXE or TIM2.EXE that loads levels and starts puzzles with the game's own code
 * (`src/run/level-start.ts`), for the scripts. The lists come from the goal readers: TIM 2's goal routine walks all
 * three, and Toons' finder calls the list head routine, which picks them by bit.
 */
import { readGoalRoutines, type GoalProblem, type GoalRoutine } from "../src/read/puzzle-goals.ts";
import { findTim2GoalRoutine } from "../src/read/tim2-goal.ts";
import { readToonsMemory, type ToonsMemory } from "../src/read/toons-drawing.ts";
import { findToonsGoalTable, toonsFinder } from "../src/read/toons-goals.ts";
import { findGameStart } from "../src/run/level-start-find.ts";
import { GameMachine, heapStart, type GameStart } from "../src/run/level-start.ts";
import { toonsLists } from "../src/run/toons-goal-check.ts";
import { readProgram, type BuildFolder } from "./builds.ts";

/** Toons' list heads, from the list head routine its goals' finder calls first. */
function toonsListHeads(toons: ToonsMemory): GameStart["lists"] | undefined {
  const table = findToonsGoalTable(toons);
  if (!table) return undefined;
  const routines = new Map<number, GoalRoutine | GoalProblem>();
  for (const goal of table.routines)
    readGoalRoutines(toons.memory, goal.segment, goal.offset, routines, { resolve: toons.resolve, farWords: true });
  const finder = routines.get(toonsFinder(routines, new Set(table.routines.map((g) => g.address))) ?? -1);
  const head = finder && "body" in finder ? finder.body.find((s) => s.kind === "call") : undefined;
  const lists = toonsLists(head?.kind === "call" ? routines.get(head.routine) : undefined);
  const at = (bit: number) => lists.find((l) => l.bit === bit)?.head;
  const [moving, fixed, bin] = [at(0x1000), at(0x2000), at(0x0800)];
  return moving === undefined || fixed === undefined || bin === undefined ? undefined : { moving, fixed, bin };
}

/** The game's program laid out on the emulator, ready to load its levels, or why it can't be. */
export function gameMachine(
  build: BuildFolder<"toons" | "tim2">,
): { machine: GameMachine; start: GameStart; program: ToonsMemory } | { problem: string } {
  const exe = readProgram(build);
  const program = readToonsMemory(exe);
  let lists: GameStart["lists"] | undefined;
  if (build.game === "tim2") {
    const goal = findTim2GoalRoutine(program);
    if (goal) lists = { moving: goal.lists.moving, fixed: goal.lists.static, bin: goal.lists.bin };
  } else lists = toonsListHeads(program);
  if (!lists) return { problem: "the parts lists aren't found" };
  const start = findGameStart(program, build.game, lists);
  if (!start) return { problem: "the level loader and the puzzle start aren't found" };
  return { machine: new GameMachine(program, start, heapStart(exe, program.dataSegment)), start, program };
}
