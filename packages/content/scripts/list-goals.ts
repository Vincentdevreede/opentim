/**
 * Lists every puzzle's goal, build by build: the goal text the level shows the player, and the goal routine of TIM.EXE
 * said in words (`src/read/describe-goals.ts`). With `--out` it writes one file per game; the builds of a game are
 * compared, and a puzzle whose goal reads differently in another build is named. With `--conditions` each goal is
 * also said as the conditions a level view shows (`src/read/goal-conditions.ts`).
 *
 *   pnpm --filter @opentim/content list-goals --tim1 <game folder> --evenmore <game folder> [--out <folder>]
 *     [--conditions]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { conditionText, type GoalSummary } from "../src/read/goal-conditions.ts";
import { readBehaviour } from "../src/read/behaviour.ts";
import { readLevel } from "../src/read/level.ts";
import { readProgramGoals } from "../src/read/program-goals.ts";
import { buildFolders, inEachBuild, jobsOption, readBuild, type BuildFolder } from "./builds.ts";

export interface BuildGoals {
  folder: string;
  game: BuildFolder["game"];
  problem?: string;
  puzzles: { puzzle: number; title?: string; goal?: string; lines: string[]; summary: GoalSummary }[];
}

export function inBuild(build: BuildFolder): BuildGoals {
  const { program, files, parts } = readBuild(build);
  const read = readProgramGoals(program, readBehaviour(program, parts));
  if (read.problem) return { folder: build.folder, game: build.game, problem: read.problem, puzzles: [] };
  const puzzles = read.goals.map((goal) => {
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
      lines: goal.lines,
      summary: goal.summary,
    };
  });
  return { folder: build.folder, game: build.game, puzzles };
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
    // The first build that was read is the one the others are compared with.
    const first = builds.find((build) => !build.problem) ?? builds[0]!;
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
