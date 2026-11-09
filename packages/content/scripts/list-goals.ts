/**
 * Lists every puzzle's goal, build by build: the goal text the level shows the player, and the goal routine of TIM.EXE
 * said in words (`src/read/describe-goals.ts`). With `--out` it writes one file per game; the builds of a game are
 * compared, and a puzzle whose goal reads differently in another build is named.
 *
 *   pnpm --filter @opentim/content list-goals --tim1 <game folder> --evenmore <game folder> [--out <folder>]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { globalLists } from "../src/read/behaviour-list-masks.ts";
import { readBehaviour } from "../src/read/behaviour.ts";
import { describeGoal, type GoalNames } from "../src/read/describe-goals.ts";
import { readLevel } from "../src/read/level.ts";
import {
  findGoalTable,
  findStepCounts,
  readGoalRoutines,
  type GoalProblem,
  type GoalRoutine,
} from "../src/read/puzzle-goals.ts";
import { findDataSegment } from "../src/read/type-table.ts";
import { readLzexeProgram } from "../src/run/program.ts";
import { buildFolders, inEachBuild, jobsOption, readBuild, type BuildFolder } from "./builds.ts";

const LIST_NAMES = new Map([
  [0x2000, "the fixed list"],
  [0x1000, "the moving list"],
  [0x0800, "the third list"],
]);

export interface BuildGoals {
  folder: string;
  game: BuildFolder["game"];
  problem?: string;
  puzzles: { puzzle: number; title?: string; goal?: string; lines: string[] }[];
}

export function inBuild(build: BuildFolder): BuildGoals {
  const { program, files, parts } = readBuild(build);
  const image = readLzexeProgram(program).image;
  const table = findGoalTable(image, findDataSegment(image));
  if (!table) return { folder: build.folder, game: build.game, problem: "no goal table found", puzzles: [] };
  const routines = new Map<number, GoalRoutine | GoalProblem>();
  for (const goal of table.routines) readGoalRoutines(image, goal.segment, goal.offset, routines);
  const report = readBehaviour(program, parts);
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
  const names: GoalNames = {
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
  const puzzles = table.routines.map((goal) => {
    const data = files.get(`L${goal.puzzle}.LEV`);
    let level: ReturnType<typeof readLevel> | undefined;
    try {
      level = data && readLevel(data, { layout: "tim", name: `L${goal.puzzle}.LEV` });
    } catch {
      level = undefined;
    }
    return {
      puzzle: goal.puzzle,
      ...(level?.title ? { title: level.title } : {}),
      ...(level?.goal ? { goal: level.goal } : {}),
      lines: describeGoal(routines, goal.address, {
        ...names,
        routines: new Map([...routineNames].filter(([a]) => a !== goal.address)),
      }),
    };
  });
  return { folder: build.folder, game: build.game, puzzles };
}

if (isMainThread) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
    options: {
      jobs: { type: "string" },
      out: { type: "string" },
      tim1: { type: "string", multiple: true },
      evenmore: { type: "string", multiple: true },
    },
  });
  if (!values.tim1?.length && !values.evenmore?.length)
    throw new Error("Give at least one --tim1 or --evenmore folder");
  const results: BuildGoals[] = [];
  await inEachBuild<BuildGoals>(import.meta.url, buildFolders(values), (result) => results.push(result), {
    jobs: jobsOption(values.jobs),
  });
  let problems = 0;
  for (const game of ["tim1", "evenmore"] as const) {
    const builds = results.filter((r) => r.game === game);
    if (!builds.length) continue;
    const first = builds[0]!;
    // Builds keep the same words at other addresses, in the same order: compare with each word by its rank.
    const ranked = (build: BuildGoals) => {
      const words = [
        ...new Set(build.puzzles.flatMap((p) => p.lines.join("\n").match(/\bword 0x[0-9a-f]+/g) ?? [])),
      ].sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
      const rank = new Map(words.map((w, k) => [w, `word #${k + 1}`]));
      return new Map(
        build.puzzles.map((p) => [p.puzzle, p.lines.join("\n").replace(/\bword 0x[0-9a-f]+/g, (w) => rank.get(w)!)]),
      );
    };
    const reference = ranked(first);
    const text: string[] = [];
    for (const p of first.puzzles) {
      text.push(`Puzzle ${p.puzzle}${p.title ? `: ${p.title}` : ""}`);
      if (p.goal) text.push(`  The level says: ${p.goal.replace(/\s+/g, " ").trim()}`);
      text.push(...p.lines.map((line) => `  ${line}`), "");
    }
    for (const build of builds) {
      if (build.problem) {
        console.error(`${build.folder}: ${build.problem}`);
        problems++;
        continue;
      }
      const own = ranked(build);
      const differ = build.puzzles.filter((p) => reference.get(p.puzzle) !== own.get(p.puzzle));
      console.log(
        `${build.folder}: ${build.puzzles.length} goals; ${differ.length ? `read differently from ${first.folder} in puzzles ${differ.map((p) => p.puzzle).join(", ")}` : `each reads as in ${first.folder}`}`,
      );
    }
    if (values.out) {
      const file = join(values.out, `goals-${game}.txt`);
      writeFileSync(file, text.join("\n"));
      console.log(`Wrote ${file}`);
    } else console.log(text.join("\n"));
  }
  if (problems) process.exitCode = 1;
}
