/**
 * Lists every puzzle's goal, build by build: the goal text the level shows the player, and the goal as the game tests
 * it, in words. For TIM 1 and Even More that is TIM.EXE's goal routine of the puzzle (`src/read/describe-goals.ts`),
 * for Toons TOONS.EXE's (`src/read/toons-goals.ts`), and for TIM 2 the goal entries the level keeps
 * (`src/read/tim2-goal.ts`). With `--out` it writes one file per game; the builds of a game are compared, and a puzzle
 * whose goal reads differently in another build is named. With `--conditions` each goal is also said as the conditions
 * a level view shows (`src/read/goal-conditions.ts`).
 *
 *   pnpm --filter @opentim/content list-goals --tim1 <game folder> --evenmore <game folder> --tim2 <game folder>
 *     --toons <game folder> [--out <folder>] [--conditions]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { conditionText, type GoalSummary } from "../src/read/goal-conditions.ts";
import { readBehaviour } from "../src/read/behaviour.ts";
import { readLevel, type LevelLayout } from "../src/read/level.ts";
import { readProgramGoals, type ProgramGoals } from "../src/read/program-goals.ts";
import { summariseTim2Goal } from "../src/read/tim2-goal.ts";
import { readPartNames } from "../src/read/tim2.ts";
import { readToonsGoals } from "../src/read/toons-goals.ts";
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

export interface BuildGoals {
  folder: string;
  game: Game;
  problem?: string;
  puzzles: { puzzle: number; name?: string; title?: string; goal?: string; lines: string[]; summary: GoalSummary }[];
}

/** A level's title and goal text, when its file reads. */
function levelText(data: Uint8Array | undefined, layout: LevelLayout, name: string) {
  try {
    const level = data && readLevel(data, { layout, name });
    return { ...(level?.title ? { title: level.title } : {}), ...(level?.goal ? { goal: level.goal } : {}) };
  } catch {
    return {};
  }
}

/** The goals a program's routines test, with each level's text: TIM 1, Even More and Toons. */
function fromRoutines(
  build: BuildFolder<Game>,
  read: ProgramGoals,
  files: Map<string, Uint8Array>,
  layout: LevelLayout,
): BuildGoals {
  if (read.problem) return { folder: build.folder, game: build.game, problem: read.problem, puzzles: [] };
  const puzzles = read.goals.map((goal) => {
    const file = `${goal.name ?? `L${goal.puzzle}`}.LEV`;
    return {
      puzzle: goal.puzzle,
      ...(goal.name ? { name: goal.name } : {}),
      ...levelText(files.get(file), layout, file),
      lines: goal.lines,
      summary: goal.summary,
    };
  });
  return { folder: build.folder, game: build.game, puzzles };
}

/** TIM 2's goals: the entries each level keeps, which one routine of TIM2.EXE tests. */
function fromLevels(build: BuildFolder<"tim2">): BuildGoals {
  const files = readResources(build.folder);
  const info = files.get("INFO.RES");
  const names = info ? readPartNames(info) : new Map<number, string>();
  const puzzles: BuildGoals["puzzles"] = [];
  [...files.keys()]
    .filter((file) => /\.LEV$/i.test(file))
    .sort()
    .forEach((file, puzzle) => {
      let level: ReturnType<typeof readLevel>;
      try {
        level = readLevel(files.get(file)!, { name: file });
      } catch {
        return;
      }
      const read = summariseTim2Goal(level, (type) => names.get(type) ?? `type ${type}`);
      if (!read) return;
      puzzles.push({
        puzzle,
        name: file.replace(/\.LEV$/i, ""),
        ...(level.title ? { title: level.title } : {}),
        ...(level.goal ? { goal: level.goal } : {}),
        lines: read.lines,
        summary: read.summary,
      });
    });
  return { folder: build.folder, game: build.game, puzzles };
}

export function inBuild(build: BuildFolder<Game>): BuildGoals {
  if (build.game === "tim2") return fromLevels(build as BuildFolder<"tim2">);
  if (build.game === "toons")
    return fromRoutines(build, readToonsGoals(readProgram(build)), readResources(build.folder), "toons");
  const { program, files, parts } = readBuild(build as BuildFolder);
  return fromRoutines(build, readProgramGoals(program, readBehaviour(program, parts)), files, "tim");
}

/** Says a goal's conditions in lines, its ways numbered when it has more than one. */
function summaryLines(summary: GoalSummary): string[] {
  if (summary.problem) return [`no conditions: ${summary.problem}`];
  const lines: string[] = [];
  summary.ways.forEach((way, k) => {
    const pad = summary.ways.length > 1 ? "  " : "";
    if (summary.ways.length > 1) lines.push(`way ${k + 1}:`);
    for (const c of way) lines.push(`${pad}${conditionText(c)}`);
    if (!way.length) lines.push(`${pad}always`);
  });
  if (!summary.ways.length) lines.push("never met");
  for (const r of summary.remembered) lines.push(`kept from step to step: ${r.word} ${r.becomes.join("; ")}`);
  return lines;
}

if (isMainThread) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== "--"),
    options: {
      jobs: { type: "string" },
      conditions: { type: "boolean" },
      out: { type: "string" },
      ...folderOptions(GAMES),
    },
  });
  const builds = buildFolders(values, GAMES);
  if (!builds.length) throw new Error("Give at least one --tim1, --evenmore, --tim2 or --toons folder");
  const results: BuildGoals[] = [];
  await inEachBuild<BuildGoals, Game>(import.meta.url, builds, (result) => results.push(result), {
    jobs: jobsOption(values.jobs),
  });
  let problems = 0;
  // TIM 1 and Even More number their puzzles; Toons and TIM 2 name them, and a TIM 2 build has its own levels.
  const key = (p: BuildGoals["puzzles"][number]) => p.name ?? String(p.puzzle);
  for (const game of GAMES) {
    const builds = results.filter((r) => r.game === game);
    if (!builds.length) continue;
    // The first build that was read is the one the others are compared with.
    const first = builds.find((build) => !build.problem) ?? builds[0]!;
    // Builds keep the same words at other addresses, in the same order: compare with each word by its rank.
    const ranked = (build: BuildGoals) => {
      const words = [
        ...new Set(build.puzzles.flatMap((p) => p.lines.join("\n").match(/\bword 0x[0-9a-f]+/g) ?? [])),
      ].sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
      const rank = new Map(words.map((w, k) => [w, `word #${k + 1}`]));
      return new Map(
        build.puzzles.map((p) => [key(p), p.lines.join("\n").replace(/\bword 0x[0-9a-f]+/g, (w) => rank.get(w)!)]),
      );
    };
    const reference = ranked(first);
    const text: string[] = [];
    for (const p of first.puzzles) {
      text.push(`${p.name ?? `Puzzle ${p.puzzle}`}${p.title ? `: ${p.title}` : ""}`);
      if (p.goal) text.push(`  The level says: ${p.goal.replace(/\s+/g, " ").trim()}`);
      text.push(...p.lines.map((line) => `  ${line}`));
      if (values.conditions) text.push("  As conditions:", ...summaryLines(p.summary).map((line) => `    ${line}`));
      text.push("");
    }
    for (const build of builds) {
      if (build.problem) {
        console.error(`${build.folder}: ${build.problem}`);
        problems++;
        continue;
      }
      const own = ranked(build);
      const differ = build.puzzles.filter((p) => reference.get(key(p)) !== own.get(key(p)));
      const lacks = first.puzzles.filter((p) => !own.has(key(p)));
      const notes = [
        ...(differ.length ? [`read differently from ${first.folder} in puzzles ${differ.map(key).join(", ")}`] : []),
        ...(lacks.length ? [`no goal for puzzles ${lacks.map(key).join(", ")}`] : []),
      ];
      console.log(
        `${build.folder}: ${build.puzzles.length} goals; ${notes.join("; ") || `each reads as in ${first.folder}`}`,
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
