/**
 * Every puzzle's goal in a program: the goal routines read from TIM.EXE (`puzzle-goals.ts`), named with what the
 * behaviour read found (the parts' fields and types, the parts lists, the game mode word and the step counts), and
 * said both as pseudo-code (`describe-goals.ts`) and as conditions (`goal-conditions.ts`).
 */
import { globalLists } from "./behaviour-list-masks.ts";
import type { BehaviourReport } from "./behaviour.ts";
import { describeGoal, type GoalNames } from "./describe-goals.ts";
import { summariseGoal, type GoalSummary } from "./goal-conditions.ts";
import { findGoalTable, findStepCounts, readGoalRoutines, type GoalProblem, type GoalRoutine } from "./puzzle-goals.ts";
import { unpackLzexe } from "./lzexe.ts";
import { findDataSegment } from "./type-table.ts";

const LIST_NAMES = new Map([
  [0x2000, "the fixed list"],
  [0x1000, "the moving list"],
  [0x0800, "the third list"],
]);

export interface PuzzleGoal {
  puzzle: number;
  /** The goal routine said as pseudo-code, one line per statement. */
  lines: string[];
  summary: GoalSummary;
}

export interface ProgramGoals {
  /** Why no goal could be read, when none could. */
  problem?: string;
  goals: PuzzleGoal[];
}

/** The names a goal is said with, from the program's load image and its behaviour read. */
export function goalNames(
  image: Uint8Array,
  report: Pick<BehaviourReport, "helpers" | "layout" | "parts">,
  routines: ReadonlyMap<number, GoalRoutine | GoalProblem>,
  table: NonNullable<ReturnType<typeof findGoalTable>>,
): GoalNames {
  const lists = report.helpers && globalLists(report.helpers);
  const helper = (kind: string) => report.helpers?.find((h) => h.kind === kind)?.address;
  // The word every goal that ends the run writes 0x0200 to: the game mode.
  const writes = new Map<number, number>();
  const count = (body: GoalRoutine["body"]) => {
    for (const s of body) {
      if (
        s.kind === "set" &&
        s.target.kind === "word" &&
        s.target.address.kind === "constant" &&
        s.value.kind === "constant" &&
        s.value.value === 0x200
      )
        writes.set(s.target.address.value, (writes.get(s.target.address.value) ?? 0) + 1);
      if (s.kind === "if") {
        count(s.then);
        count(s.else);
      } else if (s.kind === "loop") {
        count(s.before);
        count(s.body);
      }
    }
  };
  for (const r of routines.values()) if ("body" in r) count(r.body);
  const mode = [...writes].sort((a, b) => b[1] - a[1])[0]?.[0];
  const steps = findStepCounts(image, findDataSegment(image), table);
  const routineNames = new Map<number, string>();
  for (const goal of table.routines)
    if (!routineNames.has(goal.address)) routineNames.set(goal.address, `puzzle ${goal.puzzle}'s goal`);
  return {
    // The flags at 0x06 have the list bits (0x1000 moving, 0x2000 fixed) the list routines test.
    fields: new Map([[0x06, "listFlags"], ...report.layout.fields.map((f) => [f.offset, f.name] as const)]),
    types: new Map(report.parts.map((p) => [p.type, p.id])),
    lists: (lists?.byHead ?? []).map((l) => ({
      ...l,
      name: LIST_NAMES.get(l.bit) ?? `the list at 0x${l.head.toString(16)}`,
    })),
    ...(helper("list-head") !== undefined ? { listHead: helper("list-head") } : {}),
    ...(helper("list-next") !== undefined ? { listNext: helper("list-next") } : {}),
    words: new Map([
      ...(mode !== undefined ? ([[mode, "the game mode"]] as const) : []),
      // The run loop counts steps in a word of its own, and a routine it calls every step in another.
      ...(steps?.own.length === 1 ? ([[steps.own[0]!, "the step count"]] as const) : []),
      ...(steps?.called.length === 1 && steps.called[0]!.words.length === 1
        ? ([[steps.called[0]!.words[0]!, "the second step count"]] as const)
        : []),
    ]),
    ...(mode !== undefined ? { mode: { word: mode, met: 0x200 } } : {}),
    routines: routineNames,
  };
}

/** Reads every puzzle's goal from a program as it ships (packed), with the names its behaviour read gives. */
export function readProgramGoals(
  program: Uint8Array,
  report: Pick<BehaviourReport, "helpers" | "layout" | "parts">,
): ProgramGoals {
  const image = unpackLzexe(program);
  const table = findGoalTable(image, findDataSegment(image));
  if (!table) return { problem: "no goal table found", goals: [] };
  const routines = new Map<number, GoalRoutine | GoalProblem>();
  for (const goal of table.routines) readGoalRoutines(image, goal.segment, goal.offset, routines);
  const names = goalNames(image, report, routines, table);
  return {
    goals: table.routines.map((goal) => {
      // A goal that calls another puzzle's goal names it; its own routine isn't named after itself.
      const own = { ...names, routines: new Map([...names.routines!].filter(([a]) => a !== goal.address)) };
      return {
        puzzle: goal.puzzle,
        lines: describeGoal(routines, goal.address, own),
        summary: summariseGoal(routines, goal.address, own),
      };
    }),
  };
}
